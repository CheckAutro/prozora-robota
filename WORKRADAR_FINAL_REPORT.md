# WorkRadar / Прозора робота — Final Implementation Report

**Date:** 2026-06-08  
**Project:** prozora-robota  
**Branch:** main

---

## Commits

| Hash | Message |
|---|---|
| `52a527f` | Restore compact AI check and auto-publish safe sources |
| `a8a14c8` | Add auto-published external sources moderation filter |

## Production URL

https://prozora-robota.vercel.app

## Vercel Deployment IDs

| Commit | Deployment ID |
|---|---|
| `52a527f` | `dpl_HUqtcWa25rWHp1AYNuDCoaF8KkFh` |
| `a8a14c8` | `dpl_2oBBjg6ihP364AqrjASH6jne6VRB` |

---

## Changed Files

### Commit `52a527f` — 5 files

| File | Change |
|---|---|
| `components/product/CompactCompanyAiCheck.tsx` | **New** — interactive client component replacing static card |
| `lib/company-page-utils.ts` | **New** — shared pure utility functions |
| `lib/external/auto-publish-helpers.ts` | **New** — safe auto-publish logic |
| `app/api/ai/analyze/route.ts` | **Modified** — wires auto-publish after external discovery |
| `app/companies/[slug]/page.tsx` | **Modified** — replaces CompanyQuickCheckCard with CompactCompanyAiCheck |

### Commit `a8a14c8` — 1 file

| File | Change |
|---|---|
| `components/product/AdminExternalCompanySourcesSection.tsx` | **Modified** — Auto-published filter, badges, inline edit, normalize |

---

## What Was Implemented

### 1. Compact interactive AI check on `/companies/[slug]`

- Replaced the static `CompanyQuickCheckCard` server component with the new `CompactCompanyAiCheck` client component.
- Header always shows: title "Швидка перевірка", description "Аналіз на основі доступних відгуків, відкритих джерел і вакансій.", two action buttons.
- **Before analysis (idle state):** static SSR data — risk badge, confidence badge, stats row (reviews / open sources / ratings / data level), ключове bullet list (3 items), "Показати деталі" accordion.
- **During analysis:** spinner replacing the body.
- **After analysis (result state):** compact AI result — summary, risk badge, confidence badge, 3 ключових висновки, details accordion (closed by default).
- **Error state:** inline error message with retry button.

### 2. "Перевірити конкретну вакансію" navigation

- Button uses `href={/check-vacancy?company=${encodeURIComponent(companySlug)}}`.
- No textarea on the company page; user fills out vacancy on the dedicated `/check-vacancy` page.

### 3. Safe auto-publish of external discovery sources

**File:** `lib/external/auto-publish-helpers.ts`

Every source found during AI analysis (`findEmployerExternalSources`) that passes all safety checks is upserted to `external_company_sources` with `status=verified, is_public=true`.

Safety gates (all must pass):
- `source_url` must be present and normalizable
- `source_name` must be present
- Source type must be one of: `reviews`, `rating`, `article`, `company_page`, `vacancy`
- `short_summary` must be ≤ 800 chars
- Source must NOT be social media (facebook, telegram, twitter, instagram, tiktok, reddit, linkedin, youtube, vk, ok)
- Confidence must be `high` or `medium` (not `low`)
- Title + snippet must mention the company name (or a significant word from it)

**Work.ua / Robota.ua guard (`guardSourceTypeForWorkRobota`):**  
If the source is from work.ua or robota.ua and the AI classified it as `review` or `rating`, the type is forced to:
- `vacancy` — if URL matches `/jobs/\d+`, `vacancy`, or `ваканс`
- `company_page` — otherwise  
These sites are NEVER classified as `reviews` or `rating`.

**Additional rules:**
- Internal "Прозора робота" sources are always skipped.
- Deduplication by normalized URL within the batch (one write per URL per analysis run).
- `admin_note` is set to: `"Auto-published from external discovery. Original language: <lang>"`
- Called with `void` + `.catch` in the API route — never delays the AI response.

### 4. Shared utility library

**File:** `lib/company-page-utils.ts`

