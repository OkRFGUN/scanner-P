import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectAccessControl } from "./policies.js";
import { extractFields, validateFields } from "./extractor.js";
import { backoff, fetchRobotsHint, fetchWithTimeout, fetchWithPlus } from "./httpEngine.js";
import { runPassiveModules } from "./passiveModules.js";
import { runPlusModules, normalizePlusModules, exportToCSV, exportToJSON } from "./plusModules.js";
import { appendAudit, readJson, runPath, safeId, taskPath, toCsv, writeJson } from "./storage.js";

const running = new Map();

export function getRunningTasks() {
  return [...running.keys()];
}

export async function runTask(taskId, options = {}) {
  if (running.has(taskId)) {
    return running.get(taskId);
  }

  const promise = executeTask(taskId, options).finally(() => running.delete(taskId));
  running.set(taskId, promise);
  return promise;
}

async function executeTask(taskId, options) {
  const task = await readJson(taskPath(taskId), null);
  if (!task) {
    throw new Error("Task not found");
  }

  const runId = safeId("run");
  const runDir = runPath(runId);
  await mkdir(runDir, { recursive: true });

  const run = {
    id: runId,
    taskId,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    records: [],
    sourceResults: [],
    pausedSources: [],
    errors: [],
    runDir
  };

  task.status = "running";
  task.updatedAt = new Date().toISOString();
  task.lastRunId = runId;
  await writeJson(taskPath(taskId), task);
  await appendAudit({ action: "task.run.started", level: "info", taskId, runId, sourceCount: task.sources.length, message: `任务开始运行，共 ${task.sources.length} 个来源` });

  const plusModules = task.plusModules || [];
  const hasPlusModules = plusModules.length > 0;

  for (const [index, source] of task.sources.entries()) {
    await appendAudit({
      action: "source.started",
      level: "info",
      taskId,
      runId,
      sourceUrl: source.url,
      sourceIndex: index + 1,
      message: `开始采集 ${source.url}`
    });
    const sourceResult = await processSource(task, source, runDir, index, options, plusModules);
    if (sourceResult.status === "paused") {
      run.sourceResults.push(sourceResult);
      run.pausedSources.push(sourceResult);
      await appendAudit({
        action: "source.paused",
        level: "warn",
        taskId,
        runId,
        sourceUrl: source.url,
        reason: sourceResult.reason,
        signals: sourceResult.signals,
        evidenceDir: sourceResult.evidenceDir,
        message: `来源暂停：${source.url}`
      });
      continue;
    }

    if (sourceResult.status === "failed") {
      run.sourceResults.push(sourceResult);
      run.errors.push(sourceResult);
      await appendAudit({
        action: "source.failed",
        level: "error",
        taskId,
        runId,
        sourceUrl: source.url,
        error: sourceResult.error,
        evidenceDir: sourceResult.evidenceDir,
        message: `来源失败：${source.url}`
      });
      continue;
    }

    run.sourceResults.push(sourceResult);
    run.records.push(sourceResult.record);
    await appendAudit({
      action: "source.success",
      level: "info",
      taskId,
      runId,
      sourceUrl: source.url,
      statusCode: sourceResult.record?.statusCode,
      findings: sourceResult.record?.findings,
      securityScore: sourceResult.record?.securityScore,
      message: `来源成功：${source.url}`
    });
  }

  // Handle plus exports if needed
  if (hasPlusModules) {
    const selectedPlus = new Set(plusModules);
    run.plusResults = {};
    
    if (selectedPlus.has("plus_export_csv")) {
      const csvContent = exportToCSV(run.records);
      await writeFile(path.join(runDir, "results-plus.csv"), csvContent, "utf8");
      run.plusResults.csvExported = true;
    }
    
    if (selectedPlus.has("plus_export_json")) {
      const jsonContent = exportToJSON(run.records);
      await writeFile(path.join(runDir, "results-plus.json"), jsonContent, "utf8");
      run.plusResults.jsonExported = true;
    }
  }

  run.status = run.pausedSources.length ? "paused" : run.errors.length ? "partial_success" : "success";
  run.finishedAt = new Date().toISOString();
  await writeJson(path.join(runDir, "run.json"), run);
  await writeFile(path.join(runDir, "results.json"), `${JSON.stringify(run.records, null, 2)}\n`, "utf8");
  await writeFile(path.join(runDir, "results.csv"), toCsv(run.records), "utf8");

  task.status = run.status;
  task.updatedAt = new Date().toISOString();
  task.lastRunSummary = {
    runId,
    status: run.status,
    records: run.records.length,
    pausedSources: run.pausedSources.length,
    errors: run.errors.length
  };
  if (hasPlusModules) {
    task.lastRunSummary.usedPlus = true;
  }
  await writeJson(taskPath(taskId), task);
  await appendAudit({ action: "task.run.finished", taskId, runId, status: run.status, message: `任务运行结束：${run.status}` });
  return run;
}

