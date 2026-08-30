/* ============================================================
   ULTRON Event Bus + structured logger
   Single internal event system. Every subsystem publishes here;
   the UI and diagnostics subscribe. Nothing is tightly coupled.
   Log contract: timestamp, component, event, severity, latency,
   session id. Never API keys, tokens or credentials.
   ============================================================ */

import type { EventEntry, Severity, UltronEventType } from "./types";

type Listener = (e: EventEntry) => void;

const MAX_EVENTS = 240;
const store: EventEntry[] = [];
const listeners = new Set<Listener>();

let seq = 0;
export function uid(prefix = "id"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.floor(
    Math.random() * 1e6
  ).toString(36)}`;
}

export function emitEvent(
  type: UltronEventType,
  component: string,
  detail: string,
  severity: Severity = "info",
  latencyMs?: number
): EventEntry {
  const entry: EventEntry = {
    id: uid("ev"),
    ts: Date.now(),
    type,
    component,
    detail,
    severity,
    latencyMs,
  };
  store.push(entry);
  if (store.length > MAX_EVENTS) store.splice(0, store.length - MAX_EVENTS);
  listeners.forEach((l) => {
    try {
      l(entry);
    } catch {
      /* a broken subscriber must never break the bus */
    }
  });
  return entry;
}

export function onEvent(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getEvents(): EventEntry[] {
  return store;
}

/* ---------- structured logger (console + bus) ---------- */

function safeConsole(
  severity: Severity,
  component: string,
  detail: string,
  extra?: Record<string, unknown>
) {
  const line = `[${new Date().toISOString()}] [${component}] ${detail}`;
  if (severity === "error") console.error(line, extra ?? "");
  else if (severity === "warn") console.warn(line, extra ?? "");
  else console.log(line, extra ?? "");
}

export const logger = {
  info(component: string, detail: string, extra?: Record<string, unknown>) {
    safeConsole("info", component, detail, extra);
  },
  warn(component: string, detail: string, extra?: Record<string, unknown>) {
    emitEvent("ERROR", component, detail, "warn");
    safeConsole("warn", component, detail, extra);
  },
  error(component: string, detail: string, extra?: Record<string, unknown>) {
    emitEvent("ERROR", component, detail, "error");
    safeConsole("error", component, detail, extra);
  },
};

/* ---------- clock helpers ---------- */

export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export function fmtStamp(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleTimeString("en-GB", { hour12: false })}.${String(
    d.getMilliseconds()
  ).padStart(3, "0")}`;
}
