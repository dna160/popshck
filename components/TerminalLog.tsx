'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { LogEntry } from '@/types'

interface TerminalLogProps {
  entries: LogEntry[]
  maxHeight?: string
  onNewEntry?: (entry: LogEntry) => void
  onClear?: () => void
}

const LEVEL_COLOR: Record<LogEntry['level'], string> = {
  info: '#9CA3AF',
  success: '#34D399',
  error: '#F87171',
  warn: '#FCD34D',
}

const LEVEL_LABEL: Record<LogEntry['level'], string> = {
  info: 'INFO ',
  success: 'OK   ',
  error: 'ERR  ',
  warn: 'WARN ',
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    const hh = d.getHours().toString().padStart(2, '0')
    const mm = d.getMinutes().toString().padStart(2, '0')
    const ss = d.getSeconds().toString().padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  } catch {
    return ts.slice(11, 19) || '??:??:??'
  }
}

export default function TerminalLog({
  entries,
  maxHeight = '240px',
  onNewEntry,
  onClear,
}: TerminalLogProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [sseStatus, setSseStatus] = useState<'connecting' | 'connected' | 'disconnected'>(
    'connecting'
  )
  const esRef = useRef<EventSource | null>(null)
  const onNewEntryRef = useRef(onNewEntry)
  onNewEntryRef.current = onNewEntry

  // ── SSE connection ────────────────────────────
  const connectSSE = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
    }

    setSseStatus('connecting')
    const es = new EventSource('/api/stream')
    esRef.current = es

    es.onopen = () => {
      setSseStatus('connected')
    }

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as LogEntry
        // The stream sends LogEntry objects directly: { level, message, timestamp }
        if (data.level && data.message && data.timestamp) {
          const entry: LogEntry = {
            level: data.level,
            message: data.message,
            timestamp: data.timestamp,
          }
          // Delegate accumulation to the parent — it keeps the log alive across tab switches
          onNewEntryRef.current?.(entry)
        }
      } catch {
        // ignore keep-alive pings and malformed messages
      }
    }

    es.onerror = () => {
      setSseStatus('disconnected')
      es.close()
      // Reconnect after 4 seconds
      setTimeout(() => {
        if (esRef.current === es) {
          connectSSE()
        }
      }, 4000)
    }
  }, [])

  useEffect(() => {
    connectSSE()
    return () => {
      esRef.current?.close()
    }
  }, [connectSSE])

  // ── Auto-scroll ───────────────────────────────
  const handleScroll = () => {
    const el = bodyRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setIsAtBottom(atBottom)
  }

  useEffect(() => {
    if (isAtBottom && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [entries, isAtBottom])

  const sseStatusDot =
    sseStatus === 'connected'
      ? '#10B981'
      : sseStatus === 'connecting'
      ? '#F59E0B'
      : '#EF4444'

  const sseStatusLabel =
    sseStatus === 'connected'
      ? 'LIVE'
      : sseStatus === 'connecting'
      ? 'CONNECTING…'
      : 'DISCONNECTED'

  return (
    <div className="terminal-panel" style={{ height: maxHeight, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="terminal-header" style={{ flexShrink: 0 }}>
        <span className="terminal-dot terminal-dot-red" />
        <span className="terminal-dot terminal-dot-yellow" />
        <span className="terminal-dot terminal-dot-green" />
        <span
          style={{
            marginLeft: '8px',
            color: '#6B6B80',
            fontSize: '0.6875rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            flex: 1,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          SYSTEM LOG
        </span>
        {/* SSE status */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: sseStatusDot,
              boxShadow: sseStatus === 'connected' ? `0 0 4px ${sseStatusDot}` : 'none',
              animation: sseStatus === 'connecting' ? 'glow-pulse 1s ease-in-out infinite' : 'none',
            }}
          />
          <span
            style={{
              fontSize: '0.5625rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: sseStatusDot,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {sseStatusLabel}
          </span>
        </span>

        {/* Clear button */}
        {onClear && (
          <button
            onClick={onClear}
            title="Clear system log"
            style={{
              marginLeft: '8px',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: '#F87171',
              fontSize: '0.5rem',
              letterSpacing: '0.1em',
              borderRadius: '3px',
              padding: '2px 7px',
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 700,
              transition: 'background 0.15s ease, border-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(239, 68, 68, 0.18)'
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239, 68, 68, 0.5)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(239, 68, 68, 0.08)'
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239, 68, 68, 0.25)'
            }}
          >
            ✕ CLEAR
          </button>
        )}

        {/* Scroll indicator */}
        {!isAtBottom && (
          <button
            onClick={() => {
              if (bodyRef.current) {
                bodyRef.current.scrollTop = bodyRef.current.scrollHeight
                setIsAtBottom(true)
              }
            }}
            style={{
              marginLeft: '10px',
              background: 'rgba(245, 158, 11, 0.15)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              color: '#F59E0B',
              fontSize: '0.5rem',
              letterSpacing: '0.1em',
              borderRadius: '3px',
              padding: '2px 7px',
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 700,
            }}
          >
            ↓ BOTTOM
          </button>
        )}
      </div>

      {/* Log body */}
      <div
        ref={bodyRef}
        className="terminal-body"
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
      >
        {entries.length === 0 ? (
          <div
            style={{
              color: '#374151',
              fontSize: '0.75rem',
              fontFamily: "'JetBrains Mono', monospace",
              padding: '8px 0',
            }}
          >
            Awaiting pipeline activity…
          </div>
        ) : (
          entries.map((entry, i) => (
            <div
              key={`${entry.timestamp}-${i}`}
              className="terminal-line"
              style={{
                color: LEVEL_COLOR[entry.level],
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.71875rem',
                lineHeight: 1.7,
                animation: i === entries.length - 1 ? 'terminal-entry 0.2s ease-out forwards' : 'none',
              }}
            >
              <span className="terminal-timestamp">[{formatTimestamp(entry.timestamp)}]</span>
              <span
                className={`terminal-level ${entry.level}`}
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                [{LEVEL_LABEL[entry.level]}]
              </span>
              <span>{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
