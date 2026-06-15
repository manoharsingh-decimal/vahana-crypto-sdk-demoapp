import { useEffect, useRef, useState } from 'react'
import { VahanaCryptoSdk, VahanaCryptoSdkV2 } from 'vahana-crypto-sdk'
import type { FrontendSdkConfig, Payload } from 'vahana-crypto-sdk'

type AnyVahanaSdk = VahanaCryptoSdk | VahanaCryptoSdkV2

const BACKEND = 'http://localhost:8000'
const SERVER_PUBLIC_KEY = import.meta.env.VITE_SERVER_PUBLIC_KEY?.replace(/\\n/g, '\n') ?? ''

const C = {
  sdk:    '#a78bfa',
  api:    '#fbbf24',
  stream: '#f472b6',
  req:    '#38bdf8',
  res:    '#4ade80',
  dim:    '#94a3b8',
} as const

function sdkLog(method: string, endpoint: string, req: unknown, res: unknown) {
  console.groupCollapsed(
    '%c[Vahana SDK] %c%s %s',
    `color:${C.sdk};font-weight:bold`,
    `color:${C.api}`,
    method,
    endpoint,
  )
  console.log('%c→ %creq', `color:${C.req}`, `color:${C.dim}`, req)
  console.log('%c← %cres', `color:${C.res}`, `color:${C.dim}`, res)
  console.groupEnd()
}

type Protocol = 'T1' | 'T2'
type SessionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface FieldDef {
  key: string
  label: string
  placeholder?: string
  inputType?: string
  required?: boolean
}

interface StreamChunk {
  type: string
  content: string
  index: number
  timestamp: string
}

interface PdfMeta {
  id: string
  filename: string
  size: number
  uploadedAt: string
}

// ── Card configs ──────────────────────────────────────────────────────────────

const CARDS: Array<{
  title: string
  method: string
  description: string
  endpoint: string
  fields: FieldDef[]
  demo: Record<string, string | number>
  showResult?: boolean
}> = [
  {
    title: 'Create User',
    method: 'POST',
    description: 'Create a new user record (encrypted end-to-end).',
    endpoint: '/users/create',
    fields: [
      { key: 'id',       label: 'User ID',  placeholder: 'USR004',           required: true },
      { key: 'name',     label: 'Name',     placeholder: 'Alice Brown',       required: true },
      { key: 'email',    label: 'Email',    placeholder: 'alice@example.com', required: true },
      { key: 'role',     label: 'Role',     placeholder: 'Admin',             required: true },
      { key: 'password', label: 'Password', placeholder: '••••••••',          required: true, inputType: 'password' },
    ],
    demo: { id: 'USR004', name: 'Alice Brown', email: 'alice@example.com', role: 'Admin', password: 'test' },
  },
  {
    title: 'Read User',
    method: 'GET',
    description: 'Fetch a user by ID + password, or leave ID blank and use admin password to list all.',
    endpoint: '/users/fetch',
    fields: [
      { key: 'id',       label: 'User ID',  placeholder: 'USR001 (leave blank for all)' },
      { key: 'password', label: 'Password', placeholder: '••••••••', inputType: 'password' },
    ],
    demo: { id: '', password: 'admin' },
    showResult: true,
  },
  {
    title: 'Update User',
    method: 'PUT',
    description: 'Verify current password before updating credentials.',
    endpoint: '/users/update',
    fields: [
      { key: 'id',              label: 'User ID',          placeholder: 'USR003',                  required: true },
      { key: 'currentPassword', label: 'Current Password', placeholder: '••••••••',                required: true, inputType: 'password' },
      { key: 'name',            label: 'Name',             placeholder: 'Bob Wilson' },
      { key: 'email',           label: 'Email',            placeholder: 'bob.updated@example.com' },
      { key: 'role',            label: 'Role',             placeholder: 'Director' },
      { key: 'password',        label: 'New Password',     placeholder: 'leave blank to keep current', inputType: 'password' },
    ],
    demo: { id: 'USR003', currentPassword: 'test', name: 'Bob Wilson', email: 'bob.updated@example.com', role: 'Director', password: 'test' },
  },
  {
    title: 'Delete User',
    method: 'DELETE',
    description: 'Delete a user by ID. Password required to confirm.',
    endpoint: '/users/delete',
    fields: [
      { key: 'id',       label: 'User ID',  placeholder: 'USR002' },
      { key: 'password', label: 'Password', placeholder: '••••••••', inputType: 'password' },
    ],
    demo: { id: 'USR002', password: 'test' },
  },
]

