const form = document.querySelector("#taskForm");
const tasksEl = document.querySelector("#tasks");
const runsEl = document.querySelector("#runs");
const runDetailEl = document.querySelector("#runDetail");
const filePreviewEl = document.querySelector("#filePreview");
const auditEl = document.querySelector("#audit");
const complianceEl = document.querySelector("#compliance");
const diagnosticsEl = document.querySelector("#diagnostics");
const runningBadge = document.querySelector("#runningBadge");
const selectedRunBadge = document.querySelector("#selectedRunBadge");
const refreshBtn = document.querySelector("#refreshBtn");
const sampleBtn = document.querySelector("#sampleBtn");
const exampleBtn = document.querySelector("#exampleBtn");
const diagnoseBtn = document.querySelector("#diagnoseBtn");
const modulePicker = document.querySelector("#modulePicker");
const plusModulePicker = document.querySelector("#plusModulePicker");
const logLevel = document.querySelector("#logLevel");
const logSearch = document.querySelector("#logSearch");
const logRefresh = document.querySelector("#logRefresh");
const logDetail = document.querySelector("#logDetail");
const logStats = document.querySelector("#logStats");
const toast = document.querySelector("#toast");
const resourceViewerEl = document.querySelector("#resourceViewer");
const resourceSearchEl = document.querySelector("#resourceSearch");
const resourceStatsEl = document.querySelector("#resourceStats");
const resourceListEl = document.querySelector("#resourceList");
const typeFiltersEl = document.querySelector("#typeFilters");
const filterInternalEl = document.querySelector("#filterInternal");

let moduleCatalog = [];
let plusModuleCatalog = [];
let currentLogs = [];
let currentRunId = null;
let currentSourceIndex = 0;
let resourceTypes = {};
let selectedResourceTypes = new Set();
let currentResources = [];
let selectedResourceIds = new Set();

const defaultTemplate = {
  name: "网页基础模板",
  sourceType: "web",
  fields: [
    { name: "title", type: "text", ruleType: "title", rule: "", required: true, cleaning: ["trim", "collapseWhitespace"] },
    { name: "description", type: "text", ruleType: "meta", rule: "description", required: false, cleaning: ["trim", "collapseWhitespace"] }
  ],
  exportFormat: "json,csv"
};

form.template.value = JSON.stringify(defaultTemplate, null, 2);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function init() {
  const modules = await api("/api/modules");
  moduleCatalog = modules.modules;
  try {
    const plusModules = await api("/api/plus-modules");
    plusModuleCatalog = plusModules.modules || [];
  } catch (e) {
    plusModuleCatalog = [];
  }
  try {
    const types = await api("/api/resource-types");
    resourceTypes = types.types || {};
    // 初始化选择所有资源类型
    Object.keys(resourceTypes).forEach(type => selectedResourceTypes.add(type));
  } catch (e) {
    resourceTypes = {};
  }
  renderModulePicker();
  renderPlusModulePicker();
  await refresh();
}

function renderModulePicker() {
  modulePicker.innerHTML = moduleCatalog.map((item) => `
    <label class="module-option ${item.id === 'resources' ? 'module-option-highlight' : ''}">
      <input type="checkbox" name="modules" value="${item.id}" checked />
      <span>
        <strong>${escapeHtml(item.label)}${item.id === 'resources' ? ' 🆕 资源提取' : ''}</strong>
        <span>${escapeHtml(item.description)}</span>
      </span>
    </label>
  `).join("");
}

function renderPlusModulePicker() {
  plusModulePicker.innerHTML = plusModuleCatalog.map((item) => `
    <label class="module-option">
      <input type="checkbox" name="plusModules" value="${item.id}" />
      <span>
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(item.description)}</span>
      </span>
    </label>
  `).join("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const values = Object.fromEntries(new FormData(form));
    const payload = {
      name: values.name,
      sources: values.sources,
      notes: values.notes,
      modules: [...form.querySelectorAll('input[name="modules"]:checked')].map((input) => input.value),
      plusModules: [...form.querySelectorAll('input[name="plusModules"]:checked')].map((input) => input.value),
      template: JSON.parse(values.template),
      settings: {
        requestDelayMs: values.requestDelayMs,
        timeoutMs: values.timeoutMs,
        maxRetries: values.maxRetries,
        failurePauseThreshold: values.failurePauseThreshold
      },
      plusOptions: {
        minDelayMs: values.plusMinDelay,
        maxDelayMs: values.plusMaxDelay
      }
    };
    const created = await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
    form.sources.value = "";
    showToast(`已创建任务：${created.task.name}`);
    await refresh();
  } catch (error) {
    showToast(error.message);
  }
});

