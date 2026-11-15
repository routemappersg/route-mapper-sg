# Deploying Route Mapper SG (free tiers only)

You do these steps once. **Never paste a key into chat, a commit or an issue.** Secrets go only into the Cloudflare dashboard (or `wrangler secret put`).

Order matters: Supabase → accounts and keys → Worker → Pages → connect them.

## 1. Supabase (community data)
1. Open your project → **SQL Editor** → **New query**.
2. Paste the whole of `supabase/schema.sql` → **Run**. It can be re-run safely.
3. **Project URL**: `https://<Project ID>.supabase.co`, where the Project ID is on **Project Settings → General**. **Key**: **Project Settings → API Keys** → **Secret key** (`sb_secret_…`; the older `service_role` key also works). Never the publishable/`anon` key. The app never talks to Supabase; only the Worker does, so no `anon` key is needed.
4. Free projects pause after about a week of inactivity. The Worker's daily job pings the database, which keeps it awake.

## 2. Accounts and keys
- **OneMap** (geocoding): register an API account at <https://www.onemap.gov.sg/apidocs/register>. You will use the account email and password. The Worker fetches and renews the access token itself (tokens last 3 days).
- **HEIGIT / openrouteservice** (road times and optimizer): create a **Standard** token at <https://account.heigit.org>. Free quota is shared across the whole app, so the Worker caps usage (default 400 routing calls a day, 40 per phone).
- Make two random strings for **ADMIN_TOKEN** (long, 32+ characters) and **HASH_SALT** (32+ characters, never changes unless you want to reset every anonymous submitter ID).

## 3. Deploy the Worker (the API)
1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → pick `routemappersg/route-mapper-sg`.
2. Name it `route-mapper-sg-api`. Leave the build command empty. Deploy command: `npx wrangler deploy`. (The config is in `wrangler.toml`.)
3. After the first deploy, open the Worker → **Settings → Variables and secrets** → add these as **Secret**:

| Name | Value |
|---|---|
| `ONEMAP_EMAIL` | your OneMap account email |
| `ONEMAP_PASSWORD` | your OneMap password |
| `ORS_API_KEY` | the HEIGIT token |
| `SUPABASE_URL` | the Supabase Project URL |
| `SUPABASE_SERVICE_KEY` | the Supabase service_role key |
| `ADMIN_TOKEN` | your long random string |
| `HASH_SALT` | your other long random string |

4. Note the Worker address, like `https://route-mapper-sg-api.<your-subdomain>.workers.dev`.
5. Check it: open `<worker address>/health` (should say ok) and `<worker address>/config` (all four providers `true`).

## 4. Deploy the app (Cloudflare Pages)
1. **Workers & Pages → Create → Pages → Connect to Git** → the same repo, branch `main`.
2. Build command `npm run build`, output directory `dist`.
3. **Environment variables (not secret)**: `VITE_API_BASE` = the Worker address from step 3 (no trailing slash).
4. Deploy. Note the Pages address (e.g. `https://route-mapper-sg.pages.dev`).

## 5. Tell the Worker which app may call it
In the Worker's `wrangler.toml` the variable `ALLOWED_ORIGINS` lists the Pages address(es), comma-separated. If your Pages address differs from `https://route-mapper-sg.pages.dev`, change it there (commit) or in the dashboard under Variables. Without this the browser blocks the app's calls.

## 6. First checks
- Open the app, paste a few stops: pins should NOT say "demo". Postal codes get exact positions.
- `<Pages address>/admin/` → sign in with `ADMIN_TOKEN` → you should see the overview.
- Switch a provider off in the console (`ors`, `onemap`, `overpass`, `community`) and the app degrades gracefully within a minute: it plans on the phone instead.

## Operating notes
- **Kill-switch**: `/admin/` → Switches. Or set the Worker variable `KILL` (e.g. `ors`) for an instant, database-independent switch.
- **Quota**: the Worker refuses routing calls past `ORS_DAILY_CAP`; phones then plan locally. Raise it only if your HEIGIT plan allows.
- **Protect /admin properly (recommended before launch)**: Cloudflare Zero Trust → Access → add a self-hosted application for `<Pages address>/admin*` and for `<Worker address>/admin*`, allow only your email. The admin token then becomes a second lock.
- **OneMap auth header**: the Worker tries both header styles OneMap has used and remembers what works. If geocoding returns 503 after you add credentials, check `ONEMAP_EMAIL` / `ONEMAP_PASSWORD` first.
- **Costs**: all of the above is free-tier. Cloudflare Workers free allows 100,000 requests a day; each plan uses roughly 15–60. Nothing here needs a card.
- **Before public launch**: add the OneMap logo and Open Data Licence notice (Phase 8 Credits page).
