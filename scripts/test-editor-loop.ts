import { draftArticle, reviewArticle, reviseArticle, BRAND_GUIDELINES } from '../lib/llm';

async function runTest() {
  const sourceText = `Title: Contoh Berita Sandbox\n\nSummary: Ini adalah teks simulasi untuk menguji pipeline editor dan copywriter. Tidak ada fakta nyata di sini, hanya tes.\n\nSource: Internal\nPublished: 2026-03-30`;
  const brand = 'anime';
  const guidelines = BRAND_GUIDELINES[brand] || 'Write a factual news article.';

  console.log('--- 1. INITIAL DRAFTING ---');
  let draft = await draftArticle(sourceText, brand, guidelines);
  console.log(`Title: ${draft.title}`);

  console.log('\n--- 2. INITIAL REVIEW ---');
  let review = await reviewArticle(draft.content, sourceText);
  console.log(`Status: ${review.status}`);
  console.log(`Reason: ${review.reason}`);
  console.log(`Incomplete Info: ${review.incompleteInfo}`);

  let revisionCount = 0;
  const MAX_REVISIONS = 5;

  while (review.status === 'FAIL' && revisionCount < MAX_REVISIONS) {
    revisionCount++;
    console.log(`\n--- 3. REVISION ATTEMPT ${revisionCount} ---`);
    
    draft = await reviseArticle(draft, review.reason, sourceText, brand, guidelines);
    console.log(`New Title: ${draft.title}`);
    
    review = await reviewArticle(draft.content, sourceText);
    console.log(`New Status: ${review.status}`);
    console.log(`Editor Feedback: ${review.reason}`);
  }

  if (review.status === 'PASS') {
    console.log(`\n✅ Passed after ${revisionCount} revisions!`);
  } else {
    console.log(`\n❌ Failed. Max revisions reached. Final Editor Complaint: ${review.reason}`);
    console.log(`\nFinal Draft Title: ${draft.title}`);
    console.log(`Final Draft Content:\n${draft.content}`);
  }
}

runTest().catch(console.error);
