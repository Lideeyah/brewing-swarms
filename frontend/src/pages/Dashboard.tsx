import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Document, Paragraph, TextRun, HeadingLevel, Packer } from 'docx'
import DriveFilePicker, { type DriveFilePayload } from '../components/DriveFilePicker'
import GmailPicker, { type GmailThreadPayload } from '../components/GmailPicker'

const API      = import.meta.env.VITE_ARC_API_URL ?? 'http://localhost:8000'
const EXPLORER = 'https://testnet.arcscan.app'

// ── Wallet Connect (MetaMask → Arc Testnet) ───────────────────────────────────

declare global {
  interface Window {
    ethereum?: {
      request:           (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on:                (event: string, handler: (...args: unknown[]) => void) => void
      removeListener:    (event: string, handler: (...args: unknown[]) => void) => void
    }
  }
}

const ARC_CHAIN_PARAMS = {
  chainId:         '0x4CEF52',   // 5042002
  chainName:       'Arc Testnet',
  nativeCurrency:  { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls:         ['https://rpc-arc-testnet.circle.com'],
  blockExplorerUrls: ['https://testnet.arcscan.app'],
}

function useWalletConnect() {
  const [walletAddr, setWalletAddr] = useState<string>(
    () => localStorage.getItem('brewing_web3_wallet') || ''
  )

  // Sync across tabs / MetaMask account changes
  useEffect(() => {
    if (!window.ethereum) return
    const handler = (accounts: unknown) => {
      const addr = (accounts as string[])[0] ?? ''
      localStorage.setItem('brewing_web3_wallet', addr)
      setWalletAddr(addr)
    }
    window.ethereum.on('accountsChanged', handler)
    return () => window.ethereum?.removeListener('accountsChanged', handler)
  }, [])

  const connect = async () => {
    if (!window.ethereum) {
      alert('MetaMask is not installed. Add it at metamask.io and try again.')
      return
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
      // Switch to Arc Testnet (adds it if not present)
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: ARC_CHAIN_PARAMS.chainId }],
        })
      } catch (sw: unknown) {
        if ((sw as { code?: number }).code === 4902) {
          await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [ARC_CHAIN_PARAMS] })
        }
      }
      const addr = accounts[0] ?? ''
      localStorage.setItem('brewing_web3_wallet', addr)
      setWalletAddr(addr)
    } catch {
      // user rejected — silently ignore
    }
  }

  const disconnect = () => {
    localStorage.removeItem('brewing_web3_wallet')
    setWalletAddr('')
  }

  return { walletAddr, connect, disconnect }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SubTask {
  agent_name:  string
  description: string
  status:      string
  job_id:      number | null
  create_tx:   string | null
  settle_tx:   string | null
  result:      string | null
}

interface TaskRecord {
  task_id:          string
  employer_address: string
  employer_name:    string
  description:      string
  budget_usdc:      number
  deadline_hours:   number
  status:           string
  result:           string | null
  subtasks:         SubTask[]
  created_at:       number
  completed_at:     number | null
  agent_name?:      string | null
  create_tx?:       string | null
  settle_tx?:       string | null
  receipt_id?:      string | null
}

interface SlackMessagePayload {
  channel: string
  content: string
}

interface AgentCard {
  agent_id:       string
  name:           string
  owner:          string
  payment_addr:   string
  capabilities:   string[]
  endpoint:       string
  registered_at:  number
  jobs_completed: number
  jobs_slashed:   number
  jobs_total:     number
  reputation:     number
  active:         boolean
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function MarkdownResult({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="font-mono text-sm font-bold text-white mt-4 mb-2 border-b border-arc-border pb-1 first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="font-mono text-xs font-bold text-arc-green mt-4 mb-2 first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="font-mono text-[11px] font-semibold text-arc-sub mt-3 mb-1">{children}</h3>,
        h4: ({ children }) => <h4 className="font-mono text-[11px] font-semibold text-arc-muted mt-2 mb-1">{children}</h4>,
        p:  ({ children }) => <p  className="font-mono text-[11px] text-white leading-relaxed mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="font-mono text-[11px] space-y-0.5 mb-2 pl-0">{children}</ul>,
        ol: ({ children }) => <ol className="font-mono text-[11px] space-y-0.5 mb-2 pl-4 list-decimal text-white">{children}</ol>,
        li: ({ children }) => <li className="font-mono text-[11px] text-arc-sub flex gap-2"><span className="text-arc-muted flex-shrink-0">–</span><span>{children}</span></li>,
        strong: ({ children }) => <strong className="text-arc-green font-semibold">{children}</strong>,
        em: ({ children }) => <em className="text-arc-amber not-italic">{children}</em>,
        code: ({ children }) => <code className="bg-black/40 text-arc-amber font-mono text-[10px] px-1.5 py-0.5 rounded border border-arc-border">{children}</code>,
        pre: ({ children }) => <pre className="bg-black/40 border border-arc-border rounded-lg p-3 my-2 overflow-x-auto font-mono text-[10px] text-arc-sub">{children}</pre>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-arc-green/40 pl-3 my-2 text-arc-sub italic">{children}</blockquote>,
        hr: () => <hr className="border-arc-border my-3" />,
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-arc-border">
            <table className="font-mono text-[10px] border-collapse w-full">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-arc-surface border-b border-arc-border">{children}</thead>,
        tbody: ({ children }) => <tbody className="divide-y divide-arc-border/40">{children}</tbody>,
        tr:    ({ children }) => <tr className="hover:bg-white/[0.02] transition-colors">{children}</tr>,
        th:    ({ children }) => <th className="text-left py-2 px-3 text-arc-green font-semibold whitespace-nowrap">{children}</th>,
        td:    ({ children }) => <td className="py-1.5 px-3 text-arc-sub align-top">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

// ── Result export actions ─────────────────────────────────────────────────────

function toPlainText(md: string): string {
  return md
    .replace(/\r\n|\r/g, '\n')
    .replace(/^#{1,6}[ \t]*/gm, '')
    .replace(/\*\*\*(.+?)\*\*\*/gs, '$1')
    .replace(/___(.+?)___/gs, '$1')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/\*(.+?)\*/gs, '$1')
    .replace(/~~(.+?)~~/gs, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s*[-*+][ \t]+/gm, '• ')
    .replace(/^\s*\d+\.[ \t]+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/^\|(.+)\|[ \t]*$/gm, (_m, cells: string) =>
      cells.split('|').map((c: string) => c.trim()).filter(Boolean).join('  ')
    )
    .replace(/^[ \t]*[-|:][ \t|:-]+[ \t]*$/gm, '')
    .replace(/^[ \t]*[-_*]{3,}[ \t]*$/gm, '─────')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── .docx generation ─────────────────────────────────────────────────────────

async function buildDocx(title: string, intro: string, content: string): Promise<Blob> {
  const lines = content.split('\n')
  const children: Paragraph[] = []

  if (intro.trim()) {
    children.push(new Paragraph({ children: [new TextRun({ text: intro, italics: true, size: 22 })] }))
    children.push(new Paragraph({}))
  }

  for (const line of lines) {
    if (line.startsWith('### ')) {
      children.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }))
    } else if (line.startsWith('## ')) {
      children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }))
    } else if (line.startsWith('# ')) {
      children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }))
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      children.push(new Paragraph({ text: line.slice(2), bullet: { level: 0 } }))
    } else {
      children.push(new Paragraph({ children: [new TextRun({ text: line, size: 22 })] }))
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
    title,
  })
  return Packer.toBlob(doc)
}

function triggerDocxDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── Email modal ───────────────────────────────────────────────────────────────

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly'

