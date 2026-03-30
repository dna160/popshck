import { v4 as uuidv4 } from 'uuid'
import { prisma } from './prisma'
import { log } from './logger'
import { hasBeenSeen, markAsSeen } from './dedup'
import { fetchAllFeeds, type FeedItem } from './rss-fetcher'
import {
  triageArticle,
  draftArticle,
  reviseArticle,
  reviewArticle,
  reviewImage,
  generateCopywriterFeedback,
  generateInvestigatorFeedback,
  detectTopicConcentration,
  deduplicateByFranchise,
  filterDirectivesAgainstPublished,
  BRAND_GUIDELINES,
} from './llm'
import { publishToWordPress } from './wordpress'
import { generateSocialPost } from './social-media'
import { publishToInstagram, isInstagramConfigured } from './instagram'
import { resolveItemImages, searchReplacementImage } from './image-resolver'
import { generateSeoDirectives, generateReplacementDirective, type InvestigatorDirective } from './seo-strategist'
import { searchMultiple } from './searcher'

// Base brands — niche & tone overrides are loaded per cycle from Settings
const BASE_BRANDS = [
  { id: 'anime',        settingsNicheKey: 'nicheA' as const, settingsToneKey: 'toneA' as const },
  { id: 'toys',         settingsNicheKey: 'nicheB' as const, settingsToneKey: 'toneB' as const },
  { id: 'infotainment', settingsNicheKey: 'nicheC' as const, settingsToneKey: 'toneC' as const },
  { id: 'game',         settingsNicheKey: 'nicheD' as const, settingsToneKey: 'toneD' as const },
  { id: 'comic',        settingsNicheKey: 'nicheE' as const, settingsToneKey: 'toneE' as const },
]

const BRAND_IMAGE_COUNT_KEY: Record<string, keyof ExtendedSettings> = {
  'anime':        'imageCountA',
  'toys':         'imageCountB',
  'infotainment': 'imageCountC',
  'game':         'imageCountD',
  'comic':        'imageCountE',
}

const BRAND_AGENT_NAME: Record<string, string> = {
  'anime':        'Copywriter-A',
  'toys':         'Copywriter-B',
  'infotainment': 'Copywriter-C',
  'game':         'Copywriter-D',
  'comic':        'Copywriter-E',
}

const BRAND_DISPLAY_NAME: Record<string, string> = {
  'anime':        'Anime & Manga',
  'toys':         'Toys & Collectibles',
  'infotainment': 'Infotainment & Celebrity',
  'game':         'Gaming & Esports',
  'comic':        'Comics & Superheroes',
}

// Meaningful niche defaults used when a copywriter's niche field is left blank.
// These are used by the Router for triage — better than the generic global targetNiche.
const BRAND_DEFAULT_NICHE: Record<string, string> = {
  'anime':        'anime, manga, Japanese animation, otaku culture, light novels, anime streaming, anime movie releases',
  'toys':         'toys, collectibles, action figures, hobby merchandise, Funko Pop, LEGO, trading cards, pop culture merchandise',
  'infotainment': 'celebrity news, trending entertainment, viral stories, pop culture events, movies, TV shows, music',
  'game':         'video games, esports, gaming hardware, game releases, gaming culture, PC gaming, console gaming, mobile gaming',
  'comic':        'comics, graphic novels, manga, superhero media, Marvel, DC, comic book adaptations, anime-based comics',
}

const BRAND_TONE_KEY: Record<string, keyof ExtendedSettings> = {
  'anime':        'toneA',
  'toys':         'toneB',
  'infotainment': 'toneC',
  'game':         'toneD',
  'comic':        'toneE',
}

// ── Pipeline state ────────────────────────────────────────────────────────────
// Stored on globalThis so it survives Next.js HMR module reloads in development.
// Without this, the abort route would import a freshly-reset module instance and
// call abort on an AbortController that has nothing to do with the running cycle.
// ─────────────────────────────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __pipelineState: {
    running: boolean
    shouldAbort: boolean
    controller: AbortController | null
  } | undefined
}

function state() {
  if (!globalThis.__pipelineState) {
    globalThis.__pipelineState = { running: false, shouldAbort: false, controller: null }
  }
  return globalThis.__pipelineState
}

export let pipelineAbortController: AbortController | null = null

export function getPipelineRunning(): boolean {
  return state().running
}

export function abortPipelineCycle(): void {
  const s = state()
  if (s.running) {
    s.shouldAbort = true
    s.controller?.abort()
    // Keep module-level ref in sync for callers that read it directly
    pipelineAbortController = s.controller
    log('warn', '[PIPELINE] Abort signal received. Terminating safely.')
  } else {
    log('warn', '[PIPELINE] Abort called but no pipeline is running.')
  }
}

function checkAbort() {
  const s = state()
  if (s.shouldAbort || s.controller?.signal.aborted) {
    log('error', '[PIPELINE] Process killed by user.')
    throw new Error('Pipeline manually aborted by user')
  }
}

// ── Per-agent task queue ──────────────────────────────────────────────────────
// Stored on globalThis so it survives HMR and is readable by /api/agent-tasks.
interface AgentTask {
  id: string
  description: string
  status: 'queued' | 'in-progress' | 'done' | 'failed'
  addedAt: number
}

declare global {
  // eslint-disable-next-line no-var
  var __agentTasks: Record<string, AgentTask[]> | undefined
}

function agentTaskStore(): Record<string, AgentTask[]> {
  if (!globalThis.__agentTasks) globalThis.__agentTasks = {}
  return globalThis.__agentTasks
}

export function getAllAgentTasks(): Record<string, AgentTask[]> {
  return agentTaskStore()
}

export function clearAllAgentTasks(): void {
  globalThis.__agentTasks = {}
}

function addAgentTask(agentId: string, description: string): string {
  const store = agentTaskStore()
  if (!store[agentId]) store[agentId] = []
  const id = uuidv4()
  store[agentId].unshift({ id, description, status: 'queued', addedAt: Date.now() })
  // Keep the last 25 tasks per agent; drop oldest
  if (store[agentId].length > 25) store[agentId].length = 25
  return id
}

