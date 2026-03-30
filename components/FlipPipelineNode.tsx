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

export default function FlipPipelineNode({
  id,
  label,
  icon,
  state,
  subtitle,
  tasks = [],
  accentColor,
  nodeWidth = 120,
  nodeHeight = 72,
}: FlipPipelineNodeProps) {
  const [flipped, setFlipped] = useState(false)

  const activeTasks = tasks.filter((t) => t.status === 'queued' || t.status === 'in-progress')
  const recentTasks = tasks.slice(0, 12) // show last 12 tasks on back

  return (
    <div
      style={{
        perspective: '1000px',
        width: `${nodeWidth}px`,
        height: `${nodeHeight}px`,
      }}
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          transformStyle: 'preserve-3d',
          transition: 'transform 0.45s cubic-bezier(0.4,0,0.2,1)',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* ── Front: normal PipelineNode ──────────────────────────── */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          <PipelineNode
            id={id}
            label={label}
            icon={icon}
            state={state}
            subtitle={subtitle}
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
                fontSize: '0.45rem',
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                borderRadius: '50%',
                width: '16px',
                height: '16px',
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

        {/* ── Back: scrollable to-do list ──────────────────────────── */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            background: '#0D0D10',
            border: `1px solid ${accentColor}60`,
            borderRadius: '8px',
            boxShadow: `0 0 20px ${accentColor}20, 0 4px 16px rgba(0,0,0,0.6)`,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '5px 7px 4px',
              borderBottom: `1px solid ${accentColor}30`,
              background: `${accentColor}10`,
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '0.7rem' }}>{icon}</span>
              <span
                style={{
                  color: accentColor,
                  fontSize: '0.45rem',
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
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  background: `${accentColor}20`,
                  border: `1px solid ${accentColor}40`,
                  color: accentColor,
                  fontSize: '0.4rem',
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  borderRadius: '3px',
                  padding: '1px 4px',
                  flexShrink: 0,
                }}
              >
                {activeTasks.length} ACTIVE
              </span>
            </div>
          </div>

          {/* Task list — scrollable */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '4px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
            }}
          >
            {recentTasks.length === 0 ? (
              <div
                style={{
                  color: '#374151',
                  fontSize: '0.5rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  textAlign: 'center',
                  marginTop: '8px',
                }}
              >
                no tasks yet
              </div>
            ) : (
              recentTasks.map((task) => (
                <div
                  key={task.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '4px',
                    padding: '3px 4px',
                    borderRadius: '4px',
                    background: task.status === 'in-progress' ? `${accentColor}10` : 'transparent',
                    border: task.status === 'in-progress' ? `1px solid ${accentColor}30` : '1px solid transparent',
                  }}
                >
                  <span
                    style={{
                      color: STATUS_COLORS[task.status],
                      fontSize: '0.5rem',
                      fontWeight: 700,
                      flexShrink: 0,
                      marginTop: '1px',
                      lineHeight: 1,
                    }}
                  >
                    {STATUS_ICONS[task.status]}
                  </span>
                  <span
                    style={{
                      color: task.status === 'done' ? '#4B5563'
                        : task.status === 'failed' ? '#EF4444'
                        : task.status === 'in-progress' ? '#E5E7EB'
                        : '#6B7280',
                      fontSize: '0.45rem',
                      lineHeight: 1.35,
                      fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: '0.02em',
                      wordBreak: 'break-all',
                    }}
                  >
                    {task.description}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Scroll hint if many tasks */}
          {tasks.length > 12 && (
            <div
              style={{
                padding: '2px 6px',
                borderTop: `1px solid ${accentColor}20`,
                color: '#374151',
                fontSize: '0.4rem',
                fontFamily: "'JetBrains Mono', monospace",
                textAlign: 'center',
                flexShrink: 0,
              }}
            >
              +{tasks.length - 12} more
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
