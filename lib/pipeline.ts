import { v4 as uuidv4 } from 'uuid'
import { prisma } from './prisma'
import { log } from './logger'
import type { NodeId } from '../types'
import { hasBeenSeen, markAsSeen } from './dedup'
import { fetchAllFeeds, fetchFeedsForTopic, type FeedItem } from './rss-fetcher'
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
  evaluateTopicViability,
  investigateArticle,
  BRAND_GUIDELINES,
} from './llm'
import { publishToWordPress } from './wordpress'
import { generateSocialPost } from './social-media'
import { publishToInstagram, isInstagramConfigured } from './instagram'
import { resolveItemImages, searchReplacementImage, resolveImages } from './image-resolver'
import { generateSeoDirectives, generateReplacementDirective, type InvestigatorDirective } from './seo-strategist'
import { searchMultiple } from './searcher'
import { scrapeArticleContent } from './article-scraper'

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

  // ── Read extended fields via raw SQL ──────────────────────────────────────
  // toneA-E, nicheA-E, rssSourcesA-E, imageCountA-E were added via raw SQL
  // migrations and are invisible to the generated Prisma client. Without this
  // read they always fall back to hardcoded defaults, ignoring user config.
  let extended: Partial<ExtendedSettings> = {}
  try {
    const extRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT nicheA, nicheB, nicheC, nicheD, nicheE,
              toneA, toneB, toneC, toneD, toneE,
              rssSourcesA, rssSourcesB, rssSourcesC, rssSourcesD, rssSourcesE,
              imageCountA, imageCountB, imageCountC, imageCountD, imageCountE
       FROM "Settings" WHERE id = ?`,
      'singleton'
    )
    if (extRows.length > 0) {
      const r = extRows[0]
      extended = {
        nicheA: (r.nicheA as string) ?? '',
        nicheB: (r.nicheB as string) ?? '',
        nicheC: (r.nicheC as string) ?? '',
        nicheD: (r.nicheD as string) ?? '',
        nicheE: (r.nicheE as string) ?? '',
        toneA: ((r.toneA as string) || '').trim() || defaults.toneA,
        toneB: ((r.toneB as string) || '').trim() || defaults.toneB,
        toneC: ((r.toneC as string) || '').trim() || defaults.toneC,
        toneD: ((r.toneD as string) || '').trim() || defaults.toneD,
        toneE: ((r.toneE as string) || '').trim() || defaults.toneE,
        rssSourcesA: (r.rssSourcesA as string) ?? '',
        rssSourcesB: (r.rssSourcesB as string) ?? '',
        rssSourcesC: (r.rssSourcesC as string) ?? '',
        rssSourcesD: (r.rssSourcesD as string) ?? '',
        rssSourcesE: (r.rssSourcesE as string) ?? '',
        imageCountA: typeof r.imageCountA === 'number' ? r.imageCountA : Number(r.imageCountA) || 1,
        imageCountB: typeof r.imageCountB === 'number' ? r.imageCountB : Number(r.imageCountB) || 1,
        imageCountC: typeof r.imageCountC === 'number' ? r.imageCountC : Number(r.imageCountC) || 1,
        imageCountD: typeof r.imageCountD === 'number' ? r.imageCountD : Number(r.imageCountD) || 1,
        imageCountE: typeof r.imageCountE === 'number' ? r.imageCountE : Number(r.imageCountE) || 1,
      }
    }
  } catch (err) {
    log('warn', `[PIPELINE] Could not read extended settings via raw SQL — using defaults: ${err}`)
  }

  // Priority: user-saved extended fields > Prisma ORM row > hardcoded defaults
  return { ...defaults, ...row, ...extended } as ExtendedSettings
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
async function runImageReview(articleId: string, articleTitle: string, sourceText: string, targetImageCount: number): Promise<boolean> {
  const MAX_IMAGE_RETRIES = 5
  const a = await prisma.article.findUnique({ where: { id: articleId } })
  if (!a) return false

  let currentImages: string[] = []
  if ((a as any).featuredImage) currentImages.push((a as any).featuredImage)
  if ((a as any).images) {
    try { currentImages.push(...JSON.parse((a as any).images)) } catch {}
  }

  const passedImages: string[] = []
  const triedUrls = new Set<string>(currentImages)

  for (const url of currentImages) {
    const review = await reviewImage(url, articleTitle, sourceText, pipelineAbortController?.signal)
    if (review.status === 'PASS') {
      passedImages.push(url)
      if (passedImages.length === targetImageCount) break
    } else {
      log('warn', `[EDITOR] Image FAIL: ${review.reason} — dropping ${url}`)
    }
  }

  let attempt = 0
  while (passedImages.length < targetImageCount && attempt < MAX_IMAGE_RETRIES) {
    attempt++
    const needed = targetImageCount - passedImages.length
    log('info', `[EDITOR] Image quota not met (${passedImages.length}/${targetImageCount}). Searching replacements (Attempt ${attempt})`)
    const replacements = await searchReplacementImage(articleTitle, sourceText, Array.from(triedUrls), needed + 2)

    if (replacements.length === 0) continue

    for (const newUrl of replacements) {
      if (triedUrls.has(newUrl)) continue
      triedUrls.add(newUrl)
      const review = await reviewImage(newUrl, articleTitle, sourceText, pipelineAbortController?.signal)
      if (review.status === 'PASS') {
        passedImages.push(newUrl)
        log('success', `[EDITOR] Replacement image APPROVED. (${passedImages.length}/${targetImageCount})`)
        if (passedImages.length === targetImageCount) break
      } else {
        log('warn', `[EDITOR] Replacement image FAIL: ${review.reason}`)
      }
    }
  }

  const featured = passedImages.length > 0 ? passedImages[0] : null
  const extras = passedImages.length > 1 ? passedImages.slice(1) : []
  await prisma.article.update({
    where: { id: articleId },
    data: { featuredImage: featured, images: extras.length > 0 ? JSON.stringify(extras) : null }
  })

  if (passedImages.length === 0 && targetImageCount > 0) {
    log('error', `[EDITOR] FAILED to meet image quota for "${articleTitle}". 0 images passed.`)
    return false
  }

  return true
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
  seenDirectiveKeys: Set<string>,
  draftCounter: { done: number; total: number },
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

    const brandSettings = BASE_BRANDS.find((b) => b.id === article.brandId)
    if (!brandSettings) { updateAgentTask(editorId, taskId, 'done'); continue }

    const toneOverride = settings[brandSettings.settingsToneKey as keyof ExtendedSettings] as string | undefined
    const brandGuidelines = toneOverride?.trim() ? toneOverride.trim() + '\n\nWrite a complete news article in JSON format: {"title":"...","content":"..."}' : BRAND_GUIDELINES[brandSettings.id]

    const imageCountKey = BRAND_IMAGE_COUNT_KEY[brandSettings.id]
    const brandImageCount = typeof settings[imageCountKey as keyof ExtendedSettings] === 'number' ? settings[imageCountKey as keyof ExtendedSettings] : 1

    const firstReview = await reviewArticle(article.content, sourceText, brandGuidelines, pipelineAbortController?.signal)

    if (article.title.includes('[Draft Failed]')) {
      await prisma.article.update({
        where: { id: articleId },
        data: { status: 'Pending Review', reviewResult: JSON.stringify({ status: 'FAIL', reason: 'SYSTEM ERROR: LLM failed to output valid JSON after 5 attempts.' }) }
      })
      results.revisedPassIds.push(articleId)
      updateAgentTask(editorId, taskId, 'failed')
      continue
    }

    if (firstReview.status === 'PASS') {
      if (firstReview.improvedContent) {
        article.content = firstReview.improvedContent
        await prisma.article.update({ where: { id: articleId }, data: { content: article.content } })
      }
      await prisma.article.update({ where: { id: articleId }, data: { reviewResult: JSON.stringify({ ...firstReview, improvedContent: undefined }) } })
      
      const imageQuotaMet = await runImageReview(articleId, article.title, sourceText, brandImageCount as number)
      if (!imageQuotaMet) {
        await prisma.article.update({ where: { id: articleId }, data: { status: 'Pending Review', reviewResult: JSON.stringify({ status: 'FAIL', reason: 'SYSTEM ERROR: 0 valid images found for this article.' }) } })
        results.revisedPassIds.push(articleId)
        updateAgentTask(editorId, taskId, 'done') // image quota not met — editor completed its job, outcome is 'done'
        continue
      }

      results.firstPassIds.push(articleId)
      results.allPassedIds.push(articleId)
      log('success', `${label} PASS (1st, image OK): "${article.title}" (${article.brandId})`)
      updateAgentTask(editorId, taskId, 'done')
      continue
    }

    let lastReview = firstReview
    let currentDraft = { title: article.title, content: article.content }

    if (firstReview.incompleteInfo) {
      log('warn', `${label} [INCOMPLETE INFO] "${article.title}" — ${firstReview.reason}`)
      log('warn', `${label} [STATE MACHINE] Starting 4-step Editor↔Investigator↔Copywriter feedback loop`)
      if (brandSettings) {
        const sourceUrl = (article as any).sourceUrl as string | null
        // isSynthetic: articles sourced from the SEO-strategist placeholder have no real URL
        const isSynthetic = !sourceUrl || sourceUrl.startsWith('synthetic://')

        // ──────────────────────────────────────────────────────────────────────────
        // STEP 1 — Investigate Missing Context
        // The Investigator scrapes the original source URL to find enriched content
        // that specifically addresses the issues the Editor raised.
        // ──────────────────────────────────────────────────────────────────────────
        let step1Succeeded = false

        if (!isSynthetic && sourceUrl) {
          log('info', `${label} [STEP 1] Investigating missing context — scraping: ${sourceUrl.slice(0, 80)}`)
          const step1TaskId = addAgentTask('investigator', `[Step 1] Investigate: "${article.title.slice(0, 45)}"`)
          updateAgentTask('investigator', step1TaskId, 'in-progress')

          try {
            const scraped = await scrapeArticleContent(sourceUrl, pipelineAbortController?.signal)
            const originalLen = (articleSourceMap[articleId] || article.content).length

            if (scraped.content.length > originalLen + 200) {
              // Step 1 SUCCESS — enriched context found
              const enrichedSource = (articleSourceMap[articleId] || '') + '\n\n[Full article content — to address editor notes]:\n' + scraped.content
              articleSourceMap[articleId] = enrichedSource
              updateAgentTask('investigator', step1TaskId, 'done')

              // ────────────────────────────────────────────────────────────────────
              // STEP 3 — Targeted Update
              // Copywriter updates the draft to specifically fix the Editor's noted
              // issues, using the newly enriched source — NOT a full rewrite.
              // ────────────────────────────────────────────────────────────────────
              log('info', `${label} [STEP 3] Targeted update — Copywriter addressing editor notes: "${firstReview.reason}"`)
              const bLetter = article.brandId === 'anime' ? 'a' : article.brandId === 'toys' ? 'b' : article.brandId === 'infotainment' ? 'c' : article.brandId === 'game' ? 'd' : 'e'
              const cwId = `copywriter-${bLetter}` as NodeId
              const step3TaskId = addAgentTask(cwId, `[Step 3] Targeted fix: "${article.title.slice(0, 45)}"`)
              updateAgentTask(cwId, step3TaskId, 'in-progress')

              const revisedForNotes = await reviseArticle(
                { title: article.title, content: article.content },
                `IMPORTANT — The editor flagged these specific issues. Address each one using the additional source content below:\n${firstReview.reason}`,
                enrichedSource,
                article.brandId,
                brandGuidelines,
                brandImageCount as number,
                pipelineAbortController?.signal
              )
              await prisma.article.update({ where: { id: articleId }, data: { title: revisedForNotes.title, content: revisedForNotes.content } })
              updateAgentTask(cwId, step3TaskId, 'done')

              // Re-submit to Editor
              const step3Review = await reviewArticle(revisedForNotes.content, enrichedSource, brandGuidelines, pipelineAbortController?.signal)

              if (step3Review.status === 'PASS') {
                if (step3Review.improvedContent) {
                  revisedForNotes.content = step3Review.improvedContent
                  await prisma.article.update({ where: { id: articleId }, data: { content: step3Review.improvedContent } })
                }
                await prisma.article.update({ where: { id: articleId }, data: { reviewResult: JSON.stringify({ ...step3Review, improvedContent: undefined }) } })
                const imageQuotaMet = await runImageReview(articleId, revisedForNotes.title, enrichedSource, brandImageCount as number)
                if (!imageQuotaMet) {
                  await prisma.article.update({ where: { id: articleId }, data: { status: 'Pending Review', reviewResult: JSON.stringify({ status: 'FAIL', reason: 'SYSTEM ERROR: 0 valid images found for this article.' }) } })
                  results.revisedPassIds.push(articleId)
                  updateAgentTask(editorId, taskId, 'done')
                  continue
                }
                results.firstPassIds.push(articleId)
                results.allPassedIds.push(articleId)
                log('success', `${label} [STEP 3] PASS after targeted update: "${revisedForNotes.title}"`)
                updateAgentTask(editorId, taskId, 'done')
                continue
              } else {
                // Step 3 failed — pass the targeted draft to the revision loop below
                step1Succeeded = true
                lastReview = step3Review
                currentDraft = { title: revisedForNotes.title, content: revisedForNotes.content }
                log('info', `${label} [STEP 3] Still failing after targeted update — entering revision loop with enriched source`)
              }
            } else {
              log('warn', `${label} [STEP 1] Scraped content not significantly richer than original — Step 1 inconclusive`)
              updateAgentTask('investigator', step1TaskId, 'done')
            }
          } catch (err) {
            log('warn', `${label} [STEP 1] Scrape failed: ${err}`)
            updateAgentTask('investigator', step1TaskId, 'done')
          }
        } else {
          log('info', `${label} [STEP 1] Skipped — article uses synthetic/no source URL`)
        }

        if (!step1Succeeded) {
          // ──────────────────────────────────────────────────────────────────────
          // STEP 2 — Re-scrape Alternative
          // The Investigator could not enrich the original source. Search for a
          // completely different news source that covers the same franchise/topic,
          // specifically targeting the gaps the Editor identified.
          // ──────────────────────────────────────────────────────────────────────
          log('warn', `${label} [STEP 2] Requesting alternative news source from Investigator`)
          const step2TaskId = addAgentTask('investigator', `[Step 2] Alt source: "${article.title.slice(0, 40)}"`)
          updateAgentTask('investigator', step2TaskId, 'in-progress')

          const brandNicheForRepl = brandNiches[article.brandId] ?? settings.targetNiche
          const avoidTopics = [(article as any).sourceTitle ?? article.title]

          // First try: targeted Serper search for an alt source using the editor's notes
          // as extra context to narrow the search
          let altSourceText = ''
          let altSourceFound = false

          if (process.env.SERPER_API_KEY) {
            const altQueries = [
              `${(article as any).sourceTitle ?? article.title} news`,
              `${firstReview.reason.slice(0, 80)} ${article.brandId}`,
            ]
            const hits = await searchMultiple(altQueries, 3)
            if (hits.length > 0) {
              altSourceText = hits.map((h) => `${h.title}\n${h.snippet}`).join('\n\n')
              altSourceFound = true
              log('info', `${label} [STEP 2] Alternative source found via Serper (${hits.length} results)`)
            }
          }

          // Second try (no Serper): Topic-Driven RSS scan using the article's original
          // keyword + editor notes as the search seed
          if (!altSourceFound) {
            const topicSeed = `${(article as any).sourceTitle ?? article.title}`
            const rssCustom = {
              anime: settings.rssSourcesA, toys: settings.rssSourcesB,
              infotainment: settings.rssSourcesC, game: settings.rssSourcesD, comic: settings.rssSourcesE,
            }[article.brandId] || ''
            const rssItems = await fetchFeedsForTopic(topicSeed, brandNicheForRepl, rssCustom, 5)
            if (rssItems.length > 0) {
              const vetted = await getNextVettedTopic(rssItems, {});
              if (vetted) {
                altSourceText = `${vetted.article.title}\n${vetted.article.summary}`
                altSourceFound = true
                log('info', `${label} [STEP 2] Alternative source found & vetted via RSS scan`)
              } else {
                log('warn', `${label} [STEP 2] Found RSS items but none passed vetting`)
              }
            }
          }

          // Third try: SEO Strategist generates a fresh replacement directive
          if (!altSourceFound) {
            log('warn', `${label} [STEP 2] No alt source via search — asking SEO Strategist for replacement directive`)
            const replacementDir = await generateReplacementDirective(
              article.brandId, brandNicheForRepl, 'short-tail', avoidTopics, pipelineAbortController?.signal
            )
            if (replacementDir) {
              if (process.env.SERPER_API_KEY) {
                const hits = await searchMultiple(replacementDir.suggested_search_queries, 3)
                if (hits.length > 0) {
                  altSourceText = hits.map((h) => `${h.title}\n${h.snippet}`).join('\n\n')
                  altSourceFound = true
                }
              }
              if (!altSourceFound) {
                altSourceText = `Topic: ${replacementDir.target_keyword}\nAngle: ${replacementDir.angle}`
                altSourceFound = true
              }
            }
          }

          updateAgentTask('investigator', step2TaskId, altSourceFound ? 'done' : 'failed')

          if (altSourceFound && altSourceText.trim()) {
            // ──────────────────────────────────────────────────────────────────
            // STEP 4 — Complete Rewrite
            // Copywriter completely rewrites the article from scratch using the
            // new alternative source, and the Editor reviews it fresh.
            // ──────────────────────────────────────────────────────────────────
            log('info', `${label} [STEP 4] Complete rewrite from alternative source`)
            const bLetter = article.brandId === 'anime' ? 'a' : article.brandId === 'toys' ? 'b' : article.brandId === 'infotainment' ? 'c' : article.brandId === 'game' ? 'd' : 'e'
            const cwId = `copywriter-${bLetter}` as NodeId
            const step4TaskId = addAgentTask(cwId, `[Step 4] Rewrite: "${article.title.slice(0, 45)}"`)
            updateAgentTask(cwId, step4TaskId, 'in-progress')

            articleSourceMap[articleId] = altSourceText

            const rewrittenDraft = await draftArticle(altSourceText, article.brandId, brandGuidelines, brandImageCount as number, pipelineAbortController?.signal)
            await prisma.article.update({ where: { id: articleId }, data: { title: rewrittenDraft.title, content: rewrittenDraft.content, status: 'Pending Review' } })
            updateAgentTask(cwId, step4TaskId, 'done')

            // Editor reviews the completely rewritten article fresh
            const step4Review = await reviewArticle(rewrittenDraft.content, altSourceText, brandGuidelines, pipelineAbortController?.signal)

            if (step4Review.status === 'PASS') {
              if (step4Review.improvedContent) {
                rewrittenDraft.content = step4Review.improvedContent
                await prisma.article.update({ where: { id: articleId }, data: { content: step4Review.improvedContent } })
              }
              await prisma.article.update({ where: { id: articleId }, data: { reviewResult: JSON.stringify({ ...step4Review, improvedContent: undefined }) } })
              const imageQuotaMet = await runImageReview(articleId, rewrittenDraft.title, altSourceText, brandImageCount as number)
              if (!imageQuotaMet) {
                await prisma.article.update({ where: { id: articleId }, data: { status: 'Pending Review', reviewResult: JSON.stringify({ status: 'FAIL', reason: 'SYSTEM ERROR: 0 valid images found for this article.' }) } })
                results.revisedPassIds.push(articleId)
                updateAgentTask(editorId, taskId, 'done')
                continue
              }
              results.firstPassIds.push(articleId)
              results.allPassedIds.push(articleId)
              log('success', `${label} [STEP 4] PASS after complete rewrite: "${rewrittenDraft.title}"`)
              updateAgentTask(editorId, taskId, 'done')
              continue
            } else {
              // Step 4 failed — enter the normal revision loop with the new source
              lastReview = step4Review
              currentDraft = { title: rewrittenDraft.title, content: rewrittenDraft.content }
              log('info', `${label} [STEP 4] Rewrite still failing — entering revision loop with alt source`)
              // Note: sourceText is still the OLD source; update it to alt source for revision loop
              // We do this by updating articleSourceMap and using it as the reference in the loop below
            }
          } else {
            // All Step 2 searches exhausted — queue a fully replacement article and fail this one
            log('warn', `${label} [STEP 2] Fully exhausted — no alternative source found. Queuing replacement topic.`)
            const brandNicheForFallback = brandNiches[article.brandId] ?? settings.targetNiche
            const replacementDir = await generateReplacementDirective(
              article.brandId, brandNicheForFallback, 'short-tail', avoidTopics, pipelineAbortController?.signal
            )

            if (replacementDir && !seenDirectiveKeys.has(replacementDir.target_keyword)) {
              seenDirectiveKeys.add(replacementDir.target_keyword)
              const fallbackSource = `Topic: ${replacementDir.target_keyword}\nAngle: ${replacementDir.angle}`
              draftCounter.total++
              const fallbackArticle = await prisma.article.create({
                data: { id: uuidv4(), cycleId: article.cycleId, brandId: article.brandId, status: 'Drafting', title: `[Drafting] ${replacementDir.target_keyword}`, content: '', sourceUrl: '', sourceTitle: replacementDir.target_keyword, featuredImage: null }
              })
              const fallbackDraft = await draftArticle(fallbackSource, article.brandId, brandGuidelines, brandImageCount as number, pipelineAbortController?.signal)
              await prisma.article.update({ where: { id: fallbackArticle.id }, data: { title: fallbackDraft.title, content: fallbackDraft.content, status: 'Pending Review' } })
              articleSourceMap[fallbackArticle.id] = fallbackSource
              queue.push(fallbackArticle.id)
              draftCounter.done++
              log('info', `${label} [STEP 2] Replacement article queued: "${replacementDir.target_keyword}"`)
            }

            await prisma.article.update({
              where: { id: articleId },
              data: { status: 'Failed', reviewResult: JSON.stringify({ ...firstReview, reason: '[4-STEP LOOP EXHAUSTED] No valid source found after all fallbacks — replacement queued' }) },
            })
            updateAgentTask(editorId, taskId, 'done')
            continue
          }
        }
      }
    }

    log('warn', `${label} FAIL (1st): "${currentDraft.title}" — ${lastReview.reason}`)
    let passed = false
    let revisionNum = 0

    while (revisionNum < MAX_REVISIONS) {
      checkAbort()
      revisionNum++
      await prisma.article.update({ where: { id: articleId }, data: { status: 'Revising', reviewResult: JSON.stringify(lastReview), revisionCount: revisionNum } })
      
      // Use the live source map so Step 4's alt-source rewrite is correctly grounded
      const activeSource = articleSourceMap[articleId] || sourceText

      const bLetter = article.brandId === 'anime' ? 'a' : article.brandId === 'toys' ? 'b' : article.brandId === 'infotainment' ? 'c' : article.brandId === 'game' ? 'd' : 'e'
      const cwId = `copywriter-${bLetter}` as NodeId
      const cwTaskId = addAgentTask(cwId, `Revise #${revisionNum}: "${currentDraft.title.slice(0, 40)}"`)
      updateAgentTask(cwId, cwTaskId, 'in-progress')
      log('info', `${label} Queued to ${cwId} for Revision #${revisionNum}`)

      const revised = await reviseArticle(currentDraft, lastReview.reason, activeSource, article.brandId, brandGuidelines, brandImageCount as number, pipelineAbortController?.signal)
      currentDraft = revised
      await prisma.article.update({ where: { id: articleId }, data: { title: revised.title, content: revised.content } })

      updateAgentTask(cwId, cwTaskId, 'done')

      const review = await reviewArticle(revised.content, activeSource, brandGuidelines, pipelineAbortController?.signal)
      lastReview = review

      if (review.status === 'PASS') {
        if (review.improvedContent) {
          revised.content = review.improvedContent
          currentDraft.content = review.improvedContent
          await prisma.article.update({ where: { id: articleId }, data: { content: review.improvedContent } })
        }
        await prisma.article.update({ where: { id: articleId }, data: { reviewResult: JSON.stringify({ ...review, improvedContent: undefined }) } })
        
        const imageQuotaMet = await runImageReview(articleId, revised.title, activeSource, brandImageCount as number)
        if (!imageQuotaMet) {
          await prisma.article.update({ where: { id: articleId }, data: { status: 'Pending Review', reviewResult: JSON.stringify({ status: 'FAIL', reason: 'SYSTEM ERROR: 0 valid images found for this article.' }) } })
          results.revisedPassIds.push(articleId)
          updateAgentTask(editorId, taskId, 'done') // image quota failure — editorial outcome
          passed = true // To break out and avoid the (!passed) block below
          break
        }

        results.revisedPassIds.push(articleId)
        results.allPassedIds.push(articleId)
        log('success', `${label} PASS (rev #${revisionNum}): "${revised.title}" → queued for manual approval`)
        passed = true
        updateAgentTask(editorId, taskId, 'done')
        break
      }
    }

    if (!passed) {
      const failedReview = { ...lastReview, reason: `[MAX REVISIONS REACHED] ${lastReview.reason}` }
      const finalContent = `> ⚠️ **Editor Warning:** This article reached max revisions. Human review recommended.\n\n` + currentDraft.content
      await prisma.article.update({ where: { id: articleId }, data: { status: 'Pending Review', content: finalContent, reviewResult: JSON.stringify(failedReview) } })
      results.revisedPassIds.push(articleId)
      log('warn', `${label} MAX REVISIONS reached for "${article.title}" → Pending Review (warning prepended)`)
      updateAgentTask(editorId, taskId, 'done')
    }

  }
}