refreshBtn.addEventListener("click", refresh);
logRefresh.addEventListener("click", loadLogs);
logLevel.addEventListener("change", loadLogs);
logSearch.addEventListener("input", debounce(loadLogs, 250));

sampleBtn.addEventListener("click", () => {
  form.sources.value = `${location.origin}/sample.html`;
  form.name.value = "内置测试页采集";
});

exampleBtn.addEventListener("click", () => {
  form.sources.value = "https://example.com/";
  form.name.value = "example.com 被动侦察";
});

diagnoseBtn.addEventListener("click", diagnoseFirstTarget);

async function refresh() {
  const [{ tasks, running }, { runs }, compliance] = await Promise.all([
    api("/api/tasks"),
    api("/api/runs"),
    api("/api/compliance")
  ]);
  runningBadge.textContent = `${running.length} 运行中`;
  renderTasks(tasks);
  renderRuns(runs);
  renderCompliance(compliance);
  await loadLogs();
}

async function loadLogs(extra = {}) {
  const params = new URLSearchParams({
    limit: "300",
    level: logLevel.value,
    q: logSearch.value,
    ...extra
  });
  const { logs } = await api(`/api/logs?${params}`);
  currentLogs = logs;
  renderLogs(logs);
}

function renderTasks(tasks) {
  tasksEl.innerHTML = "";
  if (!tasks.length) {
    tasksEl.innerHTML = `<p class="meta">还没有任务。填入目标，选择模块，然后创建任务。</p>`;
    return;
  }

  for (const task of tasks) {
    const div = document.createElement("article");
    div.className = "task";
    div.innerHTML = `
      <div class="task-head">
        <div>
          <h3>${escapeHtml(task.name)}</h3>
          <div class="meta">${task.sources.length} 个目标 · ${task.modules?.length || 0} 个模块${task.plusModules?.length ? ` · ${task.plusModules.length} 个 Plus 模块` : ""} · 更新 ${formatTime(task.updatedAt)}</div>
        </div>
        <span class="status">${statusLabel(task.status)}</span>
      </div>
      <div class="meta">${escapeHtml(task.notes || "未填写授权/学习备注")}</div>
      <div class="meta">${taskSummary(task)}</div>
      <div class="actions">
        <button class="secondary" data-run="${task.id}">运行</button>
        <button class="secondary" data-resume="${task.id}">人工处理后继续</button>
        ${task.lastRunId ? `<button class="secondary" data-view="${task.lastRunId}">查看上次结果</button>` : ""}
        ${task.lastRunId && task.modules?.includes('resources') ? `<button class="secondary button-resource" data-view="${task.lastRunId}">📦 查看资源</button>` : ""}
        ${task.lastRunId ? `<button class="secondary" data-run-logs="${task.lastRunId}">查看运行日志</button>` : ""}
      </div>
    `;
    tasksEl.appendChild(div);
  }

  tasksEl.querySelectorAll("[data-run]").forEach((button) => {
    button.addEventListener("click", () => runTask(button.dataset.run, "run"));
  });
  tasksEl.querySelectorAll("[data-resume]").forEach((button) => {
    button.addEventListener("click", () => runTask(button.dataset.resume, "resume"));
  });
  tasksEl.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => loadRun(button.dataset.view));
  });
  tasksEl.querySelectorAll("[data-run-logs]").forEach((button) => {
    button.addEventListener("click", () => showRunLogs(button.dataset.runLogs));
  });
}

function renderRuns(runs) {
  runsEl.innerHTML = "";
  if (!runs.length) {
    runsEl.innerHTML = `<p class="meta">暂无运行结果。</p>`;
    return;
  }
  for (const run of runs.slice(0, 8)) {
    const div = document.createElement("article");
    div.className = "run-card";
    div.innerHTML = `
      <div class="run-head">
        <div>
          <h3>${escapeHtml(run.id)}</h3>
          <div class="meta">${formatTime(run.startedAt)} · 记录 ${run.records} · 暂停 ${run.pausedSources} · 错误 ${run.errors}${run.plusResults ? " · Plus 增强" : ""}</div>
        </div>
        <span class="status">${statusLabel(run.status)}</span>
      </div>
      <div class="actions">
        <button class="secondary" data-open-run="${run.id}">查看详情</button>
        <button class="secondary" data-open-logs="${run.id}">查看日志</button>
      </div>
    `;
    runsEl.appendChild(div);
  }
  runsEl.querySelectorAll("[data-open-run]").forEach((button) => {
    button.addEventListener("click", () => loadRun(button.dataset.openRun));
  });
  runsEl.querySelectorAll("[data-open-logs]").forEach((button) => {
    button.addEventListener("click", () => showRunLogs(button.dataset.openLogs));
  });
}

