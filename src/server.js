import http from "node:http";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { getComplianceStatement } from "./policies.js";
import { appendAudit, ensureStorage, listRuns, listTasks, readAudit, readJson, readLogs, readRun, resolveRunFile, safeId, taskPath, runPath, writeJson } from "./storage.js";
import { getRunningTasks, runTask } from "./taskRunner.js";
import { diagnoseUrl, MODULES, normalizeModules } from "./passiveModules.js";
import { PLUS_MODULES, normalizePlusModules } from "./plusModules.js";
import { filterResources, RESOURCE_TYPES } from "./resourceExtractor.js";

const PORT = Number(globalThis.process?.env?.PORT || globalThis.process?.argv?.[2] || 4173);
const PUBLIC_DIR = path.resolve("public");

await ensureStorage();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Compliant Capture Tool running at http://127.0.0.1:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/compliance") {
    sendJson(res, 200, getComplianceStatement());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/modules") {
    sendJson(res, 200, { modules: MODULES });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/plus-modules") {
    sendJson(res, 200, { modules: PLUS_MODULES });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/resource-types") {
    sendJson(res, 200, { types: RESOURCE_TYPES });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/filter-resources") {
    const runId = url.searchParams.get("runId");
    const sourceIndex = parseInt(url.searchParams.get("sourceIndex")) || 0;
    const types = url.searchParams.getAll("type");
    const isInternal = url.searchParams.get("isInternal");
    const search = url.searchParams.get("search");

    try {
      const run = await readRun(runId);
      const analysisPath = path.join(runPath(runId), `source_${sourceIndex + 1}`, "analysis.json");
      
      if (!fs.existsSync(analysisPath)) {
        sendJson(res, 404, { error: "Analysis not found" });
        return;
      }

      const analysis = await readJson(analysisPath);
      let resources = analysis.modules?.resources?.all || [];
      
      const filters = {};
      if (types && types.length > 0) filters.types = types;
      if (isInternal !== null && isInternal !== undefined) filters.isInternal = isInternal === 'true';
      if (search) filters.search = search;

      const filteredResources = filterResources(resources, filters);
      const groupedResources = {};
      for (const type of Object.keys(RESOURCE_TYPES)) {
        groupedResources[type] = filteredResources.filter(r => r.type === type);
      }

      sendJson(res, 200, {
        all: filteredResources,
        grouped: groupedResources,
        total: filteredResources.length,
        byType: Object.fromEntries(
          Object.entries(groupedResources).map(([t, arr]) => [t, arr.length])
        )
      });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/save-resources") {
    let body = '';
    for await (const chunk of req) {
      body += chunk.toString();
    }
    const { runId, sourceIndex, resources } = JSON.parse(body);

    try {
      const run = await readRun(runId);
      
      // 创建资源保存目录
      const resourcesDir = path.join(runPath(runId), 'resources');
      const sourceDir = path.join(resourcesDir, `source_${sourceIndex + 1}`);
      if (!fs.existsSync(resourcesDir)) fs.mkdirSync(resourcesDir, { recursive: true });
      if (!fs.existsSync(sourceDir)) fs.mkdirSync(sourceDir, { recursive: true });

      let savedCount = 0;
      const errors = [];

      for (const resource of resources) {
        try {
          // 解析URL并创建安全的文件名
          const resourceUrl = new URL(resource.url);
          let fileName = resource.fileName;
          
          // 如果文件名为空或有问题，生成一个
          if (!fileName || fileName === 'unknown' || fileName === '') {
            // 从路径中获取文件名
            const pathParts = resourceUrl.pathname.split('/');
            fileName = pathParts[pathParts.length - 1] || `resource_${resource.id}`;
          }
          
          // 清理文件名，移除不安全字符
          fileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
          
          // 添加资源类型到文件名（防止覆盖）
          const ext = path.extname(fileName);
          const baseName = path.basename(fileName, ext) || `resource_${resource.id}`;
          fileName = `${baseName}_${resource.id.substring(0, 8)}${ext}`;
          
          // 根据资源类型创建子目录
          const typeDir = path.join(sourceDir, resource.type);
          if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });
          
          // 保存资源
          const savePath = path.join(typeDir, fileName);
          
          // 下载资源
          const response = await fetch(resource.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          
          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(savePath, buffer);
            savedCount++;
          } else {
            errors.push(`Failed to download ${resource.url}: ${response.status}`);
          }
        } catch (e) {
          errors.push(`Error saving ${resource.url}: ${e.message}`);
        }
      }

      sendJson(res, 200, {
        savedCount,
        savePath: sourceDir,
        totalResources: resources.length,
        errors: errors.slice(0, 10) // 只返回前10个错误
      });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/diagnostics") {
    sendJson(res, 200, await diagnoseUrl(url.searchParams.get("url")));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tasks") {
    sendJson(res, 200, { tasks: await listTasks(), running: getRunningTasks() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tasks") {
    const input = await readBody(req);
    const now = new Date().toISOString();
    const task = {
      id: safeId("task"),
      name: input.name || "Untitled task",
      status: "idle",
      engineMode: input.engineMode || "auto-http",
      sources: normalizeSources(input.sources),
      template: normalizeTemplate(input.template),
      modules: normalizeModules(input.modules),
      settings: normalizeSettings(input.settings),
      notes: input.notes || "",
      createdAt: now,
      updatedAt: now
    };
    // Add plus modules only if they are provided
    if (input.plusModules && input.plusModules.length > 0) {
      task.plusModules = normalizePlusModules(input.plusModules);
    }
    if (input.plusOptions) {
      task.plusOptions = normalizePlusOptions(input.plusOptions);
    }
    await writeJson(taskPath(task.id), task);
    await appendAudit({ action: "task.created", level: "info", taskId: task.id, sourceCount: task.sources.length, message: `创建任务：${task.name}` });
    sendJson(res, 201, { task });
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
  if (req.method === "POST" && runMatch) {
    const run = await runTask(runMatch[1]);
    sendJson(res, 200, { run });
    return;
  }

  const resumeMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/resume$/);
  if (req.method === "POST" && resumeMatch) {
    const task = await readJson(taskPath(resumeMatch[1]), null);
    if (!task) {
      sendJson(res, 404, { error: "Task not found" });
      return;
    }
    task.status = "idle";
    task.updatedAt = new Date().toISOString();
    await writeJson(taskPath(task.id), task);
    await appendAudit({ action: "task.resumed.manually", level: "info", taskId: task.id, message: `人工恢复任务：${task.name}` });
    const run = await runTask(task.id);
    sendJson(res, 200, { run });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/runs") {
    sendJson(res, 200, { runs: await listRuns() });
    return;
  }

  const runFileMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/file$/);
  if (req.method === "GET" && runFileMatch) {
    const filePath = resolveRunFile(runFileMatch[1], url.searchParams.get("path"));
    if (!fs.existsSync(filePath)) {
      sendJson(res, 404, { error: "File not found" });
      return;
    }
    const ext = path.extname(filePath);
    const types = {
      ".json": "application/json; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".csv": "text/csv; charset=utf-8",
      ".txt": "text/plain; charset=utf-8"
    };
    res.writeHead(200, { "content-type": types[ext] || "text/plain; charset=utf-8" });
    res.end(await readFile(filePath, "utf8"));
    return;
  }

  const runDetailMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (req.method === "GET" && runDetailMatch) {
    const run = await readRun(runDetailMatch[1]);
    if (!run) {
      sendJson(res, 404, { error: "Run not found" });
      return;
    }
    sendJson(res, 200, { run });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/audit") {
    sendJson(res, 200, { events: await readAudit() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    sendJson(res, 200, {
      logs: await readLogs({
        limit: url.searchParams.get("limit"),
        taskId: url.searchParams.get("taskId"),
        runId: url.searchParams.get("runId"),
        level: url.searchParams.get("level"),
        action: url.searchParams.get("action"),
        q: url.searchParams.get("q")
      })
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(res, requestedPath) {
  const cleanPath = requestedPath === "/" ? "/index.html" : requestedPath;
  const filePath = path.join(PUBLIC_DIR, cleanPath);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8"
  };
  res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
  res.end(await readFile(filePath));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function normalizeSources(sources) {
  if (Array.isArray(sources)) {
    return sources.filter((source) => source.url).map((source) => ({ url: source.url.trim(), note: source.note || "" }));
  }
  return String(sources || "")
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => ({ url, note: "" }));
}

function normalizeTemplate(template = {}) {
  return {
    name: template.name || "网页基础模板",
    sourceType: template.sourceType || "web",
    fields: Array.isArray(template.fields) && template.fields.length
      ? template.fields
      : [
          { name: "title", type: "text", ruleType: "title", rule: "", required: true, cleaning: ["trim", "collapseWhitespace"] },
          { name: "description", type: "text", ruleType: "meta", rule: "description", required: false, cleaning: ["trim", "collapseWhitespace"] }
        ],
    exportFormat: template.exportFormat || "json,csv"
  };
}

function normalizeSettings(settings = {}) {
  return {
    requestDelayMs: Number(settings.requestDelayMs || 1000),
    maxConcurrency: Number(settings.maxConcurrency || 1),
    timeoutMs: Number(settings.timeoutMs || 15000),
    maxRetries: Number(settings.maxRetries || 2),
    failurePauseThreshold: Number(settings.failurePauseThreshold || 2)
  };
}

function normalizePlusOptions(options = {}) {
  return {
    minDelayMs: Number(options.minDelayMs || 1200),
    maxDelayMs: Number(options.maxDelayMs || 3500),
    customSelectors: options.customSelectors || {},
    proxyList: options.proxyList || []
  };
}