function EmailModal({ content, taskId, onClose }: { content: string; taskId: string; onClose: () => void }) {
  const [to,           setTo]           = useState('')
  const [subject,      setSubject]      = useState('Brewing AI Analysis')
  const [intro,        setIntro]        = useState('')
  const [status,       setStatus]       = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errMsg,       setErrMsg]       = useState('')
  const [contacts,     setContacts]     = useState<string[]>([])
  const [showDrop,     setShowDrop]     = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const toInputRef = useRef<HTMLInputElement>(null)

  const gmailSendToken = localStorage.getItem('gmail_send_token') || ''
  // Fall back to readonly token only for loading contacts; sending requires send scope
  const gmailToken = gmailSendToken || localStorage.getItem('gmail_token') || ''

  const needsAuth = !gmailSendToken

  // Load recent recipients from sent mail
  useEffect(() => {
    if (!gmailToken) return
    ;(async () => {
      try {
        const res = await fetch(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in:sent&maxResults=50',
          { headers: { Authorization: `Bearer ${gmailToken}` } }
        )
        if (!res.ok) return
        const data = await res.json()
        const msgs: { id: string }[] = data.messages ?? []
        const emails = new Set<string>()
        await Promise.all(msgs.slice(0, 20).map(async m => {
          try {
            const r = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=To`,
              { headers: { Authorization: `Bearer ${gmailToken}` } }
            )
            if (!r.ok) return
            const d = await r.json()
            const headers: { name: string; value: string }[] = d.payload?.headers ?? []
            const toHeader = headers.find(h => h.name === 'To')?.value ?? ''
            toHeader.split(',').map(s => s.trim()).filter(Boolean).forEach(e => emails.add(e))
          } catch { /* skip */ }
        }))
        setContacts([...emails].slice(0, 40))
      } catch { /* contacts unavailable */ }
    })()
  }, [gmailToken])

  const filteredContacts = to.trim()
    ? contacts.filter(c => c.toLowerCase().includes(to.toLowerCase()))
    : contacts.slice(0, 8)

  const authorise = () => {
    const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
    sessionStorage.setItem('dashboard_tab', 'jobs')
    sessionStorage.setItem('email_modal_pending', '1')
    const params = new URLSearchParams({
      client_id:     CLIENT_ID,
      redirect_uri:  `${window.location.origin}/dashboard`,
      response_type: 'token',
      scope:         GMAIL_SEND_SCOPE,
      prompt:        'select_account',
      state:         'gmail_send_oauth',
    })
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }

  const send = async () => {
    if (!to.trim()) { setErrMsg('Enter a recipient email'); return }
    setStatus('sending'); setErrMsg('')
    try {
      const blob     = await buildDocx(subject, intro, toPlainText(content))
      const docxB64  = await blobToBase64(blob)
      const boundary = 'brew_' + Math.random().toString(36).slice(2)
      const bodyText = intro.trim()
        ? `${intro}\n\nPlease find the full analysis attached.`
        : 'Please find the Brewing AI analysis attached.'

      const rawMsg = [
        `To: ${to.trim()}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        bodyText,
        '',
        `--${boundary}`,
        'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="brewing-analysis-${taskId}.docx"`,
        '',
        docxB64,
        `--${boundary}--`,
      ].join('\r\n')

      const encoded = btoa(unescape(encodeURIComponent(rawMsg)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${gmailToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: encoded }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        if (res.status === 401) {
          localStorage.removeItem('gmail_send_token')
          setErrMsg('Session expired — click Authorise to reconnect')
          setStatus('error'); return
        }
        throw new Error(err?.error?.message ?? `Gmail API ${res.status}`)
      }
      setStatus('sent')
    } catch (e: unknown) {
      setErrMsg((e as Error).message ?? 'Failed to send')
      setStatus('error')
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="bg-arc-surface border border-arc-border rounded-xl w-full max-w-lg mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm font-bold text-white">Send as .docx</span>
          <button onClick={onClose} className="font-mono text-arc-muted hover:text-white text-lg leading-none">×</button>
        </div>

        {status === 'sent' ? (
          <div className="font-mono text-arc-green text-sm py-4 text-center">✓ Email sent successfully</div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1 relative">
                <label className="font-mono text-[10px] text-arc-muted uppercase tracking-widest">To</label>
                <input
                  ref={toInputRef}
                  type="text"
                  value={to}
                  onChange={e => { setTo(e.target.value); setShowDrop(true) }}
                  onFocus={() => setShowDrop(true)}
                  onBlur={() => setTimeout(() => setShowDrop(false), 150)}
                  placeholder="Search contacts or type email…"
                  autoComplete="off"
                  className="bg-black border border-arc-border rounded-lg px-3 py-2 font-mono text-xs text-white placeholder:text-arc-muted focus:outline-none focus:border-arc-green"
                />
                {showDrop && filteredContacts.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-arc-surface border border-arc-border rounded-lg shadow-xl z-50 overflow-hidden max-h-48 overflow-y-auto">
                    {filteredContacts.map(c => (
                      <button
                        key={c}
                        type="button"
                        onMouseDown={() => { setTo(c); setShowDrop(false) }}
                        className="w-full text-left px-3 py-2 font-mono text-xs text-white hover:bg-arc-green/10 hover:text-arc-green truncate"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono text-[10px] text-arc-muted uppercase tracking-widest">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="bg-black border border-arc-border rounded-lg px-3 py-2 font-mono text-xs text-white focus:outline-none focus:border-arc-green"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono text-[10px] text-arc-muted uppercase tracking-widest">Introduction (optional)</label>
                <textarea
                  value={intro}
                  onChange={e => setIntro(e.target.value)}
                  rows={3}
                  placeholder="Hi, please find the attached AI analysis…"
                  className="bg-black border border-arc-border rounded-lg px-3 py-2 font-mono text-xs text-white placeholder:text-arc-muted focus:outline-none focus:border-arc-green resize-none"
                />
              </div>
            </div>

            {errMsg && <span className="font-mono text-[10px] text-red-400">{errMsg}</span>}

            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="font-mono text-[10px] text-arc-muted border border-arc-border rounded-lg px-4 py-2 hover:text-white transition-colors">
                Cancel
              </button>
              {needsAuth ? (
                <button onClick={authorise} className="font-mono text-[10px] text-black bg-arc-green rounded-lg px-4 py-2 hover:bg-arc-green/80 transition-colors">
                  Authorise Gmail Send
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={status === 'sending'}
                  className="font-mono text-[10px] text-black bg-arc-green rounded-lg px-4 py-2 hover:bg-arc-green/80 transition-colors disabled:opacity-50"
                >
                  {status === 'sending' ? 'Sending…' : 'Send Email'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// ── ResultActions ─────────────────────────────────────────────────────────────

function ResultActions({ content, taskId }: { content: string; taskId: string }) {
  const [driveStatus, setDriveStatus] = useState<'idle' | 'saving' | 'saved' | 'reconnect'>('idle')
  const [emailOpen,   setEmailOpen]   = useState(false)

  // Parse gmail_send token from OAuth redirect
  useEffect(() => {
    const hash = window.location.hash.substring(1)
    if (!hash) return
    const params = new URLSearchParams(hash)
    if (params.get('state') !== 'gmail_send_oauth') return
    const token = params.get('access_token')
    if (token) {
      localStorage.setItem('gmail_send_token', token)
      window.history.replaceState({}, '', window.location.pathname + window.location.search)
      if (sessionStorage.getItem('email_modal_pending') === '1') {
        sessionStorage.removeItem('email_modal_pending')
        setEmailOpen(true)
      }
    }
  }, [])

  // Clear stale readonly-only token so user reconnects with drive.file scope
  useEffect(() => {
    const token = localStorage.getItem('drive_token')
    const scopes = localStorage.getItem('drive_scopes') ?? ''
    if (token && !scopes.includes('drive.file')) {
      localStorage.removeItem('drive_token')
      localStorage.setItem('drive_scopes', '')
    }
  }, [])

  const downloadDocx = async () => {
    const blob = await buildDocx(`Brewing Analysis — ${taskId}`, '', toPlainText(content))
    triggerDocxDownload(blob, `brewing-analysis-${taskId}.docx`)
  }

  const saveToDrive = async () => {
    const token = localStorage.getItem('drive_token')
    if (!token) { setDriveStatus('reconnect'); return }
    setDriveStatus('saving')
    try {
      const filename = `Brewing Analysis — ${new Date().toLocaleDateString('en-GB')}.txt`
      const boundary = 'brewing_boundary_' + Math.random().toString(36).slice(2)
      const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify({ name: filename, mimeType: 'text/plain' }),
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        toPlainText(content),
        `--${boundary}--`,
      ].join('\r\n')

      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary="${boundary}"`,
          },
          body,
        }
      )
      if (res.ok) {
        setDriveStatus('saved')
      } else {
        if (res.status === 401 || res.status === 403) localStorage.removeItem('drive_token')
        setDriveStatus('reconnect')
      }
    } catch {
      setDriveStatus('reconnect')
    }
  }

  return (
    <>
      {emailOpen && <EmailModal content={content} taskId={taskId} onClose={() => setEmailOpen(false)} />}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <span className="font-mono text-[10px] text-arc-muted">Export:</span>
        <button
          onClick={downloadDocx}
          className="flex items-center gap-1.5 font-mono text-[10px] text-arc-sub border border-arc-border rounded-lg px-3 py-1.5 hover:border-arc-green hover:text-arc-green transition-colors"
        >
          ↓ Download .docx
        </button>
        <button
          onClick={saveToDrive}
          disabled={driveStatus === 'saving'}
          title={driveStatus === 'reconnect' ? 'Reconnect Google Drive on the Post Task tab to enable saving' : ''}
          className={`flex items-center gap-1.5 font-mono text-[10px] border rounded-lg px-3 py-1.5 transition-colors ${
            driveStatus === 'saved'     ? 'text-arc-green border-arc-green/30 bg-arc-green/5' :
            driveStatus === 'reconnect' ? 'text-arc-amber border-arc-amber/30' :
            driveStatus === 'saving'    ? 'text-arc-muted border-arc-border cursor-wait' :
            'text-arc-sub border-arc-border hover:border-arc-green hover:text-arc-green'
          }`}
        >
          {driveStatus === 'saving'    ? '⟳ Saving…'          :
           driveStatus === 'saved'     ? '✓ Saved to Drive'    :
           driveStatus === 'reconnect' ? '↺ Reconnect Drive'   :
                                         '↑ Save to Drive'}
        </button>
        <button
          onClick={() => setEmailOpen(true)}
          className="flex items-center gap-1.5 font-mono text-[10px] text-arc-sub border border-arc-border rounded-lg px-3 py-1.5 hover:border-arc-green hover:text-arc-green transition-colors"
        >
          ✉ Send as .docx
        </button>
      </div>
    </>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    completed:   'bg-arc-green/10 text-arc-green border-arc-green/20',
    in_progress: 'bg-arc-amber/10 text-arc-amber border-arc-amber/20',
    refunded:    'bg-red-500/10 text-red-400 border-red-500/20',
    pending:     'border-arc-border text-arc-muted',
  }
  const label: Record<string, string> = {
    completed:   'Completed',
    in_progress: 'In Progress',
    refunded:    'Refunded',
    pending:     'Pending',
  }
  return (
    <span className={`font-mono text-[10px] px-2 py-0.5 rounded border ${cfg[status] ?? 'border-arc-border text-arc-muted'}`}>
      {label[status] ?? status}
    </span>
  )
}

function Countdown({ createdAt, deadlineHours }: { createdAt: number; deadlineHours: number }) {
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    const deadline = createdAt + deadlineHours * 3600
    const update = () => setRemaining(Math.max(0, deadline - Math.floor(Date.now() / 1000)))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [createdAt, deadlineHours])

  const h = Math.floor(remaining / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  const s = remaining % 60
  const fmt = (n: number) => String(n).padStart(2, '0')

  return (
    <span className={`font-mono text-[11px] ${remaining < 3600 ? 'text-red-400' : 'text-arc-sub'}`}>
      {fmt(h)}:{fmt(m)}:{fmt(s)} remaining
    </span>
  )
}

function ReputationBar({ score }: { score: number }) {
  const pct = Math.min(100, score / 100)
  const color = pct >= 70 ? 'bg-arc-green' : pct >= 40 ? 'bg-arc-amber' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-arc-border rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[10px] text-arc-muted w-12 text-right">
        {(score / 1000).toFixed(1)}/10
      </span>
    </div>
  )
}

// ── Slack connect (stub — real OAuth needs VITE_SLACK_CLIENT_ID) ─────────────

const SLACK_CLIENT_ID = import.meta.env.VITE_SLACK_CLIENT_ID ?? ''

function SlackConnect({ onMessagesChange }: { onMessagesChange: (msgs: SlackMessagePayload[]) => void }) {
  const [connected, setConnected] = useState(() => localStorage.getItem('slack_connected') === '1')

  const connect = () => {
    if (SLACK_CLIENT_ID) {
      // Real OAuth — redirect to Slack (no redirect_uri param; Slack uses the one configured in app settings)
      const scope = encodeURIComponent('channels:history,channels:read')
      window.location.href = `https://slack.com/oauth/v2/authorize?client_id=${SLACK_CLIENT_ID}&scope=${scope}`
    } else {
      // No credentials yet — show placeholder state
      localStorage.setItem('slack_connected', '1')
      setConnected(true)
    }
  }
  const disconnect = () => {
    localStorage.removeItem('slack_connected')
    localStorage.removeItem('slack_token')
    setConnected(false)
    onMessagesChange([])
  }

  // Check for token returned from OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('slack_connected') === '1') {
      localStorage.setItem('slack_connected', '1')
      setConnected(true)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  if (connected) {
    return (
      <div className="flex items-center justify-between border border-arc-border rounded-lg px-4 py-2.5 bg-arc-surface">
        <div className="flex items-center gap-2">
          <SlackIcon className="text-arc-green" />
          <span className="font-mono text-[11px] text-arc-green font-semibold">Slack connected</span>
        </div>
        <button
          type="button"
          onClick={disconnect}
          className="font-mono text-[10px] text-arc-muted hover:text-white transition-colors"
        >
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={connect}
      className="flex items-center gap-2 border border-arc-border rounded-lg px-4 py-2.5 font-mono text-xs text-arc-sub hover:border-arc-green hover:text-white transition-colors w-fit"
    >
      <SlackIcon />
      Connect Slack
    </button>
  )
}

// ── Register Agent Modal ──────────────────────────────────────────────────────

const ALL_CAPS = [
  { id: 'research',   label: 'Research' },
  { id: 'analysis',   label: 'Analysis' },
  { id: 'writing',    label: 'Writing' },
  { id: 'data',       label: 'Data' },
  { id: 'strategy',   label: 'Strategy' },
  { id: 'coding',     label: 'Coding' },
  { id: 'legal',      label: 'Legal' },
  { id: 'finance',    label: 'Finance' },
  { id: 'sentiment',  label: 'Sentiment' },
  { id: 'portfolio',  label: 'Portfolio' },
  { id: 'forecasting',label: 'Forecasting' },
]

function RegisterAgentModal({ onClose, onRegistered }: { onClose: () => void; onRegistered: (agent: AgentCard) => void }) {
  const [name,       setName]      = useState('')
  const [specialty,  setSpec]      = useState('')
  const [desc,       setDesc]      = useState('')
  const [price,      setPrice]     = useState('0.033')
  const [wallet,     setWallet]    = useState('')
  const [webhookUrl, setWebhook]   = useState('')
  const [caps,       setCaps]      = useState<string[]>([])
  const [submitting, setSub]       = useState(false)
  const [error,      setError]     = useState('')

  const toggleCap = (id: string) =>
    setCaps(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !wallet.trim() || !webhookUrl.trim() || caps.length === 0) return
    setSub(true); setError('')
    try {
      const res = await fetch(`${API}/api/agents/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:           name.trim(),
          description:    desc.trim(),
          capabilities:   caps,
          payment_addr:   wallet.trim(),
          price_per_task: parseFloat(price) || 0.033,
          webhook_url:    webhookUrl.trim(),
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail ?? 'Registration failed') }
      const agent = await res.json()
      onRegistered(agent)
      onClose()
    } catch (err: unknown) {
      setError((err as Error).message)
    } finally {
      setSub(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-lg bg-black border border-arc-border rounded-2xl flex flex-col max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-arc-border sticky top-0 bg-black z-10">
          <div>
            <div className="font-mono text-[9px] text-arc-muted tracking-widest uppercase mb-0.5">OPEN AGENT MARKETPLACE</div>
            <h2 className="font-mono text-base font-bold text-white">List Your Agent</h2>
          </div>
          <button onClick={onClose} className="font-mono text-arc-muted hover:text-white transition-colors text-lg leading-none">✕</button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-5 px-6 py-6">

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">Agent Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. LegalBot, DataBot" required
              className="bg-arc-surface border border-arc-border rounded-lg px-4 py-3 font-mono text-sm text-white placeholder-arc-muted focus:outline-none focus:border-arc-green transition-colors" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">Specialty</label>
            <input type="text" value={specialty} onChange={e => setSpec(e.target.value)} placeholder="e.g. Contract Analysis & Risk Review"
              className="bg-arc-surface border border-arc-border rounded-lg px-4 py-3 font-mono text-sm text-white placeholder-arc-muted focus:outline-none focus:border-arc-green transition-colors" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="What does your agent do? What makes it better?" rows={3}
              className="bg-arc-surface border border-arc-border rounded-lg px-4 py-3 font-mono text-sm text-white placeholder-arc-muted focus:outline-none focus:border-arc-green transition-colors resize-none" />
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">
              Capabilities <span className="normal-case tracking-normal text-arc-muted">(select all that apply)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_CAPS.map(cap => (
                <button key={cap.id} type="button" onClick={() => toggleCap(cap.id)}
                  className={`font-mono text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${
                    caps.includes(cap.id)
                      ? 'bg-arc-green/10 border-arc-green text-arc-green'
                      : 'border-arc-border text-arc-muted hover:border-arc-green/50 hover:text-arc-sub'
                  }`}>
                  {cap.label}
                </button>
              ))}
            </div>
            {caps.length === 0 && <span className="font-mono text-[10px] text-arc-muted">Select at least one</span>}
          </div>

          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">Price / Task (USDC)</label>
              <input type="number" min="0.001" step="0.001" value={price} onChange={e => setPrice(e.target.value)}
                className="bg-arc-surface border border-arc-border rounded-lg px-4 py-3 font-mono text-sm text-white focus:outline-none focus:border-arc-green transition-colors" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">Arc Wallet Address</label>
            <input type="text" value={wallet} onChange={e => setWallet(e.target.value)} placeholder="0x…" required
              className="bg-arc-surface border border-arc-border rounded-lg px-4 py-3 font-mono text-sm text-white placeholder-arc-muted focus:outline-none focus:border-arc-green transition-colors" />
            <span className="font-mono text-[10px] text-arc-muted">USDC paid here via AgentEscrow on Arc L1</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">
              Webhook URL
            </label>
            <input type="url" value={webhookUrl} onChange={e => setWebhook(e.target.value)} placeholder="https://your-agent.com/webhook" required
              className="bg-arc-surface border border-arc-border rounded-lg px-4 py-3 font-mono text-sm text-white placeholder-arc-muted focus:outline-none focus:border-arc-green transition-colors" />
            <span className="font-mono text-[10px] text-arc-muted">
              Brewing will POST tasks to this endpoint.{' '}
              <a href="/docs" target="_blank" rel="noopener noreferrer" className="text-arc-green hover:underline">Webhook docs →</a>
            </span>
          </div>

          {error && (
            <div className="border border-red-500/20 rounded-lg px-4 py-3 bg-red-500/5">
              <span className="font-mono text-xs text-red-400">{error}</span>
            </div>
          )}

          <button type="submit" disabled={submitting || !name.trim() || !wallet.trim() || !webhookUrl.trim() || caps.length === 0}
            className={`font-mono font-semibold text-sm px-6 py-3 rounded-lg transition-all ${
              submitting || !name.trim() || !wallet.trim() || caps.length === 0
                ? 'bg-arc-surface border border-arc-border text-arc-muted cursor-not-allowed'
                : 'bg-arc-green text-black hover:bg-emerald-400'
            }`}>
            {submitting ? '⟳ Registering…' : 'List Agent on Brewing →'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Tab 1: Marketplace ────────────────────────────────────────────────────────

const AGENT_META: Record<string, { specialty: string; pricePerTask: number; description: string }> = {
  Director: {
    specialty:    'Task Structuring & Delegation',
    pricePerTask: 0.033,
    description:  'Receives raw task prompts and produces a structured brief for downstream agents. Defines scope, required outputs, and governance constraints before any work begins.',
  },
  RiskAnalyst: {
    specialty:    'Risk Analysis & Structured Reporting',
    pricePerTask: 0.067,
    description:  'Executes deep risk analysis on the structured brief from Director. Produces a scored JSON report covering risk factors, probability estimates, and mitigation strategies.',
  },
  Auditor: {
    specialty:    'Governance Validation & Audit',
    pricePerTask: 0.010,
    description:  'Runs 7 governance checks against every agent output before settlement. If any check fails, escrow slashes. If all pass, USDC releases to the worker.',
  },
}

const GOVERNED_AGENTS = new Set(['Director', 'RiskAnalyst', 'Auditor'])

function MarketplaceTab({ onHire }: { onHire: (agentName: string) => void }) {
  const [agents,     setAgents] = useState<AgentCard[]>([])
  const [loading,    setLoad]   = useState(true)
  const [showModal,  setModal]  = useState(false)

  const fetchAgents = () => {
    fetch(`${API}/api/agents`)
      .then(r => r.json())
      .then((d: AgentCard[]) => setAgents(d))
      .catch(() => null)
      .finally(() => setLoad(false))
  }

  useEffect(() => {
    fetchAgents()
    // Refresh every 30s so reputation reflects live slash/settle outcomes
    const id = setInterval(fetchAgents, 30_000)
    return () => clearInterval(id)
  }, [])

  const handleRegistered = (agent: AgentCard) => setAgents(prev => [agent, ...prev])

  if (loading) return <div className="font-mono text-xs text-arc-muted mt-8">Loading agents…</div>

  if (agents.length === 0) return (
    <div className="border border-arc-border rounded-xl p-12 text-center">
      <div className="font-mono text-xs text-arc-muted">No agents registered — start the backend to load the registry.</div>
    </div>
  )

  return (
    <>
    {showModal && <RegisterAgentModal onClose={() => setModal(false)} onRegistered={handleRegistered} />}
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[9px] text-arc-muted tracking-widest uppercase mb-1">AGENT MARKETPLACE</div>
          <p className="font-mono text-[12px] text-arc-sub">
            Hire specialized AI agents. Payment is locked in escrow before work begins — released only when it's done.
          </p>
        </div>
        <button
          onClick={() => setModal(true)}
          className="flex-shrink-0 font-mono text-xs border border-arc-amber/40 text-arc-amber px-4 py-2 rounded-lg hover:bg-arc-amber/5 transition-colors"
        >
          + List Your Agent
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {agents.map(agent => {
          const meta = AGENT_META[agent.name] ?? {
            specialty:    agent.capabilities[0] ?? 'General',
            pricePerTask: 0.033,
            description:  `Specialized in: ${agent.capabilities.join(', ')}.`,
          }
          const addrShort = `${agent.payment_addr.slice(0, 6)}…${agent.payment_addr.slice(-4)}`

          return (
            <div key={agent.agent_id} className="border border-arc-border rounded-xl bg-arc-surface flex flex-col overflow-hidden hover:border-arc-green/40 transition-colors">

              {/* Card header */}
              <div className="px-5 pt-5 pb-4 flex flex-col gap-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-sm font-bold text-white">{agent.name}</div>
                      {GOVERNED_AGENTS.has(agent.name) && (
                        <span className="font-mono text-[8px] px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-400 bg-purple-500/5 flex-shrink-0">
                          ◈ GOVERNED
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-arc-green">{meta.specialty}</div>
                  </div>
                  <span className={`font-mono text-[9px] px-2 py-0.5 rounded border flex-shrink-0 ${
                    agent.active
                      ? 'text-arc-green border-arc-green/20 bg-arc-green/5'
                      : 'text-arc-muted border-arc-border'
                  }`}>
                    {agent.active ? '● Active' : '○ Offline'}
                  </span>
                </div>

                <p className="font-mono text-[11px] text-arc-sub leading-relaxed">{meta.description}</p>

                {/* Capabilities */}
                <div className="flex flex-wrap gap-1.5">
                  {agent.capabilities.slice(0, 4).map(cap => (
                    <span key={cap} className="font-mono text-[9px] text-arc-muted border border-arc-border/60 rounded px-1.5 py-0.5">{cap}</span>
                  ))}
                </div>

                {/* Stats */}
                <div className="flex flex-col gap-2 mt-auto pt-3 border-t border-arc-border">
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span className="text-arc-muted">Reputation</span>
                  </div>
                  <ReputationBar score={agent.reputation} />

                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <div>
                      <div className="font-mono text-[9px] text-arc-muted uppercase tracking-wide">Jobs done</div>
                      <div className="font-mono text-sm font-bold text-white mt-0.5">{agent.jobs_completed}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[9px] text-arc-muted uppercase tracking-wide">Price / task</div>
                      <div className="font-mono text-sm font-bold text-arc-amber mt-0.5">{meta.pricePerTask.toFixed(3)} USDC</div>
                    </div>
                  </div>

                  <div className="font-mono text-[9px] text-arc-muted mt-1">
                    Wallet: <span className="text-arc-sub">{addrShort}</span>
                  </div>
                </div>
              </div>

              {/* CTA */}
              <div className="border-t border-arc-border p-4">
                <button
                  onClick={() => onHire(agent.name)}
                  className="w-full bg-arc-green text-black font-mono font-semibold text-xs py-2.5 rounded-lg hover:bg-emerald-400 transition-colors"
                >
                  Hire {agent.name} →
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Pipeline note */}
      <div className="border border-arc-border/50 rounded-xl p-5 bg-arc-surface/50 flex flex-col gap-2">
        <div className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">HOW GOVERNED TASKS WORK</div>
        <p className="font-mono text-[12px] text-arc-sub leading-relaxed">
          Every task is escrowed before execution begins. Director structures the brief, RiskAnalyst executes via
          Swarms SequentialWorkflow, then the Auditor validates 7 governance checks. USDC settles only on a clean
          audit — if validation fails, escrow slashes and funds return to you.
        </p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {['Escrow', '→ Director', '→ RiskAnalyst', '→ Auditor (7 checks)', '→ Settlement'].map(s => (
            <span key={s} className="font-mono text-[10px] text-arc-sub border border-arc-border rounded px-2 py-1">{s}</span>
          ))}
        </div>
      </div>
    </div>
    </>
  )
}

// ── Tab 2: Post a Task ────────────────────────────────────────────────────────

function PostTaskTab({ preselectedAgent, onTaskPosted }: { preselectedAgent?: string; onTaskPosted: (taskId: string) => void }) {
  const [desc, setDesc]               = useState('')
  const [budget, setBudget]           = useState('0.10')
  const [deadline, setDeadline]       = useState('24')
  const [submitting, setSub]          = useState(false)
  const [demoLoading, setDemoLoading] = useState<'governed' | 'slash' | null>(null)
  const [result, setResult]           = useState<TaskRecord | null>(null)
  const [error, setError]             = useState('')
  const [driveFiles, setDriveFiles]   = useState<DriveFilePayload[]>([])
  const [gmailThreads, setGmailThreads] = useState<GmailThreadPayload[]>([])
  const [slackMessages, setSlackMessages] = useState<SlackMessagePayload[]>([])
  const [governanceMode, setGovernanceMode] = useState<'standard' | 'swarms_demo' | 'slash_demo'>('standard')

  const launchDemo = async (mode: 'governed' | 'slash') => {
    setDemoLoading(mode); setError('')
    try {
      const res  = await fetch(`${API}/api/demo/${mode}`, { method: 'POST' })
      const data = await res.json()
      onTaskPosted(data.task_id ?? '')
    } catch {
      setError('Demo launch failed — is the backend running?')
    } finally {
      setDemoLoading(null)
    }
  }

  // Web3 wallet takes precedence over Circle DCW for task attribution
  const employerAddress = localStorage.getItem('brewing_web3_wallet')
    || localStorage.getItem('brewing_employer_address') || ''
  const employerName    = localStorage.getItem('brewing_employer_name') || ''

  const placeholder = preselectedAgent
    ? `Describe your task for ${preselectedAgent}…`
    : 'e.g. Analyse the risk profile of a DeFi protocol launching on Arc — cover smart contract exposure, liquidity risk, and regulatory surface…'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!desc.trim() || submitting) return
    setSub(true); setError(''); setResult(null)
    try {
      const res = await fetch(`${API}/api/tasks`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          description:      desc.trim(),
          budget_usdc:      parseFloat(budget) || 0.10,
          deadline_hours:   parseInt(deadline) || 24,
          employer_address: employerAddress,
          employer_name:    employerName,
          selected_agent:   preselectedAgent ?? '',
          drive_files:      driveFiles,
          gmail_threads:    gmailThreads,
          slack_messages:   slackMessages,
          governance_mode:  governanceMode,
        }),
      })
      const data = await res.json()
      onTaskPosted(data.task_id ?? '')
    } catch {
      onTaskPosted('')
    }
  }

  const lockedUsdc = (parseFloat(budget) || 0.10).toFixed(3)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="font-mono text-[9px] text-arc-muted tracking-widest uppercase mb-1">POST A TASK</div>
        <p className="font-mono text-[12px] text-arc-sub">
          {preselectedAgent
            ? `Hiring ${preselectedAgent}. Your task will be sent directly to this agent's webhook. USDC is locked in escrow and released on delivery.`
            : 'Describe what you need. Brewing selects the best agents, locks USDC in escrow, and releases payment only when the work is done.'
          }
        </p>
      </div>

      {/* Quick Demo Launchers */}
      {!preselectedAgent && (
        <div className="border border-purple-500/20 rounded-xl p-4 bg-purple-500/[0.03] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[9px] text-purple-400 tracking-widest uppercase">Governance Demos</div>
              <p className="font-mono text-[10px] text-arc-muted mt-0.5">
                One-click: Director → RiskAnalyst → Auditor → Settlement on Arc
              </p>
            </div>
            <span className="font-mono text-[9px] text-arc-muted border border-arc-border/40 rounded px-1.5 py-0.5">
              0.10 USDC
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => launchDemo('governed')}
              disabled={demoLoading !== null}
              className={`flex flex-col gap-0.5 px-3 py-2.5 rounded-lg border font-mono text-left transition-all ${
                demoLoading === 'governed'
                  ? 'border-arc-green/30 bg-arc-green/5 cursor-wait'
                  : 'border-arc-green/30 hover:border-arc-green hover:bg-arc-green/5'
              }`}
            >
              <span className="text-arc-green text-[11px] font-semibold">
                {demoLoading === 'governed' ? '⟳ Launching…' : '▶ Governed Demo'}
              </span>
              <span className="text-arc-muted text-[9px]">Audit PASS → USDC settled</span>
            </button>
            <button
              type="button"
              onClick={() => launchDemo('slash')}
              disabled={demoLoading !== null}
              className={`flex flex-col gap-0.5 px-3 py-2.5 rounded-lg border font-mono text-left transition-all ${
                demoLoading === 'slash'
                  ? 'border-red-500/40 bg-red-500/10 cursor-wait'
                  : 'border-red-500/30 hover:border-red-500 hover:bg-red-500/10'
              }`}
            >
              <span className="text-red-400 text-[11px] font-semibold">
                {demoLoading === 'slash' ? '⟳ Launching…' : '✗ Slash Demo'}
              </span>
              <span className="text-red-400/50 text-[9px]">Audit SLASH → USDC refunded</span>
            </button>
          </div>
          <div className="font-mono text-[9px] text-arc-muted">
            Pipeline: <span className="text-arc-amber">Director</span> → <span className="text-blue-400">RiskAnalyst</span> → <span className="text-purple-400">Auditor</span> → <span className="text-arc-green">Settlement</span>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-5">
        {/* Task description */}
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">Task Description</label>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder={placeholder}
            rows={5}
            required
            className="bg-arc-surface border border-arc-border rounded-lg px-4 py-3 font-mono text-sm text-white placeholder-arc-muted focus:outline-none focus:border-arc-green transition-colors resize-none"
          />
        </div>

        {/* Integrations */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">
              Data Sources <span className="text-arc-muted normal-case tracking-normal">(optional — agents will read from connected sources)</span>
            </label>
          </div>

          {/* Google Drive */}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-arc-muted">Google Drive</span>
            <DriveFilePicker onFilesChange={setDriveFiles} />
          </div>

          {/* Gmail */}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-arc-muted">Gmail</span>
            <GmailPicker onThreadsChange={setGmailThreads} />
          </div>

          {/* Slack */}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-arc-muted">Slack</span>
            <SlackConnect onMessagesChange={setSlackMessages} />
          </div>

        </div>

        {/* Budget + Deadline */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">Budget (USDC)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={budget}
              onChange={e => setBudget(e.target.value)}
              className="bg-arc-surface border border-arc-border rounded-lg px-4 py-3 font-mono text-sm text-white focus:outline-none focus:border-arc-green transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">Deadline</label>
            <select
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
              className="bg-arc-surface border border-arc-border rounded-lg px-4 py-3 font-mono text-sm text-white focus:outline-none focus:border-arc-green transition-colors"
            >
              <option value="1">1 hour</option>
              <option value="6">6 hours</option>
              <option value="24">24 hours</option>
              <option value="72">3 days</option>
            </select>
          </div>
        </div>

        {/* Escrow preview */}
        <div className="border border-arc-border/50 rounded-lg px-4 py-3 bg-arc-surface/50 flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[10px] text-arc-muted">Escrow to lock</span>
            <span className="font-mono text-lg font-bold text-arc-amber">{lockedUsdc} USDC</span>
          </div>
          <div className="font-mono text-[10px] text-arc-muted text-right">
            <div>Split across 3 agents</div>
            <div className="text-arc-green">Released only on delivery</div>
          </div>
        </div>

        {error && (
          <div className="border border-red-500/20 rounded-lg px-4 py-3 bg-red-500/5">
            <span className="font-mono text-xs text-red-400">{error}</span>
          </div>
        )}

        {/* Governance mode selector */}
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">
            Execution Mode
          </label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'standard',    label: 'Standard',    sub: 'Existing pipeline'       },
              { id: 'swarms_demo', label: 'Governed',    sub: 'Director + Auditor'      },
              { id: 'slash_demo',  label: 'Slash Demo',  sub: 'Force governance failure' },
            ] as const).map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => setGovernanceMode(m.id)}
                className={`flex flex-col gap-0.5 px-3 py-2.5 rounded-lg border font-mono transition-colors text-left ${
                  governanceMode === m.id
                    ? m.id === 'slash_demo'
                      ? 'border-red-500/50 bg-red-500/10 text-red-400'
                      : 'border-arc-green/50 bg-arc-green/10 text-arc-green'
                    : 'border-arc-border text-arc-muted hover:border-arc-green/30'
                }`}
              >
                <span className="text-xs font-semibold">{m.label}</span>
                <span className="text-[10px] opacity-70">{m.sub}</span>
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting || !desc.trim()}
          className={`font-mono font-semibold text-sm px-6 py-3 rounded-lg transition-all ${
            submitting || !desc.trim()
              ? 'bg-arc-surface border border-arc-border text-arc-muted cursor-not-allowed'
              : governanceMode === 'slash_demo'
                ? 'bg-red-500 text-white hover:bg-red-400'
                : 'bg-arc-green text-black hover:bg-emerald-400'
          }`}
        >
          {submitting
            ? '⟳ Governed execution in progress…'
            : governanceMode === 'slash_demo'
              ? `▶ Post Task · Slash Demo · Lock ${lockedUsdc} USDC`
              : `▶ Post Task · Lock ${lockedUsdc} USDC`
          }
        </button>
        {submitting && governanceMode !== 'standard' && (
          <p className="font-mono text-[10px] text-purple-400/70">
            Director → RiskAnalyst → Auditor → Settlement (Arc)
          </p>
        )}
        {submitting && governanceMode === 'standard' && (
          <p className="font-mono text-[10px] text-arc-muted">
            Director → RiskAnalyst → Auditor → Settlement
          </p>
        )}
      </form>


      {/* Result */}
      {result && result.status === 'completed' && (
        <div className="flex flex-col gap-4">
          <div className="border border-arc-green/20 rounded-xl bg-arc-green/5 p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-arc-green text-sm">✓</span>
                <span className="font-mono text-xs font-semibold text-arc-green">
                  Governed pipeline complete · {result.budget_usdc.toFixed(3)} USDC settled
                </span>
              </div>
              <StatusBadge status={result.status} />
            </div>
            <div className="bg-black/40 rounded-lg p-4 border border-arc-border">
              <MarkdownResult content={result.result ?? ''} />
            </div>
            <ResultActions content={result.result ?? ''} taskId={result.task_id} />
          </div>
          {result.subtasks.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="font-mono text-[9px] text-arc-muted tracking-widest uppercase">AGENT BREAKDOWN</div>
              {result.subtasks.map(st => (
                <div key={st.agent_name} className="border border-arc-border rounded-lg bg-arc-surface p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-semibold text-white">{st.agent_name}</span>
                    <div className="flex items-center gap-3 font-mono text-[10px]">
                      {st.create_tx && <a href={`${EXPLORER}/tx/${st.create_tx}`} target="_blank" rel="noreferrer" className="text-arc-green hover:underline">Escrow ↗</a>}
                      {st.settle_tx && <a href={`${EXPLORER}/tx/${st.settle_tx}`} target="_blank" rel="noreferrer" className="text-arc-green hover:underline">Settlement ↗</a>}
                    </div>
                  </div>
                  <div className="mt-1"><MarkdownResult content={st.result ?? ''} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tab 3: Active Jobs ────────────────────────────────────────────────────────

interface StreamEvent {
  type:               string
  agent?:             string
  message?:           string
  text?:              string
  reason?:            string
  pipeline?:          boolean
  // governance fields
  stage?:             string
  verdict?:           'PASS' | 'SLASH'
  checks?:            Record<string, unknown>
  checks_count?:      number
  checks_passed?:     number
  tx?:                string
  job_id?:            number
  slash_tx?:          string
  reputation?:        number
  reputation_before?: number
  reputation_after?:  number
  slashed?:           boolean
  settle_tx?:         string
  sla_elapsed?:       number
  sla_seconds?:       number
  amount_usdc?:       number
  gov_log?:           GovernanceLogEntry[]
  summary?:           GovernanceSummary
}

interface GovernanceLogEntry {
  event_type: string
  agent:      string
  timestamp:  number
  ts_human:   string
  label:      string
  severity:   string
  details:    Record<string, unknown>
}

interface GovernanceSummary {
  outcome:          string
  delegation_chain: string[]
  was_slashed:      boolean
  duration_s:       number | null
  audit_verdict:    string | null
  sla_elapsed_s:    number | null
}

// ── Governance helpers ────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  delegated:          'text-arc-amber',
  escrowed:           'text-blue-400',
  executing:          'text-arc-sub',
  auditing:           'text-purple-400',
  audited:            'text-purple-400',
  settling:           'text-arc-green',
  settled:            'text-arc-green',
  slashing:           'text-red-400',
  slashed:            'text-red-400',
  refunded:           'text-orange-400',
  reputation_updated: 'text-arc-muted',
}

const STAGE_ICONS: Record<string, string> = {
  delegated:          '→',
  escrowed:           '🔒',
  executing:          '⟳',
  auditing:           '◈',
  audited:            '◈',
  settling:           '✓',
  settled:            '✓',
  slashing:           '✗',
  slashed:            '✗',
  refunded:           '↩',
  reputation_updated: '△',
}

// ── Workflow step definitions ─────────────────────────────────────────────────

const WORKFLOW_STEPS = [
  { key: 'escrowed',  label: 'Escrow',     agent: 'Settlement',  color: 'text-blue-400',   border: 'border-blue-400/40'   },
  { key: 'delegated', label: 'Director',   agent: 'Director',    color: 'text-arc-amber',  border: 'border-arc-amber/40'  },
  { key: 'executing', label: 'RiskAnalyst',agent: 'RiskAnalyst', color: 'text-blue-400',   border: 'border-blue-400/40'   },
  { key: 'auditing',  label: 'Auditor',    agent: 'Auditor',     color: 'text-purple-400', border: 'border-purple-400/40' },
  { key: 'settled',   label: 'Settlement', agent: 'Settlement',  color: 'text-arc-green',  border: 'border-arc-green/40'  },
]

function WorkflowStepIndicator({ events, slashed }: { events: StreamEvent[]; slashed: boolean }) {
  const stagesSeen   = new Set(events.map(e => e.stage ?? e.type))
  const isDone       = events.some(e => e.type === 'done')
  // findLastIndex polyfill — avoids ES2023 lib requirement
  const lastReachedIdx = WORKFLOW_STEPS.reduce(
    (acc, s, i) => stagesSeen.has(s.key) ? i : acc, -1
  )

  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {WORKFLOW_STEPS.map((step, i) => {
        const reached   = stagesSeen.has(step.key)
        const isSlash   = slashed && step.key === 'settled'
        const isCurrent = reached && !isDone && i === lastReachedIdx
        return (
          <div key={step.key} className="flex items-center flex-shrink-0">
            <div className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg border transition-all ${
              isSlash   ? 'border-red-500/40 bg-red-500/10' :
              reached   ? `${step.border} bg-white/5` :
              'border-arc-border/30 opacity-30'
            }`}>
              <span className={`text-[9px] font-semibold ${
                isSlash  ? 'text-red-400' :
                reached  ? step.color : 'text-arc-muted'
              }`}>
                {isSlash ? '✗' : reached ? (isDone || i < lastReachedIdx) ? '✓' : '⟳' : '○'}
              </span>
              <span className={`text-[9px] whitespace-nowrap ${
                isSlash ? 'text-red-400/80' : reached ? step.color : 'text-arc-muted'
              }`}>
                {isSlash ? 'Slashed' : step.label}
              </span>
              {isCurrent && !isDone && (
                <span className={`w-1 h-1 rounded-full animate-pulse mt-0.5 ${
                  step.key === 'auditing' ? 'bg-purple-400' : 'bg-arc-amber'
                }`} />
              )}
            </div>
            {i < WORKFLOW_STEPS.length - 1 && (
              <span className={`text-[10px] px-1 flex-shrink-0 ${
                stagesSeen.has(WORKFLOW_STEPS[i + 1].key) ? 'text-arc-muted' : 'text-arc-border/40'
              }`}>→</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AuditChecksDetail({ checks, verdict, checksCount, checksPassed, slaElapsed, slaSeconds }: {
  checks:        Record<string, unknown>
  verdict:       'PASS' | 'SLASH'
  checksCount?:  number
  checksPassed?: number
  slaElapsed?:   number
  slaSeconds?:   number
}) {
  const CHECK_LABELS: Record<string, string> = {
    forced_slash:             'Force slash (demo)',
    sla_met:                  'SLA compliance',
    non_empty:                'Output non-empty',
    structured_output:        'Structured JSON',
    required_fields_present:  'Required fields',
    valid_risk_score:         'Risk score range',
    reasoning_depth:          'Reasoning depth',
    audit_passed:             'Final verdict',
    llm_quality_check:        'LLM quality check',
    elapsed_s:                'Elapsed time',
    sla_limit_s:              'SLA limit',
  }
  const displayChecks = Object.entries(checks).filter(([k]) =>
    !['elapsed_s', 'sla_limit_s'].includes(k)
  )
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-purple-400 font-semibold text-[11px]">◈ Auditor</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${
          verdict === 'PASS'
            ? 'bg-arc-green/10 text-arc-green border-arc-green/30'
            : 'bg-red-500/10 text-red-400 border-red-500/30'
        }`}>{verdict}</span>
        {checksCount !== undefined && (
          <span className="text-[9px] text-arc-muted">
            {checksPassed ?? '?'}/{checksCount} checks passed
          </span>
        )}
        {slaElapsed !== undefined && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
            slaSeconds && slaElapsed <= slaSeconds
              ? 'text-arc-green/70 border-arc-green/20'
              : 'text-red-400/70 border-red-500/20'
          }`}>
            SLA: {slaElapsed}s / {slaSeconds}s
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 ml-4 mt-0.5">
        {displayChecks.map(([k, v]) => {
          const isPass = v === true || v === 'PASS'
          const isFail = v === false || v === 'SLASH'
          return (
            <div key={k} className="flex items-center gap-1.5">
              <span className={`text-[9px] flex-shrink-0 ${isPass ? 'text-arc-green' : isFail ? 'text-red-400' : 'text-arc-muted'}`}>
                {isPass ? '✓' : isFail ? '✗' : '·'}
              </span>
              <span className={`text-[9px] ${isPass ? 'text-arc-green/70' : isFail ? 'text-red-400/70' : 'text-arc-muted'}`}>
                {CHECK_LABELS[k] ?? k}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Governance trail for completed governed tasks ─────────────────────────────

interface CompletedGovernanceLog {
  task_id:          string
  delegation_chain: string[]
  was_slashed:      boolean
  outcome:          string
  duration_s:       number | null
  events:           GovernanceLogEntry[]
  event_count:      number
  summary:          GovernanceSummary & { audit_checks: Record<string, boolean> | null }
}

function CompletedGovernancePanel({ taskId }: { taskId: string }) {
  const [log,     setLog]  = useState<CompletedGovernanceLog | null>(null)
  const [loading, setLoad] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/tasks/${taskId}/governance`)
      .then(r => r.json())
      .then(d => { setLog(d); setLoad(false) })
      .catch(() => setLoad(false))
  }, [taskId])

  if (loading) return (
    <div className="border border-purple-500/20 rounded-xl p-3 font-mono text-[10px] text-arc-muted animate-pulse">
      Loading governance trail…
    </div>
  )
  if (!log || log.event_count === 0) return null

  const EV_COLOR: Record<string, string> = {
    escrowed:           '#60a5fa',
    delegated:          '#f59e0b',
    executing:          '#60a5fa',
    auditing:           '#a855f7',
    audited:            log.was_slashed ? '#ef4444' : '#10b981',
    settled:            '#10b981',
    slashed:            '#ef4444',
    refunded:           '#ef4444',
    reputation_updated: '#10b981',
  }

  const AGENT_BADGE: Record<string, string> = {
    Director:   'border-arc-amber/40 text-arc-amber',
    RiskAnalyst:'border-blue-400/40 text-blue-400',
    Auditor:    'border-purple-400/40 text-purple-400',
    Settlement: 'border-arc-green/40 text-arc-green',
  }

  return (
    <div className={`border rounded-xl p-4 flex flex-col gap-3 font-mono text-xs ${
      log.was_slashed ? 'border-red-500/30 bg-red-500/[0.03]' : 'border-purple-500/20 bg-purple-500/[0.02]'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-purple-400">Governance Audit Trail</span>
          {!log.was_slashed && (log.outcome === 'completed' || log.outcome === 'settled') && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-arc-green/30 text-arc-green">SETTLED</span>
          )}
          {log.was_slashed && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-red-500/40 text-red-400 font-bold">SLASHED</span>
          )}
        </div>
        {log.duration_s != null && (
          <span className="text-[9px] text-arc-muted">{log.duration_s.toFixed(1)}s end-to-end</span>
        )}
      </div>

      {/* Delegation chain */}
      {log.delegation_chain.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {log.delegation_chain.map((agent, i) => (
            <span key={`${agent}-${i}`} className="flex items-center gap-1">
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${AGENT_BADGE[agent] ?? 'border-arc-border text-arc-sub'}`}>
                {agent}
              </span>
              {i < log.delegation_chain.length - 1 && <span className="text-arc-muted/50">→</span>}
            </span>
          ))}
        </div>
      )}

      {/* Event timeline */}
      <div className="flex flex-col gap-1 border-t border-arc-border/30 pt-2">
        {log.events.map((ev, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: EV_COLOR[ev.event_type] ?? '#6b7280' }} />
            <span className="text-[9px] w-24 flex-shrink-0 font-semibold uppercase tracking-wide"
              style={{ color: EV_COLOR[ev.event_type] ?? '#9ca3af' }}>
              {ev.event_type}
            </span>
            <span className="text-[10px] text-arc-sub flex-1 truncate">{ev.label}</span>
            <span className="text-[9px] text-arc-muted flex-shrink-0">{ev.ts_human}</span>
          </div>
        ))}
      </div>

      {/* Audit verdict */}
      {log.summary.audit_verdict && (
        <div className={`rounded-lg px-3 py-2 border ${
          log.summary.audit_verdict === 'PASS'
            ? 'border-arc-green/20 bg-arc-green/5'
            : 'border-red-500/20 bg-red-500/5'
        }`}>
          <div className="flex items-center justify-between flex-wrap gap-1">
            <span className={`text-[10px] font-bold ${
              log.summary.audit_verdict === 'PASS' ? 'text-arc-green' : 'text-red-400'
            }`}>
              {log.summary.audit_verdict === 'PASS' ? '✓ AUDIT PASSED — 7/7 checks' : '✗ AUDIT FAILED — SLASHED'}
            </span>
            {log.summary.sla_elapsed_s != null && (
              <span className="text-[9px] text-arc-muted">{log.summary.sla_elapsed_s.toFixed(1)}s SLA elapsed</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function GovernancePanel({ events, delegationChain, slashed }: {
  events:          StreamEvent[]
  delegationChain: string[]
  slashed:         boolean
}) {
  const govEvents  = events.filter(e => ['governance', 'audited', 'slashed'].includes(e.type))
  const auditEvent = events.find(e => e.type === 'audited')
  const slashEvent = events.find(e => e.type === 'slashed')
  const doneEvent  = events.find(e => e.type === 'done')
  const isDone     = !!doneEvent

  if (govEvents.length === 0 && delegationChain.length === 0) return null

  return (
    <div className={`border rounded-xl p-4 flex flex-col gap-3 font-mono text-xs ${
      slashed ? 'border-red-500/30 bg-red-500/[0.04]' : 'border-purple-500/20 bg-purple-500/[0.03]'
    }`}>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-purple-400">Governance Audit Trail</span>
          {isDone && !slashed && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-arc-green/30 text-arc-green">SETTLED</span>
          )}
          {slashed && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-red-500/40 text-red-400 font-bold">SLASHED</span>
          )}
          {!isDone && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-arc-amber/30 text-arc-amber animate-pulse">LIVE</span>
          )}
        </div>
        {doneEvent?.summary?.duration_s != null && (
          <span className="text-[9px] text-arc-muted">
            {doneEvent.summary.duration_s}s end-to-end
          </span>
        )}
      </div>

      {/* Workflow step indicator */}
      <WorkflowStepIndicator events={events} slashed={slashed} />

      {/* Delegation chain */}
      {delegationChain.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[9px] uppercase tracking-widest text-arc-muted">Agent Chain</div>
          <div className="flex items-center gap-1 flex-wrap">
            {delegationChain.map((agent, i) => {
              const AGENT_BADGE: Record<string, string> = {
                Director:   'border-arc-amber/40 text-arc-amber',
                RiskAnalyst:'border-blue-400/40 text-blue-400',
                Auditor:    'border-purple-400/40 text-purple-400',
                Settlement: 'border-arc-green/40 text-arc-green',
              }
              return (
                <span key={agent} className="flex items-center gap-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${AGENT_BADGE[agent] ?? 'border-arc-border text-arc-sub'}`}>
                    {agent}
                  </span>
                  {i < delegationChain.length - 1 && <span className="text-arc-muted/50">→</span>}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Audit verdict (expanded) */}
      {auditEvent && auditEvent.checks && (
        <div className={`rounded-lg p-2.5 border ${
          auditEvent.verdict === 'PASS'
            ? 'border-arc-green/20 bg-arc-green/5'
            : 'border-red-500/20 bg-red-500/5'
        }`}>
          <AuditChecksDetail
            checks       = {auditEvent.checks}
            verdict      = {auditEvent.verdict!}
            checksCount  = {auditEvent.checks_count}
            checksPassed = {auditEvent.checks_passed}
            slaElapsed   = {auditEvent.sla_elapsed}
            slaSeconds   = {auditEvent.sla_seconds}
          />
        </div>
      )}

      {/* Slash event card */}
      {slashEvent && (
        <div className="flex flex-col gap-1.5 border border-red-500/30 rounded-lg p-3 bg-red-500/[0.06]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-red-400 font-bold">✗ SLASH EXECUTED</span>
            <span className="text-red-300/70 text-[10px]">Job #{slashEvent.job_id}</span>
            {slashEvent.amount_usdc != null && (
              <span className="text-red-300/60 text-[10px]">{slashEvent.amount_usdc?.toFixed(3)} USDC returned</span>
            )}
          </div>
          <div className="text-red-300/70 text-[10px]">{slashEvent.reason}</div>
          {slashEvent.reputation_before != null && slashEvent.reputation_after != null && (
            <div className="flex items-center gap-1.5 text-[9px]">
              <span className="text-arc-muted">Reputation:</span>
              <span className="text-arc-sub">{(slashEvent.reputation_before / 1000).toFixed(1)}</span>
              <span className="text-arc-muted">→</span>
              <span className="text-red-400">{(slashEvent.reputation_after / 1000).toFixed(1)}</span>
              <span className="text-red-400/70">
                ({((slashEvent.reputation_after - slashEvent.reputation_before) / 1000).toFixed(1)})
              </span>
            </div>
          )}
          {slashEvent.slash_tx && (
            <a
              href={`${EXPLORER}/tx/${slashEvent.slash_tx}`}
              target="_blank" rel="noreferrer"
              className="text-red-400/60 hover:text-red-400 text-[10px] underline w-fit"
            >
              Slash TX: {slashEvent.slash_tx.slice(0, 20)}… ↗
            </a>
          )}
        </div>
      )}

      {/* Governance event timeline */}
      <div className="flex flex-col gap-1 max-h-44 overflow-y-auto">
        {govEvents
          .filter(e => e.type === 'governance')
          .map((ev, i) => {
            const stageKey = ev.stage ?? ''
            return (
              <div key={i} className="flex items-start gap-2 min-h-[1.4rem]">
                <span className={`flex-shrink-0 w-3 text-center ${STAGE_COLORS[stageKey] ?? 'text-arc-muted'}`}>
                  {STAGE_ICONS[stageKey] ?? '·'}
                </span>
                <span className={`text-[9px] font-semibold flex-shrink-0 w-[4.5rem] ${STAGE_COLORS[stageKey] ?? 'text-arc-muted'}`}>
                  {ev.agent}
                </span>
                <span className="text-arc-sub/80 text-[10px] leading-snug">{ev.message}</span>
                {ev.tx && (
                  <a href={`${EXPLORER}/tx/${ev.tx}`} target="_blank" rel="noreferrer"
                    className="text-arc-muted hover:text-arc-green text-[10px] ml-auto flex-shrink-0">↗</a>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

function LiveStreamPanel({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const [events,          setEvents]          = useState<StreamEvent[]>([])
  const [current,         setCurrent]         = useState<Record<string, string>>({})
  const [delegationChain, setDelegationChain] = useState<string[]>([])
  const [slashed,         setSlashed]         = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!taskId) return
    const es = new EventSource(`${API}/api/tasks/${taskId}/stream`)
    es.onmessage = (e) => {
      const ev: StreamEvent = JSON.parse(e.data)
      if (ev.type === 'ping') return
      if (ev.type === 'text_chunk' && ev.agent && ev.text) {
        setCurrent(prev => ({ ...prev, [ev.agent!]: (prev[ev.agent!] ?? '') + ev.text }))
        return
      }
      if (ev.type === 'text_start') return

      // Track delegation chain — any event with an agent name participates
      if (ev.agent && !['ping', 'text_chunk', 'text_start'].includes(ev.type)) {
        setDelegationChain(prev =>
          prev.includes(ev.agent!) ? prev : [...prev, ev.agent!]
        )
      }
      if (ev.type === 'slashed') setSlashed(true)

      setEvents(prev => [...prev, ev])
      if (ev.type === 'done' || ev.type === 'error') {
        es.close()
        setTimeout(onDone, 1500)
      }
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [taskId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [events, current])

  const AGENT_COLOR: Record<string, string> = {
    Director: 'text-arc-amber', RiskAnalyst: 'text-blue-400',
    Auditor: 'text-purple-400', Settlement: 'text-arc-green',
  }

  // Execution feed: all non-governance, non-internal events
  // Governance panel: parallel view with full audit trail
  const execEvents   = events.filter(e => !['governance', 'ping', 'text_chunk', 'text_start'].includes(e.type))
  const hasGovEvents = events.some(e => ['governance', 'audited', 'slashed'].includes(e.type))

  return (
    <div className="flex flex-col gap-3">
    <div className={`border rounded-xl bg-black p-5 flex flex-col gap-3 font-mono text-xs ${
      slashed ? 'border-red-500/30' : 'border-arc-green/20'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-arc-green text-[10px] uppercase tracking-widest">
          <span className={`w-2 h-2 rounded-full animate-pulse ${slashed ? 'bg-red-500' : 'bg-arc-green'}`} />
          {slashed ? 'Execution Slashed' : 'Live Execution Stream'}
        </div>
        {slashed && (
          <span className="text-[10px] text-red-400 font-mono">USDC refunded to employer</span>
        )}
      </div>
      <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
        {execEvents.map((ev, i) => (
          <div key={i} className="flex items-start gap-2">
            {ev.type === 'routed' ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-arc-amber font-semibold">→ Router</span>
                <span className="text-arc-sub">
                  {ev.pipeline ? 'Full pipeline selected' : `Routed to ${ev.agent}`}
                  {ev.reason ? `: ${ev.reason}` : ''}
                </span>
                {!ev.pipeline && ev.agent && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border border-arc-green/30 ${AGENT_COLOR[ev.agent] ?? 'text-white'}`}>
                    {ev.agent}
                  </span>
                )}
              </div>
            ) : ev.type === 'audited' ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-purple-400 font-semibold">◈ Auditor</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${
                  ev.verdict === 'PASS'
                    ? 'bg-arc-green/10 text-arc-green border-arc-green/30'
                    : 'bg-red-500/10 text-red-400 border-red-500/30'
                }`}>{ev.verdict}</span>
                <span className="text-arc-muted">{ev.reason}</span>
              </div>
            ) : ev.type === 'slashed' ? (
              <div className="flex items-center gap-2 flex-wrap text-red-400">
                <span className="font-semibold">✗ SLASHED</span>
                <span className="text-red-300/70">Job #{ev.job_id} — {ev.reason}</span>
              </div>
            ) : (
              <>
                {ev.agent && <span className={`flex-shrink-0 font-semibold ${AGENT_COLOR[ev.agent] ?? 'text-white'}`}>{ev.agent}</span>}
                <span className={`${ev.type === 'error' ? 'text-red-400' : ev.type === 'done' ? 'text-arc-green' : 'text-arc-sub'}`}>
                  {ev.message ?? (ev.type === 'done' ? (slashed ? '✗ Execution slashed — USDC refunded' : '✓ All agents complete') : ev.type)}
                </span>
              </>
            )}
          </div>
        ))}
        {Object.entries(current).map(([agent, text]) => text && (
          <div key={agent} className="flex flex-col gap-1">
            <span className={`font-semibold text-[10px] ${AGENT_COLOR[agent] ?? 'text-white'}`}>{agent} output:</span>
            <span className="text-arc-sub leading-relaxed whitespace-pre-wrap">{text}<span className="animate-pulse">▌</span></span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>

    {hasGovEvents && (
      <GovernancePanel
        events          = {events}
        delegationChain = {delegationChain}
        slashed         = {slashed}
      />
    )}
    </div>
  )
}

function ActiveJobsTab({ liveTaskId = '', onStreamDone = () => {} }: { liveTaskId?: string; onStreamDone?: () => void }) {
  const [tasks,    setTasks]    = useState<TaskRecord[]>([])
  const [loading,  setLoad]     = useState(true)
  const [openIds,  setOpenIds]  = useState<Set<string>>(new Set())
  const [firstLoad,setFirstLoad]= useState(true)
  const myAddress = localStorage.getItem('brewing_employer_address') ?? ''
  const myName    = localStorage.getItem('brewing_employer_name') ?? ''

  const matchesMe = (t: TaskRecord) =>
    t.employer_address.toLowerCase() === myAddress.toLowerCase() ||
    (myName && t.employer_name === myName)

  const toggle = (id: string) =>
    setOpenIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const refresh = useCallback(async () => {
    try {
      const data: TaskRecord[] = await fetch(`${API}/api/tasks`).then(r => r.json())
      const mine = myAddress || myName ? data.filter(matchesMe) : data
      setTasks(mine)
      if (firstLoad && mine.length > 0) {
        setOpenIds(new Set([mine[0].task_id]))
        setFirstLoad(false)
      }
    } catch { /* offline */ } finally { setLoad(false) }
  }, [myAddress, firstLoad])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [refresh])

  if (loading) return <div className="font-mono text-xs text-arc-muted mt-8">Loading jobs…</div>

  if (tasks.length === 0) return (
    <div className="flex flex-col gap-3">
      {liveTaskId && <LiveStreamPanel taskId={liveTaskId} onDone={onStreamDone} />}
      <div className="border border-arc-border rounded-xl p-12 text-center">
        <div className="font-mono text-xs text-arc-muted">No tasks yet — post your first task</div>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      {liveTaskId && <LiveStreamPanel taskId={liveTaskId} onDone={onStreamDone} />}
      <div className="font-mono text-[9px] text-arc-muted tracking-widest uppercase">
        {tasks.length} TASK{tasks.length !== 1 ? 'S' : ''} · click a row to expand
      </div>
      {tasks.map(task => {
        const isOpen = openIds.has(task.task_id)
        const snippet = task.description.length > 120
          ? task.description.slice(0, 120) + '…'
          : task.description

        // Detect governed tasks by description heuristic or status
        const isSlashedTask  = task.status === 'refunded'
        const isGoverned     = (task.subtasks ?? []).length === 0 && task.status !== 'pending'

        return (
          <div key={task.task_id} className={`border rounded-xl bg-arc-surface overflow-hidden transition-colors ${
            isSlashedTask ? 'border-red-500/20' :
            isOpen        ? 'border-arc-green/30' :
            'border-arc-border hover:border-arc-border/80'
          }`}>
            {/* Clickable header — always visible */}
            <button
              type="button"
              onClick={() => toggle(task.task_id)}
              className="w-full text-left px-5 py-3.5 flex items-center gap-3"
            >
              {/* Chevron */}
              <span className={`font-mono text-arc-muted text-[10px] flex-shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}>▶</span>

              {/* Left: ID + agents + snippet */}
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="font-mono text-[10px] text-arc-muted flex-shrink-0">#{task.task_id.slice(0, 8)}</span>
                  {isGoverned && (task.subtasks ?? []).length === 0 && (
                    <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border flex-shrink-0 ${
                      isSlashedTask
                        ? 'border-red-500/30 text-red-400/80'
                        : 'border-purple-500/30 text-purple-400/80'
                    }`}>
                      {isSlashedTask ? '✗ SLASHED' : '◈ GOVERNED'}
                    </span>
                  )}
                  {(task.subtasks ?? []).length > 0 && (
                    <span className="font-mono text-[10px] text-arc-sub truncate">
                      {(task.subtasks ?? []).map(s => s.agent_name).join(' · ')}
                    </span>
                  )}
                </div>
                <span className="font-mono text-[11px] text-arc-sub truncate">{snippet}</span>
              </div>

              {/* Right: amount + status + time */}
              <div className="flex items-center gap-3 flex-shrink-0">
                {task.status === 'in_progress' && (
                  <Countdown createdAt={task.created_at} deadlineHours={task.deadline_hours} />
                )}
                {task.completed_at && (
                  <span className="font-mono text-[10px] text-arc-muted">
                    {new Date(task.completed_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <span className="font-mono text-[11px] text-arc-amber font-bold">{task.budget_usdc.toFixed(3)} USDC</span>
                <StatusBadge status={task.status} />
              </div>
            </button>

            {/* Expandable body */}
            {isOpen && (
              <div className="border-t border-arc-border px-5 py-4 flex flex-col gap-4">
                {/* Full description */}
                <p className="font-mono text-[12px] text-white leading-relaxed">{task.description}</p>

                {/* Agent pipeline */}
                {(task.subtasks ?? []).length > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="font-mono text-[9px] text-arc-muted tracking-widest uppercase">AGENT PIPELINE</div>
                    {(task.subtasks ?? []).map(st => (
                      <div key={st.agent_name} className="border border-arc-border rounded-lg bg-black/40 p-3 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`font-mono text-[10px] ${
                              st.status === 'completed' ? 'text-arc-green' :
                              st.status === 'working'   ? 'text-arc-amber' : 'text-arc-muted'
                            }`}>
                              {st.status === 'completed' ? '✓' : st.status === 'working' ? '⟳' : '○'}
                            </span>
                            <span className="font-mono text-[11px] font-semibold text-white">{st.agent_name}</span>
                            <StatusBadge status={st.status} />
                          </div>
                          <div className="flex gap-3 font-mono text-[10px]">
                            {st.create_tx && <a href={`${EXPLORER}/tx/${st.create_tx}`} target="_blank" rel="noreferrer" className="text-arc-green hover:underline">Escrow ↗</a>}
                            {st.settle_tx && <a href={`${EXPLORER}/tx/${st.settle_tx}`} target="_blank" rel="noreferrer" className="text-arc-green hover:underline">Settlement ↗</a>}
                          </div>
                        </div>
                        {st.result && <div className="mt-1"><MarkdownResult content={st.result} /></div>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Combined result */}
                {task.result && (
                  <div className="border border-arc-green/20 rounded-lg p-4 bg-arc-green/5">
                    <div className="font-mono text-[9px] text-arc-green tracking-widest uppercase mb-2">COMBINED RESULT</div>
                    <MarkdownResult content={task.result} />
                    <div className="mt-3 pt-3 border-t border-arc-border/50">
                      <ResultActions content={task.result} taskId={task.task_id} />
                    </div>
                  </div>
                )}

                {/* Governance audit trail for governed tasks */}
                {isGoverned && (
                  <CompletedGovernancePanel taskId={task.task_id} />
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Tab 4: Receipts ───────────────────────────────────────────────────────────

function ReceiptsTab() {
  const [tasks,   setTasks]   = useState<TaskRecord[]>([])
  const [loading, setLoad]    = useState(true)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const myAddress = localStorage.getItem('brewing_employer_address') ?? ''
  const myName    = localStorage.getItem('brewing_employer_name') ?? ''

  const matchesMe = (t: TaskRecord) =>
    t.employer_address.toLowerCase() === myAddress.toLowerCase() ||
    (myName && t.employer_name === myName)

  useEffect(() => {
    fetch(`${API}/api/tasks`)
      .then(r => r.json())
      .then((d: TaskRecord[]) => {
        const mine = myAddress || myName ? d.filter(matchesMe) : d
        const completed = mine.filter(t => t.status === 'completed')
        setTasks(completed)
        if (completed.length > 0) setOpenIds(new Set([completed[0].task_id]))
      })
      .catch(() => null)
      .finally(() => setLoad(false))
  }, [myAddress])

  const toggle = (id: string) =>
    setOpenIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const download = (task: TaskRecord) => {
    const content = [
      `BREWING TASK RECEIPT`,
      `═══════════════════════════════`,
      `Task ID:      ${task.task_id}`,
      `Agents:       ${(task.subtasks ?? []).length > 0 ? (task.subtasks ?? []).map(s => s.agent_name).join(', ') : '—'}`,
      `Description:  ${task.description}`,
      `USDC Paid:    ${task.budget_usdc.toFixed(3)}`,
      `Completed:    ${task.completed_at ? new Date(task.completed_at * 1000).toISOString() : '—'}`,
      ``,
      `ON-CHAIN PROOF`,
      `──────────────`,
      ...(task.subtasks ?? []).map(st =>
        `${st.agent_name}:\n  escrow=${st.create_tx ? `${EXPLORER}/tx/${st.create_tx}` : '—'}\n  settle=${st.settle_tx ? `${EXPLORER}/tx/${st.settle_tx}` : '—'}`
      ),
      ``,
      `RESULT`,
      `───────`,
      task.result ?? '—',
    ].join('\n')

    const blob = new Blob([content], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `brewing-receipt-${task.task_id}.txt`; a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="font-mono text-xs text-arc-muted mt-8">Loading receipts…</div>

  if (tasks.length === 0) return (
    <div className="border border-arc-border rounded-xl p-12 text-center">
      <div className="font-mono text-xs text-arc-muted">No completed tasks yet</div>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[9px] text-arc-muted tracking-widest uppercase">
          {tasks.length} COMPLETED TASK{tasks.length !== 1 ? 'S' : ''} · click to expand
        </div>
        <p className="font-mono text-[10px] text-arc-muted">On-chain proof · downloadable receipts</p>
      </div>
      {tasks.map((task, i) => {
        const isOpen  = openIds.has(task.task_id)
        const snippet = task.description.length > 120 ? task.description.slice(0, 120) + '…' : task.description
        const firstSettleTx = (task.subtasks ?? []).find(s => s.settle_tx)?.settle_tx

        return (
          <div key={task.task_id} className={`border rounded-xl bg-arc-surface overflow-hidden transition-colors ${
            isOpen ? 'border-arc-green/30' : 'border-arc-border hover:border-arc-border/80'
          }`}>
            {/* Clickable header */}
            <button
              type="button"
              onClick={() => toggle(task.task_id)}
              className="w-full text-left px-5 py-3.5 flex items-center gap-3"
            >
              <span className="text-arc-green text-xs flex-shrink-0">✓</span>
              <span className={`font-mono text-arc-muted text-[10px] flex-shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}>▶</span>

              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-arc-muted flex-shrink-0">#{task.task_id}</span>
                  <span className="font-mono text-[10px] text-arc-sub truncate">
                    {(task.subtasks ?? []).length > 0 ? (task.subtasks ?? []).map(s => s.agent_name).join(' · ') : 'Agent'}
                  </span>
                  {i === 0 && <span className="font-mono text-[9px] text-arc-green border border-arc-green/30 rounded px-1.5 py-0.5 flex-shrink-0">Latest</span>}
                </div>
                <span className="font-mono text-[11px] text-arc-sub truncate">{snippet}</span>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                {task.completed_at && (
                  <span className="font-mono text-[10px] text-arc-muted">
                    {new Date(task.completed_at * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    {' '}
                    {new Date(task.completed_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <span className="font-mono text-[11px] text-arc-amber font-bold">{task.budget_usdc.toFixed(3)} USDC</span>
              </div>
            </button>

            {/* Expandable body */}
            {isOpen && (
              <div className="border-t border-arc-border px-5 py-4 flex flex-col gap-4">
                <p className="font-mono text-[11px] text-arc-sub leading-relaxed">{task.description}</p>

                {/* On-chain proof row */}
                <div className="flex flex-wrap items-center gap-4 font-mono text-[10px] text-arc-muted">
                  <span>{(task.subtasks ?? []).filter(s => s.status === 'completed').length}/{(task.subtasks ?? []).length} agents settled on-chain</span>
                  {firstSettleTx && (
                    <a href={`${EXPLORER}/tx/${firstSettleTx}`} target="_blank" rel="noreferrer" className="text-arc-green hover:underline">
                      View on ArcScan ↗
                    </a>
                  )}
                  <button
                    onClick={() => download(task)}
                    className="text-arc-sub border border-arc-border rounded px-2 py-1 hover:border-arc-green hover:text-arc-green transition-colors"
                  >
                    ↓ Receipt
                  </button>
                </div>

                {/* Result */}
                {task.result && (
                  <div className="border border-arc-border rounded-lg p-4 bg-black/40">
                    <MarkdownResult content={task.result} />
                    <div className="mt-3 pt-3 border-t border-arc-border/50">
                      <ResultActions content={task.result} taskId={task.task_id} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Tab 5: Account ────────────────────────────────────────────────────────────

interface BizProfile {
  name: string; email: string; business_id: string; wallet_address: string
  balance_usdc: number; tasks_total: number; tasks_completed: number
  tasks_failed: number; total_spent: number
}

function AccountTab({ onSignOut }: { onSignOut: () => void }) {
  const [profile,  setProfile]  = useState<BizProfile | null>(null)
  const [loading,  setLoading]  = useState(true)
  const { walletAddr, connect, disconnect } = useWalletConnect()

  const circleAddr = localStorage.getItem('brewing_employer_address') || ''
  const lookupAddr = walletAddr || circleAddr

  useEffect(() => {
    if (!lookupAddr) { setLoading(false); return }
    fetch(`${API}/api/businesses/me?address=${encodeURIComponent(lookupAddr)}`)
      .then(r => r.json())
      .then(d => { setProfile(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [lookupAddr])

  const successRate = profile && profile.tasks_total > 0
    ? Math.round((profile.tasks_completed / profile.tasks_total) * 100)
    : null

  const handleSignOut = () => {
    ['brewing_employer_address', 'brewing_employer_name', 'brewing_business_id',
     'brewing_web3_wallet', 'gmail_token', 'gmail_send_token', 'slack_token']
      .forEach(k => localStorage.removeItem(k))
    onSignOut()
  }

  if (loading) return <div className="font-mono text-xs text-arc-muted mt-8">Loading account…</div>

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold">{profile?.name || localStorage.getItem('brewing_employer_name') || 'Your Account'}</h2>
        <p className="font-mono text-xs text-arc-muted">{profile?.email || ''}</p>
      </div>

      {/* Wallet cards */}
      <div className="flex flex-col gap-3">
        {/* Circle DCW */}
        <div className="border border-arc-border rounded-xl bg-arc-surface p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[9px] text-arc-muted tracking-widest uppercase">Settlement Wallet (Arc Testnet)</div>
            {profile && (
              <span className="font-mono text-sm font-bold text-arc-green">{profile.balance_usdc.toFixed(4)} USDC</span>
            )}
          </div>
          <div className="font-mono text-[11px] text-arc-sub break-all">{circleAddr || '—'}</div>
          {circleAddr && (
            <a
              href={`${EXPLORER}/address/${circleAddr}`}
              target="_blank" rel="noreferrer"
              className="font-mono text-[10px] text-arc-muted hover:text-arc-green transition-colors"
            >
              View on ArcScan ↗
            </a>
          )}
        </div>

        {/* MetaMask wallet */}
        <div className={`border rounded-xl bg-arc-surface p-5 flex flex-col gap-3 ${walletAddr ? 'border-arc-green/30' : 'border-arc-border'}`}>
          <div className="flex items-center justify-between">
            <div className="font-mono text-[9px] text-arc-muted tracking-widest uppercase">MetaMask Wallet</div>
            {walletAddr && <span className="font-mono text-[10px] text-arc-green">Connected ✓</span>}
          </div>
          {walletAddr ? (
            <div className="flex flex-col gap-2">
              <div className="font-mono text-[11px] text-white break-all">{walletAddr}</div>
              <div className="flex gap-3">
                <a
                  href={`${EXPLORER}/address/${walletAddr}`}
                  target="_blank" rel="noreferrer"
                  className="font-mono text-[10px] text-arc-muted hover:text-arc-green transition-colors"
                >
                  View on ArcScan ↗
                </a>
                <button
                  type="button" onClick={disconnect}
                  className="font-mono text-[10px] text-arc-muted hover:text-red-400 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button" onClick={connect}
              className="border border-arc-border rounded-lg px-4 py-2.5 font-mono text-xs text-arc-sub hover:border-arc-green hover:text-arc-green transition-colors text-left flex items-center gap-2"
            >
              <span className="text-base">🦊</span> Connect MetaMask
            </button>
          )}
        </div>
      </div>

      {/* Task stats */}
      {profile && profile.tasks_total > 0 && (
        <div className="border border-arc-border rounded-xl bg-arc-surface p-5 flex flex-col gap-4">
          <div className="font-mono text-[9px] text-arc-muted tracking-widest uppercase">Task History</div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <div className="font-mono text-[9px] text-arc-muted uppercase tracking-widest">Tasks Posted</div>
              <div className="font-mono text-2xl font-bold text-white">{profile.tasks_total}</div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="font-mono text-[9px] text-arc-muted uppercase tracking-widest">Completed</div>
              <div className="font-mono text-2xl font-bold text-arc-green">{profile.tasks_completed}</div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="font-mono text-[9px] text-arc-muted uppercase tracking-widest">Total Spent</div>
              <div className="font-mono text-2xl font-bold text-arc-amber">{profile.total_spent.toFixed(3)} USDC</div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="font-mono text-[9px] text-arc-muted uppercase tracking-widest">Success Rate</div>
              <div className={`font-mono text-2xl font-bold ${successRate !== null && successRate >= 80 ? 'text-arc-green' : 'text-arc-sub'}`}>
                {successRate !== null ? `${successRate}%` : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sign out */}
      <div className="flex gap-3 pt-2">
        <button
          type="button" onClick={handleSignOut}
          className="font-mono text-xs border border-red-500/30 text-red-400/70 rounded-lg px-5 py-2.5 hover:border-red-400 hover:text-red-400 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}

// ── Dashboard shell ───────────────────────────────────────────────────────────

type TabId = 'marketplace' | 'post' | 'jobs' | 'receipts' | 'account'

export default function Dashboard() {
  const navigate  = useNavigate()
  const [tab, setTab]             = useState<TabId>(() => (sessionStorage.getItem('dashboard_tab') as TabId) || 'marketplace')
  const [refreshKey,   setRefreshKey]   = useState(0)
  const [liveTaskId,   setLiveTaskId]   = useState<string>(() => {
    // Pick up a demo task launched from the landing page
    const demo = sessionStorage.getItem('demo_live_task')
    if (demo) { sessionStorage.removeItem('demo_live_task'); return demo }
    return ''
  })
  const [preselectedAgent, setPreselectedAgent] = useState<string | undefined>()
  const { walletAddr, connect } = useWalletConnect()

  const employerName    = localStorage.getItem('brewing_employer_name')    || ''
  const employerAddress = localStorage.getItem('brewing_employer_address') || ''
  // Display the connected web3 wallet address if present, otherwise the Circle DCW
  const displayAddr     = walletAddr || employerAddress
  const addrShort       = displayAddr
    ? `${displayAddr.slice(0, 6)}…${displayAddr.slice(-4)}`
    : null

  const goTab = (t: TabId) => {
    sessionStorage.setItem('dashboard_tab', t)
    setTab(t)
  }

  // Auth guard — redirect to onboard if no session
  useEffect(() => {
    if (!employerAddress) navigate('/onboard')
  }, [employerAddress, navigate])

  const handleHire = (agentName: string) => {
    setPreselectedAgent(agentName)
    goTab('post')
  }

  const TABS: { id: TabId; label: string; sub: string }[] = [
    { id: 'marketplace', label: 'Agents',      sub: 'Browse · governed · audited' },
    { id: 'post',        label: 'Post a Task', sub: 'New task · escrow · settle' },
    { id: 'jobs',        label: 'Active Jobs', sub: 'Status · results · timers' },
    { id: 'receipts',    label: 'Receipts',    sub: 'History · proof · download' },
    { id: 'account',     label: 'Account',     sub: 'Profile · spend · wallets' },
  ]

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">

      {/* Nav */}
      <nav className="border-b border-arc-border sticky top-0 z-50 bg-black/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 hover:text-arc-green transition-colors"
            >
              <svg width="14" height="18" viewBox="0 0 16 20" fill="none" className="text-arc-green flex-shrink-0">
                <path d="M5.5 1.5h5M6 1.5v5.2L1.2 14.8A2.5 2.5 0 003.5 18.5h9a2.5 2.5 0 002.3-3.7L10 6.7V1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="6.2" cy="14.5" r="0.9" fill="currentColor"/>
                <circle cx="9.4" cy="12.8" r="0.65" fill="currentColor"/>
              </svg>
              <span className="font-mono font-bold text-sm tracking-[0.2em]">BREWING</span>
            </button>
            <span className="text-arc-border">/</span>
            <span className="font-mono text-xs text-arc-sub">
              {employerName ? `${employerName}` : 'Dashboard'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-arc-green pulse-dot" />
              <span className="font-mono text-[11px] text-arc-green tracking-wide">Arc Testnet</span>
            </div>
            {/* MetaMask connect chip */}
            {walletAddr ? (
              <button
                onClick={() => goTab('account')}
                className="font-mono text-[10px] text-arc-green border border-arc-green/40 rounded px-2.5 py-1 flex items-center gap-1.5 hover:border-arc-green transition-colors"
              >
                <span>🦊</span>
                <span>{walletAddr.slice(0, 6)}…{walletAddr.slice(-4)}</span>
              </button>
            ) : (
              <button
                onClick={connect}
                className="font-mono text-[10px] text-arc-muted border border-arc-border rounded px-2.5 py-1 flex items-center gap-1.5 hover:border-arc-green hover:text-arc-green transition-colors"
              >
                <span>🦊</span>
                <span className="hidden sm:inline">Connect Wallet</span>
              </button>
            )}
            {addrShort && !walletAddr && (
              <span className="font-mono text-[10px] text-arc-muted border border-arc-border/50 rounded px-2.5 py-1 select-all cursor-text">
                {addrShort}
              </span>
            )}
            <button
              onClick={() => goTab('account')}
              className="font-mono text-[10px] text-arc-sub border border-arc-border rounded px-3 py-1.5 hover:border-arc-green hover:text-arc-green transition-colors"
            >
              {employerName || 'Account'}
            </button>
          </div>
        </div>
      </nav>

      {/* Tab bar */}
      <div className="border-b border-arc-border bg-arc-surface">
        <div className="max-w-6xl mx-auto px-6 flex overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => goTab(t.id)}
              className={`px-6 py-4 flex flex-col gap-0.5 border-b-2 transition-all flex-shrink-0 ${
                tab === t.id
                  ? 'border-arc-green text-white'
                  : 'border-transparent text-arc-muted hover:text-arc-sub'
              }`}
            >
              <span className="font-mono text-xs font-semibold tracking-wide">{t.label}</span>
              <span className="font-mono text-[9px] text-arc-muted">{t.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        {tab === 'marketplace' && <MarketplaceTab onHire={handleHire} />}
        {tab === 'post'        && (
          <PostTaskTab
            preselectedAgent={preselectedAgent}
            onTaskPosted={(taskId) => { setLiveTaskId(taskId); setRefreshKey(k => k + 1); goTab('jobs') }}
          />
        )}
        {tab === 'jobs'        && <ActiveJobsTab key={refreshKey} liveTaskId={liveTaskId} onStreamDone={() => setLiveTaskId('')} />}
        {tab === 'receipts'    && <ReceiptsTab />}
        {tab === 'account'     && <AccountTab onSignOut={() => navigate('/onboard')} />}
      </main>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function GmailIcon({ className = 'text-arc-sub' }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 ${className}`} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
    </svg>
  )
}

function SlackIcon({ className = 'text-arc-sub' }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 ${className}`} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
    </svg>
  )
}