function renderLogs(logs) {
  const stats = {
    total: logs.length,
    info: logs.filter((log) => log.level === "info").length,
    warn: logs.filter((log) => log.level === "warn").length,
    error: logs.filter((log) => log.level === "error").length
  };
  logStats.innerHTML = `
    <div class="metric"><strong>${stats.total}</strong><span>当前日志</span></div>
    <div class="metric"><strong>${stats.info}</strong><span>Info</span></div>
    <div class="metric"><strong>${stats.warn}</strong><span>Warn</span></div>
    <div class="metric"><strong>${stats.error}</strong><span>Error</span></div>
  `;

  auditEl.innerHTML = logs.map((event, index) => `
    <button class="log-row ${escapeHtml(event.level)}" data-log-index="${index}">
      <span class="log-level">${escapeHtml(event.level)}</span>
      <span>
        <strong>${escapeHtml(event.message || event.action)}</strong>
        <small>${formatTime(event.at)} · ${escapeHtml(event.runId || event.taskId || "")}</small>
        ${event.sourceUrl ? `<small>${escapeHtml(event.sourceUrl)}</small>` : ""}
      </span>
    </button>
  `).join("") || `<p class="meta">暂无日志。运行一次任务后这里会出现时间线。</p>`;

  auditEl.querySelectorAll("[data-log-index]").forEach((button) => {
    button.addEventListener("click", () => selectLog(Number(button.dataset.logIndex)));
  });

  if (logs[0]) {
    selectLog(0);
  } else {
    logDetail.textContent = "没有符合条件的日志。";
  }
}

function selectLog(index) {
  const event = currentLogs[index];
  if (!event) return;
  auditEl.querySelectorAll(".log-row").forEach((row) => row.classList.remove("active"));
  auditEl.querySelector(`[data-log-index="${index}"]`)?.classList.add("active");
  logDetail.textContent = JSON.stringify(event, null, 2);
}

