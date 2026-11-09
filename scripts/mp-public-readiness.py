#!/usr/bin/env python3
"""Public, unauthenticated readiness check. Never reads credentials or performs payments."""
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://mp-webhook.hgreco85.workers.dev"
SITE = "https://regalos.hgstack.com/"
HEADERS = {"User-Agent": "HG-Wedding-ReadOnly-Check/1.0"}
out = {"checked_at": datetime.now(timezone.utc).isoformat(), "worker":{}, "site":{}}

def fetch(url, max_size=150000):
    req = urllib.request.Request(url, headers=HEADERS, method="GET")
    with urllib.request.urlopen(req, timeout=16) as r:
        return r.status, r.headers.get("content-type",""), r.read(max_size).decode("utf8","replace")

try:
    status, mime, raw = fetch(BASE + "/health", 10000)
    obj = json.loads(raw)
    out["worker"] = {
        "http":status,
        "status":obj.get("status"),
        "mode":obj.get("mode"),
        "apiMode":obj.get("apiMode"),
        "safe":status==200 and obj.get("status")=="ok" and obj.get("mode")=="staging_test" and obj.get("apiMode")=="orders"
    }
except Exception as e:
    out["worker"]={"safe":False,"error":type(e).__name__}

try:
    status, mime, raw = fetch(SITE, 300000)
    out["site"]={"http":status,"html": "text/html" in mime,"safe":status==200 and "Mariana" in raw and "Hern" in raw}
except Exception as e:
    out["site"]={"safe":False,"error":type(e).__name__}

try:
    status, mime, raw = fetch(BASE + "/api/catalog", 200000)
    parsed=json.loads(raw)
    out["catalog"]={"http":status,"json":True,"safe":status==200 and isinstance(parsed,(dict,list))}
except Exception as e:
    out["catalog"]={"safe":False,"error":type(e).__name__}

try:
    # Send a deliberately unsigned, empty webhook request: the handler must
    # reject before processing any order or touching Mercado Pago/Sheets.
    from urllib.error import HTTPError
    req = urllib.request.Request(BASE + "/webhook/mp", data=b"{}", headers={
        **HEADERS, "Content-Type": "application/json"
    }, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=16) as resp:
            code=resp.status
    except HTTPError as exc:
        code=exc.code
    out["webhook"]={"unsigned_http":code,"configured_and_rejects_unsigned":code==401}
except Exception as e:
    out["webhook"]={"configured_and_rejects_unsigned":False,"error":type(e).__name__}

Path("mp_public_readiness.json").write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
print(json.dumps(out,sort_keys=True))
if not out["worker"]["safe"] or not out["site"]["safe"] or not out["webhook"]["configured_and_rejects_unsigned"]: raise SystemExit(1)
