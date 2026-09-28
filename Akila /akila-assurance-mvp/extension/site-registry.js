/**
 * Explicit v1 destination registry.
 * Keep this list narrow. A matching hostname is not proof that every endpoint
 * or transport is covered; the transport/content matrix remains authoritative.
 */
(() => {
  const SITES = Object.freeze([
    { id: "chatgpt", hosts: ["chatgpt.com", "chat.openai.com"] },
    { id: "claude", hosts: ["claude.ai"] },
    { id: "gemini", hosts: ["gemini.google.com"] }
  ]);

  function matchesHost(host, allowed) {
    const normalized = String(host || "").toLowerCase().replace(/\.$/, "");
    return allowed.some((root) => normalized === root || normalized.endsWith("." + root));
  }

  function resolve(value, base = location.href) {
    let url;
    try { url = new URL(value, base); } catch { return { status: "unknown", site: null }; }
    if (url.protocol !== "https:") return { status: "unknown", site: null };
    const site = SITES.find((entry) => matchesHost(url.hostname, entry.hosts));
    return site
      ? { status: "candidate", site: site.id, hostname: url.hostname }
      : { status: "not_protected", site: null, hostname: url.hostname };
  }

  window.AKILA_SITE_REGISTRY = Object.freeze({ resolve, sites: SITES });
})();