async function showRunLogs(runId) {
  logSearch.value = "";
  logLevel.value = "";
  const { logs } = await api(`/api/logs?limit=300&runId=${encodeURIComponent(runId)}`);
  currentLogs = logs;
  renderLogs(logs);
  document.querySelector(".log-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function runTask(taskId, mode) {
  try {
    showToast("任务运行中，完成后会自动刷新结果。");
    const path = mode === "resume" ? `/api/tasks/${taskId}/resume` : `/api/tasks/${taskId}/run`;
    const result = await api(path, { method: "POST", body: "{}" });
    await refresh();
    await loadRun(result.run.id);
    await showRunLogs(result.run.id);
  } catch (error) {
    showToast(error.message);
  }
}

async function loadRun(runId) {
  const { run } = await api(`/api/runs/${runId}`);
  selectedRunBadge.textContent = statusLabel(run.status);
  selectedRunBadge.className = `badge ${run.status === "paused" ? "warn" : ""}`;
  filePreviewEl.textContent = "";
  runDetailEl.innerHTML = renderRunDetail(run);
  runDetailEl.querySelectorAll("[data-file]").forEach((button) => {
    button.addEventListener("click", () => loadFile(run.id, button.dataset.file));
  });
  
  // 添加查看资源按钮的事件监听
  const showResourcesBtn = document.getElementById('show-resources-btn');
  if (showResourcesBtn) {
    showResourcesBtn.addEventListener('click', async () => {
      await loadResourcesForSource(runId, 0);
      // 滚动到资源查看器
      resourceViewerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  
  // 检查是否有资源数据
  currentRunId = runId;
  currentSourceIndex = 0;
  
  // 检查第一个来源是否有资源数据
  if (run.sourceResults && run.sourceResults.length > 0) {
    // 尝试加载资源，但默认隐藏
    try {
      await loadResourcesForSource(runId, 0);
      resourceViewerEl.style.display = 'none'; // 默认隐藏，点击按钮才显示
    } catch (e) {
      // 资源可能不存在
      resourceViewerEl.style.display = 'none';
    }
  } else {
    resourceViewerEl.style.display = 'none';
  }
}

function renderRunDetail(run) {
  const records = run.records || [];
  const sources = run.sourceResults || [];
  return `
    <div class="score-row">
      <div class="metric"><strong>${records.length}</strong><span>结构化记录</span></div>
      <div class="metric"><strong>${run.pausedSources?.length || 0}</strong><span>需要人工处理</span></div>
      <div class="metric"><strong>${run.errors?.length || 0}</strong><span>错误</span></div>
      <div class="metric"><strong>${escapeHtml(run.id.slice(-8))}</strong><span>运行编号</span></div>
    </div>
    <div class="resources-entry">
      <button class="primary" id="show-resources-btn">📦 查看提取的网页资源</button>
    </div>
    ${records.map(renderRecord).join("") || `<p class="meta">没有成功记录。查看暂停报告或错误文件。</p>`}
    ${sources.map(renderSourceAnalysis).join("")}
    ${renderFiles(run.files || [])}
  `;
}

function renderRecord(record) {
  return `
    <article class="result-card">
      <div class="task-head">
        <div>
          <h3>${escapeHtml(record.title || record.sourceUrl)}</h3>
          <div class="meta">${escapeHtml(record.sourceUrl)} · HTTP ${escapeHtml(record.statusCode || "")}${record.usedPlus ? " · Plus 增强" : ""}</div>
        </div>
        <span class="badge">${record.securityScore ?? "N/A"} 分</span>
      </div>
      <div class="score-row">
        <div class="metric"><strong>${record.findings ?? 0}</strong><span>提示</span></div>
        <div class="metric"><strong>${record.linksFound ?? 0}</strong><span>链接</span></div>
        <div class="metric"><strong>${record.formsFound ?? 0}</strong><span>表单</span></div>
        <div class="metric"><strong>${record.cookiesFound ?? 0}</strong><span>Cookie</span></div>
      </div>
      <p class="meta">${escapeHtml(record.description || "无描述字段")}</p>
    </article>
  `;
}

function renderSourceAnalysis(source) {
  if (!source.analysis) {
    return `
      <article class="result-card">
        <h3>${escapeHtml(source.sourceUrl)}</h3>
        <p class="meta">${statusLabel(source.status)} · ${escapeHtml(source.reason || source.error || "")}</p>
        <p class="meta">证据目录：${escapeHtml(source.evidenceDir || "")}</p>
      </article>
    `;
  }
  const findings = source.analysis.findings || [];
  const modules = source.analysis.modules || {};
  return `
    <article class="result-card">
      <h3>模块分析：${escapeHtml(source.sourceUrl)}</h3>
      <p class="meta">TLS：${formatTls(modules.tls)} · DNS：${dnsAddresses(modules.dns)} · robots：${modules.robots?.available ? "可读取" : "不可读取"}</p>
      ${findings.map((finding) => `
        <div class="finding ${escapeHtml(finding.severity)}">
          <strong>[${escapeHtml(finding.severity)}] ${escapeHtml(finding.title)}</strong>
          <div class="meta">${escapeHtml(finding.detail)}</div>
        </div>
      `).join("") || `<p class="meta">没有发现明显的被动配置提示。</p>`}
    </article>
  `;
}

function renderFiles(files) {
  if (!files.length) return "";
  return `
    <h3>证据文件</h3>
    <div class="file-list">
      ${files.map((file) => `<button data-file="${escapeHtml(file.path)}">${escapeHtml(file.path)} (${file.size}B)</button>`).join("")}
    </div>
  `;
}

async function loadFile(runId, filePath) {
  const response = await fetch(`/api/runs/${runId}/file?path=${encodeURIComponent(filePath)}`);
  filePreviewEl.textContent = await response.text();
}

async function diagnoseFirstTarget() {
  const target = firstTarget();
  if (!target) {
    showToast("先填一个目标 URL。");
    return;
  }
  diagnosticsEl.textContent = "诊断中...";
  try {
    const result = await api(`/api/diagnostics?url=${encodeURIComponent(target)}`);
    diagnosticsEl.innerHTML = `
      <article class="result-card">
        <h3>网络诊断：${escapeHtml(result.url)}</h3>
        <p class="meta">HTTP：${result.http?.status || result.http?.error || "无"} · TLS：${formatTls(result.tls)} · 耗时 ${result.durationMs}ms</p>
        <p class="meta">DNS：${dnsAddresses(result.dns)} · NS：${(result.dns?.ns || []).join(", ") || "无"}</p>
      </article>
    `;
  } catch (error) {
    diagnosticsEl.textContent = error.message;
  }
}

function renderCompliance(compliance) {
  complianceEl.innerHTML = [
    ...compliance.allowed.map((item) => `<span class="chip">${escapeHtml(item)}</span>`),
    ...compliance.disallowed.map((item) => `<span class="chip blocked">不做 ${escapeHtml(item)}</span>`)
  ].join("");
}

function taskSummary(task) {
  const last = task.lastRunSummary;
  if (!last) return "尚未运行。";
  return `上次运行：${statusLabel(last.status)}，记录 ${last.records}，暂停 ${last.pausedSources}，错误 ${last.errors}${last.usedPlus ? " · Plus 增强" : ""}`;
}

function statusLabel(status) {
  return {
    idle: "待运行",
    running: "运行中",
    success: "成功",
    partial_success: "部分成功",
    paused: "需要人工处理",
    failed: "失败"
  }[status] || status;
}

function firstTarget() {
  return form.sources.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
}

function formatTls(tls) {
  if (!tls) return "未检测";
  if (tls.skipped) return tls.reason;
  if (tls.error) return tls.error;
  return tls.authorized ? `${tls.protocol || "TLS"} 有效` : `异常 ${tls.authorizationError || ""}`.trim();
}

function dnsAddresses(dns) {
  const resolved = [...(dns?.a || []), ...(dns?.aaaa || [])];
  const lookup = (dns?.lookup || []).map((item) => item.address);
  return [...new Set([...resolved, ...lookup])].join(", ") || "无";
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString() : "";
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => {
    toast.hidden = true;
  }, 3600);
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

async function loadResourcesForSource(runId, sourceIndex) {
  const params = new URLSearchParams();
  params.set('runId', runId);
  params.set('sourceIndex', sourceIndex);
  selectedResourceTypes.forEach(type => params.append('type', type));
  if (filterInternalEl.checked) params.set('isInternal', 'true');
  if (resourceSearchEl.value) params.set('search', resourceSearchEl.value);

  const result = await api(`/api/filter-resources?${params}`);
  currentResources = result.all;
  renderTypeFilters(result.byType);
  renderResourceStats(result);
  renderResourceList(result);
  resourceViewerEl.style.display = 'block';
  
  // 添加按钮事件
  const closeBtn = document.getElementById('close-resources-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      resourceViewerEl.style.display = 'none';
    };
  }
  
  const selectAllBtn = document.getElementById('select-all-btn');
  if (selectAllBtn) {
    selectAllBtn.onclick = selectAllResources;
  }
  
  const deselectAllBtn = document.getElementById('deselect-all-btn');
  if (deselectAllBtn) {
    deselectAllBtn.onclick = deselectAllResources;
  }
  
  const saveSelectedBtn = document.getElementById('save-selected-btn');
  if (saveSelectedBtn) {
    saveSelectedBtn.onclick = saveSelectedResources;
  }
}

function renderTypeFilters(countsByType) {
  typeFiltersEl.innerHTML = Object.entries(resourceTypes).map(([type, config]) => {
    const count = countsByType[type] || 0;
    const isSelected = selectedResourceTypes.has(type);
    return `
      <label class="type-filter ${isSelected ? 'active' : ''}">
        <input type="checkbox" value="${type}" ${isSelected ? 'checked' : ''} />
        <span>${config.name} (${count})</span>
      </label>
    `;
  }).join('');

  typeFiltersEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedResourceTypes.add(e.target.value);
      } else {
        selectedResourceTypes.delete(e.target.value);
      }
      if (currentRunId !== null) {
        loadResourcesForSource(currentRunId, currentSourceIndex);
      }
    });
  });
}

