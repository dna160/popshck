# Pantheon Newsroom — Pull Request Log

> Repo: `https://github.com/dna160/disciples`  
> Branch model: single long-running `master` branch with linear commits

---

## PR #4 — Pipeline Fidelity, Image Magic-Bytes & LLM Quality
**Date:** 2026-03-30  
**Commit range:** staged → `master`  
**Author:** Disciples Pipeline  
**Files changed:** 19 · +1,205 / −751 lines

### Changes Included

| File | Type | Summary |
|---|---|---|
| `lib/llm.ts` | fix | `max_tokens` raised to 2048 for draft & revise; magic-bytes MIME detection; anti-hallucination revision prompt |
| `lib/pipeline.ts` | fix | False-positive error states reclassified; image quota miss handling; MAX_REVISIONS reason tagging |
| `types/index.ts` | feat | Added `'website'`, `'social-media'`, `'video'` to `NodeId` union |
| `components/OperationMap.tsx` | feat/fix | Zigzag-fan layout; z-index stacking fix; destination endpoint nodes |
| `components/FlipPipelineNode.tsx` | feat | Live task array props; animated flip-card overhaul |
| `components/PipelineNode.tsx` | feat | Granular status-based styling (idle/in-progress/done/failed) |
| `components/PantheonDashboard.tsx` | fix | `settingsOverride` state atom; race condition fix on save |
| `components/SystemStatusBar.tsx` | feat | Dynamic 5-column niche grid from settings |
| `components/MasterControls.tsx` | feat | Brand status grid; sticky-footer layout |
| `components/TerminalLog.tsx` | fix | SSE stream connection-status indicator |
| `app/globals.css` | fix | `.node-wrapper` z-index rule |
| `scripts/test-brand-voice.ts` | feat | Brand voice end-to-end LLM validation script |
| `scripts/test-editor-loop.ts` | feat | Editor loop simulation script |
| `scripts/test-image-review.ts` | feat | Image review pipeline smoke test |
| `tsconfig.scripts.json` | feat | CJS module config for ts-node scripts |
| `package.json` | feat | `test:brand-voice` npm script |
| `.gitignore` | chore | Added `tsconfig.tsbuildinfo` |

### Key Bugs Fixed

1. **LLM truncated articles** — `max_tokens: 1024` was too low for 800–1200 word articles; raised to `2048`
2. **Claude Vision 400 errors** — CDN `Content-Type` headers unreliable; switched to magic-bytes detection
3. **Hallucination bleed-through** — Revision prompt now explicitly forbids rephrasing removed facts
4. **False-positive pipeline errors** — Editorial decisions (triage miss, replacement strategy) no longer mark agent tasks as `failed`
5. **Imageless article publish** — Image quota miss now sets `Pending Review` instead of silently publishing

---

## PR #3 — Brand Voice Persistence
**Date:** 2026-03-30  
**Commit:** `1d1a593`  
**Author:** Disciples Pipeline

### Changes Included

| File | Type | Summary |
|---|---|---|
| `lib/pipeline.ts` | fix (critical) | `getSettings()` now reads extended columns via `$queryRawUnsafe` |
| `scripts/test-brand-voice.ts` | feat | Sandbox script proving brand voice → LLM prompt path |
| `tsconfig.scripts.json` | feat | Script runner TypeScript config |
| `package.json` | feat | `test:brand-voice` npm script |

### Key Bug Fixed

**Silent data-loss:** Every article was being written with hardcoded factory default brand voices because `prisma.settings.findUnique()` cannot see columns added via raw SQL migrations (`toneA–E`, `nicheA–E`, `rssSourcesA–E`, `imageCountA–E` are outside `schema.prisma`). No error was thrown.

**Verified fix:** Sandbox test confirmed user-configured Bahasa Indonesia otaku-slang tone was correctly injected into Claude's system prompt.

---

## PR #2 — Dashboard UI Overhaul
**Date:** 2026-03-30  
**Commit:** `1d1a593` (bundled)  
**Author:** Disciples Pipeline

### Changes Included

| File | Type | Summary |
|---|---|---|
| `components/OperationMap.tsx` | feat | Zigzag-fan pipeline layout |
| `app/globals.css` | fix | `.node-wrapper` hover z-index |
| `components/SystemStatusBar.tsx` | feat | Dynamic niche status bars |
| `components/MasterControls.tsx` | feat | Brand status footer grid |
| `components/PantheonDashboard.tsx` | fix | Settings save race condition (`settingsOverride`) |

---

## PR #1 — AI Pipeline UI Stabilization
**Date:** 2026-03-30  
**Commit:** `fc4d0c7`  
**Author:** Disciples Pipeline

### Changes Included

| File | Type | Summary |
|---|---|---|
| `components/FlipPipelineNode.tsx` | feat | Live task array props |
| `components/PipelineNode.tsx` | feat | Granular status-based node styling |
| `lib/pipeline.ts` | fix | `EDITORIAL_REJECTION` vs `SYSTEM_ERROR` differentiation |
| `components/TerminalLog.tsx` | fix | SSE connection-status indicator |

---

## Commit History

| SHA | Date | Message |
|---|---|---|
| `1d1a593` | 2026-03-30 | feat: multi-page scraping, incomplete-info editor tag, re-investigation loop |
| `fc4d0c7` | 2026-03-30 | fix: retry LLM call on JSON parse error, not just re-parse same text |
| `315ab49` | 2026-03-30 | feat: rate limit retry, brand exclusivity, article count cap, WP retry |
| `c698e19` | 2026-03-28 | Initial commit — Disciples AI Pipeline Dashboard |

---

## Pending / Next Steps

- [ ] Separate `master` into versioned release tags (`v1.0.0`, `v1.5.0`)
- [ ] Add GitHub Actions CI for `npm run test` on push
- [ ] Add Playwright E2E test for pipeline start/stop flow
- [ ] Add Prometheus metrics endpoint for pipeline cycle health
