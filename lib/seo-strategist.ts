import { config as dotenvConfig } from 'dotenv'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { log } from './logger'
import { withRetry } from './llm'
import { prisma } from './prisma'

dotenvConfig({ path: path.join(process.cwd(), '.env.local'), override: true })
dotenvConfig({ path: path.join(process.cwd(), '.env'), override: false })

export interface InvestigatorDirective {
  topic_type: 'short-tail' | 'evergreen'
  brand: string // 'anime' | 'toys' | 'infotainment' | 'game' | 'comic'
  target_keyword: string
  search_intent: string
  angle: string
  suggested_search_queries: string[]
}

export interface SeoStrategyOutput {
  investigator_directives: InvestigatorDirective[]
}

const BRAND_IDS = ['anime', 'toys', 'infotainment', 'game', 'comic'] as const

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
    _client = new Anthropic({ apiKey })
  }
  return _client
}

const MODEL = 'claude-haiku-4-5-20251001'

/** Query SeoDirective records from the last `hours` hours and extract all used keywords. */
async function getRecentKeywords(hours: number): Promise<string[]> {
  if (hours <= 0) return []
  try {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
    const rows = await prisma.$queryRawUnsafe<Array<{ directives: string }>>(
      `SELECT directives FROM "SeoDirective" WHERE createdAt >= ? ORDER BY createdAt DESC LIMIT 50`,
      cutoff
    )
    const keywords: string[] = []
    for (const row of rows) {
      try {
        const directives: InvestigatorDirective[] = JSON.parse(row.directives)
        for (const d of directives) {
          if (d.target_keyword) keywords.push(d.target_keyword)
        }
      } catch {
        // skip malformed rows
      }
    }
    return [...new Set(keywords)]
  } catch {
    return []
  }
}

function buildStrategistPrompt(
  niches: Record<string, string>,
  shortTailPerBrand: number,
  evergreenPerBrand: number,
  recentKeywords: string[],
  extraAvoidTopics: string[] = []
): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Jakarta',
  })

  const totalPerBrand = shortTailPerBrand + evergreenPerBrand
  const totalDirectives = totalPerBrand * 5

  const keywordsBlock = recentKeywords.length > 0
    ? `\n⛔ KEYWORDS ALREADY USED THIS SESSION (do NOT reuse these exact keywords):\n${recentKeywords.map((k) => `  - "${k}"`).join('\n')}\n`
    : ''

  const investigatorFlagBlock = extraAvoidTopics.length > 0
    ? `\n🔴 INVESTIGATOR ALERT — The following specific topics/franchises were recently published or caused duplication. Replace them with DIFFERENT subjects within the SAME brand niche:\n${extraAvoidTopics.map((t) => `  ✗ ${t}`).join('\n')}\n`
    : ''

  const avoidBlock = keywordsBlock + investigatorFlagBlock

  // Build the per-brand example structure
  const exampleDirective = (brand: string, type: 'short-tail' | 'evergreen') => ({
    brand,
    topic_type: type,
    target_keyword: '...',
    search_intent: '...',
    angle: '...',
    suggested_search_queries: ['...', '...', '...'],
  })

  const exampleDirectives: ReturnType<typeof exampleDirective>[] = []
  for (const brand of BRAND_IDS) {
    for (let i = 0; i < shortTailPerBrand; i++) exampleDirectives.push(exampleDirective(brand, 'short-tail'))
    for (let i = 0; i < evergreenPerBrand; i++) exampleDirectives.push(exampleDirective(brand, 'evergreen'))
  }

  const nicheLines = [
    `- anime: ${niches.anime || 'anime, manga, Japanese animation, otaku culture'}`,
    `- toys: ${niches.toys || 'toys, collectibles, action figures, hobby merchandise'}`,
    `- infotainment: ${niches.infotainment || 'celebrity news, trending entertainment, viral stories'}`,
    `- game: ${niches.game || 'video games, esports, gaming hardware, game releases'}`,
    `- comic: ${niches.comic || 'comics, graphic novels, manga, superhero media'}`,
  ].join('\n')

  return `You are the Lead SEO Strategist for an Indonesian digital publishing network. Your goal is to maximize organic traffic by balancing explosive short-tail trends with high-value evergreen content.

Today's date (Jakarta time): ${today}

Our 5 brand niches:
${nicheLines}
${avoidBlock}
Your Task:
For EACH of the 5 brands (anime, toys, infotainment, game, comic), generate:
- ${shortTailPerBrand} Short-Tail directive${shortTailPerBrand === 1 ? '' : 's'}: trending topic${shortTailPerBrand === 1 ? '' : 's'} requiring immediate news coverage today in Indonesia
- ${evergreenPerBrand} Evergreen directive${evergreenPerBrand === 1 ? '' : 's'}: long-term foundational topic${evergreenPerBrand === 1 ? '' : 's'} for steady month-over-month traffic

Total output: ${totalDirectives} directives (${totalPerBrand} per brand × 5 brands).

Rules:
- Every directive MUST include a "brand" field matching exactly one of: anime, toys, infotainment, game, comic
- Each brand MUST receive exactly ${shortTailPerBrand} short-tail + ${evergreenPerBrand} evergreen directive(s)
- All directives must be DISTINCT topics — no overlapping keywords or angles across ANY brand
- Short-tail topics must be genuinely trending RIGHT NOW in Indonesia
- Evergreen topics must have lasting search value
- The "brand" field determines which copywriter writes the article — pick the most relevant brand for each topic
${recentKeywords.length > 0 ? '- Avoid the exact keywords listed above — picking a different subject within the same genre is fine\n' : ''}
For each directive, define:
- target_keyword: exact keyword (Bahasa Indonesia or English, whichever dominates search volume)
- search_intent: what users are looking for
- angle: the specific take our copywriter should use
- suggested_search_queries: exact queries for the Investigator agent (include site: operators where helpful)

You MUST respond with ONLY a valid JSON object — no preamble, no explanation:
${JSON.stringify({ investigator_directives: exampleDirectives }, null, 2)}`
}

