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
assert.ok(guard.includes("isInterceptable(input)"), "cross-origin AI API requests must be inspectable");
assert.ok(guard.includes("response.clone()"), "response inspection must not consume the original response");
assert.ok(guard.includes("event-stream"), "SSE must be excluded to preserve streaming");
const tauri = readFileSync("Akila /akila-extension/src-tauri/akila-desktop-agent/src-tauri/src/main.rs", "utf8");
assert.ok(tauri.includes("127.0.0.1:5171"), "Tauri supervisor must target the assurance service port");
assert.ok(!tauri.includes("Command::new(\\\"curl\\\")"), "watchdog must not depend on curl");
assert.ok(tauri.includes("needs_watchdog_restart"), "Tauri watchdog must supervise the service");
console.log("AKILA coverage invariants passed");
