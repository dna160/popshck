'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Insight, TargetAgent } from '@/types'

interface InsightsPanelProps {
  insights: Insight[]
  onApprove: (id: string) => void
  onDismiss: (id: string) => void
  onClearAll: (targetAgent?: string) => void
}

const AGENT_CONFIG: Record<
  TargetAgent,
  { icon: string; label: string; color: string; bg: string }
> = {
  Investigator: {
    icon: '🔍',
    label: 'INVESTIGATOR',
    color: '#60A5FA',
    bg: 'rgba(59, 130, 246, 0.08)',
  },
  'Copywriter-A': {
    icon: '⛩️',
    label: 'CW-A ANIME',
    color: '#F59E0B',
    bg: 'rgba(245, 158, 11, 0.08)',
  },
  'Copywriter-B': {
    icon: '🧸',
    label: 'CW-B TOYS',
    color: '#818CF8',
    bg: 'rgba(129, 140, 248, 0.08)',
  },
  'Copywriter-C': {
    icon: '📺',
    label: 'CW-C INFOTAINMENT',
    color: '#34D399',
    bg: 'rgba(52, 211, 153, 0.08)',
  },
  'Copywriter-D': {
    icon: '🎮',
    label: 'CW-D GAME',
    color: '#F87171',
    bg: 'rgba(248, 113, 113, 0.08)',
  },
  'Copywriter-E': {
    icon: '💥',
    label: 'CW-E COMIC',
    color: '#60A5FA',
    bg: 'rgba(96, 165, 250, 0.08)',
  },
}

function relativeTime(isoString: string): string {
  try {
    const diff = Date.now() - new Date(isoString).getTime()
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  } catch {
    return ''
  }
}

type FilterTab = 'All' | TargetAgent

const FILTER_TABS: FilterTab[] = ['All', 'Investigator', 'Copywriter-A', 'Copywriter-B', 'Copywriter-C', 'Copywriter-D', 'Copywriter-E']

