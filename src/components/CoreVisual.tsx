import { useEffect, useState } from "react";
import type { SubsystemStatus, VoiceState } from "../core/types";

type CoreMode = "off" | "standby" | "idle" | "listening" | "thinking" | "speaking";

const MODE_COLOR: Record<CoreMode, string> = {
  off: "#3a4d6b",
  standby: "#4c6a8f",
  idle: "#37e2d5",
  listening: "#5cc8ff",
  thinking: "#f2b64c",
  speaking: "#a4e86d",
};

function deriveMode(voiceState: VoiceState, thinking: boolean): CoreMode {
  if (thinking) return "thinking";
  switch (voiceState) {
    case "OFF":
      return "off";
    case "STANDBY":
      return "standby";
    case "IDLE":
      return "idle";
    case "LISTENING":
    case "WAKE_ACK":
      return "listening";
    case "SPEAKING":
      return "speaking";
    case "THINKING":
      return "thinking";
    default:
      return "idle";
  }
}

const MODE_LABEL: Record<CoreMode, string> = {
  off: "CORE DORMANT",
  standby: "STANDBY",
  idle: "WAKE-WORD ARMED",
  listening: "LISTENING",
  thinking: "PROCESSING",
  speaking: "SPEAKING",
};

export function CoreVisual({ voiceState, thinking }: { voiceState: VoiceState; thinking: boolean }) {
  const mode = deriveMode(voiceState, thinking);
  const color = MODE_COLOR[mode];
  const active = mode !== "off";

  const [uptime, setUptime] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const iv = setInterval(() => setUptime(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);
  const up = `${String(Math.floor(uptime / 3600)).padStart(2, "0")}:${String(Math.floor((uptime % 3600) / 60)).padStart(2, "0")}:${String(uptime % 60).padStart(2, "0")}`;

  const bars = Array.from({ length: 21 }, (_, i) => 6 + Math.abs(Math.sin(i * 1.7)) * 16);
  const animating = mode === "speaking" || mode === "listening";

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <div className="relative" style={{ width: 190, height: 190 }}>
        <svg viewBox="0 0 220 220" width="190" height="190" className="block">
          <defs>
            <radialGradient id="coreGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="28%" stopColor={color} stopOpacity="0.85" />
              <stop offset="70%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* tick marks */}
          {Array.from({ length: 24 }, (_, i) => {
            const a = (i * Math.PI * 2) / 24;
            const x1 = 110 + Math.cos(a) * 103;
            const y1 = 110 + Math.sin(a) * 103;
            const x2 = 110 + Math.cos(a) * (i % 6 === 0 ? 96 : 100);
            const y2 = 110 + Math.sin(a) * (i % 6 === 0 ? 96 : 100);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeOpacity="0.4" strokeWidth="1" />;
          })}

          <circle cx="110" cy="110" r="90" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 9" className="ring-spin-slow" />
          <circle
            cx="110" cy="110" r="76" fill="none" stroke={color} strokeOpacity={active ? 0.75 : 0.3}
            strokeWidth="2.5" strokeDasharray="46 22 12 22" strokeLinecap="round"
            className={mode === "thinking" ? "ring-spin-fast" : "ring-spin-rev"}
          />
          <circle cx="110" cy="110" r="62" fill="none" stroke={color} strokeOpacity="0.4" strokeWidth="1" strokeDasharray="1 5" className="ring-spin-slow" />

          {(mode === "listening" || mode === "speaking") && (
            <>
              <circle cx="110" cy="110" r="52" fill="none" stroke={color} strokeWidth="1.5" className="ring-pulse" />
              <circle cx="110" cy="110" r="52" fill="none" stroke={color} strokeWidth="1" className="ring-pulse" style={{ animationDelay: "0.55s" }} />
            </>
          )}

          <circle cx="110" cy="110" r="46" fill="url(#coreGrad)" className={mode === "thinking" || mode === "listening" ? "core-breathe-fast" : "core-breathe"} />
          <circle cx="110" cy="110" r="15" fill="#ffffff" fillOpacity={active ? 0.92 : 0.35} />
          <circle cx="110" cy="110" r="24" fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1" />
        </svg>

        {/* state label */}
        <div className="absolute left-1/2 top-[63%] -translate-x-1/2 text-center pointer-events-none">
          <div className="display text-[9px] tracking-[0.3em]" style={{ color }}>
            {MODE_LABEL[mode]}
          </div>
        </div>
      </div>

      {/* waveform */}
      <div className="flex h-8 items-center gap-[3px]" aria-hidden>
        {bars.map((h, i) => (
          <div
            key={i}
            className={animating ? "wavebar w-[3px] rounded-full" : "w-[3px] rounded-full"}
            style={{
              height: animating ? h : 3,
              background: color,
              opacity: animating ? 0.85 : 0.3,
              animationDelay: `${(i % 7) * 0.09}s`,
              animationDuration: `${0.7 + (i % 5) * 0.12}s`,
              transition: "height 0.4s ease, opacity 0.4s ease",
            }}
          />
        ))}
      </div>

      <div className="font-mono text-[10px] text-faint tracking-wider">
        PWR 98.2% · UPTIME {up}
      </div>
    </div>
  );
}

const STATE_LED: Record<SubsystemStatus["state"], string> = {
  online: "led led-on",
  degraded: "led led-warn led-blink",
  offline: "led led-err",
  standby: "led led-off",
};

export function SidePanel({
  subsystems,
  voiceState,
  thinking,
  onDiagnostics,
  onNewSession,
}: {
  subsystems: SubsystemStatus[];
  voiceState: VoiceState;
  thinking: boolean;
  onDiagnostics: () => void;
  onNewSession: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="panel hud-corner">
        <div className="flex items-center justify-between border-b border-line/60 px-4 py-2.5">
          <span className="panel-title">Core</span>
          <span className="font-mono text-[9px] text-faint">ARC-3 REACTOR</span>
        </div>
        <CoreVisual voiceState={voiceState} thinking={thinking} />
      </div>

      <div className="panel flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between border-b border-line/60 px-4 py-2.5">
          <span className="panel-title">Subsystems</span>
          <span className="font-mono text-[9px] text-faint">{subsystems.filter((s) => s.state === "online").length}/{subsystems.length} ONLINE</span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {subsystems.map((s, i) => (
            <div
              key={s.id}
              className="group flex items-start gap-2.5 rounded px-2 py-[7px] transition-colors hover:bg-raise/60"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className={`${STATE_LED[s.state]} mt-[5px]`} />
              <div className="min-w-0">
                <div className="text-[11.5px] font-medium leading-tight text-ice/90 group-hover:text-ice transition-colors">{s.label}</div>
                <div className="font-mono text-[9.5px] leading-tight text-faint">{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-line/60 p-3">
          <button
            onClick={onDiagnostics}
            className="display rounded border border-line2/70 bg-panel2 px-2 py-2 text-[9px] tracking-[0.22em] text-dim transition-all hover:border-core/50 hover:text-core hover:shadow-[0_0_14px_rgba(55,226,213,0.15)] active:translate-y-px"
          >
            DIAGNOSTICS
          </button>
          <button
            onClick={onNewSession}
            className="display rounded border border-line2/70 bg-panel2 px-2 py-2 text-[9px] tracking-[0.22em] text-dim transition-all hover:border-glow/50 hover:text-glow hover:shadow-[0_0_14px_rgba(92,200,255,0.15)] active:translate-y-px"
          >
            NEW SESSION
          </button>
        </div>
      </div>
    </div>
  );
}
