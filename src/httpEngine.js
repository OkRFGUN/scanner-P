import { setTimeout as wait } from "node:timers/promises";
import { getAntiDetectHeaders, getRandomUserAgent, randomDelay, ProxyPool } from "./plusModules.js";

export async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent": "CompliantCaptureTool/0.1 (+local authorized data collection)",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(options.headers || {})
      },
      signal: controller.signal,
      redirect: "follow"
    });
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
      durationMs: Date.now() - startedAt
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

export async function fetchWithPlus(url, options = {}) {
  const { plusModules = [], plusOptions = {} } = options;
  const selectedPlus = new Set(plusModules);
  let delayInfo = null;

  if (selectedPlus.has("plus_rand_delay")) {
    delayInfo = await randomDelay(
      plusOptions.minDelayMs || 1200,
      plusOptions.maxDelayMs || 3500
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  const startedAt = Date.now();

  try {
    let headers = {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...(options.headers || {})
    };

    if (selectedPlus.has("plus_anti_detect") || selectedPlus.has("plus_rand_ua")) {
      headers = { ...headers, ...getAntiDetectHeaders() };
    } else if (selectedPlus.has("plus_rand_ua")) {
      headers["User-Agent"] = getRandomUserAgent();
    } else {
      headers["user-agent"] = "CompliantCaptureTool/0.1 (+local authorized data collection)";
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
      redirect: "follow"
    });
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
      delayInfo,
      usedPlus: plusModules
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

export async function fetchRobotsHint(sourceUrl, timeoutMs = 5000) {
  try {
    const parsed = new URL(sourceUrl);
    const robotsUrl = `${parsed.origin}/robots.txt`;
    const result = await fetchWithTimeout(robotsUrl, { timeoutMs });
    return {
      robotsUrl,
      available: result.ok,
      status: result.status,
      preview: result.body.slice(0, 1200)
    };
  } catch (error) {
    return {
      available: false,
      error: error.message
    };
  }
}

export async function backoff(attempt, baseDelayMs) {
  const delay = Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), 30000);
  await wait(delay);
  return delay;
}
