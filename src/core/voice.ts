/* ============================================================
   ULTRON Voice Architecture
   Microphone → wake detection → capture → STT → orchestrator
   → safety/tools → response formatter → TTS → speaker.
   One state machine: IDLE → WAKE_ACK → LISTENING → THINKING →
   SPEAKING → (session) → STANDBY. Thread-safe single-flight
   speech, barge-in, ElevenLabs with local TTS fallback.
   Voice has no separate brain — it is an interface layer.
   ============================================================ */

import { emitEvent, logger } from "./eventBus";
import { ProviderManager, synthesizeElevenLabs } from "./providers";
import type { MicStatus, Settings, VoiceState } from "./types";

interface SRInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: unknown) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

function createSR(): SRInstance | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SRInstance;
    webkitSpeechRecognition?: new () => SRInstance;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  try {
    const sr = new Ctor();
    sr.maxAlternatives = 1;
    return sr;
  } catch {
    return null;
  }
}

function extractTranscript(e: unknown): { text: string; isFinal: boolean } {
  const ev = e as {
    resultIndex?: number;
    results?: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }>;
  };
  let text = "";
  let isFinal = false;
  const results = ev.results;
  if (results) {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      text += r?.[0]?.transcript ?? "";
      if (r?.isFinal) isFinal = true;
    }
  }
  return { text: text.trim(), isFinal };
}

const STOP_WORDS = /\b(stop|quiet|silence|cancel|hold on|wait|enough|bas|ruko)\b/i;

export interface VoiceDeps {
  getSettings: () => Settings;
  providers: ProviderManager;
  onCommand: (text: string) => Promise<{ speech: string }>;
  onState: (state: VoiceState) => void;
  onMic: (mic: MicStatus) => void;
}

export class VoiceController {
  private deps: VoiceDeps;
  private wakeRec: SRInstance | null = null;
  private cmdRec: SRInstance | null = null;
  private bargeRec: SRInstance | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private ac: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private mode: "off" | "wake" | "session" = "off";
  private state: VoiceState = "OFF";
  private mic: MicStatus = "unknown";
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private speakSeq = 0;
  private running = false;
  private supported = createSR() !== null;

  constructor(deps: VoiceDeps) {
    this.deps = deps;
  }

  isSupported(): boolean {
    return this.supported;
  }

  getState(): VoiceState {
    return this.state;
  }

  getMic(): MicStatus {
    return this.mic;
  }

  private setState(s: VoiceState) {
    if (this.state === s) return;
    this.state = s;
    emitEvent("STATE", "voice", `Voice state → ${s}`);
    this.deps.onState(s);
  }

  private setMic(m: MicStatus) {
    if (this.mic === m) return;
    this.mic = m;
    this.deps.onMic(m);
  }

  /* ------------------------- lifecycle ------------------------ */

  async enable(): Promise<void> {
    /* Unlock audio output inside the user gesture so wake-triggered
       speech is never blocked by autoplay policy. */
    this.ensureCtx();
    if (!this.supported) {
      this.setMic("unsupported");
      logger.warn("voice", "Speech recognition unsupported in this browser — voice input disabled, text interface remains fully active.");
      return;
    }
    this.mode = this.deps.getSettings().wakeEnabled ? "wake" : "session";
    if (this.mode === "wake") {
      this.setState("IDLE");
      this.armWakeLoop();
    } else {
      this.beginSession(true);
    }
  }

  disable(): void {
    this.mode = "off";
    this.tearDownRecognizers();
    this.cancelSpeech();
    this.clearTimers();
    this.setState("OFF");
  }

  private tearDownRecognizers() {
    [this.wakeRec, this.cmdRec, this.bargeRec].forEach((r) => {
      if (r) {
        r.onresult = null;
        r.onend = null;
        r.onerror = null;
        try {
          r.abort();
        } catch {
          /* already stopped */
        }
      }
    });
    this.wakeRec = null;
    this.cmdRec = null;
    this.bargeRec = null;
  }

  private clearTimers() {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.sessionTimer = null;
    this.silenceTimer = null;
  }

  /* ------------------------- wake loop ------------------------ */

  private armWakeLoop() {
    if (this.mode !== "wake") return;
    this.tearDownRecognizers();
    const rec = createSR();
    if (!rec) return;
    this.wakeRec = rec;
    rec.lang = this.deps.getSettings().sttLang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => this.setMic("available");
    rec.onresult = (e) => {
      const { text } = extractTranscript(e);
      const norm = text.toLowerCase().replace(/[^a-z\s]/g, "");
      const phrase = this.deps.getSettings().wakeWord.toLowerCase().trim();
      const words = phrase.split(/\s+/);
      const core = words[words.length - 1] ?? "ultron";
      if (norm.includes(phrase) || norm.includes(core)) {
        this.triggerWake(text);
      }
    };
    rec.onerror = (e) => this.handleSRError(e);
    rec.onend = () => {
      if (this.mode === "wake" && !this.running) {
        setTimeout(() => this.armWakeLoop(), 250);
      }
    };
    try {
      rec.start();
    } catch {
      /* double-start guard */
    }
  }

