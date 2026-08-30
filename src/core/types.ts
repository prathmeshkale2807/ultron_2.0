/* ============================================================
   ULTRON — shared type contracts
   One vocabulary for orchestrator, providers, tools, safety,
   voice, memory, tasks and the UI. No subsystem invents its own.
   ============================================================ */

export type Severity = "debug" | "info" | "warn" | "error";

export type UltronEventType =
  | "BOOT"
  | "STATE"
  | "WAKE_DETECTED"
  | "LISTENING_STARTED"
  | "TRANSCRIPTION_READY"
  | "THINKING_STARTED"
  | "REASONING_STARTED"
  | "ROUTING"
  | "TOOL_STARTED"
  | "TOOL_COMPLETED"
  | "CONFIRMATION_REQUIRED"
  | "CONFIRMATION_RESOLVED"
  | "SPEAKING_STARTED"
  | "SPEAKING_STOPPED"
  | "INTERRUPTED"
  | "MEMORY_WRITE"
  | "TASK_CREATED"
  | "TASK_COMPLETED"
  | "PROVIDER_HEALTH"
  | "ERROR";

export interface EventEntry {
  id: string;
  ts: number;
  type: UltronEventType;
  component: string;
  detail: string;
  severity: Severity;
  latencyMs?: number;
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export type AuditDecision =
  | "ALLOWED"
  | "CONFIRMED"
  | "DENIED"
  | "BLOCKED"
  | "TIMEOUT"
  | "ERROR";

export interface AuditEntry {
  id: string;
  ts: number;
  sessionId: string;
  tool: string;
  risk: RiskLevel;
  decision: AuditDecision;
  detail: string;
  latencyMs: number;
}

export interface ProviderHealth {
  status: "unconfigured" | "unknown" | "online" | "degraded" | "offline";
  latencyMs?: number;
  lastCheck?: number;
  note?: string;
}

export type ProviderId = "gemini" | "grok" | "elevenlabs";

export interface Settings {
  /* cognition */
  geminiApiKey: string;
  geminiModel: string;
  grokApiKey: string;
  grokModel: string;
  grokEnabled: boolean;
  complexityThreshold: number;
  requestTimeoutMs: number;
  /* voice */
  voiceEnabled: boolean;
  wakeEnabled: boolean;
  wakeWord: string;
  speakResponses: boolean;
  standbySeconds: number;
  ttsProvider: "auto" | "elevenlabs" | "browser";
  elevenApiKey: string;
  elevenVoiceId: string;
  elevenFemaleVoiceId: string;
  elevenHindiVoiceId: string;
  sttLang: string;
  /* security */
  confirmRisk: RiskLevel;
  /* interface */
  language: "en" | "hi";
}

export interface ToolArgSpec {
  type: "string" | "number";
  required: boolean;
  description: string;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  speech: string;
  link?: { url: string; label: string };
  data?: unknown;
}

export interface ToolSpec {
  name: string;
  label: string;
  description: string;
  category: string;
  risk: RiskLevel;
  args: Record<string, ToolArgSpec>;
  timeoutMs: number;
}

export type MemoryCategory =
  | "SHORT_TERM"
  | "CONVERSATION"
  | "TASK"
  | "USER_PREFERENCE"
  | "FACT"
  | "PROJECT"
  | "DEVICE"
  | "ROUTINE";

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  key: string;
  content: string;
  ts: number;
  source: "user" | "tool" | "inference";
  pinned?: boolean;
}

export interface TaskItem {
  id: string;
  label: string;
  dueAt: number;
  createdAt: number;
  done: boolean;
}

export interface MessageMeta {
  routing?: string;
  tool?: string;
  risk?: RiskLevel;
  latencyMs?: number;
  reasoningSummary?: string;
  confirmToken?: string;
  link?: { url: string; label: string };
  spoken?: boolean;
  error?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "ultron";
  content: string;
  ts: number;
  meta?: MessageMeta;
}

export type VoiceState =
  | "OFF"
  | "IDLE"
  | "WAKE_ACK"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "STANDBY";

export type MicStatus = "unknown" | "available" | "denied" | "unsupported";

export interface SubsystemStatus {
  id: string;
  label: string;
  state: "online" | "degraded" | "offline" | "standby";
  detail: string;
}

export interface RoutingDecision {
  path: "local-tool" | "gemini" | "gemini+grok" | "grok-fallback" | "offline";
  score: number;
  reasons: string[];
}

export interface AssistantTurn {
  content: string;
  speech: string;
  meta: MessageMeta;
}
