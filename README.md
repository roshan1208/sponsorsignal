# SponsorSignal

Search every organisation on the official UK Home Office register of licensed
sponsors. Static site + daily auto-refresh pipeline. Zero server costs.

## How it works

- `pipeline/refresh.py` downloads the latest official CSV from GOV.UK
  ("Register of licensed sponsors: workers"), cleans it, groups rows into one
  record per organisation, adds industry tags, detects sponsors added since the
  last run, and writes `data/*.json`.
- `.github/workflows/refresh.yml` runs that script **every day at 05:30 UTC**
  and commits the refreshed data. Your host redeploys automatically.
- `index.html` is the whole site. It loads the JSON and does instant
  client-side search/filtering. No backend, no database.

The repo ships with small **sample data** so you can preview the UI
immediately. The first pipeline run replaces it with the full live register
(~100k+ organisations).

## Deploy in ~20 minutes (all free)

1. **Create a GitHub repo** and push this folder to it (branch `main`).
2. In the repo: **Actions tab → "Refresh sponsor register" → Run workflow.**
   Wait ~2 minutes; it commits the real register into `data/`.
3. **Host it** (pick one):
   - *GitHub Pages:* Settings → Pages → Deploy from branch → `main`, root.
   - *Cloudflare Pages / Vercel:* import the repo, framework "None",
     output directory = repo root. Auto-redeploys on every data commit.
4. **(Optional) Custom domain:** buy one (~$10/yr) and point it at your host.

That's the whole stack. Daily refresh is free on GitHub Actions.

## Local preview

JSON can't be loaded from `file://`, so serve the folder:

```bash
cd sponsorsignal
python3 -m http.server 8000
# open http://localhost:8000
```

## Email alerts (the monetization seed)

To collect real emails, create a free form endpoint (Tally, Formspree, and
Buttondown all have free tiers), then set the `ALERT_ENDPOINT` constant at the
top of the `<script>` block in `index.html` to that URL:

```js
const ALERT_ENDPOINT = 'https://formspree.io/f/xxxxxxx';
```

The form POSTs the email there as `FormData` (field name `email`) via `fetch`,
with no page reload. It shows the green confirmation only on a successful
response, and a readable inline error otherwise. While `ALERT_ENDPOINT` is
empty the form stays functional and explains that alerts aren't live yet.

Suggested path to revenue:
1. Collect emails free during beta.
2. Send a weekly "new sponsors" digest manually at first (copy from
   `data/new_sponsors.json`).
3. Once you have a few hundred subscribers, add a paid tier ($5–9/mo) for
   industry/city-filtered alerts, and automate sending from the pipeline.

## Analytics

The site uses [GoatCounter](https://www.goatcounter.com) — free for personal
use, no cookies, so no consent banner is required.

**You must do this once:** create an account, then replace `SITECODE` in the
GoatCounter `<script>` tag at the bottom of `index.html` with your own site
code. Until you do, page views are simply not recorded — nothing breaks.

## Notes and care

- Data source is the official public register on GOV.UK. Keep the footer
  disclaimers: this is a search tool, not immigration advice, and users should
  verify against the official register.
- Industry tags are heuristic (keyword rules over organisation names) —
  clearly labelled as such in the site FAQ. Improve `INDUSTRY_RULES` in
  `pipeline/refresh.py` as you learn.
- If GOV.UK changes the page layout, `find_latest_csv_url()` is the function
  to fix (it looks for the `.csv` asset link on the publication page).

## Roadmap ideas

- Filter presets + shareable URLs (e.g. /tech-london)
- Weekly automated digest emails per industry
- US H-1B dataset as a second country
- "Sponsor changes" log page (added / removed / rating changes) — great for SEO
