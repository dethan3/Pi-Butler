import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_DATA_DIR = join(homedir(), ".pi-butler", "data");

export function getUserDataDir(channel: string, userId: string): string {
  return join(DEFAULT_DATA_DIR, "users", `${channel}_${userId}`);
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Storage class (per-user instance) ──

export class Storage {
  constructor(public readonly dataDir: string = DEFAULT_DATA_DIR) {}

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private filePath(name: string): string {
    this.ensureDir();
    return join(this.dataDir, name);
  }

  loadJson<T>(filename: string, fallback: T): T {
    const filepath = this.filePath(filename);
    if (!existsSync(filepath)) {
      return fallback;
    }
    try {
      const raw = readFileSync(filepath, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  saveJson<T>(filename: string, data: T): void {
    const filepath = this.filePath(filename);
    writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
  }

  // Tasks
  getTasks(): Task[] { return this.loadJson<Task[]>("tasks.json", []); }
  saveTasks(tasks: Task[]): void { this.saveJson("tasks.json", tasks); }

  createTask(data: Omit<Task, "id" | "createdAt" | "updatedAt">): Task {
    const tasks = this.getTasks();
    const now = new Date().toISOString();
    const task: Task = { ...data, id: genId(), createdAt: now, updatedAt: now };
    tasks.push(task);
    this.saveTasks(tasks);
    return task;
  }

  updateTask(id: string, updates: Partial<Omit<Task, "id" | "createdAt">>): Task | null {
    const tasks = this.getTasks();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    tasks[idx] = { ...tasks[idx], ...updates, updatedAt: new Date().toISOString() };
    this.saveTasks(tasks);
    return tasks[idx];
  }

  deleteTask(id: string): boolean {
    const tasks = this.getTasks();
    const filtered = tasks.filter((t) => t.id !== id);
    if (filtered.length === tasks.length) return false;
    this.saveTasks(filtered);
    return true;
  }

  // Schedule
  getScheduleEvents(): ScheduleEvent[] { return this.loadJson<ScheduleEvent[]>("schedule.json", []); }
  saveScheduleEvents(events: ScheduleEvent[]): void { this.saveJson("schedule.json", events); }

  createScheduleEvent(data: Omit<ScheduleEvent, "id" | "createdAt" | "updatedAt">): ScheduleEvent {
    const events = this.getScheduleEvents();
    const now = new Date().toISOString();
    const event: ScheduleEvent = { ...data, id: genId(), createdAt: now, updatedAt: now };
    events.push(event);
    this.saveScheduleEvents(events);
    return event;
  }

  updateScheduleEvent(id: string, updates: Partial<Omit<ScheduleEvent, "id" | "createdAt">>): ScheduleEvent | null {
    const events = this.getScheduleEvents();
    const idx = events.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    events[idx] = { ...events[idx], ...updates, updatedAt: new Date().toISOString() };
    this.saveScheduleEvents(events);
    return events[idx];
  }

  deleteScheduleEvent(id: string): boolean {
    const events = this.getScheduleEvents();
    const filtered = events.filter((e) => e.id !== id);
    if (filtered.length === events.length) return false;
    this.saveScheduleEvents(filtered);
    return true;
  }

  // Notes
  getNotes(): Note[] { return this.loadJson<Note[]>("notes.json", []); }
  saveNotes(notes: Note[]): void { this.saveJson("notes.json", notes); }

  createNote(data: Omit<Note, "id" | "createdAt" | "updatedAt">): Note {
    const notes = this.getNotes();
    const now = new Date().toISOString();
    const note: Note = { ...data, id: genId(), createdAt: now, updatedAt: now };
    notes.push(note);
    this.saveNotes(notes);
    return note;
  }

  updateNote(id: string, updates: Partial<Omit<Note, "id" | "createdAt">>): Note | null {
    const notes = this.getNotes();
    const idx = notes.findIndex((n) => n.id === id);
    if (idx === -1) return null;
    notes[idx] = { ...notes[idx], ...updates, updatedAt: new Date().toISOString() };
    this.saveNotes(notes);
    return notes[idx];
  }

  deleteNote(id: string): boolean {
    const notes = this.getNotes();
    const filtered = notes.filter((n) => n.id !== id);
    if (filtered.length === notes.length) return false;
    this.saveNotes(filtered);
    return true;
  }
}

// ── Default singleton for CLI mode ──
const defaultStorage = new Storage();
export function loadJson<T>(filename: string, fallback: T): T { return defaultStorage.loadJson(filename, fallback); }
export function saveJson<T>(filename: string, data: T): void { defaultStorage.saveJson(filename, data); }

// ── Data types ──

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
  dueDate?: string; // ISO date string
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface ScheduleEvent {
  id: string;
  title: string;
  description: string;
  startTime: string; // ISO datetime
  endTime?: string;
  location?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ── Legacy function exports for CLI backward compat ──

export function getTasks(): Task[] { return defaultStorage.getTasks(); }
export function saveTasks(tasks: Task[]): void { defaultStorage.saveTasks(tasks); }
export function createTask(data: Omit<Task, "id" | "createdAt" | "updatedAt">): Task { return defaultStorage.createTask(data); }
export function updateTask(id: string, updates: Partial<Omit<Task, "id" | "createdAt">>): Task | null { return defaultStorage.updateTask(id, updates); }
export function deleteTask(id: string): boolean { return defaultStorage.deleteTask(id); }

export function getScheduleEvents(): ScheduleEvent[] { return defaultStorage.getScheduleEvents(); }
export function saveScheduleEvents(events: ScheduleEvent[]): void { defaultStorage.saveScheduleEvents(events); }
export function createScheduleEvent(data: Omit<ScheduleEvent, "id" | "createdAt" | "updatedAt">): ScheduleEvent { return defaultStorage.createScheduleEvent(data); }
export function updateScheduleEvent(id: string, updates: Partial<Omit<ScheduleEvent, "id" | "createdAt">>): ScheduleEvent | null { return defaultStorage.updateScheduleEvent(id, updates); }
export function deleteScheduleEvent(id: string): boolean { return defaultStorage.deleteScheduleEvent(id); }

export function getNotes(): Note[] { return defaultStorage.getNotes(); }
export function saveNotes(notes: Note[]): void { defaultStorage.saveNotes(notes); }
export function createNote(data: Omit<Note, "id" | "createdAt" | "updatedAt">): Note { return defaultStorage.createNote(data); }
export function updateNote(id: string, updates: Partial<Omit<Note, "id" | "createdAt">>): Note | null { return defaultStorage.updateNote(id, updates); }
export function deleteNote(id: string): boolean { return defaultStorage.deleteNote(id); }