  private triggerWake(raw: string) {
    if (this.running) return;
    this.running = true;
    emitEvent("WAKE_DETECTED", "voice", `Wake phrase heard in: “${raw.slice(0, 60)}”`);
    this.tearDownRecognizers();
    this.setState("WAKE_ACK");
    void this.speak("Yes, sir?").then(() => {
      this.running = false;
      this.beginSession(false);
    });
  }

  /* ----------------------- command session -------------------- */

  private beginSession(initial: boolean) {
    if (this.mode === "off") return;
    if (initial) emitEvent("LISTENING_STARTED", "voice", "Voice session opened (continuous mode)");
    this.armCommandCapture();
  }

  private armCommandCapture() {
    if (this.mode === "off") return;
    this.tearDownRecognizers();
    const rec = createSR();
    if (!rec) return;
    this.cmdRec = rec;
    rec.lang = this.deps.getSettings().sttLang;
    rec.continuous = false;
    rec.interimResults = true;
    this.setState("LISTENING");
    emitEvent("LISTENING_STARTED", "voice", "Listening for a command");
    let gotSpeech = false;

    const bumpSilence = () => {
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      this.silenceTimer = setTimeout(() => {
        if (!gotSpeech) this.endSessionToStandby();
      }, this.deps.getSettings().standbySeconds * 1000);
    };
    bumpSilence();

    rec.onstart = () => this.setMic("available");
    rec.onresult = (e) => {
      const { text, isFinal } = extractTranscript(e);
      if (!text) return;
      gotSpeech = true;
      bumpSilence();
      if (isFinal) {
        void this.handleCommand(text);
      }
    };
    rec.onerror = (e) => this.handleSRError(e);
    rec.onend = () => {
      if (this.mode === "off") return;
      if (this.state === "LISTENING") {
        /* recognizer ended without a final result — re-arm */
        setTimeout(() => {
          if (this.state === "LISTENING" && this.mode !== "off") this.armCommandCapture();
        }, 200);
      }
    };
    try {
      rec.start();
    } catch {
      /* ignore */
    }
  }

  private async handleCommand(text: string) {
    emitEvent("TRANSCRIPTION_READY", "voice", `STT → “${text}”`);
    this.tearDownRecognizers();
    this.setState("THINKING");
    this.running = true;
    let speech = "One moment.";
    try {
      const res = await this.deps.onCommand(text);
      speech = res.speech || "Done.";
    } catch (e) {
      speech = "That didn't work as expected. I'll try another approach.";
      logger.error("voice", `Command processing failed — ${e instanceof Error ? e.message : "unknown"}`);
    }
    this.running = false;
    await this.speak(speech);
    if (this.mode !== "off") this.armCommandCapture();
  }

  private endSessionToStandby() {
    if (this.mode === "off") return;
    this.tearDownRecognizers();
    this.setState("STANDBY");
    emitEvent("STATE", "voice", "No activity — returning to standby");
    if (this.deps.getSettings().wakeEnabled) {
      this.mode = "wake";
      this.setState("IDLE");
      this.armWakeLoop();
    } else {
      setTimeout(() => {
        if (this.mode !== "off" && this.state === "STANDBY") this.armCommandCapture();
      }, 4000);
    }
  }

  /* ---------------------- push to talk ------------------------ */

  pushToTalk(): void {
    if (!this.supported || this.mic === "denied" || this.mic === "unsupported") return;
    if (this.state === "SPEAKING") {
      this.cancelSpeech();
    }
    this.mode = this.mode === "off" ? "session" : this.mode;
    this.armCommandCapture();
  }

  /* -------------------------- barge-in ------------------------- */

