"""
SponsorSignal data pipeline
---------------------------
Fetches the latest official UK Register of Licensed Sponsors (Workers)
from GOV.UK, cleans it, enriches it with industry tags, detects newly
added sponsors since the last run, and writes compact JSON files that
the static site reads.

Runs in GitHub Actions on a daily cron (see .github/workflows/refresh.yml).
Uses only the official public dataset published by the Home Office.

Outputs (relative to repo root):
  data/sponsors.json      compact list of all sponsors
  data/new_sponsors.json  sponsors added since the previous run
  data/meta.json          counts + last-updated timestamps
  data/digest.md          human-readable digest of the new sponsors
"""

import csv
import io
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REGISTER_PAGE = (
    "https://www.gov.uk/government/publications/"
    "register-of-licensed-sponsors-workers"
)
UA = {"User-Agent": "SponsorSignal/1.0 (public-data refresh bot)"}

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# ---------------------------------------------------------------- industry --
# Lightweight keyword classifier over organisation names. Deliberately
# conservative: an org gets a tag only on a confident keyword hit,
# otherwise "Other". Extend freely.
INDUSTRY_RULES = [
    ("Healthcare & Care", r"\b(care|caring|nursing|nurses|health|medical|clinic|hospice|hospital|pharma|dental|dentist|gp|surgery|homecare|home care|carers)\b"),
    ("Tech & Software", r"\b(tech|software|digital|data|cyber|cloud|systems|solutions|it services|informatics|analytics|ai|labs)\b"),
    ("Hospitality & Food", r"\b(restaurant|hotel|hospitality|catering|cafe|kitchen|foods?|dining|takeaway|grill|pizza|curry|tandoori|bakery|brewery|pub)\b"),
    ("Construction & Engineering", r"\b(construction|builders?|building|engineering|engineers|civil|electrical|mechanical|contractors?|scaffolding|roofing)\b"),
    ("Finance & Professional", r"\b(accountants?|accounting|finance|financial|capital|consulting|consultants|advisory|solicitors?|legal|law|insurance|audit)\b"),
    ("Education & Research", r"\b(school|college|university|academy|education|training|institute|research|nursery)\b"),
    ("Logistics & Transport", r"\b(logistics|transport|haulage|freight|shipping|courier|delivery|distribution)\b"),
    ("Retail & Commerce", r"\b(retail|stores?|supermarket|trading|wholesale|commerce|mart|shop)\b"),
    ("Charity & Faith", r"\b(charity|charitable|foundation|trust|church|mosque|temple|gurdwara|ministries|mission)\b"),
    ("Recruitment & Staffing", r"\b(recruitment|recruiting|staffing|personnel|workforce|manpower|talent)\b"),
]
INDUSTRY_RULES = [(name, re.compile(rx, re.I)) for name, rx in INDUSTRY_RULES]


def classify(name: str) -> str:
    for label, rx in INDUSTRY_RULES:
        if rx.search(name):
            return label
    return "Other"


# ------------------------------------------------------------------- fetch --
def find_latest_csv_url() -> str:
    """Scrape the GOV.UK publication page for the current CSV asset URL."""
    req = urllib.request.Request(REGISTER_PAGE, headers=UA)
    html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    # Asset links live on assets.publishing.service.gov.uk (or /media/ paths)
    candidates = re.findall(
        r'href="(https://[^"]+?\.csv)"', html
    ) + re.findall(r'href="(/media/[^"]+?\.csv)"', html)
    if not candidates:
        raise RuntimeError("No CSV link found on the GOV.UK register page")
    url = candidates[0]
    if url.startswith("/"):
        url = "https://www.gov.uk" + url
    return url


