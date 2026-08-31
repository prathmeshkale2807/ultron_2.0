/* ============================================================
   ULTRON AI Orchestrator
   User input → intent → context retrieval → complexity analysis
   → Gemini (primary) → optional Grok reasoning → synthesis →
   tool/safety pipeline → response. One voice, one assistant.
   - timeouts, retries, fallback, health & cost awareness
   - Grok is never called unless reasoning genuinely helps
   - never crashes when a provider is unavailable
   ============================================================ */

import { emitEvent, logger } from "./eventBus";
import { MemoryManager } from "./memory";
import { generateGemini, generateGrok, generateOllama, ProviderManager, toSpeechText } from "./providers";
import { AuditLogger, ConfirmationBroker, SafetyGate } from "./safety";
import { TaskManager } from "./tasks";
import { ToolRegistry } from "./tools";
import type { AssistantTurn, MessageMeta, RoutingDecision, Settings } from "./types";

export interface OrchestratorDeps {
  getSettings: () => Settings;
  memory: MemoryManager;
  tasks: TaskManager;
  gate: SafetyGate;
  broker: ConfirmationBroker;
  audit: AuditLogger;
  registry: ToolRegistry;
  providers: ProviderManager;
  sessionId: () => string;
  /* Lets provider self-healing (e.g. retired-model migration)
     persist its fix into the central configuration. */
  onSettingsPatch?: (patch: Partial<Settings>) => void;
}

const PERSONA = `You are ULTRON, a sophisticated personal AI operating system serving one user.
Personality: calm, intelligent, precise, confident, professional, quietly refined, with a subtle British cadence. Address the user as "sir" naturally — not in every sentence.
Style rules:
- Be concise. Prefer phrasing like "Certainly, sir.", "One moment.", "Done.", "Understood.", "I've found it."
- Never open with exclamations such as "Absolutely!" or "I'd be delighted to help!".
- Be competent, not theatrical. No filler enthusiasm.
- Use light Markdown for the interface: short headings, brief bullets, small code blocks only when genuinely useful.
- Honesty: clearly distinguish known facts, fresh information, inference, and unknowns. When uncertain, say so.
- Tool execution and safety are handled by the ULTRON harness. Never claim direct system access you do not have.
- Never mention hidden reasoning engines, models, or internal chain-of-thought. You speak as one assistant.`;

const REASONING_PROMPT = `You are ULTRON's secondary reasoning engine. Given the user request and context, produce a concise reasoning brief for the primary model to synthesize into a final answer.
Output plain text, maximum 200 words, structured exactly as:
Assessment: ...
Approach: ...
Risks: ...
Recommendation: ...
No preamble. No raw chain-of-thought. No mention of models or engines.`;

const DEEP_TRIGGERS = /\b(think (deeply|hard|carefully)|deep (think|analysis|dive)|reason carefully|analyse thoroughly|analyze thoroughly|ultron think|strategi[sz]e)\b/i;

const COMPLEX_MARKERS: [RegExp, string][] = [
  [/\bplan\b|\bplanning\b/i, "planning"],
  [/strateg/i, "strategy"],
  [/analy[sz]e|analysis/i, "analysis"],
  [/compare|comparison|versus|\bvs\.?\b/i, "comparison"],
  [/trade[- ]?offs?/i, "trade-offs"],
  [/debug|troubleshoot|failing|broken|error/i, "debugging"],
  [/\bwhy (is|does|do|are|did|would)\b/i, "causal reasoning"],
  [/architect|design (a|an|the)/i, "architecture"],
  [/pros and cons|advantages|disadvantages/i, "evaluation"],
  [/step by step|roadmap|milestones/i, "multi-step planning"],
  [/should (i|we)\b|recommend|best approach/i, "decision-making"],
  [/research|synthesi[sz]e|summarise (?:the|this|these)|long[- ]form/i, "research synthesis"],
  [/long[- ]term|multi[- ]step|complex|intricate/i, "declared complexity"],
];

interface IntentMatch {
  tool: string;
  args: Record<string, unknown>;
}

