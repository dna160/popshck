'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import FlipPipelineNode from './FlipPipelineNode'
import TerminalLog from './TerminalLog'
import MasterControls from './MasterControls'
import CopywriterConfigModal from './CopywriterConfigModal'
import SeoStrategistModal from './SeoStrategistModal'
import InvestigatorConfigModal from './InvestigatorConfigModal'
import type { NodeId, NodeState, Settings, LogEntry, AgentTask } from '@/types'

interface OperationMapProps {
  settings: Settings
  onSettingsUpdate: (s: Partial<Settings>) => void
  onTrigger: () => void
  isRunning: boolean
  onRunningChange: (running: boolean) => void
}

type NodeStates = Record<NodeId, NodeState>

const INITIAL_NODE_STATES: NodeStates = {
  'seo-strategist': 'idle',
  investigator: 'idle',
  router: 'idle',
  'copywriter-a': 'idle',
  'copywriter-b': 'idle',
  'copywriter-c': 'idle',
  'copywriter-d': 'idle',
  'copywriter-e': 'idle',
  editor: 'idle',
  'editor-b': 'idle',
  'editor-c': 'idle',
  'publisher-a': 'idle',
  'publisher-b': 'idle',
  'publisher-c': 'idle',
  'publisher-d': 'idle',
  'publisher-e': 'idle',
}

// Accent colors per node — used for the flip card back
const NODE_ACCENT: Record<NodeId, string> = {
  'seo-strategist': '#10B981',
  investigator:     '#818CF8',
  router:           '#F59E0B',
  'copywriter-a':   '#EF4444',
  'copywriter-b':   '#F97316',
  'copywriter-c':   '#38BDF8',
  'copywriter-d':   '#A855F7',
  'copywriter-e':   '#EAB308',
  editor:           '#3B82F6',
  'editor-b':       '#60A5FA',
  'editor-c':       '#93C5FD',
  'publisher-a':    '#14B8A6',
  'publisher-b':    '#14B8A6',
  'publisher-c':    '#14B8A6',
  'publisher-d':    '#14B8A6',
  'publisher-e':    '#14B8A6',
}

const NODE_DEFS: { id: NodeId; label: string; icon: string; subtitle?: string }[] = [
  { id: 'seo-strategist', label: 'SEO Strategist', icon: '📈', subtitle: 'Trend & Keyword Intel' },
  { id: 'investigator',   label: 'Investigator',   icon: '🔍', subtitle: 'Scraper & Researcher' },
  { id: 'router',         label: 'Router',         icon: '🔀', subtitle: 'Brand Dispatcher' },
  { id: 'copywriter-a',   label: 'Copywriter A',   icon: '⛩️', subtitle: 'Anime' },
  { id: 'copywriter-b',   label: 'Copywriter B',   icon: '🧸', subtitle: 'Toys' },
  { id: 'copywriter-c',   label: 'Copywriter C',   icon: '📺', subtitle: 'Infotainment' },
  { id: 'copywriter-d',   label: 'Copywriter D',   icon: '🎮', subtitle: 'Game' },
  { id: 'copywriter-e',   label: 'Copywriter E',   icon: '💥', subtitle: 'Comic' },
  { id: 'editor',         label: 'Editor A',       icon: '🎯', subtitle: 'QA & Review' },
  { id: 'editor-b',       label: 'Editor B',       icon: '🎯', subtitle: 'QA & Review' },
  { id: 'editor-c',       label: 'Editor C',       icon: '🎯', subtitle: 'QA & Review' },
  { id: 'publisher-a',    label: 'Publisher A',    icon: '🚀', subtitle: 'Anime Site' },
  { id: 'publisher-b',    label: 'Publisher B',    icon: '📦', subtitle: 'Toys Site' },
  { id: 'publisher-c',    label: 'Publisher C',    icon: '📡', subtitle: 'Info Site' },
  { id: 'publisher-d',    label: 'Publisher D',    icon: '🕹️', subtitle: 'Game Site' },
  { id: 'publisher-e',    label: 'Publisher E',    icon: '📰', subtitle: 'Comic Site' },
]

// Brand ID per copywriter node
const COPYWRITER_BRAND: Record<string, 'anime' | 'toys' | 'infotainment' | 'game' | 'comic'> = {
  'copywriter-a': 'anime',
  'copywriter-b': 'toys',
  'copywriter-c': 'infotainment',
  'copywriter-d': 'game',
  'copywriter-e': 'comic',
}

