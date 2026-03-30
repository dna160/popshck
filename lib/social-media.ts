import Anthropic from '@anthropic-ai/sdk'
import { config as dotenvConfig } from 'dotenv'
import path from 'path'
import { log } from './logger'

dotenvConfig({ path: path.join(process.cwd(), '.env.local'), override: true })
dotenvConfig({ path: path.join(process.cwd(), '.env'), override: false })

const MODEL = 'claude-haiku-4-5-20251001'
let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
    _client = new Anthropic({ apiKey })
  }
  return _client
}

/**
 * Social Media Specialist agent.
 * Given a published article and its URL, returns a scroll-stopping social post
 * suitable for Instagram, Twitter, and LinkedIn.
 */
export async function generateSocialPost(
  article: { title: string; content: string },
  publishedUrl: string,
  signal?: AbortSignal
): Promise<string> {
  // Strip HTML tags and truncate for context window efficiency
  const plainContent = article.content
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000)

  const prompt = `You are a social media specialist. I will provide you with a full news article draft.
Your task is to write a highly engaging social media post (for Twitter and LinkedIn) driving traffic to this article.

Rules:
1. HEADLINE: Write a completely new, "scroll-stopping" headline under 10 words. It must be punchy, shorter than the article title, but factually accurate.
2. HOOK: Write 2 short sentences summarizing the core value or controversy.
3. CALL TO ACTION: End with "Read the full breakdown here: ${publishedUrl}"
4. TAGS: Add 2 highly relevant hashtags.

Output ONLY the final social media text.

ARTICLE TITLE: ${article.title}

ARTICLE CONTENT:
${plainContent}`

  log('info', `[SOCIAL] Generating social post for: "${article.title}"`)

  const response = await getClient().messages.create(
    {
      model: MODEL,
      max_tokens: 512,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    },
    { signal }
  )

  const text =
    response.content[0].type === 'text' ? response.content[0].text.trim() : ''

  log('success', `[SOCIAL] Social post generated (${text.length} chars)`)
  return text
}