Extracted from `app/companies/[slug]/page.tsx` so both the server page and the client component can use the same functions without duplication:

- `formatDate`, `shortText`, `dedupeSentences`
- `isSourceSummaryFact`, `getRealVacancyFacts`, `getSourceSummaryFacts`
- `extractOpenVacanciesCount`, `openFactSummaryText`
- `sourceIdentityKey`, `isUselessDuplicateTitle`
- `externalSourceTypeLabel`, `getExternalCompanyRatingSources`, `getExternalCompanyOpenSources`
- `getCompactOpenSourceCards`, `getCompactSourceBreakdown`
- `getCompanyDataLevel`, `dataLevelLabel`
- `CONFIDENCE_LABELS` constant, `CompactSourceCard` type

### 5. Admin post-moderation — Auto-published filter

**File:** `components/product/AdminExternalCompanySourcesSection.tsx`

- **Quick-filter tab row** above the filter grid: "Усі (N)" and "Auto-published (N)" pills with live counts. Clicking "Auto-published" filters to sources where `adminNote` contains `"Auto-published from external discovery"`.
- **Auto-published badge:** purple pill shown in every matching card header.
- **Admin note display:** `adminNote` shown truncated (120 chars) in every card's details column — origin and original language always visible.
- **Per-card "Нормалізувати"** button: calls `POST /api/admin/external-company-sources/bulk` with `{ action: "normalize_ukrainian", ids: [id] }` — rewrites title/summary/points to Ukrainian, updates language in adminNote; does not change `status` or `is_public`.
- **Per-card "Редагувати резюме"** toggle: expands an inline textarea with 800-char counter and Save/Cancel. Saves via `PATCH /api/admin/external-company-sources/{id}` with `{ short_summary }`.
- Existing actions unchanged: Підтвердити, Опублікувати, Приховати, Відхилити, Видалити, all bulk actions.

---

## What Was NOT Implemented

- **Admin "Auto-published" filter in the API layer** — filtering is done client-side in the component. The GET endpoint returns all sources; no `?auto_published=true` query parameter was added. Acceptable for the current data volume; can be added later if the list grows large.
- **AI result uses freshly auto-published sources without page reload** — after analysis the AI result is shown, but the static SSR data (source counts) is not re-fetched. A full page refresh will show the updated counts. A live refresh hook was not added to keep the component simple.
- **Admin "Auto-published" email / notification** — no alerting when sources are auto-published; moderation is pull-based (admin visits the page).
- **Rate limiting on auto-publish** — the auto-publish write is gated behind the AI analysis rate limit (anonymous cookie + IP hash). No separate rate limit was added for the upsert itself.
- **Revert / undo auto-publish in one click** — the admin can hide or reject auto-published sources individually or in bulk, but there is no "undo last auto-publish batch" action.

---

## `npm run lint` Result

```
> chesna-robota@0.1.0 lint
> eslint .
```

Exit code 0. No warnings. No errors.

---

## `npm run build` Result

```
> chesna-robota@0.1.0 build
> next build

▲ Next.js 16.2.7 (Turbopack)
✓ Compiled successfully
Running TypeScript ... Finished TypeScript (clean)
✓ Generating static pages (46/46)
```

Exit code 0. All 46 routes built. TypeScript clean.

---

## Safety Confirmations

