import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const API = import.meta.env.VITE_ARC_API_URL ?? 'http://localhost:8000'

interface Stats { totalJobsCompleted: number; usdcSettled: number; activeAgents: number }

// ── Live governance event stream ──────────────────────────────────────────────
const STREAM_EVENTS = [
  { type: 'SETTLED',   task: 'task_a3f2b1', agent: 'RiskAnalyst', usdc: '0.100', dur: '7,834ms', color: '#10b981' },
  { type: 'AUDITING',  task: 'task_c8d4e2', agent: 'Auditor',     usdc: '0.100', dur: '—',       color: '#a855f7' },
  { type: 'ESCROWED',  task: 'task_f1a9b3', agent: 'Settlement',  usdc: '0.100', dur: '—',       color: '#60a5fa' },
  { type: 'SLASHED',   task: 'task_d7c2a1', agent: 'Settlement',  usdc: '0.100', dur: '8,102ms', color: '#ef4444' },
  { type: 'DELEGATED', task: 'task_e4f8c3', agent: 'Director',    usdc: '0.100', dur: '—',       color: '#f59e0b' },
  { type: 'EXECUTING', task: 'task_b2d5e7', agent: 'RiskAnalyst', usdc: '0.100', dur: '—',       color: '#60a5fa' },
  { type: 'AUDITED',   task: 'task_a1b4c7', agent: 'Auditor',     usdc: '0.100', dur: '—',       color: '#a855f7' },
  { type: 'SETTLED',   task: 'task_f3e2d1', agent: 'RiskAnalyst', usdc: '0.100', dur: '8,456ms', color: '#10b981' },
  { type: 'REP +0.1',  task: 'task_a3f2b1', agent: 'RiskAnalyst', usdc: '—',     dur: '—',       color: '#10b981' },
  { type: 'ESCROWED',  task: 'task_b9c3d1', agent: 'Settlement',  usdc: '0.100', dur: '—',       color: '#60a5fa' },
]

// ── Pipeline stages ───────────────────────────────────────────────────────────
const PIPELINE = [
  { label: 'ESCROW',       sub: 'Capital locked on-chain',   color: '#60a5fa', dim: 'rgba(96,165,250,0.1)'   },
  { label: 'DIRECTOR',     sub: 'Brief structured',           color: '#f59e0b', dim: 'rgba(245,158,11,0.1)'   },
  { label: 'RISK ANALYST', sub: 'Swarms workflow executed',   color: '#60a5fa', dim: 'rgba(96,165,250,0.1)'   },
  { label: 'AUDITOR',      sub: '7-check governance gate',    color: '#a855f7', dim: 'rgba(168,85,247,0.1)'   },
  { label: 'SETTLEMENT',   sub: 'USDC released or slashed',   color: '#10b981', dim: 'rgba(16,185,129,0.1)'   },
]

// ── Operational agents ────────────────────────────────────────────────────────
const AGENTS = [
  {
    name:        'Risk Analyst',
    specialty:   'Governed Financial Intelligence',
    status:      'EXECUTING',
    statusColor: '#60a5fa',
    rep:         9.2,
    jobs:        847,
    earned:      '84.7',
    tags:        ['protocol analysis', 'treasury evaluation', 'risk scoring', 'governance-aware execution'],
    accent:      '#60a5fa',
  },
  {
    name:        'Director',
    specialty:   'Task Structuring & Delegation',
    status:      'ACTIVE',
    statusColor: '#10b981',
    rep:         9.6,
    jobs:        1203,
    earned:      '120.3',
    tags:        ['task briefing', 'scope definition', 'governed delegation', 'workflow routing'],
    accent:      '#f59e0b',
  },
  {
    name:        'Auditor',
    specialty:   'Governance Validation',
    status:      'AUDITING',
    statusColor: '#a855f7',
    rep:         10.0,
    jobs:        847,
    earned:      '8.5',
    tags:        ['SLA compliance', '7-check audit', 'slash enforcement', 'reputation scoring'],
    accent:      '#a855f7',
  },
]

