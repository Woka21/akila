from __future__ import annotations
import base64, hashlib, re, threading, time
from dataclasses import dataclass, field

MAX_TEXT_BYTES=2*1024*1024
MAX_FILE_BYTES=16*1024*1024
TOKEN_TTL_SECONDS=30*60
PATTERNS=[
 ("EMAIL",re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",re.I)),
 ("PHONE",re.compile(r"(?<!\d)(?:\+?254|0)\d{9}(?!\d)")),
 ("API_KEY",re.compile(r"\b(?:sk|pk|AKIA|ghp|xox[baprs])-?[A-Za-z0-9_-]{12,}\b")),
 ("NATIONAL_ID",re.compile(r"\b\d{7,9}\b")),
]
@dataclass
class Mapping:
 token:str; original:str; kind:str
@dataclass
class SessionVault:
 mappings:dict[str,Mapping]=field(default_factory=dict)
 last_seen:float=field(default_factory=time.time)
class AssuranceEngine:
 def __init__(self): self._lock=threading.RLock(); self._sessions={}
 def _vault(self,sid):
  with self._lock:
   now=time.time()
   self._sessions.setdefault(sid,SessionVault()).last_seen=now
   for k,v in list(self._sessions.items()):
    if now-v.last_seen>TOKEN_TTL_SECONDS: self._sessions.pop(k,None)
   return self._sessions[sid]
 @staticmethod
 def _token(kind,original): return f"<AKILA_{kind}_{hashlib.sha256(original.encode()).hexdigest()[:10]}>"
 def sanitize_text(self,sid,text):
  if not isinstance(text,str): raise ValueError("text must be a string")
  if len(text.encode())>MAX_TEXT_BYTES: raise ValueError("payload exceeds text assurance limit")
  vault=self._vault(sid); spans=[]; found={}
  for kind,pat in PATTERNS:
   for m in pat.finditer(text):
    token=self._token(kind,m.group()); mapping=vault.mappings.setdefault(token,Mapping(token,m.group(),kind))
    found[token]=mapping; spans.append((m.start(),m.end(),mapping))
  spans.sort(key=lambda x:(x[0],-(x[1]-x[0]))); selected=[]; cursor=-1
  for s,e,m in spans:
   if s>=cursor: selected.append((s,e,m)); cursor=e
  out=[]; pos=0
  for s,e,m in selected: out += [text[pos:s],m.token]; pos=e
  out.append(text[pos:])
  return "".join(out),list(found.values())
 def restore_text(self,sid,text):
  vault=self._vault(sid)
  for m in sorted(vault.mappings.values(),key=lambda x:len(x.token),reverse=True): text=text.replace(m.token,m.original)
  return text
 def assure_text(self,sid,text,destination="unknown"):
  safe,m=self.sanitize_text(sid,text)
  return {"verified":True,"sanitizedText":safe,"entityCount":len(m),"destination":destination,
          "assurance":{"capture":"complete","inspection":"complete","transform":"complete","policy":"transform" if m else "allow"}}
 def assure_bytes(self,sid,filename,mime,data):
  if len(data)>MAX_FILE_BYTES: raise ValueError("file exceeds assurance limit")
  textual=mime.startswith("text/") or filename.lower().endswith((".txt",".csv",".json",".xml",".md",".log",".py",".js",".ts",".html",".css"))
  if not textual: return {"verified":False,"reason":"binary format requires a trusted parser","capture":"complete","inspection":"unsupported","policy":"deny"}
  safe,m=self.sanitize_text(sid,data.decode("utf-8","strict"))
  return {"verified":True,"contentBase64":base64.b64encode(safe.encode()).decode(),"mimeType":mime or "text/plain","filename":filename,"entityCount":len(m),"assurance":{"capture":"complete","inspection":"complete","transform":"complete","policy":"transform" if m else "allow"}}