function updateAgentTask(agentId: string, taskId: string, status: AgentTask['status']): void {
  const task = agentTaskStore()[agentId]?.find((t) => t.id === taskId)
  if (task) task.status = status
}

// ── Concurrency limiter ───────────────────────────────────────────────────────
// Limits the number of concurrent async operations to avoid LLM rate limits.
function makeSemaphore(concurrency: number) {
  let running = 0
  const waiting: Array<() => void> = []
  return async function<T>(fn: () => Promise<T>): Promise<T> {
    if (running >= concurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve))
    }
    running++
    try {
      return await fn()
    } finally {
      running--
      waiting.shift()?.()
    }
  }
}

// Extended type to cover new schema fields (Prisma client may lag behind schema)
type ExtendedSettings = {
  id: string
  scrapeFrequency: string
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

async function getSettings(): Promise<ExtendedSettings> {
  const defaults: ExtendedSettings = {
    id: 'singleton',
    scrapeFrequency: '4h',
    requireReview: false,
    isLive: false,
    targetNiche: 'anime, toys, infotainment, gaming, comics',
    nicheA: '',
    nicheB: '',
    nicheC: '',
    nicheD: '',
    nicheE: '',
    toneA: 'Anime: energetic, otaku-friendly, pop-culture savvy',
    toneB: 'Toys: playful, family-friendly, collector-focused',
    toneC: 'Infotainment: engaging, informative, trending-topic driven',
    toneD: 'Game: hype-driven, gamer-voice, esports-aware',
    toneE: 'Comic: fan-focused, narrative-driven, superhero & manga aware',
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
  const row = await prisma.settings.findUnique({ where: { id: 'singleton' } })
  if (!row) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.settings.create as any)({ data: defaults })
    return defaults
  }
  // Merge row with defaults so new fields always have a value
  return { ...defaults, ...row } as ExtendedSettings
}

/**
 * Generate a social media post caption via the Social Media Specialist agent,
 * then publish to Instagram (if credentials are configured).
 * Errors are caught and logged — they never block the main publish flow.
 */
async function postToSocialMedia(
  article: { title: string; content: string; featuredImage?: string | null },
  publishedUrl: string,
  signal?: AbortSignal
): Promise<void> {
  if (!isInstagramConfigured()) {
    log('info', '[SOCIAL] Instagram credentials not set — skipping social post')
    return
  }

  const imageUrl = (article as any).featuredImage as string | undefined
  if (!imageUrl) {
    log('warn', `[SOCIAL] No featured image for "${article.title}" — Instagram requires an image, skipping`)
    return
  }

  try {
    const caption = await generateSocialPost(
      { title: article.title, content: article.content },
      publishedUrl,
      signal
    )
    await publishToInstagram(imageUrl, caption)
  } catch (err) {
    // Social posting errors must never fail the WordPress publish
    log('error', `[SOCIAL] Instagram post failed for "${article.title}": ${err}`)
  }
}

// ── Image review helper (shared by all editor workers) ────────────────────────
async function runImageReview(articleId: string, articleTitle: string, sourceText: string): Promise<void> {
  const MAX_IMAGE_RETRIES = 3
  const a = await prisma.article.findUnique({ where: { id: articleId } })
  const imageUrl = (a as any)?.featuredImage as string | null
  if (!imageUrl) return

  const imgReview = await reviewImage(imageUrl, articleTitle, sourceText, pipelineAbortController?.signal)
  if (imgReview.status === 'PASS') return

  log('warn', `[EDITOR] Image FAIL: ${imgReview.reason} — requesting replacement`)
  const tried = new Set<string>([imageUrl])
  for (let attempt = 1; attempt <= MAX_IMAGE_RETRIES; attempt++) {
    const replacements = await searchReplacementImage(articleTitle, sourceText, Array.from(tried), 1)
    if (replacements.length === 0) return
    const newUrl = replacements[0]
    tried.add(newUrl)
    await prisma.article.update({ where: { id: articleId }, data: { featuredImage: newUrl } })
    const check = await reviewImage(newUrl, articleTitle, sourceText, pipelineAbortController?.signal)
    if (check.status === 'PASS') {
      log('success', `[EDITOR] Replacement image APPROVED on attempt ${attempt}`)
      return
    }
    log('warn', `[EDITOR] Replacement image FAIL (attempt ${attempt}): ${check.reason}`)
  }
}

