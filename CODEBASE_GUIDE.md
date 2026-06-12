# Codebase Navigation Guide

## The Two Repos

```
vahana-crypo-sdk/          ← the SDK (the product being built)
cryptosdk-demoapp/         ← the demo app (shows the SDK working)
```

These are separate. The demo app consumes the SDK as a package — it does not touch the SDK source.

---

## Demo App — `cryptosdk-demoapp/`

```
cryptosdk-demoapp/
├── vendor/
│   ├── vahana_crypto-0.1.0-py3-none-any.whl   ← built Python SDK
│   └── vahana-crypto-sdk-0.1.0.tgz            ← built JS SDK
│
├── backend/
│   ├── app.py              ← THE main backend file (Flask server)
│   ├── requirements.txt    ← pip dependencies (references the .whl)
│   └── keys/
│       ├── server_private.pem   ← server's private key (stays on server)
│       └── server_public.pem    ← given to the frontend via .env
│
├── frontend/
│   ├── src/
│   │   └── App.tsx         ← THE main frontend file (entire React UI)
│   ├── package.json        ← npm dependencies (references the .tgz)
│   ├── vite.config.ts      ← build tool config (nothing special)
│   ├── tsconfig.json       ← TypeScript config
│   └── .env                ← holds VITE_SERVER_PUBLIC_KEY
│
├── keygen.py               ← run once to generate the keypair in keys/
├── start.sh                ← starts both backend and frontend
└── CODEBASE_GUIDE.md       ← this file
```

**The two files that matter most in the demo app are `app.py` and `App.tsx`. Everything else is config/setup.**

---

## `backend/app.py` — How to Navigate It

| Lines | Section | What it does |
|-------|---------|--------------|
| 1–13 | Imports | Standard Python imports + SDK imported from installed package |
| 15–30 | Server startup | Loads private key from `keys/server_private.pem` on startup |
| 35–46 | SDK instances | Creates `t1_sdk` and `t2_sdk` — one per protocol |
| 49–72 | Session logging | Prints to terminal when sessions start. Not core logic |
| 77–92 | User store | In-memory dict of users. Three seed users (USR001–USR003) |
| 97–119 | Encryption helpers | `_decrypt_body`, `_encrypt_response`, `_handle` — every endpoint uses these |
| 126–179 | PDF handling | Upload, list, and download handlers |
| 184–253 | User CRUD logic | `_user_create`, `_user_fetch`, `_user_update`, `_user_delete` — plain functions, no encryption |
| 261–288 | Streaming | Encrypts each chunk individually and yields as server-sent event |
| 291–394 | All routes | Every route is a one-liner. T1 (291–337), T2 (340–385), reset (389) |

### The most important block — `_handle` (lines 111–118)

```python
def _handle(sdk, handler_fn):
    body = request.get_json()
    sid = body["cryptoSessionId"]
    data = _decrypt_body(sdk, body)      # SDK decrypts the request
    result = handler_fn(data)            # business logic runs on plain data
    return _encrypt_response(sdk, sid, result)  # SDK encrypts the response
```

Every API endpoint follows this exact pattern. The business logic functions never see encrypted data.

---

## `frontend/src/App.tsx` — How to Navigate It

| Lines | Section | What it does |
|-------|---------|--------------|
| 1–6 | Imports | SDK imported from npm package. Public key loaded from `.env` |
| 35–96 | CARDS array | Defines the four user operation panels. Drives the entire UI grid |
| 110–246 | `ApiCard` component | Reusable card with form fields, Credentials button, Execute button |
| 251–324 | `PdfUploadCard` component | File picker and upload button |
| 328–429 | `StreamCard` component | Message input, streams chunks live |
| 433–515 | `PdfGalleryCard` component | Lists and downloads uploaded PDFs |
| 519–549 | `App` state + `connect` | Holds SDK instance in a ref. New instance created when protocol switches |
| 551–572 | `encryptedCall` | **Most important function.** Every user operation goes through here |
| 574–600 | `uploadFile` | Like `encryptedCall` but sends two payloads — filename + file bytes |
| 602–639 | `listPdfs` / `downloadPdf` | List calls `encryptedCall`. Download converts base64 response to a browser file download |
| 642–686 | `startStream` | Sends one encrypted request, decrypts each chunk as it arrives |
| 694–769 | JSX (the UI) | Header with protocol toggle, then a 3-column grid of the cards above |

