import { reviewImage } from '../lib/llm';

async function runTest() {
  const articleTitle = "Contoh Berita Anime";
  const articleSubject = "Artikel tentang rilis anime baru dan ulasan karakternya.";
  
  // A URL that sometimes triggers the wrong MIME type from hosts
  const testImageUrl = "https://picsum.photos/800/600.jpg"; 

  console.log('--- 1. TESTING IMAGE REVIEW & MIME DETECTION ---');
  console.log(`URL: ${testImageUrl}`);
  
  const review = await reviewImage(testImageUrl, articleTitle, articleSubject);
  console.log(`Status: ${review.status}`);
  console.log(`Reason: ${review.reason}`);
}

runTest().catch(console.error);
