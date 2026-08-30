/* ============================================================
   ULTRON Tool Registry — the ONE registry.
   Voice, UI and automation all execute through this surface.
   Every tool declares: schema, risk, category, timeout.
   Execution is validated, sandboxed and timed — the LLM never
   touches the shell, filesystem or network directly.
   ============================================================ */

import { emitEvent } from "./eventBus";
import type { MemoryManager } from "./memory";
import type { TaskManager } from "./tasks";
import type { MemoryCategory, Settings, ToolResult, ToolSpec } from "./types";

export interface ToolContext {
  settings: Settings;
  memory: MemoryManager;
  tasks: TaskManager;
  sessionId: string;
}

/* ---------------- safe expression evaluator ---------------- */

function evalExpression(input: string): number {
  const src = input.replace(/,/g, "").replace(/x/gi, "*").replace(/÷/g, "/").replace(/−/g, "-");
  if (!/^[-+*/%^().\d\s]+$/i.test(src)) throw new Error("Expression contains unsupported characters.");
  const tokens = src.match(/\d+\.?\d*|[-+*/%^()]/g) ?? [];
  if (tokens.length === 0) throw new Error("No expression found.");
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const r = parseFactor();
      if (op === "*") v *= r;
      else if (op === "/") {
        if (r === 0) throw new Error("Division by zero.");
        v /= r;
      } else v %= r;
    }
    return v;
  }
  function parseFactor(): number {
    let sign = 1;
    while (peek() === "-" || peek() === "+") {
      if (next() === "-") sign = -sign;
    }
    let base: number;
    if (peek() === "(") {
      next();
      base = parseExpr();
      if (next() !== ")") throw new Error("Missing closing parenthesis.");
    } else {
      const tok = next();
      base = parseFloat(tok);
      if (Number.isNaN(base)) throw new Error(`Unexpected token “${tok ?? "end"}”.`);
    }
    if (peek() === "^") {
      next();
      const exp = parseFactor();
      base = Math.pow(base, exp);
    }
    return sign * base;
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new Error("Unexpected trailing input.");
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number.");
  return result;
}

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString("en-GB");
  return String(Math.round(n * 10000) / 10000);
}

/* ----------------------- site directory --------------------- */

const SITES: Record<string, { url: string; label: string }> = {
  chrome: { url: "https://www.google.com/webhp", label: "Google (new tab)" },
  google: { url: "https://www.google.com/webhp", label: "Google" },
  youtube: { url: "https://www.youtube.com", label: "YouTube" },
  gmail: { url: "https://mail.google.com", label: "Gmail" },
  github: { url: "https://github.com", label: "GitHub" },
  maps: { url: "https://maps.google.com", label: "Google Maps" },
  spotify: { url: "https://open.spotify.com", label: "Spotify" },
  twitter: { url: "https://x.com", label: "X" },
  x: { url: "https://x.com", label: "X" },
  reddit: { url: "https://www.reddit.com", label: "Reddit" },
  netflix: { url: "https://www.netflix.com", label: "Netflix" },
  linkedin: { url: "https://www.linkedin.com", label: "LinkedIn" },
  whatsapp: { url: "https://web.whatsapp.com", label: "WhatsApp" },
  notion: { url: "https://www.notion.so", label: "Notion" },
  stackoverflow: { url: "https://stackoverflow.com", label: "Stack Overflow" },
  calendar: { url: "https://calendar.google.com", label: "Google Calendar" },
  wikipedia: { url: "https://www.wikipedia.org", label: "Wikipedia" },
  chatgpt: { url: "https://chatgpt.com", label: "ChatGPT" },
};

export function openTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/* ------------------------- registry ------------------------- */

