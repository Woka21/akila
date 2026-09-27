(() => {
  if (window.__AKILA_OUTBOUND_GUARD__) return;
  window.__AKILA_OUTBOUND_GUARD__ = true;

  const MAX_BODY = 200_000;
  const FILE_LIMIT = 4 * 1024 * 1024;
  const tokenPattern = /<AKILA_[A-Z_]+_[a-f0-9]{10}>/g;
  const pending = new Map();

  function request(type, payload, timeoutMs = 8000) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("AKILA assurance timeout"));
      }, timeoutMs);

      pending.set(requestId, {
        resolve: (value) => { clearTimeout(timer); pending.delete(requestId); resolve(value); },
        reject: (error) => { clearTimeout(timer); pending.delete(requestId); reject(error); }
      });

      window.postMessage({
        channel: "AKILA_PAGE_TO_EXTENSION",
        requestId,
        type,
        ...payload
      }, "*");
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== "AKILA_EXTENSION_TO_PAGE") return;
    const entry = pending.get(data.requestId);
    if (!entry) return;
    if (data.type === "ASSURE_RESULT" || data.type === "ASSURE_FILE_RESULT") {
      entry.resolve(data.result);
    }
  });

  function destination() {
    return location.origin + location.pathname;
  }

  async function assureText(text) {
    if (typeof text !== "string") throw new Error("AKILA: non-string payload");
    if (new TextEncoder().encode(text).byteLength > MAX_BODY) {
      throw new Error("AKILA: payload exceeds assurance limit");
    }
    const result = await request("ASSURE_TEXT", { text, destination: destination() });
    if (!result?.verified) throw new Error("AKILA: submission not verified: " + (result?.reason || "unknown"));
    return result.sanitizedText;
  }

  async function assureFile(file) {
    if (!(file instanceof File)) throw new Error("AKILA: invalid file");
    if (file.size > FILE_LIMIT) throw new Error("AKILA: file exceeds assurance limit");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const result = await request("ASSURE_FILE", {
      filename: file.name,
      mimeType: file.type,
      base64: btoa(binary)
    });
    if (!result?.verified) {
      throw new Error("AKILA: file not verified: " + (result?.reason || "unknown"));
    }
    const out = Uint8Array.from(atob(result.contentBase64), (c) => c.charCodeAt(0));
    return new File([out], file.name, { type: result.mimeType || file.type });
  }

  function isOutbound(method) {
    return ["POST", "PUT", "PATCH"].includes((method || "GET").toUpperCase());
  }

  async function sanitizeBody(body) {
    if (body == null) return body;

    if (typeof body === "string") {
      return await assureText(body);
    }

    if (body instanceof URLSearchParams) {
      const copy = new URLSearchParams();
      for (const [key, value] of body.entries()) {
        copy.set(key, await assureText(value));
      }
      return copy;
    }

    if (body instanceof FormData) {
      const copy = new FormData();
      for (const [key, value] of body.entries()) {
        if (typeof value === "string") {
          copy.append(key, await assureText(value));
        } else {
          copy.append(key, await assureFile(value));
        }
      }
      return copy;
    }

    if (body instanceof Blob) {
      const file = new File([body], "upload", { type: body.type || "application/octet-stream" });
      return await assureFile(file);
    }

    throw new Error("AKILA: unsupported request body; blocked by assurance policy");
  }

  // fetch interception is the primary MVP capture boundary.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const method = String(init.method || request?.method || "GET").toUpperCase();
    if (!isOutbound(method)) return nativeFetch(input, init);

    const originalBody = init.body !== undefined ? init.body : request?.body;
    if (originalBody === undefined || originalBody === null) return nativeFetch(input, init);

    const sanitized = await sanitizeBody(originalBody);
    const next = { ...init, method };

    if (request && init.body === undefined) {
      // Rebuild the Request so headers/mode/credentials survive.
      const rebuilt = new Request(request, { body: sanitized, method });
      return nativeFetch(rebuilt);
    }

    next.body = sanitized;
    return nativeFetch(input, next);
  };

  // XHR interception catches older apps that do not use fetch().
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const methods = new WeakMap();

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    methods.set(this, { method: String(method || "GET").toUpperCase(), url: String(url || "") });
    return nativeOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const meta = methods.get(this) || { method: "GET" };
    if (!isOutbound(meta.method) || body == null) {
      return nativeSend.call(this, body);
    }

    // XHR.send itself cannot await. Queue the native send only after assurance.
    sanitizeBody(body)
      .then((safe) => nativeSend.call(this, safe))
      .catch((error) => {
        console.error("[AKILA] XHR blocked:", error);
        this.dispatchEvent(new ProgressEvent("error"));
        this.dispatchEvent(new ProgressEvent("loadend"));
      });
  };

  // Capture file selections early. The actual transformation happens when
  // FormData/fetch/XHR is constructed, so we avoid replacing the DOM's FileList.
  document.addEventListener("change", (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.type === "file") {
      input.dataset.akilaObserved = "1";
    }
  }, true);

  console.info("[AKILA] outbound assurance active");
})();
