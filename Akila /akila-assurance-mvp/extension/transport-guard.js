(()=>{if(window.__AKILA_TRANSPORT_GUARD__)return;window.__AKILA_TRANSPORT_GUARD__=true;
const nativeFetch=window.fetch.bind(window), nativeXHR={open:XMLHttpRequest.prototype.open,send:XMLHttpRequest.prototype.send};
const outbound=m=>["POST","PUT","PATCH"].includes(String(m||"GET").toUpperCase());
const gap=k=>window.postMessage({channel:"AKILA_ASSURANCE_EVENT",event:{type:"inspection_gap",kind:k,policy:"deny"}},"*");
window.fetch=async function(input,init={}){const r=input instanceof Request?input:null,m=String(init.method||r?.method||"GET").toUpperCase(),b=init.body!==undefined?init.body:r?.body;if(!outbound(m)||b==null)return nativeFetch(input,init);if(b instanceof ReadableStream){gap("fetch_stream");throw Error("AKILA: unsupported stream blocked")}return nativeFetch(input,init)};
XMLHttpRequest.prototype.open=function(m,u,...x){this.__akilaMeta={method:String(m||"GET").toUpperCase(),url:String(u||"")};return nativeXHR.open.call(this,m,u,...x)};
XMLHttpRequest.prototype.send=function(b){const m=this.__akilaMeta?.method||"GET";if(outbound(m)&&b instanceof ReadableStream){gap("xhr_stream");throw Error("AKILA: unsupported stream blocked")}return nativeXHR.send.call(this,b)};
if(navigator.sendBeacon){const beacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(){gap("sendBeacon");return false}};
const WS=window.WebSocket;if(WS){window.WebSocket=function(){gap("websocket");throw Error("AKILA: websocket requires endpoint agent")};window.WebSocket.prototype=WS.prototype}
})();