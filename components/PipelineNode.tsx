'use client'

import type { NodeId, NodeState } from '@/types'

interface PipelineNodeProps {
  id: NodeId
  label: string
  icon: string
  state: NodeState
  subtitle?: string
  // Task-driven overrides — take priority over `state` when provided
  isActive?: boolean
  hasError?: boolean
}

const STATE_STYLES: Record<
  NodeState,
  {
    border: string
    bg: string
    ringColor: string
    textColor: string
    shadow?: string
  }
> = {
  idle: {
    border: 'rgba(245, 158, 11, 0.3)',
    bg: '#111114',
    ringColor: 'rgba(245, 158, 11, 0.25)',
    textColor: '#6B6B80',
  },
  working: {
    border: '#F59E0B',
    bg: '#1A1A1F',
    ringColor: 'rgba(245, 158, 11, 0.6)',
    textColor: '#F59E0B',
    shadow: '0 0 20px rgba(245, 158, 11, 0.5)',
  },
  success: {
    border: '#10B981',
    bg: '#0D1F17',
    ringColor: 'rgba(16, 185, 129, 0.5)',
    textColor: '#34D399',
    shadow: '0 0 12px rgba(16, 185, 129, 0.25)',
  },
  error: {
    border: '#EF4444',
    bg: '#1F0D0D',
    ringColor: 'rgba(239, 68, 68, 0.5)',
    textColor: '#F87171',
    shadow: '0 0 12px rgba(239, 68, 68, 0.25)',
  },
}

const STATE_LABELS: Record<NodeState, string> = {
  idle: 'IDLE',
  working: 'WORKING',
  success: 'DONE',
  error: 'ERROR',
}

export default function PipelineNode({
  label,
  icon,
  state,
  subtitle,
  isActive = false,
  hasError = false,
}: PipelineNodeProps) {
  // Task-driven state takes priority: hasError > isActive > legacy state prop
  const effectiveState: NodeState = hasError ? 'error' : isActive ? 'working' : state
  const styles = STATE_STYLES[effectiveState]

  return (
    <div
      style={{
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        boxShadow: styles.shadow ?? 'none',
        borderRadius: '8px',
        padding: '12px 14px',
        width: '120px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        position: 'relative',
        transition: 'background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
        cursor: 'default',
        animation: effectiveState === 'working'
          ? 'node-working-pulse 1s ease-in-out infinite'
          : effectiveState === 'error'
          ? 'node-error-pulse 1.5s ease-in-out infinite'
          : undefined,
      }}
    >
      {/* Outer pulse ring — only visible on idle */}
      {effectiveState === 'idle' && (
        <span
          style={{
            position: 'absolute',
            inset: '-4px',
            borderRadius: '11px',
            border: `1px solid ${styles.ringColor}`,
            pointerEvents: 'none',
            animation: 'node-idle-pulse 3s ease-in-out infinite',
          }}
        />
      )}

      {/* State ring indicator */}
      <span
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: styles.border,
          boxShadow:
            effectiveState !== 'idle' ? `0 0 6px ${styles.border}` : 'none',
          transition: 'background 0.2s ease, box-shadow 0.2s ease',
        }}
      />

      {/* Icon */}
      <span
        style={{
          fontSize: '1.75rem',
          lineHeight: 1,
          filter:
            effectiveState === 'working'
              ? 'drop-shadow(0 0 6px rgba(245, 158, 11, 0.8))'
              : effectiveState === 'error'
              ? 'drop-shadow(0 0 6px rgba(239, 68, 68, 0.8))'
              : effectiveState === 'idle'
              ? 'grayscale(50%) opacity(0.7)'
              : 'none',
          transition: 'filter 0.2s ease',
        }}
        role="img"
        aria-label={label}
      >
        {icon}
      </span>

      {/* Label */}
      <span
        style={{
          color: styles.textColor,
          fontSize: '0.6875rem',
          fontWeight: 700,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          textAlign: 'center',
          lineHeight: 1.2,
          transition: 'color 0.2s ease',
        }}
      >
        {label}
      </span>

      {/* Subtitle */}
      {subtitle && (
        <span
          style={{
            color: '#4B5563',
            fontSize: '0.5625rem',
            letterSpacing: '0.05em',
            textAlign: 'center',
          }}
        >
          {subtitle}
        </span>
      )}

      {/* State label at bottom */}
      <span
        style={{
          fontSize: '0.5rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          color:
            effectiveState === 'idle'
              ? '#374151'
              : effectiveState === 'working'
              ? '#F59E0B'
              : effectiveState === 'success'
              ? '#10B981'
              : '#EF4444',
          fontFamily: "'JetBrains Mono', monospace",
          transition: 'color 0.2s ease',
        }}
      >
        {STATE_LABELS[effectiveState]}
      </span>
    </div>
  )
}
