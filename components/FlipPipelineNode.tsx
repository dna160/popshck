'use client'

import { useState } from 'react'
import PipelineNode from './PipelineNode'
import type { NodeId, NodeState } from '@/types'

interface AgentTask {
  id: string
  description: string
  status: 'queued' | 'in-progress' | 'done' | 'failed'
  addedAt: number
}

interface FlipPipelineNodeProps {
  id: NodeId
  label: string
  icon: string
  state: NodeState
  subtitle?: string
  tasks?: AgentTask[]
  accentColor: string
  nodeWidth?: number
  nodeHeight?: number
  // Task-driven overrides — forwarded directly to PipelineNode
  isActive?: boolean
  hasError?: boolean
}

const STATUS_ICONS: Record<AgentTask['status'], string> = {
  'queued': '⋯',
  'in-progress': '⚡',
  'done': '✓',
  'failed': '✕',
}

const STATUS_COLORS: Record<AgentTask['status'], string> = {
  'queued': '#6B7280',
  'in-progress': '#F59E0B',
  'done': '#10B981',
  'failed': '#EF4444',
}

// Back-card expanded dimensions — these are the size of the overlay when flipped
const BACK_W = 280
const BACK_H = 260

export default function FlipPipelineNode({
  id,
  label,
  icon,
  state,
  subtitle,
  tasks = [],
  accentColor,
  nodeWidth = 120,
  nodeHeight = 88,
  isActive = false,
  hasError = false,
}: FlipPipelineNodeProps) {
  const [flipped, setFlipped] = useState(false)

  const activeTasks = tasks.filter((t) => t.status === 'queued' || t.status === 'in-progress')
  const recentTasks = tasks.slice(0, 20) // show up to 20 tasks on back

  // Offsets so the back card is centred over the front node
  const offsetLeft = -(BACK_W - nodeWidth) / 2
  const offsetTop  = -(BACK_H - nodeHeight) / 2

  return (
    <div
      style={{
        position: 'relative',
        width: `${nodeWidth}px`,
        height: `${nodeHeight}px`,
        zIndex: flipped ? 50 : 2,
      }}
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
    >
      {/* ── Front face (always rendered at node size) ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transition: 'opacity 0.2s ease, transform 0.2s ease',
          opacity: flipped ? 0 : 1,
          transform: flipped ? 'scale(0.92)' : 'scale(1)',
          pointerEvents: flipped ? 'none' : 'auto',
        }}
      >
        <PipelineNode
          id={id}
          label={label}
          icon={icon}
          state={state}
          subtitle={subtitle}
          isActive={isActive}
          hasError={hasError}
        />
        {/* Active task count badge */}
        {activeTasks.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '-6px',
              right: '-6px',
              background: accentColor,
              color: '#000',
              fontSize: '0.5rem',
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              borderRadius: '50%',
              width: '18px',
              height: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 0 8px ${accentColor}80`,
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            {activeTasks.length}
          </div>
        )}
      </div>

      {/* ── Back face: expanded overlay (centred over node) ── */}
      <div
        style={{
          position: 'absolute',
          left: `${offsetLeft}px`,
          top: `${offsetTop}px`,
          width: `${BACK_W}px`,
          height: `${BACK_H}px`,
          transition: 'opacity 0.25s ease, transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
          opacity: flipped ? 1 : 0,
          transform: flipped ? 'scale(1)' : 'scale(0.7)',
          pointerEvents: flipped ? 'auto' : 'none',
          background: '#111116',
          border: `1.5px solid ${accentColor}70`,
          borderRadius: '10px',
          boxShadow: `0 0 32px ${accentColor}30, 0 8px 32px rgba(0,0,0,0.85)`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 50,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '8px 12px 7px',
            borderBottom: `1px solid ${accentColor}35`,
            background: `${accentColor}12`,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span style={{ fontSize: '1rem' }}>{icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  color: accentColor,
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontFamily: "'JetBrains Mono', monospace",
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {label}
              </div>
              {subtitle && (
                <div
                  style={{
                    color: '#6B7280',
                    fontSize: '0.5rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    marginTop: '1px',
                  }}
                >
                  {subtitle}
                </div>
              )}
            </div>
            <div
              style={{
                background: `${accentColor}22`,
                border: `1px solid ${accentColor}50`,
                color: accentColor,
                fontSize: '0.5rem',
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                borderRadius: '4px',
                padding: '2px 7px',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              {activeTasks.length} ACTIVE
            </div>
          </div>
        </div>

        {/* Task list — scrollable, min 3 rows always visible */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '6px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            minHeight: 0,
          }}
        >
          {recentTasks.length === 0 ? (
            <div
              style={{
                color: '#374151',
                fontSize: '0.6rem',
                fontFamily: "'JetBrains Mono', monospace",
                textAlign: 'center',
                marginTop: '20px',
                opacity: 0.6,
              }}
            >
              ∅ no tasks yet
            </div>
          ) : (
            recentTasks.map((task) => (
              <div
                key={task.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '7px',
                  padding: '5px 7px',
                  borderRadius: '6px',
                  background: task.status === 'in-progress'
                    ? `${accentColor}14`
                    : task.status === 'failed'
                    ? 'rgba(239,68,68,0.06)'
                    : 'rgba(255,255,255,0.02)',
                  border: task.status === 'in-progress'
                    ? `1px solid ${accentColor}35`
                    : task.status === 'failed'
                    ? '1px solid rgba(239,68,68,0.2)'
                    : '1px solid rgba(255,255,255,0.04)',
                }}
              >
                <span
                  style={{
                    color: STATUS_COLORS[task.status],
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    flexShrink: 0,
                    lineHeight: 1.2,
                  }}
                >
                  {STATUS_ICONS[task.status]}
                </span>
                <span
                  style={{
                    color: task.status === 'done'        ? '#4B5563'
                         : task.status === 'failed'      ? '#EF4444'
                         : task.status === 'in-progress' ? '#E5E7EB'
                         : '#9CA3AF',
                    fontSize: '0.575rem',
                    lineHeight: 1.45,
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: '0.02em',
                    wordBreak: 'break-word',
                  }}
                >
                  {task.description}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Footer: scroll hint if many tasks */}
        {tasks.length > 20 && (
          <div
            style={{
              padding: '4px 10px',
              borderTop: `1px solid ${accentColor}20`,
              color: '#374151',
              fontSize: '0.5rem',
              fontFamily: "'JetBrains Mono', monospace",
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            +{tasks.length - 20} more ↕ scroll
          </div>
        )}
      </div>
    </div>
  )
}
