import { config as dotenvConfig } from 'dotenv'
import path from 'path'
import { marked } from 'marked'
import { log } from './logger'

dotenvConfig({ path: path.join(process.cwd(), '.env.local'), override: true })
dotenvConfig({ path: path.join(process.cwd(), '.env'), override: false })

// ── WordPress retry helper ────────────────────────────────────────────────────
// Retries fetch calls that fail with transient server errors (5xx, network).
// 4xx errors (except 429) are not retried — they indicate a client-side problem.
const WP_RETRY_MAX_ATTEMPTS = 4
const WP_RETRY_BASE_DELAY_MS = 10_000

function wpSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withWpRetry(fn: () => Promise<Response>): Promise<Response> {
  let attempt = 0
  while (true) {
    let response: Response | null = null
    try {
      response = await fn()
    } catch (networkErr) {
      // Network-level failure (DNS, connection refused, etc.)
      attempt++
      if (attempt >= WP_RETRY_MAX_ATTEMPTS) throw networkErr
      const delay = WP_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
      log('warn', `[WordPress] Network error — attempt ${attempt}/${WP_RETRY_MAX_ATTEMPTS}. Retrying in ${delay / 1000}s... (${networkErr})`)
      await wpSleep(delay)
      continue
    }

    // Retry on 429 or any 5xx (transient server-side errors)
    const isRetryable = response.status === 429 || (response.status >= 500 && response.status < 600)
    if (!isRetryable) return response

    attempt++
    if (attempt >= WP_RETRY_MAX_ATTEMPTS) return response // let caller handle the error body

    const delay = WP_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
    log('warn', `[WordPress] HTTP ${response.status} — attempt ${attempt}/${WP_RETRY_MAX_ATTEMPTS}. Retrying in ${delay / 1000}s...`)
    await wpSleep(delay)
  }
}

interface WPPublishResult {
  id: number
  link: string
}

type WPBackend = 'mock' | 'wpcom' | 'selfhosted'

// ── Brand → WordPress Category mapping ───────────────────────────────────────
// Category IDs sourced from https://hotpink-dogfish-392833.hostingersite.com
// /wp-json/wp/v2/categories — verified 2026-03-31
// To refresh: GET /wp-json/wp/v2/categories?per_page=50
const BRAND_CATEGORY_ID: Record<string, number> = {
  'anime':        11,  // Anime
  'toys':         12,  // Toys
  'infotainment': 10,  // Infotainment
  'game':         13,  // Game
  'comic':        14,  // Comic
  'event':        17,  // Event
}

// Slug names for the wpcom v1.1 API (which takes category slugs, not IDs)
const BRAND_CATEGORY_SLUG: Record<string, string> = {
  'anime':        'anime',
  'toys':         'toys',
  'infotainment': 'infotainment',
  'game':         'game',
  'comic':        'comic',
  'event':        'event',
}

function getWPCredentials(): {
  postsEndpoint: string
  updateEndpoint: (postId: string) => string
  authHeader: string
  backend: WPBackend
} {
  const siteUrl = (process.env.WP_URL || 'http://localhost:3000/api/mock-wordpress').replace(/\/$/, '')

  if (siteUrl.includes('/api/mock-wordpress')) {
    const wpUsername = process.env.WP_USERNAME || 'admin'
    const wpPassword = process.env.WP_APP_PASSWORD || 'mock_password_here'
    const credentials = Buffer.from(`${wpUsername}:${wpPassword.trim()}`).toString('base64')
    return {
      postsEndpoint: siteUrl,
      updateEndpoint: (id) => `${siteUrl}/${id}`,
      authHeader: `Basic ${credentials}`,
      backend: 'mock',
    }
  }

  if (siteUrl.includes('wordpress.com')) {
    // WordPress.com hosted: use REST v1.1 API + OAuth2 Bearer token
    const accessToken = process.env.WPCOM_ACCESS_TOKEN
    if (!accessToken) {
      throw new Error('WPCOM_ACCESS_TOKEN is not set. Run the OAuth2 flow to generate one.')
    }
    const hostname = new URL(siteUrl).hostname
    const base = `https://public-api.wordpress.com/rest/v1.1/sites/${hostname}`
    return {
      postsEndpoint: `${base}/posts/new`,
      updateEndpoint: (id) => `${base}/posts/${id}`,
      authHeader: `Bearer ${accessToken}`,
      backend: 'wpcom',
    }
  }

  // Self-hosted WordPress: use Application Password with Basic auth
  const wpUsername = process.env.WP_USERNAME || 'admin'
  const wpPassword = process.env.WP_APP_PASSWORD || ''
  const credentials = Buffer.from(`${wpUsername}:${wpPassword.trim()}`).toString('base64')
  return {
    postsEndpoint: `${siteUrl}/wp-json/wp/v2/posts`,
    updateEndpoint: (id) => `${siteUrl}/wp-json/wp/v2/posts/${id}`,
    authHeader: `Basic ${credentials}`,
    backend: 'selfhosted',
  }
}

/**
 * Upload an image URL to the WordPress.com media library.
 * Returns the media attachment ID, or undefined on failure.
 */
async function uploadMediaFromUrl(
  imageUrl: string,
  siteHostname: string,
  authHeader: string
): Promise<number | undefined> {
  try {
    const res = await fetch(
      `https://public-api.wordpress.com/rest/v1.1/sites/${siteHostname}/media/new`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ media_urls: [imageUrl] }),
      }
    )
    if (!res.ok) return undefined
    const data = (await res.json()) as { media?: Array<{ ID?: number }>; errors?: unknown[] }
    const mediaId = data.media?.[0]?.ID
    if (mediaId) {
      log('success', `[WordPress] Uploaded media ID ${mediaId} from ${imageUrl.slice(0, 60)}`)
    }
    return mediaId
  } catch {
    return undefined
  }
}

