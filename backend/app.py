#!/usr/bin/env python3
"""Vahana Crypto Demo — Flask backend (T1 + T2)."""
import base64
import datetime
import json
import os
import time
import uuid

from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS

from vahana_crypto import InMemoryCryptoSessionStore, VahanaCryptoSdk, VahanaCryptoSdkV2

app = Flask(__name__)
CORS(app)

_KEYS_DIR = os.path.join(os.path.dirname(__file__), "keys")
_PRIV_PATH = os.path.join(_KEYS_DIR, "server_private.pem")

if not os.path.exists(_PRIV_PATH):
    raise FileNotFoundError(
        f"Server private key not found at {_PRIV_PATH}\n"
        "Run  python keygen.py  once to generate the keypair."
    )

with open(_PRIV_PATH) as f:
    SERVER_PRIV = f.read()

print("✓   Loaded server keypair. Starting demo server.\n", flush=True)


# ─── Session-aware store ──────────────────────────────────────────────

class LoggingSessionStore(InMemoryCryptoSessionStore):
    def __init__(self, proto: str):
        super().__init__()
        self._proto = proto

    def set(self, session_id: str, data: dict) -> None:
        super().set(session_id, data)
        _open_session(session_id, self._proto)


t1_sdk = VahanaCryptoSdk(SERVER_PRIV, LoggingSessionStore("T1"))
t2_sdk = VahanaCryptoSdkV2(SERVER_PRIV, LoggingSessionStore("T2"))


# ─── Session log helpers ──────────────────────────────────────────────

_sessions: dict = {}


def _now() -> str:
    return datetime.datetime.utcnow().strftime("%H:%M:%S UTC")


def _open_session(session_id: str, proto: str) -> None:
    _sessions[session_id] = {"proto": proto, "start": _now()}
    print(f"┌─ [{proto}] session started · {_sessions[session_id]['start']}", flush=True)


def _log(session_id: str, msg: str) -> None:
    proto = _sessions.get(session_id, {}).get("proto", "??")
    print(f"│  [{proto}] {msg}", flush=True)


def _find_latest_session(proto: str) -> str:
    for sid in reversed(list(_sessions.keys())):
        if _sessions[sid]["proto"] == proto:
            return sid
    return ""


# ─── In-memory user store ─────────────────────────────────────────────

_users: dict = {}

_SEED_USERS = [
    {"id": "USR001", "name": "John Doe",   "email": "john@example.com", "role": "Admin",   "password": "test"},
    {"id": "USR002", "name": "Jane Smith", "email": "jane@example.com", "role": "User",    "password": "test"},
    {"id": "USR003", "name": "Bob Wilson", "email": "bob@example.com",  "role": "Manager", "password": "test"},
]


def _seed_users() -> None:
    _users.clear()
    for u in _SEED_USERS:
        _users[u["id"]] = dict(u)


_seed_users()


# ─── Encrypted request helpers ────────────────────────────────────────

def _decrypt_body(sdk, body: dict) -> dict:
    sid = body["cryptoSessionId"]
    if isinstance(sdk, VahanaCryptoSdk):
        decrypted = sdk.do_decryption(body["encPayloads"], sid, body["encTxnKey"])
    else:
        decrypted = sdk.do_decryption(body["encPayloads"], sid)
    return json.loads(decrypted[0]["value"]) if decrypted else {}


def _encrypt_response(sdk, session_id: str, result: dict):
    enc = sdk.do_encryption([{"type": "STRING", "value": json.dumps(result)}], session_id)
    return jsonify(enc)


def _handle(sdk, handler_fn):
    body = request.get_json()
    sid = body["cryptoSessionId"]
    data = _decrypt_body(sdk, body)
    _log(sid, f"decrypted → {json.dumps(data)}")
    result = handler_fn(data)
    _log(sid, f"response  ← {json.dumps(result)}")
    return _encrypt_response(sdk, sid, result)


# ─── In-memory PDF store ──────────────────────────────────────────────

_pdfs: dict = {}


