import dns from "node:dns/promises";
import tls from "node:tls";
import { fetchWithTimeout } from "./httpEngine.js";
import { extractAllResources, groupResourcesByType, RESOURCE_TYPES } from "./resourceExtractor.js";

export const MODULES = [
  { id: "content", label: "页面资料", description: "标题、描述、正文摘要、自定义字段" },
  { id: "headers", label: "安全响应头", description: "HSTS、CSP、X-Frame-Options、Referrer-Policy 等" },
  { id: "cookies", label: "Cookie 属性", description: "Secure、HttpOnly、SameSite、过期时间" },
  { id: "links", label: "链接与资源", description: "站内/站外链接、脚本、图片、样式表" },
  { id: "forms", label: "表单观察", description: "表单 action、method、输入字段，不提交任何数据" },
  { id: "robots", label: "robots.txt", description: "来源规则提示，仅做展示，不绕过限制" },
  { id: "sitemap", label: "sitemap.xml", description: "站点地图探测，最多读取一个默认位置" },
  { id: "tls", label: "TLS 证书", description: "证书主题、颁发者、有效期、指纹" },
  { id: "dns", label: "DNS 记录", description: "A、AAAA、CNAME、MX、NS 记录" },
  { id: "resources", label: "网页资源", description: "提取和分类网页所有资源（图片、JS、CSS、字体等），支持筛选和下载" }
];

export function normalizeModules(input) {
  const allowed = new Set(MODULES.map((item) => item.id));
  const defaults = ["content", "headers", "cookies", "links", "forms", "robots", "sitemap", "tls", "dns", "resources"];
  const selected = Array.isArray(input) && input.length ? input : defaults;
  return [...new Set(selected.filter((id) => allowed.has(id)))];
}

export async function runPassiveModules({ sourceUrl, response, html, robots, selectedModules }) {
  const modules = {};
  const findings = [];
  const selected = new Set(normalizeModules(selectedModules));

  if (selected.has("content")) {
    modules.content = analyzeContent(html);
  }
  if (selected.has("headers")) {
    modules.headers = analyzeSecurityHeaders(response.headers, sourceUrl);
    findings.push(...modules.headers.findings);
  }
  if (selected.has("cookies")) {
    modules.cookies = analyzeCookies(response.setCookies || [], sourceUrl);
    findings.push(...modules.cookies.findings);
  }
  if (selected.has("links")) {
    modules.links = extractLinksAndAssets(html, sourceUrl);
  }
  if (selected.has("forms")) {
    modules.forms = extractForms(html, sourceUrl);
    if (modules.forms.items.some((form) => form.method === "get" && form.hasPassword)) {
      findings.push({
        severity: "medium",
        module: "forms",
        title: "密码字段使用 GET 表单",
        detail: "GET 表单可能把敏感字段写入 URL、日志或浏览器历史。"
      });
    }
  }
  if (selected.has("robots")) {
    modules.robots = robots || null;
  }
  if (selected.has("sitemap")) {
    modules.sitemap = await fetchSitemap(sourceUrl);
  }
  if (selected.has("tls")) {
    modules.tls = await inspectTls(sourceUrl);
    if (modules.tls?.validTo && new Date(modules.tls.validTo).getTime() < Date.now() + 1000 * 60 * 60 * 24 * 14) {
      findings.push({
        severity: "medium",
        module: "tls",
        title: "TLS 证书即将过期",
        detail: `证书有效期到 ${modules.tls.validTo}。`
      });
    }
  }
  if (selected.has("dns")) {
    modules.dns = await inspectDns(sourceUrl);
  }

  if (selected.has("resources")) {
    modules.resources = {
      all: extractAllResources(html, sourceUrl),
      grouped: groupResourcesByType(extractAllResources(html, sourceUrl)),
      types: RESOURCE_TYPES
    };
  }

  return {
    selected: [...selected],
    summary: summarizeModules(modules, findings),
    findings,
    modules
  };
}

export async function diagnoseUrl(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const startedAt = Date.now();
  const dnsInfo = await inspectDns(url);
  const tlsInfo = await inspectTls(url);
  let httpInfo = null;
  try {
    const response = await fetchWithTimeout(url, { timeoutMs: 10000 });
    httpInfo = {
      ok: response.ok,
      status: response.status,
      finalUrl: response.finalUrl,
      contentType: response.headers["content-type"] || "",
      bodyBytes: Buffer.byteLength(response.body || "", "utf8")
    };
  } catch (error) {
    httpInfo = { ok: false, error: error.message };
  }

  return {
    url,
    durationMs: Date.now() - startedAt,
    dns: dnsInfo,
    tls: tlsInfo,
    http: httpInfo
  };
}

function analyzeContent(html) {
  const title = matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = matchMeta(html, "description");
  const text = stripTags(html);
  return {
    title,
    description,
    textPreview: text.slice(0, 800),
    wordLikeCount: text ? text.split(/\s+/).length : 0,
    htmlBytes: Buffer.byteLength(String(html), "utf8")
  };
}

