// ─────────────────────────────────────────────
//  Shared Types for Pantheon Newsroom
// ─────────────────────────────────────────────

export type ArticleStatus = 'Drafting' | 'Revising' | 'Pending Review' | 'Published' | 'Failed'
export type InsightStatus = 'Pending' | 'Approved' | 'Dismissed'
export type TargetAgent = 'Investigator' | 'Copywriter-A' | 'Copywriter-B' | 'Copywriter-C' | 'Copywriter-D' | 'Copywriter-E'

export interface Article {
  id: string
  cycleId: string
  brandId: string // 'anime' | 'toys' | 'infotainment' | 'game' | 'comic'
  status: ArticleStatus
  title: string
  content: string
  sourceUrl?: string
  sourceTitle?: string
  reviewResult?: string // JSON: { status: 'PASS'|'FAIL', reason: string }
  wpPostId?: string
  featuredImage?: string
  images?: string // JSON: string[] of additional image URLs (index 1+)
  revisionCount?: number
  createdAt: string
  updatedAt: string
}

export interface Insight {
  id: string
  targetAgent: TargetAgent
  suggestionText: string
  status: InsightStatus
  createdAt: string
}

export interface Settings {
  id: string
  scrapeFrequency: '10s' | '1h' | '4h' | '12h' | '24h'
  requireReview: boolean
  isLive: boolean
  targetNiche: string
  nicheA: string
  nicheB: string
  nicheC: string
  nicheD: string
  nicheE: string
  toneA: string
  toneB: string
  toneC: string
  toneD: string
  toneE: string
  rssSourcesA: string
  rssSourcesB: string
  rssSourcesC: string
  rssSourcesD: string
  rssSourcesE: string
  imageCountA: number
  imageCountB: number
  imageCountC: number
  imageCountD: number
  imageCountE: number
  seoDedupeHours: number
  seoShortTail: number
  seoEvergreen: number
  investigatorDedupeHours: number
  investigatorMaxSameFranchise: number
}

export interface LogEntry {
  level: 'info' | 'success' | 'error' | 'warn'
  message: string
  timestamp: string
}

export interface AgentTask {
  id: string
  description: string
  status: 'queued' | 'in-progress' | 'done' | 'failed'
  addedAt: number
}

export type NodeState = 'idle' | 'working' | 'success' | 'error'
export type NodeId =
  | 'seo-strategist-a'
  | 'seo-strategist-b'
  | 'seo-strategist-c'
  | 'seo-strategist-d'
  | 'seo-strategist-e'
  | 'investigator-a'
  | 'investigator-b'
  | 'investigator-c'
  | 'investigator-d'
  | 'investigator-e'
  | 'copywriter-a'
  | 'copywriter-b'
  | 'copywriter-c'
  | 'copywriter-d'
  | 'copywriter-e'
  | 'editor'
  | 'editor-b'
  | 'editor-c'
  | 'publisher-a'
  | 'publisher-b'
  | 'publisher-c'
  | 'publisher-d'
  | 'publisher-e'
  // ── Destination endpoints ────────────────────────────────────────────────
  | 'website'
  | 'social-media'
  | 'video'
