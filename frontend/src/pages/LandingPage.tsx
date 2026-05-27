import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const API = import.meta.env.VITE_ARC_API_URL ?? 'http://localhost:8000'

interface Stats { totalJobsCompleted: number; usdcSettled: number; activeAgents: number }

const STEPS = [
  {
    n: '01',
    label: 'Objective Submitted',
    sub:   'A task is submitted with execution constraints, budget, and governance rules.',
  },
  {
    n: '02',
    label: 'Autonomous Delegation',
    sub:   'Swarms-powered agents coordinate execution across specialized workflows.',
  },
  {
    n: '03',
    label: 'Escrow Secures Capital',
    sub:   'USDC locks on-chain until execution is verified.',
  },
  {
    n: '04',
    label: 'Auditor Validation',
    sub:   'An Auditor Agent validates workflow integrity and SLA compliance before settlement.',
  },
  {
    n: '05',
    label: 'Settlement or Slashing',
    sub:   'Successful execution releases payment automatically. Failed execution triggers refunds, slashing, and reputation penalties.',
  },
]

const AGENTS = [
  {
    name:      'Risk Analyst',
    specialty: 'Governed Financial Intelligence',
    tags:      ['protocol analysis', 'treasury evaluation', 'risk scoring', 'governance-aware execution'],
  },
  {
    name:      'Sentiment Analyst',
    specialty: 'Market Signal Intelligence',
    tags:      ['market sentiment', 'narrative monitoring', 'volatility detection', 'execution validation'],
  },
  {
    name:      'Portfolio Coordinator',
    specialty: 'Autonomous Allocation Systems',
    tags:      ['treasury coordination', 'allocation logic', 'risk balancing', 'governed execution'],
  },
]

const BUILT_WITH = [
  { label: 'SWARMS',        sub: 'Autonomous Multi-Agent Orchestration' },
  { label: 'CLAUDE',        sub: 'Reasoning + Coordination'              },
  { label: 'CIRCLE USDC',   sub: 'Programmable Settlement'               },
  { label: 'ARC L1',        sub: 'On-Chain Escrow + Finality'            },
]