export default function InsightsPanel({
  insights,
  onApprove,
  onDismiss,
  onClearAll,
}: InsightsPanelProps) {
  const [filter, setFilter] = useState<FilterTab>('All')
  const [actioning, setActioning] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  const pendingCount = insights.filter((i) => i.status === 'Pending').length

  const filtered = insights
    .filter((i) => filter === 'All' || i.targetAgent === filter)
    .sort((a, b) => {
      // Pending first
      if (a.status === 'Pending' && b.status !== 'Pending') return -1
      if (b.status === 'Pending' && a.status !== 'Pending') return 1
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

  // Group by agent
  const grouped: Record<TargetAgent, Insight[]> = {
    Investigator: [],
    'Copywriter-A': [],
    'Copywriter-B': [],
    'Copywriter-C': [],
    'Copywriter-D': [],
    'Copywriter-E': [],
  }
  for (const insight of filtered) {
    grouped[insight.targetAgent].push(insight)
  }

  const handleApprove = async (id: string) => {
    if (actioning) return
    setActioning(id)
    try {
      await onApprove(id)
    } finally {
      setActioning(null)
    }
  }

  const handleDismiss = async (id: string) => {
    if (actioning) return
    setActioning(id)
    try {
      await onDismiss(id)
    } finally {
      setActioning(null)
    }
  }

  return (
    <div
      style={{
        width: '320px',
        flexShrink: 0,
        borderLeft: '1px solid #2A2A32',
        display: 'flex',
        flexDirection: 'column',
        background: '#0D0D10',
        overflow: 'hidden',
        height: '100%',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 14px 10px',
          borderBottom: '1px solid #2A2A32',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
          <span style={{ fontSize: '0.875rem' }}>💡</span>
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
            EDITOR'S INSIGHTS
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {pendingCount > 0 && (
              <span
                style={{
                  background: 'rgba(245, 158, 11, 0.15)',
                  border: '1px solid rgba(245, 158, 11, 0.4)',
                  color: '#F59E0B',
                  fontSize: '0.5625rem',
                  fontWeight: 700,
                  borderRadius: '4px',
                  padding: '2px 7px',
                  fontFamily: "'JetBrains Mono', monospace",
                  animation: 'glow-pulse 2s ease-in-out infinite',
                }}
              >
                {pendingCount} PENDING
              </span>
            )}
            <button
              onClick={() => setShowModal(true)}
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#F87171',
                fontSize: '0.5rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                borderRadius: '4px',
                padding: '2px 6px',
                cursor: 'pointer',
                fontFamily: "'JetBrains Mono', monospace",
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
            >
              {filter === 'All'
                ? 'CLEAR ALL'
                : filter === 'Investigator'
                ? 'CLEAR INVESTIGATOR'
                : `CLEAR ${filter.replace('Copywriter-', 'CW-').toUpperCase()}`}
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {FILTER_TABS.map((f) => {
            const isActive = filter === f
            const count = f === 'All' ? insights.length : insights.filter((i) => i.targetAgent === f).length
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: isActive ? 'rgba(245, 158, 11, 0.1)' : 'transparent',
                  border: isActive ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid transparent',
                  color: isActive ? '#F59E0B' : '#6B6B80',
                  fontSize: '0.5rem',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  borderRadius: '4px',
                  padding: '3px 7px',
                  cursor: 'pointer',
                  fontFamily: "'JetBrains Mono', monospace",
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                {f === 'All' ? 'ALL' : f.replace('Copywriter-', 'CW-')}
                <span
                  style={{
                    background: isActive ? 'rgba(245,158,11,0.2)' : 'rgba(107,107,128,0.15)',
                    borderRadius: '3px',
                    padding: '0 3px',
                    fontSize: '0.5rem',
                  }}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Confirmation modal */}
      {showModal && (() => {
        const targetAgent = filter === 'All' ? undefined : filter as TargetAgent
        const deleteCount = targetAgent
          ? insights.filter((i) => i.targetAgent === targetAgent).length
          : insights.length
        const agentLabel =
          filter === 'All'
            ? 'All Insights'
            : filter === 'Investigator'
            ? 'Investigator Insights'
            : `${filter.replace('Copywriter-', 'Copywriter ')} Insights`
        return (
          <div
            onClick={() => setShowModal(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.75)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#13131A',
                border: '1px solid #3A3A44',
                borderRadius: '14px',
                padding: '28px 24px 22px',
                width: '340px',
                boxShadow: '0 24px 80px rgba(0,0,0,0.85)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span style={{ fontSize: '2rem', marginBottom: '4px' }}>💡</span>
              <span
                style={{
                  color: '#F3F4F6',
                  fontWeight: 700,
                  fontSize: '1rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: '0.04em',
                  textAlign: 'center',
                }}
              >
                Clear {agentLabel}?
              </span>
              <p
                style={{
                  color: '#6B7280',
                  fontSize: '0.8125rem',
                  textAlign: 'center',
                  margin: '4px 0 16px',
                  lineHeight: 1.55,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                This will permanently delete{' '}
                <span style={{ color: '#FCA5A5', fontWeight: 700 }}>{deleteCount} insight{deleteCount !== 1 ? 's' : ''}</span>
                {targetAgent ? ` from ${filter}` : ''}. This action cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                <button
                  onClick={() => setShowModal(false)}
                  style={{
                    flex: 1,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid #3A3A44',
                    color: '#9CA3AF',
                    borderRadius: '8px',
                    padding: '9px 0',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    cursor: 'pointer',
                    fontFamily: "'JetBrains Mono', monospace",
                    transition: 'all 0.15s ease',
                  }}
                >
                  CANCEL
                </button>
                <button
                  onClick={() => {
                    onClearAll(targetAgent)
                    setShowModal(false)
                  }}
                  style={{
                    flex: 1,
                    background: 'rgba(239, 68, 68, 0.2)',
                    border: '1px solid rgba(239, 68, 68, 0.55)',
                    color: '#FCA5A5',
                    borderRadius: '8px',
                    padding: '9px 0',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    cursor: 'pointer',
                    fontFamily: "'JetBrains Mono', monospace",
                    transition: 'all 0.15s ease',
                  }}
                >
                  DELETE {deleteCount}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Insight cards */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div
            style={{
              padding: '24px 14px',
              color: '#4B5563',
              fontSize: '0.75rem',
              textAlign: 'center',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            No insights{filter !== 'All' ? ` for ${filter}` : ''}
          </div>
        ) : (
          // Render by agent group
          (Object.entries(grouped) as [TargetAgent, Insight[]][]).map(([agent, agentInsights]) => {
            if (agentInsights.length === 0) return null
            const config = AGENT_CONFIG[agent]
            return (
              <div key={agent}>
                {/* Agent group header */}
                <div
                  style={{
                    padding: '8px 14px',
                    background: config.bg,
                    borderBottom: '1px solid #2A2A32',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  <span style={{ fontSize: '0.75rem' }}>{config.icon}</span>
                  <span
                    style={{
                      color: config.color,
                      fontSize: '0.5625rem',
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {config.label}
                  </span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      color: '#4B5563',
                      fontSize: '0.5rem',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {agentInsights.length}
                  </span>
                </div>

                {/* Cards */}
                {agentInsights.map((insight) => {
                  const isPending = insight.status === 'Pending'
                  const isActioning = actioning === insight.id
                  return (
                    <div
                      key={insight.id}
                      style={{
                        padding: '12px 14px',
                        borderBottom: '1px solid #1C1C22',
                        borderLeft: isPending
                          ? '2px solid rgba(245, 158, 11, 0.5)'
                          : '2px solid transparent',
                        background: isPending ? 'rgba(245, 158, 11, 0.03)' : 'transparent',
                        animation: isPending ? undefined : undefined,
                        transition: 'background 0.2s ease',
                      }}
                    >
                      {/* Meta */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          marginBottom: '7px',
                        }}
                      >
                        {/* Status dot */}
                        <span
                          style={{
                            width: '5px',
                            height: '5px',
                            borderRadius: '50%',
                            background:
                              insight.status === 'Pending'
                                ? '#F59E0B'
                                : insight.status === 'Approved'
                                ? '#10B981'
                                : '#6B7280',
                            flexShrink: 0,
                            boxShadow:
                              insight.status === 'Pending'
                                ? '0 0 4px rgba(245, 158, 11, 0.6)'
                                : 'none',
                          }}
                        />
                        <span
                          style={{
                            color:
                              insight.status === 'Pending'
                                ? '#F59E0B'
                                : insight.status === 'Approved'
                                ? '#34D399'
                                : '#6B7280',
                            fontSize: '0.5rem',
                            fontWeight: 700,
                            letterSpacing: '0.08em',
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {insight.status.toUpperCase()}
                        </span>
                        <span
                          style={{
                            marginLeft: 'auto',
                            color: '#374151',
                            fontSize: '0.5rem',
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {relativeTime(insight.createdAt)}
                        </span>
                      </div>

                      {/* Suggestion text — rendered as markdown */}
                      <div
                        style={{
                          color: insight.status === 'Dismissed' ? '#4B5563' : '#C9C9D8',
                          fontSize: '0.8125rem',
                          lineHeight: 1.6,
                          margin: '0 0 10px',
                          textDecoration:
                            insight.status === 'Dismissed' ? 'line-through' : 'none',
                        }}
                      >
                        <ReactMarkdown
                          components={{
                            h1: ({ children }) => (
                              <p style={{ fontWeight: 700, fontSize: '0.875rem', color: insight.status === 'Dismissed' ? '#4B5563' : '#E5E5F0', margin: '6px 0 4px' }}>{children}</p>
                            ),
                            h2: ({ children }) => (
                              <p style={{ fontWeight: 700, fontSize: '0.8125rem', color: insight.status === 'Dismissed' ? '#4B5563' : '#D0D0E0', margin: '6px 0 4px' }}>{children}</p>
                            ),
                            h3: ({ children }) => (
                              <p style={{ fontWeight: 700, fontSize: '0.75rem', color: insight.status === 'Dismissed' ? '#4B5563' : '#C0C0D0', margin: '5px 0 3px' }}>{children}</p>
                            ),
                            strong: ({ children }) => (
                              <strong style={{ color: insight.status === 'Dismissed' ? '#4B5563' : '#E5E5F0', fontWeight: 700 }}>{children}</strong>
                            ),
                            em: ({ children }) => (
                              <em style={{ color: insight.status === 'Dismissed' ? '#4B5563' : '#A0A0C0' }}>{children}</em>
                            ),
                            p: ({ children }) => (
                              <p style={{ margin: '0 0 6px' }}>{children}</p>
                            ),
                            li: ({ children }) => (
                              <li style={{ marginLeft: '14px', marginBottom: '3px' }}>{children}</li>
                            ),
                            ul: ({ children }) => (
                              <ul style={{ margin: '4px 0', paddingLeft: '4px', listStyleType: 'disc' }}>{children}</ul>
                            ),
                            ol: ({ children }) => (
                              <ol style={{ margin: '4px 0', paddingLeft: '4px' }}>{children}</ol>
                            ),
                            a: ({ href, children }) => (
                              <a href={href} style={{ color: '#60A5FA', textDecoration: 'underline' }} target="_blank" rel="noreferrer">{children}</a>
                            ),
                          }}
                        >
                          {insight.suggestionText}
                        </ReactMarkdown>
                      </div>

                      {/* Action buttons — only for pending */}
                      {insight.status === 'Pending' && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            onClick={() => handleApprove(insight.id)}
                            disabled={!!isActioning}
                            className="btn-success"
                            style={{ flex: 1, fontSize: '0.5625rem', padding: '4px 8px' }}
                          >
                            {isActioning ? '⏳' : '✓ Approve'}
                          </button>
                          <button
                            onClick={() => handleDismiss(insight.id)}
                            disabled={!!isActioning}
                            className="btn-ghost"
                            style={{ flex: 1, fontSize: '0.5625rem', padding: '4px 8px' }}
                          >
                            {isActioning ? '⏳' : '✕ Dismiss'}
                          </button>
                        </div>
                      )}

                      {/* Approved / dismissed indicator */}
                      {insight.status !== 'Pending' && (
                        <div
                          style={{
                            fontSize: '0.5625rem',
                            color: insight.status === 'Approved' ? '#10B981' : '#4B5563',
                            fontFamily: "'JetBrains Mono', monospace",
                            letterSpacing: '0.08em',
                          }}
                        >
                          {insight.status === 'Approved' ? '✓ Applied to agent' : '✕ Dismissed'}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
