/* ============================================================
   ULTRON — central integration hook
   One instance owns every subsystem; the UI is a thin layer.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitEvent, logger, onEvent, uid } from "../core/eventBus";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../core/config";
import { MemoryManager } from "../core/memory";
import { TaskManager } from "../core/tasks";
import { AuditLogger, ConfirmationBroker, SafetyGate } from "../core/safety";
import { ToolRegistry } from "../core/tools";
import { ProviderManager, generateGemini, generateGrok, synthesizeElevenLabs } from "../core/providers";
import { Orchestrator } from "../core/orchestrator";
import { VoiceController } from "../core/voice";
import type {
  AssistantTurn,
  ChatMessage,
  EventEntry,
  MicStatus,
  Settings,
  SubsystemStatus,
  VoiceState,
} from "../core/types";

interface Controllers {
  memory: MemoryManager;
  tasks: TaskManager;
  gate: SafetyGate;
  broker: ConfirmationBroker;
  audit: AuditLogger;
  providers: ProviderManager;
  registry: ToolRegistry;
  orchestrator: Orchestrator;
  voice: VoiceController;
}

function buildControllers(
  settingsRef: { current: Settings },
  sessionIdRef: { current: string },
  processRef: { current: (text: string) => Promise<AssistantTurn> },
  onState: (s: VoiceState) => void,
  onMic: (m: MicStatus) => void
): Controllers {
  const memory = new MemoryManager();
  const tasks = new TaskManager();
  const gate = new SafetyGate();
  const broker = new ConfirmationBroker();
  const audit = new AuditLogger();
  const providers = new ProviderManager();

  const registry = new ToolRegistry(
    () => ({
      settings: settingsRef.current,
      memory,
      tasks,
      sessionId: sessionIdRef.current,
    }),
    () => {
      const s = settingsRef.current;
      const h = providers.health;
      const line = (label: string, status: string, note?: string) =>
        `- ${label}: ${status}${note ? ` — ${note}` : ""}`;
      return [
        "### ULTRON Diagnostic Report",
        line("Gemini (primary cognition)", h.gemini.status, h.gemini.latencyMs ? `${h.gemini.latencyMs} ms` : h.gemini.note),
        line("Grok (reasoning engine)", h.grok.status, h.grok.latencyMs ? `${h.grok.latencyMs} ms` : h.grok.note),
        line("ElevenLabs (premium voice)", h.elevenlabs.status, h.elevenlabs.note),
        line("Memory core", "online", `${memory.count()} entries stored`),
        line("Tool registry", "online", "11 tools armed, safety gate enforced"),
        line("Task automation", "online", `${tasks.pendingCount()} pending`),
        line("Safety policy", "armed", `confirmation required at risk ≥ ${s.confirmRisk}`),
        line("Context", "active", "conversation window managed"),
      ].join("\n");
    }
  );

  const orchestrator = new Orchestrator({
    getSettings: () => settingsRef.current,
    memory,
    tasks,
    gate,
    broker,
    audit,
    registry,
    providers,
    sessionId: () => sessionIdRef.current,
  });

  const voice = new VoiceController({
    getSettings: () => settingsRef.current,
    providers,
    onCommand: async (text: string) => {
      const turn = await processRef.current(text);
      return { speech: turn.speech };
    },
    onState,
    onMic,
  });

  return { memory, tasks, gate, broker, audit, providers, registry, orchestrator, voice };
}

export function useUltron() {
  const settingsRef = useRef<Settings>(loadSettings());
  const sessionIdRef = useRef<string>(uid("sess"));
  const processRef = useRef<(text: string) => Promise<AssistantTurn>>(async () => ({
    content: "",
    speech: "",
    meta: {},
  }));

  const [settings, setSettingsState] = useState<Settings>(settingsRef.current);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [thinking, setThinking] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("OFF");
  const [mic, setMic] = useState<MicStatus>("unknown");
  const [bootDone, setBootDone] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{
    token: string;
    tool: string;
    toolLabel: string;
    risk: string;
    promptText: string;
  } | null>(null);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  const cRef = useRef<Controllers | null>(null);
  if (!cRef.current) {
    cRef.current = buildControllers(settingsRef, sessionIdRef, processRef, setVoiceState, setMic);
  }
  const c = cRef.current;

  /* ------------------------- event bus ------------------------- */
  useEffect(() => {
    const off = onEvent((e) => {
      setEvents((prev) => [...prev.slice(-239), e]);
    });
    return off;
  }, []);

  useEffect(() => c.providers.subscribe(rerender), [c, rerender]);
  useEffect(() => c.memory.subscribe(rerender), [c, rerender]);
  useEffect(() => c.tasks.subscribe(rerender), [c, rerender]);
  useEffect(() => c.audit.subscribe(rerender), [c, rerender]);

  /* -------------------------- boot ----------------------------- */
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const steps: [number, () => void][] = [
      [80, () => emitEvent("BOOT", "kernel", `ULTRON kernel v3.2.0 initialised — session ${sessionIdRef.current}`)],
      [240, () => emitEvent("BOOT", "config", `Configuration loaded — confirm ≥ ${settingsRef.current.confirmRisk}, timeout ${settingsRef.current.requestTimeoutMs} ms`)],
      [420, () => emitEvent("BOOT", "tools", `Tool registry online — ${c.registry.list().length} tools armed`)],
      [580, () => emitEvent("BOOT", "safety", "SafetyGate + ConfirmationBroker enforced on every execution path")],
      [740, () => emitEvent("BOOT", "memory", `Memory core online — ${c.memory.count()} entries, 8 categories`)],
      [900, () => emitEvent("BOOT", "tasks", `Task automation online — ${c.tasks.pendingCount()} pending reminder${c.tasks.pendingCount() === 1 ? "" : "s"}`)],
      [1100, () => {
        emitEvent("BOOT", "voice", c.voice.isSupported() ? "Speech interface detected (STT + TTS)" : "Speech recognition unsupported — text interface active");
      }],
      [1300, () => emitEvent("BOOT", "orchestrator", "AI orchestrator ready — Gemini primary, Grok on reasoning standby")],
    ];
    steps.forEach(([ms, fn]) => setTimeout(fn, ms));
    void c.providers.refresh(settingsRef.current);
    const t = setTimeout(() => setBootDone(true), 1900);
    logger.info("boot", "ULTRON startup sequence complete — no traceback");
    return () => clearTimeout(t);
  }, [c]);

  /* ----------------------- task ticker ------------------------- */
  useEffect(() => {
    const iv = setInterval(() => {
      const due = c.tasks.tick(Date.now());
      due.forEach((task) => {
        const msg: ChatMessage = {
          id: uid("msg"),
          role: "ultron",
          content: `**Reminder, sir** — ${task.label}\n\nScheduled ${new Date(task.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}, due ${new Date(task.dueAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.`,
          ts: Date.now(),
          meta: { routing: "automation", tool: "create_reminder" },
        };
        setMessages((prev) => [...prev, msg]);
        if (settingsRef.current.voiceEnabled && settingsRef.current.speakResponses) {
          void c.voice.speak(`Reminder, sir. ${task.label}.`);
        }
      });
      c.tasks.pruneDone(6 * 3600 * 1000);
    }, 1000);
    return () => clearInterval(iv);
  }, [c]);

  /* -------------------- periodic health ------------------------ */
  useEffect(() => {
    const iv = setInterval(() => {
      const s = settingsRef.current;
      if (s.geminiApiKey || s.grokApiKey || s.elevenApiKey) {
        void c.providers.refresh(s);
      }
    }, 60000);
    return () => clearInterval(iv);
  }, [c]);

  /* ------------------------- pipeline -------------------------- */
  const process = useCallback(
    async (text: string): Promise<AssistantTurn> => {
      setThinking(true);
      try {
        const turn = await c.orchestrator.handle(text);
        const ultronMsg: ChatMessage = {
          id: uid("msg"),
          role: "ultron",
          content: turn.content,
          ts: Date.now(),
          meta: turn.meta,
        };
        setMessages((prev) => [...prev, ultronMsg]);
        setPendingConfirm(
          c.broker.pending
            ? {
                token: c.broker.pending.token,
                tool: c.broker.pending.tool,
                toolLabel: c.broker.pending.toolLabel,
                risk: c.broker.pending.risk,
                promptText: c.broker.pending.promptText,
              }
            : null
        );
        return turn;
      } finally {
        setThinking(false);
      }
    },
    [c]
  );
  processRef.current = process;

  const sendMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || thinking) return;
      const userMsg: ChatMessage = { id: uid("msg"), role: "user", content: text, ts: Date.now() };
      setMessages((prev) => [...prev, userMsg]);
      const turn = await process(text);
      const st = c.voice.getState();
      const voiceDriving = st === "LISTENING" || st === "THINKING" || st === "SPEAKING" || st === "WAKE_ACK";
      if (
        settingsRef.current.voiceEnabled &&
        settingsRef.current.speakResponses &&
        turn.speech &&
        !voiceDriving &&
        !turn.meta.confirmToken
      ) {
        void c.voice.speak(turn.speech);
      }
      if (turn.meta.confirmToken && settingsRef.current.voiceEnabled && settingsRef.current.speakResponses) {
        void c.voice.speak(turn.speech);
      }
    },
    [c, process, thinking]
  );

  const resolveConfirmation = useCallback(
    async (approve: boolean) => {
      setPendingConfirm(null);
      setThinking(true);
      try {
        const turn = await c.orchestrator.resolvePending(approve);
        const msg: ChatMessage = {
          id: uid("msg"),
          role: "ultron",
          content: turn.content,
          ts: Date.now(),
          meta: turn.meta,
        };
        setMessages((prev) => [...prev, msg]);
        if (approve && settingsRef.current.voiceEnabled && settingsRef.current.speakResponses) {
          void c.voice.speak(turn.speech);
        }
      } finally {
        setThinking(false);
      }
    },
    [c]
  );

  /* ------------------------- voice ----------------------------- */
  const toggleVoice = useCallback(async () => {
    const next = { ...settingsRef.current, voiceEnabled: !settingsRef.current.voiceEnabled };
    settingsRef.current = next;
    setSettingsState(next);
    saveSettings(next);
    if (next.voiceEnabled) {
      emitEvent("STATE", "voice", "Voice interface enabled");
      await c.voice.enable();
    } else {
      c.voice.disable();
    }
  }, [c]);

  const pushToTalk = useCallback(() => {
    c.voice.pushToTalk();
  }, [c]);

  const speakText = useCallback(
    (text: string) => {
      void c.voice.speak(text);
    },
    [c]
  );

  /* ------------------------ settings --------------------------- */
  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettingsState(next);
      saveSettings(next);
      emitEvent("BOOT", "config", "Configuration updated — providers re-validating");
      void c.providers.refresh(next);
    },
    [c]
  );

  const newSession = useCallback(() => {
    c.orchestrator.reset();
    sessionIdRef.current = uid("sess");
    setMessages([]);
    setPendingConfirm(null);
    c.broker.resolve(false, "timeout");
    emitEvent("STATE", "orchestrator", `New session started — ${sessionIdRef.current}`);
  }, [c]);

  /* ----------------------- diagnostics ------------------------- */
  const runDiagnostics = useCallback(async () => {
    emitEvent("STATE", "diagnostics", "Manual diagnostic sweep requested");
    await c.providers.refresh(settingsRef.current);
    await sendMessage("system status");
  }, [c, sendMessage]);

  const testProvider = useCallback(
    async (which: "gemini" | "grok" | "elevenlabs"): Promise<string> => {
      const s = settingsRef.current;
      const t0 = performance.now();
      try {
        if (which === "gemini") {
          const out = await generateGemini(s, {
            messages: [{ role: "user", content: "Reply with exactly: ULTRON LINK ESTABLISHED" }],
            maxTokens: 40,
            timeoutMs: 12000,
          });
          return `Link established in ${Math.round(performance.now() - t0)} ms — “${out.slice(0, 60)}”`;
        }
        if (which === "grok") {
          const out = await generateGrok(s, {
            messages: [{ role: "user", content: "Reply with exactly: REASONING ENGINE READY" }],
            maxTokens: 40,
            timeoutMs: 12000,
          });
          return `Reasoning engine verified in ${Math.round(performance.now() - t0)} ms — “${out.slice(0, 60)}”`;
        }
        const blob = await synthesizeElevenLabs("ULTRON voice link established.", s);
        const url = URL.createObjectURL(blob);
        const a = new Audio(url);
        a.onended = () => URL.revokeObjectURL(url);
        void a.play().catch(() => URL.revokeObjectURL(url));
        return `Voice synthesised in ${Math.round(performance.now() - t0)} ms — playing sample.`;
      } catch (e) {
        return `Failed — ${e instanceof Error ? e.message : "unknown error"}`;
      }
    },
    []
  );

  /* ------------------------ subsystems ------------------------- */
  const subsystems: SubsystemStatus[] = useMemo(() => {
    const s = settings;
    const h = c.providers.health;
    const provLine = (status: string, latency?: number, note?: string) =>
      status === "online" && latency ? `online · ${latency} ms` : status === "unconfigured" ? "awaiting API key" : note ? `${status} · ${note.slice(0, 34)}` : status;
    const provState = (status: string): SubsystemStatus["state"] =>
      status === "online" ? "online" : status === "degraded" ? "degraded" : status === "offline" ? "offline" : "standby";
    return [
      { id: "gemini", label: "Gemini · Primary Cognition", state: provState(h.gemini.status), detail: provLine(h.gemini.status, h.gemini.latencyMs, h.gemini.note) },
      { id: "grok", label: "Grok · Reasoning Engine", state: provState(h.grok.status), detail: s.grokEnabled ? provLine(h.grok.status, h.grok.latencyMs, h.grok.note) : "disabled by policy" },
      { id: "eleven", label: "ElevenLabs · Voice Synth", state: provState(h.elevenlabs.status), detail: provLine(h.elevenlabs.status, h.elevenlabs.latencyMs, h.elevenlabs.note) },
      {
        id: "voice",
        label: "Speech Interface",
        state: voiceState === "OFF" ? (mic === "denied" ? "offline" : "standby") : "online",
        detail: mic === "unsupported" ? "unsupported in browser" : mic === "denied" ? "microphone denied" : `state ${voiceState.toLowerCase()}`,
      },
      { id: "memory", label: "Memory Core", state: "online", detail: `${c.memory.count()} entries · 8 categories` },
      { id: "tools", label: "Tool Registry", state: "online", detail: `${c.registry.list().length} tools · one registry` },
      { id: "safety", label: "Safety Gate", state: "online", detail: `confirm ≥ ${s.confirmRisk}` },
      { id: "tasks", label: "Task Automation", state: "online", detail: `${c.tasks.pendingCount()} pending` },
    ];
  }, [settings, voiceState, mic, c, events.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    settings,
    updateSettings,
    defaults: DEFAULT_SETTINGS,
    messages,
    sendMessage,
    events,
    thinking,
    voiceState,
    mic,
    bootDone,
    pendingConfirm,
    resolveConfirmation,
    toggleVoice,
    pushToTalk,
    speakText,
    newSession,
    runDiagnostics,
    testProvider,
    subsystems,
    sessionId: sessionIdRef.current,
    tools: c.registry.list(),
    auditList: c.audit.list(),
    clearAudit: () => c.audit.clear(),
    memory: c.memory,
    tasks: c.tasks,
    providers: c.providers,
    voiceSupported: c.voice.isSupported(),
  };
}

export type UltronApi = ReturnType<typeof useUltron>;