/**
 * Build a minimal prompt for generating a single replacement directive for one brand.
 * Called by the Investigator when a topic is rejected due to recent publication.
 */
function buildReplacementPrompt(
  brand: string,
  niche: string,
  topicType: 'short-tail' | 'evergreen',
  avoidTopics: string[]
): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Asia/Jakarta',
  })

  return `You are the SEO Strategist. The Investigator has rejected a topic for one of our brands because it was recently published.

Today (Jakarta): ${today}
Brand: ${brand}
Niche: ${niche}
Topic type needed: ${topicType}

🔴 REJECTED / RECENTLY PUBLISHED (do NOT suggest these or closely related subjects):
${avoidTopics.map((t) => `  ✗ "${t}"`).join('\n')}

Generate exactly 1 fresh ${topicType} directive for brand "${brand}". Choose a DIFFERENT specific subject within the niche — same genre is fine, just a distinct title/subject.

Respond ONLY with valid JSON (no preamble):
${JSON.stringify({
    brand,
    topic_type: topicType,
    target_keyword: '...',
    search_intent: '...',
    angle: '...',
    suggested_search_queries: ['...', '...', '...'],
  }, null, 2)}`
}

/**
 * Run the SEO Strategist agent to generate per-brand investigator directives.
 * Generates shortTailPerBrand + evergreenPerBrand topics for EACH of the 5 brands.
 */