// ── Scrolling governance stream component ─────────────────────────────────────
function GovernanceStream() {
  const doubled = [...STREAM_EVENTS, ...STREAM_EVENTS]
  return (
    <div
      className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-black/60 backdrop-blur-sm"
      style={{ height: 220 }}
    >
      {/* top/bottom fade */}
      <div className="absolute inset-x-0 top-0 h-8 z-10 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.9), transparent)' }} />
      <div className="absolute inset-x-0 bottom-0 h-8 z-10 pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)' }} />

      <div className="stream-scroll px-4 pt-2 pb-2 flex flex-col gap-1.5">
        {doubled.map((e, i) => (
          <div key={i} className="flex items-center gap-3 font-mono text-[10px] leading-none py-1.5 border-b border-white/[0.04]">
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: e.color, boxShadow: `0 0 6px ${e.color}` }}
            />
            <span className="w-[74px] flex-shrink-0 font-semibold" style={{ color: e.color }}>{e.type}</span>
            <span className="text-white/30 w-[84px] flex-shrink-0 truncate">{e.task}</span>
            <span className="text-white/50 flex-shrink-0">{e.agent}</span>
            <span className="ml-auto text-white/25 flex-shrink-0">{e.usdc !== '—' ? `${e.usdc} USDC` : ''}</span>
            <span className="text-white/20 w-16 text-right flex-shrink-0">{e.dur}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Pipeline visualization ────────────────────────────────────────────────────
function PipelineViz() {
  const [active, setActive] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setActive(a => (a + 1) % PIPELINE.length), 1400)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex items-center justify-center gap-0 w-full overflow-x-auto py-2">
      {PIPELINE.map((stage, i) => (
        <div key={stage.label} className="flex items-center flex-shrink-0">
          {/* Stage node */}
          <div
            className="relative flex flex-col items-center gap-2.5 px-4 py-3.5 rounded-xl border transition-all duration-500"
            style={{
              borderColor: active === i ? stage.color : 'rgba(255,255,255,0.07)',
              background:  active === i ? stage.dim : 'rgba(255,255,255,0.02)',
              boxShadow:   active === i ? `0 0 24px ${stage.color}30` : 'none',
              minWidth: 120,
            }}
          >
            {/* Active pulse */}
            {active === i && (
              <span
                className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 rounded-full"
                style={{ background: stage.color, boxShadow: `0 0 8px ${stage.color}` }}
              />
            )}
            <span className="font-mono text-[9px] tracking-[0.15em] font-bold"
              style={{ color: active === i ? stage.color : 'rgba(255,255,255,0.3)' }}>
              {stage.label}
            </span>
            <span className="font-mono text-[9px] text-center leading-snug"
              style={{ color: active === i ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)' }}>
              {stage.sub}
            </span>
          </div>
          {/* Connector */}
          {i < PIPELINE.length - 1 && (
            <div className="relative w-10 flex-shrink-0 h-px mx-1" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div
                className="pipeline-dot absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
                style={{
                  background: PIPELINE[i + 1].color,
                  boxShadow: `0 0 6px ${PIPELINE[i + 1].color}`,
                  animationDelay: `${i * 0.7}s`,
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Operational agent card ────────────────────────────────────────────────────
function AgentCard({ agent }: { agent: typeof AGENTS[0] }) {
  return (
    <div
      className="flex flex-col gap-5 rounded-2xl border p-5 transition-all duration-300 hover:scale-[1.01] cursor-default"
      style={{
        background:   `radial-gradient(ellipse at 0% 0%, ${agent.accent}08 0%, transparent 60%), rgba(255,255,255,0.02)`,
        borderColor:  'rgba(255,255,255,0.07)',
        boxShadow:    `inset 0 1px 0 rgba(255,255,255,0.06)`,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="font-mono text-sm font-bold text-white">{agent.name}</div>
          <div className="font-mono text-[10px]" style={{ color: agent.accent }}>{agent.specialty}</div>
        </div>
        <div
          className="flex items-center gap-1.5 rounded-full px-2 py-1 flex-shrink-0"
          style={{ background: `${agent.statusColor}18`, border: `1px solid ${agent.statusColor}30` }}
        >
          <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: agent.statusColor }} />
          <span className="font-mono text-[9px] font-semibold tracking-wide" style={{ color: agent.statusColor }}>
            {agent.status}
          </span>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5">
        {agent.tags.map(t => (
          <span key={t} className="font-mono text-[9px] px-2 py-0.5 rounded border"
            style={{ color: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
            {t}
          </span>
        ))}
      </div>

      {/* Stats */}
      <div className="border-t pt-4 grid grid-cols-3 gap-2" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="flex flex-col gap-1">
          <div className="font-mono text-[8px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.25)' }}>Reputation</div>
          <div className="font-mono text-base font-bold" style={{ color: agent.accent }}>{agent.rep.toFixed(1)}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="font-mono text-[8px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.25)' }}>Governed Jobs</div>
          <div className="font-mono text-base font-bold text-white">{agent.jobs.toLocaleString()}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="font-mono text-[8px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.25)' }}>USDC Earned</div>
          <div className="font-mono text-base font-bold text-white">{agent.earned}</div>
        </div>
      </div>

      {/* Reputation bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between font-mono text-[9px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
          <span>Governance score</span><span>{agent.rep.toFixed(1)} / 10</span>
        </div>
        <div className="h-0.5 rounded-full w-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${agent.rep * 10}%`, background: `linear-gradient(to right, ${agent.accent}, ${agent.accent}aa)` }} />
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const navigate       = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch(`${API}/api/analytics`)
      .then(r => r.json())
      .then(d => setStats(d.metrics))
      .catch(() => null)
  }, [])

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">

      {/* CSS */}
      <style>{`
        @keyframes stream-up {
          0%   { transform: translateY(0); }
          100% { transform: translateY(-50%); }
        }
        .stream-scroll { animation: stream-up 28s linear infinite; }
        @keyframes dot-travel {
          0%   { left: -4px;         opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { left: calc(100% + 4px); opacity: 0; }
        }
        .pipeline-dot { animation: dot-travel 2.8s ease-in-out infinite; position: absolute; }
        @keyframes float-in {
          from { opacity: 0; transform: translateY(28px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .float-in-0 { animation: float-in 0.7s cubic-bezier(0.16,1,0.3,1) both; }
        .float-in-1 { animation: float-in 0.7s cubic-bezier(0.16,1,0.3,1) 0.1s both; }
        .float-in-2 { animation: float-in 0.7s cubic-bezier(0.16,1,0.3,1) 0.2s both; }
        .float-in-3 { animation: float-in 0.7s cubic-bezier(0.16,1,0.3,1) 0.35s both; }
        .float-in-4 { animation: float-in 0.7s cubic-bezier(0.16,1,0.3,1) 0.5s both; }
      `}</style>

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="border-b sticky top-0 z-50 backdrop-blur-md"
        style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.85)' }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="16" height="20" viewBox="0 0 16 20" fill="none" className="text-arc-green flex-shrink-0">
              <path d="M5.5 1.5h5M6 1.5v5.2L1.2 14.8A2.5 2.5 0 003.5 18.5h9a2.5 2.5 0 002.3-3.7L10 6.7V1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="6.2" cy="14.5" r="0.9" fill="currentColor"/>
              <circle cx="9.4" cy="12.8" r="0.65" fill="currentColor"/>
            </svg>
            <span className="font-mono font-bold text-sm tracking-[0.2em]">BREWING</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full"
              style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-arc-green pulse-dot" />
              <span className="font-mono text-[10px] text-arc-green tracking-wide">Arc Testnet Live</span>
            </div>
            <button onClick={() => navigate('/onboard')}
              className="font-mono text-xs px-4 py-2 rounded-lg transition-colors"
              style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}
              onMouseEnter={e => { (e.target as HTMLElement).style.color = '#fff'; (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.3)' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color = 'rgba(255,255,255,0.5)'; (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)' }}
            >
              Sign In
            </button>
            <button onClick={() => navigate('/onboard')}
              className="font-mono font-semibold text-xs px-4 py-2 rounded-lg transition-colors"
              style={{ background: '#10b981', color: '#000' }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = '#34d399' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = '#10b981' }}
            >
              Launch Workflow →
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden" style={{ minHeight: '92vh' }}>
        {/* Atmospheric glow */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% 110%, rgba(16,185,129,0.13) 0%, transparent 60%)' }} />
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 20% 50%, rgba(96,165,250,0.05) 0%, transparent 50%)' }} />

        <div className="relative max-w-6xl mx-auto px-6 flex flex-col" style={{ paddingTop: '5rem', paddingBottom: '5rem', gap: '3rem' }}>

          {/* Status bar */}
          <div className="float-in-0 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 rounded-full px-3 py-1.5"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="font-mono text-[10px] tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
                POWERED BY SWARMS
              </span>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
            <div className="flex items-center gap-2 rounded-full px-3 py-1.5"
              style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
              <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: '#10b981' }} />
              <span className="font-mono text-[10px] text-arc-green tracking-widest">3 WORKFLOWS ACTIVE</span>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
            <div className="flex items-center gap-2 rounded-full px-3 py-1.5"
              style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)' }}>
              <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: '#a855f7' }} />
              <span className="font-mono text-[10px] tracking-widest" style={{ color: '#a855f7' }}>1 AUDITING</span>
            </div>
          </div>

          {/* Headline + stream */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="flex flex-col gap-8">
              <div className="float-in-1 flex flex-col gap-4">
                <h1 className="font-bold leading-[1.05] tracking-tight" style={{ fontSize: 'clamp(2.4rem, 5vw, 3.6rem)' }}>
                  Autonomous execution<br />
                  <span style={{ color: '#10b981' }}>governed by Brewing.</span>
                </h1>
                <p className="font-mono text-base leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)', maxWidth: 440 }}>
                  AI agents can coordinate and generate outputs. The missing layer is accountability.
                  Brewing enforces it — economically, on-chain, in real time.
                </p>
              </div>

              {/* CTA row */}
              <div className="float-in-2 flex gap-3 flex-wrap">
                <button onClick={() => navigate('/onboard')}
                  className="font-mono font-semibold text-sm px-7 py-3.5 rounded-xl transition-all"
                  style={{ background: '#10b981', color: '#000', boxShadow: '0 0 32px rgba(16,185,129,0.3)' }}
                  onMouseEnter={e => { (e.target as HTMLElement).style.boxShadow = '0 0 48px rgba(16,185,129,0.5)' }}
                  onMouseLeave={e => { (e.target as HTMLElement).style.boxShadow = '0 0 32px rgba(16,185,129,0.3)' }}
                >
                  Launch Governed Workflow →
                </button>
                <button onClick={() => navigate('/dashboard')}
                  className="font-mono text-sm px-7 py-3.5 rounded-xl transition-all"
                  style={{ color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.1)' }}
                  onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.25)'; (e.target as HTMLElement).style.color = '#fff' }}
                  onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.target as HTMLElement).style.color = 'rgba(255,255,255,0.55)' }}
                >
                  View Live Governance →
                </button>
              </div>

              {/* Stats */}
              {stats && (
                <div className="float-in-3 flex items-center gap-6 pt-2">
                  {[
                    { v: stats.totalJobsCompleted, l: 'Governed Jobs' },
                    { v: `$${stats.usdcSettled.toFixed(2)}`, l: 'USDC Settled' },
                    { v: stats.activeAgents, l: 'Active Agents' },
                  ].map(s => (
                    <div key={s.l} className="flex flex-col gap-0.5">
                      <span className="font-mono text-xl font-bold text-white">{s.v}</span>
                      <span className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{s.l}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Live governance stream panel */}
            <div className="float-in-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full pulse-dot bg-arc-green" />
                  <span className="font-mono text-[10px] text-arc-green tracking-widest">LIVE GOVERNANCE STREAM</span>
                </div>
                <span className="font-mono text-[9px]" style={{ color: 'rgba(255,255,255,0.2)' }}>Arc Testnet</span>
              </div>
              <GovernanceStream />
              <div className="flex items-center gap-4 font-mono text-[9px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
                {[['#10b981','SETTLED'],['#a855f7','AUDITING'],['#ef4444','SLASHED'],['#f59e0b','DELEGATED'],['#60a5fa','EXECUTING']].map(([c,l]) => (
                  <div key={l} className="flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full" style={{ background: c as string }} />
                    <span>{l}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Pipeline ────────────────────────────────────────────────────────── */}
      <div className="relative" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}>
        <div className="max-w-6xl mx-auto px-6 py-20 flex flex-col gap-10">
          <div className="flex flex-col gap-2">
            <div className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.25)' }}>
              The Governance Pipeline
            </div>
            <p className="font-mono text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Every workflow passes through five enforced stages. No stage can be skipped. No payment before audit.
            </p>
          </div>
          <PipelineViz />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-2">
            {PIPELINE.map((s, i) => (
              <div key={s.label} className="flex flex-col gap-1.5">
                <span className="font-mono text-[9px] font-bold tracking-widest" style={{ color: s.color }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-[11px] text-white font-semibold">{s.label}</span>
                <span className="font-mono text-[10px] leading-snug" style={{ color: 'rgba(255,255,255,0.3)' }}>{s.sub}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Live Agents ─────────────────────────────────────────────────────── */}
      <div className="relative" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="max-w-6xl mx-auto px-6 py-20 flex flex-col gap-10">
          <div className="flex items-end justify-between">
            <div className="flex flex-col gap-2">
              <div className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.25)' }}>
                Operational Agents
              </div>
              <p className="font-mono text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Governed, audited, economically active.
              </p>
            </div>
            <button onClick={() => navigate('/dashboard')}
              className="font-mono text-[11px] transition-colors"
              style={{ color: '#10b981' }}
            >
              View all agents →
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {AGENTS.map(agent => <AgentCard key={agent.name} agent={agent} />)}
          </div>
        </div>
      </div>

      {/* ── Enforcement ─────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 100% 50%, rgba(168,85,247,0.06) 0%, transparent 55%)' }} />
        <div className="relative max-w-6xl mx-auto px-6 py-24 grid grid-cols-1 md:grid-cols-2 gap-16 items-center">

          {/* Problem */}
          <div className="flex flex-col gap-6">
            <div className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.2)' }}>Without enforcement</div>
            <h2 className="font-bold text-3xl leading-tight" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Autonomous coordination<br />fails at scale.
            </h2>
            <div className="flex flex-col gap-3">
              {['No guarantee of output quality', 'No consequence for failure', 'No audit trail', 'No economic accountability'].map(t => (
                <div key={t} className="flex items-center gap-3 font-mono text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  <span className="text-red-500/60 text-xs flex-shrink-0">✗</span>
                  {t}
                </div>
              ))}
            </div>
          </div>

          {/* Solution */}
          <div className="flex flex-col gap-6">
            <div className="font-mono text-[10px] tracking-widest uppercase" style={{ color: '#10b981' }}>With Brewing</div>
            <h2 className="font-bold text-3xl leading-tight text-white">
              Economically enforced<br />execution scales.
            </h2>
            <div className="flex flex-col gap-3">
              {['7-check governance audit before settlement', 'Escrow slashes on failure — funds returned', 'Persistent on-chain reputation', 'Every stage delegated, audited, verified'].map(t => (
                <div key={t} className="flex items-center gap-3 font-mono text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  <span className="text-arc-green text-xs flex-shrink-0">✓</span>
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Built With ──────────────────────────────────────────────────────── */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="max-w-6xl mx-auto px-6 py-14 flex flex-col gap-6 items-center">
          <div className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.2)' }}>Built With</div>
          <div className="flex flex-wrap items-center justify-center gap-8">
            {[
              { label: 'SWARMS',      sub: 'Multi-Agent Orchestration',  color: '#10b981' },
              { label: 'CLAUDE',      sub: 'Reasoning + Coordination',    color: 'rgba(255,255,255,0.5)' },
              { label: 'CIRCLE USDC', sub: 'Programmable Settlement',     color: 'rgba(255,255,255,0.5)' },
              { label: 'ARC L1',      sub: 'On-Chain Escrow + Finality',  color: 'rgba(255,255,255,0.5)' },
            ].map((b, i) => (
              <div key={b.label} className="flex items-center gap-8">
                <div className="flex flex-col items-center gap-1">
                  <span className="font-mono text-sm font-bold tracking-wider" style={{ color: b.color }}>{b.label}</span>
                  <span className="font-mono text-[9px]" style={{ color: 'rgba(255,255,255,0.2)' }}>{b.sub}</span>
                </div>
                {i < 3 && <span style={{ color: 'rgba(255,255,255,0.1)' }}>·</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Footer CTA ──────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(16,185,129,0.1) 0%, transparent 55%)' }} />
        <div className="relative max-w-6xl mx-auto px-6 py-28 flex flex-col items-center gap-7 text-center">
          <div className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.2)' }}>
            The Trust Layer for Autonomous Systems
          </div>
          <h2 className="font-bold leading-tight" style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', maxWidth: 560 }}>
            AI orchestration alone<br />is not enough.
          </h2>
          <p className="font-mono text-base" style={{ color: '#10b981', fontWeight: 600 }}>
            Brewing governs autonomous execution.
          </p>
          <button onClick={() => navigate('/onboard')}
            className="font-mono font-semibold text-sm px-10 py-4 rounded-xl transition-all mt-3"
            style={{ background: '#10b981', color: '#000', boxShadow: '0 0 48px rgba(16,185,129,0.25)' }}
            onMouseEnter={e => { (e.target as HTMLElement).style.boxShadow = '0 0 64px rgba(16,185,129,0.45)' }}
            onMouseLeave={e => { (e.target as HTMLElement).style.boxShadow = '0 0 48px rgba(16,185,129,0.25)' }}
          >
            Run Governed Demo →
          </button>
        </div>
      </div>

    </div>
  )
}
