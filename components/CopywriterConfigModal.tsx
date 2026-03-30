'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Settings } from '@/types'

// ── Types ──────────────────────────────────────────────────────────────────────

interface CopywriterConfig {
  niche: string
  tone: string
  rssSources: string
  imageCount: number
}

interface CopywriterConfigModalProps {
  brandId: 'anime' | 'toys' | 'infotainment' | 'game' | 'comic'
  settings: Settings
  onSave: (updates: Partial<Settings>) => void
  onClose: () => void
}

// ── Defaults ───────────────────────────────────────────────────────────────────

const BRAND_META = {
  'anime': {
    label: 'Copywriter A — Anime',
    icon: '⛩️',
    color: '#F59E0B',
    accent: 'rgba(245,158,11,0.15)',
    border: 'rgba(245,158,11,0.35)',
    tag: 'ANIME',
    tagColor: '#F59E0B',
    defaultTone: 'Anime: energetic, otaku-friendly, pop-culture savvy',
    nicheKey: 'nicheA' as const,
    toneKey: 'toneA' as const,
    rssKey: 'rssSourcesA' as const,
    imageCountKey: 'imageCountA' as const,
    placeholder: 'e.g. anime, manga, Japanese animation, seasonal releases',
    tonemsg: 'Energetic, otaku-friendly, pop-culture savvy tone',
  },
  'toys': {
    label: 'Copywriter B — Toys',
    icon: '🧸',
    color: '#818CF8',
    accent: 'rgba(129,140,248,0.15)',
    border: 'rgba(129,140,248,0.35)',
    tag: 'TOYS',
    tagColor: '#818CF8',
    defaultTone: 'Toys: playful, family-friendly, collector-focused',
    nicheKey: 'nicheB' as const,
    toneKey: 'toneB' as const,
    rssKey: 'rssSourcesB' as const,
    imageCountKey: 'imageCountB' as const,
    placeholder: 'e.g. action figures, collectibles, LEGO, merchandise',
    tonemsg: 'Playful, family-friendly, collector-focused tone',
  },
  'infotainment': {
    label: 'Copywriter C — Infotainment',
    icon: '📺',
    color: '#34D399',
    accent: 'rgba(52,211,153,0.15)',
    border: 'rgba(52,211,153,0.35)',
    tag: 'INFO',
    tagColor: '#34D399',
    defaultTone: 'Infotainment: engaging, informative, trending-topic driven',
    nicheKey: 'nicheC' as const,
    toneKey: 'toneC' as const,
    rssKey: 'rssSourcesC' as const,
    imageCountKey: 'imageCountC' as const,
    placeholder: 'e.g. celebrity news, trending entertainment, viral stories',
    tonemsg: 'Engaging, informative, trending-topic driven tone',
  },
  'game': {
    label: 'Copywriter D — Game',
    icon: '🎮',
    color: '#F87171',
    accent: 'rgba(248,113,113,0.15)',
    border: 'rgba(248,113,113,0.35)',
    tag: 'GAME',
    tagColor: '#F87171',
    defaultTone: 'Game: hype-driven, gamer-voice, esports-aware',
    nicheKey: 'nicheD' as const,
    toneKey: 'toneD' as const,
    rssKey: 'rssSourcesD' as const,
    imageCountKey: 'imageCountD' as const,
    placeholder: 'e.g. video games, esports, game releases, gaming hardware',
    tonemsg: 'Hype-driven, gamer-voice, esports-aware tone',
  },
  'comic': {
    label: 'Copywriter E — Comic',
    icon: '💥',
    color: '#60A5FA',
    accent: 'rgba(96,165,250,0.15)',
    border: 'rgba(96,165,250,0.35)',
    tag: 'COMIC',
    tagColor: '#60A5FA',
    defaultTone: 'Comic: fan-focused, narrative-driven, superhero & manga aware',
    nicheKey: 'nicheE' as const,
    toneKey: 'toneE' as const,
    rssKey: 'rssSourcesE' as const,
    imageCountKey: 'imageCountE' as const,
    placeholder: 'e.g. Marvel, DC, manga, graphic novels, superhero movies',
    tonemsg: 'Fan-focused, narrative-driven, superhero & manga aware tone',
  },
}