/**
 * Helper function to continuously fetch and triage until a valid, recent, 
 * and trending topic is approved by the SEO Strategist.
 */
export async function getNextVettedTopic(scrapedArticles: FeedItem[], config: any = {}) {
  for (const article of scrapedArticles) {
    checkAbort();
    // 1. Check deduplication first
    if (await hasBeenSeen(article.link)) continue;

    // 2. Triage via SEO Strategist Framework
    const triageData = await evaluateTopicViability({
      title: article.title,
      content: article.summary,
      pubDate: article.pubDate
    }, pipelineAbortController?.signal);

    if (triageData.approvedForInvestigation) {
      log('success', `[Pipeline] Topic Approved: ${article.title} (Angle: ${triageData.seoAngle})`);
      if (triageData.seoAngle) {
        if (!article.seoContext) article.seoContext = { targetKeyword: '', angle: '', brand: 'anime', topicType: 'short-tail' };
        article.seoContext.angle = triageData.seoAngle;
      }
      return { article, triageData };
    } else {
      log('warn', `[Pipeline] Topic Rejected by SEO: ${article.title} - ${triageData.reasoning}`);
      // Mark as processed/rejected in DB so we don't pick it up again
      await markAsSeen(article.link); 
    }
  }
  
  return null;
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
    const bL = (b: string) => b === 'anime' ? 'a' : b === 'toys' ? 'b' : b === 'infotainment' ? 'c' : b === 'game' ? 'd' : 'e'
    const seoTaskIds = ['anime', 'toys', 'infotainment', 'game', 'comic'].map(brand => {
      const letter = bL(brand);
      return { letter, tid: addAgentTask(`seo-strategist-${letter}` as NodeId, `Generate keyword directives`) }
    })
    seoTaskIds.forEach(t => updateAgentTask(`seo-strategist-${t.letter}` as NodeId, t.tid, 'in-progress'))
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
          const letter = bL(d.brand ?? 'anime')
          const tid = addAgentTask(`seo-strategist-${letter}` as NodeId, `[${d.topic_type}] ${d.target_keyword}`)
          updateAgentTask(`seo-strategist-${letter}` as NodeId, tid, 'done')
        }
      }
      seoTaskIds.forEach(t => updateAgentTask(`seo-strategist-${t.letter}` as NodeId, t.tid, 'done'))
    } catch (err) {
      seoTaskIds.forEach(t => updateAgentTask(`seo-strategist-${t.letter}` as NodeId, t.tid, 'failed'))
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

    const serperKeySet = !!process.env.SERPER_API_KEY
    let newItems: FeedItem[] = []
    let scrapeAttempts = 0
    let fetchMethod = (seoDirectives.length > 0 && serperKeySet) ? 0 : (seoDirectives.length > 0 ? 1 : 2)
    const MIN_TOPICS = 5
    const MAX_ATTEMPTS = 3

    while (newItems.length < MIN_TOPICS && scrapeAttempts < MAX_ATTEMPTS) {
      log('info', `[PIPELINE] Scrape Attempt ${scrapeAttempts + 1}/${MAX_ATTEMPTS}. Need ${MIN_TOPICS - newItems.length} more topics.`)
      
      let feedItems: FeedItem[] = []

      if (fetchMethod === 0) {
      // Search-driven ingestion: execute Serper queries from SEO directives
      log('info', '[INVESTIGATOR] SEO directives + SERPER_API_KEY detected — using targeted web search')

      // Helper: search one directive and return its hits
      const searchDirective = async (directive: (typeof seoDirectives)[number]) => {
        const letter = bL(directive.brand ?? 'anime')
        log('info', `[INVESTIGATOR-${letter.toUpperCase()}] Searching for [${directive.topic_type}] "${directive.target_keyword}"`)
        const taskId = addAgentTask(`investigator-${letter}` as NodeId, `Search: "${directive.target_keyword}"`)
        updateAgentTask(`investigator-${letter}` as NodeId, taskId, 'in-progress')
        const hits = await searchMultiple(directive.suggested_search_queries, 3)
        updateAgentTask(`investigator-${letter}` as NodeId, taskId, 'done')
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
    } else if (fetchMethod === 1) {
      // ── Topic-Driven RSS Fetching (Issue 2 Fix B) ──────────────────────────────
      // Serper is absent but the SEO Strategist produced directives.
      // Instead of a passive all-feeds dump, actively poll the RSS feeds that are
      // relevant to each directive's brand niche, searching for topically matching
      // items. This ensures every quota slot gets a sourced candidate.
      log('warn', '[INVESTIGATOR] SEO directives ready but SERPER_API_KEY not set — using Topic-Driven RSS Fetching')

      const rssBrandCustomFeeds: Record<string, string> = {
        anime:        settings.rssSourcesA,
        toys:         settings.rssSourcesB,
        infotainment: settings.rssSourcesC,
        game:         settings.rssSourcesD,
        comic:        settings.rssSourcesE,
      }
      const rssBrandNiches: Record<string, string> = {
        anime:        settings.nicheA || settings.targetNiche,
        toys:         settings.nicheB || settings.targetNiche,
        infotainment: settings.nicheC || settings.targetNiche,
        game:         settings.nicheD || settings.targetNiche,
        comic:        settings.nicheE || settings.targetNiche,
      }

      feedItems = []
      // Fetch per-directive in parallel; Promise.allSettled so one failure doesn't abort the batch
      const topicFetchResults = await Promise.allSettled(
        seoDirectives.map(async (directive) => {
          const brand = directive.brand || 'anime'
          const topicNiche = rssBrandNiches[brand] || settings.targetNiche
          const customFeeds = rssBrandCustomFeeds[brand] || ''
          const taskId = addAgentTask('investigator', `RSS-scan: "${directive.target_keyword}"`)
          updateAgentTask('investigator', taskId, 'in-progress')
          let items = await fetchFeedsForTopic(directive.target_keyword, topicNiche, customFeeds, 5)

          // Issue 2 Fix C: If topic RSS scan yields nothing, fall back to Serper-less
          // keyword search among the suggested_search_queries, then broader niche feeds.
          if (items.length === 0) {
            log('warn', `[INVESTIGATOR] Topic RSS scan empty for "${directive.target_keyword}" (${brand}) — broadening to full niche feeds`)
            addAgentTask('investigator', `Broad RSS fallback: "${directive.target_keyword}"`)
            // Try each suggested query as keyword against niche feeds
            for (const q of directive.suggested_search_queries ?? []) {
              items = await fetchFeedsForTopic(q, topicNiche, customFeeds, 5)
              if (items.length > 0) break
            }
          }

          if (items.length === 0) {
            log('warn', `[INVESTIGATOR] No RSS source found for "${directive.target_keyword}" — creating synthetic placeholder. Will trigger Investigator re-scrape in Editor loop.`)
            // Create a minimal synthetic FeedItem so the slot is never dropped.
            // The Editor's incompleteInfo loop will expand it.
            items = [{
              title: directive.target_keyword,
              summary: directive.angle,
              link: `synthetic://topic/${encodeURIComponent(directive.target_keyword)}-${Date.now()}`,
              pubDate: new Date().toISOString(),
              source: 'SEO Strategist (synthetic)',
            }]
          }

          updateAgentTask('investigator', taskId, 'done')

          // Stamp seoContext on all returned items
          return items.slice(0, 3).map((item) => ({
            ...item,
            seoContext: {
              topicType: directive.topic_type,
              brand,
              targetKeyword: directive.target_keyword,
              angle: directive.angle,
            },
          } as FeedItem))
        })
      )

      for (const result of topicFetchResults) {
        if (result.status === 'fulfilled') feedItems.push(...result.value)
        else log('warn', `[INVESTIGATOR] Topic fetch settled with rejection: ${result.reason}`)
      }
      log('info', `[INVESTIGATOR] Topic-Driven RSS Fetching produced ${feedItems.length} items across ${seoDirectives.length} directive(s)`)
    } else if (fetchMethod === 2) {
      // Pure RSS fallback (no directives at all)
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
      log('info', `[INVESTIGATOR] Pass yielded ${feedItems.length} raw items`)

      for (const item of feedItems) {
        checkAbort()
        const isSeen = await hasBeenSeen(item.link)
        if (!isSeen) {
          // 1. PRE-INVESTIGATION TRIAGE: SEO Strategist evaluates Recency & Trends
          const triageData = await evaluateTopicViability({
            title: item.title,
            content: item.summary,
            pubDate: item.pubDate
          }, pipelineAbortController?.signal);

          if (!triageData.approvedForInvestigation) {
            log('warn', `[Pipeline] Skipping Topic - SEO Rejected: ${item.title} - ${triageData.reasoning}`);
            await markAsSeen(item.link);
            continue; // Return false so the orchestration layer knows to fetch the next topic
          }

          if (triageData.seoAngle) {
            if (!item.seoContext) item.seoContext = { targetKeyword: '', angle: '', brand: 'anime', topicType: 'short-tail' };
            item.seoContext.angle = triageData.seoAngle;
          }

          newItems.push(item)
          if (newItems.length >= MIN_TOPICS) break;
        }
      }
      
      scrapeAttempts++
      fetchMethod = Math.min(fetchMethod + 1, 2)
    }
    
    if (newItems.length < MIN_TOPICS) {
       log('warn', `[Pipeline] Warning: Only found ${newItems.length} viable topics after ${MAX_ATTEMPTS} scrape passes. Minimum target was ${MIN_TOPICS}. Proceeding with what we have.`);
    }
    
    log('success', `[INVESTIGATOR] ${newItems.length} new items proceeding after deduplication & triage`)

    if (newItems.length === 0) {
      log('info', '[INVESTIGATOR] No new items to process. Cycle complete.')
      return cycleId
    }

    // ----------------------------------------------------------------
    // STAGE 2 — Triage: Filter by niche relevance
    // ----------------------------------------------------------------
    log('info', '[PIPELINE] Triaging articles for niche relevance...')

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

    log('info', '[PIPELINE] Brand niche configuration:')
    for (const [id, niche] of Object.entries(brandNiches)) {
      log('info', `[PIPELINE]   ${BRAND_DISPLAY_NAME[id]}: "${niche.slice(0, 80)}${niche.length > 80 ? '…' : ''}"`)
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

        if (sourceBrand) {
          // Directive-sourced item: brand is authoritative — no cross-brand triage
          const letter = bL(sourceBrand)
          const invTaskId = addAgentTask(`investigator-${letter}` as NodeId, `Triage: "${item.title.slice(0, 50)}"`)
          updateAgentTask(`investigator-${letter}` as NodeId, invTaskId, 'in-progress')

          relevantBrands.push(sourceBrand)
          log('info', `[INVESTIGATOR-${letter.toUpperCase()}] TRUSTED: "${item.title.slice(0, 60)}" → ${BRAND_DISPLAY_NAME[sourceBrand]} (directive — exclusive)`)
          updateAgentTask(`investigator-${letter}` as NodeId, invTaskId, 'done')
        } else {
          // RSS item: triage against all brands in parallel
          await Promise.all(
            Object.entries(brandNiches).map(([brandId, niche]) =>
              triageSemaphore(async () => {
                const letter = bL(brandId)
                const invTaskId = addAgentTask(`investigator-${letter}` as NodeId, `Triage: "${item.title.slice(0, 50)}"`)
                updateAgentTask(`investigator-${letter}` as NodeId, invTaskId, 'in-progress')

                const isRelevant = await triageArticle(
                  item.title,
                  item.summary,
                  niche,
                  pipelineAbortController?.signal,
                  { name: BRAND_DISPLAY_NAME[brandId], tone: brandTones[brandId] }
                )
                if (isRelevant) {
                  relevantBrands.push(brandId)
                  log('success', `[INVESTIGATOR-${letter.toUpperCase()}] PASS: "${item.title}"`)
                } else {
                  log('warn', `[INVESTIGATOR-${letter.toUpperCase()}] SKIP: "${item.title}"`)
                }
                updateAgentTask(`investigator-${letter}` as NodeId, invTaskId, 'done')
              })
            )
          )
        }

        if (relevantBrands.length > 0) {
          itemBrandRelevance[item.link] = relevantBrands
        } else {
          // Note replacement request to SEO Strategist — this is informational, not an error
          if (item.seoContext) {
            const letter = bL(item.seoContext.brand || 'anime')
            const seoTaskId = addAgentTask(`seo-strategist-${letter}` as NodeId, `Replace needed: "${item.title.slice(0, 45)}" failed triage`)
            updateAgentTask(`seo-strategist-${letter}` as NodeId, seoTaskId, 'done') // logged as completed directive
          }
        }
        await markAsSeen(item.link)
      })
    )

    const relevantItems = itemsToProcess.filter((i) => i.link in itemBrandRelevance)

    if (relevantItems.length === 0) {
      log('info', '[PIPELINE] No relevant items after triage. Cycle complete.')
      return cycleId
    }

    log('info', `[PIPELINE] ${relevantItems.length} items passed triage`)

    // ── Franchise deduplication ────────────────────────────────────────────────
    // Even after per-directive diversity checks, the pipeline can pass multiple
    // articles about the same franchise (e.g. 3× Jujutsu Kaisen from different
    // search queries). Haiku reads all passed titles and keeps only one per
    // specific franchise/IP/entity before handing off to the copywriters.
    // ──────────────────────────────────────────────────────────────────────────
    checkAbort()
    log('info', '[PIPELINE] Running franchise deduplication on passed items...')
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
    const draftCounter = { done: 0, total: 0 }

    // Count total expected drafts
    for (const item of cappedItems) {
      draftCounter.total += BASE_BRANDS.filter((b) => (itemBrandRelevance[item.link] ?? []).includes(b.id)).length
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
        () => draftCounter.done >= draftCounter.total,
        settings,
        brandNiches,
        seenDirectiveKeys,
        draftCounter,
      )
    )

    // Draft all articles using Promise.allSettled (Issue 2 Fix D):
    // Each completed draft is immediately pushed to the editor queue.
    // Promise.allSettled ensures that one failed topic fetch/draft never
    // kills the entire batch of 10 articles.
    const draftSemaphore = makeSemaphore(5)
    const draftResults = await Promise.allSettled(
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

            // 2. PASS TO INVESTIGATOR
            // Update the Investigator call to include the requested SEO Angle passed from the triage
            const insights = await investigateArticle({ title: item.title, content: item.summary }, {}, item.seoContext?.angle, pipelineAbortController?.signal);

            const seoBlock = item.seoContext
              ? `\n\nSEO CONTEXT (incorporate naturally):\n- Target Keyword: ${item.seoContext.targetKeyword}\n- Content Angle: ${item.seoContext.angle}\n- Topic Type: ${item.seoContext.topicType}`
              : ''
            const fullSourceText = `Title: ${item.title}\n\nSummary: ${item.summary}\n\nSource: ${item.source}\nPublished: ${item.pubDate}${seoBlock}\n\nINVESTIGATOR INSIGHTS:\n${insights}`

            log('info', `[COPYWRITER] Drafting for brand "${brand.id}" — "${item.title.slice(0, 60)}"`)
            const articleId = article.id
            try {
              const imageCountKey = BRAND_IMAGE_COUNT_KEY[brand.id]
              const brandImageCount = typeof settings[imageCountKey as keyof ExtendedSettings] === 'number' ? settings[imageCountKey as keyof ExtendedSettings] : 1
              const draft = await draftArticle(fullSourceText, brand.id, guidelines, brandImageCount as number, pipelineAbortController?.signal)
              await prisma.article.update({
                where: { id: article.id },
                data: { title: draft.title, content: draft.content, status: 'Pending Review' },
              })
              log('success', `[COPYWRITER] Draft complete for brand "${brand.id}": "${draft.title}"`)
              updateAgentTask(cwId, cwTaskId, 'done')
            } catch (err) {
              log('error', `[COPYWRITER] Draft failed for brand "${brand.id}": ${err}`)
              updateAgentTask(cwId, cwTaskId, 'failed')
              // Mark article so Editor can detect and skip gracefully
              await prisma.article.update({ where: { id: articleId }, data: { status: 'Pending Review' } }).catch(() => {})
            }

            // Register source text and push to editor queue immediately (even on draft failure)
            articleSourceMap[articleId] = fullSourceText
            editorQueue.push(articleId)
            draftCounter.done++

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
    // Log any top-level draft rejections (shouldn't happen — each inner try/catch handles errors)
    draftResults.forEach((r, i) => {
      if (r.status === 'rejected') log('error', `[COPYWRITER] Unhandled draft slot ${i} rejected: ${r.reason}`)
    })

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
          let publishContent = article.content
          const extraImgs: string[] = (article as any).images
            ? JSON.parse((article as any).images)
            : []
            
          const imagesToResolve = []
          if ((article as any).featuredImage) imagesToResolve.push((article as any).featuredImage)
          imagesToResolve.push(...extraImgs)
          publishContent = await resolveImages(publishContent, imagesToResolve)

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