function renderResourceStats(result) {
  resourceStatsEl.innerHTML = `
    <div class="resource-stat">
      <strong>${result.total}</strong>
      <span>资源总数</span>
    </div>
    ${Object.entries(result.byType).map(([type, count]) => `
      <div class="resource-stat">
        <strong>${count}</strong>
        <span>${resourceTypes[type]?.name || type}</span>
      </div>
    `).join('')}
  `;
}

function renderResourceList(result) {
  if (result.all.length === 0) {
    resourceListEl.innerHTML = '<p class="meta">没有符合条件的资源</p>';
    return;
  }

  let html = '';
  for (const [type, resources] of Object.entries(result.grouped)) {
    if (resources.length === 0) continue;
    
    html += `
      <div class="resource-group">
        <h4 class="resource-group-title">${resourceTypes[type]?.name || type} (${resources.length})</h4>
        <div class="resource-items">
          ${resources.map(renderResourceItem).join('')}
        </div>
      </div>
    `;
  }
  resourceListEl.innerHTML = html;
  
  // 添加复选框事件监听器
  resourceListEl.querySelectorAll('.resource-checkbox-input').forEach(checkbox => {
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = checkbox.closest('.resource-item');
      const resourceId = item.dataset.resourceId;
      
      if (checkbox.checked) {
        selectedResourceIds.add(resourceId);
        item.classList.add('selected');
      } else {
        selectedResourceIds.delete(resourceId);
        item.classList.remove('selected');
      }
      
      updateSelectedCount();
    });
  });
  
  // 添加资源项点击事件（不包括复选框）
  resourceListEl.querySelectorAll('.resource-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (!e.target.classList.contains('resource-checkbox-input')) {
        const url = item.dataset.url;
        if (url) window.open(url, '_blank');
      }
    });
  });
  
  updateSelectedCount();
}

