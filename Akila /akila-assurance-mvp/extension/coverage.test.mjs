import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = "Akila /akila-assurance-mvp/extension/";
const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));
const guard = readFileSync(root + "page-guard.js", "utf8");

assert.deepEqual(manifest.content_scripts[0].matches, [
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://claude.ai/*",
  "https://gemini.google.com/*"
]);
assert.ok(!manifest.content_scripts[0].matches.includes("<all_urls>"));
assert.ok(!/querySelector|querySelectorAll|getElementById/.test(guard), "capture must not depend on DOM selectors");
assert.ok(guard.includes("copy.append(key"), "URLSearchParams duplicate keys must be preserved");
assert.ok(guard.includes("!isSameOrigin(input)"), "cross-origin traffic must stay outside this narrow MVP boundary");
assert.ok(guard.includes("response.clone()"), "response inspection must not consume the original response");
assert.ok(guard.includes("event-stream"), "SSE must be excluded to preserve streaming");
console.log("AKILA coverage invariants passed");
