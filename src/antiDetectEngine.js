import { setTimeout as wait } from "node:timers/promises";
import crypto from "node:crypto";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
];

const SEC_HEADERS = [
  {
    "sec-ch-ua": "Chromium;v=128, Not;A=Brand;v=24, Google Chrome;v=128",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "Windows"
  },
  {
    "sec-ch-ua": "Safari;v=17, AppleWebKit;v=605",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "macOS"
  }
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
  return delay;
}

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

export function generateFingerprint() {
  return {
    id: crypto.randomBytes(16).toString("hex"),
    timestamp: Date.now()
  };
}

export async function fetchWithAntiDetect(url, options = {}) {
  const {
    useAntiDetect = true,
    minDelayMs = 1200,
    maxDelayMs = 3500,
    timeoutMs = 30000,
    proxyPool = null
  } = options;

  if (useAntiDetect) {
    await randomDelay(minDelayMs, maxDelayMs);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const headers = useAntiDetect 
      ? getAntiDetectHeaders(options) 
      : (options.headers || {});
    
    const proxy = proxyPool ? proxyPool.getRandomProxy() : null;
    const requestOptions = {
      method: "GET",
      headers,
      signal: controller.signal,
      redirect: "follow",
      ...(options.requestOptions || {})
    };

    const response = await fetch(url, requestOptions);
    const body = await response.text();
    const setCookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie")
        ? [response.headers.get("set-cookie")]
        : [];

    return {
      ok: response.ok,
      url,
      finalUrl: response.url,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      setCookies,
      body,
      durationMs: Date.now() - startedAt,
      usedProxy: proxy,
      antiDetectEnabled: useAntiDetect
    };
  } catch (error) {
    const detail = error.cause
      ? `${error.message}: ${error.cause.code || error.cause.name || "cause"} ${error.cause.message || ""}`.trim()
      : error.message;
    error.message = detail;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