// ── ApiCard ───────────────────────────────────────────────────────────────────

type UserRecord = { id: string; name: string; email: string; role: string }
type FetchResult = {
  success: boolean
  operation?: string
  user?: UserRecord
  users?: UserRecord[]
  count?: number
  error?: string
}

function UserResultDisplay({ result }: { result: FetchResult }) {
  if (!result.success) {
    return (
      <div style={{ marginTop: 8, borderTop: '1px solid #ddd', paddingTop: 6, fontSize: 12, color: '#c00' }}>
        {result.error ?? 'User not found'}
      </div>
    )
  }
  if (result.operation === 'LIST' && result.users) {
    return (
      <div style={{ marginTop: 8, borderTop: '1px solid #ddd', paddingTop: 6 }}>
        <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>{result.count} user{result.count !== 1 ? 's' : ''}</div>
        {result.users.map(u => (
          <div key={u.id} style={{ fontSize: 12, fontFamily: 'monospace', marginBottom: 3, display: 'flex', gap: 10 }}>
            <span style={{ color: '#888', minWidth: 54 }}>{u.id}</span>
            <span style={{ minWidth: 140 }}>{u.name}</span>
            <span style={{ color: '#555' }}>{u.role}</span>
          </div>
        ))}
      </div>
    )
  }
  if (result.user) {
    const u = result.user
    return (
      <div style={{ marginTop: 8, borderTop: '1px solid #ddd', paddingTop: 6 }}>
        {[['ID', u.id], ['Name', u.name], ['Email', u.email], ['Role', u.role]].map(([label, val]) => (
          <div key={label} style={{ fontSize: 12, marginBottom: 3, display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#555', minWidth: 38 }}>{label}</span>
            <span style={{ fontFamily: 'monospace' }}>{val}</span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

function ApiCard({
  title, method, description, endpoint, fields, demo, onRun, disabled, showResult,
}: {
  title: string
  method: string
  description: string
  endpoint: string
  fields: FieldDef[]
  demo: Record<string, string | number>
  onRun: (endpoint: string, data: Record<string, unknown>) => Promise<unknown>
  disabled: boolean
  showResult?: boolean
}) {
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map(f => [f.key, '']))
  )
  const [state, setState]   = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [msg, setMsg]       = useState('')
  const [result, setResult] = useState<FetchResult | null>(null)

  function loadCredentials() {
    setValues(Object.fromEntries(fields.map(f => [f.key, String(demo[f.key] ?? '')])))
    setState('idle')
    setMsg('')
    setResult(null)
  }

  async function execute() {
    const missing = fields.filter(f => f.required && !values[f.key].trim())
    if (missing.length > 0) {
      setState('error')
      setMsg(`${missing.map(f => f.label).join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`)
      return
    }
    setState('running')
    setMsg('')
    setResult(null)
    try {
      const data: Record<string, unknown> = {}
      for (const f of fields) {
        const v = values[f.key].trim()
        if (v !== '') data[f.key] = f.inputType === 'number' ? Number(v) : v
      }
      const res = await onRun(endpoint, data)
      setState('success')
      setMsg('Request succeeded')
      if (showResult) setResult(res as FetchResult)
    } catch (e) {
      setState('error')
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  const busy = state === 'running'

  return (
    <fieldset style={{ margin: 0, padding: '10px 12px', boxSizing: 'border-box' }}>
      <legend style={{ fontFamily: 'monospace', fontSize: 12 }}>
        <strong style={{ marginRight: 5 }}>{method}</strong>{title}
      </legend>
      <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>{description}</div>

      {fields.map(f => (
        <div key={f.key} style={{ marginBottom: 6 }}>
          <label style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>{f.label}</label>
          <input
            type={f.inputType ?? 'text'}
            value={values[f.key]}
            placeholder={f.placeholder}
            onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '4px 6px',
              fontFamily: 'monospace', fontSize: 12, border: '1px solid #bbb',
            }}
          />
        </div>
      ))}

      <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={loadCredentials} style={{ padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>
          Credentials
        </button>
        <button
          onClick={execute}
          disabled={disabled || busy}
          style={{
            padding: '4px 14px', fontSize: 12, fontWeight: 'bold',
            cursor: disabled || busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Running…' : 'Execute'}
        </button>
        {state === 'success' && !showResult && <span style={{ fontSize: 11 }}>✓ {msg}</span>}
        {state === 'error'   && <span style={{ fontSize: 11, color: '#c00' }}>✗ {msg}</span>}
      </div>

      {showResult && result && <UserResultDisplay result={result} />}
    </fieldset>
  )
}

// ── PdfUploadCard ─────────────────────────────────────────────────────────────

function PdfUploadCard({
  onUpload, disabled,
}: {
  onUpload: (file: File) => Promise<void>
  disabled: boolean
}) {
  const [file, setFile]   = useState<File | null>(null)
  const [state, setState] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [msg, setMsg]     = useState('')

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null)
    setState('idle')
    setMsg('')
  }

  async function execute() {
    if (!file) { setState('error'); setMsg('Select a PDF file first'); return }
    setState('running')
    setMsg('')
    try {
      await onUpload(file)
      setState('success')
      setMsg(`${file.name} uploaded and decrypted on server`)
    } catch (e) {
      setState('error')
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  const busy = state === 'running'

  return (
    <fieldset style={{ margin: 0, padding: '10px 12px', boxSizing: 'border-box' }}>
      <legend style={{ fontFamily: 'monospace', fontSize: 12 }}>
        <strong style={{ marginRight: 5 }}>POST</strong>PDF Upload
      </legend>
      <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>
        Upload a PDF — encrypted as binary end-to-end via the SDK.
      </div>

      <div style={{ marginBottom: 6 }}>
        <label style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>PDF File</label>
        <input
          type="file"
          accept=".pdf,application/pdf"
          onChange={handleFileChange}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }}
        />
      </div>

      {file && (
        <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>
          {file.name} — {(file.size / 1024).toFixed(1)} KB
        </div>
      )}

      <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={execute}
          disabled={disabled || busy || !file}
          style={{
            padding: '4px 14px', fontSize: 12, fontWeight: 'bold',
            cursor: disabled || busy || !file ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Uploading…' : 'Upload'}
        </button>
        {state === 'success' && <span style={{ fontSize: 11 }}>✓ {msg}</span>}
        {state === 'error'   && <span style={{ fontSize: 11, color: '#c00' }}>✗ {msg}</span>}
      </div>
    </fieldset>
  )
}

// ── StreamCard ────────────────────────────────────────────────────────────────

function StreamCard({
  onStartStream, disabled,
}: {
  onStartStream: (message: string, repeatCount: number, onChunk: (c: StreamChunk) => void) => Promise<void>
  disabled: boolean
}) {
  const [message, setMessage]         = useState('')
  const [repeatCount, setRepeatCount] = useState('')
  const [chunks, setChunks]           = useState<StreamChunk[]>([])
  const [running, setRunning]         = useState(false)
  const [error, setError]             = useState('')

  function loadCredentials() {
    setMessage('Hello from Vahana SDK')
    setRepeatCount('5')
    setChunks([])
    setError('')
  }

  async function start() {
    const count = Number(repeatCount)
    if (!repeatCount.trim() || !Number.isInteger(count) || count < 1) {
      setError('Repeat count must be a positive whole number')
      return
    }
    setRunning(true)
    setChunks([])
    setError('')
    try {
      await onStartStream(
        message || 'Hello from Vahana SDK',
        count,
        chunk => setChunks(prev => [...prev, chunk]),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <fieldset style={{ margin: 0, padding: '10px 12px', boxSizing: 'border-box' }}>
      <legend style={{ fontFamily: 'monospace', fontSize: 12 }}>
        <strong style={{ marginRight: 5 }}>POST</strong>Streaming
      </legend>
      <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>
        Encrypted server-sent event stream, decrypted live in the browser.
      </div>

      <div style={{ marginBottom: 6 }}>
        <label style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>Message</label>
        <input
          value={message}
          placeholder="Hello from Vahana SDK"
          onChange={e => setMessage(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '4px 6px',
            fontFamily: 'monospace', fontSize: 12, border: '1px solid #bbb',
          }}
        />
      </div>
      <div style={{ marginBottom: 6 }}>
        <label style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>Repeat Count</label>
        <input
          type="number"
          value={repeatCount}
          placeholder="5"
          onChange={e => setRepeatCount(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '4px 6px',
            fontFamily: 'monospace', fontSize: 12, border: '1px solid #bbb',
          }}
        />
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={loadCredentials} style={{ padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>
          Credentials
        </button>
        <button
          onClick={start}
          disabled={disabled || running}
          style={{
            padding: '4px 14px', fontSize: 12, fontWeight: 'bold',
            cursor: disabled || running ? 'not-allowed' : 'pointer',
          }}
        >
          {running ? 'Streaming…' : 'Start Stream'}
        </button>
        {error && <span style={{ fontSize: 11, color: '#c00' }}>✗ {error}</span>}
      </div>

      {(chunks.length > 0 || running) && (
        <div style={{ marginTop: 8, borderTop: '1px solid #ddd', paddingTop: 6 }}>
          {chunks.map((c, i) => (
            <div key={i} style={{ fontSize: 12, fontFamily: 'monospace', marginBottom: 3 }}>
              <span style={{ color: '#888', width: 24, display: 'inline-block' }}>#{c.index}</span>
              {c.content}
            </div>
          ))}
          {running && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>receiving…</div>}
        </div>
      )}
    </fieldset>
  )
}

// ── PdfGalleryCard ────────────────────────────────────────────────────────────

function PdfGalleryCard({
  onList, onDownload, disabled,
}: {
  onList: () => Promise<PdfMeta[]>
  onDownload: (id: string, filename: string) => Promise<void>
  disabled: boolean
}) {
  const [pdfs, setPdfs]           = useState<PdfMeta[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const list = await onList()
      setPdfs(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function download(id: string, filename: string) {
    setDownloading(id)
    try {
      await onDownload(id, filename)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloading(null)
    }
  }

  return (
    <fieldset style={{ margin: 0, padding: '10px 12px', boxSizing: 'border-box' }}>
      <legend style={{ fontFamily: 'monospace', fontSize: 12 }}>
        <strong style={{ marginRight: 5 }}>GET</strong>PDF Gallery
      </legend>
      <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>
        List all uploaded PDFs; download any file via encrypted binary transfer.
      </div>

      <div style={{ marginBottom: 8 }}>
        <button
          onClick={refresh}
          disabled={disabled || loading}
          style={{
            padding: '4px 14px', fontSize: 12, fontWeight: 'bold',
            cursor: disabled || loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {error && <span style={{ fontSize: 11, color: '#c00', marginLeft: 8 }}>✗ {error}</span>}
      </div>

      {pdfs.length === 0 && !loading && (
        <div style={{ fontSize: 11, color: '#888' }}>No PDFs uploaded yet. Hit Refresh after uploading.</div>
      )}

      {pdfs.map(p => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, fontSize: 12 }}>
          <span style={{ flex: 1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.filename}
          </span>
          <span style={{ color: '#888', whiteSpace: 'nowrap', fontSize: 11 }}>
            {(p.size / 1024).toFixed(1)} KB
          </span>
          <button
            onClick={() => download(p.id, p.filename)}
            disabled={disabled || downloading === p.id}
            style={{ padding: '2px 8px', fontSize: 11, cursor: disabled || downloading === p.id ? 'not-allowed' : 'pointer' }}
          >
            {downloading === p.id ? '…' : 'Download'}
          </button>
        </div>
      ))}
    </fieldset>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [protocol, setProtocol]   = useState<Protocol>('T1')
  const [status, setStatus]       = useState<SessionStatus>('disconnected')
  const [sessionId, setSessionId] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const sdkRef = useRef<AnyVahanaSdk | null>(null)

  useEffect(() => { connect(protocol) }, [protocol])

  function connect(proto: Protocol) {
    setStatus('connected')
    setSessionId('')
    setStatusMsg('')

    if (!SERVER_PUBLIC_KEY) {
      setStatus('error')
      setStatusMsg('VITE_SERVER_PUBLIC_KEY is not set. Check .env in frontend.')
      return
    }

    const config: FrontendSdkConfig = {
      baseUri: BACKEND,
      handshakeEndpoint: `/api/${proto.toLowerCase()}/handshake`,
      publicKey: SERVER_PUBLIC_KEY,
      txnKeyName: 'txnKey',
      payloadKeyName: 'payload',
    }

    const sdk = proto === 'T2' ? new VahanaCryptoSdkV2(config) : new VahanaCryptoSdk(config)
    sdkRef.current = sdk

    console.groupCollapsed(
      '%c[Vahana SDK] %cnew VahanaCryptoSdk',
      `color:${C.sdk};font-weight:bold`,
      `color:${C.api}`,
    )
    console.log('%cpublicKey',         `color:${C.dim}`, config.publicKey.slice(0, 64) + '…')
    console.log('%cbaseUri',           `color:${C.dim}`, config.baseUri)
    console.log('%ctxnKeyName',        `color:${C.dim}`, config.txnKeyName)
    console.log('%chandshakeEndpoint', `color:${C.dim}`, config.handshakeEndpoint)
    console.log('%cversion',           `color:${C.dim}`, proto)
    console.groupEnd()
  }

  async function callDoDecryption(encPayloads: any[], encTxnKey?: string): Promise<Payload[]> {
    const sdk = sdkRef.current!
    if (sdk instanceof VahanaCryptoSdkV2) return sdk.doDecryption(encPayloads)
    return (sdk as VahanaCryptoSdk).doDecryption(encPayloads, encTxnKey!)
  }

  async function encryptedCall(endpoint: string, data: Record<string, unknown>): Promise<unknown> {
    const sdk = sdkRef.current
    if (!sdk) throw new Error('Not connected — wait for handshake')

    const payloads = [{ type: 'STRING' as const, value: JSON.stringify(data) }]
    const encReq = await sdk.doEncryption(payloads)
    setSessionId(encReq.cryptoSessionId)
    const backendReq = JSON.parse(JSON.stringify(encReq))
    backendReq.encPayloads = backendReq.encPayloads.map((p: any) => ({ value: p.value }))
    const resp = await fetch(`${BACKEND}/api/${protocol.toLowerCase()}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendReq),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`)

    const encResp = await resp.json()
    const decrypted = await callDoDecryption(encResp.encPayloads, encResp.encTxnKey)
    const result = JSON.parse(decrypted[0].value as string)
    sdkLog('POST', endpoint, data, result)
    return result
  }

  async function uploadFile(file: File): Promise<void> {
    const sdk = sdkRef.current
    if (!sdk) throw new Error('Not connected — wait for handshake')

    const arrayBuffer = await file.arrayBuffer()
    const payloads = [
      { type: 'STRING' as const, value: file.name },
      { type: 'BINARY' as const, value: arrayBuffer },
    ]
    const encReq = await sdk.doEncryption(payloads)
    setSessionId(encReq.cryptoSessionId)
    const backendReq = JSON.parse(JSON.stringify(encReq))
    backendReq.encPayloads = backendReq.encPayloads.map((p: any) => ({ value: p.value }))
    const resp = await fetch(`${BACKEND}/api/${protocol.toLowerCase()}/content/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendReq),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`)

    const encResp = await resp.json()
    const decrypted = await callDoDecryption(encResp.encPayloads, encResp.encTxnKey)
    const result = JSON.parse(decrypted[0].value as string)
    sdkLog('POST', '/content/pdf', { filename: file.name, bytes: file.size }, result)
    if (!result.success) throw new Error(result.error ?? 'Upload failed')
  }

  async function listPdfs(): Promise<PdfMeta[]> {
    const result = await encryptedCall('/pdfs/list', {}) as { pdfs: PdfMeta[]; count: number }
    return result.pdfs ?? []
  }

  async function downloadPdf(id: string, filename: string): Promise<void> {
    const sdk = sdkRef.current
    if (!sdk) throw new Error('Not connected — wait for handshake')

    const payloads = [{ type: 'STRING' as const, value: JSON.stringify({ id }) }]
    const encReq = await sdk.doEncryption(payloads)
    setSessionId(encReq.cryptoSessionId)
    const backendReq = JSON.parse(JSON.stringify(encReq))
    backendReq.encPayloads = backendReq.encPayloads.map((p: any) => ({ value: p.value }))
    const resp = await fetch(`${BACKEND}/api/${protocol.toLowerCase()}/pdfs/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendReq),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`)

    const encResp = await resp.json()
    const decrypted = await callDoDecryption(encResp.encPayloads, encResp.encTxnKey)
    const result = JSON.parse(decrypted[0].value as string)
    const loggedResult = result.data
      ? { ...result, data: `<binary ${Math.round((result.data as string).length * 3 / 4)} bytes>` }
      : result
    sdkLog('POST', '/pdfs/download', { id }, loggedResult)
    if (!result.success) throw new Error(result.error ?? 'Download failed')

    // Base64 → Uint8Array → Blob → anchor download
    const binary = atob(result.data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function startStream(
    message: string,
    repeatCount: number,
    onChunk: (c: StreamChunk) => void,
  ) {
    const sdk = sdkRef.current
    if (!sdk) throw new Error('Not connected')

    console.log(
      '%c[Vahana SDK] %cstream →',
      `color:${C.sdk};font-weight:bold`,
      `color:${C.stream}`,
      { message, repeatCount },
    )

    const payloads = [{ type: 'STRING' as const, value: JSON.stringify({ message, repeatCount }) }]
    const encReq = await sdk.doEncryption(payloads)
    setSessionId(encReq.cryptoSessionId)
    const backendReq = JSON.parse(JSON.stringify(encReq))
    backendReq.encPayloads = backendReq.encPayloads.map((p: any) => ({ value: p.value }))
    const response = await fetch(`${BACKEND}/api/${protocol.toLowerCase()}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendReq),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') return

        const encChunk = JSON.parse(raw)
        const decrypted: Payload[] = await callDoDecryption(encChunk.encPayloads, encChunk.encTxnKey)
        const chunk = JSON.parse(decrypted[0].value as string) as StreamChunk
        console.log(
          '%c[Vahana SDK] %cstream ← #%d',
          `color:${C.sdk};font-weight:bold`,
          `color:${C.stream}`,
          chunk.index,
          chunk,
        )
        onChunk(chunk)
      }
    }
  }

  async function resetUserStore() {
    try { await fetch(`${BACKEND}/api/users/reset`) } catch { /* ignore */ }
  }

  const disabled = status !== 'connected'

  return (
    <div style={{ fontFamily: 'monospace', fontSize: 13, maxWidth: 1200, margin: '0 auto', padding: 16 }}>

      {/* Header */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
        <tbody>
          <tr>
            <td><strong style={{ fontSize: 15 }}>Vahana Crypto SDK Demo</strong></td>
            <td style={{ textAlign: 'center' }}>
              <span style={{ marginRight: 8 }}>Protocol:</span>
              {(['T1', 'T2'] as Protocol[]).map(p => (
                <button
                  key={p}
                  onClick={() => setProtocol(p)}
                  style={{
                    marginRight: 4, padding: '2px 12px', cursor: 'pointer',
                    fontWeight: protocol === p ? 'bold' : 'normal',
                    border: protocol === p ? '2px solid #000' : '1px solid #999',
                    background: protocol === p ? '#000' : '#fff',
                    color: protocol === p ? '#fff' : '#000',
                  }}
                >
                  {p}
                </button>
              ))}
            </td>
            <td style={{ textAlign: 'right', fontSize: 12 }}>
              Status: <strong>{status}</strong>
              {sessionId && <span style={{ marginLeft: 8, color: '#555' }}>Session: {sessionId.slice(0, 8)}…</span>}
              {status === 'error' && (
                <button
                  onClick={() => connect(protocol)}
                  style={{ marginLeft: 10, cursor: 'pointer', padding: '1px 8px', fontSize: 11 }}
                >
                  Retry
                </button>
              )}
            </td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap', paddingLeft: 16 }}>
              <button
                onClick={resetUserStore}
                style={{ padding: '3px 10px', cursor: 'pointer', border: '1px solid #666', fontSize: 12 }}
                title="Restore USR001–USR003 on the server"
              >
                Reset User Store
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <hr style={{ marginBottom: 12 }} />

      {status === 'error' && statusMsg && (
        <div style={{ border: '1px solid #c00', padding: 8, marginBottom: 12, color: '#c00', fontSize: 12 }}>
          {statusMsg}
        </div>
      )}

      {/* API Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {CARDS.map(card => (
          <ApiCard
            key={card.endpoint}
            {...card}
            onRun={encryptedCall}
            disabled={disabled}
          />
        ))}
        <PdfUploadCard onUpload={uploadFile} disabled={disabled} />
        <PdfGalleryCard onList={listPdfs} onDownload={downloadPdf} disabled={disabled} />
        <StreamCard onStartStream={startStream} disabled={disabled} />
      </div>

    </div>
  )
}
