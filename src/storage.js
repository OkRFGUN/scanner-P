import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve("data");
export const TASKS_DIR = path.join(DATA_DIR, "tasks");
export const RUNS_DIR = path.join(DATA_DIR, "runs");
export const AUDIT_FILE = path.join(DATA_DIR, "audit.log.jsonl");

export async function ensureStorage() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(TASKS_DIR, { recursive: true });
  await mkdir(RUNS_DIR, { recursive: true });
}

export function safeId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

export async function readJson(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content);
}

export async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function taskPath(taskId) {
  return path.join(TASKS_DIR, `${taskId}.json`);
}

export function runPath(runId) {
  return path.join(RUNS_DIR, runId);
}

export async function listTasks() {
  await ensureStorage();
  const files = await readdir(TASKS_DIR);
  const tasks = [];
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    tasks.push(await readJson(path.join(TASKS_DIR, file), null));
  }
  return tasks.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listRuns(limit = 50) {
  await ensureStorage();
  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  const runs = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const run = await readJson(path.join(RUNS_DIR, entry.name, "run.json"), null);
    if (run) {
      runs.push({
        id: run.id,
        taskId: run.taskId,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        records: run.records?.length || 0,
        pausedSources: run.pausedSources?.length || 0,
        errors: run.errors?.length || 0,
        runDir: run.runDir
      });
    }
  }
  return runs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, limit);
}

export async function readRun(runId) {
  const dir = runPath(runId);
  const run = await readJson(path.join(dir, "run.json"), null);
  if (!run) {
    return null;
  }
  const results = await readJson(path.join(dir, "results.json"), []);
  return {
    ...run,
    results,
    files: await listRunFiles(runId)
  };
}

export async function listRunFiles(runId) {
  const root = runPath(runId);
  if (!existsSync(root)) {
    return [];
  }
  const files = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        await walk(absolute);
      } else {
        const info = await stat(absolute);
        files.push({ path: relative, size: info.size });
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function resolveRunFile(runId, relativePath) {
  const root = runPath(runId);
  const target = path.resolve(root, relativePath || "");
  if (!target.startsWith(root)) {
    throw new Error("Invalid run file path");
  }
  return target;
}

export async function appendAudit(event) {
  await ensureStorage();
  const record = {
    id: safeId("audit"),
    at: new Date().toISOString(),
    actor: event.actor || "local-user",
    ...event
  };
  await writeFile(AUDIT_FILE, `${JSON.stringify(record)}\n`, { flag: "a" });
  return record;
}

export async function readAudit(limit = 200) {
  if (!existsSync(AUDIT_FILE)) {
    return [];
  }
  const lines = (await readFile(AUDIT_FILE, "utf8")).trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map((line) => JSON.parse(line)).reverse();
}

export async function readLogs(filters = {}) {
  const limit = Number(filters.limit || 500);
  const taskId = filters.taskId || "";
  const runId = filters.runId || "";
  const level = filters.level || "";
  const action = filters.action || "";
  const query = String(filters.q || "").toLowerCase();
  const events = await readAudit(Math.max(limit * 3, 500));
  return events
    .map(enrichLog)
    .filter((event) => !taskId || event.taskId === taskId)
    .filter((event) => !runId || event.runId === runId)
    .filter((event) => !level || event.level === level)
    .filter((event) => !action || event.action === action)
    .filter((event) => !query || JSON.stringify(event).toLowerCase().includes(query))
    .slice(0, limit);
}

function enrichLog(event) {
  const level = event.level || inferLogLevel(event);
  return {
    level,
    message: event.message || buildLogMessage(event),
    ...event,
    level
  };
}

function inferLogLevel(event) {
  if (event.action?.includes("failed")) return "error";
  if (event.action?.includes("paused")) return "warn";
  if (event.status === "paused" || event.status === "partial_success") return "warn";
  if (event.status === "failed") return "error";
  return "info";
}

function buildLogMessage(event) {
  const source = event.sourceUrl ? ` · ${event.sourceUrl}` : "";
  const status = event.status ? ` · ${event.status}` : "";
  const reason = event.reason ? ` · ${event.reason}` : "";
  return `${event.action || "event"}${status}${reason}${source}`;
}

export function toCsv(rows) {
  if (!rows.length) {
    return "";
  }
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    const text = value == null ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [keys.join(","), ...rows.map((row) => keys.map((key) => escape(row[key])).join(","))].join("\n");
}
