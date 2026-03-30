# DISCIPLES — Synthetic Newsroom · Implementation Log

> Project codename: **Pantheon Newsroom**  
> Stack: Next.js 14 · TypeScript · Prisma · SQLite · Anthropic Claude (Haiku)  
> Repo: `d:\Claude Home\Popshck\pantheon-newsroom`

---

## Release History

---

### v1.5.0 — Pipeline Fidelity, Image Magic-Bytes & LLM Quality  
**Date:** 2026-03-30  
**Branch:** `master`  
**Staged files:** 19 changed · +1,205 / −751 lines

#### Summary
This release addresses three distinct reliability issues discovered during live pipeline runs: LLM-truncated articles due to insufficient token budget, Claude Vision API 400 errors caused by incorrect MIME-type detection, and hallucination bleed-through in revision cycles. It also fixes a class of false-positive agent error state surfacing in the UI and adds destination endpoint node types to the type system.

---

#### Fix: LLM Token Budget (`lib/llm.ts`)

**Problem:** `draftArticle()` and `reviseArticle()` both had `max_tokens: 1024`. For medium-length news articles (800–1200 words) this cap silently truncated the JSON response body, causing `JSON.parse` failures or articles that ended mid-sentence.

**Fix:** Raised `max_tokens` to `2048` for both functions. Revision temperature also reduced from `0.5` → `0.2` to reduce creative drift during the fix-only revision pass.

**Files changed:** `lib/llm.ts` (lines 154, 576)

---

#### Fix: Image Media-Type via Magic Bytes (`lib/llm.ts`)

**Problem:** `fetchImageAsBase64()` inferred image MIME type from the HTTP `Content-Type` response header. Many CDNs serve images with a generic `application/octet-stream` or no `Content-Type` header, causing Claude Vision to receive incorrectly typed base64 data and return HTTP 400 errors. This silently dropped all images for affected articles.

**Fix:** Replaced header-based MIME detection with **magic-bytes inspection** of the raw buffer. The first 4–12 bytes of the downloaded image are checked against well-known signatures:

| Magic Bytes | MIME Type |
|---|---|
| `FF D8` | `image/jpeg` |
| `89 50 4E 47` | `image/png` |
| `47 49 46` | `image/gif` |
| `52 49 46 46 … 57 45 42 50` | `image/webp` |

Falls back to the `Content-Type` header only if no signature matches.

**Files changed:** `lib/llm.ts` (lines 276–302)

---

#### Fix: Hallucination Bleed-Through in Revisions (`lib/llm.ts`)

**Problem:** When the editor flagged hallucinated facts, names, or statistics, the revision prompt did not explicitly forbid the copywriter from rephrasing the hallucinated material instead of removing it. This allowed incorrect information to survive through multiple revision cycles with different wording.

**Fix:** Added a `CRITICAL INSTRUCTION` block to the revision system prompt:

```
CRITICAL INSTRUCTION: If the editor tells you to remove a fact, name, quote, or
statistic because it is hallucinated or not in the source, YOU MUST REMOVE IT
COMPLETELY. Do not rephrase it or make up a replacement.
```

**Files changed:** `lib/llm.ts` (lines 582–583)

---

#### Fix: False-Positive Agent Error States (`lib/pipeline.ts`)

**Problem:** The editor loop marked agent tasks as `'failed'` for business-logic outcomes (skipping irrelevant content, replacing insufficient sources, routing items to no brand). This caused the pipeline UI to display alarming red error indicators for completely normal editorial decisions.

**Fix:** Audited every `updateAgentTask(id, taskId, 'failed')` call and reclassified editorial outcomes:

| Location | Old Status | New Status | Rationale |
|---|---|---|---|
| Router — item triage miss | `'failed'` | `'done'` | Skipping irrelevant content is correct behaviour |
| Router — SEO replacement log | `'failed'` | `'done'` | Logging a directive is not a failure |
| Editor — replacement queued | `'failed'` | `'done'` | Replacement strategy succeeded |
| Editor — unknown brand | `'failed'` | `'done'` | Graceful skip — not a system error |

**Files changed:** `lib/pipeline.ts` (multiple sites)

---

#### Fix: Image Quota Miss Handling (`lib/pipeline.ts`)

**Problem:** `runImageReview()` could return with zero valid images found but the article would still be marked `PASS` and queued for WordPress publish, resulting in imageless published articles.

**Fix:** `runImageReview()` now returns a boolean `imageQuotaMet`. The editor loop checks this return value: if false, the article is set to `Pending Review` with a diagnostics reason (`SYSTEM ERROR: 0 valid images found`) but the agent task is still marked `'done'` (not `'failed'`). This surfaces the issue for human triage without alarming the pipeline health indicators.

**Files changed:** `lib/pipeline.ts` (editor loop, image review integration)

---

#### Fix: MAX_REVISIONS Reason Tagging (`lib/pipeline.ts`)

