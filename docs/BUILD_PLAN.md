# Route Mapper SG — Framework & Build Plan
*Status: design locked for MVP, pre-build. Last updated 2026-11-15.*

## 1. Goal
A free, public, mobile-first web app (PWA) for delivery drivers in **Singapore**, using a **car or van**. It plans and runs routes of **up to 50 stops**, without the gaps in Google Maps. Start small and local with a working solution, but design every part to scale.

| Google Maps problem | Route Mapper answer |
|---|---|
| 10-stop limit | Up to 50 stops per run; auto-split into multiple runs/zones |
| Shows only postal/blk | Stop card shows unit, recipient and contact (kept on the device, see PDPA) |
| Doesn't show where you're actually headed | Run Mode card: unit, building, contact, one-tap call/WhatsApp, drop-off note |
| Condo pin lands on the road/expressway | **Gate rule:** gated compounds always route to the main guarded drive-in gate; community fixes apply to all users |
| Manual typing only | **Consolidation Inbox**: paste/import from many sources into one list |
| Closing the app loses everything | Autosave on the device, restore, history |
| No fixed order or time windows | Lock order, exact time windows (warn, never block), stop time, start/end choice |
| **Keep:** duration estimates, leg times, easy reordering | Kept, plus an Optimize button and drag-to-reorder with times recalculated live |

## 2. Decisions log
| # | Topic | Decision |
|---|---|---|
| 1 | Scope | Start small/local, workable first; architecture must allow scaling (see §6) |
| 2 | Region | Singapore only |
| 3 | Splitting | Multi-run / zone splitting included |
| 4 | Vehicles | Car, van (package size). Routing profile = car; van-specific limits (height etc.) later |
| 5 | Stops | Max 50 per run |
| 6 | Input sources | Orders, delivery notes, WhatsApp, spreadsheets → separate **Consolidation Inbox** (M1) |
| 7 | Photo OCR | Future feature |
| 8 | Integration | Standalone |
| 9 | Stop fields | Name, unit, contact, designed for PDPA (§5) |
| 10 | Time windows | Exact where possible; **warn if unmeetable, never block planning**; deadlines can apply to several stops |
| 11 | Stop time | Default per run, can be changed per stop |
| 12 | Start/end | User chooses: round trip, end at last stop, or a custom end point |
| 13 | Pin fixes | **Communal**: treated as a shared bug fix for all users |
| 14 | Drop-off notes/photos | Optional; shown automatically when the matching postal code is entered |
| 15 | Navigation | User chooses Google Maps / Waze / Apple Maps; handoff **one leg at a time** (Waze only supports one stop per route) |
| 16 | Proof of delivery | Light: Delivered / Failed / Skip + optional note |
| 17 | Customer notify | Optional "on the way" WhatsApp link (pre-filled message, the driver sends it) |
| 18 | Accounts | No login |
| 19 | Feedback store | Supabase |
| 20 | Funding | Donation link only if/when future features need funding |
| 21 | Hosting | **Cloudflare Pages + Workers**, with Supabase for shared data (rationale §7) |
| 22 | Go-live bar | Multi-gate pass bar (§8.5) |
| 23 | **Gated compounds** | **Route to the guarded vehicle drive-in gate; if several front/rear accesses exist, route to the MAIN entrance gate.** All postal codes in a development share that gate. Drivers register with security there |
| 24 | Impractical routes | When deadlines/time windows pull stops to opposite ends, rank outlier stops by time saved plus deadlines rescued and suggest a third-party courier for the top 1–2. Never block planning |
| 25 | Licence | Code AGPL-3.0; community gate data gets its own open-data licence |
| 27 | Gate verification | A gate only counts if the **road track** confirms it: it sits on a road leading from a public road outside the development into it. Main gate = entrance opening onto the most important public road; guardhouse beats a bare barrier; pedestrian gates never count. No verified gate → flag "gate unverified", end on the nearest public road outside. Developments are detected automatically; no manual list. Driver pin fixes become community-verified records |
| 26 | Languages | i18n-ready; launch English, Chinese, Malay; Tamil after native review |