function analyzeSecurityHeaders(headers, sourceUrl) {
  const h = lowerHeaders(headers);
  const findings = [];
  const https = String(sourceUrl).startsWith("https:");
  const checks = [
    {
      header: "strict-transport-security",
      severity: "medium",
      active: https,
      title: "缺少 HSTS",
      detail: "HTTPS 站点建议使用 Strict-Transport-Security 降低协议降级风险。"
    },
    {
      header: "content-security-policy",
      severity: "medium",
      active: true,
      title: "缺少 CSP",
      detail: "Content-Security-Policy 能降低 XSS 和资源注入风险。"
    },
    {
      header: "x-content-type-options",
      expected: "nosniff",
      severity: "low",
      active: true,
      title: "缺少 X-Content-Type-Options: nosniff",
      detail: "nosniff 可减少 MIME 类型嗅探导致的内容误执行。"
    },
    {
      header: "referrer-policy",
      severity: "info",
      active: true,
      title: "缺少 Referrer-Policy",
      detail: "Referrer-Policy 可以控制跨站跳转时泄露的来源信息。"
    },
    {
      header: "permissions-policy",
      severity: "info",
      active: true,
      title: "缺少 Permissions-Policy",
      detail: "Permissions-Policy 可收敛浏览器能力暴露面。"
    }
  ];

  for (const check of checks) {
    if (!check.active) continue;
    const value = h[check.header] || "";
    if (!value || (check.expected && !value.toLowerCase().includes(check.expected))) {
      findings.push({ severity: check.severity, module: "headers", title: check.title, detail: check.detail });
    }
  }

  if (!h["x-frame-options"] && !String(h["content-security-policy"] || "").toLowerCase().includes("frame-ancestors")) {
    findings.push({
      severity: "low",
      module: "headers",
      title: "缺少点击劫持防护信号",
      detail: "建议通过 X-Frame-Options 或 CSP frame-ancestors 控制页面嵌入。"
    });
  }
  if (h.server || h["x-powered-by"]) {
    findings.push({
      severity: "info",
      module: "headers",
      title: "暴露服务端指纹",
      detail: `响应头暴露了 ${[h.server ? "Server" : "", h["x-powered-by"] ? "X-Powered-By" : ""].filter(Boolean).join(" / ")}。`
    });
  }

  return {
    raw: h,
    score: Math.max(0, 100 - findings.filter((f) => f.severity === "medium").length * 18 - findings.filter((f) => f.severity === "low").length * 8 - findings.filter((f) => f.severity === "info").length * 3),
    findings
  };
}

function analyzeCookies(setCookies, sourceUrl) {
  const items = setCookies.map(parseCookie).filter(Boolean);
  const findings = [];
  const https = String(sourceUrl).startsWith("https:");
  for (const cookie of items) {
    if (https && !cookie.secure) {
      findings.push({ severity: "low", module: "cookies", title: `Cookie ${cookie.name} 缺少 Secure`, detail: "HTTPS 站点的敏感 Cookie 通常应设置 Secure。" });
    }
    if (!cookie.httpOnly) {
      findings.push({ severity: "info", module: "cookies", title: `Cookie ${cookie.name} 缺少 HttpOnly`, detail: "HttpOnly 可减少脚本读取 Cookie 的风险。" });
    }
    if (!cookie.sameSite) {
      findings.push({ severity: "info", module: "cookies", title: `Cookie ${cookie.name} 缺少 SameSite`, detail: "SameSite 有助于降低跨站请求携带 Cookie 的风险。" });
    }
  }
  return { count: items.length, items, findings };
}

function extractLinksAndAssets(html, sourceUrl) {
  const origin = new URL(sourceUrl).origin;
  const links = collectUrls(html, /\bhref=["']([^"']+)["']/gi, sourceUrl, 200);
  const scripts = collectUrls(html, /<script[^>]+\bsrc=["']([^"']+)["']/gi, sourceUrl, 100);
  const images = collectUrls(html, /<img[^>]+\bsrc=["']([^"']+)["']/gi, sourceUrl, 100);
  const styles = collectUrls(html, /<link[^>]+\bhref=["']([^"']+)["'][^>]*>/gi, sourceUrl, 100)
    .filter((item) => item.url.match(/\.(css)(\?|$)/i) || item.raw.includes(".css"));
  return {
    counts: {
      links: links.length,
      internalLinks: links.filter((item) => item.origin === origin).length,
      externalLinks: links.filter((item) => item.origin && item.origin !== origin).length,
      scripts: scripts.length,
      images: images.length,
      styles: styles.length
    },
    links,
    scripts,
    images,
    styles
  };
}

