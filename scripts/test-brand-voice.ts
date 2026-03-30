/**
 * Brand voice sandbox test.
 * Verifies that user-configured tone/voice is read from the DB and passed to the LLM.
 *
 * Run with: npm run test:brand-voice
 */
import { config as dotenvConfig } from 'dotenv';
import path from 'path';

dotenvConfig({ path: path.join(process.cwd(), '.env.local'), override: true });
dotenvConfig({ path: path.join(process.cwd(), '.env'),       override: false });

import { PrismaClient } from '@prisma/client';
import { draftArticle, BRAND_GUIDELINES } from '../lib/llm';

const prisma = new PrismaClient();

const BRANDS = [
  { id: 'anime',        toneKey: 'toneA', letter: 'A' },
  { id: 'toys',         toneKey: 'toneB', letter: 'B' },
];

const SOURCE = [
  'Title: International Anime Convention Breaks Attendance Record',
  'Summary: A major anime and pop-culture convention reported its highest ever single-day',
  'attendance of 85,000 visitors. The event featured exclusive merchandise drops, voice actor',
  'Q&A panels, and world premiere trailers for three upcoming anime series. Organisers',
  'confirmed a new venue partnership to double capacity next year.',
].join(' ');

const DEFAULT_TONES: Record<string, string> = {
  toneA: 'Anime: energetic, otaku-friendly, pop-culture savvy',
  toneB: 'Toys: playful, family-friendly, collector-focused',
  toneC: 'Infotainment: engaging, informative, trending-topic driven',
  toneD: 'Game: hype-driven, gamer-voice, esports-aware',
  toneE: 'Comic: fan-focused, narrative-driven, superhero & manga aware',
};

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  BRAND VOICE SANDBOX TEST');
  console.log('══════════════════════════════════════════════════════════════\n');

  // Read all tone fields directly via raw SQL (extended fields invisible to Prisma ORM)
  let extRow: Record<string, unknown> = {};
  try {
    const rows = await (prisma as any).$queryRawUnsafe(
      `SELECT toneA, toneB, toneC, toneD, toneE FROM "Settings" WHERE id = ?`,
      'singleton'
    ) as Array<Record<string, unknown>>;
    if (rows.length > 0) {
      extRow = rows[0];
      console.log('✅  DB read OK — extended fields accessible via raw SQL\n');
    } else {
      console.log('⚠️  No Settings row found — defaults will be used.\n');
    }
  } catch (err) {
    console.log(`⚠️  Raw SQL read failed (schema may not have extended columns yet): ${err}\n`);
  }

  for (const brand of BRANDS) {
    const savedTone = ((extRow[brand.toneKey] as string) || '').trim();
    const defaultTone = DEFAULT_TONES[brand.toneKey];
    const effectiveTone = savedTone || defaultTone;
    const isCustom = !!savedTone && savedTone !== defaultTone;

    console.log(`──────────────────────────────────────────────────────────────`);
    console.log(`  Copywriter ${brand.letter}  (${brand.id.toUpperCase()})`);
    console.log(`  Source:  ${isCustom ? '🟢 USER-CONFIGURED tone' : '⚪ Fallback default tone'}`);
    console.log(`  Tone:    "${effectiveTone}"\n`);

    // Build the same guidelines string that pipeline.ts builds
    const guidelines = effectiveTone +
      '\n\nWrite a complete news article in JSON format: {"title":"...","content":"..."}';

    console.log('  Sending to LLM...');
    const draft = await draftArticle(SOURCE, brand.id, guidelines);

    if (draft.title.includes('[Draft Failed]')) {
      console.log('  ❌ Draft FAILED — check ANTHROPIC_API_KEY\n');
      continue;
    }

    console.log(`\n  Title  : ${draft.title}`);
    console.log(`  Excerpt: ${draft.content.slice(0, 250).replace(/\n/g, ' ')}…`);
    console.log();

    if (isCustom) {
      console.log(`  🎯 Custom brand voice was active — check excerpt reflects configured tone.`);
    } else {
      console.log(`  ℹ️  No saved tone for ${brand.letter} yet — default guidelines were used.`);
      console.log(`     Open the Copywriter ${brand.letter} node in the UI, set a tone, save,`);
      console.log(`     then re-run this test to confirm your custom voice reaches the LLM.`);
    }
    console.log();
  }

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  TEST COMPLETE');
  console.log('══════════════════════════════════════════════════════════════\n');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Test error:', err);
  prisma.$disconnect();
  process.exit(1);
});
