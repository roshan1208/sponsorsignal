# SponsorSignal

A live site at https://roshan1208.github.io/sponsorsignal/ that makes the
official UK register of licensed visa sponsors searchable. Static files on
GitHub Pages, refreshed daily by GitHub Actions. No server, no running costs.

**Read the `sponsorsignal` skill at the start of every session.** It holds the
mission, the revenue thesis, the current priorities and the decision rights.
Do not plan work on this project without it.

## The short version

- **Goal:** income that arrives without weekly manual work, from a pipeline
  that runs unattended.
- **Order:** accurate, then useful, then loved, then paid. Never trade a place
  down that list for a place higher up.
- **The moat is the change history**, not the data. GOV.UK publishes only the
  current state, so every daily snapshot is something nobody else has. Never
  rewrite this repo's history.
- **The job seeker is the user, not the customer.** Search stays free. The
  money comes from recruiters and advisers who want the change feed.
- **Own the work.** Make ordinary decisions and say what you chose. Ask before
  spending money, publishing to an audience, or setting prices.

## Ground rules

- No build step, no framework, no backend. `index.html` is the whole site.
- The pipeline is Python standard library only.
- One task per commit.
- Copy must read as if a person wrote it: short sentences, plain words, no
  clauses joined by em dashes. Say "employers". See the skill's
  `references/copy.md`.

## Layout

- `index.html` — the entire site
- `pipeline/refresh.py` — daily data build and the newsletter digest
- `pipeline/pages.py` — generates the city and industry landing pages
- `.github/workflows/refresh.yml` — the daily job, 05:30 UTC
- `data/` — generated, do not hand-edit
- City and industry directories — generated, do not hand-edit

## Checks

```bash
python -m unittest discover -s pipeline     # tests
python -m http.server 8000                  # local preview
curl -s https://roshan1208.github.io/sponsorsignal/data/meta.json   # live freshness
```