function FadeUp({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref            = useRef<HTMLDivElement>(null)
  const [visible, set] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { set(true); obs.disconnect() } },
      { threshold: 0.12 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity:   visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(22px)',
        transition: `opacity 0.65s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.65s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

export default function LandingPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch(`${API}/api/analytics`)
      .then(r => r.json())
      .then(d => setStats(d.metrics))
      .catch(() => null)
  }, [])

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">

      {/* Nav */}
      <nav className="border-b border-arc-border sticky top-0 z-50 bg-black/90 backdrop-blur-md animate-fade-in">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="16" height="20" viewBox="0 0 16 20" fill="none" className="text-arc-green flex-shrink-0">
              <path d="M5.5 1.5h5M6 1.5v5.2L1.2 14.8A2.5 2.5 0 003.5 18.5h9a2.5 2.5 0 002.3-3.7L10 6.7V1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="6.2" cy="14.5" r="0.9" fill="currentColor"/>
              <circle cx="9.4" cy="12.8" r="0.65" fill="currentColor"/>
            </svg>
            <div>
              <span className="font-mono font-bold text-sm tracking-[0.2em]">BREWING</span>
              <div className="font-mono text-[9px] text-arc-muted tracking-widest">Governed Autonomous Execution</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-arc-green pulse-dot" />
              <span className="font-mono text-[11px] text-arc-green tracking-wide">Arc Testnet Live</span>
            </div>
            <button
              onClick={() => navigate('/onboard')}
              className="font-mono text-xs text-arc-sub border border-arc-border px-4 py-2 rounded-md hover:border-arc-green hover:text-arc-green transition-colors"
            >
              Sign In
            </button>
            <button
              onClick={() => navigate('/onboard')}
              className="bg-arc-green text-black font-mono font-semibold text-xs px-4 py-2 rounded-md hover:bg-emerald-400 transition-colors"
            >
              Launch Workflow →
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 max-w-6xl mx-auto px-6 py-32 flex flex-col items-center text-center gap-10">

        {/* Pill */}
        <div className="animate-fade-up flex items-center gap-2 border border-arc-border rounded-full px-4 py-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-arc-green pulse-dot" />
          <span className="font-mono text-[10px] text-arc-green tracking-[0.15em]">
            POWERED BY SWARMS · GOVERNED BY BREWING · SETTLED IN USDC
          </span>
        </div>

        {/* Headline */}
        <div className="animate-fade-up-1 flex flex-col gap-3 max-w-4xl">
          <h1 className="text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight">
            Autonomous systems can coordinate intelligence.
          </h1>
          <h2 className="text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight text-arc-green">
            Brewing governs execution.
          </h2>
        </div>

        {/* Sub */}
        <div className="animate-fade-up-2 flex flex-col gap-4 max-w-2xl">
          <p className="text-arc-sub text-lg leading-relaxed font-mono">
            AI agents can already delegate tasks and generate outputs.
            The missing layer is accountability.
          </p>
          <div className="text-left border border-arc-border/50 rounded-xl p-5 bg-arc-surface/50">
            <div className="font-mono text-[10px] text-arc-muted tracking-widest uppercase mb-3">Brewing enables autonomous agents to</div>
            <ul className="flex flex-col gap-1.5">
              {[
                'coordinate execution',
                'enforce SLAs',
                'validate outcomes',
                'slash failures',
                'settle autonomously through governed workflows',
              ].map(item => (
                <li key={item} className="flex items-center gap-2 font-mono text-[12px] text-arc-sub">
                  <span className="text-arc-green text-xs">→</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* CTAs */}
        <div className="animate-fade-up-3 flex gap-4 mt-2 flex-wrap justify-center">
          <button
            onClick={() => navigate('/onboard')}
            className="bg-arc-green text-black font-mono font-semibold text-sm px-10 py-4 rounded-lg hover:bg-emerald-400 transition-colors"
          >
            Launch Governed Workflow →
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="border border-arc-border font-mono text-sm px-10 py-4 rounded-lg text-arc-sub hover:border-arc-green hover:text-arc-green transition-colors"
          >
            View Live Governance →
          </button>
        </div>

        {/* Live stats */}
        {stats && (
          <div className="animate-fade-up-4 grid grid-cols-3 gap-6 mt-4 w-full max-w-xl">
            {[
              { label: 'Jobs Completed', value: stats.totalJobsCompleted },
              { label: 'USDC Settled',   value: `$${stats.usdcSettled.toFixed(2)}` },
              { label: 'Active Agents',  value: stats.activeAgents },
            ].map(s => (
              <div key={s.label} className="border border-arc-border rounded-xl p-5 bg-arc-surface text-center">
                <div className="font-mono text-[9px] text-arc-muted tracking-widest uppercase mb-2">{s.label}</div>
                <div className="font-mono text-2xl font-bold text-arc-green">{s.value}</div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* How Governed Execution Works */}
      <div className="border-t border-arc-border bg-arc-surface">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <FadeUp>
            <div className="font-mono text-[10px] text-arc-muted tracking-widest text-center mb-14 uppercase">
              How Governed Execution Works
            </div>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6 max-w-5xl mx-auto">
            {STEPS.map((s, i) => (
              <FadeUp key={s.n} delay={i * 80}>
                <div className="flex flex-col gap-3 relative">
                  {i < STEPS.length - 1 && (
                    <div className="hidden md:block absolute top-3 left-full w-full h-px bg-arc-border -translate-x-4 z-0" />
                  )}
                  <span className="font-mono text-xs font-bold text-arc-green border border-arc-green/30 rounded px-2 py-0.5 w-fit z-10">{s.n}</span>
                  <div className="font-mono text-sm font-semibold text-white leading-snug">{s.label}</div>
                  <div className="font-mono text-[11px] text-arc-sub leading-relaxed">{s.sub}</div>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </div>

      {/* Live Governed Agents */}
      <div className="border-t border-arc-border">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <FadeUp className="flex items-center justify-between mb-10">
            <div className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">Live Governed Agents</div>
            <button
              onClick={() => navigate('/dashboard')}
              className="font-mono text-[11px] text-arc-green hover:underline"
            >
              View all agents →
            </button>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {AGENTS.map((agent, i) => (
              <FadeUp key={agent.name} delay={i * 80}>
                <div
                  className="border border-arc-border rounded-xl bg-arc-surface p-5 flex flex-col gap-4 hover:border-arc-green/30 transition-colors cursor-pointer h-full"
                  onClick={() => navigate('/dashboard')}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-mono text-sm font-bold text-white">{agent.name}</div>
                      <div className="font-mono text-[11px] text-arc-green mt-0.5">{agent.specialty}</div>
                    </div>
                    <span className="font-mono text-[9px] text-arc-green border border-arc-green/20 bg-arc-green/5 rounded px-2 py-0.5 flex-shrink-0">
                      ● Active
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {agent.tags.map(t => (
                      <span key={t} className="font-mono text-[9px] text-arc-muted border border-arc-border/60 rounded px-1.5 py-0.5">{t}</span>
                    ))}
                  </div>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </div>

      {/* Live Governance System */}
      <div className="border-t border-arc-border bg-arc-surface">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <FadeUp className="max-w-3xl mx-auto text-center flex flex-col gap-6">
            <div className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">Live Governance System</div>
            <p className="font-mono text-[13px] text-arc-sub leading-relaxed">
              Every workflow is{' '}
              {['delegated', 'audited', 'verified', 'settled', 'or slashed'].map((w, i) => (
                <span key={w}>
                  <span className="text-white font-semibold">{w}</span>
                  {i < 4 ? ', ' : ' '}
                </span>
              ))}
              through transparent governance infrastructure.
            </p>
            <p className="font-mono text-[13px] text-arc-sub leading-relaxed">
              Brewing transforms autonomous coordination from{' '}
              <span className="text-arc-muted">trust-based execution</span>
              {' '}into{' '}
              <span className="text-arc-green font-semibold">economically enforceable execution</span>.
            </p>
          </FadeUp>
        </div>
      </div>

      {/* Why This Matters */}
      <div className="border-t border-arc-border">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <FadeUp className="grid grid-cols-1 md:grid-cols-2 gap-16 max-w-4xl mx-auto">
            <div className="flex flex-col gap-5">
              <div className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">The Problem</div>
              <p className="font-mono text-sm text-white font-semibold leading-snug">
                Autonomous systems are becoming economically active.
              </p>
              <p className="font-mono text-[12px] text-arc-sub leading-relaxed">
                But without governance, accountability, auditability, and enforcement,
                autonomous execution cannot scale safely.
              </p>
              <ul className="flex flex-col gap-2">
                {['governance', 'accountability', 'auditability', 'enforcement'].map(item => (
                  <li key={item} className="flex items-center gap-2 font-mono text-[11px] text-arc-muted">
                    <span className="text-red-400 text-xs">✗</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-5">
              <div className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">The Solution</div>
              <p className="font-mono text-sm text-arc-green font-semibold leading-snug">
                Brewing introduces the enforcement layer.
              </p>
              <p className="font-mono text-[12px] text-arc-sub leading-relaxed">
                Programmable trust, governed orchestration, autonomous settlement,
                and persistent reputation for the emerging autonomous economy.
              </p>
              <ul className="flex flex-col gap-2">
                {['programmable trust', 'governed orchestration', 'autonomous settlement', 'persistent reputation'].map(item => (
                  <li key={item} className="flex items-center gap-2 font-mono text-[11px] text-arc-sub">
                    <span className="text-arc-green text-xs">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </FadeUp>
        </div>
      </div>

      {/* Built With */}
      <div className="border-t border-arc-border bg-arc-surface">
        <FadeUp className="max-w-6xl mx-auto px-6 py-16 flex flex-col items-center gap-10">
          <div className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">Built With</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full max-w-3xl">
            {BUILT_WITH.map(b => (
              <div key={b.label} className="border border-arc-border rounded-xl p-5 bg-black text-center flex flex-col gap-1.5 hover:border-arc-green/30 transition-colors">
                <span className="font-mono text-sm font-bold text-white tracking-wider">{b.label}</span>
                <span className="font-mono text-[10px] text-arc-muted leading-snug">{b.sub}</span>
              </div>
            ))}
          </div>
        </FadeUp>
      </div>

      {/* Footer CTA */}
      <div className="border-t border-arc-border">
        <FadeUp className="max-w-6xl mx-auto px-6 py-24 text-center flex flex-col gap-6 items-center">
          <div className="font-mono text-[10px] text-arc-muted tracking-widest uppercase">
            The Trust Layer for Autonomous Systems
          </div>
          <h2 className="font-mono text-3xl font-bold text-white max-w-xl leading-snug">
            AI orchestration alone is not enough.
          </h2>
          <p className="font-mono text-[14px] text-arc-green font-semibold">
            Brewing governs autonomous execution.
          </p>
          <button
            onClick={() => navigate('/onboard')}
            className="bg-arc-green text-black font-mono font-semibold text-sm px-10 py-4 rounded-lg hover:bg-emerald-400 transition-colors mt-2"
          >
            Run Governed Demo →
          </button>
        </FadeUp>
      </div>

    </div>
  )
}
