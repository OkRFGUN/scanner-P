import { setTimeout as wait } from "node:timers/promises";
import crypto from "node:crypto";

// ====================== Plus 增强模块定义 ======================
export const PLUS_MODULES = [
  { id: "plus_rand_delay", label: "Plus: 随机延迟", description: "在每次请求前添加随机延迟（1.2-3.5秒可配置）" },
  { id: "plus_rand_ua", label: "Plus: 随机 User-Agent", description: "随机使用 Chrome/Safari/Firefox/Edge 等浏览器 User-Agent" },
  { id: "plus_anti_detect", label: "Plus: 反检测请求头", description: "添加 sec-ch-ua、sec-ch-ua-platform 等浏览器指纹头部" },
  { id: "plus_proxy", label: "Plus: 代理池", description: "使用代理池（需配置代理列表）" },
  { id: "plus_custom_parse", label: "Plus: 自定义数据提取", description: "支持自定义 CSS 选择器提取数据" },
  { id: "plus_export_csv", label: "Plus: CSV 导出", description: "支持 CSV 格式导出结果" },
  { id: "plus_export_json", label: "Plus: JSON 导出", description: "支持 JSON 格式导出结果" }
];

export function normalizePlusModules(input) {
  const allowed = new Set(PLUS_MODULES.map((item) => item.id));
  return Array.isArray(input) && input.length ? [...new Set(input.filter((id) => allowed.has(id)))] : [];
}

// ====================== 随机 User-Agent 池 ======================
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/128.0.0.0 Safari/537.36"
];

const SEC_HEADERS = [
  { "sec-ch-ua": "Chromium;v=128, Not;A=Brand;v=24, Google Chrome;v=128", "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": "Windows" },
  { "sec-ch-ua": "Safari;v=17, AppleWebKit;v=605", "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": "macOS" }
];

function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

export function getRandomUserAgent() {
  return randomChoice(USER_AGENTS);
}

export function getAntiDetectHeaders(options = {}) {
  const secInfo = randomChoice(SEC_HEADERS);
  const userAgent = options.userAgent || getRandomUserAgent();
  
  return {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "DNT": "1",
    "Cache-Control": "max-age=0",
    ...secInfo
  };
}

export async function randomDelay(minMs = 1200, maxMs = 3500) {
  const delay = randomFloat(minMs, maxMs);
  await wait(delay);
  return { delayMs: Math.round(delay) };
}

// ====================== 代理池管理 ======================
export class ProxyPool {
  constructor(proxies = []) {
    this.proxies = proxies;
    this.invalidProxies = new Set();
  }

  getRandomProxy() {
    const validProxies = this.proxies.filter(p => !this.invalidProxies.has(p));
    if (validProxies.length === 0) return null;
    return randomChoice(validProxies);
  }

  markInvalid(proxy) {
    this.invalidProxies.add(proxy);
  }
}

// ====================== 自定义数据提取 ======================
export function extractCustomData(html, selectors = {}) {
  const results = {};
  for (const [key, selector] of Object.entries(selectors)) {
    results[key] = extractBySelector(html, selector);
  }
  return results;
}

function extractBySelector(html, selector) {
  try {
    if (typeof selector === "string") {
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const descMatch = html.match(/<meta[^>]+(?:name|property)=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i);
      
      if (selector === "title" && titleMatch) {
        return titleMatch[1].replace(/\s+/g, " ").trim();
      }
      if (selector === "description" && descMatch) {
        return descMatch[1].replace(/\s+/g, " ").trim();
      }
      
      const divItemMatch = html.match(/<div[^>]*class="[^"]*item[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (divItemMatch) {
        const itemHtml = divItemMatch[1];
        const itemTitle = itemHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]?.trim();
        const itemLink = itemHtml.match(/<a[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
        const itemContent = itemHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]?.trim();
        return { title: itemTitle, link: itemLink, content: itemContent };
      }
    }
    return "";
  } catch {
    return "";
  }
}

// ====================== 导出功能 ======================
export function exportToCSV(data, fields = []) {
  if (!Array.isArray(data) || data.length === 0) return "";
  
  const headers = fields.length > 0 ? fields : Object.keys(data[0]);
  const csvLines = [headers.join(",")];
  
  for (const item of data) {
    const line = headers.map(key => {
      const value = String(item[key] || "").replace(/"/g, '""');
      return `"${value}"`;
    }).join(",");
    csvLines.push(line);
  }
  
  return csvLines.join("\n");
}

export function exportToJSON(data) {
  return JSON.stringify(data, null, 2);
}

// ====================== 指纹生成 ======================
export function generateFingerprint() {
  return {
    id: crypto.randomBytes(16).toString("hex"),
    timestamp: Date.now(),
    userAgent: getRandomUserAgent()
  };
}

// ====================== Plus 增强模块运行器 ======================
export async function runPlusModules({ html, selectedPlusModules, plusOptions = {} }) {
  const modules = {};
  const selected = new Set(normalizePlusModules(selectedPlusModules));
  
  if (selected.has("plus_custom_parse")) {
    modules.customParse = extractCustomData(html, plusOptions.customSelectors || { 
      title: "title", 
      description: "description" 
    });
  }
  
  return {
    selected: [...selected],
    modules
  };
}
