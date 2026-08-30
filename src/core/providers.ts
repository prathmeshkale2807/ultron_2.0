/* ============================================================
   ULTRON Provider Abstraction
   Consistent surface for every AI provider:
     generate() · health() · capabilities()
   - Gemini  → primary conversational brain
   - Grok    → secondary reasoning engine (never a replacement)
   - ElevenLabs → premium speech, with automatic local fallback
   Provider-specific details stay inside this module.
   ============================================================ */

import { emitEvent, logger } from "./eventBus";
import { redact } from "./config";
import type { ProviderHealth, ProviderId, Settings } from "./types";

export interface GenerateOptions {
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return redact(e.message);
  return "unknown provider error";
}

/* A provider with no credentials is not a failure — it is a
   standby state. Callers treat it distinctly from real outages. */
export class NotConfiguredError extends Error {
  readonly kind = "not-configured";
  constructor(provider: string, envVar: string) {
    super(`${provider} is on standby — ${envVar} not configured.`);
    this.name = "NotConfiguredError";
  }
}

/* ------------------------- GEMINI ------------------------- */

export async function generateGemini(
  s: Settings,
  opts: GenerateOptions
): Promise<string> {
  const key = s.geminiApiKey.trim();
  if (!key) throw new NotConfiguredError("Gemini", "GEMINI_API_KEY");
  const model = s.geminiModel.trim() || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;

  const body = {
    ...(opts.system
      ? { systemInstruction: { parts: [{ text: opts.system }] } }
      : {}),
    contents: opts.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxTokens ?? 1024,
    },
  };

  const res = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    opts.timeoutMs ?? s.requestTimeoutMs,
    "Gemini"
  );

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) msg = `${res.status}: ${j.error.message}`;
    } catch {
      /* body was not json */
    }
    throw new Error(`Gemini request failed — ${msg}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("").trim();
  if (!text) {
    const block = data.promptFeedback?.blockReason;
    throw new Error(
      block ? `Gemini returned no output (blocked: ${block}).` : "Gemini returned an empty response."
    );
  }
  return text;
}

export async function pingGemini(s: Settings): Promise<number> {
  const t0 = performance.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(
    s.geminiApiKey.trim()
  )}`;
  const res = await withTimeout(fetch(url), 9000, "Gemini health");
  if (!res.ok) throw new Error(`Gemini health failed — HTTP ${res.status}`);
  await res.json();
  return Math.round(performance.now() - t0);
}

/* -------------------------- GROK -------------------------- */

export async function generateGrok(
  s: Settings,
  opts: GenerateOptions
): Promise<string> {
  const key = s.grokApiKey.trim();
  if (!key) throw new NotConfiguredError("Grok", "GROK_API_KEY");
  const model = s.grokModel.trim() || "grok-3-mini";

  const messages = [
    ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
    ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const res = await withTimeout(
    fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 700,
      }),
    }),
    opts.timeoutMs ?? s.requestTimeoutMs,
    "Grok"
  );

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      msg = `${res.status}: ${j.error ?? j.message ?? "request failed"}`;
    } catch {
      /* ignore */
    }
    throw new Error(`Grok request failed — ${redact(msg)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("Grok returned an empty response.");
  return text;
}

export async function pingGrok(s: Settings): Promise<number> {
  const t0 = performance.now();
  const res = await withTimeout(
    fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${s.grokApiKey.trim()}` },
    }),
    9000,
    "Grok health"
  );
  if (!res.ok) throw new Error(`Grok health failed — HTTP ${res.status}`);
  await res.json();
  return Math.round(performance.now() - t0);
}

/* ----------------------- ELEVENLABS ----------------------- */

export function resolveVoiceId(s: Settings, want?: "default" | "female" | "hindi"): string {
  if (want === "female" && s.elevenFemaleVoiceId.trim()) return s.elevenFemaleVoiceId.trim();
  if (want === "hindi" && s.elevenHindiVoiceId.trim()) return s.elevenHindiVoiceId.trim();
  return s.elevenVoiceId.trim();
}