**Problem:** When an article hit the maximum revision limit, the `reviewResult` stored in the database had the same schema as a normal rejection, making it hard to distinguish timeout exhaustion from legitimate quality failures during triage.

**Fix:** The final stored review reason is now prefixed with `[MAX REVISIONS REACHED]` before writing to the database.

**Files changed:** `lib/pipeline.ts` (editor loop, !passed block)

---

#### Feature: Destination Endpoint Node Types (`types/index.ts`)

Added three new `NodeId` union members representing pipeline output destinations:

```typescript
| 'website'
| 'social-media'
| 'video'
```

These match the OperationMap terminal nodes and allow typed state tracking for each destination channel.

**Files changed:** `types/index.ts` (lines 99–101)

---

#### Feature: Zigzag-Fan Layout & Z-Index Stacking (`components/OperationMap.tsx`, `app/globals.css`)

Full responsive pipeline diagram overhaul:
- Copywriter nodes A–E rendered in a staggered zigzag-fan arc for visual depth
- `.node-wrapper:hover { z-index: 999 }` CSS rule prevents expanded flip-card task overlays from being occluded by sibling nodes
- Sticky-footer pattern for `MasterControls` utilising full viewport height

---

#### Feature: Sandbox Test Scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `scripts/test-brand-voice.ts` | End-to-end brand voice → LLM prompt → output verification |
| `scripts/test-editor-loop.ts` | Editor loop flow simulation |
| `scripts/test-image-review.ts` | Image review pipeline smoke test |

Runner config: `tsconfig.scripts.json` (CJS module target) decoupled from Next.js ESM config.

---

### v1.4.0 — Brand Voice Persistence & Pipeline Fidelity  
**Date:** 2026-03-30  
**Branch:** `master`

#### Summary
Fixed a critical silent data-loss bug where user-configured brand voice and tone instructions were being ignored by the pipeline background worker, causing every article to be written using hardcoded fallback guidelines instead of the user's custom instructions.

#### Bug Fix: `getSettings()` Silent Extended-Field Drop (Critical)

**Root cause:** `lib/pipeline.ts → getSettings()` used `prisma.settings.findUnique()` to read the `Settings` table. Prisma's generated client only returns columns declared in `schema.prisma`. The extended columns (`toneA–E`, `nicheA–E`, `rssSourcesA–E`, `imageCountA–E`) were added via raw SQL migrations and are **invisible to the Prisma ORM client**. The spread `{ ...defaults, ...row }` therefore always produced an object where the extended fields were `undefined`, falling back silently to the hardcoded defaults.

**Fix:** Added a supplementary `$queryRawUnsafe` SQL query inside `getSettings()` that explicitly selects all extended fields. The final settings object is built in three layers of priority:
```
{ ...defaults, ...prismaRow, ...rawSqlExtendedFields }
```

**Files changed:** `lib/pipeline.ts` (lines 254–307)

#### Feature: Brand Voice Sandbox Test (`scripts/test-brand-voice.ts`)

Verified results (2026-03-30T14:24 UTC+7):

| Copywriter | Brand | Tone Source | LLM Output |
|---|---|---|---|
| A | Anime | 🟢 User-configured | "Konvensi Anime Internasional Pecahkan Rekor..." (Bahasa Indonesia, otaku slang) |
| B | Toys | 🟢 User-configured | "...Peluang Emas untuk Kolektor..." (collector voice) |

**Run:** `npm run test:brand-voice`

---

### v1.3.0 — Dashboard UI Overhaul  
**Date:** 2026-03-30  
**Branch:** `master`

#### Summary
Comprehensive visual and UX overhaul of the Pantheon dashboard — pipeline diagram layout, flip-card node interactivity, real-time status bars, and settings persistence.

#### Feature: Zigzag-Fan Pipeline Layout (`components/OperationMap.tsx`)

Restructured the copywriter section from a flat column to a staggered zigzag-fan arc. Five copywriter nodes (A–E) offset vertically in an alternating pattern. The diagram uses the full viewport height via a sticky-footer pattern for `MasterControls`.

#### Fix: Flip-Card Node Z-Index Stacking

Added `.node-wrapper:hover { z-index: 999; position: relative; }` to prevent expanded task overlays being occluded by sibling nodes.

#### Feature: Dynamic Niche Status Bars (`components/SystemStatusBar.tsx`, `components/MasterControls.tsx`)

Replaced hardcoded niche labels with a live 5-column grid reading `settings.nicheA–E` at render time. Each pill displays brand icon, configured niche string, and brand-specific accent color.

#### Fix: Settings Save Race Condition (`components/PantheonDashboard.tsx`)

Added a `settingsOverride` state atom. After save, the API PUT response is immediately applied to `settingsOverride`. All components reading settings prefer `settingsOverride` over the polling result, eliminating the 0–10 second revert window.

---

### v1.2.0 — AI Pipeline UI Stabilization  
**Date:** 2026-03-30  
**Branch:** `master`

