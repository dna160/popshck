import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { publishToWordPress } from '@/lib/wordpress'
import { generateSocialPost } from '@/lib/social-media'
import { publishToInstagram, isInstagramConfigured } from '@/lib/instagram'
import { log } from '@/lib/logger'
import { resolveImages } from '@/lib/image-resolver'

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const article = await prisma.article.findUnique({ where: { id: params.id } })

    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 })
    }

    if (article.status === 'Published') {
      return NextResponse.json(
        { error: 'Article is already published' },
        { status: 409 }
      )
    }

    if (article.status === 'Failed') {
      return NextResponse.json(
        { error: 'Cannot approve a Failed article' },
        { status: 422 }
      )
    }

    log('info', `[API] Approving article "${article.title}" for publication...`)

    let publishContent = article.content
    const extraImgs: string[] = (article as any).images
      ? JSON.parse((article as any).images)
      : []

    const imagesToResolve = []
    if (article.featuredImage) imagesToResolve.push(article.featuredImage)
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
      featuredImageUrl: article.featuredImage ?? undefined,
    })

    const updated = await prisma.article.update({
      where: { id: params.id },
      data: {
        status: 'Published',
        wpPostId: String(wpResult.id),
      },
    })

    log('success', `[API] Article "${article.title}" published — WP ID: ${wpResult.id}`)

    // ── Social media: generate caption → post to Instagram ──────────────────
    if (isInstagramConfigured() && article.featuredImage) {
      try {
        const caption = await generateSocialPost(
          { title: article.title, content: article.content },
          wpResult.link
        )
        await publishToInstagram(article.featuredImage, caption)
      } catch (socialErr) {
        // Social posting errors never block the API response
        log('error', `[SOCIAL] Instagram post failed for "${article.title}": ${socialErr}`)
      }
    } else if (!isInstagramConfigured()) {
      log('info', '[SOCIAL] Instagram credentials not set — skipping social post')
    } else {
      log('warn', `[SOCIAL] No featured image for "${article.title}" — Instagram requires an image, skipping`)
    }

    return NextResponse.json({
      article: updated,
      wpPostId: wpResult.id,
      wpLink: wpResult.link,
    })
  } catch (err) {
    log('error', `[API /articles/${params.id}/approve] Error: ${err}`)
    return NextResponse.json({ error: `Failed to publish article: ${err}` }, { status: 500 })
  }
}