## 3. Core user flow
```
INBOX → PLAN → RESOLVE → CONSTRAIN → OPTIMIZE → REVIEW → RUN → CLOSE
```
0. **Inbox**: collect stops from any source over the day (paste a WhatsApp message, delivery note text, CSV/XLSX, Android share-to-app). Parsed, deduplicated, flagged.
1. **Plan**: pick inbox items into a run. Set date, start, end mode, vehicle, default stop time.
2. **Resolve**: geocode postal codes. Gated developments resolve to their main gate; community notes applied automatically; low-confidence pins flagged.
3. **Constrain**: lock order, first/last, exact time windows, per-stop time (gated stops add a registration allowance).
4. **Optimize**: order, ETAs, leg times; unmeetable windows highlighted (amber/red) but the plan is still produced. Optional split into N runs.
5. **Review**: map plus list, drag to reorder with live recalculation.
6. **Run**: current-stop card (with a "Gated — register at guardhouse" badge and the block number where relevant), Navigate (choice of app, one leg), call/WhatsApp, Delivered/Failed/Skip, re-optimize the remaining stops, "pin wrong? fix it" button.
7. **Close**: summary, CSV export, 1-tap rating plus optional feedback. Personal data is purged after the retention period.

## 4. Modules
| # | Module | Responsibility | Built on |
|---|---|---|---|
| M1 | **Consolidation Inbox** | Multi-source intake into one staging list. Parsers: free text (6-digit postal, `#xx-xxx` unit, +65/8-digit phone, name heuristics), CSV/XLSX with column mapping and template, PWA Share Target, manual entry. Dedup on postal+unit. Uncertain fields flagged, never dropped. OCR later | SheetJS (Apache-2.0); Web Share Target API |
| M2 | **Address Resolution** | Postal → building/block/road/lat-lng. **Gate rule:** postal code in a gated development → main guarded gate. Priority: verified development gate, then a map-data gate/guardhouse on the main access road, then a flagged guess. Non-gated buildings → building point snapped to the nearest non-expressway road. Never ends on an expressway or slip road. Confidence flags | OneMap API (Singapore Land Authority); OSM gate/entrance nodes |
| M3 | **Stop Details** | Name, unit, contact (on device only), gated badge + block number, drop-off note/photo (community, non-personal), call/WhatsApp links | Phone / WhatsApp URL schemes |
| M4 | **Constraints** | Lock, first/last, exact time windows, stop time (+ gated registration allowance, default 3 min), end mode; feasibility **warnings** (never blocking) | — |
| M5 | **Route Optimizer** | TSP/VRP with soft time windows, up to 50 stops, multi-run split. Primary: hosted VROOM. Fallback: in-browser heuristic (nearest neighbour + 2-opt/Or-opt) | VROOM (BSD-2) via openrouteservice (HeiGIT); OSRM (BSD-2) matrix |
| M6 | **Map & Route View** | Numbered pins, route line, leg times, drag-to-reorder synced with the map | MapLibre GL JS (BSD-3); OneMap basemap / OpenFreeMap; © OpenStreetMap contributors (ODbL) |
| M7 | **Run Mode** | Current/next card, nav-app choice and per-leg handoff (to the gate for gated stops), status marking, remaining-stop re-optimization, ETA drift, optional "on the way" WhatsApp | Google Maps / Waze / Apple Maps deep links |
| M8 | **Persistence** | Autosave to IndexedDB, crash restore, run history, retention auto-purge, JSON/CSV export | IndexedDB, service worker |
| M9 | **Community Gates, Pins & Notes** | Shared development records (all postal codes + main gate + gated flag), drop-off corrections, optional notes/photos (non-personal); side/rear gates as notes only. Submission, auto-accept rules, moderation queue, voting | Supabase, Cloudflare Worker gateway |
| M10 | **Feedback** | Feedback button anywhere, post-run rating, bug report with optional diagnostic snapshot (no personal data), public changelog | Supabase |
| M11 | **Attribution, Legal & Limits** | Credits page, always-visible map attribution, PDPA privacy notice, fair-use limits shown openly, donation link (later) | — |
| M12 | **Ops (owner)** | Quota monitor, moderation queue, feedback triage, kill-switch per provider | Cloudflare + Supabase dashboards |