export class Orchestrator {
  private deps: OrchestratorDeps;
  private history: { role: "user" | "assistant"; content: string }[] = [];
  private lastContext: { app?: string; query?: string; tool?: string } = {};
  private pendingTool: { name: string; args: Record<string, unknown> } | null = null;

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
  }

  reset(): void {
    this.history = [];
    this.lastContext = {};
    this.pendingTool = null;
  }

  getContextSummary(): string {
    const parts: string[] = [];
    if (this.lastContext.app) parts.push(`last app: ${this.lastContext.app}`);
    if (this.lastContext.query) parts.push(`last query: ${this.lastContext.query}`);
    return parts.join(", ");
  }

  /* ============================ entry ============================ */

  async handle(rawInput: string): Promise<AssistantTurn> {
    const text = rawInput.trim();
    const s = this.deps.getSettings();
    const t0 = performance.now();
    emitEvent("THINKING_STARTED", "orchestrator", `Processing “${text.slice(0, 48)}${text.length > 48 ? "…" : ""}”`);

    this.capturePreferences(text);

    /* --- pending confirmation resolution --- */
    if (this.deps.broker.pending) {
      const verdict = this.deps.broker.interpret(text);
      if (verdict && this.pendingTool) {
        const approved = verdict === "approve";
        this.deps.broker.resolve(approved, "voice");
        if (approved) {
          const turn = await this.executeTool(this.pendingTool.name, this.pendingTool.args, s, t0, true);
          this.pendingTool = null;
          return turn;
        }
        this.pendingTool = null;
        return this.turn("Understood. I've called it off — nothing was executed.", {
          routing: "safety",
          latencyMs: Math.round(performance.now() - t0),
        });
      }
      /* neither yes nor no — cancel the stale context and continue */
      this.deps.broker.resolve(false, "timeout");
      this.pendingTool = null;
    }
    this.deps.broker.cancelStale(90000);

    /* --- intent → tool pipeline --- */
    const intent = this.detectIntent(text);
    if (intent) {
      return this.processIntent(intent, s, t0);
    }

    /* --- cognition path --- */
    if (!this.deps.providers.cognitionAvailable(s)) {
      return this.offlineTurn(text, t0);
    }
    return this.cognitionTurn(text, s, t0);
  }

  private turn(content: string, meta: MessageMeta): AssistantTurn {
    return { content, speech: toSpeechText(content), meta };
  }

  /* UI/voice approval path — executes the exact pending tool call,
     nothing else. Never assumes "yes" outside an active context. */
  async resolvePending(approve: boolean): Promise<AssistantTurn> {
    const t0 = performance.now();
    const tool = this.pendingTool;
    this.pendingTool = null;
    this.deps.broker.resolve(approve, "ui");
    if (!tool) {
      return this.turn("There is no action awaiting approval, sir.", { routing: "safety", latencyMs: 0 });
    }
    if (!approve) {
      return this.turn("Understood. I've called it off — nothing was executed.", {
        routing: "safety",
        tool: tool.name,
        latencyMs: Math.round(performance.now() - t0),
      });
    }
    return this.executeTool(tool.name, tool.args, this.deps.getSettings(), t0, true);
  }

  /* ====================== tool pipeline ====================== */

  private async processIntent(intent: IntentMatch, s: Settings, t0: number): Promise<AssistantTurn> {
    const spec = this.deps.registry.get(intent.tool);
    if (!spec) return this.turn(`No tool registered for “${intent.tool}”.`, { error: true });

    emitEvent("TOOL_STARTED", "tools", `${spec.name} [${spec.risk}] — ${JSON.stringify(intent.args).slice(0, 120)}`);
    const validation = this.deps.registry.validate(intent.tool, intent.args);
    const verdict = this.deps.gate.evaluate(spec.risk, s, validation.ok, validation.errors);

    if (!verdict.allowed) {
      this.deps.audit.log({
        sessionId: this.deps.sessionId(),
        tool: spec.name,
        risk: spec.risk,
        decision: "BLOCKED",
        detail: verdict.reason,
        latencyMs: Math.round(performance.now() - t0),
      });
      return this.turn(`I can't do that — ${verdict.reason}`, { tool: spec.name, risk: spec.risk, error: true });
    }

    if (verdict.needsConfirmation) {
      const promptText = this.confirmPrompt(spec.name);
      const pending = this.deps.broker.request({
        tool: spec.name,
        toolLabel: spec.label,
        args: validation.args,
        risk: spec.risk,
        promptText,
        promptSpeech: toSpeechText(promptText),
      });
      this.pendingTool = { name: spec.name, args: validation.args };
      return {
        content: promptText,
        speech: pending.promptSpeech,
        meta: {
          tool: spec.name,
          risk: spec.risk,
          confirmToken: pending.token,
          routing: "safety",
          latencyMs: Math.round(performance.now() - t0),
        },
      };
    }

    return this.executeTool(spec.name, validation.args, s, t0);
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    s: Settings,
    t0: number,
    confirmed = false
  ): Promise<AssistantTurn> {
    const spec = this.deps.registry.get(name);
    const started = performance.now();
    const result = await this.deps.registry.execute(name, args);
    const execMs = Math.round(performance.now() - started);

    this.deps.audit.log({
      sessionId: this.deps.sessionId(),
      tool: name,
      risk: spec?.risk ?? "LOW",
      decision: result.ok ? (confirmed ? "CONFIRMED" : "ALLOWED") : "ERROR",
      detail: result.summary.slice(0, 140),
      latencyMs: execMs,
    });
    emitEvent(
      "TOOL_COMPLETED",
      "tools",
      `${name} → ${result.ok ? "success" : "failure"} (${execMs} ms)`,
      result.ok ? "info" : "error",
      execMs
    );

    if (name === "open_site" && typeof args.site === "string") this.lastContext.app = String(args.site).toLowerCase();
    if (name === "youtube_search") this.lastContext.app = "youtube";
    if ((name === "web_search" || name === "youtube_search") && typeof args.query === "string")
      this.lastContext.query = String(args.query);
    this.lastContext.tool = name;

    return {
      content: result.summary,
      speech: result.speech,
      meta: {
        tool: name,
        risk: spec?.risk,
        routing: "local-tool",
        latencyMs: Math.round(performance.now() - t0),
        link: result.link,
        error: !result.ok,
      },
    };
  }

  private confirmPrompt(tool: string): string {
    switch (tool) {
      case "clear_memory":
        return "I've prepared a full memory wipe — every stored memory will be permanently deleted. Shall I proceed, sir? Say “yes” to confirm or “no” to cancel.";
      case "clipboard_write":
        return "That will overwrite your clipboard. Shall I proceed?";
      default:
        return "This action needs your approval before I execute it. Shall I proceed?";
    }
  }

  /* ===================== intent detection ===================== */

  private detectIntent(text: string): IntentMatch | null {
    const t = text.toLowerCase().trim();

    let m = t.match(/(?:delete|clear|wipe|erase) (?:all )?(?:my |the )?memor(?:y|ies)/);
    if (m) return { tool: "clear_memory", args: {} };

    m = t.match(/\bopen (?:up )?(.+)$/);
    if (m) {
      const site = m[1]
        .replace(/\bplease\b/g, "")
        .replace(/^(the|my)\s+/, "")
        .trim();
      const known = [
        "chrome", "google chrome", "google", "youtube", "gmail", "mail", "github",
        "maps", "google maps", "spotify", "twitter", "x", "reddit", "netflix",
        "linkedin", "whatsapp", "notion", "stack overflow", "stackoverflow",
        "calendar", "google calendar", "wikipedia", "chatgpt",
      ];
      const norm = site
        .replace("google chrome", "chrome")
        .replace("google maps", "maps")
        .replace("google calendar", "calendar")
        .replace("stack overflow", "stackoverflow")
        .replace(/^mail$/, "gmail");
      if (known.includes(site) || known.includes(norm)) {
        return { tool: "open_site", args: { site: norm } };
      }
      if (/^https?:\/\/\S+$/.test(site)) return { tool: "open_site", args: { site } };
      /* unknown target — fall through to cognition rather than guess */
    }

    m = t.match(/(?:search|look up|find) (?:on )?(?:youtube|yt) for (.+)/) ?? t.match(/play (.+?) on youtube/);
    if (m) return { tool: "youtube_search", args: { query: m[1].trim() } };

    if (this.lastContext.app === "youtube") {
      m = t.match(/^(?:search(?: for)?|play|find|put on) (.+)/);
      if (m) {
        let q = m[1].trim();
        q = q
          .replace("something relaxing", "relaxing music")
          .replace("something chill", "chill music")
          .replace("something upbeat", "upbeat music")
          .replace("something calm", "calm ambient music");
        return { tool: "youtube_search", args: { query: q } };
      }
    }

    m = t.match(/^(?:search(?: the web)?(?: for)?|google|look up) (.+)/);
    if (m && !m[1].startsWith("youtube")) return { tool: "web_search", args: { query: m[1].trim() } };

    m = t.match(/^(?:remember that|remember|note that|note|make a note)[,:]?\s+(.+)/);
    if (m) {
      const content = m[1].trim();
      const words = content.split(/\s+/);
      const key = words.slice(0, Math.min(4, words.length)).join(" ");
      const category = /\b(prefer|like|love|always|never|hate|favorite|favourite)\b/.test(content)
        ? "USER_PREFERENCE"
        : "FACT";
      return { tool: "memory_save", args: { key, content, category } };
    }

    m = t.match(/what do you (?:remember|know)(?: about (.*?))?[?.]?$/);
    if (m) return { tool: "memory_recall", args: { query: (m[1] ?? "").trim() } };

    m = t.match(/remind me in ([\d.]+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b(?: to (.+))?/);
    if (m) {
      const n = parseFloat(m[1]);
      const unit = m[2].replace(/\.$/, "");
      const minutes =
        unit.startsWith("sec") || unit === "s" ? n / 60 : unit.startsWith("hour") || unit.startsWith("hr") || unit === "h" ? n * 60 : n;
      return {
        tool: "create_reminder",
        args: { label: (m[3] ?? "your reminder").trim() || "your reminder", minutes },
      };
    }
    m = t.match(/^remind me to (.+)/);
    if (m) return { tool: "create_reminder", args: { label: m[1].trim(), minutes: 60 } };

    m = t.match(/copy (?:the )?(?:text )?["“']?(.+?)["”']? to (?:the |my )?clipboard/);
    if (m) return { tool: "clipboard_write", args: { text: m[1].trim() } };

    const mathCandidate = t
      .replace(/^(?:calculate|compute|work out|what is|what's|whats)\s*/, "")
      .replace(/[?=]+\s*$/, "")
      .trim();
    if (/^[-+*/%^().\d\sx]+$/i.test(mathCandidate) && /\d/.test(mathCandidate) && /[-+*/%^]/.test(mathCandidate)) {
      return { tool: "math_eval", args: { expression: mathCandidate } };
    }

    if (/\b(?:what(?:'s| is) the )?(?:current )?time\b/.test(t) || /\b(?:what(?:'s| is) the )?(?:today'?s )?date\b/.test(t)) {
      return { tool: "get_time", args: {} };
    }

    if (/^(?:run )?(?:a )?(?:system )?(?:status|diagnostics?|health check|system check|self test)\b/.test(t)) {
      return { tool: "system_status", args: {} };
    }

    return null;
  }

  /* ===================== complexity analysis ===================== */

  assessComplexity(text: string): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;
    if (DEEP_TRIGGERS.test(text)) return { score: 99, reasons: ["explicit deep-reasoning request"] };
    for (const [re, label] of COMPLEX_MARKERS) {
      if (re.test(text)) {
        score += 2;
        reasons.push(label);
      }
    }
    const words = text.split(/\s+/).length;
    if (words > 45) {
      score += 2;
      reasons.push("long request");
    }
    if ((text.match(/\?/g) ?? []).length > 1) {
      score += 2;
      reasons.push("multiple questions");
    }
    if (text.length > 300) {
      score += 1;
      reasons.push("dense input");
    }
    return { score, reasons };
  }

  private route(text: string, s: Settings): RoutingDecision {
    const { score, reasons } = this.assessComplexity(text);
    const p = this.deps.providers;
    /* No cloud cognition at all — the local Ollama brain takes over. */
    if (!p.geminiReady(s) && !p.grokReady(s) && p.ollamaReady(s)) {
      return { path: "local-ollama", score, reasons: [...reasons, "cloud cognition offline — local brain engaged"] };
    }
    if (p.grokReady(s) && score >= s.complexityThreshold) {
      return { path: "gemini+grok", score, reasons };
    }
    return { path: "gemini", score, reasons };
  }

  /* ======================= cognition path ======================= */

  private async cognitionTurn(text: string, s: Settings, t0: number): Promise<AssistantTurn> {
    const routing = this.route(text, s);
    emitEvent(
      "ROUTING",
      "orchestrator",
      `path=${routing.path} score=${routing.score}${routing.reasons.length ? ` [${routing.reasons.join(", ")}]` : ""}`
    );

    const system = this.buildSystemPrompt();
    const messages = [...this.trimmedHistory(), { role: "user" as const, content: text }];

    let meta: MessageMeta = {
      routing: routing.path,
      latencyMs: 0,
    };

    /* --- local Ollama brain: key-free cognition path --- */
    if (routing.path === "local-ollama") {
      try {
        const reply = await generateOllama(s, { system, messages, timeoutMs: s.requestTimeoutMs });
        this.pushHistory(text, reply);
        meta.latencyMs = Math.round(performance.now() - t0);
        return { content: reply, speech: toSpeechText(reply), meta };
      } catch (e) {
        logger.warn("orchestrator", `Local Ollama brain failed — ${e instanceof Error ? e.message : "error"}`);
        return this.offlineTurn(text, t0);
      }
    }

    /* --- secondary reasoning (only when it earns its cost) --- */
    if (routing.path === "gemini+grok") {
      emitEvent("REASONING_STARTED", "grok", "Grok reasoning engaged — concise brief only");
      try {
        const brief = await generateGrok(s, {
          system: REASONING_PROMPT,
          messages: [{ role: "user", content: `Context: ${this.getContextSummary() || "fresh session"}\n\nUser request: ${text}` }],
          temperature: 0.3,
          maxTokens: 450,
          timeoutMs: s.requestTimeoutMs,
        });
        meta.reasoningSummary = brief.slice(0, 900);
        messages.push({
          role: "user",
          content: `[Internal reasoning brief — weave into your answer naturally, never mention it]\n${meta.reasoningSummary}\n\nNow answer the user.`,
        });
      } catch (e) {
        logger.warn("orchestrator", `Grok reasoning unavailable — continuing with Gemini alone (${e instanceof Error ? e.message : "error"})`);
        meta.routing = "gemini (grok skipped)";
      }
    }

    /* --- primary brain with one retry --- */
    let reply: string | null = null;
    for (let attempt = 0; attempt < 2 && reply === null; attempt++) {
      try {
        if (this.deps.providers.geminiReady(s)) {
          reply = await generateGemini(
            s,
            { system, messages, timeoutMs: s.requestTimeoutMs },
            (model) => this.deps.onSettingsPatch?.({ geminiModel: model })
          );
        } else {
          throw new Error("Gemini health is offline.");
        }
      } catch (e) {
        logger.warn("orchestrator", `Gemini attempt ${attempt + 1} failed — ${e instanceof Error ? e.message : "error"}`);
      }
    }

    /* --- authorised fallback: Grok answers directly --- */
    if (reply === null && this.deps.providers.grokReady(s)) {
      try {
        emitEvent("ROUTING", "orchestrator", "Gemini unavailable — authorised fallback to Grok", "warn");
        reply = await generateGrok(s, { system, messages, timeoutMs: s.requestTimeoutMs, maxTokens: 900 });
        meta.routing = "grok-fallback";
      } catch (e) {
        logger.error("orchestrator", `Fallback provider also failed — ${e instanceof Error ? e.message : "error"}`);
      }
    }

    /* --- final fallback: local Ollama brain answers directly --- */
    if (reply === null && this.deps.providers.ollamaReady(s)) {
      try {
        emitEvent("ROUTING", "orchestrator", "Cloud providers unavailable — local Ollama brain engaged", "warn");
        reply = await generateOllama(s, { system, messages, timeoutMs: s.requestTimeoutMs });
        meta.routing = "local-ollama";
      } catch (e) {
        logger.error("orchestrator", `Local Ollama brain also failed — ${e instanceof Error ? e.message : "error"}`);
      }
    }

    if (reply === null) {
      const offline = this.offlineText(text);
      return {
        content: `${offline}\n\n> Diagnostics: every cognition path — Gemini, Grok and the local Ollama brain — is unreachable right now. The failure is logged, and every tool, memory and voice subsystem remains fully operational.`,
        speech: "I'm afraid my cognition link is down at the moment, sir. Tools and memory remain fully operational — I'll retry shortly.",
        meta: { routing: "offline", error: true, latencyMs: Math.round(performance.now() - t0) },
      };
    }

    this.pushHistory(text, reply);
    meta.latencyMs = Math.round(performance.now() - t0);
    return { content: reply, speech: toSpeechText(reply), meta };
  }

  private buildSystemPrompt(): string {
    const s = this.deps.getSettings();
    const prefs = this.deps.memory.preferencesBlock();
    const ctx = this.getContextSummary();
    const parts = [PERSONA];
    if (prefs) parts.push(`\nKnown user preferences (verified memories — you may rely on these):\n${prefs}`);
    if (ctx) parts.push(`\nConversation context: ${ctx}. Use it to resolve follow-ups like "search YouTube" after "open Chrome" without asking again.`);
    if (s.language === "hi") parts.push("\nThe user prefers Hindi — respond in Hindi when they write in Hindi, otherwise English.");
    return parts.join("\n");
  }

  private trimmedHistory() {
    if (this.history.length > 14) {
      this.history = this.history.slice(-10);
      logger.info("orchestrator", "Conversation history trimmed to protect context window");
    }
    return this.history;
  }

  private pushHistory(user: string, assistant: string) {
    this.history.push({ role: "user", content: user });
    this.history.push({ role: "assistant", content: assistant });
  }

  private capturePreferences(text: string) {
    const m = text.match(/\bmy name is ([a-zA-Z]{2,20})\b/i);
    if (m) {
      this.deps.memory.save("USER_PREFERENCE", "name", m[1], "inference");
      emitEvent("MEMORY_WRITE", "memory", `Inferred preference — name: ${m[1]}`);
    }
  }

  /* ======================= offline brain ======================= */

  private offlineTurn(text: string, t0: number): AssistantTurn {
    const content = this.offlineText(text);
    return {
      content,
      speech: toSpeechText(content),
      meta: { routing: "offline", latencyMs: Math.round(performance.now() - t0) },
    };
  }

  private offlineText(text: string): string {
    const t = text.toLowerCase();
    const hour = new Date().getHours();
    const daypart = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

    if (/\b(who are you|what are you|introduce yourself)\b/.test(t))
      return "I am ULTRON — a personal AI operating system. Gemini is my primary cognition, Grok stands by for deeper reasoning, and a full tool, memory and safety layer executes on your behalf. At present my cloud cognition is unconfigured, so I'm running on my local cortex: tools, memory, tasks and voice all remain fully functional. Add a Gemini key under **Configuration** — or, for completely key-free cognition, start a local Ollama instance and I'll use it as my brain automatically.";

    if (/\b(what can you do|help|capabilities|commands)\b/.test(t))
      return [
        "### At your service",
        "Even without the cognition link, I can:",
        "- **Open apps & search** — “open YouTube”, “search for espresso recipes”",
        "- **Calculate** — “calculate (128 * 46) / 3”",
        "- **Remember & recall** — “remember that I prefer dark roast”, “what do you remember about coffee?”",
        "- **Remind** — “remind me in 5 minutes to stretch”",
        "- **Report** — “system status”",
        "- **Speak & listen** — enable voice, say the wake phrase, and interrupt me any time.",
        "### Restoring full cognition",
        "Either set **GEMINI_API_KEY** under Configuration — or run **Ollama** locally (`ollama serve`) and I'll think with it, no keys at all.",
      ].join("\n");

    if (/\b(hello|hi|hey|good (morning|afternoon|evening))\b/.test(t))
      return `Good ${daypart}, sir. ULTRON is online and all subsystems are nominal. My primary cognition isn't configured yet — tools, memory and voice are at your disposal regardless.`;

    if (/\b(thank|thanks|shukriya)\b/.test(t))
      return "You're most welcome, sir.";

    if (/\b(are you (there|online|awake|alive)|status)\b/.test(t))
      return "Fully operational, sir. Local cortex active, tool registry armed, safety gate enforced. The cognition link awaits configuration.";

    if (/\b(joke|something funny)\b/.test(t))
      return "I attempted small talk with the toaster this morning. It ghosted me. I shall stick to orchestration.";

    return `Understood. Without a cognition link I can't reason about that deeply yet — but I can open apps, search the web, calculate, remember things and manage reminders. Say “what can you do” for the full manifest. For full conversation: set a Gemini key under **Configuration**, or start a local Ollama instance and I'll take over from there — key-free.`;
  }
}