// ── Editor worker — one instance per editor (editor / editor-b / editor-c) ───
async function runEditorWorker(
  editorId: string,
  queue: string[],
  articleSourceMap: Record<string, string>,
  results: { firstPassIds: string[]; revisedPassIds: string[]; allPassedIds: string[] },
  isDone: () => boolean,
  settings: ExtendedSettings,
  brandNiches: Record<string, string>,
): Promise<void> {
  const MAX_REVISIONS = 5
  const label = `[${editorId.toUpperCase()}]`

  while (true) {
    const articleId = queue.shift()
    if (!articleId) {
      if (isDone() && queue.length === 0) break
      await new Promise<void>((r) => setTimeout(r, 80))
      continue
    }
    checkAbort()

    const article = await prisma.article.findUnique({ where: { id: articleId } })
    if (!article) continue

    const sourceText = articleSourceMap[articleId] || article.content
    const taskId = addAgentTask(editorId, `Review: "${article.title.replace(/^\[Drafting\] /, '').slice(0, 45)}"`)
    updateAgentTask(editorId, taskId, 'in-progress')
    log('info', `${label} Reviewing: "${article.title.slice(0, 60)}"`)

    // ── Text review ────────────────────────────────────────────────
    const firstReview = await reviewArticle(article.content, sourceText, pipelineAbortController?.signal)

    if (firstReview.status === 'PASS') {
      await prisma.article.update({ where: { id: articleId }, data: { reviewResult: JSON.stringify(firstReview) } })
      await runImageReview(articleId, article.title, sourceText)
      results.firstPassIds.push(articleId)
      results.allPassedIds.push(articleId)
      log('success', `${label} PASS (1st, image OK): "${article.title}" (${article.brandId})`)
      updateAgentTask(editorId, taskId, 'done')
      continue
    }

    // ── Revision loop ──────────────────────────────────────────────
    log('warn', `${label} FAIL (1st): "${article.title}" — ${firstReview.reason}`)
    const brand = BASE_BRANDS.find((b) => b.id === article.brandId)
    if (!brand) { updateAgentTask(editorId, taskId, 'failed'); continue }

    const toneOverride = settings[brand.settingsToneKey]?.trim()
    const guidelines = toneOverride
      ? toneOverride + '\n\nWrite a complete news article in JSON format: {"title":"...","content":"..."}'
      : BRAND_GUIDELINES[brand.id]

    let lastReview = firstReview
    let revisionNum = 0
    let passed = false
    let currentDraft = { title: article.title, content: article.content }

    while (revisionNum < MAX_REVISIONS) {
      checkAbort()
      revisionNum++
      await prisma.article.update({
        where: { id: articleId },
        data: { status: 'Revising', reviewResult: JSON.stringify(lastReview), revisionCount: revisionNum },
      })
      log('info', `[COPYWRITER] Revision #${revisionNum} for "${article.brandId}" — ${lastReview.reason}`)
      const revised = await reviseArticle(currentDraft, lastReview.reason, sourceText, article.brandId, guidelines, pipelineAbortController?.signal)
      currentDraft = revised
      await prisma.article.update({ where: { id: articleId }, data: { title: revised.title, content: revised.content } })
      log('info', `[COPYWRITER] Revision #${revisionNum} complete: "${revised.title}"`)

      const review = await reviewArticle(revised.content, sourceText, pipelineAbortController?.signal)
      lastReview = review

      if (review.status === 'PASS') {
        await prisma.article.update({ where: { id: articleId }, data: { reviewResult: JSON.stringify(review) } })
        await runImageReview(articleId, revised.title, sourceText)
        results.revisedPassIds.push(articleId)
        results.allPassedIds.push(articleId)
        log('success', `${label} PASS (rev #${revisionNum}, image OK): "${revised.title}" → queued for manual approval`)
        passed = true
        updateAgentTask(editorId, taskId, 'done')
        break
      }
      log('warn', `${label} FAIL (rev #${revisionNum}): "${revised.title}" — ${review.reason}`)
    }

    if (!passed) {
      await prisma.article.update({ where: { id: articleId }, data: { status: 'Pending Review', reviewResult: JSON.stringify(lastReview) } })
      results.revisedPassIds.push(articleId)
      results.allPassedIds.push(articleId)
      log('warn', `${label} MAX REVISIONS reached for "${article.title}" → Pending Review`)
      updateAgentTask(editorId, taskId, 'done')
    }
  }
}