## 5. PDPA design (name, unit, contact)
*Design intent, not legal advice. Have the privacy notice reviewed before public launch.*
- **Personal data never leaves the device.** Name, unit and contact live only in IndexedDB. Geocoding sends the postal code only; the optimizer receives coordinates only.
- **Retention:** runs auto-purge after a set period (default 7 days, adjustable), plus a "Wipe all data" button.
- **Community gates/pins/notes are non-personal:** postal codes + coordinates + entrance type + note. Notes are auto-screened (phone, unit, name patterns stripped/blocked) and moderated.
- **Feedback** forms warn against customer details; phone/unit patterns are auto-redacted before saving.
- **Share link** (if added): encrypted, data in the URL fragment, so it's never stored on a server.
- **Automated guard:** an E2E test inspects every outgoing network request and fails the build if any name, phone or unit appears (§8.2).

## 6. Scaling path
All external services sit behind **provider adapters** (geocoder, router, optimizer, tiles, store), so swapping one is a configuration change, not a rewrite.

| Stage | Setup | Trigger to move on |
|---|---|---|
| S0 Local | Dev on your machines, mock providers + OneMap/ORS keys | MVP gates pass |
| S1 Public free | Cloudflare Pages/Workers, OneMap, openrouteservice, Supabase free, browser fallback | Hitting optimizer quota or Worker limits regularly |
| S2 Self-hosted routing | OSRM + VROOM on a small VPS (the Singapore OSM extract is small), funded by donations | Sustained usage / dispatcher demand |
| S3 Dispatcher | Multi-driver VRP, run sharing | Real demand from teams |

Quota protection: geocode caching (Cloudflare KV/cache), one optimize call per run (drags reuse the cached matrix), per-device daily cap, provider kill-switch → fallback. The openrouteservice free tier (about 500 optimization/matrix requests a day, shared) is the bottleneck.

## 7. Hosting decision
**Cloudflare Pages (frontend) + Workers (API proxy, caching, rate limits) + Supabase (community data, feedback).**
- *Why:* static asset requests are free and unlimited; Workers' free tier gives 100k requests/day, ample for a proxy; commercial use and donations aren't restricted; Singapore edge presence.
- *Why not Vercel Hobby:* restricted to personal/non-commercial use; whether donations are allowed is unclear; features stop when a usage limit is hit.
- *Watch-outs:* Workers free = 10 ms CPU per request, so **no optimization inside a Worker**. Supabase free projects pause when idle; add a scheduled keep-alive ping (verify current policy at build time).

## 8. Checks & simulation while building
### 8.1 Test datasets (postal codes only; no personal data)
- **D1** A 16-stop real day (postal codes + any time windows), plus 4–5 more past runs.
- **D2** Gated developments (start: Blossom Residences 677721–677724) with hand-verified main-gate coordinates.
- **D3** Synthetic Singapore sets: 5/10/16/30/50 stops, mixed HDB/condo/landed, island-wide.
- **D4** Messy inputs: real-style WhatsApp, delivery-note and spreadsheet samples (personal fields swapped for fake values). First sample: `docs/fixtures/D4-01.md`.
- **D5** Constraints: locks, tight/overlapping/impossible windows, every end mode.
- **D6** Multi-source duplicates: the same stop arriving from WhatsApp and a spreadsheet.

