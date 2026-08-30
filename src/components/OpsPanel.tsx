import { useEffect, useState, type ReactNode } from "react";
import type { UltronApi } from "../hooks/useUltron";
import type { EventEntry, MemoryCategory, Settings } from "../core/types";
import { MEMORY_CATEGORIES } from "../core/memory";
import { fmtStamp } from "../core/eventBus";
import { maskKey } from "../core/config";

export type OpsTab = "events" | "audit" | "memory" | "tools" | "tasks" | "config";

const TABS: { id: OpsTab; label: string }[] = [
  { id: "events", label: "EVENTS" },
  { id: "audit", label: "AUDIT" },
  { id: "memory", label: "MEMORY" },
  { id: "tools", label: "TOOLS" },
  { id: "tasks", label: "TASKS" },
  { id: "config", label: "CONFIG" },
];

export function OpsPanel({
  api,
  tab,
  onTab,
  onClose,
}: {
  api: UltronApi;
  tab: OpsTab;
  onTab: (t: OpsTab) => void;
  onClose: () => void;
}) {
  return (
    <div className="panel hud-corner flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-1 border-b border-line/70 px-2 py-2">
        <span className="panel-title ml-2 mr-2 hidden xl:inline">OPS</span>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            className={`display rounded px-2 py-1.5 text-[8.5px] tracking-[0.18em] transition-all ${
              tab === t.id
                ? "bg-core/10 text-core shadow-[0_0_12px_rgba(55,226,213,0.12)]"
                : "text-faint hover:bg-raise/70 hover:text-dim"
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={onClose}
          className="ml-auto rounded border border-line2/60 px-2 py-1 font-mono text-[10px] text-dim hover:text-ice lg:hidden"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "events" && <EventsTab events={api.events} />}
        {tab === "audit" && <AuditTab api={api} />}
        {tab === "memory" && <MemoryTab api={api} />}
        {tab === "tools" && <ToolsTab api={api} />}
        {tab === "tasks" && <TasksTab api={api} />}
        {tab === "config" && <ConfigTab api={api} />}
      </div>
    </div>
  );
}

/* ----------------------------- events ----------------------------- */

const TYPE_COLOR: Record<string, string> = {
  ROUTING: "text-glow",
  REASONING_STARTED: "text-glow",
  THINKING_STARTED: "text-glow",
  PROVIDER_HEALTH: "text-glow",
  TOOL_STARTED: "text-core",
  TOOL_COMPLETED: "text-core",
  MEMORY_WRITE: "text-ice",
  TASK_CREATED: "text-lime",
  TASK_COMPLETED: "text-lime",
  CONFIRMATION_REQUIRED: "text-amber",
  CONFIRMATION_RESOLVED: "text-amber",
  WAKE_DETECTED: "text-lime",
  LISTENING_STARTED: "text-lime",
  TRANSCRIPTION_READY: "text-lime",
  SPEAKING_STARTED: "text-lime",
  SPEAKING_STOPPED: "text-lime",
  INTERRUPTED: "text-amber",
  ERROR: "text-danger",
  BOOT: "text-faint",
  STATE: "text-dim",
};

function EventsTab({ events }: { events: EventEntry[] }) {
  const [filter, setFilter] = useState("ALL");
  const match = (e: EventEntry) => {
    switch (filter) {
      case "ERRORS":
        return e.severity === "warn" || e.severity === "error";
      case "COGNITION":
        return ["THINKING_STARTED", "REASONING_STARTED", "ROUTING", "PROVIDER_HEALTH"].includes(e.type);
      case "VOICE":
        return ["WAKE_DETECTED", "LISTENING_STARTED", "TRANSCRIPTION_READY", "SPEAKING_STARTED", "SPEAKING_STOPPED", "INTERRUPTED", "STATE"].includes(e.type);
      case "TOOLS":
        return ["TOOL_STARTED", "TOOL_COMPLETED", "CONFIRMATION_REQUIRED", "CONFIRMATION_RESOLVED", "MEMORY_WRITE", "TASK_CREATED", "TASK_COMPLETED"].includes(e.type);
      default:
        return true;
    }
  };
  const shown = [...events].reverse().filter(match).slice(0, 120);

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center gap-1.5">
        {["ALL", "ERRORS", "COGNITION", "VOICE", "TOOLS"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`display rounded border px-2 py-1 text-[8px] tracking-[0.16em] transition-all ${
              filter === f ? "border-core/50 bg-core/10 text-core" : "border-line2/60 text-faint hover:text-dim"
            }`}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto font-mono text-[9px] text-faint">{shown.length}</span>
      </div>
      <div className="space-y-1">
        {shown.length === 0 && <div className="py-6 text-center font-mono text-[10px] text-faint">No events in this channel yet.</div>}
        {shown.map((e) => (
          <div key={e.id} className="slide-in-r rounded border border-line/50 bg-deep/60 px-2.5 py-1.5 hover:border-line2/80 transition-colors">
            <div className="flex items-center gap-2">
              <span className={`font-mono text-[8.5px] ${TYPE_COLOR[e.type] ?? "text-dim"}`}>{e.type}</span>
              <span className="font-mono text-[8px] text-faint">{e.component}</span>
              {typeof e.latencyMs === "number" && <span className="font-mono text-[8px] text-glow/70">{e.latencyMs}ms</span>}
              <span className="ml-auto font-mono text-[8px] text-faint">{fmtStamp(e.ts)}</span>
            </div>
            <div className={`mt-0.5 font-mono text-[9.5px] leading-snug ${e.severity === "error" ? "text-danger/90" : e.severity === "warn" ? "text-amber/90" : "text-dim"}`}>
              {e.detail}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- audit ------------------------------ */

const DECISION_STYLE: Record<string, string> = {
  ALLOWED: "text-core border-core/40 bg-core/5",
  CONFIRMED: "text-lime border-lime/40 bg-lime/5",
  DENIED: "text-amber border-amber/40 bg-amber/5",
  BLOCKED: "text-danger border-danger/40 bg-danger/5",
  TIMEOUT: "text-amber border-amber/40 bg-amber/5",
  ERROR: "text-danger border-danger/40 bg-danger/5",
};

function AuditTab({ api }: { api: UltronApi }) {
  const [armClear, setArmClear] = useState(false);
  const rows = api.auditList;
  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[9px] text-faint">EVERY EXECUTION PATH IS LOGGED · {rows.length} ENTRIES</span>
        <button
          onClick={() => {
            if (armClear) {
              api.clearAudit();
              setArmClear(false);
            } else setArmClear(true);
          }}
          onBlur={() => setArmClear(false)}
          className={`display rounded border px-2 py-1 text-[8px] tracking-[0.16em] transition-all ${
            armClear ? "border-danger/60 bg-danger/10 text-danger" : "border-line2/60 text-faint hover:text-dim"
          }`}
        >
          {armClear ? "CONFIRM?" : "CLEAR"}
        </button>
      </div>
      <div className="space-y-1">
        {rows.length === 0 && (
          <div className="py-8 text-center font-mono text-[10px] leading-relaxed text-faint">
            No executions yet.
            <br />
            Tool runs, confirmations and blocks land here.
          </div>
        )}
        {rows.map((a) => (
          <div key={a.id} className="slide-in-r rounded border border-line/50 bg-deep/60 px-2.5 py-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] text-ice/85">{a.tool}</span>
              <span className={`display rounded-sm border px-1.5 py-0.5 text-[7.5px] tracking-[0.16em] ${DECISION_STYLE[a.decision]}`}>
                {a.decision}
              </span>
              <span className="display rounded-sm border border-line2/60 px-1.5 py-0.5 text-[7.5px] tracking-[0.16em] text-dim">
                {a.risk}
              </span>
              <span className="ml-auto font-mono text-[8px] text-faint">{a.latencyMs}ms</span>
            </div>
            <div className="mt-0.5 font-mono text-[9px] leading-snug text-dim">{a.detail}</div>
            <div className="mt-0.5 font-mono text-[8px] text-faint">
              {fmtStamp(a.ts)} · session {a.sessionId.slice(-6)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- memory ----------------------------- */

function MemoryTab({ api }: { api: UltronApi }) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<MemoryCategory | "ALL">("ALL");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ key: "", content: "" });
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState({ key: "", content: "", category: "FACT" as MemoryCategory });

  const hits = api.memory.search(query, cat === "ALL" ? undefined : cat);

  return (
    <div className="p-3">
      <div className="mb-2 flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memory…"
          className="min-w-0 flex-1 rounded border border-line2/60 bg-deep px-2.5 py-1.5 font-mono text-[10px] text-ice placeholder:text-faint outline-none focus:border-core/50"
        />
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value as MemoryCategory | "ALL")}
          className="rounded border border-line2/60 bg-deep px-1.5 py-1.5 font-mono text-[9px] text-dim outline-none focus:border-core/50"
        >
          <option value="ALL">ALL</option>
          {MEMORY_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <button
        onClick={() => setAdding((v) => !v)}
        className="display mb-2 w-full rounded border border-line2/60 bg-panel2 py-1.5 text-[8.5px] tracking-[0.2em] text-dim transition-all hover:border-core/40 hover:text-core"
      >
        {adding ? "CLOSE" : "+ STORE MEMORY MANUALLY"}
      </button>
      {adding && (
        <div className="fade-up mb-2 space-y-1.5 rounded border border-line/70 bg-deep/70 p-2">
          <input
            value={addDraft.key}
            onChange={(e) => setAddDraft({ ...addDraft, key: e.target.value })}
            placeholder="Label (e.g. coffee preference)"
            className="w-full rounded border border-line2/60 bg-panel px-2 py-1.5 font-mono text-[10px] text-ice placeholder:text-faint outline-none focus:border-core/50"
          />
          <textarea
            value={addDraft.content}
            onChange={(e) => setAddDraft({ ...addDraft, content: e.target.value })}
            placeholder="Content"
            rows={2}
            className="w-full resize-none rounded border border-line2/60 bg-panel px-2 py-1.5 font-mono text-[10px] text-ice placeholder:text-faint outline-none focus:border-core/50"
          />
          <div className="flex items-center gap-1.5">
            <select
              value={addDraft.category}
              onChange={(e) => setAddDraft({ ...addDraft, category: e.target.value as MemoryCategory })}
              className="rounded border border-line2/60 bg-panel px-1.5 py-1.5 font-mono text-[9px] text-dim outline-none"
            >
              {MEMORY_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              onClick={() => {
                if (addDraft.key.trim() && addDraft.content.trim()) {
                  api.memory.save(addDraft.category, addDraft.key, addDraft.content, "user");
                  setAddDraft({ key: "", content: "", category: "FACT" });
                  setAdding(false);
                }
              }}
              className="display ml-auto rounded border border-core/50 bg-core/10 px-3 py-1.5 text-[8.5px] tracking-[0.2em] text-core hover:bg-core/20"
            >
              SAVE
            </button>
          </div>
        </div>
      )}

      <div className="font-mono text-[9px] text-faint">{hits.length} ENTRIES · EDITABLE · DELETABLE · AUDITED</div>
      <div className="mt-1.5 space-y-1.5">
        {hits.length === 0 && (
          <div className="py-8 text-center font-mono text-[10px] leading-relaxed text-faint">
            Memory core is empty.
            <br />
            Say “remember that…” and I'll store it here.
          </div>
        )}
        {hits.map((m) => (
          <div key={m.id} className="group rounded border border-line/50 bg-deep/60 px-2.5 py-2 transition-colors hover:border-line2/80">
            {editingId === m.id ? (
              <div className="space-y-1.5">
                <input
                  value={editDraft.key}
                  onChange={(e) => setEditDraft({ ...editDraft, key: e.target.value })}
                  className="w-full rounded border border-line2/60 bg-panel px-2 py-1 font-mono text-[10px] text-ice outline-none focus:border-core/50"
                />
                <textarea
                  value={editDraft.content}
                  onChange={(e) => setEditDraft({ ...editDraft, content: e.target.value })}
                  rows={2}
                  className="w-full resize-none rounded border border-line2/60 bg-panel px-2 py-1 font-mono text-[10px] text-ice outline-none focus:border-core/50"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={() => {
                      api.memory.update(m.id, editDraft);
                      setEditingId(null);
                    }}
                    className="display rounded border border-core/50 bg-core/10 px-2.5 py-1 text-[8px] tracking-[0.18em] text-core"
                  >
                    SAVE
                  </button>
                  <button onClick={() => setEditingId(null)} className="display rounded border border-line2/60 px-2.5 py-1 text-[8px] tracking-[0.18em] text-dim">
                    CANCEL
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-ice/90">{m.key}</span>
                  <span className="display rounded-sm border border-glow/30 bg-glow/5 px-1.5 py-0.5 text-[7.5px] tracking-[0.14em] text-glow/90">
                    {m.category}
                  </span>
                  <span className="ml-auto font-mono text-[8px] text-faint">{m.source}</span>
                </div>
                <div className="mt-1 font-mono text-[9.5px] leading-snug text-dim">{m.content}</div>
                <div className="mt-1.5 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => {
                      setEditingId(m.id);
                      setEditDraft({ key: m.key, content: m.content });
                    }}
                    className="font-mono text-[8.5px] text-glow hover:text-ice"
                  >
                    EDIT
                  </button>
                  <button onClick={() => api.memory.remove(m.id)} className="font-mono text-[8.5px] text-danger/80 hover:text-danger">
                    DELETE
                  </button>
                  <span className="ml-auto font-mono text-[8px] text-faint">{new Date(m.ts).toLocaleString("en-GB")}</span>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ tools ------------------------------ */

function ToolsTab({ api }: { api: UltronApi }) {
  const RISK: Record<string, string> = {
    LOW: "text-core border-core/40",
    MEDIUM: "text-glow border-glow/40",
    HIGH: "text-amber border-amber/40",
    CRITICAL: "text-danger border-danger/40",
  };
  return (
    <div className="p-3">
      <div className="mb-2 font-mono text-[9px] leading-relaxed text-faint">
        ONE REGISTRY — UI, VOICE AND AUTOMATION ALL EXECUTE THROUGH THIS SURFACE. SCHEMA-VALIDATED, RISK-CLASSIFIED, AUDITED.
      </div>
      <div className="space-y-1.5">
        {api.tools.map((t) => (
          <div key={t.name} className="rounded border border-line/50 bg-deep/60 px-2.5 py-2 transition-colors hover:border-line2/80">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-core">{t.name}</span>
              <span className={`display rounded-sm border px-1.5 py-0.5 text-[7.5px] tracking-[0.14em] ${RISK[t.risk]}`}>{t.risk}</span>
              <span className="display rounded-sm border border-line2/60 px-1.5 py-0.5 text-[7.5px] tracking-[0.14em] text-faint">
                {t.category.toUpperCase()}
              </span>
              <span className="ml-auto font-mono text-[8px] text-faint">{t.timeoutMs}ms</span>
            </div>
            <div className="mt-1 text-[11px] font-medium text-ice/85">{t.label}</div>
            <div className="mt-0.5 font-mono text-[9px] leading-snug text-dim">{t.description}</div>
            {Object.keys(t.args).length > 0 && (
              <div className="mt-1 font-mono text-[8.5px] text-faint">
                args: {Object.entries(t.args).map(([k, v]) => `${k}${v.required ? "" : "?"}:${v.type}`).join(" · ")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ tasks ------------------------------ */

function TasksTab({ api }: { api: UltronApi }) {
  const [label, setLabel] = useState("");
  const [minutes, setMinutes] = useState("5");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const tasks = api.tasks.list();

  const fmtCountdown = (dueAt: number, done: boolean) => {
    if (done) return `fired ${new Date(dueAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    const diff = dueAt - now;
    if (diff <= 0) return "due now";
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (m >= 60) return `in ${Math.floor(m / 60)}h ${m % 60}m`;
    return m > 0 ? `in ${m}m ${s}s` : `in ${s}s`;
  };

  return (
    <div className="p-3">
      <div className="mb-2 flex gap-1.5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Remind me to…"
          className="min-w-0 flex-1 rounded border border-line2/60 bg-deep px-2.5 py-1.5 font-mono text-[10px] text-ice placeholder:text-faint outline-none focus:border-core/50"
        />
        <input
          value={minutes}
          onChange={(e) => setMinutes(e.target.value.replace(/[^\d.]/g, ""))}
          className="w-14 rounded border border-line2/60 bg-deep px-2 py-1.5 text-center font-mono text-[10px] text-ice outline-none focus:border-core/50"
          title="Minutes"
        />
        <button
          onClick={() => {
            const m = parseFloat(minutes || "5");
            if (label.trim() && m > 0) {
              api.tasks.add(label.trim(), Date.now() + m * 60000);
              setLabel("");
            }
          }}
          className="display rounded border border-core/50 bg-core/10 px-3 text-[8.5px] tracking-[0.18em] text-core transition-all hover:bg-core/20"
        >
          ADD
        </button>
      </div>

      <div className="space-y-1.5">
        {tasks.length === 0 && (
          <div className="py-8 text-center font-mono text-[10px] leading-relaxed text-faint">
            No scheduled tasks.
            <br />
            “Remind me in 5 minutes to stretch” — tasks survive restarts.
          </div>
        )}
        {tasks.map((t) => (
          <div key={t.id} className={`rounded border px-2.5 py-2 transition-colors ${t.done ? "border-line/40 bg-deep/40 opacity-60" : "border-line/50 bg-deep/60 hover:border-line2/80"}`}>
            <div className="flex items-center gap-2">
              <span className={`led ${t.done ? "led-off" : "led-on led-blink"}`} style={{ width: 6, height: 6 }} />
              <span className={`text-[11.5px] ${t.done ? "text-dim line-through" : "text-ice/90"}`}>{t.label}</span>
              <button onClick={() => api.tasks.remove(t.id)} className="ml-auto font-mono text-[8.5px] text-faint hover:text-danger">
                ✕
              </button>
            </div>
            <div className="ml-[14px] mt-0.5 font-mono text-[9px] text-faint">
              {fmtCountdown(t.dueAt, t.done)} · due {new Date(t.dueAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ config ----------------------------- */

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-[9px] tracking-[0.14em] text-dim">{label}</span>
        {hint && <span className="font-mono text-[8px] text-faint">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded border border-line2/60 bg-deep px-2.5 py-1.5 font-mono text-[10.5px] text-ice placeholder:text-faint outline-none transition-colors focus:border-core/60";

function ConfigTab({ api }: { api: UltronApi }) {
  const [draft, setDraft] = useState<Settings>(api.settings);
  useEffect(() => setDraft(api.settings), [api.settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(api.settings);
  const [testOut, setTestOut] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [armWipe, setArmWipe] = useState(false);

  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));

  const runTest = async (which: "gemini" | "grok" | "ollama" | "elevenlabs") => {
    setTesting(which);
    setTestOut((o) => ({ ...o, [which]: "" }));
    const out = await api.testProvider(which);
    setTestOut((o) => ({ ...o, [which]: out }));
    setTesting(null);
  };

  return (
    <div className="space-y-4 p-3">
      <div>
        <div className="panel-title mb-2 text-core/80">Cognition</div>
        <div className="space-y-2.5">
          <Field label="GEMINI_API_KEY" hint={maskKey(draft.geminiApiKey)}>
            <input type="password" value={draft.geminiApiKey} onChange={(e) => set({ geminiApiKey: e.target.value })} placeholder="AIza…" className={inputCls} />
          </Field>
          <Field label="GEMINI_MODEL">
            <input value={draft.geminiModel} onChange={(e) => set({ geminiModel: e.target.value })} className={inputCls} />
          </Field>
          <div className="flex items-center gap-2">
            <button onClick={() => runTest("gemini")} disabled={testing !== null} className="display rounded border border-glow/50 bg-glow/5 px-2.5 py-1.5 text-[8px] tracking-[0.18em] text-glow transition-all hover:bg-glow/15 disabled:opacity-40">
              {testing === "gemini" ? "TESTING…" : "TEST LINK"}
            </button>
            <span className="font-mono text-[8.5px] leading-snug text-dim">{testOut.gemini}</span>
          </div>

          <Field label="GROK_API_KEY" hint={maskKey(draft.grokApiKey)}>
            <input type="password" value={draft.grokApiKey} onChange={(e) => set({ grokApiKey: e.target.value })} placeholder="xai-…" className={inputCls} />
          </Field>
          <Field label="GROK_MODEL">
            <input value={draft.grokModel} onChange={(e) => set({ grokModel: e.target.value })} className={inputCls} />
          </Field>
          <div className="flex items-center gap-2">
            <button onClick={() => runTest("grok")} disabled={testing !== null} className="display rounded border border-glow/50 bg-glow/5 px-2.5 py-1.5 text-[8px] tracking-[0.18em] text-glow transition-all hover:bg-glow/15 disabled:opacity-40">
              {testing === "grok" ? "TESTING…" : "TEST LINK"}
            </button>
            <span className="font-mono text-[8.5px] leading-snug text-dim">{testOut.grok}</span>
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={draft.grokEnabled} onChange={(e) => set({ grokEnabled: e.target.checked })} className="accent-[#37e2d5]" />
            <span className="font-mono text-[9.5px] text-dim">Grok reasoning engine enabled (secondary only — never replaces Gemini)</span>
          </label>

          <Field label={`REASONING THRESHOLD — ${draft.complexityThreshold}`} hint="score that engages Grok">
            <input type="range" min={2} max={12} value={draft.complexityThreshold} onChange={(e) => set({ complexityThreshold: Number(e.target.value) })} className="w-full accent-[#37e2d5]" />
          </Field>
          <Field label="REQUEST TIMEOUT (MS)">
            <input type="number" min={5000} max={60000} step={1000} value={draft.requestTimeoutMs} onChange={(e) => set({ requestTimeoutMs: Number(e.target.value) || 20000 })} className={inputCls} />
          </Field>
        </div>
      </div>

      <div>
        <div className="panel-title mb-2 text-lime/80">Local Brain · Ollama</div>
        <div className="space-y-2.5">
          <div className="rounded border border-lime/25 bg-lime/5 px-2.5 py-2 font-mono text-[9px] leading-relaxed text-lime/80">
            KEY-FREE COGNITION. Run <span className="text-lime">ollama serve</span> locally and ULTRON thinks with it
            automatically — used as primary when no cloud keys exist, and as the last fallback otherwise.
          </div>
          <Field label="OLLAMA_BASE_URL" hint="local instance">
            <input value={draft.ollamaBaseUrl} onChange={(e) => set({ ollamaBaseUrl: e.target.value })} placeholder="http://localhost:11434" className={inputCls} />
          </Field>
          <Field label="OLLAMA_MODEL">
            <input value={draft.ollamaModel} onChange={(e) => set({ ollamaModel: e.target.value })} placeholder="llama3.2" className={inputCls} />
          </Field>
          <div className="flex items-center gap-2">
            <button onClick={() => runTest("ollama")} disabled={testing !== null} className="display rounded border border-lime/50 bg-lime/5 px-2.5 py-1.5 text-[8px] tracking-[0.18em] text-lime transition-all hover:bg-lime/15 disabled:opacity-40">
              {testing === "ollama" ? "TESTING…" : "TEST LINK"}
            </button>
            <span className="font-mono text-[8.5px] leading-snug text-dim">{testOut.ollama}</span>
          </div>
        </div>
      </div>

      <div>
        <div className="panel-title mb-2 text-amber/80">Security</div>
        <Field label="CONFIRMATION THRESHOLD" hint="tools at/above this risk ask first">
          <select value={draft.confirmRisk} onChange={(e) => set({ confirmRisk: e.target.value as Settings["confirmRisk"] })} className={inputCls}>
            <option value="LOW">LOW — confirm almost everything</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH — default policy</option>
            <option value="CRITICAL">CRITICAL — only destructive actions</option>
          </select>
        </Field>
      </div>

      <div>
        <div className="panel-title mb-2 text-lime/80">Voice</div>
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={draft.voiceEnabled} onChange={(e) => set({ voiceEnabled: e.target.checked })} className="accent-[#37e2d5]" />
              <span className="font-mono text-[9.5px] text-dim">VOICE INTERFACE</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={draft.wakeEnabled} onChange={(e) => set({ wakeEnabled: e.target.checked })} className="accent-[#37e2d5]" />
              <span className="font-mono text-[9.5px] text-dim">WAKE WORD</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={draft.speakResponses} onChange={(e) => set({ speakResponses: e.target.checked })} className="accent-[#37e2d5]" />
              <span className="font-mono text-[9.5px] text-dim">SPEAK REPLIES</span>
            </label>
            <Field label="STANDBY AFTER (S)">
              <input type="number" min={5} max={120} value={draft.standbySeconds} onChange={(e) => set({ standbySeconds: Number(e.target.value) || 18 })} className={inputCls} />
            </Field>
          </div>
          <Field label="WAKE PHRASE">
            <input value={draft.wakeWord} onChange={(e) => set({ wakeWord: e.target.value })} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="STT LANGUAGE">
              <select value={draft.sttLang} onChange={(e) => set({ sttLang: e.target.value })} className={inputCls}>
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="en-IN">English (IN)</option>
                <option value="hi-IN">हिन्दी</option>
              </select>
            </Field>
            <Field label="REPLY LANGUAGE">
              <select value={draft.language} onChange={(e) => set({ language: e.target.value as Settings["language"] })} className={inputCls}>
                <option value="en">English</option>
                <option value="hi">हिन्दी</option>
              </select>
            </Field>
          </div>
          <Field label="TTS PROVIDER">
            <select value={draft.ttsProvider} onChange={(e) => set({ ttsProvider: e.target.value as Settings["ttsProvider"] })} className={inputCls}>
              <option value="auto">AUTO — ElevenLabs, local fallback</option>
              <option value="elevenlabs">ELEVENLABS ONLY (falls back on failure)</option>
              <option value="browser">LOCAL BROWSER TTS</option>
            </select>
          </Field>
          <Field label="ELEVENLABS_API_KEY" hint={maskKey(draft.elevenApiKey)}>
            <input type="password" value={draft.elevenApiKey} onChange={(e) => set({ elevenApiKey: e.target.value })} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="VOICE ID">
              <input value={draft.elevenVoiceId} onChange={(e) => set({ elevenVoiceId: e.target.value })} className={inputCls} />
            </Field>
            <Field label="FEMALE VOICE ID">
              <input value={draft.elevenFemaleVoiceId} onChange={(e) => set({ elevenFemaleVoiceId: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="HINDI VOICE ID">
            <input value={draft.elevenHindiVoiceId} onChange={(e) => set({ elevenHindiVoiceId: e.target.value })} className={inputCls} />
          </Field>
          <div className="flex items-center gap-2">
            <button onClick={() => runTest("elevenlabs")} disabled={testing !== null} className="display rounded border border-glow/50 bg-glow/5 px-2.5 py-1.5 text-[8px] tracking-[0.18em] text-glow transition-all hover:bg-glow/15 disabled:opacity-40">
              {testing === "elevenlabs" ? "TESTING…" : "TEST VOICE"}
            </button>
            <span className="font-mono text-[8.5px] leading-snug text-dim">{testOut.elevenlabs}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => api.updateSettings(draft)}
          disabled={!dirty}
          className="display flex-1 rounded border border-core/60 bg-core/10 py-2.5 text-[9.5px] tracking-[0.26em] text-core transition-all hover:bg-core/20 hover:shadow-[0_0_20px_rgba(55,226,213,0.2)] active:translate-y-px disabled:opacity-30"
        >
          {dirty ? "SAVE CONFIGURATION" : "CONFIGURATION SYNCED"}
        </button>
      </div>

      <div>
        <div className="panel-title mb-2 text-danger/80">Danger Zone</div>
        <button
          onClick={() => {
            if (armWipe) {
              const n = api.memory.clearAll();
              setArmWipe(false);
              setTestOut((o) => ({ ...o, wipe: `${n} memories wiped` }));
            } else setArmWipe(true);
          }}
          onBlur={() => setArmWipe(false)}
          className={`display w-full rounded border py-2 text-[8.5px] tracking-[0.22em] transition-all ${
            armWipe ? "border-danger/70 bg-danger/15 text-danger" : "border-danger/30 text-danger/70 hover:border-danger/60 hover:text-danger"
          }`}
        >
          {armWipe ? "CLICK AGAIN TO CONFIRM FULL MEMORY WIPE" : "WIPE ALL MEMORY"}
        </button>
        {testOut.wipe && <div className="mt-1 font-mono text-[9px] text-dim">{testOut.wipe}</div>}
      </div>
    </div>
  );
}