| Constraint | Status | Evidence |
|---|---|---|
| `public.reviews` untouched | ✅ | No write to `reviews` table in any modified file. Auto-publish only calls `upsertExternalCompanySource` → `external_company_sources`. |
| Internal review count unchanged | ✅ | `reviewCount` is derived from `public.reviews` at read time; nothing increments it. |
| Internal company rating unchanged | ✅ | Rating is computed from `public.reviews`; no code touches that table. |
| Work.ua / Robota.ua never `reviews`/`rating` | ✅ | `guardSourceTypeForWorkRobota` in `auto-publish-helpers.ts` forces `vacancy` or `company_page` for any Work/Robota source classified as `review` or `rating` by the AI. |
| Work.ua / Robota.ua not counted as reputation evidence | ✅ | `reputationSourcesTotal` in `getCompactSourceBreakdown` counts only `reviewCount + externalRatings + externalReviewSignalSummary.signalCount + reviewSources + ratingSources` — none of which can be Work/Robota after the guard. |
| Risk guard not weakened | ✅ | `applySparseReputationGuard` in `route.ts` is not touched. |
| `source_excerpt` max 800 chars | ✅ | `truncateSourceExcerpt(snippet, 800)` applied before every upsert. |
| Social media blocked | ✅ | `isSocialMediaSource` in `canAutoPublishExternalSource` returns `canPublish: false` for facebook, telegram, twitter, instagram, tiktok, reddit, linkedin, youtube, vk, ok. |
| Low-confidence blocked | ✅ | Confidence must be `high` or `medium`; `low` returns `canPublish: false`. |
| Admin routes protected | ✅ | `checkAdminAuth` (requireAdmin + ADMIN_ACCESS_KEY fallback) on all `/api/admin/*` routes — unchanged. |
| Auto-publish non-blocking | ✅ | Called with `void autoPublishSafeDiscoverySources(...).catch(...)` — never awaited in the response path. |
| No API keys logged | ✅ | Only `err.message` is logged on auto-publish failure, never any env var. |

---

## Manual QA Checklist

### Company page — static state
- [ ] Visit `/companies/atb` — confirm exactly one "Швидка перевірка" block is visible
- [ ] Confirm block shows: risk badge, confidence badge, stats row (4 tiles), ключове (≤3 bullets), "Показати деталі" accordion (closed)
- [ ] Expand "Показати деталі" — confirm it shows Що відомо / Ризики / Чого бракує / Рекомендації / Питання / Джерела
- [ ] Confirm NO second "Швидка перевірка" block anywhere on the page

### Company page — "Проаналізувати компанію"
- [ ] Click "Проаналізувати компанію" — confirm spinner appears in place of the static body
- [ ] Wait for result — confirm AI result block renders (summary text, risk badge, confidence, ключових висновки, accordion)
- [ ] Confirm accordion is closed by default after result loads
- [ ] Run analysis on a company with no reviews (e.g. a stub company) — confirm result renders without crashing

### Company page — "Перевірити конкретну вакансію"
- [ ] Click "Перевірити конкретну вакансію" on `/companies/nova-poshta`
- [ ] Confirm browser navigates to `/check-vacancy?company=nova-poshta`
- [ ] Confirm vacancy check page loads with company pre-filled

### Auto-publish
- [ ] After clicking "Проаналізувати компанію" on a company with no prior external sources, visit `/admin/external-sources` → "Auto-published" tab
- [ ] Confirm newly discovered sources appear with "Auto-published" purple badge
- [ ] Confirm `adminNote` shows "Auto-published from external discovery. Original language: …"
- [ ] Confirm no Work.ua / Robota.ua sources appear with type `reviews` or `rating`

### Admin — moderation actions
- [ ] Visit `/admin/external-sources` — confirm "Усі" and "Auto-published" tabs visible with counts
- [ ] Switch to "Auto-published" tab — confirm only auto-published sources shown
- [ ] On any auto-published card: click "Приховати" → confirm `is_public` becomes false (card no longer has "public" badge after reload)
- [ ] On any auto-published card: click "Відхилити" → confirm status changes to "Відхилено"
- [ ] On any auto-published card: click "Нормалізувати" → confirm success message, adminNote language tag updated
- [ ] On any card: click "Редагувати резюме" → confirm inline textarea appears with current text and 800-char counter
- [ ] Edit text and click "Зберегти" → confirm card updates with new summary
- [ ] Click "Скасувати" → confirm textarea closes without saving

### Admin — existing filters still work
- [ ] Filter by status "На перевірці" — confirm only needs_verification sources shown
- [ ] Filter by type "Вакансія" — confirm only vacancy sources shown
- [ ] Use free-text search — confirm results filter by company name / URL / summary

### Safety
- [ ] Visit any `/api/admin/*` route in a logged-out browser tab — confirm 401 response
- [ ] Confirm `public.reviews` row count is unchanged before and after running "Проаналізувати компанію"