export class ToolRegistry {
  readonly specs: ToolSpec[] = [
    {
      name: "open_site",
      label: "Open Site / App",
      description: "Opens a known web app (Chrome→Google, YouTube, Gmail, GitHub, Spotify…) in a new tab.",
      category: "browser",
      risk: "LOW",
      args: { site: { type: "string", required: true, description: "Site key or URL" } },
      timeoutMs: 5000,
    },
    {
      name: "web_search",
      label: "Web Search",
      description: "Runs a web search for the given query and opens the results.",
      category: "browser",
      risk: "LOW",
      args: { query: { type: "string", required: true, description: "Search query" } },
      timeoutMs: 5000,
    },
    {
      name: "youtube_search",
      label: "YouTube Search",
      description: "Searches YouTube for the given query and opens the results.",
      category: "media",
      risk: "LOW",
      args: { query: { type: "string", required: true, description: "Video / music query" } },
      timeoutMs: 5000,
    },
    {
      name: "get_time",
      label: "Time & Date",
      description: "Returns the current local time and date.",
      category: "system",
      risk: "LOW",
      args: {},
      timeoutMs: 2000,
    },
    {
      name: "math_eval",
      label: "Calculator",
      description: "Safely evaluates an arithmetic expression (+ − × ÷ % ^ and parentheses). No eval().",
      category: "compute",
      risk: "LOW",
      args: { expression: { type: "string", required: true, description: "Arithmetic expression" } },
      timeoutMs: 2000,
    },
    {
      name: "clipboard_write",
      label: "Clipboard Write",
      description: "Copies text to the system clipboard.",
      category: "system",
      risk: "MEDIUM",
      args: { text: { type: "string", required: true, description: "Text to copy" } },
      timeoutMs: 3000,
    },
    {
      name: "memory_save",
      label: "Memory Store",
      description: "Stores a structured memory (preference, fact, project, routine…).",
      category: "memory",
      risk: "LOW",
      args: {
        key: { type: "string", required: true, description: "Short label" },
        content: { type: "string", required: true, description: "Content to remember" },
        category: { type: "string", required: false, description: "Memory category" },
      },
      timeoutMs: 2000,
    },
    {
      name: "memory_recall",
      label: "Memory Recall",
      description: "Searches stored memories for a query and reports honest results.",
      category: "memory",
      risk: "LOW",
      args: { query: { type: "string", required: true, description: "Search query" } },
      timeoutMs: 2000,
    },
    {
      name: "create_reminder",
      label: "Reminder / Task",
      description: "Schedules a reminder that survives restarts and fires on time.",
      category: "automation",
      risk: "MEDIUM",
      args: {
        label: { type: "string", required: true, description: "Reminder text" },
        minutes: { type: "number", required: true, description: "Minutes from now" },
      },
      timeoutMs: 2000,
    },
    {
      name: "system_status",
      label: "System Report",
      description: "Reports ULTRON subsystem health, memory and task state.",
      category: "system",
      risk: "LOW",
      args: {},
      timeoutMs: 3000,
    },
    {
      name: "clear_memory",
      label: "Clear All Memory",
      description: "Irreversibly deletes every stored memory. Always confirmation-gated.",
      category: "memory",
      risk: "CRITICAL",
      args: {},
      timeoutMs: 3000,
    },
  ];

  private ctx: () => ToolContext;
  private healthSnapshot: () => string;

  constructor(ctx: () => ToolContext, healthSnapshot: () => string) {
    this.ctx = ctx;
    this.healthSnapshot = healthSnapshot;
  }

  list(): ToolSpec[] {
    return this.specs;
  }

  get(name: string): ToolSpec | undefined {
    return this.specs.find((s) => s.name === name);
  }

