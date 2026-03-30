import Parser from 'rss-parser'
import { log } from './logger'

const FEED_TIMEOUT_MS = 10_000

export interface FeedItem {
  title: string
  summary: string
  link: string
  pubDate: string
  source: string
  featuredImage?: string
  seoContext?: {
    topicType: 'short-tail' | 'evergreen'
    brand: string          // 'anime' | 'toys' | 'infotainment' | 'game' | 'comic'
    targetKeyword: string
    angle: string
  }
}

// ── Niche → RSS feed discovery table ──────────────────────────────────────────
// Maps niche keywords to known public RSS feeds. Case-insensitive partial match.
const NICHE_FEED_MAP: { keywords: string[]; feeds: { url: string; name: string }[] }[] = [
  {
    keywords: ['anime', 'manga', 'japanese animation', 'otaku', 'akihabara', 'light novel'],
    feeds: [
      { url: 'https://www.animenewsnetwork.com/all/rss.xml?ann-edition=us', name: 'Anime News Network' },
      { url: 'https://myanimelist.net/rss/news.xml', name: 'MyAnimeList News' },
      { url: 'https://feeds.feedburner.com/crunchyroll/anime-simulcast', name: 'Crunchyroll' },
    ],
  },
  {
    keywords: ['tech', 'technology', 'gadget', 'consumer electronics', 'smartphone', 'ai', 'startup'],
    feeds: [
      { url: 'https://feeds.feedburner.com/TechCrunch', name: 'TechCrunch' },
      { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge' },
      { url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', name: 'Ars Technica Tech' },
    ],
  },
  {
    keywords: ['crypto', 'bitcoin', 'blockchain', 'defi', 'nft', 'web3'],
    feeds: [
      { url: 'https://cointelegraph.com/rss', name: 'CoinTelegraph' },
      { url: 'https://coindesk.com/arc/outboundfeeds/rss', name: 'CoinDesk' },
    ],
  },
  {
    keywords: ['finance', 'stock', 'investment', 'economy', 'market', 'trading'],
    feeds: [
      { url: 'https://feeds.bloomberg.com/markets/news.rss', name: 'Bloomberg Markets' },
      { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', name: 'WSJ Markets' },
    ],
  },
  {
    keywords: ['gaming', 'game', 'esports', 'playstation', 'xbox', 'nintendo', 'steam'],
    feeds: [
      { url: 'https://www.ign.com/articles.rss', name: 'IGN' },
      { url: 'https://kotaku.com/rss', name: 'Kotaku' },
    ],
  },
  {
    keywords: ['health', 'medical', 'wellness', 'fitness', 'nutrition', 'mental health'],
    feeds: [
      { url: 'https://www.medicalnewstoday.com/rss', name: 'Medical News Today' },
      { url: 'https://feeds.webmd.com/rss/rss.aspx', name: 'WebMD' },
    ],
  },
  {
    keywords: ['property', 'real estate', 'properti', 'rumah', 'apartemen', 'kpr'],
    feeds: [
      { url: 'https://www.detik.com/properti/rss', name: 'Detik Properti' },
      { url: 'https://ekonomi.bisnis.com/feed', name: 'Bisnis Indonesia' },
    ],
  },
  {
    keywords: ['fashion', 'style', 'beauty', 'luxury', 'clothing', 'streetwear'],
    feeds: [
      { url: 'https://wwd.com/feed', name: 'WWD Fashion' },
      { url: 'https://hypebeast.com/feed', name: 'Hypebeast' },
    ],
  },
  {
    keywords: ['food', 'culinary', 'restaurant', 'recipe', 'gastronomy', 'cuisine'],
    feeds: [
      { url: 'https://www.eater.com/rss/index.xml', name: 'Eater' },
      { url: 'https://www.seriouseats.com/atom.xml', name: 'Serious Eats' },
    ],
  },
  {
    keywords: ['science', 'research', 'space', 'nasa', 'physics', 'biology', 'climate'],
    feeds: [
      { url: 'https://www.sciencedaily.com/rss/all.xml', name: 'Science Daily' },
      { url: 'https://feeds.newscientist.com/science-news', name: 'New Scientist' },
    ],
  },
  {
    keywords: ['sport', 'football', 'soccer', 'basketball', 'tennis', 'formula 1', 'f1'],
    feeds: [
      { url: 'https://www.bbc.co.uk/sport/rss.xml', name: 'BBC Sport' },
      { url: 'https://feeds.skysports.com/rss/sports/formula1', name: 'Sky F1' },
    ],
  },
  {
    keywords: ['music', 'hiphop', 'kpop', 'pop', 'album', 'artist', 'concert', 'streaming'],
    feeds: [
      { url: 'https://pitchfork.com/rss/news/feed.xml', name: 'Pitchfork' },
      { url: 'https://www.billboard.com/feed', name: 'Billboard' },
    ],
  },
]

// Default fallback feeds (general technology / world news)
const DEFAULT_FEEDS = [
  { url: 'https://feeds.feedburner.com/TechCrunch', name: 'TechCrunch' },
  { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index.xml', name: 'Ars Technica' },
]

// ── Feed resolution ────────────────────────────────────────────────────────────

/**
 * Resolve the best RSS feeds for a given niche string.
 * Returns niche-matched feeds first, then falls back to DEFAULT_FEEDS.
 */
export function resolveFeedsForNiche(niche: string): { url: string; name: string }[] {
  if (!niche || !niche.trim()) return DEFAULT_FEEDS

  const query = niche.toLowerCase()
  const matched: { url: string; name: string }[] = []

  for (const entry of NICHE_FEED_MAP) {
    if (entry.keywords.some((kw) => query.includes(kw))) {
      matched.push(...entry.feeds)
    }
  }

  return matched.length > 0 ? matched : DEFAULT_FEEDS
}

/**
 * Parse a comma-separated string of RSS URLs into feed descriptors.
 */
function parseCustomFeeds(raw: string): { url: string; name: string }[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('http'))
    .map((url) => ({ url, name: new URL(url).hostname }))
}

// ── Mock article generation ────────────────────────────────────────────────────

function buildMockArticles(niches: string[]): FeedItem[] {
  // Generate plausible-looking mock article headlines per niche
  const niche = niches[0] || 'technology'
  const titles = [
    `Breaking: Major Development in ${niche} Industry Shakes Up the Market`,
    `${niche}: A New Era Begins as Key Players Announce Strategic Shifts`,
    `Deep Dive: What the Latest ${niche} Trends Mean for You`,
  ]
  return [
    {
      title: titles[0],
      summary: `Industry analysts are watching closely as a series of high-impact announcements reshape the landscape of ${niche}. Experts weigh in on what this means for consumers and investors alike.`,
      link: `https://mock.pantheon.local/${niche.replace(/\s+/g, '-').toLowerCase()}/breaking-${Date.now()}`,
      pubDate: new Date().toISOString(),
      source: 'Mock Feed',
    },
    {
      title: titles[1],
      summary: `Multiple key stakeholders in the ${niche} space have simultaneously announced major strategic pivots. This convergence signals a turning point that could define the next decade of the industry.`,
      link: `https://mock.pantheon.local/${niche.replace(/\s+/g, '-').toLowerCase()}/strategic-${Date.now() + 1}`,
      pubDate: new Date(Date.now() - 60_000).toISOString(),
      source: 'Mock Feed',
    },
    {
      title: titles[2],
      summary: `As the ${niche} sector evolves at breakneck speed, consumers and professionals alike are trying to keep up. We break down the most important trends you need to know right now.`,
      link: `https://mock.pantheon.local/${niche.replace(/\s+/g, '-').toLowerCase()}/trends-${Date.now() + 2}`,
      pubDate: new Date(Date.now() - 120_000).toISOString(),
      source: 'Mock Feed',
    },
  ]
}

// ── Core fetcher ───────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  if (!html) return ''
  return html
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, '')
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Extract the first image URL from an RSS item using multiple strategies. */
function extractFeaturedImage(item: any, rawHtml: string): string | undefined {
  // 1. media:content with medium="image" or type starting with "image/"
  if (item.mediaContent) {
    const mc = Array.isArray(item.mediaContent) ? item.mediaContent[0] : item.mediaContent
    const url = mc?.$?.url || mc?.url
    if (url && typeof url === 'string' && url.startsWith('http')) return url
  }

  // 2. media:thumbnail
  if (item.mediaThumbnail) {
    const mt = Array.isArray(item.mediaThumbnail) ? item.mediaThumbnail[0] : item.mediaThumbnail
    const url = mt?.$?.url || mt?.url
    if (url && typeof url === 'string' && url.startsWith('http')) return url
  }

  // 3. enclosure (common in podcast/image feeds)
  if (item.enclosure?.url && item.enclosure.type?.startsWith('image/')) {
    return item.enclosure.url
  }

  // 4. itunes:image
  if (item.itunesImage) {
    const url = item.itunesImage?.$?.href || item.itunesImage?.href
    if (url && typeof url === 'string' && url.startsWith('http')) return url
  }

  // 5. First <img> tag inside content:encoded / description HTML
  if (rawHtml) {
    const match = rawHtml.match(/<img[^>]+src=["']([^"']+)["']/i)
    if (match?.[1]?.startsWith('http')) return match[1]
  }

  return undefined
}


async function fetchFeedWithTimeout(
  feedUrl: string,
  feedName: string,
  timeoutMs: number
): Promise<FeedItem[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const parser = new Parser({
      requestOptions: { signal: controller.signal },
      timeout: timeoutMs,
      // Custom fields to catch common RSS variants
      customFields: {
        item: [
          ['content:encoded', 'contentEncoded'],
          ['description', 'description'],
          ['media:content', 'mediaContent'],
          ['media:thumbnail', 'mediaThumbnail'],
          ['itunes:image', 'itunesImage'],
        ],
      },
    })

    const feed = await parser.parseURL(feedUrl)
    clearTimeout(timeoutId)

    return (feed.items || []).map((item: any) => {
      const rawSummary = item.contentEncoded || item.content || item.contentSnippet || item.summary || item.description || ''
      const cleanedSummary = stripHtml(rawSummary)

      // Extract featured image from multiple possible RSS fields
      const featuredImage = extractFeaturedImage(item, rawSummary)

      return {
        title: item.title || 'Untitled',
        summary: cleanedSummary,
        link: item.link || item.guid || feedUrl,
        pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
        source: feedName,
        featuredImage,
      }
    })
  } catch (err) {
    clearTimeout(timeoutId)
    throw err
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface FetchFeedsOptions {
  /** Niche for Copywriter A (anime) */
  nicheA?: string
  /** Niche for Copywriter B (toys) */
  nicheB?: string
  /** Niche for Copywriter C (infotainment) */
  nicheC?: string
  /** Niche for Copywriter D (game) */
  nicheD?: string
  /** Niche for Copywriter E (comic) */
  nicheE?: string
  /** Custom RSS URLs for Copywriter A (comma-separated) */
  rssSourcesA?: string
  /** Custom RSS URLs for Copywriter B (comma-separated) */
  rssSourcesB?: string
  /** Custom RSS URLs for Copywriter C (comma-separated) */
  rssSourcesC?: string
  /** Custom RSS URLs for Copywriter D (comma-separated) */
  rssSourcesD?: string
  /** Custom RSS URLs for Copywriter E (comma-separated) */
  rssSourcesE?: string
  /** Global niche fallback */
  targetNiche?: string
}

/**
 * Fetch all feeds relevant to the configured niches.
 * Priority: custom RSS sources > niche-matched feeds > default feeds
 */
export async function fetchAllFeeds(opts: FetchFeedsOptions = {}): Promise<FeedItem[]> {
  const {
    nicheA = '', nicheB = '', nicheC = '', nicheD = '', nicheE = '',
    rssSourcesA = '', rssSourcesB = '', rssSourcesC = '', rssSourcesD = '', rssSourcesE = '',
    targetNiche = '',
  } = opts

  // Build the union of feeds for ALL active niches
  const feedSet = new Map<string, { url: string; name: string }>() // url → descriptor (dedup by URL)

  const addFeeds = (feeds: { url: string; name: string }[]) => {
    for (const f of feeds) feedSet.set(f.url, f)
  }

  // Custom per-brand feeds take highest priority
  if (rssSourcesA.trim()) addFeeds(parseCustomFeeds(rssSourcesA))
  if (rssSourcesB.trim()) addFeeds(parseCustomFeeds(rssSourcesB))
  if (rssSourcesC.trim()) addFeeds(parseCustomFeeds(rssSourcesC))
  if (rssSourcesD.trim()) addFeeds(parseCustomFeeds(rssSourcesD))
  if (rssSourcesE.trim()) addFeeds(parseCustomFeeds(rssSourcesE))

  // Niche-inferred feeds — deduplicate by resolved niche string
  const effectiveNicheA = nicheA.trim() || targetNiche
  const effectiveNicheB = nicheB.trim() || targetNiche
  const effectiveNicheC = nicheC.trim() || targetNiche
  const effectiveNicheD = nicheD.trim() || targetNiche
  const effectiveNicheE = nicheE.trim() || targetNiche

  const seenNiches = new Set<string>()
  for (const niche of [effectiveNicheA, effectiveNicheB, effectiveNicheC, effectiveNicheD, effectiveNicheE]) {
    if (niche && !seenNiches.has(niche)) {
      seenNiches.add(niche)
      addFeeds(resolveFeedsForNiche(niche))
    }
  }

  // If no niche is configured at all, fall back to defaults
  if (feedSet.size === 0) addFeeds(DEFAULT_FEEDS)

  const feeds = Array.from(feedSet.values())
  log('info', `[RSS] Resolved ${feeds.length} feeds for current config`)

  const results: FeedItem[] = []
  let anySucceeded = false

  for (const feed of feeds) {
    try {
      log('info', `[RSS] Fetching feed: ${feed.name} (${feed.url})`)
      const items = await fetchFeedWithTimeout(feed.url, feed.name, FEED_TIMEOUT_MS)
      log('success', `[RSS] Fetched ${items.length} items from ${feed.name}`)
      results.push(...items)
      anySucceeded = true
    } catch (err) {
      log('warn', `[RSS] Failed to fetch ${feed.name}: ${err}. Skipping.`)
    }
  }

  if (!anySucceeded || results.length === 0) {
    const niches = [effectiveNicheA, effectiveNicheB, effectiveNicheC, effectiveNicheD, effectiveNicheE].filter(Boolean)
    log('warn', '[RSS] All feeds failed or returned no items. Using niche-aware mock fallback data.')
    return buildMockArticles(niches)
  }

  return results
}