### 8.2 Automated checks
| Area | Check | Pass |
|---|---|---|
| M1 Inbox | Parse D4; dedup D6 | ≥95% fields correct; 100% uncertain fields flagged; duplicates merged |
| M2 Resolve | D2 gated set | Route ends ≤30 m from the main gate on the public-road side; all postal codes of a development → same gate; never on an expressway/slip road |
| M2 Resolve | D3 vs verified coords | Error distance reported; >50 m snaps flagged |
| M5 Optimize | n ≤ 9 vs brute force | ≤5% above optimal |
| M5 | D1 runs vs manual plan and Google's order | Drive time ≤ manual on every run |
| M5 | 50-stop set | Result in <10 s (hosted) / <20 s (fallback) on a mid-range phone |
| M4 | D5 | Locks 100% respected; unmeetable windows flagged, plan still produced; gated allowance applied |
| M5 fallback | Mock 429/timeout/offline | Fallback runs, user informed, valid route |
| M7 | Mid-run re-optimize; gated badge + block number shown | Done stops untouched, ETAs updated; badge present |
| M8 | Kill tab / reload / airplane mode, mid-plan and mid-run | Zero data loss |
| M8 | Retention purge | Data gone after the period; wipe button works |
| PDPA | Network-payload inspector on full E2E flow | **No name/phone/unit in any outgoing request** |
| M9 | Note with phone/unit | Blocked or redacted |
| M10/M11 | Offline feedback; attribution visible on every map | Queued and sent later; attribution always present |

### 8.3 Simulation mode (dev flag in the app)
- Drive simulator: simulated GPS + accelerated clock along the planned route.
- Disruptions: late arrival, customer not home, urgent stop added mid-run, leg blocked, gate registration delay.
- Network: slow 3G, offline, provider errors, quota exhausted.

### 8.4 E2E and device
Playwright E2E (Inbox → Close) on mobile viewports; real devices (Android Chrome + share target, iPhone Safari, installed PWA); one-handed use, sunlight readability; Lighthouse PWA/performance on a mid-range Android. Reference devices: Samsung S22 and vivo V60 Lite.

### 8.5 Go-live pass bar
All must pass:
1. **Route quality:** drive time ≤ manual plan on all D1 runs and ≤5% above optimal on small sets.
2. **Zero data loss** across the persistence tests.
3. **PDPA guard green:** no personal data in any network request.
4. **Resolution:** 100% of postal codes resolve or are flagged; **100% of seeded gated developments route to the main gate**; zero routes end on an expressway.
5. **Resilience:** works end-to-end with the optimizer forced offline (fallback).
6. **Field pilot:** 5 real delivery days with no blocking issue, logged planned vs actual.

## 9. Phasing
- **MVP:** M1 (paste + CSV/XLSX + share target), M2 incl. gate rule, M3, M4 basic, M5 (hosted + fallback), M6, M7, M8, M11, PDPA guard, seeded gate records.
- **v1:** time-window warnings, impractical-route prompt, multi-run split, M9 community submissions (moderated), M10 feedback, simulation mode, "on the way" WhatsApp.
- **v2:** drop-off photos, OCR intake (optional Supporter licence), run analytics, donation link, S2 self-hosted routing.
- **Later:** dispatcher multi-driver (S3).

## 10. Competitor check (RouteXL, tested 2026-11-15)
Test with the D4-01 list (13 stops, written-out street names): all 13 stops placed, route 78.6 km / about 2 h 34 min. Gaps found: 128B Plantation Crescent 692128 silently became 128 Plantation Crescent 690128 (block letter and postal code changed with no warning); no gate awareness at 34 Segar Road; no deadlines or time windows on the free tier; import limited to 20 clean one-per-line addresses; no delivered/failed tracking or run mode. Every gap is covered by this plan.

## 11. Open inputs
- D1: postal codes (+ time windows) from real delivery days.
- D2: known gated developments and their main gates.
- Does "Send by 1 PM" in D4-01 apply to one stop or the whole list? (Rule: deadlines can apply to several stops.)
- API keys (OneMap, openrouteservice) when Phase 2/3 start; Cloudflare and Supabase accounts at Phase 6.
