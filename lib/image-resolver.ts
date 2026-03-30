import { log } from './logger'
import type { FeedItem } from './rss-fetcher'

const SCRAPE_TIMEOUT_MS = 6_000
const SEARCH_TIMEOUT_MS = 8_000

// ── Stage 3a: Serper image search (preferred when API key available) ────────

async function searchImagesSerper(query: string, maxCount: number): Promise<string[]> {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) return []
  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: Math.min(maxCount * 2, 20) }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
    const data = (await res.json()) as { images?: Array<{ imageUrl?: string }> }
    const found: string[] = []
    for (const item of (data.images || [])) {
      if (item.imageUrl?.startsWith('http')) {
        found.push(item.imageUrl)
        if (found.length >= maxCount) break
      }
    }
    return found
  } catch {
    return []
  }
}

// ── Stage 2: Scrape og:image from article page ─────────────────────────────

async function scrapeOgImage(url: string): Promise<string | undefined> {
  if (!url || url.includes('mock.pantheon.local')) return undefined
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    if (!res.ok) return undefined

    // Stream only until </head> or 60KB — whichever comes first
    const reader = res.body?.getReader()
    if (!reader) return undefined
    const decoder = new TextDecoder()
    let html = ''
    let bytes = 0
    try {
      while (bytes < 60_000) {
        const { done, value } = await reader.read()
        if (done || !value) break
        html += decoder.decode(value, { stream: true })
        bytes += value.length
        if (html.includes('</head>') || html.includes('<body')) break
      }
    } finally {
      reader.cancel().catch(() => {})
    }

    // og:image (both attribute orderings)
    const og =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
    if (og?.[1]?.startsWith('http')) return og[1]

    // twitter:image
    const tw =
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)
    if (tw?.[1]?.startsWith('http')) return tw[1]

    return undefined
  } catch {
    return undefined
  }
}

// ── Stage 3: DuckDuckGo image search ──────────────────────────────────────

function extractSearchKeywords(title: string, summary: string): string {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'has', 'have', 'had', 'that', 'this', 'these', 'those', 'it', 'its',
    'as', 'into', 'up', 'will', 'would', 'could', 'should', 'may', 'might',
    'after', 'before', 'about', 'over', 'then', 'than', 'also', 'when',
    'gets', 'says', 'said', 'amid', 'more', 'just', 'even', 'back',
    'time', 'year', 'years', 'week', 'weeks', 'what', 'where', 'there',
  ])
  // Weight title more heavily (repeat it) so its words rank higher
  const combined = `${title} ${title} ${summary}`
  const words = combined
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w))

  const seen = new Set<string>()
  const unique: string[] = []
  for (const w of words) {
    if (!seen.has(w)) { seen.add(w); unique.push(w) }
  }
  return unique.slice(0, 5).join(' ')
}

async function searchImagesDDG(query: string, maxCount: number): Promise<string[]> {
  try {
    // Step 1: fetch DDG search page to extract the vqd token
    const initRes = await fetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
      {
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS / 2),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
      }
    )
    const initHtml = await initRes.text()
    const vqdMatch = initHtml.match(/vqd=["']?([\d-]+)["']?/)
    if (!vqdMatch?.[1]) return []
    const vqd = vqdMatch[1]

    // Step 2: fetch image JSON results
    const imgRes = await fetch(
      `https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&o=json&p=1&s=0&u=bing&f=,,,&l=us-en`,
      {
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS / 2),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://duckduckgo.com/',
          Accept: 'application/json, text/javascript',
        },
      }
    )
    const data = (await imgRes.json()) as {
      results?: Array<{ image?: string; thumbnail?: string }>
    }

    const found: string[] = []
    for (const r of (data.results || []).slice(0, maxCount * 3)) {
      if (r.image?.startsWith('http')) {
        found.push(r.image)
        if (found.length >= maxCount) break
      }
    }
    return found
  } catch {
    return []
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve up to `count` images for a feed item using a 3-stage pipeline:
 *   1. RSS feed embedded image (already set on item.featuredImage if present)
 *   2. og:image / twitter:image scraped from the article page
 *   3. DuckDuckGo image search (returns multiple results to fill remaining slots)
 */
export async function resolveItemImages(item: FeedItem, count: number = 1): Promise<string[]> {
  if (count <= 0) return []

  const images: string[] = []
  const seen = new Set<string>()

  const add = (url: string | undefined) => {
    if (url && url.startsWith('http') && !seen.has(url)) {
      seen.add(url)
      images.push(url)
    }
  }

  // Stage 1 — already extracted from RSS feed
  add(item.featuredImage)
  if (images.length >= count) return images

  // Stage 2 — scrape article page for og:image
  log('info', `[IMAGE] Scraping og:image: "${item.title.slice(0, 60)}"`)
  const ogImage = await scrapeOgImage(item.link)
  if (ogImage) log('success', `[IMAGE] og:image found for "${item.title.slice(0, 50)}"`)
  add(ogImage)
  if (images.length >= count) return images

  // Stage 3 — Image search (Serper preferred, DDG fallback)
  const remaining = count - images.length
  const keywords = extractSearchKeywords(item.title, item.summary)
  log('info', `[IMAGE] Image search (need ${remaining}): "${keywords}"`)
  let searchImages = await searchImagesSerper(keywords, remaining)
  if (searchImages.length === 0) searchImages = await searchImagesDDG(keywords, remaining)
  if (searchImages.length > 0) log('success', `[IMAGE] ${searchImages.length} search image(s) found for "${item.title.slice(0, 50)}"`)
  for (const img of searchImages) add(img)

  if (images.length === 0) log('warn', `[IMAGE] No images resolved for "${item.title.slice(0, 50)}"`)
  return images
}

/** Convenience wrapper — resolves exactly 1 image (backward-compat). */
export async function resolveItemImage(item: FeedItem): Promise<string | undefined> {
  const imgs = await resolveItemImages(item, 1)
  return imgs[0]
}

/**
 * Investigator image replacement search.
 * Searches for `count` images relevant to the article by title/subject,
 * excluding any URLs already tried (to avoid returning the same rejected image).
 */
export async function searchReplacementImage(
  title: string,
  subject: string,
  excludeUrls: string[],
  count: number = 1,
): Promise<string[]> {
  const excludeSet = new Set(excludeUrls)
  const keywords = extractSearchKeywords(title, subject)
  log('info', `[IMAGE] Replacement image search: "${keywords}"`)

  const dedupe = (urls: string[]) => urls.filter((u) => u.startsWith('http') && !excludeSet.has(u))

  // Serper first, DDG fallback — fetch extra candidates to compensate for exclusions
  const fetchCount = count + excludeUrls.length + 5
  let candidates = dedupe(await searchImagesSerper(keywords, fetchCount))
  if (candidates.length === 0) candidates = dedupe(await searchImagesDDG(keywords, fetchCount))

  const results = candidates.slice(0, count)
  if (results.length > 0) {
    log('success', `[IMAGE] ${results.length} replacement image(s) found`)
  } else {
    log('warn', `[IMAGE] No replacement images found for "${title.slice(0, 50)}"`)
  }
  return results
}