export async function synthesizeElevenLabs(
  text: string,
  s: Settings,
  want?: "default" | "female" | "hindi"
): Promise<Blob> {
  const key = s.elevenApiKey.trim();
  const voiceId = resolveVoiceId(s, want);
  if (!key) throw new NotConfiguredError("ElevenLabs", "ELEVENLABS_API_KEY");
  if (!voiceId)
    throw new Error("No ElevenLabs voice id configured — falling back to local speech.");

  const res = await withTimeout(
    fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.slice(0, 900),
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.48, similarity_boost: 0.78 },
      }),
    }),
    s.requestTimeoutMs,
    "ElevenLabs"
  );

  if (res.status === 402 || res.status === 401 || res.status === 403) {
    logger.warn(
      "elevenlabs",
      `ElevenLabs declined the request (HTTP ${res.status}). Falling back to local TTS. No credentials were logged.`
    );
    throw new Error(`ElevenLabs unavailable (HTTP ${res.status}) — using local speech.`);
  }
  if (!res.ok) throw new Error(`ElevenLabs failed — HTTP ${res.status}`);
  const blob = await res.blob();
  if (!blob || blob.size === 0) throw new Error("ElevenLabs returned empty audio.");
  return blob;
}

export async function pingElevenLabs(s: Settings): Promise<number> {
  const t0 = performance.now();
  const res = await withTimeout(
    fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": s.elevenApiKey.trim() },
    }),
    9000,
    "ElevenLabs health"
  );
  if (!res.ok) throw new Error(`ElevenLabs health failed — HTTP ${res.status}`);
  await res.json();
  return Math.round(performance.now() - t0);
}

/* --------------------- OLLAMA (LOCAL) --------------------- */
/* Zero-key cognition path. A locally running Ollama instance
   becomes ULTRON's brain when no cloud keys are configured —
   exactly the fallback the original architecture specified. */

export function ollamaBase(s: Settings): string {
  return s.ollamaBaseUrl.trim().replace(/\/+$/, "");
}

export async function generateOllama(
  s: Settings,
  opts: GenerateOptions
): Promise<string> {
  const base = ollamaBase(s);
  if (!base) throw new NotConfiguredError("Ollama", "OLLAMA_BASE_URL");
  const res = await withTimeout(
    fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: s.ollamaModel.trim() || "llama3.2",
        stream: false,
        messages: [
          ...(opts.system ? [{ role: "system", content: opts.system }] : []),
          ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        options: {
          temperature: opts.temperature ?? 0.7,
          num_predict: opts.maxTokens ?? 800,
        },
      }),
    }),
    opts.timeoutMs ?? s.requestTimeoutMs,
    "Ollama"
  );
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = `${res.status}: ${j.error}`;
    } catch {
      /* ignore */
    }
    throw new Error(`Ollama request failed — ${msg}. Is the model pulled (ollama pull ${s.ollamaModel || "llama3.2"})?`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const text = data.message?.content?.trim() ?? "";
  if (!text) throw new Error("Ollama returned an empty response.");
  return text;
}

export async function pingOllama(s: Settings): Promise<{ ms: number; models: number }> {
  const base = ollamaBase(s);
  if (!base) throw new NotConfiguredError("Ollama", "OLLAMA_BASE_URL");
  const t0 = performance.now();
  const res = await withTimeout(fetch(`${base}/api/tags`), 4000, "Ollama health");
  if (!res.ok) throw new Error(`Ollama health failed — HTTP ${res.status}`);
  const data = (await res.json()) as { models?: unknown[] };
  return { ms: Math.round(performance.now() - t0), models: data.models?.length ?? 0 };
}

/* -------------------- PROVIDER MANAGER -------------------- */

export class ProviderManager {
  health: Record<ProviderId, ProviderHealth> = {
    gemini: { status: "unconfigured" },
    grok: { status: "unconfigured" },
    ollama: { status: "unconfigured" },
    elevenlabs: { status: "unconfigured" },
  };

  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(id: ProviderId, h: ProviderHealth) {
    this.health = { ...this.health, [id]: h };
    this.listeners.forEach((l) => l());
  }