### The most important function — `encryptedCall` (lines 551–572)

```typescript
const encReq = await sdk.doEncryption([{ type: 'STRING', value: JSON.stringify(data) }])
// send to backend...
const encResp = await resp.json()
decrypted = await sdk.doDecryption(encResp.encPayloads, encResp.encTxnKey)
return JSON.parse(decrypted[0].value as string)
```

Encrypt → send → receive → decrypt. The UI only ever sees plain data.

---

## SDK Repo — `vahana-crypo-sdk/`

```
vahana-crypo-sdk/
├── backend/python/vahana_crypto/
│   ├── sdk.py           ← T1 backend SDK class
│   ├── sdk_v2.py        ← T2 backend SDK class
│   ├── crypto.py        ← RSA + AES implementations
│   ├── session_store.py ← InMemory / Redis / Postgres session stores
│   └── __init__.py      ← exports everything
│
└── frontend/typescript/src/
    ├── sdk.ts           ← T1 frontend SDK class
    ├── sdk_v2.ts        ← T2 frontend SDK class
    ├── handshake.ts     ← T1 handshake logic
    ├── handshake_v2.ts  ← T2 handshake logic
    ├── crypto.ts        ← RSA + AES using browser WebCrypto API
    └── types.ts         ← TypeScript type definitions
```

### The four SDK files to know

**`backend/python/vahana_crypto/sdk.py`** — T1 backend. Three methods:
- `do_handshake` — handles the handshake request from the frontend
- `do_decryption` — decrypts incoming encrypted payloads
- `do_encryption` — encrypts outgoing response payloads

**`backend/python/vahana_crypto/sdk_v2.py`** — T2 backend. Same three methods, different key management.

**`frontend/typescript/src/sdk.ts`** — T1 frontend. Two methods:
- `doEncryption` — encrypts data before sending (also triggers handshake automatically if not done yet)
- `doDecryption` — decrypts the response

**`frontend/typescript/src/sdk_v2.ts`** — T2 frontend. Same two methods.

---

## T1 vs T2 — The Key Difference

Both protocols follow the same flow. The difference is how keys are managed after the handshake.

| | T1 | T2 |
|---|---|---|
| Per-request RSA | Yes — every call wraps a new key in RSA | No — AES only after handshake |
| Session key | Ephemeral server keypair stored per session | Shared `txnKeyS` AES key stored per session |
| Nonce verification | No | Yes — extra MITM protection |
| Performance | Slower (RSA on every call) | Faster (AES only) |

---

## The One Flow to Memorize

```
User clicks Execute
  → frontend calls doEncryption()
      → if first time: ensureHandshake() runs automatically inside doEncryption
      → data gets encrypted
  → encrypted blob sent to backend over HTTP
  → backend calls do_decryption() → plain data
  → business logic runs (create / read / update / delete)
  → backend calls do_encryption() → encrypted response
  → frontend receives it, calls doDecryption() → plain result
  → UI displays result
```

The handshake is not a separate step the application has to trigger — it is wrapped inside `doEncryption` and fires automatically the first time it is called.

---

## How the SDK is Packaged

The demo app does not have access to the SDK source code. It installs pre-built artifacts from the `vendor/` folder:

- **Python** — `requirements.txt` line 3: `vahana-crypto @ file://../vendor/vahana_crypto-0.1.0-py3-none-any.whl`
  Pip installs the wheel into the virtualenv. `app.py` imports it like any normal package.

- **JavaScript** — `package.json` line 12: `"vahana-crypto-sdk": "file:../vendor/vahana-crypto-sdk-0.1.0.tgz"`
  npm unpacks the tarball into `node_modules/`. `App.tsx` imports it like any normal npm package.

When the SDK is updated, rebuild the artifacts and replace the files in `vendor/`.

```bash
# Rebuild Python wheel (run inside vahana-crypo-sdk/backend/python/)
python -m build --wheel --outdir /path/to/vendor/

# Rebuild npm package (run inside vahana-crypo-sdk/frontend/typescript/)
npm pack --pack-destination /path/to/vendor/
```