async function uploadMediaSelfHosted(
  imageUrl: string,
  siteUrl: string,
  authHeader: string
): Promise<number | undefined> {
  let attempt = 0
  while (true) {
    try {
      const imgRes = await fetch(imageUrl)
      if (!imgRes.ok) return undefined
      const imgBuffer = await imgRes.arrayBuffer()
      
      const filename = (imageUrl.split('?')[0].split('/').pop() || 'featured_image.jpg').replace(/[^a-zA-Z0-9.\-]/g, '_')
      const ext = filename.split('.').pop()?.toLowerCase() || 'jpg'
      const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }
      const contentType = mimeMap[ext] || 'image/jpeg'
      
      const mediaRes = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}"`,
          Authorization: authHeader,
        },
        body: Buffer.from(imgBuffer),
      })
      
      if (!mediaRes.ok) {
        log('warn', `[WordPress] Media upload failed ${mediaRes.status}: ${await mediaRes.text().catch(()=>'')}`)
        return undefined
      }
      
      const mediaData = (await mediaRes.json()) as { id?: number }
      if (mediaData.id) {
        log('success', `[WordPress] Image uploaded successfully, media ID: ${mediaData.id}`)
        return mediaData.id
      }
      return undefined
    } catch (err) {
      attempt++
      if (attempt >= 3) {
        log('error', `[WordPress] Upload media error: ${err}`)
        return undefined
      }
      await wpSleep(2000)
    }
  }
}

/**
 * Publish a new article to WordPress via REST API.
 * Returns the created post ID and link.
 */
export async function publishToWordPress(article: {
  title: string
  content: string
  brandId: string
  featuredImageUrl?: string
}): Promise<WPPublishResult> {
  const { postsEndpoint, authHeader, backend } = getWPCredentials()

  // Resolve category for this brand
  const categoryId   = BRAND_CATEGORY_ID[article.brandId]   ?? 1   // fallback: Uncategorized
  const categorySlug = BRAND_CATEGORY_SLUG[article.brandId] ?? 'uncategorized'

  const payload: Record<string, unknown> = {
    title: article.title,
    content: await marked.parse(article.content),
    status: 'publish',
  }

  if (backend === 'wpcom') {
    // v1.1 API: categories field is a comma-separated slug string
    payload.categories = categorySlug
    if (article.featuredImageUrl) {
      const hostname = new URL(process.env.WP_URL!).hostname
      const mediaId = await uploadMediaFromUrl(article.featuredImageUrl, hostname, authHeader)
      if (mediaId) payload.featured_image = mediaId
    }
  } else {
    // wp/v2 REST API: categories field is an array of numeric IDs
    payload.categories = [categoryId]
    payload.meta = { brand_id: article.brandId }
    if (article.featuredImageUrl) {
      const siteUrl = (process.env.WP_URL || 'http://localhost:3000/api/mock-wordpress').replace(/\/$/, '')
      const mediaId = await uploadMediaSelfHosted(article.featuredImageUrl, siteUrl, authHeader)
      if (mediaId) {
        payload.featured_media = mediaId
      }
      payload.jetpack_featured_media_url = article.featuredImageUrl
    }
  }

  log('info', `[WordPress] Publishing to category: ${categorySlug} (ID ${categoryId}) for brand "${article.brandId}"`)  

  let response: Response
  try {
    response = await withWpRetry(() => fetch(postsEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    }))
  } catch (err) {
    log('error', `[WordPress] Network error while publishing: ${err}`)
    throw new Error(`WordPress publish failed (network): ${err}`)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    log('error', `[WordPress] Publish returned HTTP ${response.status}: ${errorText}`)
    throw new Error(`WordPress publish failed (HTTP ${response.status}): ${errorText}`)
  }

  // v1.1 returns { ID, URL } — wp/v2 returns { id, link }
  const data = (await response.json()) as { ID?: number; id?: number; URL?: string; link?: string }
  const postId = data.ID ?? data.id
  const postLink = data.URL ?? data.link

  if (!postId) {
    throw new Error(`WordPress publish response missing post ID`)
  }

  return { id: postId, link: postLink || `${postsEndpoint}/${postId}` }
}

/**
 * Update an existing WordPress post via REST API.
 */
export async function updateWordPressPost(
  wpPostId: string,
  article: { title: string; content: string }
): Promise<void> {
  const { updateEndpoint, authHeader, backend } = getWPCredentials()

  const updateUrl = updateEndpoint(wpPostId)

  const payload = {
    title: article.title,
    content: article.content,
  }

  // v1.1 API uses POST for updates; wp/v2 and mock use PUT
  const method = backend === 'wpcom' ? 'POST' : 'PUT'

  let response: Response
  try {
    response = await withWpRetry(() => fetch(updateUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    }))
  } catch (err) {
    log('error', `[WordPress] Network error while updating post ${wpPostId}: ${err}`)
    throw new Error(`WordPress update failed (network): ${err}`)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    log('error', `[WordPress] Update post ${wpPostId} returned HTTP ${response.status}: ${errorText}`)
    throw new Error(`WordPress update failed (HTTP ${response.status}): ${errorText}`)
  }

  log('success', `[WordPress] Post ${wpPostId} updated successfully`)
}