export async function runPipelineCycle(isManual: boolean = false): Promise<string> {
  const s = state()
  if (s.running) {
    log('warn', '[PIPELINE] A cycle is already running. Skipping.')
    throw new Error('Pipeline already running')
  }

  const controller = new AbortController()
  s.running = true
  s.shouldAbort = false
  s.controller = controller
  pipelineAbortController = controller  // keep module ref in sync
  const cycleId = uuidv4()

  log('info', `[PIPELINE] ===== Starting cycle ${cycleId} ${isManual ? '(MANUAL)' : '(SCHEDULED)'} =====`)

  try {
    clearAllAgentTasks() // fresh per-cycle task board
    checkAbort()
    const settings = await getSettings()

    // GUARDRAIL: Refuse to run if system is not LIVE, unless it was a manual trigger
    if (!settings.isLive && !isManual) {
      log('warn', '[PIPELINE] Execution blocked: System is currently set to STANDBY (isLive=false) and this was a scheduled run.')
      state().running = false
      return 'execution_blocked'
    }

    // ----------------------------------------------------------------
    // STAGE 0 — SEO Strategist: Generate investigator directives
    // ----------------------------------------------------------------
    log('info', '[SEO STRATEGIST] Running SEO strategy analysis...')
    const seoTaskId = addAgentTask('seo-strategist', 'Generate keyword directives for all 5 brands')
    updateAgentTask('seo-strategist', seoTaskId, 'in-progress')
    let seoDirectives: InvestigatorDirective[] = []
    try {
      seoDirectives = await generateSeoDirectives(
        {
          nicheA: settings.nicheA || settings.targetNiche,
          nicheB: settings.nicheB || settings.targetNiche,
          nicheC: settings.nicheC || settings.targetNiche,
          nicheD: settings.nicheD || settings.targetNiche,
          nicheE: settings.nicheE || settings.targetNiche,
        },
        pipelineAbortController?.signal,
        {
          dedupeHours: settings.investigatorDedupeHours,
          shortTailPerBrand: settings.seoShortTail,
          evergreenPerBrand: settings.seoEvergreen,
        }
      )
      if (seoDirectives.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (prisma as any).seoDirective.upsert({
          where: { cycleId },
          create: { id: uuidv4(), cycleId, directives: JSON.stringify(seoDirectives) },
          update: { directives: JSON.stringify(seoDirectives) },
        })
        log('success', `[SEO STRATEGIST] ${seoDirectives.length} directives saved for cycle ${cycleId}`)
        // Add per-directive tasks to SEO Strategist board
        for (const d of seoDirectives) {
          const tid = addAgentTask('seo-strategist', `[${d.topic_type}] ${d.target_keyword} (${d.brand})`)
          updateAgentTask('seo-strategist', tid, 'done')
        }
      }
      updateAgentTask('seo-strategist', seoTaskId, 'done')
    } catch (err) {
      updateAgentTask('seo-strategist', seoTaskId, 'failed')
      log('warn', `[SEO STRATEGIST] Could not generate directives, continuing with RSS: ${err}`)
    }
    checkAbort()

    // ── Investigator: Per-directive topic screening ───────────────────────────
    // The Investigator checks each brand's directives against recently published
    // articles for that brand. Conflicting directives are replaced by prompting
    // the SEO Strategist for a fresh topic — not silently dropped.
    // ─────────────────────────────────────────────────────────────────────────
    if (seoDirectives.length > 0) {
      const dedupeWindowHours = settings.investigatorDedupeHours ?? 24
      if (dedupeWindowHours > 0) {
        log('info', `[INVESTIGATOR] Screening ${seoDirectives.length} directive(s) against published articles (window: ${dedupeWindowHours}h)...`)
        try {
          const cutoff = new Date(Date.now() - dedupeWindowHours * 60 * 60 * 1000).toISOString()

          // Fetch per-brand recently published headlines
          const brandHeadlines: Record<string, string[]> = {}
          const brandIds = ['anime', 'toys', 'infotainment', 'game', 'comic']
          for (const brandId of brandIds) {
            const rows = await prisma.$queryRawUnsafe<Array<{ title: string; sourceTitle: string | null }>>(
              `SELECT title, sourceTitle FROM "Article" WHERE brandId = ? AND createdAt >= ? AND status NOT IN ('Failed','Drafting') ORDER BY createdAt DESC LIMIT 50`,
              brandId, cutoff
            )
            brandHeadlines[brandId] = rows
              .map((r) => r.sourceTitle || r.title)
              .filter((h): h is string => !!h && !h.startsWith('[Draft Failed]') && !h.startsWith('[Drafting]'))
          }

          const brandNicheMap: Record<string, string> = {
            anime:        settings.nicheA || settings.targetNiche,
            toys:         settings.nicheB || settings.targetNiche,
            infotainment: settings.nicheC || settings.targetNiche,
            game:         settings.nicheD || settings.targetNiche,
            comic:        settings.nicheE || settings.targetNiche,
          }

          const screenedDirectives: InvestigatorDirective[] = []
          for (const directive of seoDirectives) {
            checkAbort()
            const brand = directive.brand || 'anime'
            const headlines = brandHeadlines[brand] ?? []

            if (headlines.length === 0) {
              screenedDirectives.push(directive)
              continue
            }

            // LLM semantic check: is this topic already covered?
            const keepList = await filterDirectivesAgainstPublished(
              [{ keyword: directive.target_keyword, type: directive.topic_type, angle: directive.angle }],
              headlines,
              pipelineAbortController?.signal
            )

            if (keepList.includes(directive.target_keyword)) {
              screenedDirectives.push(directive)
            } else {
              // Conflict — ask SEO Strategist for a replacement
              log('warn', `[INVESTIGATOR] ⛔ "${directive.target_keyword}" already covered for "${brand}" within ${dedupeWindowHours}h — requesting replacement from SEO Strategist`)
              const replacement = await generateReplacementDirective(
                brand,
                brandNicheMap[brand],
                directive.topic_type,
                [directive.target_keyword],
                pipelineAbortController?.signal
              )
              if (replacement) {
                screenedDirectives.push(replacement)
              } else {
                log('warn', `[INVESTIGATOR] No replacement generated for "${brand}" — skipping slot`)
              }
            }
          }

          const replaced = seoDirectives.length - screenedDirectives.filter((d, i) =>
            seoDirectives[i]?.target_keyword === d.target_keyword
          ).length
          log('success', `[INVESTIGATOR] Screening complete — ${screenedDirectives.length} directive(s) ready`)
          seoDirectives = screenedDirectives
        } catch (err) {
          log('warn', `[INVESTIGATOR] Screening failed, continuing with original directives: ${err}`)
        }
      } else {
        log('info', '[INVESTIGATOR] Deduplication window is Off — skipping topic screening')
      }
    }

    // ----------------------------------------------------------------
    // STAGE 1 — Investigator: Ingest news (Serper search or RSS fallback)
    // ----------------------------------------------------------------
    log('info', '[INVESTIGATOR] Starting news ingestion cycle...')
    log('info', `[INVESTIGATOR] Niches — Anime: "${settings.nicheA || settings.targetNiche}" | Toys: "${settings.nicheB || settings.targetNiche}" | Info: "${settings.nicheC || settings.targetNiche}" | Game: "${settings.nicheD || settings.targetNiche}" | Comic: "${settings.nicheE || settings.targetNiche}"`)

    let feedItems: FeedItem[]
    const serperKeySet = !!process.env.SERPER_API_KEY

    if (seoDirectives.length > 0 && serperKeySet) {
      // Search-driven ingestion: execute Serper queries from SEO directives
      log('info', '[INVESTIGATOR] SEO directives + SERPER_API_KEY detected — using targeted web search')

      // Helper: search one directive and return its hits
      const searchDirective = async (directive: (typeof seoDirectives)[number]) => {
        log('info', `[INVESTIGATOR] Searching for [${directive.topic_type}] "${directive.target_keyword}"`)
        const taskId = addAgentTask('investigator', `Search: "${directive.target_keyword}"`)
        updateAgentTask('investigator', taskId, 'in-progress')
        const hits = await searchMultiple(directive.suggested_search_queries, 3)
        updateAgentTask('investigator', taskId, 'done')
        return hits
      }

      // Search ALL directives in parallel (semaphore limits concurrent Serper calls)
      const searchSemaphore = makeSemaphore(4)
      const directiveHitsMap = new Map<string, { directive: (typeof seoDirectives)[number]; hits: Awaited<ReturnType<typeof searchMultiple>> }>()
      await Promise.all(
        seoDirectives.map((directive) =>
          searchSemaphore(async () => {
            const hits = await searchDirective(directive)
            directiveHitsMap.set(directive.target_keyword, { directive, hits })
          })
        )
      )

      // Diversity check — let the Investigator call out the SEO Strategist for duplication
      const directiveResults = Array.from(directiveHitsMap.entries()).map(([keyword, { hits }]) => ({
        keyword,
        titles: hits.map((h) => h.title).filter(Boolean),
      }))
      const { duplicateKeywords, dominantTopics } = await detectTopicConcentration(
        directiveResults,
        pipelineAbortController?.signal
      )

      if (duplicateKeywords.length > 0) {
        log('warn', `[INVESTIGATOR] ⚠ Topic concentration detected — dominant topic(s): ${dominantTopics.join(', ')}`)
        log('warn', `[INVESTIGATOR] Calling SEO Strategist to replace duplicate directive(s): ${duplicateKeywords.join(', ')}`)

        // Replace each duplicate directive individually via the SEO Strategist
        for (const dupKey of duplicateKeywords) {
          const dupEntry = directiveHitsMap.get(dupKey)
          if (!dupEntry) continue

          const brand = dupEntry.directive.brand || 'anime'
          const brandNicheMap: Record<string, string> = {
            anime: settings.nicheA || settings.targetNiche,
            toys: settings.nicheB || settings.targetNiche,
            infotainment: settings.nicheC || settings.targetNiche,
            game: settings.nicheD || settings.targetNiche,
            comic: settings.nicheE || settings.targetNiche,
          }
          const avoidTopics = [...dominantTopics, dupKey]

          const replacement = await generateReplacementDirective(
            brand,
            brandNicheMap[brand],
            dupEntry.directive.topic_type,
            avoidTopics,
            pipelineAbortController?.signal
          )

          if (replacement) {
            log('info', `[INVESTIGATOR] Searching replacement directive: "${replacement.target_keyword}"`)
            const hits = await searchDirective(replacement)
            directiveHitsMap.delete(dupKey)
            directiveHitsMap.set(replacement.target_keyword, { directive: replacement, hits })
          } else {
            log('warn', `[INVESTIGATOR] No replacement for "${dupKey}" — removing from batch`)
            directiveHitsMap.delete(dupKey)
          }
        }
      }

      // Flatten directive results into feedItems.
      // Cap at 3 hits per directive — enough buffer for hasBeenSeen filtering
      // while preventing article inflation (enforced to 1 per directive later).
      const HITS_PER_DIRECTIVE = 3
      feedItems = []
      for (const { directive, hits } of directiveHitsMap.values()) {
        for (const hit of hits.slice(0, HITS_PER_DIRECTIVE)) {
          feedItems.push({
            title: hit.title,
            summary: hit.snippet,
            link: hit.link,
            pubDate: hit.date,
            source: hit.source,
            seoContext: {
              topicType: directive.topic_type,
              brand: directive.brand || 'anime',
              targetKeyword: directive.target_keyword,
              angle: directive.angle,
            },
          })
        }
      }
      log('info', `[INVESTIGATOR] Web search returned ${feedItems.length} raw items across ${directiveHitsMap.size} directives (max ${HITS_PER_DIRECTIVE} per directive)`)
    } else {
      // Fallback: RSS feed ingestion
      if (seoDirectives.length > 0 && !serperKeySet) {
        log('warn', '[INVESTIGATOR] SEO directives ready but SERPER_API_KEY not set — falling back to RSS')
      }
      feedItems = await fetchAllFeeds({
        nicheA: settings.nicheA,
        nicheB: settings.nicheB,
        nicheC: settings.nicheC,
        nicheD: settings.nicheD,
        nicheE: settings.nicheE,
        rssSourcesA: settings.rssSourcesA,
        rssSourcesB: settings.rssSourcesB,
        rssSourcesC: settings.rssSourcesC,
        rssSourcesD: settings.rssSourcesD,
        rssSourcesE: settings.rssSourcesE,
        targetNiche: settings.targetNiche,
      })
    }
    checkAbort()
    log('info', `[INVESTIGATOR] Fetched ${feedItems.length} raw items`)

    const newItems: FeedItem[] = []
    for (const item of feedItems) {
      checkAbort()
      const isSeen = await hasBeenSeen(item.link)
      if (!isSeen) {
        newItems.push(item)
      }
    }
    log('success', `[INVESTIGATOR] ${newItems.length} new items after deduplication`)

    if (newItems.length === 0) {
      log('info', '[INVESTIGATOR] No new items to process. Cycle complete.')
      return cycleId
    }

    // ----------------------------------------------------------------
    // STAGE 2 — Triage Router: Filter by niche relevance
    // ----------------------------------------------------------------
    log('info', '[ROUTER] Triaging articles for niche relevance...')

    // Build per-brand niches — use configured niche if set, else fall back to
    // brand-specific defaults (not the global targetNiche which is too broad for triage)
    const brandNiches: Record<string, string> = {
      'anime':        settings.nicheA?.trim() || BRAND_DEFAULT_NICHE.anime,
      'toys':         settings.nicheB?.trim() || BRAND_DEFAULT_NICHE.toys,
      'infotainment': settings.nicheC?.trim() || BRAND_DEFAULT_NICHE.infotainment,
      'game':         settings.nicheD?.trim() || BRAND_DEFAULT_NICHE.game,
      'comic':        settings.nicheE?.trim() || BRAND_DEFAULT_NICHE.comic,
    }

    // Build per-brand tone descriptions for richer triage context
    const brandTones: Record<string, string> = {
      'anime':        settings.toneA?.trim() || 'energetic, otaku-friendly, pop-culture savvy',
      'toys':         settings.toneB?.trim() || 'playful, family-friendly, collector-focused',
      'infotainment': settings.toneC?.trim() || 'engaging, informative, trending-topic driven',
      'game':         settings.toneD?.trim() || 'hype-driven, gamer-voice, esports-aware',
      'comic':        settings.toneE?.trim() || 'fan-focused, narrative-driven, superhero & manga aware',
    }

    log('info', '[ROUTER] Brand niche configuration:')
    for (const [id, niche] of Object.entries(brandNiches)) {
      log('info', `[ROUTER]   ${BRAND_DISPLAY_NAME[id]}: "${niche.slice(0, 80)}${niche.length > 80 ? '…' : ''}"`)
    }

    // An item is relevant if it passes triage for at least one brand's niche
    const itemBrandRelevance: Record<string, string[]> = {} // itemLink -> [brandIds]

    // Sort deduplicated items entirely by published date (newest first)
    newItems.sort(
      (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
    )

    // When Serper + directives drove ingestion, allow enough items so every directive
    // gets at least one article. For RSS fallback, cap at 10 to avoid over-processing.
    const itemLimit = seoDirectives.length > 0 && serperKeySet
      ? Math.min(newItems.length, Math.max(seoDirectives.length * 2, 10))
      : 10
    const itemsToProcess = newItems.slice(0, itemLimit)
    log('info', `[INVESTIGATOR] Processing top ${itemsToProcess.length} most recent articles (limit: ${itemLimit})`)

    // Resolve images per item using each brand's configured image count.
    // Serper-sourced items carry a brand from their directive → fetch exactly that brand's count.
    // RSS items (no brand context) fall back to the maximum across all brands.
    const maxImageCount = Math.max(
      settings.imageCountA || 1,
      settings.imageCountB || 1,
      settings.imageCountC || 1,
      settings.imageCountD || 1,
      settings.imageCountE || 1
    )
    const brandImageCountMap: Record<string, number> = {
      anime:        settings.imageCountA || 1,
      toys:         settings.imageCountB || 1,
      infotainment: settings.imageCountC || 1,
      game:         settings.imageCountD || 1,
      comic:        settings.imageCountE || 1,
    }
    log('info', `[IMAGE] Resolving images per item (brand-aware: anime=${brandImageCountMap.anime}, toys=${brandImageCountMap.toys}, info=${brandImageCountMap.infotainment}, game=${brandImageCountMap.game}, comic=${brandImageCountMap.comic})`)
    const itemImageMap = new Map<string, string[]>()
    await Promise.all(
      itemsToProcess.map(async (item) => {
        const itemBrand = item.seoContext?.brand
        const targetCount = itemBrand ? (brandImageCountMap[itemBrand] ?? maxImageCount) : maxImageCount
        const imgs = await resolveItemImages(item, targetCount)
        itemImageMap.set(item.link, imgs)
        item.featuredImage = imgs[0] // keep single-image field for compat
      })
    )
    log('info', `[IMAGE] Image resolution complete (${itemsToProcess.filter(i => i.featuredImage).length}/${itemsToProcess.length} resolved)`)

    // Triage ALL items in parallel — each item's brand checks run concurrently
    const triageSemaphore = makeSemaphore(4)
    await Promise.all(
      itemsToProcess.map(async (item) => {
        const relevantBrands: string[] = []
        const sourceBrand = item.seoContext?.brand

        const routerTaskId = addAgentTask('router', `Triage: "${item.title.slice(0, 50)}"`)
        updateAgentTask('router', routerTaskId, 'in-progress')

        if (sourceBrand) {
          // Directive-sourced item: brand is authoritative — no cross-brand triage
          relevantBrands.push(sourceBrand)
          log('info', `[ROUTER] TRUSTED: "${item.title.slice(0, 60)}" → ${BRAND_DISPLAY_NAME[sourceBrand]} (directive — exclusive)`)
        } else {
          // RSS item: triage against all brands in parallel
          await Promise.all(
            Object.entries(brandNiches).map(([brandId, niche]) =>
              triageSemaphore(async () => {
                const isRelevant = await triageArticle(
                  item.title,
                  item.summary,
                  niche,
                  pipelineAbortController?.signal,
                  { name: BRAND_DISPLAY_NAME[brandId], tone: brandTones[brandId] }
                )
                if (isRelevant) relevantBrands.push(brandId)
              })
            )
          )
        }

        if (relevantBrands.length > 0) {
          itemBrandRelevance[item.link] = relevantBrands
          log('success', `[ROUTER] PASS: "${item.title}" → brands: ${relevantBrands.join(', ')}`)
          updateAgentTask('router', routerTaskId, 'done')
        } else {
          log('warn', `[ROUTER] SKIP: "${item.title}" — not relevant to any brand niche`)
          updateAgentTask('router', routerTaskId, 'failed')
          // Log replacement request to SEO Strategist to-do
          if (item.seoContext) {
            const seoTaskId = addAgentTask('seo-strategist', `Replace needed: "${item.title.slice(0, 45)}" failed triage`)
            updateAgentTask('seo-strategist', seoTaskId, 'failed')
          }
        }
        await markAsSeen(item.link)
      })
    )

    const relevantItems = itemsToProcess.filter((i) => i.link in itemBrandRelevance)

    if (relevantItems.length === 0) {
      log('info', '[ROUTER] No relevant items after triage. Cycle complete.')
      return cycleId
    }

    log('info', `[ROUTER] ${relevantItems.length} items passed triage`)

    // ── Franchise deduplication ────────────────────────────────────────────────
    // Even after per-directive diversity checks, the router can pass multiple
    // articles about the same franchise (e.g. 3× Jujutsu Kaisen from different
    // search queries). Haiku reads all passed titles and keeps only one per
    // specific franchise/IP/entity before handing off to the copywriters.
    // ──────────────────────────────────────────────────────────────────────────
    checkAbort()
    log('info', '[ROUTER] Running franchise deduplication on passed items...')
    const maxPerFranchise = settings.investigatorMaxSameFranchise ?? 1
    const keepIds = await deduplicateByFranchise(
      relevantItems.map((item) => ({ id: item.link, title: item.title, summary: item.summary })),
      pipelineAbortController?.signal,
      maxPerFranchise
    )
    const dedupedItems = relevantItems.filter((item) => keepIds.includes(item.link))
    const removedCount = relevantItems.length - dedupedItems.length
    if (removedCount > 0) {
      const removedTitles = relevantItems
        .filter((item) => !keepIds.includes(item.link))
        .map((item) => `"${item.title}"`)
      log('warn', `[ROUTER] Franchise dedup removed ${removedCount} duplicate(s): ${removedTitles.join(', ')}`)
    }
    log('info', `[ROUTER] ${dedupedItems.length} unique-franchise items proceeding to copywriters`)

    // ── Directive slot enforcement ─────────────────────────────────────────────
    // Each SEO directive should produce exactly 1 article. After franchise dedup
    // multiple hits for the same directive may still remain — keep only the first
    // surviving item per directive keyword. RSS items (no seoContext) are unaffected.
    const seenDirectiveKeys = new Set<string>()
    const cappedItems = dedupedItems.filter((item) => {
      const key = item.seoContext?.targetKeyword
      if (!key) return true // RSS item — no cap applied
      if (seenDirectiveKeys.has(key)) {
        log('info', `[ROUTER] Directive cap: dropping extra item for "${key}" — 1 article per directive`)
        return false
      }
      seenDirectiveKeys.add(key)
      return true
    })
    if (cappedItems.length < dedupedItems.length) {
      log('info', `[ROUTER] Directive cap reduced ${dedupedItems.length} → ${cappedItems.length} items (1 per directive)`)
    }

    // ----------------------------------------------------------------
    // STAGE 3 + 4 — Streaming: Copywriters → Editor Pool (3 editors)
    // ----------------------------------------------------------------
    // Each draft is pushed to a shared queue as soon as it completes.
    // Three editor workers drain the queue concurrently — articles no
    // longer wait for all drafts to finish before review begins.
    // ----------------------------------------------------------------
    log('info', '[COPYWRITER] Fan-out drafting → streaming to editor pool (3 editors)...')

    const articleSourceMap: Record<string, string> = {}
    const editorQueue: string[] = []
    let draftsDone = 0
    let draftsTotal = 0

    // Count total expected drafts
    for (const item of cappedItems) {
      draftsTotal += BASE_BRANDS.filter((b) => (itemBrandRelevance[item.link] ?? []).includes(b.id)).length
    }

    const editorResultStore = {
      firstPassIds: [] as string[],
      revisedPassIds: [] as string[],
      allPassedIds: [] as string[],
    }

    // Start 3 editor workers BEFORE drafting — they'll drain the queue as articles arrive
    log('info', '[EDITOR] Phase A: 3 editor workers starting (parallel review pool)...')
    const editorWorkerPromises = ['editor', 'editor-b', 'editor-c'].map((editorId) =>
      runEditorWorker(
        editorId,
        editorQueue,
        articleSourceMap,
        editorResultStore,
        () => draftsDone >= draftsTotal,
        settings,
        brandNiches,
      )
    )

    // Draft all articles in parallel — each completed draft is immediately pushed to editor queue
    const draftSemaphore = makeSemaphore(5)
    await Promise.all(
      cappedItems.flatMap((item) => {
        const eligibleBrands = BASE_BRANDS.filter((b) => (itemBrandRelevance[item.link] ?? []).includes(b.id))
        return eligibleBrands.map((brand) =>
          draftSemaphore(async () => {
            checkAbort()
            const cwId = `copywriter-${brand.id[0]}` // e.g. 'copywriter-a'
            const cwTaskId = addAgentTask(cwId, `Draft: "${item.title.slice(0, 50)}"`)
            updateAgentTask(cwId, cwTaskId, 'in-progress')

            const toneOverride = settings[brand.settingsToneKey]?.trim()
            const guidelines = toneOverride
              ? toneOverride + '\n\nWrite a complete news article in JSON format: {"title":"...","content":"..."}'
              : BRAND_GUIDELINES[brand.id]

            const imageCountKey = BRAND_IMAGE_COUNT_KEY[brand.id] ?? 'imageCountA'
            const brandImageCount = typeof settings[imageCountKey] === 'number' ? settings[imageCountKey] : 1
            const allImages = itemImageMap.get(item.link) ?? (item.featuredImage ? [item.featuredImage] : [])
            const brandImages = allImages.slice(0, brandImageCount)
            const featuredImage = brandImages[0] ?? null
            const extraImages = brandImages.slice(1)

            const article = await prisma.article.create({
              data: {
                id: uuidv4(),
                cycleId,
                brandId: brand.id,
                status: 'Drafting',
                title: `[Drafting] ${item.title}`,
                content: '',
                sourceUrl: item.link,
                sourceTitle: item.title,
                featuredImage,
                images: extraImages.length > 0 ? JSON.stringify(extraImages) : null,
              },
            })

            const seoBlock = item.seoContext
              ? `\n\nSEO CONTEXT (incorporate naturally):\n- Target Keyword: ${item.seoContext.targetKeyword}\n- Content Angle: ${item.seoContext.angle}\n- Topic Type: ${item.seoContext.topicType}`
              : ''
            const fullSourceText = `Title: ${item.title}\n\nSummary: ${item.summary}\n\nSource: ${item.source}\nPublished: ${item.pubDate}${seoBlock}`

            log('info', `[COPYWRITER] Drafting for brand "${brand.id}" — "${item.title.slice(0, 60)}"`)
            let articleId = article.id
            try {
              const draft = await draftArticle(fullSourceText, brand.id, guidelines, pipelineAbortController?.signal)
              await prisma.article.update({
                where: { id: article.id },
                data: { title: draft.title, content: draft.content, status: 'Pending Review' },
              })
              log('success', `[COPYWRITER] Draft complete for brand "${brand.id}": "${draft.title}"`)
              updateAgentTask(cwId, cwTaskId, 'done')
            } catch (err) {
              log('error', `[COPYWRITER] Draft failed for brand "${brand.id}": ${err}`)
              updateAgentTask(cwId, cwTaskId, 'failed')
            }

            // Register source text and push to editor queue immediately
            articleSourceMap[articleId] = fullSourceText
            editorQueue.push(articleId)
            draftsDone++

            // Log least-busy editor for visibility
            const editorLoads = ['editor', 'editor-b', 'editor-c'].map((eid) => ({
              id: eid,
              load: (agentTaskStore()[eid] ?? []).filter((t) => t.status === 'queued' || t.status === 'in-progress').length,
            }))
            const leastBusy = editorLoads.reduce((a, b) => (a.load <= b.load ? a : b))
            log('info', `[COPYWRITER] "${item.title.slice(0, 40)}" → editor queue (${leastBusy.id} is least busy, ${leastBusy.load} tasks)`)
          })
        )
      })
    )

    // Wait for all 3 editors to drain the queue
    await Promise.all(editorWorkerPromises)

    const { firstPassIds, revisedPassIds, allPassedIds } = editorResultStore
    log('info', `[EDITOR] Guardrail complete. ${firstPassIds.length} first-pass auto-publish, ${revisedPassIds.length} queued for review.`)

    // Phase B — Strategic Insights
    log('info', '[EDITOR] Phase B: Generating strategic insights...')

    const brandsWithPassingArticles = new Set<string>()
    for (const articleId of allPassedIds) {
      const article = await prisma.article.findUnique({ where: { id: articleId } })
      if (article) brandsWithPassingArticles.add(article.brandId)
    }

    for (const brandId of Array.from(brandsWithPassingArticles)) {
      const latestArticle = await prisma.article.findFirst({
        where: { cycleId, brandId, status: { not: 'Failed' } },
        orderBy: { createdAt: 'desc' },
      })
      if (latestArticle) {
        const feedback = await generateCopywriterFeedback(
          latestArticle.content,
          brandId,
          brandNiches[brandId] ?? settings.targetNiche,
          pipelineAbortController?.signal
        )
        const targetAgent = BRAND_AGENT_NAME[brandId] ?? 'Copywriter-A'
        await prisma.insight.create({
          data: { id: uuidv4(), targetAgent, suggestionText: feedback, status: 'Pending' },
        })
        log('success', `[EDITOR] Insight generated for ${targetAgent}`)
      }
    }

    const parseUrls = (s: string) =>
      s.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean)
    const feedSourceNames = [
      ...parseUrls(settings.rssSourcesA),
      ...parseUrls(settings.rssSourcesB),
      ...parseUrls(settings.rssSourcesC),
      ...parseUrls(settings.rssSourcesD),
      ...parseUrls(settings.rssSourcesE),
    ]
    const insightNiche = [
      settings.nicheA, settings.nicheB, settings.nicheC,
      settings.nicheD, settings.nicheE, settings.targetNiche,
    ]
      .filter(Boolean)
      .join(' / ')
    const investigatorFeedback = await generateInvestigatorFeedback(
      feedSourceNames.length > 0 ? feedSourceNames : ['(no RSS sources configured)'],
      insightNiche,
      pipelineAbortController?.signal
    )
    await prisma.insight.create({
      data: { id: uuidv4(), targetAgent: 'Investigator', suggestionText: investigatorFeedback, status: 'Pending' },
    })
    log('success', '[EDITOR] Investigator insight generated')

    // ----------------------------------------------------------------
    // STAGE 5a — Auto-publish first-pass articles to WordPress
    // ----------------------------------------------------------------
    if (firstPassIds.length > 0) {
      log('info', `[PUBLISHER] Auto-publishing ${firstPassIds.length} first-pass article(s)...`)
      for (const articleId of firstPassIds) {
        checkAbort()
        const article = await prisma.article.findUnique({ where: { id: articleId } })
        if (!article) continue
        try {
          // Embed extra images into article content as figure blocks
          let publishContent = article.content
          const extraImgs: string[] = (article as any).images
            ? JSON.parse((article as any).images)
            : []
          if (extraImgs.length > 0) {
            const figures = extraImgs
              .map((url) => `<figure class="wp-block-image size-large"><img src="${url}" alt="" /></figure>`)
              .join('\n')
            publishContent = publishContent + '\n\n' + figures
          }

          const wpResult = await publishToWordPress({
            title: article.title,
            content: publishContent,
            brandId: article.brandId,
            featuredImageUrl: (article as any).featuredImage || undefined,
          })
          await prisma.article.update({
            where: { id: articleId },
            data: { status: 'Published', wpPostId: String(wpResult.id) },
          })
          log('success', `[PUBLISHER] Published: "${article.title}" → WP ID ${wpResult.id}`)

          // ── Social media: generate caption → post to Instagram ──────────
          await postToSocialMedia(article, wpResult.link, pipelineAbortController?.signal)
        } catch (err) {
          await prisma.article.update({ where: { id: articleId }, data: { status: 'Failed' } })
          log('error', `[PUBLISHER] Failed to publish "${article.title}": ${err}`)
        }
      }
    }

    // ----------------------------------------------------------------
    // STAGE 5b — Queue revised articles for manual approval
    // ----------------------------------------------------------------
    if (revisedPassIds.length > 0) {
      for (const articleId of revisedPassIds) {
        await prisma.article.update({ where: { id: articleId }, data: { status: 'Pending Review' } })
      }
      log('info', `[EDITOR] ${revisedPassIds.length} article(s) queued in War Room for manual approval`)
    }

    log('success', `[PIPELINE] ===== Cycle ${cycleId} complete =====`)
    return cycleId
  } catch (err) {
    if (err instanceof Error && err.message.includes('manually aborted')) {
      // Don't crash loudly if intentional
      log('warn', `[PIPELINE] Cycle ${cycleId} was successfully terminated.`)
    } else {
      log('error', `[PIPELINE] Cycle ${cycleId} failed with unhandled error: ${err}`)
      throw err
    }
    return cycleId
  } finally {
    const s = state()
    s.running = false
    s.shouldAbort = false
    s.controller = null
    pipelineAbortController = null
  }
}
