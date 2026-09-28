(() => {
  if (window.__AKILA_OUTBOUND_GUARD__) return;
  window.__AKILA_OUTBOUND_GUARD__ = true;

  const MAX_BODY = 200_000;
  const FILE_LIMIT = 4 * 1024 * 1024;
  const pending = new Map();
  const PROTECTED_HOSTS = new Set([
    "chatgpt.com", "chat.openai.com", "claude.ai", "gemini.google.com"
  ]);

  function request(type, payload, timeoutMs = 8000) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("AKILA assurance timeout"));
      }, timeoutMs);
      pending.set(requestId, {
        resolve: value => { clearTimeout(timer); pending.delete(requestId); resolve(value); },
        reject: error => { clearTimeout(timer); pending.delete(requestId); reject(error); }
      });
      window.postMessage({ channel: "AKILA_PAGE_TO_EXTENSION", requestId, type, ...payload }, "*");
    });
  }

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== "AKILA_EXTENSION_TO_PAGE") return;
    const entry = pending.get(data.requestId);
    if (entry && ["ASSURE_RESULT", "ASSURE_FILE_RESULT", "RESTORE_RESULT"].includes(data.type)) {
      entry.resolve(data.result);
    }
  });

  function isProtectedPage() {
    return PROTECTED_HOSTS.has(location.hostname);
  }
  function isInterceptable(input) {
    try {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      return url.protocol === "https:" && url.origin !== "chrome-extension:";
    } catch { return false; }
  }
  function isOutbound(method) {
    return ["POST", "PUT", "PATCH"].includes(String(method || "GET").toUpperCase());
  }
  function contentType(headers) {
    try { return new Headers(headers || {}).get("content-type") || ""; }
    catch { return ""; }
  }
  function supportedTextType(type) {
    return !type || /^(text\/|application\/(json|[^;]+\+json|x-www-form-urlencoded)|application\/xml)/i.test(type);
  }

  async function assureText(text) {
    if (typeof text !== "string") throw new Error("AKILA: unsupported non-text body");
    if (new TextEncoder().encode(text).byteLength > MAX_BODY) throw new Error("AKILA: payload exceeds assurance limit");
    const result = await request("ASSURE_TEXT", { text, destination: location.origin + location.pathname });
    if (!result?.verified || typeof result.sanitizedText !== "string") {
      throw new Error("AKILA: submission not verified: " + (result?.reason || "invalid assurance result"));
    }
    return result.sanitizedText;
  }

  async function assureFile(file) {
    if (!(file instanceof File)) throw new Error("AKILA: invalid file");
    if (file.size > FILE_LIMIT) throw new Error("AKILA: file exceeds assurance limit");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const result = await request("ASSURE_FILE", {
      filename: file.name, mimeType: file.type, base64: btoa(binary)
    });
    if (!result?.verified || typeof result.contentBase64 !== "string") {
      throw new Error("AKILA: file not verified: " + (result?.reason || "invalid assurance result"));
    }
    const out = Uint8Array.from(atob(result.contentBase64), c => c.charCodeAt(0));
    return new File([out], file.name, { type: result.mimeType || file.type });
  }

  async function sanitizeBody(body, type) {
    if (body == null) return body;
    if (typeof body === "string") {
      if (!supportedTextType(type)) throw new Error("AKILA: unsupported content type blocked");
      return assureText(body);
    }
    if (body instanceof URLSearchParams) {
      const copy = new URLSearchParams();
      for (const [key, value] of body.entries()) copy.append(key, await assureText(value));
      return copy;
    }
    if (body instanceof FormData) {
      const copy = new FormData();
      for (const [key, value] of body.entries()) {
        copy.append(key, typeof value === "string" ? await assureText(value) : await assureFile(value));
      }
      return copy;
    }
    if (body instanceof Blob) return assureFile(new File([body], "upload", { type: body.type || "application/octet-stream" }));
    throw new Error("AKILA: unsupported request body blocked");
  }

  function restoredResponse(response, text) {
    const headers = new Headers(response.headers);
    ["content-length", "content-encoding", "transfer-encoding"].forEach(h => headers.delete(h));
    // Response constructor rejects bodies for these statuses.
    if ([204, 205, 304].includes(response.status)) return response;
    return new Response(text, { status: response.status, statusText: response.statusText, headers });
  }

  async function restoreResponse(response) {
    const type = response.headers.get("content-type") || "";
    // Do not buffer SSE: preserving streaming behavior is more important than
    // restoration on this explicitly unsupported response path.
    if (/event-stream/i.test(type) || !/(json|text|javascript|xml)/i.test(type)) return response;
    const clone = response.clone();
    const raw = await clone.text();
    if (!raw.includes("<AKILA_")) return response;
    const result = await request("RESTORE_TEXT", { text: raw });
    if (!result?.verified || typeof result.text !== "string") throw new Error("AKILA: response restoration failed");
    return restoredResponse(response, result.text);
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function(input, init = {}) {
    const req = input instanceof Request ? input : null;
    const method = String(init.method || req?.method || "GET").toUpperCase();
    if (!isProtectedPage() || !isOutbound(method) || !isInterceptable(input)) return nativeFetch(input, init);

    const suppliedBody = Object.prototype.hasOwnProperty.call(init, "body");
    if (suppliedBody && init.body == null) return nativeFetch(input, init);
    if (!suppliedBody && !req) return nativeFetch(input, init);
    const headers = init.headers || req?.headers;
    const type = contentType(headers);

    let body = suppliedBody ? init.body : null;
    if (!suppliedBody && req) {
      if (!supportedTextType(type)) throw new Error("AKILA: Request content type unsupported; blocked");
      // Request.body is a ReadableStream in modern browsers. Clone and decode
      // only declared text-like requests; never pass the stream uninspected.
      body = await req.clone().text();
    }
    const safe = await sanitizeBody(body, type);
    const outgoing = req && !suppliedBody
      ? new Request(req, { body: safe, method })
      : [input, { ...init, method, body: safe }];
    const response = await (req && !suppliedBody ? nativeFetch(outgoing) : nativeFetch(...outgoing));
    return restoreResponse(response);
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const meta = new WeakMap();
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    meta.set(this, { method: String(method || "GET").toUpperCase(), url: String(url || ""), headers: {}, responseType: "", contentType: "" });
    return nativeOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    const m = meta.get(this);
    if (m) m.headers[String(name).toLowerCase()] = String(value);
    return nativeSetHeader.call(this, name, value);
  };
  function restoreXhr(xhr) {
    const m = meta.get(xhr);
    if (!m || m.restored || xhr.readyState !== 4) return;
    const type = m.responseType || "";
    const content = m.contentType || "";
    if (type && type !== "text" && type !== "json") return;
    if (/event-stream/i.test(content)) return;
    const raw = typeof xhr.responseText === "string" ? xhr.responseText : "";
    if (!raw.includes("<AKILA_")) return;
    m.restored = true;
    return request("RESTORE_TEXT", { text: raw }).then(result => {
      if (!result?.verified || typeof result.text !== "string") {
        console.warn("[AKILA] XHR response restoration failed");
        return;
      }
      try {
        Object.defineProperty(xhr, "responseText", { configurable: true, value: result.text });
        if (xhr.responseType === "" || xhr.responseType === "text") {
          Object.defineProperty(xhr, "response", { configurable: true, value: result.text });
        }
        xhr.dispatchEvent(new CustomEvent("akila-response-restored"));
      } catch (error) {
        console.warn("[AKILA] browser rejected XHR response override:", error);
      }
    }).catch(error => console.warn("[AKILA] XHR restoration error:", error));
  }

  const nativeAddEventListener = XMLHttpRequest.prototype.addEventListener;
  XMLHttpRequest.prototype.addEventListener = function(type, listener, options) {
    if (type === "load") {
      const wrapped = async (...args) => {
        await restoreXhr(this);
        listener?.apply(this, args);
      };
      return nativeAddEventListener.call(this, type, wrapped, options);
    }
    return nativeAddEventListener.call(this, type, listener, options);
  };

  const nativeOpenResponse = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    const result = nativeOpenResponse.call(this, method, url, ...rest);
    const m = meta.get(this);
    if (m) {
      Object.defineProperty(m, "responseType", { get: () => {
        try { return this.responseType; } catch { return ""; }
      }});
      Object.defineProperty(m, "contentType", { get: () => {
        try { return this.getResponseHeader("content-type") || ""; } catch { return ""; }
      }});
      let onloadHandler = null;
      Object.defineProperty(this, "onload", {
        configurable: true,
        get: () => onloadHandler,
        set: fn => { onloadHandler = typeof fn === "function" ? fn : null; }
      });
      nativeAddEventListener.call(this, "load", async event => {
        await restoreXhr(this);
        if (onloadHandler) onloadHandler.call(this, event);
      });
    }
    return result;
  };

  XMLHttpRequest.prototype.send = function(body) {
    const m = meta.get(this) || { method: "GET", url: "", headers: {} };
    if (!isProtectedPage() || !isOutbound(m.method) || !isInterceptable(m.url) || body == null) return nativeSend.call(this, body);
    sanitizeBody(body, m.headers["content-type"] || "").then(safe => nativeSend.call(this, safe)).catch(error => {
      console.warn("[AKILA] request blocked before transmission:", error.message);
      try { this.dispatchEvent(new ProgressEvent("error")); this.dispatchEvent(new ProgressEvent("loadend")); } catch {}
    });
  };

  console.info("[AKILA] guard active on supported AI site; same-origin outbound requests only");
})();