def _handle_pdf(sdk):
    """Upload handler: expects [STRING filename, BINARY pdf_bytes]."""
    body = request.get_json()
    sid = body["cryptoSessionId"]
    if isinstance(sdk, VahanaCryptoSdk):
        decrypted = sdk.do_decryption(body["encPayloads"], sid, body["encTxnKey"])
    else:
        decrypted = sdk.do_decryption(body["encPayloads"], sid)

    filename  = decrypted[0]["value"] if len(decrypted) > 1 else "upload.pdf"
    pdf_bytes = decrypted[1]["value"] if len(decrypted) > 1 else (decrypted[0]["value"] if decrypted else b"")
    size = len(pdf_bytes)

    pdf_id = str(uuid.uuid4())[:8]
    _pdfs[pdf_id] = {
        "id": pdf_id,
        "filename": filename,
        "size": size,
        "data": pdf_bytes,
        "uploadedAt": datetime.datetime.utcnow().isoformat() + "Z",
    }
    _log(sid, f"PDF stored — id={pdf_id} filename={filename} size={size:,} bytes")

    result = {
        "success": True,
        "id": pdf_id,
        "filename": filename,
        "receivedBytes": size,
        "timestamp": _pdfs[pdf_id]["uploadedAt"],
    }
    _log(sid, f"response  ← {json.dumps(result)}")
    return _encrypt_response(sdk, sid, result)


def _pdf_list(data: dict) -> dict:
    items = [
        {"id": p["id"], "filename": p["filename"], "size": p["size"], "uploadedAt": p["uploadedAt"]}
        for p in _pdfs.values()
    ]
    return {"success": True, "pdfs": items, "count": len(items)}


def _pdf_download(data: dict) -> dict:
    pdf_id = (data.get("id") or "").strip()
    if not pdf_id or pdf_id not in _pdfs:
        return {"success": False, "error": f"PDF '{pdf_id}' not found"}
    p = _pdfs[pdf_id]
    return {
        "success": True,
        "id": p["id"],
        "filename": p["filename"],
        "size": p["size"],
        "data": base64.b64encode(p["data"]).decode(),
    }


# ─── User operation handlers ──────────────────────────────────────────

def _safe(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "password"}


def _user_create(data: dict) -> dict:
    password = (data.get("password") or "").strip()
    if not password:
        return {"success": False, "error": "Password is required"}
    user_id = (data.get("id") or f"USR{str(uuid.uuid4())[:6].upper()}").strip()
    user = {
        "id": user_id,
        "name": data.get("name", ""),
        "email": data.get("email", ""),
        "role": data.get("role", "User"),
        "password": password,
    }
    _users[user_id] = user
    return {"success": True, "operation": "CREATE", "user": _safe(user), "totalUsers": len(_users)}


_ADMIN_PASSWORD = "admin"


def _user_fetch(data: dict) -> dict:
    user_id  = (data.get("id") or "").strip()
    password = (data.get("password") or "").strip()

    if not password:
        return {"success": False, "error": "Password is required"}

    if not user_id:
        if password != _ADMIN_PASSWORD:
            return {"success": False, "error": "Incorrect admin password"}
        return {"success": True, "operation": "LIST", "users": [_safe(u) for u in _users.values()], "count": len(_users)}

    user = _users.get(user_id)
    if not user:
        return {"success": False, "error": f"User '{user_id}' not found"}
    if user["password"] != password:
        return {"success": False, "error": "Incorrect password"}
    return {"success": True, "operation": "READ", "user": _safe(user)}


def _user_update(data: dict) -> dict:
    user_id          = (data.get("id") or "").strip()
    current_password = (data.get("currentPassword") or "").strip()
    if not current_password:
        return {"success": False, "error": "Current password is required"}
    if not user_id or user_id not in _users:
        return {"success": False, "error": f"User '{user_id}' not found"}
    if _users[user_id]["password"] != current_password:
        return {"success": False, "error": "Incorrect current password"}
    updates = {k: v for k, v in data.items() if k not in ("id", "currentPassword")}
    if not (updates.get("password") or "").strip():
        updates.pop("password", None)
    _users[user_id].update(updates)
    return {"success": True, "operation": "UPDATE", "user": _safe(_users[user_id])}