function updateSelectedCount() {
  const countEl = document.getElementById('selectedCount');
  const countNumEl = document.getElementById('selectedCountNum');
  
  if (selectedResourceIds.size > 0) {
    countEl.style.display = 'block';
    countNumEl.textContent = selectedResourceIds.size;
  } else {
    countEl.style.display = 'none';
  }
}

function selectAllResources() {
  currentResources.forEach(r => selectedResourceIds.add(r.id));
  // 重新渲染以更新UI
  const resourceIds = Array.from(selectedResourceIds);
  const result = {
    all: currentResources,
    grouped: {}
  };
  for (const type of Object.keys(resourceTypes)) {
    result.grouped[type] = currentResources.filter(r => r.type === type);
  }
  renderResourceList(result);
}

function deselectAllResources() {
  selectedResourceIds.clear();
  // 重新渲染以更新UI
  const result = {
    all: currentResources,
    grouped: {}
  };
  for (const type of Object.keys(resourceTypes)) {
    result.grouped[type] = currentResources.filter(r => r.type === type);
  }
  renderResourceList(result);
}

async function saveSelectedResources() {
  if (selectedResourceIds.size === 0) {
    showToast('请先选择要保存的资源');
    return;
  }
  
  const selectedResources = currentResources.filter(r => selectedResourceIds.has(r.id));
  
  try {
    showToast('正在保存资源...');
    const result = await api('/api/save-resources', {
      method: 'POST',
      body: JSON.stringify({
        runId: currentRunId,
        sourceIndex: currentSourceIndex,
        resources: selectedResources
      })
    });
    showToast(`成功保存 ${result.savedCount} 个资源到 ${result.savePath}`);
  } catch (e) {
    showToast('保存资源失败: ' + e.message);
  }
}

function renderResourceItem(resource) {
  const isSelected = selectedResourceIds.has(resource.id);
  return `
    <div class="resource-item ${isSelected ? 'selected' : ''}" data-resource-id="${escapeHtml(resource.id)}" data-url="${escapeHtml(resource.url)}">
      <div class="resource-checkbox">
        <input type="checkbox" class="resource-checkbox-input" ${isSelected ? 'checked' : ''} />
      </div>
      <div class="resource-icon">${getResourceIcon(resource.type)}</div>
      <div class="resource-info">
        <div class="resource-name">${escapeHtml(resource.fileName)}</div>
        <div class="resource-url">${escapeHtml(resource.url.substring(0, 80))}${resource.url.length > 80 ? '...' : ''}</div>
      </div>
      <div class="resource-badges">
        ${resource.isInternal ? '<span class="badge">内部</span>' : '<span class="badge muted">外部</span>'}
      </div>
    </div>
  `;
}

function getResourceIcon(type) {
  const icons = {
    images: '🖼️',
    scripts: '📜',
    styles: '🎨',
    fonts: '🔤',
    media: '🎬',
    links: '🔗',
    other: '📦'
  };
  return icons[type] || '📄';
}

// 事件监听器
resourceSearchEl.addEventListener('input', debounce(() => {
  if (currentRunId !== null) {
    loadResourcesForSource(currentRunId, currentSourceIndex);
  }
}, 300));

filterInternalEl.addEventListener('change', () => {
  if (currentRunId !== null) {
    loadResourcesForSource(currentRunId, currentSourceIndex);
  }
});

init().catch((error) => showToast(error.message));
