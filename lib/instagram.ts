import { log } from './logger'

const IG_API_VERSION = 'v18.0'
const IG_BASE = `https://graph.facebook.com/${IG_API_VERSION}`

function getCredentials(): { userId: string; accessToken: string } {
  const userId = process.env.INSTAGRAM_USER_ID
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN
  if (!userId || !accessToken) {
    throw new Error(
      'INSTAGRAM_USER_ID and INSTAGRAM_ACCESS_TOKEN must be set in .env.local'
    )
  }
  return { userId, accessToken }
}

/**
 * Returns true if Instagram credentials are configured.
 * Use this to gate Instagram publishing without throwing.
 */
export function isInstagramConfigured(): boolean {
  return !!(process.env.INSTAGRAM_USER_ID && process.env.INSTAGRAM_ACCESS_TOKEN)
}

/**
 * Publish a photo post to Instagram via the Graph API.
 *
 * Flow:
 *  1. POST /{user-id}/media       → creates a media container, returns creation_id
 *  2. POST /{user-id}/media_publish → publishes the container, returns the post ID
 *
 * Requirements:
 *  - INSTAGRAM_USER_ID env var    — numeric Instagram Business/Creator account ID
 *  - INSTAGRAM_ACCESS_TOKEN env var — long-lived access token with instagram_basic
 *    and instagram_content_publish permissions
 *  - imageUrl must be a publicly accessible HTTPS URL (Instagram fetches it directly)
 */
export async function publishToInstagram(
  imageUrl: string,
  caption: string
): Promise<{ id: string }> {
  const { userId, accessToken } = getCredentials()

  // ── Step 1: Create media container ────────────────────────────────────────
  const containerRes = await fetch(`${IG_BASE}/${userId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      caption,
      access_token: accessToken,
    }),
  })

  if (!containerRes.ok) {
    const errText = await containerRes.text().catch(() => 'unknown error')
    log('error', `[Instagram] Container creation failed (HTTP ${containerRes.status}): ${errText}`)
    throw new Error(`Instagram container creation failed: ${errText}`)
  }

  const containerData = (await containerRes.json()) as { id?: string }
  const creationId = containerData.id
  if (!creationId) {
    throw new Error('Instagram API did not return a container ID')
  }
  log('info', `[Instagram] Media container created: ${creationId}`)

  // ── Step 2: Publish the container ─────────────────────────────────────────
  const publishRes = await fetch(`${IG_BASE}/${userId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: creationId,
      access_token: accessToken,
    }),
  })

  if (!publishRes.ok) {
    const errText = await publishRes.text().catch(() => 'unknown error')
    log('error', `[Instagram] Publish failed (HTTP ${publishRes.status}): ${errText}`)
    throw new Error(`Instagram publish failed: ${errText}`)
  }

  const publishData = (await publishRes.json()) as { id?: string }
  const postId = publishData.id
  if (!postId) {
    throw new Error('Instagram publish response missing post ID')
  }

  log('success', `[Instagram] Post published — IG post ID: ${postId}`)
  return { id: postId }
}