  async refresh(s: Settings): Promise<void> {
    const jobs: Promise<void>[] = [];

    if (!s.geminiApiKey.trim()) this.set("gemini", { status: "unconfigured" });
    else
      jobs.push(
        pingGemini(s)
          .then((ms) => {
            this.set("gemini", { status: "online", latencyMs: ms, lastCheck: Date.now() });
            emitEvent("PROVIDER_HEALTH", "providers", `Gemini online — ${ms} ms`, "info", ms);
          })
          .catch((e) => {
            this.set("gemini", { status: "offline", note: describeError(e), lastCheck: Date.now() });
            emitEvent("PROVIDER_HEALTH", "providers", `Gemini unreachable — ${describeError(e)}`, "warn");
          })
      );

    if (!s.grokApiKey.trim()) this.set("grok", { status: "unconfigured" });
    else
      jobs.push(
        pingGrok(s)
          .then((ms) => {
            this.set("grok", { status: "online", latencyMs: ms, lastCheck: Date.now() });
            emitEvent("PROVIDER_HEALTH", "providers", `Grok reasoning engine online — ${ms} ms`, "info", ms);
          })
          .catch((e) => {
            this.set("grok", { status: "offline", note: describeError(e), lastCheck: Date.now() });
            emitEvent("PROVIDER_HEALTH", "providers", `Grok unreachable — ${describeError(e)}`, "warn");
          })
      );

    if (!ollamaBase(s)) this.set("ollama", { status: "unconfigured" });
    else
      jobs.push(
        pingOllama(s)
          .then((r) => {
            this.set("ollama", { status: "online", latencyMs: r.ms, lastCheck: Date.now(), note: `${r.models} model${r.models === 1 ? "" : "s"} available` });
            emitEvent("PROVIDER_HEALTH", "providers", `Ollama local brain online — ${r.ms} ms · ${r.models} model${r.models === 1 ? "" : "s"}`, "info", r.ms);
          })
          .catch((e) => {
            this.set("ollama", { status: "offline", note: describeError(e), lastCheck: Date.now() });
            emitEvent("PROVIDER_HEALTH", "providers", `Ollama unreachable at ${ollamaBase(s)} — start it with “ollama serve”`, "warn");
          })
      );

    if (!s.elevenApiKey.trim()) this.set("elevenlabs", { status: "unconfigured" });
    else
      jobs.push(
        pingElevenLabs(s)
          .then((ms) => {
            this.set("elevenlabs", { status: "online", latencyMs: ms, lastCheck: Date.now() });
            emitEvent("PROVIDER_HEALTH", "providers", `ElevenLabs voice online — ${ms} ms`, "info", ms);
          })
          .catch((e) => {
            this.set("elevenlabs", { status: "degraded", note: describeError(e), lastCheck: Date.now() });
            emitEvent("PROVIDER_HEALTH", "providers", `ElevenLabs degraded — local TTS will be used`, "warn");
          })
      );

    await Promise.all(jobs);
    this.listeners.forEach((l) => l());
  }

  geminiReady(s: Settings): boolean {
    return (
      s.geminiApiKey.trim().length > 0 && this.health.gemini.status !== "offline"
    );
  }

  grokReady(s: Settings): boolean {
    return (
      s.grokEnabled &&
      s.grokApiKey.trim().length > 0 &&
      this.health.grok.status !== "offline"
    );
  }

  ollamaReady(s: Settings): boolean {
    const st = this.health.ollama.status;
    return ollamaBase(s).length > 0 && st !== "offline" && st !== "unconfigured";
  }

  /* True when at least one cognition path can serve a request. */
  cognitionAvailable(s: Settings): boolean {
    return this.geminiReady(s) || this.grokReady(s) || this.ollamaReady(s);
  }

  elevenReady(s: Settings): boolean {
    return (
      (s.ttsProvider === "auto" || s.ttsProvider === "elevenlabs") &&
      s.elevenApiKey.trim().length > 0 &&
      resolveVoiceId(s).length > 0 &&
      this.health.elevenlabs.status !== "offline"
    );
  }
}

/* ------------------ SPEECH FORMATTER (16) ------------------ */
/* The UI may keep full markdown. The spoken line is stripped,
   shortened and optimised for natural speech. */

export function toSpeechText(markdown: string): string {
  let t = markdown;
  t = t.replace(/```[\s\S]*?```/g, " — the code is on your screen. ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, " the link on your screen ");
  t = t.replace(/^#{1,6}\s*/gm, "");
  t = t.replace(/^\s*[-*•]\s+/gm, ", ");
  t = t.replace(/^\s*\d+\.\s+/gm, ", ");
  t = t.replace(/[*_>|#]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 420) {
    const cut = t.slice(0, 420);
    const stop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf(","));
    t = stop > 200 ? cut.slice(0, stop + 1) : cut + "…";
  }
  return t;
}
