import { useEffect, useState } from "react";
import type { EventEntry, MicStatus, SubsystemStatus, VoiceState } from "../core/types";
import { fmtClock } from "../core/eventBus";

/* ----------------------------- icons ----------------------------- */

export const Icon = {
  Mic: (p: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  ),
  Wave: (p: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} strokeLinecap="round">
      <path d="M3 12h2l2-5 3 10 3-14 3 12 2-3h3" />
    </svg>
  ),
  Send: (p: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={p.className}>
      <path d="M3.4 20.6 21 12 3.4 3.4l2.8 7.2L14 12l-7.8 1.4z" />
    </svg>
  ),
  Gear: (p: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={p.className}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z" />
    </svg>
  ),
  Pulse: (p: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} strokeLinecap="round">
      <path d="M2 12h4l3-8 4 16 3-8h6" />
    </svg>
  ),
};

/* ----------------------------- top bar ---------------------------- */

const VOICE_LABEL: Record<VoiceState, string> = {
  OFF: "INTERFACE · TEXT",
  IDLE: "WAKE-WORD ARMED",
  WAKE_ACK: "ACTIVATED",
  LISTENING: "LISTENING",
  THINKING: "PROCESSING",
  SPEAKING: "SPEAKING",
  STANDBY: "STANDBY",
};

