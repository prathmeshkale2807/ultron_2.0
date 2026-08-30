import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ChatMessage, MicStatus, RiskLevel, VoiceState } from "../core/types";
import { fmtClock } from "../core/eventBus";
import { Icon } from "./Chrome";

/* ------------------------- markdown-lite ------------------------- */

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = regex.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) nodes.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) nodes.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else {
      const mm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (mm)
        nodes.push(
          <a key={k++} href={mm[2]} target="_blank" rel="noreferrer">
            {mm[1]}
          </a>
        );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Md({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const parts = text.split("```");
  parts.forEach((part, pi) => {
    if (pi % 2 === 1) {
      const nl = part.indexOf("\n");
      const code = nl >= 0 ? part.slice(nl + 1) : part;
      blocks.push(
        <pre key={`c${pi}`}>
          <code>{code.replace(/\n$/, "")}</code>
        </pre>
      );
      return;
    }
    const lines = part.split("\n");
    let list: string[] = [];
    let listType: "ul" | "ol" | null = null;
    const flush = (key: string) => {
      if (!list.length) return;
      const items = list.map((it, i) => <li key={i}>{inline(it)}</li>);
      blocks.push(listType === "ol" ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      list = [];
      listType = null;
    };
    lines.forEach((ln, li) => {
      const t = ln.trim();
      if (!t) {
        flush(`f${pi}-${li}`);
        return;
      }
      if (/^#{1,4}\s/.test(t)) {
        flush(`h${pi}-${li}`);
        blocks.push(<h3 key={`h${pi}-${li}`}>{inline(t.replace(/^#{1,4}\s/, ""))}</h3>);
      } else if (/^[-*•]\s+/.test(t)) {
        if (listType !== "ul") flush(`s${pi}-${li}`);
        listType = "ul";
        list.push(t.replace(/^[-*•]\s+/, ""));
      } else if (/^\d+\.\s+/.test(t)) {
        if (listType !== "ol") flush(`s${pi}-${li}`);
        listType = "ol";
        list.push(t.replace(/^\d+\.\s+/, ""));
      } else if (t.startsWith(">")) {
        flush(`q${pi}-${li}`);
        blocks.push(<blockquote key={`q${pi}-${li}`}>{inline(t.replace(/^>\s*/, ""))}</blockquote>);
      } else {
        flush(`p${pi}-${li}`);
        blocks.push(<p key={`p${pi}-${li}`}>{inline(t)}</p>);
      }
    });
    flush(`e${pi}`);
  });
  return <div className="md text-[13px] leading-relaxed text-ice/90">{blocks}</div>;
}

/* ---------------------------- chips ------------------------------ */

const RISK_COLOR: Record<RiskLevel, string> = {
  LOW: "text-core border-core/40 bg-core/5",
  MEDIUM: "text-glow border-glow/40 bg-glow/5",
  HIGH: "text-amber border-amber/40 bg-amber/5",
  CRITICAL: "text-danger border-danger/40 bg-danger/5",
};

function MetaChips({ msg }: { msg: ChatMessage }) {
  const meta = msg.meta;
  if (!meta) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {meta.routing && (
        <span className="display rounded-sm border border-line2/70 bg-deep px-1.5 py-0.5 text-[8px] tracking-[0.18em] text-glow/90">
          {meta.routing.toUpperCase()}
        </span>
      )}
      {meta.tool && (
        <span className="font-mono text-[9px] text-dim">
          tool:<span className="text-core">{meta.tool}</span>
        </span>
      )}
      {meta.risk && (
        <span className={`display rounded-sm border px-1.5 py-0.5 text-[8px] tracking-[0.18em] ${RISK_COLOR[meta.risk]}`}>
          {meta.risk}
        </span>
      )}
      {typeof meta.latencyMs === "number" && meta.latencyMs > 0 && (
        <span className="font-mono text-[9px] text-faint">{meta.latencyMs} ms</span>
      )}
      {meta.spoken && <span className="font-mono text-[9px] text-lime/80">spoken</span>}
      {meta.link && (
        <a
          href={meta.link.url}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[9px] text-glow underline decoration-glow/40 underline-offset-2 hover:text-ice"
        >
          {meta.link.label.slice(0, 42)} ↗
        </a>
      )}
    </div>
  );
}

/* --------------------------- deck -------------------------------- */

const SUGGESTIONS: { label: string; sub: string; text: string }[] = [
  { label: "Open YouTube", sub: "browser tool · no confirmation", text: "Open YouTube" },
  { label: "Search the web", sub: "web intelligence", text: "Search for the ideal espresso brew ratio" },
  { label: "Store a memory", sub: "memory core", text: "Remember that I prefer concise answers" },
  { label: "Set a reminder", sub: "task automation", text: "Remind me in 2 minutes to stretch" },
  { label: "Run diagnostics", sub: "subsystem report", text: "System status" },
  { label: "Deep reasoning", sub: "grok-assisted analysis", text: "Think deeply: compare a monolith versus microservices architecture for a small two-person startup, then recommend an approach" },
];

export function ConversationDeck({
  messages,
  thinking,
  pendingConfirm,
  onSend,
  onApprove,
  onDeny,
  onPushToTalk,
  voiceState,
  voiceEnabled,
  mic,
  voiceSupported,
  onToggleVoice,
  cognitionReady,
  settings,
  onOpenConfig,
}: {
  messages: ChatMessage[];
  thinking: boolean;
  pendingConfirm: { token: string; tool: string; toolLabel: string; risk: string; promptText: string } | null;
  onSend: (text: string) => void;
  onApprove: () => void;
  onDeny: () => void;
  onPushToTalk: () => void;
  voiceState: VoiceState;
  voiceEnabled: boolean;
  mic: MicStatus;
  voiceSupported: boolean;
  onToggleVoice: () => void;
  cognitionReady: boolean;
  settings: { wakeWord: string };
  onOpenConfig: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, thinking, pendingConfirm]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = draft.trim();
    if (!t || thinking) return;
    setDraft("");
    onSend(t);
  };

  const hour = new Date().getHours();
  const daypart = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* message stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {messages.length === 0 ? (
          <div className="fade-up mx-auto max-w-xl pt-6">
            <div className="display text-[8.5px] tracking-[0.34em] text-core">SESSION INITIALISED</div>
            <h1 className="display mt-2 text-[26px] font-bold leading-tight tracking-wide text-ice sm:text-[30px]">
              Good {daypart}, sir.
            </h1>
            <p className="mt-3 max-w-lg text-[13px] leading-relaxed text-dim">
              All subsystems are reporting. I think with <span className="text-ice">Gemini</span>, reason deeper with{" "}
              <span className="text-ice">Grok</span> when a problem earns it, remember what you tell me, and every action
              passes the safety gate. {cognitionReady ? "The cognition link is live." : "The cognition link is not configured yet — my local cortex keeps tools, memory and automation fully operational."}
            </p>

            {!cognitionReady && (
              <div className="mt-4 rounded border border-amber/30 bg-amber/5 px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11.5px] text-amber/90">
                    Cloud cognition is on standby. Two ways to bring it online —
                  </div>
                  <button
                    onClick={onOpenConfig}
                    className="display flex-none rounded border border-amber/50 px-2.5 py-1.5 text-[8.5px] tracking-[0.2em] text-amber transition-all hover:bg-amber/10 active:translate-y-px"
                  >
                    CONFIGURE
                  </button>
                </div>
                <div className="mt-1.5 font-mono text-[9.5px] leading-relaxed text-amber/70">
                  1 · set <span className="text-amber">GEMINI_API_KEY</span> &nbsp;2 · or run <span className="text-amber">ollama serve</span> locally — key-free cognition, no cloud at all
                </div>
              </div>
            )}

            <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s.label}
                  onClick={() => onSend(s.text)}
                  className="fade-up group rounded border border-line/80 bg-panel px-3.5 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-core/40 hover:bg-panel2 hover:shadow-[0_6px_24px_rgba(55,226,213,0.08)] active:translate-y-0"
                  style={{ animationDelay: `${i * 60 + 120}ms` }}
                >
                  <div className="text-[12.5px] font-semibold text-ice/90 group-hover:text-core transition-colors">{s.label}</div>
                  <div className="mt-0.5 font-mono text-[9px] tracking-wider text-faint">{s.sub.toUpperCase()}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.map((m) => (
              <MessageRow
                key={m.id}
                msg={m}
                pendingConfirm={pendingConfirm}
                onApprove={onApprove}
                onDeny={onDeny}
              />
            ))}

            {thinking && (
              <div className="fade-up flex items-center gap-3 py-1">
                <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-core/40 bg-core/10">
                  <span className="led led-on led-blink" />
                </div>
                <div className="flex items-center gap-2 rounded border border-line/70 bg-panel px-3.5 py-2.5">
                  <span className="think-dot h-1.5 w-1.5 rounded-full bg-core" />
                  <span className="think-dot h-1.5 w-1.5 rounded-full bg-core" style={{ animationDelay: "0.15s" }} />
                  <span className="think-dot h-1.5 w-1.5 rounded-full bg-core" style={{ animationDelay: "0.3s" }} />
                  <span className="display ml-1 text-[8.5px] tracking-[0.26em] text-dim">ULTRON IS THINKING</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* composer */}
      <div className="flex-none border-t border-line/70 bg-deep/70 px-4 pb-3.5 pt-3 backdrop-blur sm:px-6">
        <form onSubmit={submit} className="mx-auto flex max-w-2xl items-center gap-2">
          <div className="relative flex-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={voiceState === "LISTENING" ? "Listening… speak or type" : 'Command ULTRON — "open chrome", "search for…", "remind me in 5 min to…"'}
              className="w-full rounded border border-line2/70 bg-panel px-3.5 py-2.5 text-[13px] text-ice placeholder:text-faint outline-none transition-all focus:border-core/60 focus:shadow-[0_0_0_3px_rgba(55,226,213,0.08)]"
            />
          </div>
          <button
            type="button"
            onClick={onPushToTalk}
            disabled={!voiceSupported || mic === "denied" || mic === "unsupported"}
            title="Push to talk"
            className={`flex h-[38px] w-[38px] flex-none items-center justify-center rounded border transition-all active:translate-y-px disabled:opacity-30 ${
              voiceState === "LISTENING"
                ? "border-core/70 bg-core/10 text-core shadow-[0_0_18px_rgba(55,226,213,0.3)]"
                : "border-line2/70 bg-panel2 text-dim hover:border-core/50 hover:text-core"
            }`}
          >
            <Icon.Mic className="h-4 w-4" />
          </button>
          <button
            type="submit"
            disabled={!draft.trim() || thinking}
            className="flex h-[38px] flex-none items-center gap-2 rounded border border-core/50 bg-core/10 px-4 text-core transition-all hover:bg-core/20 hover:shadow-[0_0_18px_rgba(55,226,213,0.2)] active:translate-y-px disabled:opacity-30 disabled:hover:bg-core/10"
          >
            <Icon.Send className="h-3.5 w-3.5" />
            <span className="display hidden text-[9px] tracking-[0.22em] sm:inline">SEND</span>
          </button>
        </form>

        <div className="mx-auto mt-2 flex max-w-2xl items-center justify-between gap-3 font-mono text-[9px] tracking-wider text-faint">
          {voiceEnabled ? (
            <span>
              SAY <span className="text-core">“{settings.wakeWord.toUpperCase()}”</span> · THEN JUST TALK · BARGE IN WITH “STOP”
            </span>
          ) : (
            <span>
              VOICE INTERFACE {voiceSupported ? "OFFLINE" : "UNSUPPORTED IN THIS BROWSER"} —{" "}
              <button onClick={onToggleVoice} className="text-glow underline decoration-glow/40 underline-offset-2 hover:text-ice">
                {voiceSupported ? "ENABLE WAKE WORD" : "TEXT MODE ACTIVE"}
              </button>
            </span>
          )}
          {mic === "denied" && <span className="text-amber">MIC PERMISSION DENIED — CHECK BROWSER SETTINGS</span>}
          <span className="hidden sm:inline">SAFETY GATE · CONFIRMATION BROKER · AUDIT — ALWAYS IN PATH</span>
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  msg,
  pendingConfirm,
  onApprove,
  onDeny,
}: {
  msg: ChatMessage;
  pendingConfirm: { token: string; tool: string; toolLabel: string; risk: string; promptText: string } | null;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const isUser = msg.role === "user";
  const showConfirm =
    !isUser && msg.meta?.confirmToken && pendingConfirm && pendingConfirm.token === msg.meta.confirmToken;

  if (isUser) {
    return (
      <div className="fade-up flex justify-end gap-3">
        <div className="max-w-[82%]">
          <div className="rounded rounded-tr-sm border border-glow/25 bg-glow/8 px-3.5 py-2.5 text-[13px] leading-relaxed text-ice">
            {msg.content}
          </div>
          <div className="mt-1 text-right font-mono text-[8.5px] text-faint">YOU · {fmtClock(msg.ts)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full border border-core/40 bg-core/10 shadow-[0_0_12px_rgba(55,226,213,0.15)]">
        <span className={`led ${msg.meta?.error ? "led-err" : "led-on"}`} />
      </div>
      <div className="min-w-0 max-w-[86%] flex-1">
        <div
          className={`rounded rounded-tl-sm border px-3.5 py-2.5 ${
            msg.meta?.error
              ? "border-danger/30 bg-danger/5"
              : "border-line/80 bg-panel"
          }`}
        >
          <Md text={msg.content} />

          {msg.meta?.reasoningSummary && (
            <details className="mt-2 rounded border border-glow/25 bg-deep/70 px-2.5 py-1.5">
              <summary className="display cursor-pointer text-[8.5px] tracking-[0.24em] text-glow/90 hover:text-glow">
                REASONING BRIEF · SECONDARY ENGINE
              </summary>
              <pre className="mt-1.5 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-dim">
                {msg.meta.reasoningSummary}
              </pre>
            </details>
          )}

          {showConfirm && pendingConfirm && (
            <div className="confirm-glow mt-3 rounded border border-amber/40 bg-amber/5 p-3">
              <div className="flex items-center gap-2">
                <span className="display rounded-sm border border-amber/50 bg-amber/10 px-1.5 py-0.5 text-[8px] tracking-[0.2em] text-amber">
                  {pendingConfirm.risk} RISK
                </span>
                <span className="font-mono text-[10px] text-amber/90">{pendingConfirm.toolLabel}</span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ice/85">{pendingConfirm.promptText}</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={onApprove}
                  className="display rounded border border-lime/60 bg-lime/10 px-4 py-1.5 text-[9px] tracking-[0.24em] text-lime transition-all hover:bg-lime/20 active:translate-y-px"
                >
                  PROCEED
                </button>
                <button
                  onClick={onDeny}
                  className="display rounded border border-line2 bg-panel2 px-4 py-1.5 text-[9px] tracking-[0.24em] text-dim transition-all hover:border-danger/50 hover:text-danger active:translate-y-px"
                >
                  CANCEL
                </button>
              </div>
              <div className="mt-2 font-mono text-[8.5px] text-faint">VOICE: SAY “YES” OR “NO” — NOTHING EXECUTES WITHOUT APPROVAL</div>
            </div>
          )}

          <MetaChips msg={msg} />
        </div>
        <div className="mt-1 font-mono text-[8.5px] text-faint">ULTRON · {fmtClock(msg.ts)}</div>
      </div>
    </div>
  );
}