def download_csv(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    raw = urllib.request.urlopen(req, timeout=300).read()
    return raw.decode("utf-8-sig", "replace")


# ------------------------------------------------------------------- clean --
def normalise_header(h: str) -> str:
    return re.sub(r"[^a-z]", "", h.lower())


def parse_register(text: str):
    """
    The register has one row per (organisation, route). Group rows into one
    record per organisation+town with the set of routes and best rating.
    Expected columns (defensively matched): Organisation Name, Town/City,
    County, Type & Rating, Route.
    """
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        raise RuntimeError("Empty CSV")

    header = [normalise_header(h) for h in rows[0]]

    def col(*keys):
        for k in keys:
            for i, h in enumerate(header):
                if k in h:
                    return i
        return None

    i_name = col("organisationname", "organisation")
    i_town = col("towncity", "town")
    i_county = col("county")
    i_rating = col("typerating", "rating")
    i_route = col("route", "tier")
    if i_name is None or i_route is None:
        raise RuntimeError(f"Unexpected CSV header: {rows[0]}")

    orgs = {}
    for r in rows[1:]:
        if len(r) <= i_name:
            continue
        name = r[i_name].strip()
        if not name:
            continue
        town = (r[i_town].strip().title() if i_town is not None and len(r) > i_town else "")
        county = (r[i_county].strip().title() if i_county is not None and len(r) > i_county else "")
        rating_raw = (r[i_rating].strip() if i_rating is not None and len(r) > i_rating else "")
        route = (r[i_route].strip() if len(r) > i_route else "")

        key = (name.lower(), town.lower())
        rec = orgs.setdefault(
            key,
            {"n": name, "t": town, "c": county, "routes": set(), "rating": ""},
        )
        if route:
            rec["routes"].add(route)
        # Prefer showing an A rating if any row carries one
        if "a rating" in rating_raw.lower() or rating_raw.strip().lower().startswith("a "):
            rec["rating"] = "A"
        elif not rec["rating"] and rating_raw:
            rec["rating"] = "B" if "b rating" in rating_raw.lower() else rec["rating"]
    return orgs


# ------------------------------------------------------------------ digest --
DIGEST_CAP = 100


def build_digest(new_rows, generated_on, cap=DIGEST_CAP):
    """
    Render newly added sponsors as a markdown digest, grouped by industry.

    Pure function of its arguments (no I/O, no clock) so it can be unit
    tested — see pipeline/test_digest.py. `new_rows` are records in the
    same shape written to sponsors.json:
        [name, town, county, industry, routes[], rating]
    """
    lines = [f"# New UK sponsors — {generated_on}", ""]

    if not new_rows:
        lines += ["No new sponsors were added to the register in this update.", ""]
        return "\n".join(lines)

    total = len(new_rows)
    shown = sorted(new_rows, key=lambda r: str(r[0]).lower())[:cap]

    noun = "organisation was" if total == 1 else "organisations were"
    lines += [f"**{total} {noun}** added to the official register "
              f"in this update.", ""]
    if total > len(shown):
        lines += [f"Showing the first {len(shown)} alphabetically.", ""]

    groups = {}
    for row in shown:
        groups.setdefault(row[3] or "Other", []).append(row)

    # Biggest industries first, then alphabetically for stable output.
    for industry in sorted(groups, key=lambda k: (-len(groups[k]), k.lower())):
        entries = groups[industry]
        lines += [f"## {industry} ({len(entries)})", ""]
        for name, town, county, _industry, routes, _rating in entries:
            location = ", ".join(p for p in (town, county) if p)
            detail = " · ".join(p for p in (location, " / ".join(routes)) if p)
            lines.append(f"- **{name}**" + (f" — {detail}" if detail else ""))
        lines.append("")

    lines += [
        "---",
        "",
        f"Source: [GOV.UK Register of Licensed Sponsors (Workers)]({REGISTER_PAGE})",
        "",
        "Generated automatically by SponsorSignal.",
        "",
    ]
    return "\n".join(lines)


# -------------------------------------------------------------------- main --
def main():
    DATA.mkdir(exist_ok=True)

    print("Finding latest CSV on GOV.UK ...")
    csv_url = find_latest_csv_url()
    print("Downloading:", csv_url)
    text = download_csv(csv_url)

    print("Parsing register ...")
    orgs = parse_register(text)
    print(f"{len(orgs)} unique organisations")

    # Previous names, for new-sponsor detection
    prev_names = set()
    prev_file = DATA / "sponsors.json"
    if prev_file.exists():
        try:
            prev = json.loads(prev_file.read_text())
            prev_names = {s[0].lower() for s in prev.get("sponsors", [])}
        except Exception:
            pass

    # Compact records: [name, town, county, industry, routes, rating]
    sponsors, new_sponsors = [], []
    for rec in sorted(orgs.values(), key=lambda x: x["n"].lower()):
        industry = classify(rec["n"])
        row = [
            rec["n"],
            rec["t"],
            rec["c"],
            industry,
            sorted(rec["routes"]),
            rec["rating"],
        ]
        sponsors.append(row)
        if prev_names and rec["n"].lower() not in prev_names:
            new_sponsors.append(row)

    stamp = datetime.now(timezone.utc)
    now = stamp.strftime("%Y-%m-%d %H:%M UTC")

    # encoding is pinned because organisation names contain non-ASCII
    # characters; without it this crashes on a non-UTF-8 default locale.
    (DATA / "sponsors.json").write_text(
        json.dumps({"updated": now, "source": csv_url, "sponsors": sponsors},
                   separators=(",", ":"), ensure_ascii=False),
        encoding="utf-8",
    )
    (DATA / "new_sponsors.json").write_text(
        json.dumps({"updated": now, "new": new_sponsors[:500]},
                   separators=(",", ":"), ensure_ascii=False),
        encoding="utf-8",
    )
    (DATA / "meta.json").write_text(json.dumps({
        "updated": now,
        "total": len(sponsors),
        "new_since_last_run": len(new_sponsors),
        "sample": False,
    }), encoding="utf-8")
    (DATA / "digest.md").write_text(
        build_digest(new_sponsors, stamp.strftime("%d %B %Y")),
        encoding="utf-8",
    )
    print(f"Done. {len(sponsors)} sponsors, {len(new_sponsors)} new since last run.")


if __name__ == "__main__":
    sys.exit(main())
