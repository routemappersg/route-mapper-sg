# Route Mapper SG: handoff (session closed 2026-11-15, Singapore evening)

**One line:** Phases 0–6 are built and merged. The app and API are **live on Cloudflare** and a first real plan works end to end. One PR (#13, speed) is **still open**. Next: merge it, retest, small UX fixes, then Phase 7.

## Live system
| Piece | Where |
|---|---|
| App (PWA, static files) | https://route-mapper-app.routemappersg.workers.dev (Worker with static assets, config `wrangler.app.toml`) |
| API Worker | https://route-mapper-sg.routemappersg.workers.dev (config `wrangler.toml`; `/health`, `/config`, `/admin`) |
| Database | Supabase project id `wqqegwjwnsjkfhpeigfj`, Singapore, `supabase/schema.sql` applied (7 tables, RLS on, service role only) |
| Code | GitHub `routemappersg/route-mapper-sg`; PRs #1–#12 merged; **#13 open** |
| Accounts | routemappersg@gmail.com for Cloudflare and Supabase; HEIGIT and OneMap accounts exist |
| Secrets | Cloudflare API Worker → Settings → **Variables and secrets (runtime, top of page)**: ONEMAP_EMAIL, ONEMAP_PASSWORD, ORS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY (new `sb_secret_` key), ADMIN_TOKEN, HASH_SALT. Never in chat or repo. |

`/config` showed all four providers `true` after the last API rebuild.

## Verified live today
App loads; no CORS errors once the API rebuilt; Plan route works (slowly, see #13); numbered pins, map, route lines and Run Mode card render; OneMap geocoding via the Worker works.

## NOT yet verified live
HEIGIT routing (is the screen using real road times or the "estimates" notice?); `/admin` sign-in and actions; pin report, tips and feedback against real Supabase; community gates reaching the resolver; daily cron/keep-alive; PWA install and share-target on a phone; Cloudflare Access on `/admin`.

## First thing on resume
1. **Merge PR #13** (parallel lookups, upstream time limits, map-data breaker, "n/total" progress). The live app does not have it yet.
2. Wait for both Cloudflare builds (API `route-mapper-sg`, app `route-mapper-app`) to go green. If a build says "failed to initialize / timed out", press **Retry build**. Check `/config?x=N` still shows all four `true`.
3. Hard-refresh the app (Ctrl+Shift+R), re-run a plan with test stops, and report time taken and any notices.

## Findings from the first live test (backlog, in priority order)
1. **Start point is hard-coded.** `DEMO_START` (1.3521, 103.8198) is passed as the depot in `src/main.ts`; it shows as the "S" pin inside the Central Catchment restricted area. Needs a real driver start: GPS, postal code or typed address, kept on the device only. HIGH.
2. **No loading or routing indicator** on Optimize (and nothing on Plan except the count #13 adds). Add a visible status and disable the button while working.
3. **No way back from Run Mode to Review.** Only "End run" exists. Add "Back to plan" (keep progress).
4. **"Check pin location"** appeared on 248 Compassvale Road. Investigate with real Overpass data (snap distance vs `SNAP_MAX_M`, or Worker timeouts forcing the fallback).
5. 11 stops shown of 13 parsed: unplaced stops are listed on the Review screen; confirm none are lost with real data.
6. Route line on the map is drawn as straight segments; check whether road geometry (`router.path`) is being used.
7. Console warning from the manifest `share_target` (missing `enctype`): harmless, tidy later.

## Housekeeping
- Delete the 7 duplicate secrets under the API Worker → Settings → **Builds** (build-time copies; the running Worker never uses them).
- Add **Cloudflare Access** for `/admin*` on both addresses before sharing the link publicly.
- OneMap logo and Open Data Licence notice are still needed (Phase 8 Credits page) before public launch.
- Both Workers build on every push to `main`. App deploy command: `npx wrangler deploy -c wrangler.app.toml`. API: `npx wrangler deploy`. Preview builds use placeholder `[previews.vars]` (no secrets, routing cap 0).

## Lessons (so we do not repeat them)
- Secrets must go in the **runtime** "Variables and secrets", not under "Builds".
- Cloudflare's "Create application" wizard builds a **Worker**, not Pages: the front end needed its own `wrangler.app.toml`.
- Failed builds do not appear in the Deployments list; use the check's Details link or Builds history.
- The Worker's `/config` is cached 60 s: add `?x=N` when re-checking.

## Plan
1. Resume steps above.
2. **Sonnet 5.5 small PR ("6.5"):** backlog 1–3, investigate 4.
3. **Phase 7, Opus 5.5** (Ali switches with `/model`): PDPA payload guard as a CI test over the whole app, full E2E suite (reuse `tests/e2e/localWorker.ts`), security review, Cloudflare Access, go-live gates.
4. **Phase 8, Haiku 5.5:** translations, Credits page with OneMap logo and licence, privacy notice drafts, README.

## How we work (unchanged)
Branch per change, small commits ending with the `Co-Authored-By: Claude Sonnet 5.5` and `Claude-Session` trailers, PR opened with `gh api repos/routemappersg/route-mapper-sg/pulls ...` (GraphQL is blocked), Ali merges in the GitHub UI then says "go". Smallest adequate model per phase. Secrets are entered by Ali only. Tests: `npm test` (168 pass), `npm run lint`, `npx tsc --noEmit`. Local end-to-end: `npx tsx tests/e2e/localWorker.ts 8788`, then build the app with `VITE_API_BASE=http://localhost:8788`.

## Paste this to resume
> Resume Route Mapper SG. Read `docs/HANDOFF.md` and the end of `docs/SESSION_LOG.md` on `main` first. PR #13 should be merged; check, then continue with "Plan" step 2.
