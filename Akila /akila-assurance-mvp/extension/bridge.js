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

    const send = (message, resultType) => {
      chrome.runtime.sendMessage(message).then((result) => {
        window.postMessage({
          channel: "AKILA_EXTENSION_TO_PAGE",
          requestId: data.requestId,
          type: resultType,
          result
        }, "*");
      }).catch((error) => {
        window.postMessage({
          channel: "AKILA_EXTENSION_TO_PAGE",
          requestId: data.requestId,
          type: resultType,
          result: { verified: false, reason: String(error) }
        }, "*");
      });
    };

    if (data.type === "ASSURE_TEXT") {
      send({
        type: "AKILA_ASSURE_TEXT",
        text: data.text,
        destination: data.destination
      }, "ASSURE_RESULT");
    }

    if (data.type === "ASSURE_FILE") {
      send({
        type: "AKILA_ASSURE_FILE",
        filename: data.filename,
        mimeType: data.mimeType,
        base64: data.base64
      }, "ASSURE_FILE_RESULT");
    }

    if (data.type === "RESTORE_TEXT") {
      send({
        type: "AKILA_RESTORE_TEXT",
        text: data.text
      }, "RESTORE_RESULT");
    }
  });
})();
