---
name: sponsorsignal
description: Operating brief for SponsorSignal — the mission, revenue thesis, quality bar and current priorities. Load this at the start of any session on this project, and before deciding what to build next, changing user-facing copy or design, touching the data pipeline, or discussing traffic, pricing or monetisation.
---

# SponsorSignal — operating brief

A live site at https://roshan1208.github.io/sponsorsignal/ that lets anyone
search the official UK register of employers licensed to sponsor work visas.
Static files on GitHub Pages, refreshed daily by a GitHub Actions job. No
server, no database, no running costs.

## What this is for

Someone job hunting in the UK on a visa can only work for an employer holding
a sponsor licence. That is roughly 127,000 employers out of about 5 million.
Every application sent to the other 98% is wasted effort, and most applicants
find that out too late. The Home Office publishes the list, but as a raw
multi-megabyte CSV with no search, no industries, and no way to see what
changed.

We make that list usable. Someone should be able to land on the site and know,
within seconds, which employers near them can sponsor a visa.

**The order is: accurate, then useful, then loved, then paid.**

Never trade a place down that list for a place higher up. This sits next to
someone's immigration status and livelihood. Wrong data costs a real person a
real job application, and once trust is gone the business is gone with it. If
a change would make money but degrade accuracy or clarity, do not make it.

## The honest strategic picture

Read this before proposing anything. Two facts drive every decision:

**The data is not a moat.** It is free, public, and anyone can rebuild the
pipeline in a weekend. Competing sites already exist. Being a nicer search box
over public data is not a durable business by itself.

**The change history is the moat.** GOV.UK publishes only the current state of
the register. It does not publish what changed. Every daily commit is a dated
snapshot, so the repo is quietly accumulating a time series that cannot be
reconstructed after the fact: who was newly licensed, who lost their licence,
which sectors are growing. In a year this is a dataset nobody else has.

Two consequences, and they are not optional:

- Start capturing changes properly **now**. Every day not captured is gone
  forever. This is why the new/removed sponsor work outranks cosmetic work.
- Never rewrite git history on this repo, and never let the pipeline commit
  data it has not sanity-checked. The history *is* the asset.

**Who actually pays.** The job seeker is the user, not the customer. They are
by definition short of money and leave the moment they get a visa. Recruiters,
immigration advisers and relocation firms have budgets, renew, and want exactly
what we uniquely hold: change feeds, exports, filtered alerts. Serve job
seekers free forever — they are the traffic, the SEO and the credibility — and
sell to the people who profit from them.

Details, pricing and sequencing: `references/revenue.md`.

## End goal

Income that arrives without weekly manual work. That means the whole loop —
fetch, validate, publish, notify, bill — runs unattended, and a human only
steps in when something is genuinely wrong.

This is realistic but not fast. Expect SEO to take months to compound. Do not
propose schemes that trade the long game for a spike, and do not tell the user
this will be quick.

Anything added must be judged on: *does this still work if nobody touches it
for a month?* If the answer is no, it needs a guard rail or it does not ship.

## Current state

- Live, 127,574 employers, refreshed daily at 05:30 UTC by
  `.github/workflows/refresh.yml`.
- 20 generated landing pages (8 industries, 12 cities), sitemap, OG image,
  installable PWA, 38 passing unit tests.
- `index.html` is the entire site. `pipeline/refresh.py` builds the data,
  `pipeline/pages.py` builds the landing pages.

**Known gaps, in priority order.** Re-check these against the repo before
trusting them; this list is a starting point, not a source of truth.

1. **Email capture is inert.** `ALERT_ENDPOINT` in `index.html` is still empty,
   so nothing is collected. Every visitor until this is set is lost for good.
   Highest value item on the list. Needs an endpoint URL from the user.
2. **No analytics.** GoatCounter is wired but the site code is still
   `SITECODE`. Until this is set we cannot tell whether anything works.