export function TopBar({
  voiceState,
  voiceEnabled,
  mic,
  onToggleVoice,
  onPushToTalk,
  sessionId,
  onShowOps,
}: {
  voiceState: VoiceState;
  voiceEnabled: boolean;
  mic: MicStatus;
  onToggleVoice: () => void;
  onPushToTalk: () => void;
  sessionId: string;
  onShowOps: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const d = new Date(now);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();

  return (
    <header className="flex h-14 flex-none items-center gap-4 border-b border-line/70 bg-deep/80 px-4 backdrop-blur">
      <div className="flex items-baseline gap-3">
        <div>
          <div className="display text-[19px] leading-none tracking-[0.42em] text-ice text-glow-core" style={{ fontWeight: 800 }}>
            ULTRON
          </div>
          <div className="display mt-[3px] text-[7.5px] tracking-[0.3em] text-faint">
            PERSONAL AI OPERATING SYSTEM
          </div>
        </div>
      </div>

      <div className="ml-2 hidden items-center gap-2 rounded border border-line2/60 bg-panel2/80 px-3 py-1.5 md:flex">
        <span
          className={`led ${
            voiceState === "LISTENING" || voiceState === "WAKE_ACK"
              ? "led-on led-blink"
              : voiceState === "SPEAKING"
                ? "led led-blink"
                : voiceState === "THINKING"
                  ? "led-warn led-blink"
                  : "led-off"
          }`}
          style={voiceState === "SPEAKING" ? { background: "#a4e86d", boxShadow: "0 0 8px rgba(164,232,109,0.8)" } : undefined}
        />
        <span className="display text-[9px] tracking-[0.28em] text-dim">{VOICE_LABEL[voiceState]}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="mr-2 hidden text-right lg:block">
          <div className="font-mono text-[13px] leading-none text-ice/90">{fmtClock(now)}</div>
          <div className="font-mono text-[8.5px] tracking-[0.2em] text-faint">{date} · {sessionId}</div>
        </div>

        <button
          onClick={onPushToTalk}
          disabled={mic === "unsupported" || mic === "denied"}
          title="Push to talk"
          className={`flex h-9 w-9 items-center justify-center rounded border transition-all active:translate-y-px disabled:opacity-30 ${
            voiceState === "LISTENING"
              ? "border-core/70 bg-core/10 text-core shadow-[0_0_16px_rgba(55,226,213,0.25)]"
              : "border-line2/70 bg-panel2 text-dim hover:border-core/50 hover:text-core"
          }`}
        >
          <Icon.Mic className="h-4 w-4" />
        </button>

        <button
          onClick={onToggleVoice}
          title={voiceEnabled ? "Disable voice interface" : "Enable voice interface (wake word)"}
          className={`flex h-9 items-center gap-2 rounded border px-3 transition-all active:translate-y-px ${
            voiceEnabled
              ? "border-core/60 bg-core/10 text-core shadow-[0_0_16px_rgba(55,226,213,0.2)]"
              : "border-line2/70 bg-panel2 text-dim hover:border-core/40 hover:text-ice"
          }`}
        >
          <Icon.Wave className="h-4 w-4" />
          <span className="display hidden text-[9px] tracking-[0.24em] sm:inline">{voiceEnabled ? "VOICE ON" : "VOICE OFF"}</span>
        </button>

        <button
          onClick={onShowOps}
          title="Operations deck"
          className="flex h-9 w-9 items-center justify-center rounded border border-line2/70 bg-panel2 text-dim transition-all hover:border-glow/50 hover:text-glow active:translate-y-px lg:hidden"
        >
          <Icon.Gear className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

/* ---------------------------- status bar --------------------------- */

export function StatusBar({
  sessionId,
  events,
  subsystems,
}: {
  sessionId: string;
  events: EventEntry[];
  subsystems: SubsystemStatus[];
}) {
  const lastRouting = [...events].reverse().find((e) => e.type === "ROUTING");
  const lastError = [...events].reverse().find((e) => e.severity === "error" || e.severity === "warn");

  return (
    <footer className="flex h-7 flex-none items-center gap-4 overflow-hidden border-t border-line/70 bg-deep/90 px-4 font-mono text-[9.5px] tracking-wider text-faint">
      <span className="flex items-center gap-1.5">
        <span className="led led-on" style={{ width: 5, height: 5 }} />
        KERNEL STABLE
      </span>
      <span className="hidden sm:inline">SESSION {sessionId}</span>
      {lastRouting && (
        <span className="hidden truncate text-glow/80 md:inline">
          ROUTE: {lastRouting.detail}
        </span>
      )}
      {lastError && lastRouting === undefined && (
        <span className="hidden truncate text-amber/80 md:inline">{lastError.detail.slice(0, 70)}</span>
      )}
      <span className="ml-auto flex items-center gap-3">
        {subsystems.slice(0, 4).map((s) => (
          <span key={s.id} className="flex items-center gap-1" title={`${s.label} — ${s.detail}`}>
            <span
              className={`led ${s.state === "online" ? "led-on" : s.state === "degraded" ? "led-warn" : s.state === "offline" ? "led-err" : "led-off"}`}
              style={{ width: 5, height: 5 }}
            />
            {s.id.toUpperCase().slice(0, 6)}
          </span>
        ))}
        <span className="text-dim">ULTRON v3.2.0</span>
      </span>
    </footer>
  );
}

/* ---------------------------- boot overlay -------------------------- */

const BOOT_LINES = [
  "ULTRON KERNEL v3.2.0 — COLD START",
  "CONFIGURATION ............ LOADED",
  "TOOL REGISTRY ............ 11 TOOLS ARMED",
  "SAFETY GATE .............. ENFORCED",
  "CONFIRMATION BROKER ...... ARMED",
  "MEMORY CORE .............. ONLINE · 8 CATEGORIES",
  "TASK AUTOMATION .......... ONLINE",
  "SPEECH INTERFACE ......... PROBED",
  "GEMINI PRIMARY ........... STANDING BY",
  "GROK REASONING ........... STANDING BY",
  "ORCHESTRATOR ............. READY",
];

export function BootOverlay() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const f = setTimeout(() => setFading(true), 2050);
    const g = setTimeout(() => setVisible(false), 2500);
    return () => {
      clearTimeout(f);
      clearTimeout(g);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-abyss transition-opacity duration-500 ${fading ? "opacity-0" : "opacity-100"}`}
    >
      <div className="ultron-bg-grid absolute inset-0" />
      <div className="relative flex flex-col items-center">
        <div className="display text-3xl font-extrabold tracking-[0.5em] text-ice text-glow-core">ULTRON</div>
        <div className="display mt-2 text-[9px] tracking-[0.4em] text-faint">PERSONAL AI OPERATING SYSTEM</div>

        <div className="mt-8 w-[340px] max-w-[86vw] space-y-1.5 font-mono text-[10px] tracking-wider">
          {BOOT_LINES.map((l, i) => (
            <div key={l} className="boot-line flex items-center gap-2 text-dim" style={{ animationDelay: `${i * 130}ms` }}>
              <span className="led led-on" style={{ width: 4, height: 4, animationDelay: `${i * 130}ms` }} />
              {l}
            </div>
          ))}
        </div>

        <div className="mt-8 h-[2px] w-[340px] max-w-[86vw] overflow-hidden rounded bg-line/60">
          <div className="boot-bar h-full bg-core shadow-[0_0_12px_rgba(55,226,213,0.8)]" />
        </div>
        <div className="display mt-3 text-[8px] tracking-[0.34em] text-faint">ONE ORCHESTRATOR · ONE ASSISTANT</div>
      </div>
    </div>
  );
}
