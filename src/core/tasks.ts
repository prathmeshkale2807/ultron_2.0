/* ============================================================
   ULTRON Task Manager
   Definition → trigger → permission → execution → result →
   notification. Tasks persist across restarts; the ticker never
   runs uncontrolled loops — it fires due tasks exactly once.
   ============================================================ */

import { emitEvent, uid } from "./eventBus";
import type { TaskItem } from "./types";

const KEY = "ultron.tasks.v2";

export class TaskManager {
  private items: TaskItem[] = [];
  private onChange: (() => void) | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.items = JSON.parse(raw) as TaskItem[];
    } catch {
      this.items = [];
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
      localStorage.setItem(KEY, JSON.stringify(this.items));
    } catch {
      /* non-fatal */
    }
    this.onChange?.();
  }

  list(): TaskItem[] {
    return [...this.items].sort((a, b) => a.dueAt - b.dueAt);
  }

  pendingCount(): number {
    return this.items.filter((t) => !t.done).length;
  }

  add(label: string, dueAt: number): TaskItem {
    const item: TaskItem = {
      id: uid("task"),
      label: label.trim().slice(0, 140),
      dueAt,
      createdAt: Date.now(),
      done: false,
    };
    this.items.push(item);
    this.persist();
    return item;
  }

  remove(id: string): void {
    this.items = this.items.filter((t) => t.id !== id);
    this.persist();
  }

  /* Returns tasks that just came due (fires once each). */
  tick(now: number): TaskItem[] {
    const due = this.items.filter((t) => !t.done && t.dueAt <= now);
    if (due.length === 0) return [];
    due.forEach((t) => {
      t.done = true;
    });
    this.persist();
    due.forEach((t) =>
      emitEvent("TASK_COMPLETED", "tasks", `Reminder fired — “${t.label}”`)
    );
    return due;
  }

  pruneDone(olderThanMs: number): void {
    const cutoff = Date.now() - olderThanMs;
    const before = this.items.length;
    this.items = this.items.filter((t) => !t.done || t.dueAt > cutoff);
    if (this.items.length !== before) this.persist();
  }
}