  private armBargeIn() {
    if (!this.supported) return;
    if (this.bargeRec) return;
    const rec = createSR();
    if (!rec) return;
    this.bargeRec = rec;
    rec.lang = this.deps.getSettings().sttLang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      const { text } = extractTranscript(e);
      if (STOP_WORDS.test(text)) {
        emitEvent("INTERRUPTED", "voice", `Barge-in — user said “${text.slice(0, 40)}”`);
        this.cancelSpeech();
      }
    };
    rec.onerror = () => {
      this.bargeRec = null;
    };
    rec.onend = () => {
      this.bargeRec = null;
      if (this.state === "SPEAKING") this.armBargeIn();
    };
    try {
      rec.start();
    } catch {
      this.bargeRec = null;
    }
  }

  private disarmBargeIn() {
    if (this.bargeRec) {
      const r = this.bargeRec;
      this.bargeRec = null;
      r.onresult = null;
      r.onend = null;
      r.onerror = null;
      try {
        r.abort();
      } catch {
        /* ignore */
      }
    }
  }

  /* ---------------------------- TTS ---------------------------- */

  async speak(text: string): Promise<void> {
    const s = this.deps.getSettings();
    if (!s.speakResponses || !text.trim()) return;
    const seq = ++this.speakSeq;
    this.stopActiveAudio();
    this.setState("SPEAKING");
    emitEvent("SPEAKING_STARTED", "tts", `Speaking (${text.length} chars)`);
    if (this.supported && this.mic !== "denied") this.armBargeIn();

    try {
      if (this.deps.providers.elevenReady(s)) {
        const want = s.language === "hi" ? "hindi" : "default";
        try {
          const blob = await synthesizeElevenLabs(text, s, want);
          if (seq !== this.speakSeq) return;
          await this.playBlob(blob);
        } catch (e) {
          if (seq !== this.speakSeq) return;
          logger.warn("tts", `ElevenLabs unavailable — ${e instanceof Error ? e.message : "error"}. Falling back to local speech.`);
          await this.speakLocal(text);
        }
      } else {
        await this.speakLocal(text);
      }
      } finally {
        if (seq === this.speakSeq) {
          this.disarmBargeIn();
          emitEvent("SPEAKING_STOPPED", "tts", "Speech complete");
          if (this.state === "SPEAKING") this.setState(this.restoreState());
        }
      }
    }

  private restoreState(): VoiceState {
    if (this.mode === "off") return "OFF";
    return this.mode === "wake" ? "IDLE" : "LISTENING";
  }

  private ensureCtx(): AudioContext | null {
    try {
      if (!this.ac) {
        const W = window as unknown as {
          AudioContext?: new () => AudioContext;
          webkitAudioContext?: new () => AudioContext;
        };
        const Ctor = W.AudioContext ?? W.webkitAudioContext;
        if (!Ctor) return null;
        this.ac = new Ctor();
      }
      if (this.ac.state === "suspended") void this.ac.resume();
      return this.ac;
    } catch {
      return null;
    }
  }
  private playBlob(blob: Blob): Promise<void> {
    const ac = this.ensureCtx();
    if (ac) {
      return new Promise((resolve) => {
        blob
          .arrayBuffer()
          .then((buf) => ac.decodeAudioData(buf))
          .then((decoded) => {
            const src = ac.createBufferSource();
            src.buffer = decoded;
            src.connect(ac.destination);
            this.source = src;
            src.onended = () => {
              if (this.source === src) this.source = null;
              resolve();
            };
            src.start();
          })
          .catch(() => resolve());
      });
    }
    /* No WebAudio — element playback fallback */
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      this.audioUrl = url;
      const audio = new Audio(url);
      this.audio = audio;
      audio.onended = () => {
        this.cleanupAudio();
        resolve();
      };
      audio.onerror = () => {
        this.cleanupAudio();
        resolve();
      };
      audio.play().catch(() => {
        this.cleanupAudio();
        resolve();
      });
    });
  }

  private speakLocal(text: string): Promise<void> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) {
        resolve();
        return;
      }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const s = this.deps.getSettings();
      u.lang = s.language === "hi" ? "hi-IN" : s.sttLang;
      u.rate = 1.02;
      u.pitch = 0.92;
      const voices = synth.getVoices();
      const preferred =
        voices.find((v) => v.lang?.toLowerCase().startsWith(s.language === "hi" ? "hi" : "en") && /google|natural|neural/i.test(v.name)) ??
        voices.find((v) => v.lang?.toLowerCase().startsWith(s.language === "hi" ? "hi" : "en")) ??
        voices.find((v) => /daniel|arthur|george|male/i.test(v.name));
      if (preferred) u.voice = preferred;
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
      setTimeout(done, Math.min(30000, 1200 + text.length * 75));
    });
  }

  cancelSpeech(): void {
    this.speakSeq += 1;
    this.stopActiveAudio();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    this.disarmBargeIn();
    emitEvent("SPEAKING_STOPPED", "tts", "Speech interrupted");
    if (this.state === "SPEAKING") this.setState(this.restoreState());
  }

  private stopActiveAudio() {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source = null;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio = null;
    }
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
  }

  private cleanupAudio() {
    this.audio = null;
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
  }

  /* ------------------------- SR errors ------------------------- */

  private handleSRError(e: unknown) {
    const err = (e as { error?: string })?.error ?? "unknown";
    if (err === "not-allowed" || err === "service-not-allowed") {
      this.setMic("denied");
      this.mode = "off";
      this.tearDownRecognizers();
      this.setState("OFF");
      logger.warn("voice", "Microphone permission denied — voice input offline. Text interface unaffected.");
    } else if (err === "no-speech") {
      /* benign — recognizer will re-arm via onend */
    } else if (err !== "aborted") {
      logger.warn("voice", `Speech recognition error — ${err}`);
    }
  }
}
