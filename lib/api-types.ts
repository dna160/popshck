/**
 * Shared type definitions for all API endpoints.
 * Ensures consistency across the backend.
 */

// ============================================================================
// ENUMS
// ============================================================================

export enum ArticleStatus {
  Drafted = 'Drafted',
  DraftingInProgress = 'Drafting',
  PendingReview = 'Pending Review',
  ReviewCompleted = 'Review Completed',
  Approved = 'Approved',
  Published = 'Published',
  Failed = 'Failed',
}

export enum InsightStatus {
  Pending = 'Pending',
  Approved = 'Approved',
  Dismissed = 'Dismissed',
}

export enum TargetAgent {
  Investigator = 'Investigator',
  CopywriterA = 'Copywriter-A',
  CopywriterB = 'Copywriter-B',
  CopywriterC = 'Copywriter-C',
  CopywriterD = 'Copywriter-D',
  CopywriterE = 'Copywriter-E',
  Editor = 'Editor',
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface ProcessNewsRequest {
  cycleId?: string // Optional: for manual triggers with specific cycle ID
  skipCache?: boolean // Optional: force reprocess even if seen before
}

export interface ProcessNewsResponse {
  cycleId: string
  status: 'queued' | 'in-progress' | 'completed' | 'failed'
  message: string
  timestamp: string
}

export interface ArticleListQuery {
  status?: ArticleStatus | string
  brandId?: string
  cycleId?: string
  limit?: number
  offset?: number
}

export interface ArticleUpdateRequest {
  title?: string
  content?: string
  status?: ArticleStatus | string
}

export interface ArticlePublishRequest {
  // Publish endpoint may accept additional metadata
  notifySlack?: boolean // Optional: send Slack notification
}

export interface ArticlePublishResponse {
  article: {
    id: string
    title: string
    status: string
    wpPostId?: string
  }
  wpPostId: number
  wpLink: string
  timestamp: string
}

export interface InsightUpdateRequest {
  status: InsightStatus | string
  targetAgent?: string
}

export interface InsightListQuery {
  status?: InsightStatus | string
  targetAgent?: TargetAgent | string
  limit?: number
}

export interface PipelineStatusResponse {
  isRunning: boolean
  currentCycleId?: string
  currentStage?: string
  progress?: {
    stage: string
    itemsProcessed: number
    itemsTotal: number
  }
  lastCycleId?: string
  lastCycleStatus?: string
  lastCycleTimestamp?: string
  uptime: number // seconds
}

export interface StreamEventType {
  stage: string
  level: 'info' | 'warn' | 'error' | 'success'
  message: string
  timestamp: string
  duration?: number // milliseconds
  tokens?: number
  cost?: number
}

// ============================================================================
// DATABASE TYPES (Prisma models)
// ============================================================================

export interface Article {
  id: string
  cycleId: string
  brandId: string
  status: string
  title: string
  content: string
  sourceUrl?: string | null
  sourceTitle?: string | null
  reviewResult?: string | null
  wpPostId?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Insight {
  id: string
  targetAgent: string
  suggestionText: string
  status: string
  createdAt: Date
}

export interface Settings {
  id: string
  scrapeFrequency: string
  requireReview: boolean
  isLive: boolean
  targetNiche: string
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export interface ErrorResponse {
  error: string
  code?: string
  details?: Record<string, unknown>
  timestamp?: string
}

export interface ValidationError extends Omit<ErrorResponse, 'details'> {
  code: 'VALIDATION_ERROR'
  details: {
    field: string
    message: string
  }[]
}

// ============================================================================
// WORKFLOW TYPES
// ============================================================================

export interface ReviewResult {
  status: 'PASS' | 'FAIL'
  reason: string
  issues: string[]
  suggestions: string[]
}

export interface DraftOutput {
  title: string
  content: string
}

export interface PublishResult {
  id: number
  link: string
}

// ============================================================================
// METRICS & OBSERVABILITY
// ============================================================================

export interface StageMetrics {
  stage: string
  status: 'success' | 'failure' | 'partial'
  duration_ms: number
  items_processed: number
  items_failed: number
  tokens_used: number
  cost_usd: number
  errors: string[]
}

export interface CycleMetrics {
  cycleId: string
  startedAt: string
  completedAt?: string
  totalDuration_ms: number
  stages: StageMetrics[]
  totalTokens: number
  totalCost: number
  articleCount: number
  publishedCount: number
}
