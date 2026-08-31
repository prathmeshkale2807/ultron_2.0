/* ============================================================
   ULTRON Configuration Manager
   Centralized, environment-style keys persisted locally.
   Every subsystem reads from here — no scattered magic values.
   Secrets are stored only in the browser vault and are always
   redacted before logging or display.
   ============================================================ */

import type { Settings } from "./types";

const KEY = "ultron.settings.v3";

/* The Gemini server has retired older flash/pro checkpoints.
   ULTRON migrates silently — a retired model must never strand
   the cognition link. */
export const RECOMMENDED_GEMINI_MODEL = "gemini-3.6-flash";

const RETIRED_GEMINI_MODELS = new Set([
  "gemini-2.0-flash",
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
  "gemini-1.5-pro",
  "gemini-1.0-pro",
  "gemini-pro",
]);

export function migrateGeminiModel(model: string): string {
  return RETIRED_GEMINI_MODELS.has(model) ? RECOMMENDED_GEMINI_MODEL : model;
}

export const DEFAULT_SETTINGS: Settings = {
  geminiApiKey: "",
  geminiModel: RECOMMENDED_GEMINI_MODEL,
  grokApiKey: "",
  grokModel: "grok-3-mini",
  grokEnabled: true,
  ollamaBaseUrl: "",
  ollamaModel: "llama3.2",
  complexityThreshold: 6,
  requestTimeoutMs: 20000,
  voiceEnabled: false,
  wakeEnabled: true,
  wakeWord: "hey ultron",
  speakResponses: true,
  standbySeconds: 18,
  ttsProvider: "auto",
  elevenApiKey: "",
  elevenVoiceId: "",
  elevenFemaleVoiceId: "",
  elevenHindiVoiceId: "",
  sttLang: "en-US",
  confirmRisk: "HIGH",
  language: "en",
};

export function loadSettings(): Settings {
  let s: Settings;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    s = { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    s = { ...DEFAULT_SETTINGS };
  }
  /* Silent migration of retired model names persisted by earlier installs. */
  const migrated = migrateGeminiModel(s.geminiModel);
  if (migrated !== s.geminiModel) {
    s = { ...s, geminiModel: migrated };
    saveSettings(s);
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage may be unavailable; runtime continues on defaults */
  }
}

/* Mask anything that looks like a credential before it reaches
   logs, audit entries or the screen. */
export function redact(text: string): string {
  return text
    .replace(/(AIza[0-9A-Za-z\-_]{8,})/g, "AIza••••••••")
    .replace(/(xai-[0-9A-Za-z\-_]{6,})/g, "xai-••••••••")
    .replace(/\b(sk-[0-9A-Za-z\-_]{6,})\b/g, "sk-••••••••")
    .replace(/(bearer\s+)[0-9A-Za-z\-_.~+/]+=*/gi, "$1••••••••")
    .replace(/(api[_-]?key["']?\s*[:=]\s*["'])[^"']{6,}/gi, "$1••••••••");
}

export function maskKey(k: string): string {
  if (!k) return "—";
  if (k.length <= 8) return "••••";
  return `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

export function hasCognition(s: Settings): boolean {
  return s.geminiApiKey.trim().length > 0 || s.grokApiKey.trim().length > 0;
}