async function processSource(task, source, runDir, index, options, plusModules = []) {
  const sourceDir = path.join(runDir, `source_${index + 1}`);
  await mkdir(sourceDir, { recursive: true });

  const settings = task.settings || {};
  const maxRetries = Number(settings.maxRetries ?? 2);
  const timeoutMs = Number(settings.timeoutMs ?? 15000);
  const requestDelayMs = Number(settings.requestDelayMs ?? 1000);
  const failurePauseThreshold = Number(settings.failurePauseThreshold ?? 2);
  const plusOptions = task.plusOptions || {};

  const hasPlusModules = plusModules.length > 0;

  const robots = await fetchRobotsHint(source.url, 5000);
  await writeJson(path.join(sourceDir, "robots-hint.json"), robots);

  let consecutiveFailures = 0;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    if (attempt > 1) {
      await backoff(attempt - 1, requestDelayMs);
    }

    try {
      let response;
      
      if (hasPlusModules) {
        response = await fetchWithPlus(source.url, {
          timeoutMs,
          headers: source.authorizedHeaders || {},
          plusModules,
          plusOptions
        });
      } else {
        response = await fetchWithTimeout(source.url, {
          timeoutMs,
          headers: source.authorizedHeaders || {}
        });
      }

      const context = {
        sourceUrl: source.url,
        finalUrl: response.finalUrl,
        status: response.status,
        attempt,
        durationMs: response.durationMs,
        capturedAt: new Date().toISOString(),
        engine: options.engine || task.engineMode || "http",
        usedPlus: hasPlusModules,
        delayInfo: response.delayInfo
      };
      await writeJson(path.join(sourceDir, `request-${attempt}.json`), context);
      await writeFile(path.join(sourceDir, `snapshot-${attempt}.html`), response.body, "utf8");

      const access = detectAccessControl(response.body, response.status);
      if (access.blocked) {
        await writeFile(path.join(sourceDir, "screenshot.txt"), buildTextScreenshot(response.body), "utf8");
        await writeJson(path.join(sourceDir, "pause-report.json"), {
          reason: "access_control_detected",
          signals: access.signals,
          context,
          nextStep: "Manual review required. Resolve authorization or captcha in an approved browser session, then resume."
        });
        return {
          status: "paused",
          sourceUrl: source.url,
          reason: "access_control_detected",
          signals: access.signals,
          evidenceDir: sourceDir
        };
      }

      if (!response.ok) {
        consecutiveFailures += 1;
        lastError = `HTTP ${response.status}`;
        if (consecutiveFailures >= failurePauseThreshold) {
          return pauseForRepeatedFailure(source.url, sourceDir, lastError);
        }
        continue;
      }

      const record = {
        sourceUrl: source.url,
        capturedAt: context.capturedAt,
        statusCode: response.status,
        finalUrl: response.finalUrl,
        ...extractFields(response.body, task.template),
        usedPlus: hasPlusModules
      };
      const missing = validateFields(record, task.template);
      const analysis = await runPassiveModules({
        sourceUrl: source.url,
        response,
        html: response.body,
        robots,
        selectedModules: task.modules
      });

      let plusAnalysis = null;
      if (hasPlusModules) {
        plusAnalysis = await runPlusModules({
          html: response.body,
          selectedPlusModules: plusModules,
          plusOptions
        });
        await writeJson(path.join(sourceDir, "plus-analysis.json"), plusAnalysis);
        record.plusData = plusAnalysis.modules;
      }

      Object.assign(record, {
        securityScore: analysis.summary.score,
        findings: analysis.summary.findings,
        mediumFindings: analysis.summary.mediumFindings,
        lowFindings: analysis.summary.lowFindings,
        infoFindings: analysis.summary.infoFindings,
        linksFound: analysis.summary.links,
        formsFound: analysis.summary.forms,
        cookiesFound: analysis.summary.cookies
      });
      await writeJson(path.join(sourceDir, "record.json"), { record, missingRequiredFields: missing });
      await writeJson(path.join(sourceDir, "analysis.json"), analysis);
      return {
        status: "success",
        sourceUrl: source.url,
        record,
        analysis,
        plusAnalysis,
        missingRequiredFields: missing
      };
    } catch (error) {
      consecutiveFailures += 1;
      lastError = error.name === "AbortError" ? "timeout" : error.message;
      await writeJson(path.join(sourceDir, `error-${attempt}.json`), {
        sourceUrl: source.url,
        attempt,
        error: lastError,
        at: new Date().toISOString()
      });
      if (consecutiveFailures >= failurePauseThreshold) {
        return pauseForRepeatedFailure(source.url, sourceDir, lastError);
      }
    }
  }

  return {
    status: "failed",
    sourceUrl: source.url,
    error: lastError || "unknown failure",
    evidenceDir: sourceDir
  };
}

async function pauseForRepeatedFailure(sourceUrl, sourceDir, error) {
  await writeJson(path.join(sourceDir, "pause-report.json"), {
    reason: "repeated_failures",
    error,
    nextStep: "Review source availability, authorization, and allowed request rate before resuming."
  });
  return {
    status: "paused",
    sourceUrl,
    reason: "repeated_failures",
    signals: [error],
    evidenceDir: sourceDir
  };
}

function buildTextScreenshot(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}
