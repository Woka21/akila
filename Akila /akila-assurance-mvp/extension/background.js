const SERVICE = "http://127.0.0.1:5171";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "AKILA_ASSURE_TEXT") {
    assureText(message).then(sendResponse).catch((error) => {
      sendResponse({ verified: false, reason: String(error) });
    });
    return true;
  }

  if (message?.type === "AKILA_ASSURE_FILE") {
    assureFile(message).then(sendResponse).catch((error) => {
      sendResponse({ verified: false, reason: String(error) });
    });
    return true;
  }

  if (message?.type === "AKILA_RESTORE_TEXT") {
    restoreText(message).then(sendResponse).catch((error) => {
      sendResponse({ verified: false, reason: String(error) });
    });
    return true;
  }

  if (message?.type === "AKILA_HEALTH") {
    fetch(SERVICE + "/health", { cache: "no-store" })
      .then((r) => r.json())
      .then(sendResponse)
      .catch((error) => sendResponse({ status: "offline", error: String(error) }));
    return true;
  }
});

async function sessionId() {
  const data = await chrome.storage.session.get(["sessionId"]);
  if (data.sessionId) return data.sessionId;
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ sessionId: id });
  return id;
}

async function assureText(message) {
  const session = await sessionId();
  const response = await fetch(SERVICE + "/assure", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-AKILA-Session": session },
    body: JSON.stringify({
      text: message.text,
      destination: message.destination || "unknown"
    })
  });
  if (!response.ok) return { verified: false, reason: "assurance_service_" + response.status };
  return response.json();
}

async function assureFile(message) {
  const session = await sessionId();
  const bytes = Uint8Array.from(atob(message.base64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: message.mimeType || "application/octet-stream" }), message.filename || "upload");

  const response = await fetch(SERVICE + "/assure-file", {
    method: "POST",
    headers: { "X-AKILA-Session": session },
    body: form
  });
  if (!response.ok) {
    let detail = {};
    try { detail = await response.json(); } catch {}
    return { verified: false, reason: detail.reason || "assurance_service_" + response.status };
  }
  return response.json();
}

async function restoreText(message) {
  const session = await sessionId();
  const response = await fetch(SERVICE + "/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-AKILA-Session": session },
    body: JSON.stringify({ text: message.text })
  });
  if (!response.ok) return { verified: false, reason: "restore_service_" + response.status };
  return { verified: true, ...(await response.json()) };
}
