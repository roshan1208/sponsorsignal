# Quality bar

A confusing free tool never becomes a paid one. Someone using this is often
anxious, on a phone, and short of time. The site should feel calm, fast and
honest.

## Experience

- **Useful within about two seconds.** The search box works before the data
  finishes loading. Someone who lands from Google sees relevant employers, not
  a homepage to start over from.
- **Never a bare spinner.** Say what is loading and roughly how long.
- **No empty state that looks broken.** If a filter has nothing to show,
  explain why and offer the next step. An empty "Added recently" reads as a
  bug, not as "nothing changed today".
- **Never lose typed input.** Data arriving must not wipe what someone typed.
- **Mobile first.** Most of this audience is on a phone, often on mobile data.
  Test narrow before wide.
- **The back button works.** Filters live in the URL, so any view can be
  shared and any step can be undone.

## Accessibility

Not optional. A meaningful share of this audience uses a screen reader,
translation tools, or a browser at 200% zoom.

- Real focus states on every interactive element.
- Full keyboard navigation, in a sensible order.
- Live regions announce result counts and status changes.
- Colour is never the only signal.
- Respect `prefers-reduced-motion`.
- Text contrast at least 4.5:1.

## Trust

The whole business depends on being believed.

- Show the update time on every page.
- Say where the data came from and link to the source.
- Be clear about what is ours and what is official. Industry tags are ours and
  must be labelled as such.
- Keep the disclaimers: a search tool built on public data, not affiliated with
  the Home Office, not immigration advice.
- Never quietly change what a number means. If the count moves, the reason
  should be visible.

## Technical

- **Guard the pipeline.** Validate before writing. A bad fetch must fail
  loudly, not publish rubbish. Nothing unattended should be able to poison the
  site.
- **Data freshness beats speed.** Pages and data are fetched network-first so a
  push or a refresh appears on the next load. Caching is an offline fallback.
- **Tests cover the pure functions.** Anything that renders text or picks what
  to show should be testable without a network or a clock.
- **Keep the stack boring.** No build step, no framework, no backend, standard
  library only. Every dependency is a future outage nobody is watching.

## Before shipping anything user-facing

1. Does it work on a narrow screen?
2. Does it work with the keyboard alone?
3. What does it show when there is no data, slow data, or failed data?
4. Does the copy pass `references/copy.md`?
5. If it is generated, are the pages regenerated and the tests passing?
6. Does it still work if nobody touches it for a month?