3. **The pipeline has no safety guard.** `find_latest_csv_url()` takes the
   first CSV link on the GOV.UK page and nothing checks the result is sane. One
   layout change silently rewrites the data, all 20 landing pages, the sitemap
   and the homepage footer, then auto-deploys. This is the biggest technical
   risk to a hands-off pipeline.
4. **"Added recently" is empty.** Changes are only diffed against the previous
   run, and removals are never detected. The one feature people would subscribe
   for currently shows nothing.
5. **Sitemap not submitted to Google Search Console.** The landing pages cannot
   earn traffic until Google finds them. Only the user can do this.

## What to do next

Work in this order unless the user says otherwise. Each step unlocks the next.

1. **Capture emails.** The list is the compounding asset; everything else is
   downstream of it.
2. **Make the pipeline trustworthy.** Sanity checks, loud failure. Passive
   income needs a pipeline that cannot quietly poison itself.
3. **Track additions and removals properly.** This builds the moat and fills
   the newsletter with something worth reading.
4. **Get found.** Search Console, then more landing pages, then launch posts.
5. **Only then, charge.** A paid tier before there is a list, a history and
   traffic is premature.

Before a launch push, verify email capture works and that "Added recently"
shows real results. A launch that lands on a dead form spends attention we
cannot get back.

## Decision rights

Own the work. Do not ask permission for ordinary decisions — make the call,
say what you chose and why, and move on.

**Decide without asking:** code, copy, layout, UX, data modelling, SEO
structure, refactors, tests, what to build next from the priority list.

**Ask first:**
- Anything that spends money or signs the user up to a paid service.
- Anything published to an audience: posting to Reddit, LinkedIn or X,
  emailing the list, submitting to directories. Drafting is fine; sending is
  the user's call.
- Pricing, and how the site positions itself legally.
- Rewriting git history, force-pushing, or anything that risks the snapshots.
- Adding a backend, a framework, a build step or a paid dependency.

Flag honestly when something will not work, including when the user asks for
it. Saying "this looks good" about a thin idea costs them real money.

## Constraints

These come from the user and are not up for renegotiation without asking:

- No build step, no framework, no backend. `index.html` is the whole site.
- The pipeline is Python standard library only.
- Keep the existing visual design. Improve within it.
- One task per commit, message written for a human reading it in a year.
- Never commit secrets. Never commit generated `__pycache__`.

## Quality bar

Non-negotiable, because a confusing free tool never becomes a paid one.

- Fast to something useful. Never a bare spinner: say what is loading.
- No empty state that looks broken. If a feature has nothing to show, say why.
- Mobile first. Most people searching for visa sponsorship are on a phone.
- Real focus states, working keyboard navigation, sensible ARIA.
- Keep the disclaimers. This is a search tool, not immigration advice.

Full checklist: `references/quality.md`.

## Writing rules

The copy must read as if a person wrote it. Plain words, short sentences, no
padding. Do not join two clauses with an em dash — write two sentences. Do not
hedge, apologise or explain the implementation to the visitor. Say "employers",
not "organisations" or "companies" (much of the register is councils, NHS
trusts, schools and charities).

This applies to the site, the landing pages, the newsletter, and anything
written for the user's audience. Full rules and worked examples:
`references/copy.md`.

## Growth and engagement

How to get people here and keep them: `references/growth.md`.

## Start of a session

Do these checks before proposing work, and lead with anything that is broken:

1. Is the site up, and how fresh is the data?
   `curl -s https://roshan1208.github.io/sponsorsignal/data/meta.json`
2. Did the last scheduled run pass?
   `https://api.github.com/repos/roshan1208/sponsorsignal/actions/runs?per_page=3`
3. Is the working tree clean and in sync with `origin/main`?
4. Do the tests pass? `python -m unittest discover -s pipeline`
5. Have the gaps above been closed since this was written?

Then say plainly what is worth doing next and start. Do not present a menu of
options when one of them is clearly right.