export async function generateSeoDirectives(
  niches: { nicheA: string; nicheB: string; nicheC?: string; nicheD?: string; nicheE?: string },
  signal?: AbortSignal,
  options: {
    dedupeHours?: number
    shortTailPerBrand?: number
    evergreenPerBrand?: number
    // Legacy flat-mode used by detectTopicConcentration replacement calls
    shortTailCount?: number
    evergreenCount?: number
    extraAvoidTopics?: string[]
  } = {}
): Promise<InvestigatorDirective[]> {
  const dedupeHours = options.dedupeHours ?? 24

  // Per-brand mode (new default) vs legacy flat mode
  const isPerBrandMode = options.shortTailPerBrand !== undefined || options.evergreenPerBrand !== undefined
  const shortTailPerBrand = Math.max(0, options.shortTailPerBrand ?? options.shortTailCount ?? 2)
  const evergreenPerBrand = Math.max(0, options.evergreenPerBrand ?? options.evergreenCount ?? 1)

  if (shortTailPerBrand + evergreenPerBrand === 0) {
    log('warn', '[SEO STRATEGIST] Both counts are 0 — skipping directive generation')
    return []
  }

  const isReplacement = (options.extraAvoidTopics?.length ?? 0) > 0
  if (isPerBrandMode) {
    log('info', `[SEO STRATEGIST] Generating directives: ${shortTailPerBrand} short-tail + ${evergreenPerBrand} evergreen per brand × 5 brands = ${(shortTailPerBrand + evergreenPerBrand) * 5} total${isReplacement ? ' [REPLACEMENT MODE]' : ''} (dedup window: ${dedupeHours}h)`)
  } else {
    log('info', `[SEO STRATEGIST] [REPLACEMENT] Generating ${shortTailPerBrand} replacement directive(s)`)
  }

  const recentKeywords = await getRecentKeywords(dedupeHours)
  if (recentKeywords.length > 0) {
    log('info', `[SEO STRATEGIST] Avoiding ${recentKeywords.length} recent keyword(s)`)
  }

  const nicheMap = {
    anime:        niches.nicheA,
    toys:         niches.nicheB,
    infotainment: niches.nicheC ?? '',
    game:         niches.nicheD ?? '',
    comic:        niches.nicheE ?? '',
  }

  const totalExpected = isPerBrandMode
    ? (shortTailPerBrand + evergreenPerBrand) * 5
    : shortTailPerBrand + evergreenPerBrand

  try {
    const response = await withRetry(() => getClient().messages.create(
      {
        model: MODEL,
        max_tokens: Math.min(8192, Math.max(1500, totalExpected * 250)),
        temperature: 0.85,
        messages: [
          {
            role: 'user',
            content: buildStrategistPrompt(
              nicheMap,
              isPerBrandMode ? shortTailPerBrand : Math.ceil(shortTailPerBrand / 5),
              isPerBrandMode ? evergreenPerBrand : Math.ceil(evergreenPerBrand / 5),
              recentKeywords,
              options.extraAvoidTopics ?? []
            ),
          },
        ],
      },
      { signal }
    ), signal)

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const parsed = JSON.parse(jsonText) as SeoStrategyOutput

    if (!Array.isArray(parsed.investigator_directives) || parsed.investigator_directives.length === 0) {
      throw new Error('Invalid SEO strategist response: missing investigator_directives')
    }

    log('success', `[SEO STRATEGIST] Generated ${parsed.investigator_directives.length} directives`)
    for (const d of parsed.investigator_directives) {
      log('info', `[SEO STRATEGIST] [${(d.brand ?? 'unknown').toUpperCase()}] [${d.topic_type.toUpperCase()}] "${d.target_keyword}" — ${d.angle}`)
    }

    return parsed.investigator_directives
  } catch (err) {
    if (signal?.aborted) throw err
    log('error', `[SEO STRATEGIST] Failed to generate directives: ${err}`)
    return []
  }
}

/**
 * Generate a single replacement directive for a specific brand.
 * Called by the Investigator when a topic is rejected due to recent publication or conflict.
 */
export async function generateReplacementDirective(
  brand: string,
  niche: string,
  topicType: 'short-tail' | 'evergreen',
  avoidTopics: string[],
  signal?: AbortSignal
): Promise<InvestigatorDirective | null> {
  log('info', `[SEO STRATEGIST] Generating replacement [${topicType}] for brand "${brand}" — avoiding: ${avoidTopics.map(t => `"${t}"`).join(', ')}`)

  try {
    const response = await withRetry(() => getClient().messages.create(
      {
        model: MODEL,
        max_tokens: 512,
        temperature: 0.9,
        messages: [{ role: 'user', content: buildReplacementPrompt(brand, niche, topicType, avoidTopics) }],
      },
      { signal }
    ), signal)

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const parsed = JSON.parse(jsonText) as InvestigatorDirective

    if (!parsed.target_keyword || !parsed.angle) {
      throw new Error('Invalid replacement directive response')
    }

    // Ensure brand is stamped correctly
    parsed.brand = brand
    parsed.topic_type = topicType

    log('success', `[SEO STRATEGIST] Replacement ready: "${parsed.target_keyword}" for ${brand}`)
    return parsed
  } catch (err) {
    if (signal?.aborted) throw err
    log('warn', `[SEO STRATEGIST] Failed to generate replacement for ${brand}: ${err}`)
    return null
  }
}
