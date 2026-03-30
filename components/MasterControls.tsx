'use client'

import { useState, useEffect } from 'react'
import type { Settings } from '@/types'

interface MasterControlsProps {
  settings: Settings
  onUpdate: (s: Partial<Settings>) => void
  onTrigger: () => void
  isRunning: boolean
}

export default function MasterControls({
  settings,
  onUpdate,
  onTrigger,
  isRunning,
}: MasterControlsProps) {
  const [triggering, setTriggering] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [aborting, setAborting] = useState(false)

  const handleTrigger = async () => {
    if (isRunning || triggering) return
    setTriggering(true)
    try {
      await onTrigger()
    } finally {
      setTimeout(() => setTriggering(false), 2000)
    }
  }

  const handleLiveToggle = async () => {
    if (toggling) return
    setToggling(true)
    try {
      await onUpdate({ isLive: !settings.isLive })
    } finally {
      setToggling(false)
    }
  }

  const handleClearCache = async () => {
    if (clearing) return
    setClearing(true)
    try {
      const res = await fetch('/api/dedup/clear', { method: 'POST' })
      if (res.ok) {
        setCleared(true)
        setTimeout(() => setCleared(false), 2500)
      }
    } finally {
      setClearing(false)
    }
  }

  const handleAbort = async () => {
    if (aborting || !isRunning) return
    setAborting(true)
    try {
      await fetch('/api/process-news/abort', { method: 'POST' })
    } catch (err) {
      console.error(err)
      setAborting(false)
    }
  }

  // Clear transient loading states when background process stops organically or forced
  useEffect(() => {
    if (!isRunning) {
      if (aborting) setAborting(false)
      if (triggering) setTriggering(false)
    }
  }, [isRunning, aborting, triggering])

  return (
    <div
      style={{
        background: '#0D0D10',
        border: '1px solid #2A2A32',
        borderRadius: '8px',
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: '24px',
        flexWrap: 'wrap',
      }}
    >
      {/* Section label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginRight: '4px' }}>
        <span style={{ fontSize: '1rem' }}>⚙️</span>
        <span
          style={{
            color: '#6B6B80',
            fontSize: '0.625rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          CONTROLS
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '28px', background: '#2A2A32' }} />

      {/* Scrape frequency */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label
          style={{
            color: '#6B6B80',
            fontSize: '0.5625rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          SCRAPE FREQUENCY
        </label>
        <select
          className="newsroom-select"
          value={settings.scrapeFrequency}
          onChange={(e) => onUpdate({ scrapeFrequency: e.target.value as Settings['scrapeFrequency'] })}
          style={{ minWidth: '90px' }}
        >
          <option value="10s">Every 10s (demo)</option>
          <option value="1h">Every 1h</option>
          <option value="4h">Every 4h</option>
          <option value="12h">Every 12h</option>
          <option value="24h">Every 24h</option>
        </select>
      </div>

      {/* Require manual review toggle */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label
          style={{
            color: '#6B6B80',
            fontSize: '0.5625rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          REQUIRE MANUAL REVIEW
        </label>
        <label className="toggle-switch" style={{ cursor: 'pointer' }}>
          <div
            className={`toggle-track ${settings.requireReview ? 'active' : ''}`}
            onClick={() => onUpdate({ requireReview: !settings.requireReview })}
            role="switch"
            aria-checked={settings.requireReview}
            tabIndex={0}
            onKeyDown={(e) => e.key === ' ' && onUpdate({ requireReview: !settings.requireReview })}
          >
            <div className={`toggle-thumb ${settings.requireReview ? 'active' : ''}`} />
          </div>
          <span
            style={{
              marginLeft: '8px',
              fontSize: '0.6875rem',
              fontWeight: 600,
              color: settings.requireReview ? '#F59E0B' : '#6B6B80',
              transition: 'color 0.2s ease',
            }}
          >
            {settings.requireReview ? 'ON' : 'OFF'}
          </span>
        </label>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '28px', background: '#2A2A32' }} />

      {/* GO LIVE / STOP button */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span
          style={{
            color: '#6B6B80',
            fontSize: '0.5625rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          PIPELINE STATE
        </span>
        <button
          onClick={handleLiveToggle}
          disabled={toggling}
          className={settings.isLive ? 'btn-danger' : 'btn-primary'}
          style={{
            minWidth: '90px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          {settings.isLive ? (
            <>
              <span style={{ fontSize: '0.75rem' }}>■</span>
              STOP
            </>
          ) : (
            <>
              <span style={{ fontSize: '0.75rem' }}>▶</span>
              GO LIVE
            </>
          )}
        </button>
      </div>

      {/* RUN NOW button */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span
          style={{
            color: '#6B6B80',
            fontSize: '0.5625rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          MANUAL TRIGGER
        </span>
        {isRunning || triggering ? (
          <button
            onClick={handleAbort}
            disabled={aborting}
            className="btn-secondary"
            title="Force terminate the current pipeline cycle"
            style={{
              minWidth: '100px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              borderColor: aborting ? '#2A2A32' : 'rgba(239,68,68,0.35)',
              color: aborting ? '#374151' : '#EF4444',
              transition: 'all 0.2s ease',
            }}
          >
            {aborting ? (
              <><span style={{ fontSize: '0.75rem' }}>⟳</span> ABORTING…</>
            ) : (
              <><span style={{ fontSize: '0.75rem' }}>🛑</span> KILL PROCESS</>
            )}
          </button>
        ) : (
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="btn-secondary"
            style={{
              minWidth: '100px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              borderColor: 'rgba(245, 158, 11, 0.4)',
              color: '#F59E0B',
            }}
          >
            <><span style={{ fontSize: '0.75rem' }}>⚡</span> RUN NOW</>
          </button>
        )}
      </div>

      {/* CLEAR CACHE button */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span
          style={{
            color: '#6B6B80',
            fontSize: '0.5625rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          DEDUP CACHE
        </span>
        <button
          onClick={handleClearCache}
          disabled={clearing || isRunning}
          className="btn-secondary"
          title="Clear the seen-URL cache so the next run reprocesses available articles"
          style={{
            minWidth: '110px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            borderColor: cleared
              ? 'rgba(16,185,129,0.5)'
              : clearing
              ? '#2A2A32'
              : 'rgba(239,68,68,0.35)',
            color: cleared ? '#10B981' : clearing ? '#374151' : '#EF4444',
            transition: 'all 0.2s ease',
          }}
        >
          {cleared ? (
            <><span style={{ fontSize: '0.75rem' }}>✓</span> CLEARED</>
          ) : clearing ? (
            <><span style={{ fontSize: '0.75rem' }}>⟳</span> CLEARING…</>
          ) : (
            <><span style={{ fontSize: '0.75rem' }}>🗑</span> CLEAR CACHE</>
          )}
        </button>
      </div>

      {/* Right side — all 5 copywriter niches */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
        {([
          { icon: '⛩️', label: 'ANIME',        niche: settings.nicheA, accent: '#EF4444' },
          { icon: '🧸', label: 'TOYS',          niche: settings.nicheB, accent: '#F97316' },
          { icon: '📺', label: 'INFOTAINMENT',  niche: settings.nicheC, accent: '#38BDF8' },
          { icon: '🎮', label: 'GAME',          niche: settings.nicheD, accent: '#A855F7' },
          { icon: '💥', label: 'COMIC',         niche: settings.nicheE, accent: '#EAB308' },
        ] as const).map(({ icon, label, niche, accent }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
            <span
              style={{
                color: '#4B5563',
                fontSize: '0.42rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: 'nowrap',
              }}
            >
              {icon} {label}
            </span>
            <span
              style={{
                color: niche ? accent : '#374151',
                fontSize: '0.6rem',
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                maxWidth: '110px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                background: niche ? `${accent}12` : 'transparent',
                border: `1px solid ${niche ? `${accent}35` : '#2A2A32'}`,
                borderRadius: '4px',
                padding: '2px 6px',
              }}
              title={niche || settings.targetNiche || 'Not set'}
            >
              {niche || (settings.targetNiche ? `↳ ${settings.targetNiche}` : 'Not set')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