// Settings niche key per copywriter node
const COPYWRITER_NICHE_KEY: Record<string, keyof Settings> = {
  'copywriter-a': 'nicheA',
  'copywriter-b': 'nicheB',
  'copywriter-c': 'nicheC',
  'copywriter-d': 'nicheD',
  'copywriter-e': 'nicheE',
}

// ── Parse SSE log messages to infer node state changes ──────────────────────
function inferNodeStatesFromLog(message: string, level: LogEntry['level']): Partial<NodeStates> {
  const msg = message.toLowerCase()
  const updates: Partial<NodeStates> = {}

  const isError = level === 'error'
  const isDone = level === 'success' || msg.includes('complete') || msg.includes('finished') || msg.includes('done')
  const isStart = msg.includes('start') || msg.includes('begin') || msg.includes('processing') || msg.includes('working')

  if (msg.includes('seo strateg') || msg.includes('investigator_directive') || msg.includes('seo-strategist')) {
    updates['seo-strategist'] = isError ? 'error' : isDone ? 'success' : isStart ? 'working' : undefined
  }
  if (msg.includes('investigat')) {
    updates.investigator = isError ? 'error' : isDone ? 'success' : isStart ? 'working' : undefined
  }
  if (msg.includes('rout') || msg.includes('dispatch')) {
    updates.router = isError ? 'error' : isDone ? 'success' : isStart ? 'working' : undefined
  }
  if (msg.includes('copywriter-a') || msg.includes('copywriter a') || msg.includes('"anime"')) {
    updates['copywriter-a'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  if (msg.includes('copywriter-b') || msg.includes('copywriter b') || msg.includes('"toys"')) {
    updates['copywriter-b'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  if (msg.includes('copywriter-c') || msg.includes('copywriter c') || msg.includes('"infotainment"')) {
    updates['copywriter-c'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  if (msg.includes('copywriter-d') || msg.includes('copywriter d') || msg.includes('"game"')) {
    updates['copywriter-d'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  if (msg.includes('copywriter-e') || msg.includes('copywriter e') || msg.includes('"comic"')) {
    updates['copywriter-e'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  if (msg.includes('[editor-c]') || msg.includes('editor-c')) {
    updates['editor-c'] = isError ? 'error' : isDone ? 'success' : 'working'
  } else if (msg.includes('[editor-b]') || msg.includes('editor-b')) {
    updates['editor-b'] = isError ? 'error' : isDone ? 'success' : 'working'
  } else if (msg.includes('[editor]') || msg.includes('edit') || msg.includes('review') || msg.includes('qa')) {
    updates.editor = isError ? 'error' : isDone ? 'success' : 'working'
    // When a generic editor event fires, nudge all 3 editors
    if (!updates['editor-b']) updates['editor-b'] = updates.editor
    if (!updates['editor-c']) updates['editor-c'] = updates.editor
  }
  if (msg.includes('publish') && (msg.includes('-a') || msg.includes('anime'))) {
    updates['publisher-a'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  if (msg.includes('publish') && (msg.includes('-b') || msg.includes('toys'))) {
    updates['publisher-b'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  if (msg.includes('publish') && (msg.includes('-c') || msg.includes('infotainment'))) {
    updates['publisher-c'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  if (msg.includes('publish') && (msg.includes('-d') || msg.includes('"game"'))) {
    updates['publisher-d'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  if (msg.includes('publish') && (msg.includes('-e') || msg.includes('comic'))) {
    updates['publisher-e'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  // Generic "publisher" fallback
  if (msg.includes('publish') && !updates['publisher-a'] && !updates['publisher-b'] && !updates['publisher-c']) {
    const state: NodeState = isError ? 'error' : isDone ? 'success' : 'working'
    updates['publisher-a'] = state
    updates['publisher-b'] = state
    updates['publisher-c'] = state
    updates['publisher-d'] = state
    updates['publisher-e'] = state
  }

  // Cycle complete — reset all to idle after short delay
  if (msg.includes('cycle complete') || msg.includes('pipeline complete') || msg.includes('all done')) {
    return {
      'seo-strategist': 'success',
      investigator: 'success',
      router: 'success',
      'copywriter-a': 'success',
      'copywriter-b': 'success',
      'copywriter-c': 'success',
      'copywriter-d': 'success',
      'copywriter-e': 'success',
      editor: 'success',
      'editor-b': 'success',
      'editor-c': 'success',
      'publisher-a': 'success',
      'publisher-b': 'success',
      'publisher-c': 'success',
      'publisher-d': 'success',
      'publisher-e': 'success',
    }
  }

  // Remove undefined values
  return Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined)) as Partial<NodeStates>
}

// ── SVG arrow component ──────────────────────────────────────────────────────
interface ArrowProps {
  x1: number; y1: number; x2: number; y2: number
  active?: boolean
  id: string
}

function PipelineArrow({ x1, y1, x2, y2, active = false, id }: ArrowProps) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)

  return (
    <g>
      <defs>
        <marker
          id={`arrowhead-${id}`}
          markerWidth="8"
          markerHeight="8"
          refX="4"
          refY="3"
          orient="auto"
        >
          <polygon
            points="0 0, 8 3, 0 6"
            fill={active ? 'rgba(245,158,11,0.8)' : 'rgba(245,158,11,0.3)'}
          />
        </marker>
      </defs>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={active ? 'rgba(245,158,11,0.7)' : 'rgba(245,158,11,0.25)'}
        strokeWidth={active ? 1.5 : 1}
        strokeDasharray={active ? 'none' : '4 4'}
        markerEnd={`url(#arrowhead-${id})`}
        style={{
          animation: active ? 'arrow-glow 1s ease-in-out infinite' : 'arrow-glow 3s ease-in-out infinite',
        }}
      />
      {/* Animated travel dot */}
      {active && (
        <circle r="3" fill="#F59E0B" style={{ filter: 'drop-shadow(0 0 4px rgba(245,158,11,0.9))' }}>
          <animateMotion
            dur="1.5s"
            repeatCount="indefinite"
            path={`M${x1},${y1} L${x2},${y2}`}
          />
        </circle>
      )}
      {!active && (
        <circle r="2.5" fill="rgba(245,158,11,0.5)">
          <animateMotion
            dur="3s"
            repeatCount="indefinite"
            path={`M${x1},${y1} L${x2},${y2}`}
          />
        </circle>
      )}
    </g>
  )
}

export default function OperationMap({
  settings,
  onSettingsUpdate,
  onTrigger,
  isRunning,
  onRunningChange,
}: OperationMapProps) {
  const [nodeStates, setNodeStates] = useState<NodeStates>(INITIAL_NODE_STATES)
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [configModal, setConfigModal] = useState<'anime' | 'toys' | 'infotainment' | 'game' | 'comic' | null>(null)
  const [seoModalOpen, setSeoModalOpen] = useState(false)
  const [investigatorModalOpen, setInvestigatorModalOpen] = useState(false)
  const [agentTasks, setAgentTasks] = useState<Record<string, AgentTask[]>>({})

  const handleNewLogEntry = useCallback((entry: LogEntry) => {
    setLogEntries((prev) => [...prev.slice(-499), entry])

    // Infer node state changes
    const stateUpdates = inferNodeStatesFromLog(entry.message, entry.level)
    if (Object.keys(stateUpdates).length > 0) {
      setNodeStates((prev) => ({ ...prev, ...stateUpdates }))
      onRunningChange(true)

      // Schedule reset to idle after inactivity
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current)
      resetTimeoutRef.current = setTimeout(() => {
        setNodeStates(INITIAL_NODE_STATES)
      }, 8000)
    }
  }, [onRunningChange])

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current)
    }
  }, [])

  // Poll agent task queues while pipeline is running (every 1.5s)
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    const poll = () => {
      fetch('/api/agent-tasks')
        .then((r) => r.json())
        .then((data) => setAgentTasks(data))
        .catch(() => {})
    }
    if (isRunning) {
      poll() // immediate first fetch
      interval = setInterval(poll, 1500)
    } else {
      // One final fetch after pipeline stops to capture last state
      setTimeout(poll, 800)
    }
    return () => { if (interval) clearInterval(interval) }
  }, [isRunning])

  const handleSaveConfig = useCallback(
    async (updates: Partial<Settings>) => {
      try {
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
        onSettingsUpdate(updates)
      } catch (err) {
        console.error('[OperationMap] Failed to save copywriter config:', err)
      }
    },
    [onSettingsUpdate]
  )

  const getNode = (id: NodeId) => NODE_DEFS.find((n) => n.id === id)!

  const isEdgeActive = (fromId: NodeId, toId: NodeId): boolean => {
    return nodeStates[fromId] === 'working' || nodeStates[toId] === 'working'
  }

  // ── Fixed-pixel layout (SVG px === CSS px, no scaling mismatch) ─────────
  // 5 copywriters fan out from router — equally spaced vertically
  const DIAGRAM_W = 1200
  const DIAGRAM_H = 460
  const NW = 60 // node half-width in px
  const NH = 36 // node half-height in px (reduced to fit 5 rows)

  // Node centers — 3 editors stacked vertically between copywriters and publishers
  const NC: Record<NodeId, { x: number; y: number }> = {
    'seo-strategist': { x: 80,   y: 231 },
    investigator:     { x: 265,  y: 231 },
    router:           { x: 450,  y: 231 },
    'copywriter-a':   { x: 630,  y: 65  },
    'copywriter-b':   { x: 630,  y: 148 },
    'copywriter-c':   { x: 630,  y: 231 },
    'copywriter-d':   { x: 630,  y: 314 },
    'copywriter-e':   { x: 630,  y: 397 },
    editor:           { x: 820,  y: 65  },
    'editor-b':       { x: 820,  y: 231 },
    'editor-c':       { x: 820,  y: 397 },
    'publisher-a':    { x: 1020, y: 65  },
    'publisher-b':    { x: 1020, y: 148 },
    'publisher-c':    { x: 1020, y: 231 },
    'publisher-d':    { x: 1020, y: 314 },
    'publisher-e':    { x: 1020, y: 397 },
  }

  const arrows: (ArrowProps & { id: string })[] = [
    // Spine
    { id: 'seo-inv', x1: NC['seo-strategist'].x + NW, y1: NC['seo-strategist'].y, x2: NC.investigator.x - NW, y2: NC.investigator.y },
    { id: 'inv-rtr', x1: NC.investigator.x + NW, y1: NC.investigator.y, x2: NC.router.x - NW, y2: NC.router.y },
    // Router → 5 Copywriters
    { id: 'rtr-cwa', x1: NC.router.x + NW - 4, y1: NC.router.y - 20, x2: NC['copywriter-a'].x - NW, y2: NC['copywriter-a'].y },
    { id: 'rtr-cwb', x1: NC.router.x + NW - 4, y1: NC.router.y - 10, x2: NC['copywriter-b'].x - NW, y2: NC['copywriter-b'].y },
    { id: 'rtr-cwc', x1: NC.router.x + NW,      y1: NC.router.y,      x2: NC['copywriter-c'].x - NW, y2: NC['copywriter-c'].y },
    { id: 'rtr-cwd', x1: NC.router.x + NW - 4, y1: NC.router.y + 10, x2: NC['copywriter-d'].x - NW, y2: NC['copywriter-d'].y },
    { id: 'rtr-cwe', x1: NC.router.x + NW - 4, y1: NC.router.y + 20, x2: NC['copywriter-e'].x - NW, y2: NC['copywriter-e'].y },
    // 5 Copywriters → 3 Editors (load-balanced — top CWs to editor A, middle to B, bottom to C)
    { id: 'cwa-edt',  x1: NC['copywriter-a'].x + NW, y1: NC['copywriter-a'].y, x2: NC.editor.x - NW,    y2: NC.editor.y },
    { id: 'cwb-edt',  x1: NC['copywriter-b'].x + NW, y1: NC['copywriter-b'].y, x2: NC.editor.x - NW,    y2: NC.editor.y + 12 },
    { id: 'cwc-edt',  x1: NC['copywriter-c'].x + NW, y1: NC['copywriter-c'].y, x2: NC['editor-b'].x - NW, y2: NC['editor-b'].y },
    { id: 'cwd-edt',  x1: NC['copywriter-d'].x + NW, y1: NC['copywriter-d'].y, x2: NC['editor-c'].x - NW, y2: NC['editor-c'].y - 12 },
    { id: 'cwe-edt',  x1: NC['copywriter-e'].x + NW, y1: NC['copywriter-e'].y, x2: NC['editor-c'].x - NW, y2: NC['editor-c'].y },
    // 3 Editors → 5 Publishers
    { id: 'edt-puba',  x1: NC.editor.x + NW,       y1: NC.editor.y,      x2: NC['publisher-a'].x - NW, y2: NC['publisher-a'].y },
    { id: 'edt-pubb',  x1: NC.editor.x + NW - 4,   y1: NC.editor.y + 8, x2: NC['publisher-b'].x - NW, y2: NC['publisher-b'].y },
    { id: 'edtb-pubc', x1: NC['editor-b'].x + NW,  y1: NC['editor-b'].y, x2: NC['publisher-c'].x - NW, y2: NC['publisher-c'].y },
    { id: 'edtc-pubd', x1: NC['editor-c'].x + NW - 4, y1: NC['editor-c'].y - 8, x2: NC['publisher-d'].x - NW, y2: NC['publisher-d'].y },
    { id: 'edtc-pube', x1: NC['editor-c'].x + NW,  y1: NC['editor-c'].y, x2: NC['publisher-e'].x - NW, y2: NC['publisher-e'].y },
  ]

  const isAnyEditorWorking = nodeStates.editor === 'working' || nodeStates['editor-b'] === 'working' || nodeStates['editor-c'] === 'working'
  const arrowActiveMap: Record<string, boolean> = {
    'seo-inv':  isEdgeActive('seo-strategist', 'investigator'),
    'inv-rtr':  isEdgeActive('investigator', 'router'),
    'rtr-cwa':  isEdgeActive('router', 'copywriter-a'),
    'rtr-cwb':  isEdgeActive('router', 'copywriter-b'),
    'rtr-cwc':  isEdgeActive('router', 'copywriter-c'),
    'rtr-cwd':  isEdgeActive('router', 'copywriter-d'),
    'rtr-cwe':  isEdgeActive('router', 'copywriter-e'),
    'cwa-edt':  nodeStates['copywriter-a'] === 'working' || isAnyEditorWorking,
    'cwb-edt':  nodeStates['copywriter-b'] === 'working' || isAnyEditorWorking,
    'cwc-edt':  nodeStates['copywriter-c'] === 'working' || nodeStates['editor-b'] === 'working',
    'cwd-edt':  nodeStates['copywriter-d'] === 'working' || nodeStates['editor-c'] === 'working',
    'cwe-edt':  nodeStates['copywriter-e'] === 'working' || nodeStates['editor-c'] === 'working',
    'edt-puba':  isEdgeActive('editor', 'publisher-a'),
    'edt-pubb':  isEdgeActive('editor', 'publisher-b'),
    'edtb-pubc': isEdgeActive('editor-b', 'publisher-c'),
    'edtc-pubd': isEdgeActive('editor-c', 'publisher-d'),
    'edtc-pube': isEdgeActive('editor-c', 'publisher-e'),
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Left column: diagram + controls */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          padding: '20px',
          flex: 1,
          overflowY: 'auto',
          minWidth: 0,
        }}
      >

      {/* Pipeline diagram */}
      <div
        style={{
          background: '#0D0D10',
          border: '1px solid #2A2A32',
          borderRadius: '10px',
          padding: '24px 20px 20px',
          position: 'relative',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          <span style={{ fontSize: '1rem' }}>🗺️</span>
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
            PIPELINE DIAGRAM
          </span>
          {isRunning && (
            <span
              style={{
                marginLeft: '8px',
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                color: '#F59E0B',
                fontSize: '0.5625rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                borderRadius: '4px',
                padding: '2px 8px',
                fontFamily: "'JetBrains Mono', monospace",
                animation: 'glow-pulse 1.5s ease-in-out infinite',
              }}
            >
              ⚡ ACTIVE
            </span>
          )}
        </div>

        {/* SVG arrows + Node overlays — fixed-pixel container */}
        <div style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', width: `${DIAGRAM_W}px`, height: `${DIAGRAM_H}px`, margin: '0 auto' }}>
          {/* SVG for arrows — 1 SVG unit = 1 CSS px */}
          <svg
            width={DIAGRAM_W}
            height={DIAGRAM_H}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              overflow: 'visible',
              pointerEvents: 'none',
            }}
            xmlns="http://www.w3.org/2000/svg"
          >
            {arrows.map((a) => (
              <PipelineArrow key={a.id} {...a} active={arrowActiveMap[a.id]} />
            ))}
          </svg>

          {/* Nodes — exact pixel positions matching SVG coordinates */}
          {(NODE_DEFS.map((def) => def.id) as NodeId[]).map((id) => {
            const def = getNode(id)
            const nc = NC[id]
            const leftPx = nc.x - NW
            const topPx = nc.y - NH
            const isCopywriter = id in COPYWRITER_BRAND
            const isSeoStrategist = id === 'seo-strategist'
            const isInvestigator = id === 'investigator'
            const isClickable = isCopywriter || isSeoStrategist || isInvestigator
            const brandId = COPYWRITER_BRAND[id] ?? 'anime'
            const nicheKey = COPYWRITER_NICHE_KEY[id]
            const hasCustomNiche = isCopywriter && !!(typeof settings[nicheKey] === 'string' && settings[nicheKey].trim())
            const seoIsConfigured = isSeoStrategist && (
              (settings.seoShortTail ?? 2) !== 2 || (settings.seoEvergreen ?? 1) !== 1
            )
            const investigatorIsConfigured = isInvestigator && (
              (settings.investigatorDedupeHours ?? 24) !== 24 || (settings.investigatorMaxSameFranchise ?? 1) !== 1
            )
            const showBadge = (isCopywriter && hasCustomNiche) || (isSeoStrategist && seoIsConfigured) || (isInvestigator && investigatorIsConfigured)
            const accent = NODE_ACCENT[id] ?? '#F59E0B'
            const nodeTasks: AgentTask[] = (agentTasks[id] ?? []) as AgentTask[]

            return (
              <div
                key={id}
                onClick={
                  isCopywriter ? () => setConfigModal(brandId)
                  : isSeoStrategist ? () => setSeoModalOpen(true)
                  : isInvestigator ? () => setInvestigatorModalOpen(true)
                  : undefined
                }
                style={{
                  position: 'absolute',
                  left: `${leftPx}px`,
                  top: `${topPx}px`,
                  zIndex: 2,
                  cursor: isClickable ? 'pointer' : 'default',
                }}
              >
                {/* Config indicator badge */}
                {showBadge && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '-8px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: '#10B981',
                      color: '#fff',
                      fontSize: '0.45rem',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      zIndex: 10,
                      fontFamily: "'JetBrains Mono', monospace",
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                    }}
                  >
                    ✦ CONFIGURED
                  </div>
                )}
                {/* Click hint for configurable nodes */}
                {isClickable && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '-18px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: `${accent}E6`,
                      color: '#000',
                      fontSize: '0.42rem',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      padding: '2px 5px',
                      borderRadius: '3px',
                      zIndex: 3,
                      fontFamily: "'JetBrains Mono', monospace",
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      opacity: 0,
                      transition: 'opacity 0.15s ease',
                    }}
                    className="click-hint"
                  >
                    ⚙ CONFIGURE
                  </div>
                )}
                <FlipPipelineNode
                  id={def.id}
                  label={def.label}
                  icon={def.icon}
                  state={nodeStates[id]}
                  subtitle={def.subtitle}
                  tasks={nodeTasks}
                  accentColor={accent}
                  nodeWidth={NW * 2}
                  nodeHeight={NH * 2}
                />
              </div>
            )
          })}

        </div>
        </div>
      </div>

      {/* Master controls */}
      <MasterControls
        settings={settings}
        onUpdate={onSettingsUpdate}
        onTrigger={onTrigger}
        isRunning={isRunning}
      />

      </div>{/* end left column */}

      {/* Right panel: Terminal log */}
      <div
        style={{
          width: '360px',
          flexShrink: 0,
          borderLeft: '1px solid #2A2A32',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <TerminalLog
          entries={logEntries}
          maxHeight="100%"
          onNewEntry={handleNewLogEntry}
        />
      </div>

      {/* Copywriter Config Modals */}
      {configModal && (
        <CopywriterConfigModal
          brandId={configModal}
          settings={settings}
          onSave={handleSaveConfig}
          onClose={() => setConfigModal(null)}
        />
      )}

      {/* SEO Strategist Config Modal */}
      {seoModalOpen && (
        <SeoStrategistModal
          settings={settings}
          onSave={handleSaveConfig}
          onClose={() => setSeoModalOpen(false)}
        />
      )}

      {/* Investigator Config Modal */}
      {investigatorModalOpen && (
        <InvestigatorConfigModal
          settings={settings}
          onSave={handleSaveConfig}
          onClose={() => setInvestigatorModalOpen(false)}
        />
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        div:hover > .click-hint { opacity: 1 !important; }
      ` }} />
    </div>
  )
}
