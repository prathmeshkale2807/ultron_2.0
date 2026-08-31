import { useState } from "react";
import { useUltron } from "./hooks/useUltron";
import { TopBar, StatusBar, BootOverlay } from "./components/Chrome";
import { SidePanel } from "./components/CoreVisual";
import { ConversationDeck } from "./components/ConversationDeck";
import { OpsPanel, type OpsTab } from "./components/OpsPanel";

export default function App() {
  const api = useUltron();
  const [opsTab, setOpsTab] = useState<OpsTab>("events");
  const [opsOpen, setOpsOpen] = useState(false);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-abyss">
      {/* ambient layers */}
      <div className="ultron-bg-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="ultron-bg-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="scanline" aria-hidden />

      <BootOverlay />

      <TopBar
        voiceState={api.voiceState}
        voiceEnabled={api.settings.voiceEnabled}
        mic={api.mic}
        onToggleVoice={() => void api.toggleVoice()}
        onPushToTalk={api.pushToTalk}
        sessionId={api.sessionId}
        onShowOps={() => setOpsOpen(true)}
      />

      <div className="relative flex min-h-0 flex-1 gap-3 p-3">
        {/* systems column */}
        <aside className="hidden w-[272px] flex-none lg:block">
          <SidePanel
            subsystems={api.subsystems}
            voiceState={api.voiceState}
            thinking={api.thinking}
            onDiagnostics={() => void api.runDiagnostics()}
            onNewSession={api.newSession}
          />
        </aside>

        {/* conversation deck */}
        <main className="panel hud-corner min-w-0 flex-1 overflow-hidden">
          <ConversationDeck
            messages={api.messages}
            thinking={api.thinking}
            pendingConfirm={api.pendingConfirm}
            onSend={(t) => void api.sendMessage(t)}
            onApprove={() => void api.resolveConfirmation(true)}
            onDeny={() => void api.resolveConfirmation(false)}
            onPushToTalk={api.pushToTalk}
            voiceState={api.voiceState}
            voiceEnabled={api.settings.voiceEnabled}
            mic={api.mic}
            voiceSupported={api.voiceSupported}
            onToggleVoice={() => void api.toggleVoice()}
            cognitionReady={api.cognitionReady}
            settings={api.settings}
            onOpenConfig={() => {
              setOpsTab("config");
              setOpsOpen(true);
            }}
          />
        </main>

        {/* operations deck */}
        <div
          className={
            opsOpen
              ? "fixed inset-y-0 right-0 z-40 w-[94vw] max-w-[420px] p-3 lg:static lg:inset-auto lg:z-auto lg:w-[356px] lg:flex-none lg:p-0"
              : "hidden lg:block lg:w-[356px] lg:flex-none"
          }
        >
          <OpsPanel api={api} tab={opsTab} onTab={setOpsTab} onClose={() => setOpsOpen(false)} />
        </div>
        {opsOpen && (
          <div className="fixed inset-0 z-30 bg-abyss/70 backdrop-blur-[2px] lg:hidden" onClick={() => setOpsOpen(false)} />
        )}
      </div>

      <StatusBar sessionId={api.sessionId} events={api.events} subsystems={api.subsystems} />
    </div>
  );
}
