/* ============================================================
   ULTRON Memory Manager
   One structured memory system for the whole assistant.
   Categories: SHORT_TERM, CONVERSATION, TASK, USER_PREFERENCE,
   FACT, PROJECT, DEVICE, ROUTINE.
   Searchable, scoped, editable, deletable, auditable.
   ============================================================ */

import { uid } from "./eventBus";
import type { MemoryCategory, MemoryEntry } from "./types";

const KEY = "ultron.memory.v2";
const MAX_ENTRIES = 400;

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  "SHORT_TERM",
  "CONVERSATION",
  "TASK",
  "USER_PREFERENCE",
  "FACT",
  "PROJECT",
  "DEVICE",
  "ROUTINE",
];

export class MemoryManager {
  private entries: MemoryEntry[] = [];
  private onChange: (() => void) | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.entries = JSON.parse(raw) as MemoryEntry[];
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

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.entries));
    } catch {
      /* non-fatal */
    }
    this.onChange?.();
  }

  list(): MemoryEntry[] {
    return [...this.entries].sort((a, b) => b.ts - a.ts);
  }

  count(): number {
    return this.entries.length;
  }

  save(
    category: MemoryCategory,
    key: string,
    content: string,
    source: MemoryEntry["source"] = "user"
  ): MemoryEntry {
    const entry: MemoryEntry = {
      id: uid("mem"),
      category,
      key: key.trim().slice(0, 80),
      content: content.trim().slice(0, 600),
      ts: Date.now(),
      source,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries
        .filter((e) => e.pinned)
        .concat(this.entries.filter((e) => !e.pinned))
        .slice(-MAX_ENTRIES);
    }
    this.persist();
    return entry;
  }

  update(id: string, patch: Partial<Pick<MemoryEntry, "key" | "content" | "category" | "pinned">>) {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch);
    this.persist();
  }

  remove(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  clearAll(): number {
    const n = this.entries.length;
    this.entries = [];
    this.persist();
    return n;
  }

  search(query: string, category?: MemoryCategory): MemoryEntry[] {
    const q = query.trim().toLowerCase();
    return this.list().filter((e) => {
      if (category && e.category !== category) return false;
      if (!q) return true;
      return (
        e.key.toLowerCase().includes(q) || e.content.toLowerCase().includes(q)
      );
    });
  }

  /* Recall helper used by the orchestrator — returns a compact,
     honest block the model can quote without hallucinating. */
  recallBlock(query: string): string {
    const hits = this.search(query).slice(0, 6);
    if (hits.length === 0) return "";
    return hits
      .map((h) => `- [${h.category}] ${h.key}: ${h.content}`)
      .join("\n");
  }

  preferencesBlock(): string {
    const prefs = this.entries.filter((e) => e.category === "USER_PREFERENCE");
    if (prefs.length === 0) return "";
    return prefs.map((p) => `- ${p.key}: ${p.content}`).join("\n");
  }
}