def _user_delete(data: dict) -> dict:
    user_id  = (data.get("id") or "").strip()
    password = (data.get("password") or "").strip()
    if not password:
        return {"success": False, "error": "Password is required"}
    if not user_id or user_id not in _users:
        return {"success": False, "error": f"User '{user_id}' not found"}
    if _users[user_id]["password"] != password:
        return {"success": False, "error": "Incorrect password"}
    deleted = _users.pop(user_id)
    return {"success": True, "operation": "DELETE", "deleted": _safe(deleted), "remainingUsers": len(_users)}


_STREAM_TYPES = ["text", "image", "text", "data", "text"]


# ─── Streaming handler ────────────────────────────────────────────────

def _make_stream(sdk):
    body = request.get_json()
    data = _decrypt_body(sdk, body)
    sid = body["cryptoSessionId"]
    message = data.get("message", "Hello")
    repeat_count = max(1, min(int(data.get("repeatCount", 3)), 10))

    @stream_with_context
    def generate():
        for i in range(repeat_count):
            chunk = {
                "type": _STREAM_TYPES[i % len(_STREAM_TYPES)],
                "content": f"{message} — chunk {i + 1} of {repeat_count}",
                "index": i + 1,
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            }
            enc = sdk.do_encryption([{"type": "STRING", "value": json.dumps(chunk)}], sid)
            yield f"data: {json.dumps(enc)}\n\n"
            time.sleep(0.4)
        yield "data: [DONE]\n\n"

    return Response(
        generate(),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── T1 routes ────────────────────────────────────────────────────────

@app.post("/api/t1/handshake")
def t1_handshake():
    result = t1_sdk.do_handshake(request.get_json())
    _log(_find_latest_session("T1"), "← handshake  →  session established")
    return jsonify(result)


@app.post("/api/t1/users/create")
def t1_users_create():
    return _handle(t1_sdk, _user_create)


@app.post("/api/t1/users/fetch")
def t1_users_fetch():
    return _handle(t1_sdk, _user_fetch)


@app.post("/api/t1/users/update")
def t1_users_update():
    return _handle(t1_sdk, _user_update)


@app.post("/api/t1/users/delete")
def t1_users_delete():
    return _handle(t1_sdk, _user_delete)


@app.post("/api/t1/content/pdf")
def t1_content_pdf():
    return _handle_pdf(t1_sdk)


@app.post("/api/t1/pdfs/list")
def t1_pdfs_list():
    return _handle(t1_sdk, _pdf_list)


@app.post("/api/t1/pdfs/download")
def t1_pdfs_download():
    return _handle(t1_sdk, _pdf_download)


@app.post("/api/t1/stream")
def t1_stream():
    return _make_stream(t1_sdk)


# ─── T2 routes ────────────────────────────────────────────────────────

@app.post("/api/t2/handshake")
def t2_handshake():
    result = t2_sdk.do_handshake(request.get_json())
    _log(_find_latest_session("T2"), "← handshake  →  session established")
    return jsonify(result)


@app.post("/api/t2/users/create")
def t2_users_create():
    return _handle(t2_sdk, _user_create)


@app.post("/api/t2/users/fetch")
def t2_users_fetch():
    return _handle(t2_sdk, _user_fetch)


@app.post("/api/t2/users/update")
def t2_users_update():
    return _handle(t2_sdk, _user_update)


@app.post("/api/t2/users/delete")
def t2_users_delete():
    return _handle(t2_sdk, _user_delete)


@app.post("/api/t2/content/pdf")
def t2_content_pdf():
    return _handle_pdf(t2_sdk)


@app.post("/api/t2/pdfs/list")
def t2_pdfs_list():
    return _handle(t2_sdk, _pdf_list)


@app.post("/api/t2/pdfs/download")
def t2_pdfs_download():
    return _handle(t2_sdk, _pdf_download)


@app.post("/api/t2/stream")
def t2_stream():
    return _make_stream(t2_sdk)


# ─── Utility ──────────────────────────────────────────────────────────

@app.get("/api/users/reset")
def reset_users():
    _seed_users()
    return jsonify({"success": True, "message": "User store reset to seed data", "count": len(_users)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False)
