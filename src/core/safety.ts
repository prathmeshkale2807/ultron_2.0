/* ============================================================
   ULTRON Safety Engine
   Pipeline: Intent → authorisation → sensitivity classification
   → SafetyGate → ConfirmationBroker (if required) → execute
   → audit. Voice can never bypass this; LLM output is untrusted
   input, schemas and risk policy are enforced here.
   ============================================================ */

import { emitEvent, uid } from "./eventBus";
import type { AuditEntry, RiskLevel, Settings } from "./types";
import { RISK_ORDER } from "./types";

export interface GateVerdict {
  allowed: boolean;
  needsConfirmation: boolean;
  reason: string;
}

export class SafetyGate {
  evaluate(risk: RiskLevel, settings: Settings, validationOk: boolean, validationErrors: string[]): GateVerdict {
    if (!validationOk) {
      return {
        allowed: false,
        needsConfirmation: false,
        reason: `Schema validation failed — ${validationErrors.join(" ")}`,
      };
    }
    const threshold = settings.confirmRisk;
    const needsConfirmation = RISK_ORDER[risk] >= RISK_ORDER[threshold];
    return {
      allowed: true,
      needsConfirmation,
      reason: needsConfirmation
        ? `Risk ${risk} meets confirmation policy (≥ ${threshold}).`
        : `Risk ${risk} is below the confirmation threshold (${threshold}).`,
    };
  }
}

export interface PendingConfirmation {
  token: string;
  tool: string;
  toolLabel: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  promptText: string;
  promptSpeech: string;
  createdAt: number;
}

const CONFIRM_WORDS = /^(yes|yeah|yep|yup|proceed|confirm|approved?|do it|go ahead|go on|execute|sure|okay|ok|affirmative|chalti hai|haan|karo)\b/i;
const DENY_WORDS = /^(no|nope|nah|cancel|abort|stop|don'?t|do not|deny|reject|negative|nahi|mat karo)\b/i;

export class ConfirmationBroker {
  pending: PendingConfirmation | null = null;

  request(input: Omit<PendingConfirmation, "token" | "createdAt">): PendingConfirmation {
    const item: PendingConfirmation = { ...input, token: uid("cfm"), createdAt: Date.now() };
    this.pending = item;
    emitEvent("CONFIRMATION_REQUIRED", "safety", `${item.tool} [${item.risk}] awaits approval — ${item.promptText}`);
    return item;
  }

  /* Natural-language resolution: voice "Yes." / "No." only mean
     something while a confirmation context is active. */
  interpret(text: string): "approve" | "deny" | null {
    const t = text.trim().toLowerCase();
    if (CONFIRM_WORDS.test(t)) return "approve";
    if (DENY_WORDS.test(t)) return "deny";
    return null;
  }

  resolve(approved: boolean, by: "voice" | "ui" | "timeout"): PendingConfirmation | null {
    const item = this.pending;
    this.pending = null;
    if (item) {
      emitEvent(
        "CONFIRMATION_RESOLVED",
        "safety",
        `${item.tool} [${item.risk}] ${approved ? "APPROVED" : "DENIED"} by ${by}`,
        approved ? "info" : "warn"
      );
    }
    return item;
  }

  cancelStale(maxAgeMs: number): void {
    if (this.pending && Date.now() - this.pending.createdAt > maxAgeMs) {
      emitEvent("CONFIRMATION_RESOLVED", "safety", `${this.pending.tool} confirmation expired`, "warn");
      this.pending = null;
    }
  }
}

/* ------------------------- audit log ------------------------ */

const AUDIT_KEY = "ultron.audit.v2";
const MAX_AUDIT = 200;

export class AuditLogger {
  private entries: AuditEntry[] = [];
  private onChange: (() => void) | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(AUDIT_KEY);
      if (raw) this.entries = JSON.parse(raw) as AuditEntry[];
    } catch {
      this.entries = [];
    }
  }

  subscribe(fn: () => void): () => void {
    this.onChange = fn;
    return () => {
      this.onChange = null;
    };
  }

  log(e: Omit<AuditEntry, "id" | "ts">): AuditEntry {
    const entry: AuditEntry = { ...e, id: uid("aud"), ts: Date.now() };
    this.entries.push(entry);
    if (this.entries.length > MAX_AUDIT) this.entries.splice(0, this.entries.length - MAX_AUDIT);
    try {
      localStorage.setItem(AUDIT_KEY, JSON.stringify(this.entries));
    } catch {
      /* non-fatal */
    }
    this.onChange?.();
    return entry;
  }

  list(): AuditEntry[] {
    return [...this.entries].reverse();
  }

  clear(): void {
    this.entries = [];
    try {
      localStorage.removeItem(AUDIT_KEY);
    } catch {
      /* non-fatal */
    }
    this.onChange?.();
  }
}
