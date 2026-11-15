# CLAUDE.md — Route Mapper SG

Free, public, mobile-first PWA for Singapore delivery drivers: consolidates stops from many sources, plans and optimizes up to 50 stops, and runs the route. Built by SAMO. Full design: `docs/BUILD_PLAN.md`. Test sample: `docs/fixtures/D4-01.md`.

## Hard rules (never break)
1. **PDPA:** name, unit and phone live only in IndexedDB on the device. Geocoding sends the postal code only; the optimizer gets coordinates only. A Playwright test inspects every outgoing request and fails the build if any name, phone or unit appears.
2. **Zero running cost:** free tiers only. No paid dependency without Ali's explicit approval.
3. **Provider adapters:** geocoder, router, optimizer, tiles and store sit behind interfaces so a provider swap is configuration, not a rewrite.
4. **Never block planning:** unmeetable time windows warn, they do not stop the plan. Never silently drop or rewrite a stop. Flag uncertain fields for confirmation.
5. **Gate rule:** a postal code in a gated development routes to that development's main guarded vehicle gate. Never end a route on an expressway or slip road.
6. **No login.** Community data (gates, pins, notes) is non-personal and auto-screened.
7. Licence: code is AGPL-3.0. Show OpenStreetMap, OneMap and library credits on every map and on the Credits page.

## Stack
Vite + TypeScript PWA, MapLibre GL JS, IndexedDB, service worker. Cloudflare Pages + Workers (no optimization inside a Worker: 10 ms CPU cap). Supabase for community data and feedback (free tier pauses when idle; add a keep-alive). OneMap for geocoding, openrouteservice (VROOM) for optimizing, in-browser fallback (nearest neighbour + 2-opt/Or-opt). i18n-ready from day one: English, Chinese, Malay at launch, Tamil after native review.

## Build phases — one fresh Claude Code session per phase
Use the **smallest adequate model**. Do not use a stronger model for routine work, and do not use a weaker one for the hard logic below.

| Phase | Scope | Model |
|---|---|---|
| 0 | Skeleton: repo, Vite PWA, lint/test, CI, provider-adapter interfaces, i18n scaffold | Sonnet 5.5 |
| 1 | Consolidation Inbox: parsers, CSV/XLSX, dedup, share target. Must pass `tests/fixtures/d4-01.txt` | Sonnet 5.5 |
| 2 | Address resolution and the gate rule (OneMap, gate records, confidence flags) | Opus 5.5 |
| 3 | Optimizer: ORS/VROOM adapter, fallback heuristic, constraints, multi-run split, impractical-route prompt | Opus 5.5 |
| 4 | Map and Review: numbered pins, route line, drag-to-reorder with live ETAs | Sonnet 5.5 |
| 5 | Run Mode: current-stop card, per-leg navigation handoff, Delivered/Failed/Skip, re-optimize remaining | Sonnet 5.5 |
| 6 | Cloudflare Pages/Workers, Supabase, community gates, feedback, admin console | Sonnet 5.5 |
| 7 | PDPA payload guard, E2E suite, security review, go-live gates | Opus 5.5 |
| 8 | Translations, Credits page, privacy notice drafts, README polish | Haiku 5.5 |

Fixtures, bulk test data and repetitive translations may be delegated to Haiku 5.5 at any phase.

## Impractical-route prompt (Phase 3)
Deadlines can apply to several stops. When deadlines or time windows pull stops to opposite ends and the route is impractical, run the optimizer with and without each candidate outlier, rank by time saved plus deadlines rescued, show the top 1–2, and suggest a third-party courier for those stops. Never block planning.

## Definition of done per phase
Tests pass, lint clean, no personal data in network traffic, docs updated, one commit per logical change, session notes appended to `docs/SESSION_LOG.md`.

## Conventions
- Small commits, imperative messages. Work on a branch per phase; open a PR into `main`.
- Do not commit keys. API keys go in Cloudflare secrets and `.env.local` (git-ignored).
- Singapore-only for now. Car/van profile.
