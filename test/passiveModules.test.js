import test from "node:test";
import assert from "node:assert/strict";
import { normalizeModules, runPassiveModules } from "../src/passiveModules.js";

test("normalizes selected passive modules", () => {
  assert.deepEqual(normalizeModules(["headers", "bad", "dns", "dns"]), ["headers", "dns"]);
  assert.equal(normalizeModules([]).includes("headers"), true);
});

test("runs passive modules over a safe HTML response", async () => {
  const html = `
    <html>
      <head><title>Lab</title><meta name="description" content="Passive test"></head>
      <body>
        <a href="/internal">Internal</a>
        <a href="https://external.example/">External</a>
        <form method="get" action="/login"><input name="password" type="password"></form>
      </body>
    </html>
  `;
  const analysis = await runPassiveModules({
    sourceUrl: "https://example.test/",
    response: {
      headers: { "content-type": "text/html", server: "demo" },
      setCookies: ["sid=123; Path=/"]
    },
    html,
    robots: { available: false },
    selectedModules: ["content", "headers", "cookies", "links", "forms"]
  });

  assert.equal(analysis.modules.content.title, "Lab");
  assert.equal(analysis.modules.links.counts.links, 2);
  assert.equal(analysis.modules.forms.count, 1);
  assert.equal(analysis.findings.some((item) => item.title.includes("HSTS")), true);
  assert.equal(analysis.findings.some((item) => item.module === "cookies"), true);
});
