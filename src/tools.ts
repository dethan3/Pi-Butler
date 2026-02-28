import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
  Storage,
  createTask,
  getTasks,
  updateTask,
  deleteTask,
  createScheduleEvent,
  getScheduleEvents,
  updateScheduleEvent,
  deleteScheduleEvent,
  createNote,
  getNotes,
  updateNote,
  deleteNote,
} from "./storage.js";

// ── Helper ──

const StringEnum = <T extends string[]>(values: [...T], opts?: Record<string, unknown>) =>
  Type.Unsafe<T[number]>({ type: "string", enum: values, ...opts });

// ── Parameter Schemas ──

const manageTasksParams = Type.Object({
  action: StringEnum(["create", "update", "delete"], { description: "The operation to perform" }),
  id: Type.Optional(Type.String({ description: "Task ID (required for update/delete)" })),
  title: Type.Optional(Type.String({ description: "Task title" })),
  description: Type.Optional(Type.String({ description: "Task description" })),
  priority: Type.Optional(StringEnum(["high", "medium", "low"], { description: "Task priority" })),
  status: Type.Optional(
    StringEnum(["pending", "in_progress", "completed"], { description: "Task status" }),
  ),
  dueDate: Type.Optional(Type.String({ description: "Due date in ISO format (YYYY-MM-DD)" })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for categorization" })),
});

const listTasksParams = Type.Object({
  status: Type.Optional(
    StringEnum(["pending", "in_progress", "completed"], { description: "Filter by status" }),
  ),
  priority: Type.Optional(
    StringEnum(["high", "medium", "low"], { description: "Filter by priority" }),
  ),
  tag: Type.Optional(Type.String({ description: "Filter by tag" })),
});

const manageScheduleParams = Type.Object({
  action: StringEnum(["create", "update", "delete"], { description: "The operation to perform" }),
  id: Type.Optional(Type.String({ description: "Event ID (required for update/delete)" })),
  title: Type.Optional(Type.String({ description: "Event title" })),
  description: Type.Optional(Type.String({ description: "Event description" })),
  startTime: Type.Optional(
    Type.String({ description: "Start time in ISO format (e.g. 2025-03-01T09:00:00)" }),
  ),
  endTime: Type.Optional(Type.String({ description: "End time in ISO format" })),
  location: Type.Optional(Type.String({ description: "Event location" })),
});

const listScheduleParams = Type.Object({
  from: Type.Optional(Type.String({ description: "Start date filter (YYYY-MM-DD)" })),
  to: Type.Optional(Type.String({ description: "End date filter (YYYY-MM-DD)" })),
});

const manageNotesParams = Type.Object({
  action: StringEnum(["create", "update", "delete"], { description: "The operation to perform" }),
  id: Type.Optional(Type.String({ description: "Note ID (required for update/delete)" })),
  title: Type.Optional(Type.String({ description: "Note title" })),
  content: Type.Optional(Type.String({ description: "Note content (markdown supported)" })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for categorization" })),
});

const searchNotesParams = Type.Object({
  keyword: Type.Optional(Type.String({ description: "Search keyword" })),
  tag: Type.Optional(Type.String({ description: "Filter by tag" })),
});

const dailySummaryParams = Type.Object({});

const currentTimeParams = Type.Object({
  timezone: Type.Optional(
    Type.String({ description: "Timezone (e.g. Asia/Shanghai, America/New_York). Defaults to local." }),
  ),
});

// ── Task Tools ──

export const manageTasksTool: AgentTool<typeof manageTasksParams> = {
  name: "manage_tasks",
  label: "Manage Tasks",
  description:
    "Create, update, or delete a task. Use action='create' to add a new task, 'update' to modify an existing one, 'delete' to remove one.",
  parameters: manageTasksParams,
  execute: async (_toolCallId, params) => {
    switch (params.action) {
      case "create": {
        if (!params.title) throw new Error("title is required for creating a task");
        const task = createTask({
          title: params.title,
          description: params.description ?? "",
          priority: params.priority ?? "medium",
          status: params.status ?? "pending",
          dueDate: params.dueDate,
          tags: params.tags ?? [],
        });
        return {
          content: [{ type: "text", text: `Task created successfully:\n${JSON.stringify(task, null, 2)}` }],
          details: { taskId: task.id },
        };
      }
      case "update": {
        if (!params.id) throw new Error("id is required for updating a task");
        const updates: Record<string, unknown> = {};
        if (params.title !== undefined) updates.title = params.title;
        if (params.description !== undefined) updates.description = params.description;
        if (params.priority !== undefined) updates.priority = params.priority;
        if (params.status !== undefined) updates.status = params.status;
        if (params.dueDate !== undefined) updates.dueDate = params.dueDate;
        if (params.tags !== undefined) updates.tags = params.tags;
        const task = updateTask(params.id, updates);
        if (!task) throw new Error(`Task with id '${params.id}' not found`);
        return {
          content: [{ type: "text", text: `Task updated:\n${JSON.stringify(task, null, 2)}` }],
          details: { taskId: task.id },
        };
      }
      case "delete": {
        if (!params.id) throw new Error("id is required for deleting a task");
        const ok = deleteTask(params.id);
        if (!ok) throw new Error(`Task with id '${params.id}' not found`);
        return {
          content: [{ type: "text", text: `Task '${params.id}' deleted.` }],
          details: {},
        };
      }
      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  },
};

export const listTasksTool: AgentTool<typeof listTasksParams> = {
  name: "list_tasks",
  label: "List Tasks",
  description:
    "List tasks with optional filters. Returns all tasks if no filters are provided.",
  parameters: listTasksParams,
  execute: async (_toolCallId, params) => {
    let tasks = getTasks();
    if (params.status) tasks = tasks.filter((t) => t.status === params.status);
    if (params.priority) tasks = tasks.filter((t) => t.priority === params.priority);
    if (params.tag) { const tag = params.tag; tasks = tasks.filter((t) => t.tags.includes(tag)); }

    if (tasks.length === 0) {
      return {
        content: [{ type: "text", text: "No tasks found matching the criteria." }],
        details: { count: 0 },
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
      details: { count: tasks.length },
    };
  },
};

// ── Schedule Tools ──

export const manageScheduleTool: AgentTool<typeof manageScheduleParams> = {
  name: "manage_schedule",
  label: "Manage Schedule",
  description:
    "Create, update, or delete a calendar event. Use action='create' to add, 'update' to modify, 'delete' to remove.",
  parameters: manageScheduleParams,
  execute: async (_toolCallId, params) => {
    switch (params.action) {
      case "create": {
        if (!params.title) throw new Error("title is required for creating an event");
        if (!params.startTime) throw new Error("startTime is required for creating an event");
        const event = createScheduleEvent({
          title: params.title,
          description: params.description ?? "",
          startTime: params.startTime,
          endTime: params.endTime,
          location: params.location,
        });
        return {
          content: [{ type: "text", text: `Event created:\n${JSON.stringify(event, null, 2)}` }],
          details: { eventId: event.id },
        };
      }
      case "update": {
        if (!params.id) throw new Error("id is required for updating an event");
        const updates: Record<string, unknown> = {};
        if (params.title !== undefined) updates.title = params.title;
        if (params.description !== undefined) updates.description = params.description;
        if (params.startTime !== undefined) updates.startTime = params.startTime;
        if (params.endTime !== undefined) updates.endTime = params.endTime;
        if (params.location !== undefined) updates.location = params.location;
        const event = updateScheduleEvent(params.id, updates);
        if (!event) throw new Error(`Event with id '${params.id}' not found`);
        return {
          content: [{ type: "text", text: `Event updated:\n${JSON.stringify(event, null, 2)}` }],
          details: { eventId: event.id },
        };
      }
      case "delete": {
        if (!params.id) throw new Error("id is required for deleting an event");
        const ok = deleteScheduleEvent(params.id);
        if (!ok) throw new Error(`Event with id '${params.id}' not found`);
        return {
          content: [{ type: "text", text: `Event '${params.id}' deleted.` }],
          details: {},
        };
      }
      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  },
};

export const listScheduleTool: AgentTool<typeof listScheduleParams> = {
  name: "list_schedule",
  label: "List Schedule",
  description:
    "List calendar events. Optionally filter by date range (from/to in ISO date format).",
  parameters: listScheduleParams,
  execute: async (_toolCallId, params) => {
    let events = getScheduleEvents();
    if (params.from) {
      const fromDate = new Date(params.from);
      events = events.filter((e) => new Date(e.startTime) >= fromDate);
    }
    if (params.to) {
      const toDate = new Date(params.to + "T23:59:59");
      events = events.filter((e) => new Date(e.startTime) <= toDate);
    }
    events.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    if (events.length === 0) {
      return {
        content: [{ type: "text", text: "No events found in the specified range." }],
        details: { count: 0 },
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(events, null, 2) }],
      details: { count: events.length },
    };
  },
};

// ── Note Tools ──

export const manageNotesTool: AgentTool<typeof manageNotesParams> = {
  name: "manage_notes",
  label: "Manage Notes",
  description:
    "Create, update, or delete a note. Use action='create' to add, 'update' to modify, 'delete' to remove.",
  parameters: manageNotesParams,
  execute: async (_toolCallId, params) => {
    switch (params.action) {
      case "create": {
        if (!params.title) throw new Error("title is required for creating a note");
        const note = createNote({
          title: params.title,
          content: params.content ?? "",
          tags: params.tags ?? [],
        });
        return {
          content: [{ type: "text", text: `Note created:\n${JSON.stringify(note, null, 2)}` }],
          details: { noteId: note.id },
        };
      }
      case "update": {
        if (!params.id) throw new Error("id is required for updating a note");
        const updates: Record<string, unknown> = {};
        if (params.title !== undefined) updates.title = params.title;
        if (params.content !== undefined) updates.content = params.content;
        if (params.tags !== undefined) updates.tags = params.tags;
        const note = updateNote(params.id, updates);
        if (!note) throw new Error(`Note with id '${params.id}' not found`);
        return {
          content: [{ type: "text", text: `Note updated:\n${JSON.stringify(note, null, 2)}` }],
          details: { noteId: note.id },
        };
      }
      case "delete": {
        if (!params.id) throw new Error("id is required for deleting a note");
        const ok = deleteNote(params.id);
        if (!ok) throw new Error(`Note with id '${params.id}' not found`);
        return {
          content: [{ type: "text", text: `Note '${params.id}' deleted.` }],
          details: {},
        };
      }
      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  },
};

export const searchNotesTool: AgentTool<typeof searchNotesParams> = {
  name: "search_notes",
  label: "Search Notes",
  description: "Search notes by keyword (matches title and content) or by tag.",
  parameters: searchNotesParams,
  execute: async (_toolCallId, params) => {
    let notes = getNotes();
    if (params.keyword) {
      const kw = params.keyword.toLowerCase();
      notes = notes.filter(
        (n) => n.title.toLowerCase().includes(kw) || n.content.toLowerCase().includes(kw),
      );
    }
    if (params.tag) {
      const tag = params.tag;
      notes = notes.filter((n) => n.tags.includes(tag));
    }

    if (notes.length === 0) {
      return {
        content: [{ type: "text", text: "No notes found matching the criteria." }],
        details: { count: 0 },
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(notes, null, 2) }],
      details: { count: notes.length },
    };
  },
};

// ── Daily Summary Tool ──

export const dailySummaryTool: AgentTool<typeof dailySummaryParams> = {
  name: "get_daily_summary",
  label: "Daily Summary",
  description:
    "Get a summary of today's tasks (pending, in-progress, overdue) and upcoming events. Call this when the user asks for a daily briefing or overview.",
  parameters: dailySummaryParams,
  execute: async () => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    const tasks = getTasks();
    const pendingTasks = tasks.filter((t) => t.status === "pending");
    const inProgressTasks = tasks.filter((t) => t.status === "in_progress");
    const overdueTasks = tasks.filter(
      (t) => t.dueDate && t.dueDate < todayStr && t.status !== "completed",
    );
    const dueTodayTasks = tasks.filter((t) => t.dueDate?.startsWith(todayStr));

    const events = getScheduleEvents();
    const todayEvents = events.filter((e) => e.startTime.startsWith(todayStr));
    const next7Days = new Date(today);
    next7Days.setDate(next7Days.getDate() + 7);
    const upcomingEvents = events
      .filter((e) => {
        const d = new Date(e.startTime);
        return d >= today && d <= next7Days;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    const summary = {
      date: todayStr,
      tasks: {
        pending: pendingTasks.length,
        inProgress: inProgressTasks.length,
        overdue: overdueTasks,
        dueToday: dueTodayTasks,
      },
      schedule: {
        todayEvents,
        upcomingEvents,
      },
    };

    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      details: { date: todayStr },
    };
  },
};

// ── Current Time Tool ──

export const currentTimeTool: AgentTool<typeof currentTimeParams> = {
  name: "get_current_time",
  label: "Current Time",
  description: "Get the current date and time. Useful for time-aware operations.",
  parameters: currentTimeParams,
  execute: async (_toolCallId, params) => {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      dateStyle: "full",
      timeStyle: "long",
    };
    if (params.timezone) {
      options.timeZone = params.timezone;
    }
    const formatted = now.toLocaleString("en-US", options);
    return {
      content: [{ type: "text", text: `Current time: ${formatted}\nISO: ${now.toISOString()}` }],
      details: {},
    };
  },
};

// ── Export all tools (CLI default — uses default Storage singleton) ──

export const allTools: AgentTool<any>[] = [
  manageTasksTool,
  listTasksTool,
  manageScheduleTool,
  listScheduleTool,
  manageNotesTool,
  searchNotesTool,
  dailySummaryTool,
  currentTimeTool,
];

// ── Factory: create tools bound to a specific Storage instance ──

export function createTools(s: Storage): AgentTool<any>[] {
  const mkManageTasks: AgentTool<typeof manageTasksParams> = {
    ...manageTasksTool,
    execute: async (_toolCallId, params) => {
      switch (params.action) {
        case "create": {
          if (!params.title) throw new Error("title is required for creating a task");
          const task = s.createTask({
            title: params.title, description: params.description ?? "",
            priority: params.priority ?? "medium", status: params.status ?? "pending",
            dueDate: params.dueDate, tags: params.tags ?? [],
          });
          return { content: [{ type: "text", text: `Task created successfully:\n${JSON.stringify(task, null, 2)}` }], details: { taskId: task.id } };
        }
        case "update": {
          if (!params.id) throw new Error("id is required for updating a task");
          const updates: Record<string, unknown> = {};
          if (params.title !== undefined) updates.title = params.title;
          if (params.description !== undefined) updates.description = params.description;
          if (params.priority !== undefined) updates.priority = params.priority;
          if (params.status !== undefined) updates.status = params.status;
          if (params.dueDate !== undefined) updates.dueDate = params.dueDate;
          if (params.tags !== undefined) updates.tags = params.tags;
          const task = s.updateTask(params.id, updates);
          if (!task) throw new Error(`Task with id '${params.id}' not found`);
          return { content: [{ type: "text", text: `Task updated:\n${JSON.stringify(task, null, 2)}` }], details: { taskId: task.id } };
        }
        case "delete": {
          if (!params.id) throw new Error("id is required for deleting a task");
          const ok = s.deleteTask(params.id);
          if (!ok) throw new Error(`Task with id '${params.id}' not found`);
          return { content: [{ type: "text", text: `Task '${params.id}' deleted.` }], details: {} };
        }
        default: throw new Error(`Unknown action: ${params.action}`);
      }
    },
  };

  const mkListTasks: AgentTool<typeof listTasksParams> = {
    ...listTasksTool,
    execute: async (_toolCallId, params) => {
      let tasks = s.getTasks();
      if (params.status) tasks = tasks.filter((t) => t.status === params.status);
      if (params.priority) tasks = tasks.filter((t) => t.priority === params.priority);
      if (params.tag) { const tag = params.tag; tasks = tasks.filter((t) => t.tags.includes(tag)); }
      if (tasks.length === 0) return { content: [{ type: "text", text: "No tasks found matching the criteria." }], details: { count: 0 } };
      return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }], details: { count: tasks.length } };
    },
  };

  const mkManageSchedule: AgentTool<typeof manageScheduleParams> = {
    ...manageScheduleTool,
    execute: async (_toolCallId, params) => {
      switch (params.action) {
        case "create": {
          if (!params.title) throw new Error("title is required for creating an event");
          if (!params.startTime) throw new Error("startTime is required for creating an event");
          const event = s.createScheduleEvent({ title: params.title, description: params.description ?? "", startTime: params.startTime, endTime: params.endTime, location: params.location });
          return { content: [{ type: "text", text: `Event created:\n${JSON.stringify(event, null, 2)}` }], details: { eventId: event.id } };
        }
        case "update": {
          if (!params.id) throw new Error("id is required for updating an event");
          const updates: Record<string, unknown> = {};
          if (params.title !== undefined) updates.title = params.title;
          if (params.description !== undefined) updates.description = params.description;
          if (params.startTime !== undefined) updates.startTime = params.startTime;
          if (params.endTime !== undefined) updates.endTime = params.endTime;
          if (params.location !== undefined) updates.location = params.location;
          const event = s.updateScheduleEvent(params.id, updates);
          if (!event) throw new Error(`Event with id '${params.id}' not found`);
          return { content: [{ type: "text", text: `Event updated:\n${JSON.stringify(event, null, 2)}` }], details: { eventId: event.id } };
        }
        case "delete": {
          if (!params.id) throw new Error("id is required for deleting an event");
          const ok = s.deleteScheduleEvent(params.id);
          if (!ok) throw new Error(`Event with id '${params.id}' not found`);
          return { content: [{ type: "text", text: `Event '${params.id}' deleted.` }], details: {} };
        }
        default: throw new Error(`Unknown action: ${params.action}`);
      }
    },
  };

  const mkListSchedule: AgentTool<typeof listScheduleParams> = {
    ...listScheduleTool,
    execute: async (_toolCallId, params) => {
      let events = s.getScheduleEvents();
      if (params.from) { const fromDate = new Date(params.from); events = events.filter((e) => new Date(e.startTime) >= fromDate); }
      if (params.to) { const toDate = new Date(params.to + "T23:59:59"); events = events.filter((e) => new Date(e.startTime) <= toDate); }
      events.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      if (events.length === 0) return { content: [{ type: "text", text: "No events found in the specified range." }], details: { count: 0 } };
      return { content: [{ type: "text", text: JSON.stringify(events, null, 2) }], details: { count: events.length } };
    },
  };

  const mkManageNotes: AgentTool<typeof manageNotesParams> = {
    ...manageNotesTool,
    execute: async (_toolCallId, params) => {
      switch (params.action) {
        case "create": {
          if (!params.title) throw new Error("title is required for creating a note");
          const note = s.createNote({ title: params.title, content: params.content ?? "", tags: params.tags ?? [] });
          return { content: [{ type: "text", text: `Note created:\n${JSON.stringify(note, null, 2)}` }], details: { noteId: note.id } };
        }
        case "update": {
          if (!params.id) throw new Error("id is required for updating a note");
          const updates: Record<string, unknown> = {};
          if (params.title !== undefined) updates.title = params.title;
          if (params.content !== undefined) updates.content = params.content;
          if (params.tags !== undefined) updates.tags = params.tags;
          const note = s.updateNote(params.id, updates);
          if (!note) throw new Error(`Note with id '${params.id}' not found`);
          return { content: [{ type: "text", text: `Note updated:\n${JSON.stringify(note, null, 2)}` }], details: { noteId: note.id } };
        }
        case "delete": {
          if (!params.id) throw new Error("id is required for deleting a note");
          const ok = s.deleteNote(params.id);
          if (!ok) throw new Error(`Note with id '${params.id}' not found`);
          return { content: [{ type: "text", text: `Note '${params.id}' deleted.` }], details: {} };
        }
        default: throw new Error(`Unknown action: ${params.action}`);
      }
    },
  };

  const mkSearchNotes: AgentTool<typeof searchNotesParams> = {
    ...searchNotesTool,
    execute: async (_toolCallId, params) => {
      let notes = s.getNotes();
      if (params.keyword) { const kw = params.keyword.toLowerCase(); notes = notes.filter((n) => n.title.toLowerCase().includes(kw) || n.content.toLowerCase().includes(kw)); }
      if (params.tag) { const tag = params.tag; notes = notes.filter((n) => n.tags.includes(tag)); }
      if (notes.length === 0) return { content: [{ type: "text", text: "No notes found matching the criteria." }], details: { count: 0 } };
      return { content: [{ type: "text", text: JSON.stringify(notes, null, 2) }], details: { count: notes.length } };
    },
  };

  const mkDailySummary: AgentTool<typeof dailySummaryParams> = {
    ...dailySummaryTool,
    execute: async () => {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const tasks = s.getTasks();
      const pendingTasks = tasks.filter((t) => t.status === "pending");
      const inProgressTasks = tasks.filter((t) => t.status === "in_progress");
      const overdueTasks = tasks.filter((t) => t.dueDate && t.dueDate < todayStr && t.status !== "completed");
      const dueTodayTasks = tasks.filter((t) => t.dueDate?.startsWith(todayStr));
      const events = s.getScheduleEvents();
      const todayEvents = events.filter((e) => e.startTime.startsWith(todayStr));
      const next7Days = new Date(today); next7Days.setDate(next7Days.getDate() + 7);
      const upcomingEvents = events.filter((e) => { const d = new Date(e.startTime); return d >= today && d <= next7Days; }).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      const summary = { date: todayStr, tasks: { pending: pendingTasks.length, inProgress: inProgressTasks.length, overdue: overdueTasks, dueToday: dueTodayTasks }, schedule: { todayEvents, upcomingEvents } };
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }], details: { date: todayStr } };
    },
  };

  return [mkManageTasks, mkListTasks, mkManageSchedule, mkListSchedule, mkManageNotes, mkSearchNotes, mkDailySummary, currentTimeTool];
}
