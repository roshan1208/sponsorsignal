"""
Generates feed.xml - an RSS feed of the register's daily changes.

Three reasons this exists, in order of how much they matter:

1. It is a subscription that costs the reader nothing. Someone who will not
   hand over an email address will still add a feed, and a recruiter or an
   adviser can poll it from whatever they already use.
2. It is the input MailerLite's RSS-to-email needs, so the automated weekly
   send becomes possible without writing a sender.
3. Feeds are how aggregators and journalists pick things up. Nobody else
   publishes a feed of sponsor licence changes because nobody else keeps the
   history to build one from.

One item per day that actually changed. A day with no movement gets no item,
because an empty entry trains people to ignore the feed.

Stdlib only.
"""

import html
from datetime import datetime, timezone
from email.utils import format_datetime

from pages import SITE

I_NAME, I_TOWN = 0, 1

# How many days of history to publish. Readers only ever show recent items,
# and the whole history stays available in data/changes.json.
FEED_DAYS = 60

# Employers named in an item before it says "and N more". Enough to be
# useful in a reader's preview pane, short enough not to be a wall.
NAMED_IN_ITEM = 12


def _plural(n, word):
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def item_title(day):
    added, removed = len(day.get("added", [])), len(day.get("removed", []))
    when = _pretty_date(day["date"])
    if added and removed:
        return (f"{_plural(added, 'sponsor')} added and "
                f"{_plural(removed, 'sponsor')} removed, {when}")
    if added:
        return f"{_plural(added, 'sponsor')} added, {when}"
    return f"{_plural(removed, 'sponsor')} removed, {when}"


def _pretty_date(iso):
    d = datetime.fromisoformat(iso)
    # No %-d on Windows, so strip the zero by hand.
    return f"{d.day} {d.strftime('%B %Y')}"


def _name_list(rows, limit=NAMED_IN_ITEM):
    shown = sorted(rows, key=lambda r: str(r[I_NAME]).lower())[:limit]
    parts = []
    for row in shown:
        town = (row[I_TOWN] or "").strip()
        parts.append(f"{row[I_NAME]} ({town})" if town else str(row[I_NAME]))
    text = "; ".join(parts)
    if len(rows) > len(shown):
        text += f"; and {len(rows) - len(shown)} more"
    return text


def item_description(day):
    """Plain sentences, not markup. Readers render feeds very differently,
    and this text is also what an RSS-to-email send would put in the body."""
    added, removed = day.get("added", []), day.get("removed", [])
    parts = []
    if added:
        parts.append(f"Newly licensed: {_name_list(added)}.")
    if removed:
        parts.append("No longer licensed, so they cannot sponsor a visa now: "
                     f"{_name_list(removed)}.")
    parts.append("Source: the official GOV.UK Register of Licensed Sponsors "
                 "(Workers). Not immigration advice.")
    return " ".join(parts)


def render(history, updated=None, days=FEED_DAYS):
    """Build the RSS document from the change history."""
    esc = html.escape
    moved = [d for d in history
             if d.get("added") or d.get("removed")][-days:]
    moved.sort(key=lambda d: d["date"], reverse=True)

    stamp = updated or datetime.now(timezone.utc)
    items = []
    for day in moved:
        # Midday UTC: a date alone has no time, and midnight can land on the
        # previous day once a reader applies its own timezone.
        when = datetime.fromisoformat(day["date"]).replace(
            hour=12, tzinfo=timezone.utc)
        items.append(f"""    <item>
      <title>{esc(item_title(day))}</title>
      <link>{SITE}/changes/</link>
      <guid isPermaLink="false">sponsorsignal-changes-{day['date']}</guid>
      <pubDate>{format_datetime(when)}</pubDate>
      <description>{esc(item_description(day))}</description>
    </item>""")

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>SponsorSignal: UK visa sponsors added and removed</title>
    <link>{SITE}/changes/</link>
    <atom:link href="{SITE}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Employers gaining and losing their licence to sponsor UK work visas. Rebuilt daily from the official GOV.UK register.</description>
    <language>en-GB</language>
    <lastBuildDate>{format_datetime(stamp)}</lastBuildDate>
    <ttl>720</ttl>
{chr(10).join(items)}
  </channel>
</rss>
"""


def write(root, history, updated=None):
    """Write feed.xml. Returns the number of items published."""
    (root / "feed.xml").write_text(render(history, updated), encoding="utf-8")
    return len([d for d in history if d.get("added") or d.get("removed")])