function extractForms(html, sourceUrl) {
  const items = [];
  const forms = String(html).matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi);
  for (const form of forms) {
    const attrs = parseAttrs(form[1]);
    const inputs = [...form[2].matchAll(/<(input|textarea|select)\b([^>]*)>/gi)].map((input) => {
      const inputAttrs = parseAttrs(input[2]);
      return {
        tag: input[1].toLowerCase(),
        name: inputAttrs.name || "",
        type: inputAttrs.type || (input[1].toLowerCase() === "input" ? "text" : input[1].toLowerCase()),
        required: Object.hasOwn(inputAttrs, "required")
      };
    });
    items.push({
      method: String(attrs.method || "get").toLowerCase(),
      action: resolveMaybeUrl(attrs.action || sourceUrl, sourceUrl),
      inputCount: inputs.length,
      hasPassword: inputs.some((input) => input.type === "password"),
      inputs
    });
  }
  return { count: items.length, items };
}

async function fetchSitemap(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    const sitemapUrl = `${parsed.origin}/sitemap.xml`;
    const response = await fetchWithTimeout(sitemapUrl, { timeoutMs: 6000 });
    const urls = [...response.body.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((match) => match[1].trim()).slice(0, 50);
    return {
      sitemapUrl,
      available: response.ok,
      status: response.status,
      urls,
      preview: response.body.slice(0, 1200)
    };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

async function inspectDns(sourceUrl) {
  try {
    const host = new URL(sourceUrl).hostname;
    const result = { host };
    try {
      result.lookup = await dns.lookup(host, { all: true });
    } catch {
      result.lookup = [];
    }
    for (const [key, resolver] of [
      ["a", () => dns.resolve4(host)],
      ["aaaa", () => dns.resolve6(host)],
      ["cname", () => dns.resolveCname(host)],
      ["mx", () => dns.resolveMx(host)],
      ["ns", () => dns.resolveNs(host)]
    ]) {
      try {
        result[key] = await resolver();
      } catch {
        result[key] = [];
      }
    }
    return result;
  } catch (error) {
    return { error: error.message };
  }
}

async function inspectTls(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== "https:") {
      return { skipped: true, reason: "非 HTTPS 来源" };
    }
    return await new Promise((resolve) => {
      const socket = tls.connect({
        host: parsed.hostname,
        port: Number(parsed.port || 443),
        servername: parsed.hostname,
        timeout: 8000,
        rejectUnauthorized: false
      }, () => {
        const cert = socket.getPeerCertificate();
        resolve({
          authorized: socket.authorized,
          authorizationError: socket.authorizationError || "",
          subject: cert.subject || {},
          issuer: cert.issuer || {},
          validFrom: cert.valid_from || "",
          validTo: cert.valid_to || "",
          fingerprint256: cert.fingerprint256 || "",
          protocol: socket.getProtocol()
        });
        socket.end();
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve({ error: "TLS connection timeout" });
      });
      socket.on("error", (error) => resolve({ error: error.message }));
    });
  } catch (error) {
    return { error: error.message };
  }
}

function summarizeModules(modules, findings) {
  return {
    score: modules.headers?.score ?? null,
    findings: findings.length,
    mediumFindings: findings.filter((item) => item.severity === "medium").length,
    lowFindings: findings.filter((item) => item.severity === "low").length,
    infoFindings: findings.filter((item) => item.severity === "info").length,
    forms: modules.forms?.count ?? 0,
    links: modules.links?.counts?.links ?? 0,
    cookies: modules.cookies?.count ?? 0,
    tlsAuthorized: modules.tls?.authorized ?? null
  };
}

function lowerHeaders(headers) {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

function collectUrls(html, regex, baseUrl, limit) {
  const seen = new Set();
  const items = [];
  for (const match of String(html).matchAll(regex)) {
    if (items.length >= limit) break;
    const raw = match[1]?.trim();
    const url = resolveMaybeUrl(raw, baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({ raw, url, origin: safeOrigin(url) });
  }
  return items;
}

function parseCookie(value) {
  const parts = String(value).split(";").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const [nameValue, ...attrs] = parts;
  const [name] = nameValue.split("=");
  const lower = attrs.map((attr) => attr.toLowerCase());
  const sameSite = attrs.find((attr) => attr.toLowerCase().startsWith("samesite="))?.split("=")[1] || "";
  return {
    name,
    secure: lower.includes("secure"),
    httpOnly: lower.includes("httponly"),
    sameSite,
    expires: attrs.find((attr) => attr.toLowerCase().startsWith("expires="))?.slice(8) || "",
    maxAge: attrs.find((attr) => attr.toLowerCase().startsWith("max-age="))?.slice(8) || ""
  };
}

function parseAttrs(text) {
  const attrs = {};
  for (const match of String(text).matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function matchMeta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return matchFirst(html, new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"))
    || matchFirst(html, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i"));
}

function matchFirst(text, regex) {
  return String(text).match(regex)?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function stripTags(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveMaybeUrl(raw, baseUrl) {
  try {
    if (!raw || raw.startsWith("javascript:") || raw.startsWith("mailto:") || raw.startsWith("tel:")) return "";
    return new URL(raw, baseUrl).toString();
  } catch {
    return "";
  }
}

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function normalizeUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) throw new Error("URL is required");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
