'use client'

import type { Settings } from '@/types'

interface SystemStatusBarProps {
  settings: Settings | null
  isRunning: boolean
  cycleCount: number
  lastRunAt: string | null
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never'
  try {
    const diff = Date.now() - new Date(isoString).getTime()
    const secs = Math.floor(diff / 1000)
    if (secs < 60) return `${secs}s ago`
    const mins = Math.floor(secs / 60)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  } catch {
    return 'Unknown'
  }
}

export default function SystemStatusBar({
  settings,
  isRunning,
  cycleCount,
  lastRunAt,
}: SystemStatusBarProps) {
  const status = isRunning ? 'working' : settings?.isLive ? 'online' : 'offline'
  const statusLabel = isRunning ? 'PROCESSING' : settings?.isLive ? 'LIVE' : 'STANDBY'
  const statusColor =
    status === 'working'
      ? '#F59E0B'
      : status === 'online'
      ? '#10B981'
      : '#6B6B80'

  return (
    <header
      style={{
        background: '#0D0D10',
        borderBottom: '1px solid #2A2A32',
        height: '52px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: '0',
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginRight: '24px' }}>
        <span
          style={{
            fontSize: '1.1rem',
            filter: 'drop-shadow(0 0 8px rgba(245, 158, 11, 0.7))',
          }}
        >
          ⚡
        </span>
        <span
          style={{
            color: '#F59E0B',
            fontSize: '0.9375rem',
            fontWeight: 800,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontFamily: "'JetBrains Mono', monospace",
            textShadow: '0 0 12px rgba(245, 158, 11, 0.4)',
          }}
        >
          DISCIPLES
        </span>
        <span
          style={{
            color: '#3A3A45',
            fontSize: '0.6rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            border: '1px solid #3A3A45',
            borderRadius: '3px',
            padding: '1px 5px',
          }}
        >
          v1.0
        </span>
      </div>

      {/* Separator */}
      <div style={{ width: '1px', height: '24px', background: '#2A2A32', marginRight: '24px' }} />

      {/* System status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginRight: '28px' }}>
        <span
          className={`status-dot ${status}`}
          style={{
            background: statusColor,
            boxShadow: status !== 'offline' ? `0 0 6px ${statusColor}` : 'none',
            animation: status === 'working' ? 'glow-pulse 1s ease-in-out infinite' : 'none',
          }}
        />
        <span
          style={{
            color: statusColor,
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Separator */}
      <div style={{ width: '1px', height: '24px', background: '#2A2A32', marginRight: '24px' }} />

      {/* Stats row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flex: 1 }}>
        {/* Cycle count */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <span className="label-xs">Cycles Run</span>
          <span
            style={{
              color: '#E8E8F0',
              fontSize: '0.8125rem',
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: 1,
            }}
          >
            {cycleCount.toString().padStart(4, '0')}
          </span>
        </div>

        {/* Last run */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <span className="label-xs">Last Run</span>
          <span
            style={{
              color: '#9CA3AF',
              fontSize: '0.75rem',
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: 1,
            }}
          >
            {formatRelativeTime(lastRunAt)}
          </span>
        </div>

        {/* Frequency */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <span className="label-xs">Frequency</span>
          <span
            style={{
              color: '#9CA3AF',
              fontSize: '0.75rem',
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: 1,
            }}
          >
            {settings?.scrapeFrequency ?? '—'}
          </span>
        </div>

        {/* Copywriter niches — A through E */}
        {settings && (() => {
          const writers = [
            { key: 'nicheA' as const, label: '⛩️ ANIME',       accent: '#EF4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.3)',   text: '#FCA5A5' },
            { key: 'nicheB' as const, label: '🧸 TOYS',         accent: '#F97316', bg: 'rgba(249,115,22,0.08)',  border: 'rgba(249,115,22,0.3)',  text: '#FDBA74' },
            { key: 'nicheC' as const, label: '📺 INFOTAINMENT', accent: '#38BDF8', bg: 'rgba(56,189,248,0.08)', border: 'rgba(56,189,248,0.3)',  text: '#7DD3FC' },
            { key: 'nicheD' as const, label: '🎮 GAME',         accent: '#A855F7', bg: 'rgba(168,85,247,0.08)', border: 'rgba(168,85,247,0.3)', text: '#D8B4FE' },
            { key: 'nicheE' as const, label: '💥 COMIC',        accent: '#EAB308', bg: 'rgba(234,179,8,0.08)',  border: 'rgba(234,179,8,0.3)',  text: '#FDE047' },
          ]
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {writers.map(({ key, label, accent, bg, border, text }) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span className="label-xs" style={{ color: accent, fontSize: '0.42rem' }}>{label}</span>
                  <span
                    style={{
                      background: bg,
                      border: `1px solid ${border}`,
                      color: text,
                      fontSize: '0.575rem',
                      fontWeight: 600,
                      letterSpacing: '0.03em',
                      borderRadius: '4px',
                      padding: '2px 7px',
                      fontFamily: "'JetBrains Mono', monospace",
                      maxWidth: '120px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'block',
                    }}
                    title={settings[key] || settings.targetNiche || '—'}
                  >
                    {settings[key] || settings.targetNiche || '—'}
                  </span>
                </div>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Right — review required badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {settings?.requireReview && (
          <span
            style={{
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              color: '#F59E0B',
              fontSize: '0.5625rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              borderRadius: '4px',
              padding: '3px 8px',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            MANUAL REVIEW ON
          </span>
        )}
        <span
          style={{
            color: '#374151',
            fontSize: '0.625rem',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          SYNTHETIC NEWSROOM
        </span>
      </div>
    </header>
  )
}