#### Summary
Bound `OperationMap` frontend nodes directly to real-time agent task data. Eliminated false-positive error states. Implemented high-frequency polling (1000ms) during active pipeline cycles.

#### Key Changes
- `components/FlipPipelineNode.tsx` — Refactored to accept live task arrays as props, replacing static mock data
- `components/PipelineNode.tsx` — Added granular status-based styling (idle / in-progress / done / failed)
- `lib/pipeline.ts` — Separated `EDITORIAL_REJECTION` from `SYSTEM_ERROR` states
- `components/TerminalLog.tsx` — Enhanced SSE stream integration with connection-status indicator

---

### v1.1.0 — Multi-Page Scraping & Editor Loop  
**Date:** 2026-03-29  
**Commit:** `1d1a593`

- Multi-page scraping support for RSS sources
- Incomplete-info editorial rejection tag surfaced in the pipeline UI
- Re-investigation loop: editor can request additional research before revision

---

### v1.0.1 — LLM Retry & Rate Limit  
**Date:** 2026-03-29  
**Commit:** `fc4d0c7` / `315ab49`

- Retry LLM call on JSON parse error (previously only re-parsed the same malformed text)
- Rate limit retry with exponential backoff
- Brand exclusivity filter
- Article count cap per pipeline cycle
- WordPress publish retry on transient failures

---

### v1.0.0 — Initial Release  
**Date:** 2026-03-28  
**Commit:** `c698e19`

Initial commit: Disciples AI Pipeline Dashboard.

- SEO Strategist → Investigator → Router → 5× Copywriter → 3× Editor pipeline
- WordPress REST API publish integration
- Prisma + SQLite persistence layer
- Next.js 14 dashboard with SSE real-time log stream
- Anthropic Claude integration (`claude-haiku-4-5-20251001`)

---

## Architecture Reference

### Pipeline Flow
```
RSS Sources
    │
    ▼
SEO Strategist ──── Keyword clustering, dedup, topic scoring
    │
    ▼
Investigator ──────── Multi-page scrape, source enrichment
    │
    ▼
Router ─────────────── Brand relevance scoring (A–E)
    │
    ├──▶ Copywriter A (Anime)
    ├──▶ Copywriter B (Toys)
    ├──▶ Copywriter C (Infotainment)
    ├──▶ Copywriter D (Game)
    └──▶ Copywriter E (Comic)
              │
              ▼
    ┌─────────────────┐
    │  Editor Pool    │  (A / B / C — round-robin with semaphore)
    │  QA & Review    │
    └────────┬────────┘
             │
    ┌────────┴──────────────┐
    ▼          ▼            ▼
Website    Social Media   Video
(WP REST)
```

### Settings Schema (Extended Fields)
The `Settings` table has columns managed outside Prisma's schema via raw SQL migrations. Always read these with `$queryRawUnsafe`:

| Column | Type | Description |
|---|---|---|
| `nicheA–E` | TEXT | Brand-specific niche override |
| `toneA–E` | TEXT | Full brand voice / system prompt for LLM |
| `rssSourcesA–E` | TEXT | Comma-separated RSS URLs per brand |
| `imageCountA–E` | INTEGER | Max images per article per brand |

### Key Files

| File | Role |
|---|---|
| `lib/pipeline.ts` | Core pipeline orchestration, `getSettings()`, agent task store |
| `lib/llm.ts` | LLM call wrappers: `draftArticle`, `reviseArticle`, `reviewArticle`, `fetchImageAsBase64` |
| `app/api/settings/route.ts` | Settings CRUD API — always uses raw SQL for extended fields |
| `components/PantheonDashboard.tsx` | Root dashboard, polling, `settingsOverride` state |
| `components/OperationMap.tsx` | Pipeline diagram SVG/DOM layout |
| `components/FlipPipelineNode.tsx` | Animated flip-card node with live task list |
| `scripts/test-brand-voice.ts` | Brand voice end-to-end LLM validation |
| `scripts/test-editor-loop.ts` | Editor loop simulation |
| `scripts/test-image-review.ts` | Image pipeline smoke test |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Claude API key |
| `SERPER_API_KEY` | ✅ | Google search via Serper for investigator |
| `WP_URL` | ✅ | WordPress site URL for article publishing |
| `WP_USER` | ✅ | WordPress username |
| `WP_APP_PASSWORD` | ✅ | WordPress application password |
| `DATABASE_URL` | ✅ | SQLite path (default: `./db/pantheon.db`) |

---

## Developer Commands

```bash
# Start dashboard
npm run dev                    # localhost:3000
npm run dev -- -p 3001        # localhost:3001

# Database
npm run db:push               # Push Prisma schema changes
npm run db:studio             # Open Prisma Studio

# Testing
npm run test:brand-voice      # Verify brand voice reaches LLM
npm run test                  # Jest unit tests
npm run test:coverage         # Coverage report
```
