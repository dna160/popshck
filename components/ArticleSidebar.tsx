'use client'

import { useState } from 'react'
import StatusBadge from './StatusBadge'
import type { Article, ArticleStatus } from '@/types'

interface ArticleSidebarProps {
  articles: Article[]
  selectedId: string | null
  onSelect: (id: string) => void
  onClearAll: (status?: string) => void
}

type FilterStatus = 'All' | ArticleStatus

const FILTER_TABS: FilterStatus[] = ['All', 'Drafting', 'Revising', 'Pending Review', 'Published', 'Failed']

function relativeTime(isoString: string): string {
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
    return ''
  }
}

const BRAND_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  'anime': {
    label: 'ANIME',
    bg: 'rgba(245, 158, 11, 0.12)',
    text: '#FCD34D',
    border: 'rgba(245, 158, 11, 0.3)',
  },
  'toys': {
    label: 'TOYS',
    bg: 'rgba(129, 140, 248, 0.12)',
    text: '#A5B4FC',
    border: 'rgba(129, 140, 248, 0.3)',
  },
  'infotainment': {
    label: 'INFO',
    bg: 'rgba(52, 211, 153, 0.12)',
    text: '#6EE7B7',
    border: 'rgba(52, 211, 153, 0.3)',
  },
  'game': {
    label: 'GAME',
    bg: 'rgba(248, 113, 113, 0.12)',
    text: '#FCA5A5',
    border: 'rgba(248, 113, 113, 0.3)',
  },
  'comic': {
    label: 'COMIC',
    bg: 'rgba(96, 165, 250, 0.12)',
    text: '#93C5FD',
    border: 'rgba(96, 165, 250, 0.3)',
  },
}

function BrandBadge({ brandId }: { brandId: string }) {
  const config = BRAND_CONFIG[brandId] ?? {
    label: brandId.toUpperCase().slice(0, 6),
    bg: 'rgba(107, 107, 128, 0.12)',
    text: '#9CA3AF',
    border: 'rgba(107, 107, 128, 0.3)',
  }

  return (
    <span
      style={{
        background: config.bg,
        color: config.text,
        border: `1px solid ${config.border}`,
        fontSize: '0.5rem',
        fontWeight: 700,
        letterSpacing: '0.1em',
        borderRadius: '3px',
        padding: '1px 5px',
        fontFamily: "'JetBrains Mono', monospace",
        flexShrink: 0,
      }}
    >
      {config.label}
    </span>
  )
}

export default function ArticleSidebar({ articles, selectedId, onSelect, onClearAll }: ArticleSidebarProps) {
  const [filter, setFilter] = useState<FilterStatus>('Pending Review')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)

  const filtered = articles
    .filter((a) => filter === 'All' || a.status === filter)
    .filter((a) =>
      search.trim() === ''
        ? true
        : a.title.toLowerCase().includes(search.toLowerCase()) ||
          a.brandId.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  const countForFilter = (f: FilterStatus) =>
    f === 'All' ? articles.length : articles.filter((a) => a.status === f).length

  return (
    <div
      style={{
        width: '280px',
        flexShrink: 0,
        borderRight: '1px solid #2A2A32',
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
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
          <span style={{ fontSize: '0.875rem' }}>📋</span>
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
            ARTICLES
          </span>
          <span
            style={{
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              color: '#F59E0B',
              fontSize: '0.5625rem',
              fontWeight: 700,
              borderRadius: '4px',
              padding: '1px 6px',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {articles.length}
          </span>
          <button
            onClick={() => setShowModal(true)}
            style={{
              marginLeft: 'auto',
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
              : filter === 'Pending Review'
              ? 'CLEAR PENDING'
              : `CLEAR ${filter.toUpperCase()}`}
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search articles…"
          className="newsroom-input"
          style={{ fontSize: '0.75rem', padding: '6px 10px' }}
        />
      </div>

      {/* Filter tabs */}
      <div
        style={{
          display: 'flex',
          padding: '6px 10px',
          gap: '4px',
          borderBottom: '1px solid #2A2A32',
          flexWrap: 'wrap',
          background: '#080809',
        }}
      >
        {FILTER_TABS.map((f) => {
          const isActive = filter === f
          const count = countForFilter(f)
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: isActive ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
                border: isActive
                  ? '1px solid rgba(245, 158, 11, 0.35)'
                  : '1px solid transparent',
                color: isActive ? '#F59E0B' : '#6B6B80',
                fontSize: '0.5625rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                borderRadius: '4px',
                padding: '3px 7px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                fontFamily: "'JetBrains Mono', monospace",
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {f === 'All' ? 'ALL' : f === 'Pending Review' ? 'PENDING' : f.toUpperCase().slice(0, 7)}
              <span
                style={{
                  background: isActive ? 'rgba(245, 158, 11, 0.2)' : 'rgba(107,107,128,0.15)',
                  borderRadius: '3px',
                  padding: '0 4px',
                  fontSize: '0.5rem',
                }}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Confirmation modal */}
      {showModal && (() => {
        const targetStatus = filter === 'All' ? undefined : filter
        const deleteCount = targetStatus
          ? articles.filter((a) => a.status === targetStatus).length
          : articles.length
        const label =
          filter === 'All'
            ? 'all articles'
            : filter === 'Pending Review'
            ? 'all Pending Review articles'
            : `all ${filter} articles`
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
              <span style={{ fontSize: '2rem', marginBottom: '4px' }}>🗑️</span>
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
                Clear {filter === 'All' ? 'All Articles' : filter === 'Pending Review' ? 'Pending Articles' : `${filter} Articles`}?
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
                <span style={{ color: '#FCA5A5', fontWeight: 700 }}>{deleteCount} article{deleteCount !== 1 ? 's' : ''}</span>
                {targetStatus ? ` with status "${filter}"` : ''}. This action cannot be undone.
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
                    onClearAll(targetStatus)
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

      {/* Article list */}
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
            No articles{filter !== 'All' ? ` with status "${filter}"` : ''}
          </div>
        ) : (
          filtered.map((article) => {
            const isSelected = article.id === selectedId
            return (
              <button
                key={article.id}
                onClick={() => onSelect(article.id)}
                style={{
                  width: '100%',
                  background: isSelected ? 'rgba(245, 158, 11, 0.07)' : 'transparent',
                  border: 'none',
                  borderLeft: isSelected
                    ? '2px solid #F59E0B'
                    : '2px solid transparent',
                  borderBottom: '1px solid #1C1C22',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.12s ease, border-left-color 0.12s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected)
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.02)'
                }}
                onMouseLeave={(e) => {
                  if (!isSelected)
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                }}
              >
                {/* Title */}
                <span
                  style={{
                    color: isSelected ? '#F59E0B' : '#D1D5DB',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    lineHeight: 1.35,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    transition: 'color 0.12s ease',
                  }}
                >
                  {article.title || 'Untitled Article'}
                </span>

                {/* Meta row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                  <BrandBadge brandId={article.brandId} />
                  <StatusBadge status={article.status} size="sm" />
                  <span
                    style={{
                      marginLeft: 'auto',
                      color: '#4B5563',
                      fontSize: '0.5625rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      flexShrink: 0,
                    }}
                  >
                    {relativeTime(article.updatedAt)}
                  </span>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
