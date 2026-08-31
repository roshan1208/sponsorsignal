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

Signups go to MailerLite, into the **SponsorSignal alerts** group. The
endpoint is the `ALERT_ENDPOINT` constant at the top of the `<script>` block
in `index.html`. Setting it to `''` disables signup gracefully rather than
breaking the form.

Only the endpoint is used, not MailerLite's embed snippet — that ships its own
fonts, colours and jQuery, which would fight the site's design.

The form POSTs `fields[email]` (plus `ml-submit` and `anticsrf`) as `FormData`
via `fetch`, with no page reload. MailerLite allows cross-origin reads, so the
real response decides what the visitor sees. Note it answers **HTTP 200 with
`{"success": false, ...}`** for a rejected address, so the JSON body is what
matters, not the status code. When it sends a useful message ("already
subscribed") that message is shown instead of a generic one.

**Double opt-in is on**, which is worth keeping for deliverability. A new
signup is not a subscriber until they click the link in the confirmation
email, so the success message tells them to go and check their inbox.

To change the destination, create a new embedded form in MailerLite and copy
the `action` URL out of its snippet.

Suggested path to revenue:
1. Collect emails free during beta.
2. Send a weekly "new sponsors" digest manually at first (copy from
   `data/new_sponsors.json`).
3. Once you have a few hundred subscribers, add a paid tier ($5–9/mo) for
   industry/city-filtered alerts, and automate sending from the pipeline.

## Analytics

The site uses [GoatCounter](https://www.goatcounter.com). No cookies, so no
consent banner is needed. Dashboard: https://sponsorsignal.goatcounter.com

The tag lives in two places and they must stay in step:

- the bottom of `index.html`
- the `GOATCOUNTER` constant in `pipeline/pages.py`, which emits the same tag
  on every generated landing page

The landing pages are the whole SEO channel, so tracking them is the point.
If you change the site code, change both.

Note GoatCounter's free tier is intended for non-commercial use. Once this
earns money, move to a paid plan or switch to Cloudflare Web Analytics.

## Weekly digest

Each pipeline run also writes [`data/digest.md`](data/digest.md) — the newly
added sponsors grouped by industry, capped at 100 entries. Paste it straight
into your newsletter. The renderer is a pure function (`build_digest` in
`pipeline/refresh.py`) covered by `pipeline/test_digest.py`:

```bash
python -m unittest discover -s pipeline -v
```

The same tests run in CI before every refresh.

## Landing pages (SEO)

`pipeline/pages.py` generates one page per top industry and top city — e.g.
`/tech-software/`, `/london/` — each with its own title, description,
canonical URL, a distinct lead paragraph, a sample table of sponsors, and a
link into the pre-filtered main app. It also rewrites `sitemap.xml` and the
"browse" links in the homepage footer between the `BROWSE-LINKS` markers.

**Do not hand-edit these** — every pipeline run overwrites them. Change
`TOP_INDUSTRIES` / `TOP_TOWNS` / `EXAMPLES_PER_PAGE` in `pipeline/pages.py`
instead. The `BROWSE-LINKS` marker comments in `index.html` must stay put; the
pipeline raises if they are missing rather than silently skipping the update.

## Installable (PWA lite)

`manifest.json` plus `sw.js` make the site installable via "Add to Home
Screen" on Android Chrome. Icons live in `icons/` and are generated one-off
(not by the pipeline).

The service worker is deliberately minimal:

- **HTML pages and `data/*.json` are network-first**, fetched with
  `cache: 'no-cache'` so the browser revalidates instead of trusting GitHub
  Pages' `max-age=600`. A push therefore goes live on the next load, not the
  one after it.
- Other assets (icons, images) are stale-while-revalidate.

The cache is an offline fallback, not a page speed-up — correctness over
roughly 200ms on repeat loads, chosen because the register changes daily.

If you ever need to ship a breaking shell change, bump `CACHE` in `sw.js`
(`sponsorsignal-v1` → `v2`); the activate handler deletes every other cache.
To drop the worker entirely for a visitor, use DevTools → Application →
Service Workers → Unregister.

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
