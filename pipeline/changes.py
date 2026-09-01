"""
Change tracking and safety checks for SponsorSignal.

GOV.UK publishes only the current state of the register, never what changed.
So every run diffs today's data against the previous run and appends the
result to data/changes.json. That history cannot be rebuilt after the fact,
which makes it the most valuable thing this project owns — see the
sponsorsignal skill.

This module also holds the checks that stop an implausible download from
being published. The pipeline runs unattended and pushes straight to a live
site, so it has to refuse bad data rather than publish it quietly.

Everything here is a pure function apart from load(), so it can be tested
without a network or a clock. Stdlib only.
"""

import json
from datetime import date, timedelta

# How much history to keep. Long enough to answer "what changed this quarter",
# short enough that the file stays small.
HISTORY_DAYS = 90

# What "recently" means on the site and in the newsletter. A single day is too
# quiet to be worth showing; a week usually has something in it.
RECENT_DAYS = 7

# Refuse to publish if the register moves more than this in one run. Real
# daily movement is a fraction of a percent, so anything near this is a broken
# download rather than news.
MAX_CHANGE_RATIO = 0.10

# A parse that yields fewer rows than this has failed, whatever the reason.
MIN_ROWS = 10_000

# Bound the per-day history so one bad day cannot bloat the file forever.
MAX_PER_DAY = 2_000

I_NAME, I_TOWN = 0, 1


def sponsor_key(row):
    """Identity of a sponsor: name plus town.

    Name alone is not enough — chains and franchises repeat a name across
    towns, and treating those as one record loses real additions.
    """
    return (str(row[I_NAME]).strip().lower(),
            str(row[I_TOWN]).strip().lower())


def diff(previous_rows, current_rows):
    """Return (added, removed) between two lists of sponsor rows."""
    previous = {sponsor_key(r): r for r in previous_rows}
    current = {sponsor_key(r): r for r in current_rows}

    added = [current[k] for k in current.keys() - previous.keys()]
    removed = [previous[k] for k in previous.keys() - current.keys()]

    added.sort(key=lambda r: str(r[I_NAME]).lower())
    removed.sort(key=lambda r: str(r[I_NAME]).lower())
    return added, removed


def check_totals(new_total, previous_total,
                 max_ratio=MAX_CHANGE_RATIO, min_rows=MIN_ROWS):
    """Return a reason to refuse publishing, or '' if the numbers look sane.

    Guards the case that matters most: GOV.UK changes its page or its file,
    the scrape silently grabs the wrong thing, and the site publishes it.
    """
    if new_total < min_rows:
        return (f"only {new_total:,} employers parsed, expected at least "
                f"{min_rows:,}. The download or the CSV layout has probably "
                f"changed.")

    if previous_total:
        moved = abs(new_total - previous_total) / previous_total
        if moved > max_ratio:
            direction = "up" if new_total > previous_total else "down"
            return (f"the register moved {direction} from {previous_total:,} "
                    f"to {new_total:,} employers ({moved:.1%}), more than the "
                    f"{max_ratio:.0%} allowed in one run.")
    return ""


def load(path):
    """Read the change history, tolerating a missing or damaged file.

    A corrupt history must not stop today's refresh — losing one day of
    history is bad, but publishing nothing is worse.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        days = data.get("days", [])
        return [d for d in days if isinstance(d, dict) and d.get("date")]
    except Exception:
        return []


def _merge(existing, extra, cap):
    """Combine two lists of rows, keeping the first sighting of each sponsor."""
    out, seen = [], set()
    for row in list(existing) + list(extra):
        key = sponsor_key(row)
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out[:cap]


def append_day(history, on_date, added, removed,
               keep_days=HISTORY_DAYS, cap=MAX_PER_DAY):
    """Add today's changes to the history and drop anything too old.

    A second run on the same date merges into that date rather than
    replacing it. The job can legitimately run more than once in a day (the
    schedule, plus any push that touches the pipeline), and an overwrite
    would silently erase the changes the earlier run found. Merging is
    deduplicated by sponsor, so a re-run cannot double-count either.
    """
    same_day = next((d for d in history if d.get("date") == on_date), None)
    kept = [d for d in history if d.get("date") != on_date]
    kept.append({
        "date": on_date,
        "added": _merge(same_day.get("added", []) if same_day else [],
                        added, cap),
        "removed": _merge(same_day.get("removed", []) if same_day else [],
                          removed, cap),
    })
    kept.sort(key=lambda d: d["date"])

    if keep_days:
        cutoff = (date.fromisoformat(on_date)
                  - timedelta(days=keep_days)).isoformat()
        kept = [d for d in kept if d["date"] >= cutoff]
    return kept


def recent(history, field, today, days=RECENT_DAYS):
    """Rows added (or removed) within the last `days`, most recent first.

    Deduplicated by sponsor: an employer that comes and goes should appear
    once, dated by its latest movement.
    """
    cutoff = (date.fromisoformat(today) - timedelta(days=days)).isoformat()

    seen, out = set(), []
    for day in sorted(history, key=lambda d: d["date"], reverse=True):
        if day["date"] < cutoff:
            continue
        for row in day.get(field, []):
            key = sponsor_key(row)
            if key in seen:
                continue
            seen.add(key)
            out.append(row)
    return out
