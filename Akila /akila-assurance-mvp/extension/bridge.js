// Isolated-world bridge. It is intentionally tiny: it forwards assurance
// requests to the extension service worker and never receives the local vault.

(() => {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-guard.js");
  script.dataset.akila = "1";
  (document.head || document.documentElement).appendChild(script);
  script.remove();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== "AKILA_PAGE_TO_EXTENSION") return;

    if (data.type === "ASSURE_TEXT") {
      chrome.runtime.sendMessage({
        type: "AKILA_ASSURE_TEXT",
        text: data.text,
        destination: data.destination
      }).then((result) => {
        window.postMessage({
          channel: "AKILA_EXTENSION_TO_PAGE",
          requestId: data.requestId,
          type: "ASSURE_RESULT",
          result
        }, "*");
      }).catch((error) => {
        window.postMessage({
          channel: "AKILA_EXTENSION_TO_PAGE",
          requestId: data.requestId,
          type: "ASSURE_RESULT",
          result: { verified: false, reason: String(error) }
        }, "*");
      });
    }

    if (data.type === "ASSURE_FILE") {
      chrome.runtime.sendMessage({
        type: "AKILA_ASSURE_FILE",
        filename: data.filename,
        mimeType: data.mimeType,
        base64: data.base64
      }).then((result) => {
        window.postMessage({
          channel: "AKILA_EXTENSION_TO_PAGE",
          requestId: data.requestId,
          type: "ASSURE_FILE_RESULT",
          result
        }, "*");
      }).catch((error) => {
        window.postMessage({
          channel: "AKILA_EXTENSION_TO_PAGE",
          requestId: data.requestId,
          type: "ASSURE_FILE_RESULT",
          result: { verified: false, reason: String(error) }
        }, "*");
      });
    }
  });
})();
