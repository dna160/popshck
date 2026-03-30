'use client'

import { useState, useCallback } from 'react'
import SystemStatusBar from './SystemStatusBar'
import TabNav, { type ActiveTab } from './TabNav'
import OperationMap from './OperationMap'
import WarRoom from './WarRoom'
import { usePolling } from '@/hooks/usePolling'
import { api } from '@/lib/api-client'
import type { Settings, LogEntry } from '@/types'

export default function PantheonDashboard() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('operation-map')
  const [isRunning, setIsRunning] = useState(false)
  const [cycleCount, setCycleCount] = useState(0)
  const [lastRunAt, setLastRunAt] = useState<string | null>(null)
  // Immediate local override — applied on save so UI never shows stale values
  const [settingsOverride, setSettingsOverride] = useState<Settings | null>(null)
  // ── Persistent System Log (survives tab switches) ──────────────────────────
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])

  const handleNewLogEntry = useCallback((entry: LogEntry) => {
    setLogEntries((prev) => [...prev.slice(-499), entry])
  }, [])

  const handleClearLog = useCallback(() => {
    setLogEntries([])
  }, [])

  // ── Settings ───────────────────────────────────────────────────────────────
  const {
    data: settingsData,
    error: settingsError,
    refetch: refetchSettings,
  } = usePolling(async () => {
    const res = await api.getSettings()
    // Sync external process state into local dashboard state
    if (res && 'pipelineRunning' in res) {
      setIsRunning(!!res.pipelineRunning)
    }
    return res
  }, 10_000)

  // settingsOverride takes priority — it is set immediately on every successful PUT
  // so the UI reflects the saved state without waiting for the 10-second poll.
  const settings = settingsOverride ?? settingsData?.settings ?? null

  const handleSettingsUpdate = useCallback(
    async (partial: Partial<Settings>) => {
      try {
        const res = await api.updateSettings(partial)
        // Immediately apply the full settings returned by the server — no polling lag
        if (res?.settings) {
          setSettingsOverride(res.settings)
        }
        refetchSettings() // also kick the poller so it stays in sync
      } catch (err) {
        console.error('Failed to update settings:', err)
      }
    },
    [refetchSettings]
  )

  // ── Pipeline trigger ───────────────────────────────────────────────────────
  const handleTrigger = useCallback(async () => {
    try {
      setIsRunning(true)
      const result = await api.triggerPipeline()
      setLastRunAt(new Date().toISOString())
      setCycleCount((c) => c + 1)
      console.log('Pipeline triggered:', result.cycleId, result.message)
    } catch (err) {
      console.error('Failed to trigger pipeline:', err)
      setIsRunning(false)
    }
  }, [])

  // ── Default settings fallback ──────────────────────────────────────────────
  const activeSettings: Settings = settings ?? {
    id: 'default',
    scrapeFrequency: '4h',
    requireReview: false,
    isLive: false,
    targetNiche: 'Loading…',
    nicheA: '',
    nicheB: '',
    nicheC: '',
    nicheD: '',
    nicheE: '',
    toneA: '',
    toneB: '',
    toneC: '',
    toneD: '',
    toneE: '',
    rssSourcesA: '',
    rssSourcesB: '',
    rssSourcesC: '',
    rssSourcesD: '',
    rssSourcesE: '',
    imageCountA: 1,
    imageCountB: 1,
    imageCountC: 1,
    imageCountD: 1,
    imageCountE: 1,
    seoDedupeHours: 24,
    seoShortTail: 2,
    seoEvergreen: 1,
    investigatorDedupeHours: 24,
    investigatorMaxSameFranchise: 1,
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#0A0A0B',
        overflow: 'hidden',
      }}
    >
      {/* Settings error banner */}
      {settingsError && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#FCA5A5',
            fontSize: '0.75rem',
            padding: '6px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <span>⚠️</span>
          <span>Settings API unavailable — using defaults. {settingsError}</span>
        </div>
      )}

      <SystemStatusBar
        settings={settings}
        isRunning={isRunning}
        cycleCount={cycleCount}
        lastRunAt={lastRunAt}
      />

      <TabNav activeTab={activeTab} onChange={setActiveTab} />

      {/* Main content area */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'operation-map' ? (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <OperationMap
              settings={activeSettings}
              onSettingsUpdate={handleSettingsUpdate}
              onTrigger={handleTrigger}
              isRunning={isRunning}
              onRunningChange={setIsRunning}
              logEntries={logEntries}
              onNewLogEntry={handleNewLogEntry}
              onClearLog={handleClearLog}
            />
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            <WarRoom />
          </div>
        )}
      </div>
    </div>
  )
}