// ── Styled input components ────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label
        style={{
          color: '#9CA3AF',
          fontSize: '0.625rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <span style={{ color: '#4B5563', fontSize: '0.6rem', marginTop: '2px' }}>{hint}</span>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#0D0D10',
  border: '1px solid #2A2A32',
  borderRadius: '6px',
  color: '#E5E7EB',
  padding: '10px 12px',
  fontSize: '0.8125rem',
  fontFamily: "'JetBrains Mono', monospace",
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s ease',
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CopywriterConfigModal({
  brandId,
  settings,
  onSave,
  onClose,
}: CopywriterConfigModalProps) {
  const meta = BRAND_META[brandId]

  const [config, setConfig] = useState<CopywriterConfig>({
    niche: settings[meta.nicheKey] || '',
    tone: settings[meta.toneKey] || meta.defaultTone,
    rssSources: settings[meta.rssKey] || '',
    imageCount: settings[meta.imageCountKey] ?? 1,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [focusedField, setFocusedField] = useState<string | null>(null)

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const updates: Partial<Settings> = {
        [meta.nicheKey]: config.niche.trim(),
        [meta.toneKey]: config.tone.trim(),
        [meta.rssKey]: config.rssSources.trim(),
        [meta.imageCountKey]: Math.max(1, Math.min(10, Number(config.imageCount) || 1)),
      }
      await onSave(updates)
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 1000)
    } finally {
      setSaving(false)
    }
  }, [config, meta, onSave, onClose])

  const handleReset = useCallback(() => {
    setConfig({
      niche: '',
      tone: meta.defaultTone,
      rssSources: '',
      imageCount: 1,
    })
  }, [meta.defaultTone])

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
        animation: 'fadeIn 0.15s ease',
      }}
    >
      {/* Modal Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#111114',
          border: `1px solid ${meta.border}`,
          borderRadius: '12px',
          width: '520px',
          maxWidth: '95vw',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: `0 0 60px ${meta.accent}, 0 25px 50px rgba(0,0,0,0.8)`,
          animation: 'slideUp 0.2s ease',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px 18px',
            borderBottom: `1px solid #1E1E26`,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            background: meta.accent,
          }}
        >
          <span style={{ fontSize: '1.5rem' }}>{meta.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  color: '#F3F4F6',
                  fontSize: '0.9375rem',
                  fontWeight: 700,
                  letterSpacing: '0.03em',
                }}
              >
                {meta.label}
              </span>
              <span
                style={{
                  background: meta.accent,
                  border: `1px solid ${meta.border}`,
                  color: meta.color,
                  fontSize: '0.5rem',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {meta.tag}
              </span>
            </div>
            <p style={{ color: '#6B6B80', fontSize: '0.6875rem', marginTop: '2px' }}>
              Configure niche targeting &amp; voice parameters
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid #2A2A32',
              borderRadius: '6px',
              color: '#6B6B80',
              width: '28px',
              height: '28px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.875rem',
              transition: 'all 0.15s ease',
            }}
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            overflowY: 'auto',
          }}
        >
          {/* Info Banner */}
          <div
            style={{
              background: 'rgba(16,185,129,0.05)',
              border: '1px solid rgba(16,185,129,0.2)',
              borderRadius: '8px',
              padding: '10px 14px',
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
            }}
          >
            <span style={{ fontSize: '0.875rem', marginTop: '1px' }}>💡</span>
            <p style={{ color: '#6B7280', fontSize: '0.6875rem', lineHeight: 1.6, margin: 0 }}>
              Parameters configured here feed directly into the{' '}
              <span style={{ color: '#10B981' }}>Investigator</span> stage. The niche controls which
              news articles are triaged as relevant. Leave blank to inherit the global niche.
            </p>
          </div>

          {/* Niche Field */}
          <Field
            label="Target Niche"
            hint="What topics should the Investigator look for? Be specific for best results."
          >
            <input
              id={`niche-${brandId}`}
              type="text"
              value={config.niche}
              placeholder={meta.placeholder}
              onChange={(e) => setConfig((c) => ({ ...c, niche: e.target.value }))}
              onFocus={() => setFocusedField('niche')}
              onBlur={() => setFocusedField(null)}
              style={{
                ...inputStyle,
                borderColor: focusedField === 'niche' ? meta.color : '#2A2A32',
                boxShadow: focusedField === 'niche' ? `0 0 0 2px ${meta.accent}` : 'none',
              }}
            />
          </Field>

          {/* Tone / Voice Field */}
          <Field
            label="Brand Voice / Tone"
            hint="Writing style instructions for the Copywriter LLM. Overrides the default brand guidelines."
          >
            <textarea
              id={`tone-${brandId}`}
              rows={4}
              value={config.tone}
              placeholder={meta.tonemsg}
              onChange={(e) => setConfig((c) => ({ ...c, tone: e.target.value }))}
              onFocus={() => setFocusedField('tone')}
              onBlur={() => setFocusedField(null)}
              style={{
                ...inputStyle,
                resize: 'vertical',
                lineHeight: 1.6,
                borderColor: focusedField === 'tone' ? meta.color : '#2A2A32',
                boxShadow: focusedField === 'tone' ? `0 0 0 2px ${meta.accent}` : 'none',
              }}
            />
          </Field>

          {/* RSS Sources Field */}
          <Field
            label="Custom RSS Sources"
            hint="Comma-separated RSS feed URLs for this copywriter's niche. Leave blank to use global feeds."
          >
            <textarea
              id={`rss-${brandId}`}
              rows={3}
              value={config.rssSources}
              placeholder="https://example.com/rss, https://newssite.com/feed.xml"
              onChange={(e) => setConfig((c) => ({ ...c, rssSources: e.target.value }))}
              onFocus={() => setFocusedField('rss')}
              onBlur={() => setFocusedField(null)}
              style={{
                ...inputStyle,
                resize: 'vertical',
                lineHeight: 1.6,
                borderColor: focusedField === 'rss' ? meta.color : '#2A2A32',
                boxShadow: focusedField === 'rss' ? `0 0 0 2px ${meta.accent}` : 'none',
                fontFamily: 'monospace',
                fontSize: '0.70rem',
              }}
            />
          </Field>

          {/* Image Count Field */}
          <Field
            label="Images Per Article"
            hint="How many images to resolve and embed per article. First image = featured. Rest are inserted into the body. Range: 1–10."
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <input
                id={`imageCount-${brandId}`}
                type="number"
                min={1}
                max={10}
                value={config.imageCount}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    imageCount: Math.max(1, Math.min(10, parseInt(e.target.value) || 1)),
                  }))
                }
                onFocus={() => setFocusedField('imageCount')}
                onBlur={() => setFocusedField(null)}
                style={{
                  ...inputStyle,
                  width: '80px',
                  textAlign: 'center',
                  borderColor: focusedField === 'imageCount' ? meta.color : '#2A2A32',
                  boxShadow: focusedField === 'imageCount' ? `0 0 0 2px ${meta.accent}` : 'none',
                }}
              />
              <div style={{ display: 'flex', gap: '6px' }}>
                {[1, 2, 3, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setConfig((c) => ({ ...c, imageCount: n }))}
                    style={{
                      background: config.imageCount === n ? meta.accent : 'transparent',
                      border: `1px solid ${config.imageCount === n ? meta.border : '#2A2A32'}`,
                      borderRadius: '4px',
                      color: config.imageCount === n ? meta.color : '#6B6B80',
                      padding: '4px 10px',
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: "'JetBrains Mono', monospace",
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </Field>

          {/* Pipeline Preview */}
          <div
            style={{
              background: '#0D0D10',
              border: '1px solid #1E1E26',
              borderRadius: '8px',
              padding: '14px',
            }}
          >
            <p
              style={{
                color: '#4B5563',
                fontSize: '0.5625rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontFamily: "'JetBrains Mono', monospace",
                marginBottom: '10px',
              }}
            >
              ⚙ Pipeline Preview
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {[
                {
                  stage: 'Investigator',
                  value: config.niche.trim()
                    ? `Targeting: "${config.niche}"`
                    : 'Using global niche (fallback)',
                  active: !!config.niche.trim(),
                },
                {
                  stage: 'Router',
                  value: config.niche.trim()
                    ? `Filtering for "${config.niche}"`
                    : 'Using global niche (fallback)',
                  active: !!config.niche.trim(),
                },
                {
                  stage: 'Copywriter',
                  value: config.tone.trim() ? 'Custom tone applied' : 'Default tone',
                  active: !!config.tone.trim(),
                },
                {
                  stage: 'Images',
                  value: `${config.imageCount} image${config.imageCount !== 1 ? 's' : ''} per article`,
                  active: config.imageCount > 1,
                },
              ].map(({ stage, value, active }) => (
                <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: active ? meta.color : '#374151',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      color: '#6B6B80',
                      fontSize: '0.5625rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: '0.06em',
                      fontWeight: 600,
                      width: '80px',
                      flexShrink: 0,
                    }}
                  >
                    {stage}
                  </span>
                  <span
                    style={{
                      color: active ? '#9CA3AF' : '#374151',
                      fontSize: '0.6875rem',
                      fontStyle: active ? 'normal' : 'italic',
                    }}
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #1E1E26',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <button
            onClick={handleReset}
            style={{
              background: 'none',
              border: '1px solid #2A2A32',
              borderRadius: '6px',
              color: '#6B6B80',
              padding: '8px 14px',
              fontSize: '0.6875rem',
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '0.06em',
              fontWeight: 600,
              transition: 'all 0.15s ease',
            }}
          >
            ↺ Reset Defaults
          </button>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: '1px solid #2A2A32',
                borderRadius: '6px',
                color: '#9CA3AF',
                padding: '8px 16px',
                fontSize: '0.6875rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: saved
                  ? 'rgba(16,185,129,0.15)'
                  : saving
                  ? meta.accent
                  : meta.accent,
                border: `1px solid ${saved ? 'rgba(16,185,129,0.5)' : meta.border}`,
                borderRadius: '6px',
                color: saved ? '#10B981' : meta.color,
                padding: '8px 20px',
                fontSize: '0.6875rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontFamily: "'JetBrains Mono', monospace",
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: `0 0 16px ${meta.accent}`,
              }}
            >
              {saved ? '✓ SAVED' : saving ? '⟳ SAVING...' : '⬆ SAVE CONFIG'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { transform: translateY(16px); opacity: 0 } to { transform: none; opacity: 1 } }
      `}</style>
    </div>
  )
}
