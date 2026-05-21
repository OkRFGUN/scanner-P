import test from "node:test";
import assert from "node:assert/strict";
import { extractFields, validateFields } from "../src/extractor.js";

test("extracts title and meta fields", () => {
  const html = `<!doctype html><title> Example Page </title><meta name="description" content="Useful data">`;
  const template = {
    fields: [
      { name: "title", ruleType: "title", required: true, cleaning: ["trim"] },
      { name: "description", ruleType: "meta", rule: "description", cleaning: ["trim"] }
    ]
  };
  const record = extractFields(html, template);
  assert.equal(record.title, "Example Page");
  assert.equal(record.description, "Useful data");
  assert.deepEqual(validateFields(record, template), []);
});

test("reports missing required fields", () => {
  const template = {
    fields: [{ name: "price", ruleType: "regex", rule: "Price: ([0-9.]+)", required: true }]
  };
  const record = extractFields("<p>No price</p>", template);
  assert.deepEqual(validateFields(record, template), ["price"]);
});
