# SYNTAX INDEX — Pantheon Newsroom
> **Purpose:** Single source of truth for every variable, type, function, and constant in this codebase. If you are touching any of these names, read this first.
>
> Stack: Next.js 14 · TypeScript · Prisma (SQLite) · Anthropic Claude Haiku · Tailwind CSS

---

## Table of Contents
1. [Directory Tree](#1-directory-tree)
2. [Data Model (Database & Types)](#2-data-model)
3. [Brand / Agent Identity Constants](#3-brand--agent-identity-constants)
4. [lib/ — Core Library Modules](#4-lib--core-library-modules)
5. [app/api/ — REST Endpoints](#5-appapi--rest-endpoints)
6. [components/ — React UI](#6-components--react-ui)
7. [hooks/ — React Hooks](#7-hooks--react-hooks)
8. [Environment Variables](#8-environment-variables)
9. [Pipeline Data-Flow Diagram](#9-pipeline-data-flow-diagram)
10. [Naming Conventions & Rules](#10-naming-conventions--rules)

---

## 1. Directory Tree

```
pantheon-newsroom/
├── app/
│   ├── api/                      ← All Next.js Route Handlers (server-only)
│   │   ├── agent-tasks/          ← GET live task store
│   │   ├── articles/             ← Article CRUD
│   │   │   └── [id]/
│   │   │       ├── approve/      ← POST → publish to WordPress
│   │   │       └── update-live/  ← POST → update an already-published WP post
│   │   ├── dedup/clear/          ← POST → wipe seen-URL cache
│   │   ├── insights/             ← Insight CRUD
│   │   │   └── [id]/
│   │   │       ├── approve/
│   │   │       └── dismiss/
│   │   ├── metrics/              ← GET pipeline cost/token metrics
│   │   ├── mock-wordpress/       ← Fake WP endpoint for local dev
│   │   ├── pipeline-status/      ← GET is pipeline running?
│   │   ├── process-news/         ← POST trigger / POST abort
│   │   ├── settings/             ← GET + PUT settings (uses raw SQL)
│   │   └── stream/               ← GET SSE log stream
│   ├── globals.css               ← Global styles + utility classes
│   ├── layout.tsx                ← Root Next.js layout
│   └── page.tsx                  ← Root page → renders <PantheonDashboard>
│
├── components/                   ← All React UI components
│   ├── PantheonDashboard.tsx     ← Root shell / state hub
│   ├── OperationMap.tsx          ← Pipeline diagram (SVG + nodes)
│   ├── FlipPipelineNode.tsx      ← Animated flip-card for each agent node
│   ├── PipelineNode.tsx          ← Simple static node variant
│   ├── MasterControls.tsx        ← Run / Abort / Toggle Live controls
│   ├── SystemStatusBar.tsx       ← Top status bar with niche pills
│   ├── TabNav.tsx                ← Tab navigation component
│   ├── TerminalLog.tsx           ← Real-time SSE log display
│   ├── WarRoom.tsx               ← Articles + Insights split view
│   ├── ArticleSidebar.tsx        ← Article list with status filters
│   ├── ArticleEditor.tsx         ← Article content editor
│   ├── InsightsPanel.tsx         ← Agent insights feed
│   ├── SeoStrategistModal.tsx    ← SEO config modal
│   ├── CopywriterConfigModal.tsx ← Per-brand config modal
│   ├── InvestigatorConfigModal.tsx
│   ├── StatusBadge.tsx           ← Reusable status pill
│   ├── EmptyState.tsx            ← Empty list placeholder
│   ├── LoadingSpinner.tsx
│   └── ErrorBoundary.tsx
│
├── lib/                          ← Server-side business logic (never import in client components)
│   ├── pipeline.ts               ← ⭐ MAIN ORCHESTRATOR — full pipeline cycle
│   ├── llm.ts                    ← All Anthropic API calls
│   ├── rss-fetcher.ts            ← RSS feed fetching
│   ├── seo-strategist.ts         ← SEO directive generation
│   ├── article-scraper.ts        ← Multi-page web scraping
│   ├── image-resolver.ts         ← Image search + OG scraping
│   ├── wordpress.ts              ← WordPress REST publish/update
│   ├── social-media.ts           ← Instagram/social caption generation
│   ├── instagram.ts              ← Instagram Graph API
│   ├── searcher.ts               ← Serper news search
│   ├── dedup.ts                  ← Seen-URL deduplication store
│   ├── metrics.ts                ← Token/cost tracking
│   ├── scheduler.ts              ← Cron-based auto-run scheduler
│   ├── api-client.ts             ← Frontend fetch wrapper (client-safe)
│   ├── api-types.ts              ← Shared API request/response types
│   ├── error-handler.ts          ← AppError classes + route helpers
│   ├── fetch.ts                  ← Low-level enhanced fetch utility
│   ├── logger.ts                 ← EventEmitter log bus
│   ├── prisma.ts                 ← Prisma client singleton
│   └── prompts.ts                ← STAGE_PROMPTS constant map
│
├── hooks/                        ← React custom hooks (client-safe)
│   ├── useArticles.ts
│   ├── useInsights.ts
│   ├── usePipeline.ts
│   ├── usePolling.ts
│   └── useWebSocket.ts
│
├── types/
│   └── index.ts                  ← ⭐ All shared TypeScript types (import from here)
│
├── prisma/
│   └── schema.prisma             ← Database schema (SQLite)
│
├── data/
│   └── seen-urls.json            ← Runtime dedup store (auto-managed)
│
└── scripts/                      ← Dev/test scripts (run with ts-node)
    ├── test-brand-voice.ts
    ├── test-editor-loop.ts
    └── test-image-review.ts
```

---

## 2. Data Model

### 2.1 Database Tables (`prisma/schema.prisma`)

#### `Article`
The primary content unit. Created by the pipeline, edited by humans, published to WordPress.

| Column | Type | Notes |
|---|---|---|
| `id` | `String` UUID | Primary key |
| `cycleId` | `String` | Which pipeline run created it |
| `brandId` | `String` | `'anime' \| 'toys' \| 'infotainment' \| 'game' \| 'comic'` |
| `status` | `String` | See `ArticleStatus` type below |
| `title` | `String` | Article headline |
| `content` | `String` | Full HTML/markdown body |
| `sourceUrl` | `String?` | Original source URL |
| `sourceTitle` | `String?` | Original source headline |
| `reviewResult` | `String?` | **JSON string**: `{ status: 'PASS'\|'FAIL', reason: string }` |
| `wpPostId` | `String?` | WordPress post ID after publish |
| `featuredImage` | `String?` | Primary image URL |
| `images` | `String?` | **JSON string**: `string[]` of additional image URLs |
| `revisionCount` | `Int` | How many editor revision cycles happened |
| `createdAt` | `DateTime` | Auto-set |
| `updatedAt` | `DateTime` | Auto-updated |

> ⚠️ `reviewResult` and `images` are JSON-encoded strings. Always `JSON.parse()` before use.

#### `Insight`
Feedback/suggestions generated by agents, reviewed by a human operator.

| Column | Type | Notes |
|---|---|---|
| `id` | `String` UUID | Primary key |
| `targetAgent` | `String` | Which agent this targets — see `TargetAgent` type |
| `suggestionText` | `String` | The recommendation text |
| `status` | `String` | `'Pending' \| 'Approved' \| 'Dismissed'` |
| `createdAt` | `DateTime` | Auto-set |

#### `SeoDirective`
One record per pipeline cycle storing all the keyword directives produced by the SEO Strategist.

| Column | Type | Notes |
|---|---|---|
| `id` | `String` UUID | Primary key |
| `cycleId` | `String` | Unique per cycle |
| `directives` | `String` | **JSON string**: `InvestigatorDirective[]` |
| `createdAt` | `DateTime` | Auto-set |

#### `Settings`
Singleton row (`id = "singleton"`). Always read extended fields with raw SQL — **never rely on Prisma client alone** (see §4.1 `getSettings()`).

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | `String` | `"singleton"` | Always this value |
| `scrapeFrequency` | `String` | `"4h"` | `'10s'\|'1h'\|'4h'\|'12h'\|'24h'` |
| `requireReview` | `Boolean` | `false` | Hold articles in `Pending Review` before publishing |
| `isLive` | `Boolean` | `false` | Master kill-switch — pipeline only publishes when `true` |
| `targetNiche` | `String` | | Legacy global niche (prefer per-brand `nicheA–E`) |
| `nicheA–E` | `String` | `""` | Per-brand niche/topic string fed into LLM prompts |
| `toneA–E` | `String` | Brand defaults | Per-brand voice/tone instruction injected into LLM system prompt |
| `rssSourcesA–E` | `String` | `""` | Comma-separated RSS URLs for each brand |
| `imageCountA–E` | `Int` | `1` | Max images per article per brand |
| `seoDedupeHours` | `Int` | `24` | How many hours back to check for duplicate SEO keywords |
| `seoShortTail` | `Int` | `2` | Short-tail directives per brand per cycle |
| `seoEvergreen` | `Int` | `1` | Evergreen directives per brand per cycle |
| `investigatorDedupeHours` | `Int` | `24` | Investigator duplicate window |
| `investigatorMaxSameFranchise` | `Int` | `1` | Max articles per franchise/IP per cycle |

---

### 2.2 TypeScript Types (`types/index.ts`)

> **Rule:** Always import shared types from `@/types`, not from individual lib files.

```typescript
// Article lifecycle states
type ArticleStatus = 'Drafting' | 'Revising' | 'Pending Review' | 'Published' | 'Failed'

// Insight review states
type InsightStatus = 'Pending' | 'Approved' | 'Dismissed'

// Agent identifiers used in the Insight system
type TargetAgent =
  | 'Investigator'
  | 'Copywriter-A' | 'Copywriter-B' | 'Copywriter-C'
  | 'Copywriter-D' | 'Copywriter-E'

// UI node visual states
type NodeState = 'idle' | 'working' | 'success' | 'error'

// All pipeline node IDs — used in OperationMap to key node state
type NodeId =
  | 'seo-strategist' | 'investigator' | 'router'
  | 'copywriter-a' | 'copywriter-b' | 'copywriter-c' | 'copywriter-d' | 'copywriter-e'
  | 'editor' | 'editor-b' | 'editor-c'
  | 'publisher-a' | 'publisher-b' | 'publisher-c' | 'publisher-d' | 'publisher-e'
  | 'website' | 'social-media' | 'video'   // destination endpoints
```

#### `Article` interface
```typescript
interface Article {
  id: string
  cycleId: string
  brandId: string          // 'anime' | 'toys' | 'infotainment' | 'game' | 'comic'
  status: ArticleStatus
  title: string
  content: string
  sourceUrl?: string
  sourceTitle?: string
  reviewResult?: string    // JSON — parse before reading
  wpPostId?: string
  featuredImage?: string
  images?: string          // JSON string[] — parse before reading
  revisionCount?: number
  createdAt: string
  updatedAt: string
}
```

#### `Insight` interface
```typescript
interface Insight {
  id: string
  targetAgent: TargetAgent
  suggestionText: string
  status: InsightStatus
  createdAt: string
}
```

#### `Settings` interface
```typescript
interface Settings {
  id: string
  scrapeFrequency: '10s' | '1h' | '4h' | '12h' | '24h'
  requireReview: boolean
  isLive: boolean
  targetNiche: string
  nicheA: string; nicheB: string; nicheC: string; nicheD: string; nicheE: string
  toneA: string;  toneB: string;  toneC: string;  toneD: string;  toneE: string
  rssSourcesA: string; rssSourcesB: string; rssSourcesC: string; rssSourcesD: string; rssSourcesE: string
  imageCountA: number; imageCountB: number; imageCountC: number; imageCountD: number; imageCountE: number
  seoDedupeHours: number
  seoShortTail: number
  seoEvergreen: number
  investigatorDedupeHours: number
  investigatorMaxSameFranchise: number
}
```

#### `LogEntry` interface
```typescript
interface LogEntry {
  level: 'info' | 'success' | 'error' | 'warn'
  message: string
  timestamp: string   // ISO 8601
}
```

#### `AgentTask` interface
Real-time per-agent work items, stored in memory (not DB), polled every 1s by the UI.
```typescript
interface AgentTask {
  id: string
  description: string
  status: 'queued' | 'in-progress' | 'done' | 'failed'
  addedAt: number   // Date.now()
}
```

---

## 3. Brand / Agent Identity Constants

These constants live in `lib/pipeline.ts` and are the **single source of truth** for brand mappings. Never hardcode brand names elsewhere — always reference these.

### `BASE_BRANDS` — Brand ↔ Settings Key Map
```typescript
const BASE_BRANDS = [
  { id: 'anime',        settingsNicheKey: 'nicheA', settingsToneKey: 'toneA' },
  { id: 'toys',         settingsNicheKey: 'nicheB', settingsToneKey: 'toneB' },
  { id: 'infotainment', settingsNicheKey: 'nicheC', settingsToneKey: 'toneC' },
  { id: 'game',         settingsNicheKey: 'nicheD', settingsToneKey: 'toneD' },
  { id: 'comic',        settingsNicheKey: 'nicheE', settingsToneKey: 'toneE' },
]
```

### `BRAND_AGENT_NAME` — Brand → Copywriter Agent ID
```typescript
const BRAND_AGENT_NAME: Record<string, string> = {
  'anime':        'Copywriter-A',
  'toys':         'Copywriter-B',
  'infotainment': 'Copywriter-C',
  'game':         'Copywriter-D',
  'comic':        'Copywriter-E',
}
```

### `BRAND_DISPLAY_NAME` — Brand → Human-readable label
```typescript
const BRAND_DISPLAY_NAME: Record<string, string> = {
  'anime':        'Anime & Manga',
  'toys':         'Toys & Collectibles',
  'infotainment': 'Infotainment & Celebrity',
  'game':         'Gaming & Esports',
  'comic':        'Comics & Superheroes',
}
```

### `BRAND_DEFAULT_NICHE` — Brand → Default topic string (used if `nicheA–E` is empty)
```typescript
const BRAND_DEFAULT_NICHE: Record<string, string> = {
  'anime':        'anime, manga, Japanese animation, otaku culture, light novels...',
  'toys':         'toys, collectibles, action figures, model kits...',
  'infotainment': 'celebrity news, entertainment, viral trends...',
  'game':         'gaming, video games, esports, game releases...',
  'comic':        'comics, graphic novels, manga, superhero movies...',
}
```

### `BRAND_TONE_KEY` — Brand → Settings key for tone/voice
```typescript
const BRAND_TONE_KEY: Record<string, keyof ExtendedSettings> = {
  'anime': 'toneA', 'toys': 'toneB', 'infotainment': 'toneC',
  'game': 'toneD', 'comic': 'toneE',
}
```

### `BRAND_IMAGE_COUNT_KEY` — Brand → Settings key for image count
```typescript
const BRAND_IMAGE_COUNT_KEY: Record<string, keyof ExtendedSettings> = {
  'anime': 'imageCountA', 'toys': 'imageCountB', 'infotainment': 'imageCountC',
  'game': 'imageCountD', 'comic': 'imageCountE',
}
```

### LLM Brand Guidelines (`lib/llm.ts`)
Per-brand system prompt constants injected into every `draftArticle` / `reviseArticle` call if no custom `toneA–E` is configured:

| Constant | Brand |
|---|---|
| `ANIME_GUIDELINES` | anime |
| `TOYS_GUIDELINES` | toys |
| `INFOTAINMENT_GUIDELINES` | infotainment |
| `GAME_GUIDELINES` | game |
| `COMIC_GUIDELINES` | comic |
| `BRAND_GUIDELINES` | `Record<string, string>` — key is brand ID |

---

## 4. lib/ — Core Library Modules

### 4.1 `lib/pipeline.ts` ⭐ Main Orchestrator

This is the largest file (~76KB). It runs the full article generation cycle. **All pipeline logic lives here.**

#### State Accessors
```typescript
// Returns the current in-memory pipeline state object (not DB)
function state(): PipelineState

// Returns true if a pipeline cycle is currently running
function getPipelineRunning(): boolean

// Sends an abort signal to the running pipeline cycle
function abortPipelineCycle(): void

// Throws if the pipeline AbortController has been signalled (call inside long loops)
function checkAbort(): void
```

#### Agent Task Store (in-memory, polled by UI)
```typescript
// Returns all tasks grouped by agentId
function getAllAgentTasks(): Record<string, AgentTask[]>

// Returns internal task store reference (avoid mutating directly)
function agentTaskStore(): Record<string, AgentTask[]>

// Remove all tasks (called at start of each cycle)
function clearAllAgentTasks(): void

// Add a new task for an agent — returns the generated taskId
function addAgentTask(agentId: string, description: string): string

// Update task status: 'queued' | 'in-progress' | 'done' | 'failed'
// ⚠️ Only use 'failed' for actual system errors, not editorial decisions
function updateAgentTask(agentId: string, taskId: string, status: AgentTask['status']): void
```

#### Concurrency
```typescript
// Creates a semaphore limiting parallel promises to `concurrency`
// Usage: const sem = makeSemaphore(3); await sem(() => doWork())
function makeSemaphore(concurrency: number): (fn: () => Promise<void>) => Promise<void>
```

#### Settings
```typescript
// Reads Settings from DB using BOTH Prisma and raw SQL (to capture extended fields)
// ⚠️ NEVER read settings with plain prisma.settings.findUnique() — extended fields will be undefined
// Priority: { ...defaults, ...prismaRow, ...rawSqlExtendedFields }
async function getSettings(): Promise<ExtendedSettings>
```

#### Pipeline Workers
```typescript
// Handles social media caption generation and Instagram posting for a published article
async function postToSocialMedia(
  article: { title: string; content: string; featuredImage?: string | null },
  publishedUrl: string,
  signal?: AbortSignal
): Promise<void>

// Runs image review for an article — returns true if image quota was met
async function runImageReview(
  articleId: string,
  articleTitle: string,
  sourceText: string,
  targetImageCount: number
): Promise<boolean>

// One editor worker instance — processes articles from its queue
// editorId: 'editor' | 'editor-b' | 'editor-c'
async function runEditorWorker(
  editorId: string,
  queue: string[],
  articleSourceMap: Record<string, string>,
  results: { firstPassIds: string[]; revisedPassIds: string[]; allPassedIds: string[] },
  isDone: () => boolean,
  settings: ExtendedSettings,
  brandNiches: Record<string, string>,
  seenDirectiveKeys: Set<string>,
  draftCounter: { done: number; total: number },
): Promise<void>

// THE main entry point — runs a full pipeline cycle
// isManual: true when triggered by user button, false when triggered by scheduler
// Returns: cycle summary string
async function runPipelineCycle(isManual?: boolean): Promise<string>
```

#### Internal helpers inside `runPipelineCycle`
```typescript
// Search Serper news for a single SEO directive
const searchDirective = async (directive) => SearchResult[]

// Parse a string of comma/newline-separated URLs into an array
const parseUrls = (s: string) => string[]
```

---

### 4.2 `lib/llm.ts` — Anthropic API Calls

All calls use `claude-haiku-4-5-20251001` by default.

#### Configuration Constants
```typescript
const MODEL = 'claude-haiku-4-5-20251001'
const RETRY_MAX_ATTEMPTS = 5        // LLM retry attempts
const RETRY_BASE_DELAY_MS = 10_000  // Base delay for rate-limit backoff
const JSON_RETRY_DELAY_MS = 5_000   // Delay between JSON parse retry attempts
const IMAGE_FETCH_TIMEOUT_MS = 8_000
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
```

#### Core LLM Functions

```typescript
// Returns the singleton Anthropic client (lazy-init)
function getClient(): Anthropic

// Pause execution — respects AbortSignal
function sleep(ms: number, signal?: AbortSignal): Promise<void>

// Wraps any async call with exponential backoff retry
// Use for ALL Anthropic API calls
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>

// Stage 1: Determine if a headline/summary belongs to the given niche
// Returns true = relevant, false = skip
async function triageArticle(
  headline: string,
  summary: string,
  niche: string,
  signal?: AbortSignal,
  brandContext?: { name: string; tone?: string }
): Promise<boolean>

// Stage 3: Generate a full article draft from raw scraped text
// brandId must be one of: 'anime' | 'toys' | 'infotainment' | 'game' | 'comic'
// brandGuidelines is the tone string from settings (toneA–E) or BRAND_GUIDELINES fallback
async function draftArticle(
  rawText: string,
  brandId: string,
  brandGuidelines: string,
  signal?: AbortSignal
): Promise<{ title: string; content: string }>

// Stage 4: Quality review — checks the draft against source material
// Returns PASS/FAIL + reason + incompleteInfo flag
async function reviewArticle(
  draft: string,
  sourceText: string,
  signal?: AbortSignal
): Promise<{ status: 'PASS' | 'FAIL'; reason: string; incompleteInfo: boolean }>

// Download an image URL and return it as base64 for Claude Vision
// Uses magic-byte MIME detection (not Content-Type header)
// Returns null if download fails or type unsupported
async function fetchImageAsBase64(
  imageUrl: string
): Promise<{ data: string; media_type: AllowedImageMediaType } | null>

// Claude Vision review: is this image appropriate for the article?
// Returns PASS/FAIL + reason
async function reviewImage(
  imageUrl: string,
  articleTitle: string,
  articleSubject: string,
  signal?: AbortSignal
): Promise<{ status: 'PASS' | 'FAIL'; reason: string }>

// Filter new SEO directives against already-published headlines to avoid duplicate angles
// Returns array of safe keyword strings to keep
async function filterDirectivesAgainstPublished(
  directives: Array<{ keyword: string; type: string; angle: string }>,
  publishedHeadlines: string[],
  signal?: AbortSignal
): Promise<string[]>

// Group articles by IP/franchise (e.g. "One Piece", "Toyota") — returns IDs to keep
async function deduplicateByFranchise(
  items: Array<{ id: string; title: string; summary: string }>,
  signal?: AbortSignal,
  maxPerFranchise?: number
): Promise<string[]>

// Detect if multiple SEO directives target the same topic
async function detectTopicConcentration(
  directiveResults: Array<{ keyword: string; titles: string[] }>,
  signal?: AbortSignal
): Promise<{ duplicateKeywords: string[]; dominantTopics: string[] }>

// Revise an existing draft based on editorial notes — returns updated { title, content }
// Used in the editor feedback loop
async function reviseArticle(
  currentDraft: { title: string; content: string },
  editorialNotes: string,
  sourceText: string,
  brandId: string,
  brandGuidelines: string,
  signal?: AbortSignal
): Promise<{ title: string; content: string }>

// Generate copywriter self-feedback insight for the Insights panel
async function generateCopywriterFeedback(
  draft: string,
  brandId: string,
  niche: string,
  signal?: AbortSignal
): Promise<string>

// Generate investigator feedback for the Insights panel
async function generateInvestigatorFeedback(
  sourcesUsed: string[],
  niche: string,
  signal?: AbortSignal
): Promise<string>
```

---

### 4.3 `lib/rss-fetcher.ts` — RSS Feed Fetching

```typescript
const FEED_TIMEOUT_MS = 10_000  // Per-feed timeout

interface FeedItem {
  title: string
  summary: string
  url: string
  source: string
  publishedAt?: string
  featuredImage?: string
}

interface FetchFeedsOptions {
  niche?: string            // Broker against NICHE_FEED_MAP
  customFeeds?: string      // Comma-separated URLs from settings.rssSourcesA–E
  maxItems?: number         // Total item cap across all feeds
}

// Match a niche string to canonical feed groups (NICHE_FEED_MAP)
function resolveFeedsForNiche(niche: string): { url: string; name: string }[]

// Parse a comma-separated feed URL string into feed descriptors
function parseCustomFeeds(raw: string): { url: string; name: string }[]

// Generate mock FeedItems for testing when no real feeds are available
function buildMockArticles(niches: string[]): FeedItem[]

// Strip HTML tags from a string
function stripHtml(html: string): string

// Extract the featured image from an RSS item using fallback strategies:
// enclosure → media:content → og:image in summary HTML → first img tag
function extractFeaturedImage(item: any, rawHtml: string): string | undefined

// Fetch one RSS feed with a timeout
async function fetchFeedWithTimeout(
  feedUrl: string,
  feedName: string,
  timeoutMs: number
): Promise<FeedItem[]>

// Fetch RSS feeds matching a specific topic/keyword (used by investigator per-directive)
async function fetchFeedsForTopic(
  topicKeyword: string,
  brandNiche: string,
  customFeeds?: string,
  maxItems?: number
): Promise<FeedItem[]>

// Main RSS fetch entry point — combines niche feeds + custom feeds
async function fetchAllFeeds(opts?: FetchFeedsOptions): Promise<FeedItem[]>
```

---

### 4.4 `lib/seo-strategist.ts` — SEO Directive Generation

```typescript
interface InvestigatorDirective {
  brand: string                    // Brand ID
  topic_type: 'short-tail' | 'evergreen'
  target_keyword: string           // Main keyword to target
  search_intent: string            // Why users search for this
  angle: string                    // Editorial angle for the article
  suggested_search_queries: string[] // 3 search queries for the Investigator
}

interface SeoStrategyOutput {
  directives: InvestigatorDirective[]
}

const BRAND_IDS = ['anime', 'toys', 'infotainment', 'game', 'comic'] as const

// Get keywords used in recent pipeline cycles (for dedup)
async function getRecentKeywords(hours: number): Promise<string[]>

// Build the LLM system prompt for the SEO Strategist
function buildStrategistPrompt(
  niches: Record<string, string>,
  shortTailPerBrand: number,
  evergreenPerBrand: number,
  recentKeywords: string[],
  extraAvoidTopics?: string[]
): string

// Build a replacement prompt for a single brand directive
function buildReplacementPrompt(
  brand: string,
  niche: string,
  topicType: 'short-tail' | 'evergreen',
  avoidTopics: string[]
): string

// Generate all SEO directives for the cycle
// shortTailPerBrand and evergreenPerBrand control article quota per brand
async function generateSeoDirectives(
  niches: { nicheA: string; nicheB: string; nicheC?: string; nicheD?: string; nicheE?: string },
  signal?: AbortSignal,
  options?: {
    dedupeHours?: number
    shortTailPerBrand?: number
    evergreenPerBrand?: number
    extraAvoidTopics?: string[]
  }
): Promise<InvestigatorDirective[]>

// Generate a single replacement directive (called when topic concentration is detected)
async function generateReplacementDirective(
  brand: string,
  niche: string,
  topicType: 'short-tail' | 'evergreen',
  avoidTopics: string[],
  signal?: AbortSignal
): Promise<InvestigatorDirective | null>
```

---

### 4.5 `lib/article-scraper.ts` — Web Scraping

```typescript
const SCRAPE_TIMEOUT_MS = 12_000  // Per-page timeout
const MAX_PAGES = 3               // Max pagination pages to follow
const MAX_CHARS_PER_PAGE = 6_000  // Text cap per page

// Strip content to readable text (removes scripts, styles, nav elements)
function extractReadableText(html: string): string

// Find a "next page" pagination link in raw HTML
function findNextPageUrl(html: string, currentUrl: string): string | null

// Scrape full article content, following up to MAX_PAGES pagination links
async function scrapeArticleContent(
  url: string,
  signal?: AbortSignal
): Promise<{ content: string; pagesScraped: number }>
```

---

### 4.6 `lib/image-resolver.ts` — Image Resolution

```typescript
const SCRAPE_TIMEOUT_MS = 6_000
const SEARCH_TIMEOUT_MS = 8_000

// Search Serper for images (requires SERPER_API_KEY)
async function searchImagesSerper(query: string, maxCount: number): Promise<string[]>

// Fetch og:image from an article page URL
async function scrapeOgImage(url: string): Promise<string | undefined>

// Extract search-friendly keywords from article title + summary
function extractSearchKeywords(title: string, summary: string): string

// DuckDuckGo image search fallback
async function searchImagesDDG(query: string, maxCount: number): Promise<string[]>

// Resolve multiple images for a FeedItem (tries og:image → DDG → Serper)
async function resolveItemImages(item: FeedItem, count?: number): Promise<string[]>

// Resolve a single image for a FeedItem
async function resolveItemImage(item: FeedItem): Promise<string | undefined>

// Find replacement images when the original fails review
async function searchReplacementImage(
  title: string,
  subject: string,
  excludeUrls: string[],
  count?: number
): Promise<string[]>
```

---

### 4.7 `lib/wordpress.ts` — WordPress Publishing

```typescript
const WP_RETRY_MAX_ATTEMPTS = 4
const WP_RETRY_BASE_DELAY_MS = 10_000

type WPBackend = 'mock' | 'wpcom' | 'selfhosted'

interface WPPublishResult {
  id: string      // WordPress post ID
  url: string     // Published article URL
}

// Simple delay (no abort support)
function wpSleep(ms: number): Promise<void>

// Retry wrapper for WordPress API calls (no abort support)
async function withWpRetry(fn: () => Promise<Response>): Promise<Response>

// Read WP credentials from environment variables
// Returns endpoint URLs and auth header
function getWPCredentials(): {
  postsEndpoint: string
  updateEndpoint: (postId: string) => string
  authHeader: string
  backend: WPBackend
}

// Upload an image from URL to WordPress media library
// Returns WordPress media attachment ID
async function uploadMediaFromUrl(
  imageUrl: string,
  siteHostname: string,
  authHeader: string
): Promise<number | undefined>

// Create a new WordPress post from an article
async function publishToWordPress(article: {
  title: string
  content: string
  brandId: string
  featuredImageUrl?: string
}): Promise<WPPublishResult>

// Update an existing WordPress post (must have wpPostId)
async function updateWordPressPost(
  wpPostId: string,
  article: { title: string; content: string }
): Promise<void>
```

---

### 4.8 `lib/dedup.ts` — URL Deduplication Store

Prevents the pipeline from processing the same article URL twice.

```typescript
const DATA_DIR  // = ./data/
const DEDUP_FILE  // = ./data/seen-urls.json

// Ensure ./data/ directory exists
function ensureDataDir(): void

// Read the full seen-URL store from disk
function readStore(): Record<string, boolean>

// Write the store back to disk (atomic write)
function writeStore(store: Record<string, boolean>): void

// SHA-256 hash a URL for storage key
function hashUrl(url: string): string

// Check if a URL has already been processed
async function hasBeenSeen(url: string): Promise<boolean>

// Mark a URL as processed
async function markAsSeen(url: string): Promise<void>

// Wipe the entire seen-URL store (called by /api/dedup/clear)
async function clearStore(): Promise<void>
```

---

### 4.9 `lib/searcher.ts` — Serper News Search

```typescript
interface SearchResult {
  title: string
  url: string
  snippet: string
  source: string
  publishedAt?: string
}

const SERPER_ENDPOINT = 'https://google.serper.dev/news'
const SEARCH_TIMEOUT_MS = 10_000

// Search Serper for news articles matching a query
async function searchNews(query: string, maxResults?: number): Promise<SearchResult[]>

// Run multiple queries in parallel, deduplicate results by URL
async function searchMultiple(queries: string[], maxPerQuery?: number): Promise<SearchResult[]>
```

---

### 4.10 `lib/scheduler.ts` — Cron Scheduler

```typescript
const CRON_MAP: Record<string, string> = {
  '10s': '*/10 * * * * *',
  '1h':  '0 * * * *',
  '4h':  '0 */4 * * *',
  '12h': '0 */12 * * *',
  '24h': '0 0 * * *',
}

// Start the cron scheduler with the given frequency key ('1h', '4h', etc.)
function startScheduler(frequency: string): void

// Stop the running scheduler
function stopScheduler(): void

// Returns true if scheduler is running
function isRunning(): boolean

// Returns the current frequency key, or null if not running
function getCurrentFrequency(): string | null
```

---

### 4.11 `lib/metrics.ts` — Token & Cost Tracking

```typescript
const PRICING = {
  input_tokens_per_mtok: 0.80,   // $0.80 per 1M input tokens
  output_tokens_per_mtok: 4.0,   // $4.00 per 1M output tokens
}

class MetricsCollector {
  constructor(cycleId: string)

  // Record a pipeline stage result with timing + token usage
  recordStage(
    stageName: string,
    status: 'success' | 'failure' | 'partial',
    options: {
      duration_ms: number
      items_processed: number
      items_failed?: number
      input_tokens?: number
      output_tokens?: number
      errors?: string[]
    }
  ): void

  // Returns a CycleMetrics snapshot (call at end of cycle)
  finalize(): CycleMetrics

  // Format CycleMetrics as a human-readable log string
  static formatMetrics(metrics: CycleMetrics): string

  // Estimate USD cost for a given token count
  static estimateCost(inputTokens: number, outputTokens: number): number
}

class CycleMetricsStore {
  addCycle(metrics: CycleMetrics): void
  getCycle(cycleId: string): CycleMetrics | undefined
  getLatest(limit?: number): CycleMetrics[]
  getAggregates(): {
    totalCycles: number; totalArticles: number; totalPublished: number
    totalCost: number; avgDuration_ms: number; avgCost: number
  }
}

// Get the global singleton CycleMetricsStore
function getMetricsStore(): CycleMetricsStore
```

---

### 4.12 `lib/logger.ts` — Log Event Bus

```typescript
type LogLevel = 'info' | 'success' | 'error' | 'warn'

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
}

// Global EventEmitter shared across Next.js hot reloads via global.__pantheonLogEmitter
const logEmitter: EventEmitter

// Emit a log entry to the bus — consumed by SSE stream in /api/stream
// Use this everywhere instead of console.log inside pipeline/lib code
function log(level: LogLevel, message: string): void
```

---

### 4.13 `lib/api-client.ts` — Frontend API Wrapper

Safe for use inside React components (client-side). Never import `lib/pipeline.ts` or other server-only libs from components — use these methods instead.

```typescript
// Generic fetch with JSON parsing and error throwing
async function request<T>(url: string, options?: RequestInit): Promise<T>

const api = {
  // Articles
  getArticles: () => Promise<Article[]>
  getArticle: (id: string) => Promise<Article>
  updateArticle: (id: string, data: Partial<Article>) => Promise<Article>
  approveArticle: (id: string) => Promise<{ url: string }>
  updateLiveArticle: (id: string) => Promise<void>
  deleteAllArticles: () => Promise<void>

  // Insights
  getInsights: (status?: string) => Promise<Insight[]>
  getAllInsights: () => Promise<Insight[]>
  approveInsight: (id: string) => Promise<void>
  dismissInsight: (id: string) => Promise<void>
  dismissAllInsights: () => Promise<void>

  // Agent tasks (live task store)
  getAgentTasks: (targetAgent?: string) => Promise<Record<string, AgentTask[]>>

  // Pipeline control
  triggerPipeline: () => Promise<void>
  abortPipeline: () => Promise<void>
  getPipelineStatus: () => Promise<{ running: boolean }>

  // Settings
  getSettings: () => Promise<{ settings: Settings; schedulerRunning: boolean; pipelineRunning: boolean }>
  updateSettings: (data: Partial<Settings>) => Promise<Settings>
}
```

---

### 4.14 `lib/error-handler.ts` — Error Classes & Route Helpers

```typescript
// Base error class — extends Error with HTTP status code
class AppError extends Error {
  constructor(message: string, status?: number, code?: string, details?: Record<string, unknown>)
}

class ValidationAppError extends AppError { /* fields: Array<{field, message}> */ }
class NotFoundError extends AppError       { constructor(resource: string, id: string) }
class ConflictError extends AppError       { constructor(message: string) }
class RateLimitError extends AppError      { /* 429 */ }
class UnauthorizedError extends AppError   { /* 401 */ }

// Convert any thrown error to a standardised ErrorResponse object
function formatErrorResponse(error: unknown): ErrorResponse

// Convert any thrown error to a Next.js NextResponse JSON response
function createErrorResponse(error: unknown): NextResponse

// Validation helpers (throw ValidationAppError on failure)
function validateUUID(id: string, fieldName?: string): void
function validateNonEmptyString(value: string, fieldName: string): void
function validateEnum<T>(value: string, enumObj: T, fieldName: string): void
function validateRequest<T>(data: unknown, requiredFields: string[]): T

// Log error to console with context
function logError(context: string, error: unknown): void
function logErrorWithContext(context: string, error: unknown, context_data?: Record<string, unknown>): void
```

---

### 4.15 `lib/social-media.ts` and `lib/instagram.ts`

```typescript
// social-media.ts
// Generate a social media post caption using Claude
async function generateSocialPost(
  article: { title: string; content: string },
  publishedUrl: string,
  signal?: AbortSignal
): Promise<string>   // Returns caption string

// instagram.ts
function isInstagramConfigured(): boolean  // Check if IG_USER_ID + IG_ACCESS_TOKEN are set

async function publishToInstagram(
  imageUrl: string,
  caption: string
): Promise<{ id: string }>
```

---

### 4.16 `lib/prompts.ts` — Prompt Templates

```typescript
const STAGE_PROMPTS = {
  triage:   (headline, summary, niche) => string,
  draft:    (rawText, brandId, brandGuidelines) => string,
  review:   (draft, sourceText) => string,
  revision: (draft, notes, sourceText, brandGuidelines) => string,
  // ... (check file for full list)
}

type StageName = keyof typeof STAGE_PROMPTS
```

---

## 5. app/api/ — REST Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/articles` | `GET` | List articles (filter by `?status=`) |
| `/api/articles` | `DELETE` | Delete all articles |
| `/api/articles/[id]` | `GET` | Get one article |
| `/api/articles/[id]` | `PUT` | Update title/content/status |
| `/api/articles/[id]/approve` | `POST` | Publish to WordPress, set status `Published` |
| `/api/articles/[id]/update-live` | `POST` | Push edits to already-published WP post |
| `/api/insights` | `GET` | List insights |
| `/api/insights` | `DELETE` | Dismiss all insights |
| `/api/insights/[id]/approve` | `POST` | Mark insight Approved |
| `/api/insights/[id]/dismiss` | `POST` | Mark insight Dismissed |
| `/api/agent-tasks` | `GET` | Returns live in-memory `agentTaskStore()` |
| `/api/metrics` | `GET` | Returns `CycleMetricsStore.getLatest()` |
| `/api/pipeline-status` | `GET` | Returns `{ running: boolean, schedulerRunning: boolean }` |
| `/api/process-news` | `POST` | Trigger a pipeline cycle (`runPipelineCycle(true)`) |
| `/api/process-news/abort` | `POST` | Call `abortPipelineCycle()` |
| `/api/settings` | `GET` | Read Settings + scheduler state |
| `/api/settings` | `PUT` | Update Settings (raw SQL for extended fields) |
| `/api/dedup/clear` | `POST` | Call `clearStore()` |
| `/api/stream` | `GET` | SSE log stream (subscribe to `logEmitter`) |
| `/api/mock-wordpress/[id]` | `GET/POST/PATCH` | Fake WordPress for local dev |

---

## 6. components/ — React UI

### `PantheonDashboard` — Root Shell
```typescript
function PantheonDashboard()
```
- Owns global state: `settings`, `settingsOverride`, `isRunning`, `logEntries`, `cycleCount`
- Polls `/api/settings` every 5s and `/api/pipeline-status` every 1s (when running)
- `settingsOverride` is applied immediately after a PUT to avoid stale-polling revert window
- Renders tabs: **Operation Map** | **War Room** (Articles + Insights) | **Terminal**

### `OperationMap` — Pipeline Diagram
```typescript
interface OperationMapProps {
  settings: Settings
  onSettingsUpdate: (data: Partial<Settings>) => Promise<void>
  onTrigger: () => Promise<void>
  isRunning: boolean
  onRunningChange: (v: boolean) => void
  logEntries: LogEntry[]
  onNewLogEntry: (e: LogEntry) => void
  onClearLog: () => void
}
function OperationMap(props: OperationMapProps)
```
- Polls `/api/agent-tasks` every 1s when `isRunning`
- Uses `inferNodeStatesFromLog` to infer node states from SSE log messages
- `getNodeState(agentIds)` reads live task arrays to determine `isActive` / `hasError`
- Key internal constants: `NODE_ACCENT`, `NODE_DEFS`, `NODE_AGENT_IDS`, `COPYWRITER_BRAND`

### `FlipPipelineNode` — Agent Node Card
```typescript
interface FlipPipelineNodeProps {
  id: string
  label: string
  icon: string
  state: NodeState      // 'idle' | 'working' | 'success' | 'error'
  subtitle?: string
  tasks?: AgentTask[]   // Live task array from agentTaskStore
  accentColor: string
  nodeWidth?: number
  nodeHeight?: number
  isActive?: boolean
  hasError?: boolean
}
function FlipPipelineNode(props: FlipPipelineNodeProps)
```
- Front face: node icon + status indicator
- Back face (on hover): scrollable task list with status icons

### `MasterControls` — Pipeline Control Bar
```typescript
interface MasterControlsProps {
  settings: Settings
  onUpdate: (data: Partial<Settings>) => Promise<void>
  onTrigger: () => Promise<void>
  isRunning: boolean
}
// Internal handlers:
// handleTrigger()     — POST /api/process-news
// handleLiveToggle()  — Toggle settings.isLive via onUpdate
// handleClearCache()  — POST /api/dedup/clear
// handleAbort()       — POST /api/process-news/abort
```

### `WarRoom` — Articles + Insights Split View
```typescript
function WarRoom()
// Renders ArticleSidebar (left) + ArticleEditor (right) + InsightsPanel (bottom)
// Self-contained — fetches its own articles and insights
```

### `ArticleSidebar` — Article List
```typescript
interface ArticleSidebarProps {
  articles: Article[]
  selectedId: string | null
  onSelect: (id: string) => void
  onClearAll: () => void
}
// Filter tabs: 'All' | ArticleStatus values
// BrandBadge sub-component renders colored brand pill using BRAND_CONFIG constant
```

### `ArticleEditor` — Content Editor
```typescript
interface ArticleEditorProps {
  article: Article
  onSave: (data: { title: string; content: string }) => Promise<void>
  onApprove: (id: string) => Promise<void>
  onUpdateLive: (id: string) => Promise<void>
}
// Ctrl+S / Cmd+S triggers handleSave()
// useDebounce<T>(value, delay) — local debounce hook
// parseReviewResult(raw?) — parses reviewResult JSON string safely
```

### `InsightsPanel` — Agent Feedback Feed
```typescript
interface InsightsPanelProps {
  insights: Insight[]
  onApprove: (id: string) => Promise<void>
  onDismiss: (id: string) => Promise<void>
  onClearAll: () => void
}
// Filter tabs: 'All' | TargetAgent values
// AGENT_CONFIG constant maps TargetAgent → { icon, label, color, bg }
```

### `TerminalLog` — Live Log Display
```typescript
interface TerminalLogProps {
  entries: LogEntry[]
  maxHeight?: string
  onNewEntry?: (e: LogEntry) => void
  onClear?: () => void
}
// Auto-scrolls to bottom when new entries arrive
// LEVEL_COLOR and LEVEL_LABEL constants map log levels to terminal colors/labels
```

### `SystemStatusBar` — Top Status Strip
```typescript
interface SystemStatusBarProps {
  settings: Settings
  isRunning: boolean
  cycleCount: number
  lastRunAt: string | null   // ISO string
}
// Renders 5 brand niche pills reading settings.nicheA–E
```

---

## 7. hooks/ — React Hooks

```typescript
// Fetch and manage the articles list (polls every 5s)
function useArticles(): {
  articles: Article[]
  loading: boolean
  error: string | null
  refresh: () => void
  updateArticle: (id: string, data: Partial<Article>) => Promise<void>
  approveArticle: (id: string) => Promise<{ url: string }>
}

// Fetch and manage the insights list
function useInsights(): {
  insights: Insight[]
  loading: boolean
  error: string | null
  refresh: () => void
  approveInsight: (id: string) => Promise<void>
  dismissInsight: (id: string) => Promise<void>
}

// Manage pipeline run state and settings
function usePipeline(): {
  settings: Settings | null
  isRunning: boolean
  schedulerRunning: boolean
  loading: boolean
  trigger: () => Promise<void>
  updateSettings: (data: Partial<Settings>) => Promise<void>
  refresh: () => void
}

// Generic polling hook
function usePolling<T>(fetcher: () => Promise<T>, interval: number): {
  data: T | null
  loading: boolean
  error: Error | null
}

// WebSocket hook (currently unused; SSE is preferred for logs)
function useWebSocket<T>(
  url: string,
  onMessage?: (data: T) => void,
  options?: { reconnectInterval?: number; maxReconnectAttempts?: number }
): { isConnected: boolean; send: (data: unknown) => void }
```

---

## 8. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Claude API key for all LLM calls |
| `SERPER_API_KEY` | ✅ | Google news/image search via Serper |
| `DATABASE_URL` | ✅ | SQLite URL e.g. `file:./data/pantheon.db` |
| `WP_URL` | ✅ | WordPress site root URL |
| `WP_USER` | ✅ | WordPress username |
| `WP_APP_PASSWORD` | ✅ | WordPress application password |
| `WP_BACKEND` | ⚠️ | `mock` \| `wpcom` \| `selfhosted` (default: detects from `WP_URL`) |
| `IG_USER_ID` | Optional | Instagram Business account user ID |
| `IG_ACCESS_TOKEN` | Optional | Instagram Graph API access token |
| `NEXT_PUBLIC_BASE_URL` | Optional | Base URL for API client (defaults to window.location) |

---

## 9. Pipeline Data-Flow Diagram

```
RSS Feeds (niche-matched + custom per brand)
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  SEO STRATEGIST  (lib/seo-strategist.ts)                │
│  generateSeoDirectives() → InvestigatorDirective[]      │
│  - shortTailPerBrand (settings.seoShortTail)            │
│  - evergreenPerBrand (settings.seoEvergreen)            │
│  - dedupes against recent SeoDirective DB records       │
└────────────────────────┬────────────────────────────────┘
                         │ directives[]
                         ▼
┌─────────────────────────────────────────────────────────┐
│  INVESTIGATOR  (inside runPipelineCycle)                │
│  searchMultiple(directive.suggested_search_queries)     │
│  fetchFeedsForTopic() per directive                     │
│  scrapeArticleContent() for each hit URL               │
│  hasBeenSeen() dedup check                             │
└────────────────────────┬────────────────────────────────┘
                         │ FeedItem[] + scraped text
                         ▼
┌─────────────────────────────────────────────────────────┐
│  ROUTER (triage in runPipelineCycle)                    │
│  triageArticle() → relevant? yes/no                     │
│  deduplicateByFranchise() → filter same-IP dupes       │
│  Route to brand queue: anime / toys / infotainment      │
│                         game / comic                    │
└───┬──────┬──────┬──────┬──────┬──────────────────────┘
    │      │      │      │      │
    ▼      ▼      ▼      ▼      ▼
  CW-A   CW-B   CW-C   CW-D   CW-E
(anime)(toys)(info)(game)(comic)
    │
    │ draftArticle(rawText, brandId, brandGuidelines)
    ▼
┌─────────────────────────────────────────────────────────┐
│  EDITOR POOL  (runEditorWorker × 3, semaphore-limited)  │
│  reviewArticle() → PASS / FAIL                          │
│  If FAIL: reviseArticle() up to MAX_REVISIONS          │
│  If incompleteInfo: re-scrape source → revise           │
│  runImageReview() → find + review images via Vision    │
└────────────────────────┬────────────────────────────────┘
                         │ approved articles
                         ▼
┌───────────────┬─────────────────┬──────────────────────┐
│   WEBSITE     │  SOCIAL MEDIA   │       VIDEO           │
│ publishTo     │ generateSocial  │  (future)             │
│ WordPress()   │ Post()          │                       │
│               │ publishToInsta  │                       │
│               │ gram()          │                       │
└───────────────┴─────────────────┴──────────────────────┘
```

---

## 10. Naming Conventions & Rules

### ⚠️ Critical Rules

1. **Never import server-only lib files in React components.** Use `lib/api-client.ts` (`api.*`) instead.

2. **Never read `Settings` with `prisma.settings.findUnique()` alone.** Always use `getSettings()` from `lib/pipeline.ts` which adds the raw SQL fallback for extended fields.

3. **Never use `updateAgentTask(..., 'failed')` for editorial decisions** (skipping irrelevant content, routing decisions, brand mismatch). Use `'done'`. Only use `'failed'` for actual system exceptions.

4. **Never hardcode brand IDs as strings.** Use the `BASE_BRANDS` array or `BRAND_*` constants.

5. **`reviewResult` and `images` on `Article` are JSON strings.** Always `JSON.parse()` them before use.

6. **All log output must go through `log(level, message)`** from `lib/logger.ts` — not `console.log` — so messages reach the SSE stream and the terminal UI.

### Naming Patterns

| Pattern | Example | Meaning |
|---|---|---|
| `brandId` | `'anime'` | Lowercase brand slug — always one of the 5 known brands |
| `nicheA–E` | `settings.nicheA` | Per-brand niche string in Settings |
| `toneA–E` | `settings.toneA` | Per-brand LLM voice/tone in Settings |
| `rssSourcesA–E` | `settings.rssSourcesA` | Comma-separated feed URLs per brand |
| `imageCountA–E` | `settings.imageCountA` | Max images per article per brand |
| `cycleId` | `"a1b2c3d4"` | UUID identifying a pipeline run |
| `agentId` | `'investigator'` | Lowercase hyphenated agent identifier |
| `taskId` | `"uuid-..."` | UUID for a single AgentTask entry |
| `wpPostId` | `"12345"` | WordPress post ID as string |
| `NodeId` | `'copywriter-a'` | Lowercase hyphenated pipeline node ID |
| `TargetAgent` | `'Copywriter-A'` | Title-case agent for Insights system |

### File Conventions

| Rule | Example |
|---|---|
| Lib files: camelCase | `lib/rss-fetcher.ts` |
| Components: PascalCase | `components/ArticleEditor.tsx` |
| Hooks: `use` prefix | `hooks/useArticles.ts` |
| API routes: `route.ts` | `app/api/articles/route.ts` |
| Types: exported from `types/index.ts` | `import type { Article } from '@/types'` |
