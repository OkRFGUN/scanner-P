function stripTags(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text) {
  return String(text)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function cleanValue(value, field = {}) {
  let output = value == null ? "" : decodeEntities(String(value)).trim();
  for (const rule of field.cleaning || []) {
    if (rule === "trim") output = output.trim();
    if (rule === "collapseWhitespace") output = output.replace(/\s+/g, " ");
    if (rule === "number") output = output.replace(/[^\d.-]/g, "");
  }
  return output || field.defaultValue || "";
}

function matchRegex(html, pattern) {
  if (!pattern) return "";
  const regex = new RegExp(pattern, "is");
  const match = String(html).match(regex);
  return match ? match[1] || match[0] : "";
}

function matchMeta(html, name) {
  if (!name) return "";
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  const reverse = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i");
  return String(html).match(regex)?.[1] || String(html).match(reverse)?.[1] || "";
}

export function extractFields(html, template = {}) {
  const result = {};
  const plainText = stripTags(html);

  for (const field of template.fields || []) {
    let value = "";
    if (field.ruleType === "regex") {
      value = matchRegex(html, field.rule);
    } else if (field.ruleType === "meta") {
      value = matchMeta(html, field.rule);
    } else if (field.ruleType === "title") {
      value = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
    } else if (field.ruleType === "text") {
      value = plainText;
    }
    result[field.name] = cleanValue(value, field);
  }

  return result;
}

export function validateFields(record, template = {}) {
  const missing = [];
  for (const field of template.fields || []) {
    if (field.required && !record[field.name]) {
      missing.push(field.name);
    }
  }
  return missing;
}