  validate(name: string, rawArgs: Record<string, unknown>): { ok: boolean; errors: string[]; args: Record<string, unknown> } {
    const spec = this.get(name);
    const errors: string[] = [];
    const args: Record<string, unknown> = {};
    if (!spec) return { ok: false, errors: [`Unknown tool “${name}”.`], args };
    for (const [key, argSpec] of Object.entries(spec.args)) {
      const v = rawArgs[key];
      if (v === undefined || v === null || v === "") {
        if (argSpec.required) errors.push(`Missing required argument “${key}”.`);
        continue;
      }
      if (argSpec.type === "number") {
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isNaN(n)) errors.push(`Argument “${key}” must be a number.`);
        else args[key] = n;
      } else {
        if (typeof v !== "string") errors.push(`Argument “${key}” must be a string.`);
        else args[key] = v.slice(0, 500);
      }
    }
    for (const key of Object.keys(rawArgs)) {
      if (!(key in spec.args)) errors.push(`Unexpected argument “${key}” — schema enforced.`);
    }
    return { ok: errors.length === 0, errors, args };
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const spec = this.get(name);
    if (!spec) return { ok: false, summary: `Unknown tool “${name}”.`, speech: "That tool does not exist." };
    const ctx = this.ctx();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<ToolResult>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), spec.timeoutMs);
    });

    try {
      const result = await Promise.race([this.run(name, args, ctx), guard]);
      return result;
    } catch (e) {
      const timedOut = e instanceof Error && e.message === "timeout";
      return {
        ok: false,
        summary: timedOut ? `${name} exceeded its ${spec.timeoutMs} ms budget.` : `Execution failed — ${e instanceof Error ? e.message : "unknown error"}`,
        speech: "That didn't work as expected. I'll try another approach.",
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async run(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    switch (name) {
      case "open_site": {
        const siteKey = String(args.site ?? "").toLowerCase().replace(/\s+/g, "");
        const known = SITES[siteKey];
        const url = known
          ? known.url
          : /^https?:\/\//i.test(String(args.site))
            ? String(args.site)
            : `https://www.${siteKey}.com`;
        openTab(url);
        const label = known ? known.label : siteKey;
        return {
          ok: true,
          summary: `Opened ${label} → ${url}`,
          speech: `Certainly. Opening ${label}.`,
          link: { url, label },
        };
      }
      case "web_search": {
        const q = String(args.query ?? "").trim();
        const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
        openTab(url);
        return {
          ok: true,
          summary: `Web search: “${q}”`,
          speech: `Of course — searching the web for ${q}.`,
          link: { url, label: `Results: ${q}` },
        };
      }
      case "youtube_search": {
        const q = String(args.query ?? "").trim();
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
        openTab(url);
        return {
          ok: true,
          summary: `YouTube search: “${q}”`,
          speech: `Right away — searching YouTube for ${q}.`,
          link: { url, label: `YouTube: ${q}` },
        };
      }
      case "get_time": {
        const now = new Date();
        const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        return {
          ok: true,
          summary: `Local time ${time} — ${date}`,
          speech: `It's ${time}, sir. ${date}.`,
        };
      }
      case "math_eval": {
        const expr = String(args.expression ?? "");
        const value = evalExpression(expr);
        const pretty = `${expr.replace(/\*/g, "×").replace(/\//g, "÷")} = ${fmtNum(value)}`;
        return {
          ok: true,
          summary: pretty,
          speech: `${expr.replace(/\*/g, " times ").replace(/\//g, " divided by ").replace(/\^/g, " to the power of ")} equals ${fmtNum(value)}.`,
          data: { value },
        };
      }
      case "clipboard_write": {
        const text = String(args.text ?? "");
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        return {
          ok: true,
          summary: `Copied ${text.length} characters to clipboard.`,
          speech: "Done. It's on your clipboard.",
        };
      }
      case "memory_save": {
        const catRaw = String(args.category ?? "FACT").toUpperCase();
        const valid: MemoryCategory[] = [
          "SHORT_TERM", "CONVERSATION", "TASK", "USER_PREFERENCE",
          "FACT", "PROJECT", "DEVICE", "ROUTINE",
        ];
        const category: MemoryCategory = (valid as string[]).includes(catRaw)
          ? (catRaw as MemoryCategory)
          : "FACT";
        const entry = ctx.memory.save(
          category,
          String(args.key ?? "note"),
          String(args.content ?? ""),
          "tool"
        );
        emitEvent("MEMORY_WRITE", "memory", `Stored [${entry.category}] ${entry.key}`);
        return {
          ok: true,
          summary: `Memory stored under ${entry.category}: “${entry.key}”.`,
          speech: "Noted. I'll remember that.",
        };
      }
      case "memory_recall": {
        const q = String(args.query ?? "");
        const hits = ctx.memory.search(q).slice(0, 6);
        if (hits.length === 0)
          return {
            ok: true,
            summary: `No stored memories match “${q}”.`,
            speech: `I have nothing on record about ${q || "that"}, sir. I won't pretend otherwise.`,
          };
        const lines = hits.map((h) => `- **${h.key}** [${h.category}] — ${h.content}`);
        return {
          ok: true,
          summary: `Recalled ${hits.length} memor${hits.length === 1 ? "y" : "ies"} for “${q}”:\n${lines.join("\n")}`,
          speech: `I found ${hits.length} ${hits.length === 1 ? "memory" : "memories"} about ${q}. The details are on screen.`,
          data: hits,
        };
      }
      case "create_reminder": {
        const minutes = Math.max(0.1, Number(args.minutes ?? 0));
        const label = String(args.label ?? "your reminder");
        const task = ctx.tasks.add(label, Date.now() + minutes * 60000);
        emitEvent("TASK_CREATED", "tasks", `Reminder scheduled: “${label}” in ${minutes} min`);
        const when =
          minutes >= 60
            ? `${Math.round((minutes / 60) * 10) / 10} hours`
            : minutes >= 1
              ? `${Math.round(minutes)} minute${minutes >= 2 ? "s" : ""}`
              : `${Math.round(minutes * 60)} seconds`;
        return {
          ok: true,
          summary: `Reminder “${label}” due ${new Date(task.dueAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.`,
          speech: `Consider it done, sir. I'll remind you in ${when}.`,
          data: task,
        };
      }
      case "system_status": {
        const snap = this.healthSnapshot();
        return {
          ok: true,
          summary: snap,
          speech: "All primary subsystems are reporting. The full diagnostic is on screen.",
        };
      }
      case "clear_memory": {
        const n = ctx.memory.clearAll();
        return {
          ok: true,
          summary: `Wiped ${n} memories. The slate is clean.`,
          speech: `Done. ${n} memories have been cleared.`,
        };
      }
      default:
        return { ok: false, summary: `No executor for “${name}”.`, speech: "That tool is not available." };
    }
  }
}
