export const BLOCKED_FEATURES = [
  "captcha cracking",
  "ip pool ban evasion",
  "browser fingerprint spoofing",
  "anti-detection scripts",
  "login wall bypass",
  "paywall bypass"
];

export function isAccessControlStatus(statusCode) {
  return [401, 403, 407, 429, 451].includes(Number(statusCode));
}

export function detectAccessControl(html = "", statusCode = 0) {
  const text = String(html).toLowerCase();
  const signals = [];

  if (isAccessControlStatus(statusCode)) {
    signals.push(`HTTP ${statusCode}`);
  }

  const patterns = [
    ["captcha", "captcha"],
    ["recaptcha", "recaptcha"],
    ["hcaptcha", "hcaptcha"],
    ["verify you are human", "human verification"],
    ["access denied", "access denied"],
    ["too many requests", "rate limited"],
    ["please sign in", "login required"],
    ["log in to continue", "login required"],
    ["forbidden", "forbidden"]
  ];

  for (const [needle, label] of patterns) {
    if (text.includes(needle)) {
      signals.push(label);
    }
  }

  return {
    blocked: signals.length > 0,
    signals: [...new Set(signals)]
  };
}

export function getComplianceStatement() {
  return {
    allowed: [
      "authorized sessions",
      "rate limits",
      "timeouts and retries",
      "manual captcha handoff",
      "audit logs",
      "robots.txt visibility",
      "source notes"
    ],
    disallowed: BLOCKED_FEATURES
  };
}
