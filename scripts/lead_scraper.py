#!/usr/bin/env python3
"""
lead_scraper.py — scrape LinkedIn leads from a Google/Bing X-ray search prompt.

Give it the exact search prompt(s) you'd paste into Google (a LinkedIn X-ray
query), and it drives a real browser to collect the matching linkedin.com/in
candidates and print them as JSON (or write a classified CSV/Excel).

WHY A REAL BROWSER: plain HTTP requests to Google/Bing get blocked instantly.
Playwright (a real Chromium) passes most of that — best from a normal IP.
Engines still CAPTCHA or silently drop the site: filter under load, so keep
--pages low and don't hammer them.

SETUP (one time):
    pip install -r requirements.txt
    playwright install chromium

USAGE:
    # one prompt, classified CSV (default, standalone use)
    python lead_scraper.py 'site:linkedin.com/in ("CTO" OR "CIO") "Gurgaon"'

    # several prompts (each scraped, all merged & deduped)
    python lead_scraper.py "query one" "query two" --pages 2 --out leads.csv

    # raw JSON candidates on stdout (used when Node calls this as a fallback
    # search engine — no classification, Node does that itself)
    python lead_scraper.py "query one" --json --pages 2

    # watch it work and solve a CAPTCHA yourself when one shows up
    python lead_scraper.py "..." --headful
"""

import argparse
import csv
import json
import re
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path

DEFAULT_PROFILE_DIR = str(Path(tempfile.gettempdir()) / 'lead-scraper-profile')

# --- config ---------------------------------------------------------------

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# Paginated engine URLs. Google first — it's the only one that does
# `site:linkedin.com/in` X-ray searches well when it isn't degrading the query.
ENGINES = [
    ("Google", lambda q, p: f"https://www.google.com/search?q={urllib.parse.quote(q)}&num=20&start={p*10}&hl=en"),
    ("Bing",   lambda q, p: f"https://www.bing.com/search?q={urllib.parse.quote(q)}&first={p*10+1}"),
]

# JS run inside the results page: collect {url, title, snippet} for every
# organic linkedin.com/in link, decoding Google's /url?q= and Bing's
# base64-ish redirect wrappers. Mirrors parseResults() in the Node app.
JS_EXTRACT = r"""
() => {
  function decode(href){
    try{
      const u = new URL(href, location.origin);
      if (u.pathname === '/url') return u.searchParams.get('q') || u.searchParams.get('url') || href;
      if (/\/(ck\/a|url)/.test(u.pathname)) {
        const e = (u.searchParams.get('u') || '').replace(/^a1/, '');
        if (e) { try { return atob(e.replace(/-/g,'+').replace(/_/g,'/')); } catch(_){} }
      }
      return href;
    } catch(e){ return href; }
  }
  const out = [], seen = new Set();
  document.querySelectorAll('a[href]').forEach(a => {
    const href = decode(a.getAttribute('href') || '');
    const m = href.match(/https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^?&#"'\s\/]+/i);
    if (!m) return;
    const url = 'https://www.linkedin.com' + new URL(m[0]).pathname.replace(/\/+$/, '');
    if (seen.has(url)) return;
    const card = a.closest('div.g, div.tF2Cxc, div.MjjYud, li.b_algo, .snippet, article, .result');
    // Organic-only: must sit in a known result container or wrap a heading —
    // drops "people also viewed"/sidebar links the same way the Node parser does.
    const hasHeading = a.querySelector('h3, h2') !== null;
    if (!card && !hasHeading) return;
    seen.add(url);
    let title = '';
    if (card) { const h = card.querySelector('h3, h2, [role=heading]'); if (h) title = h.textContent.trim(); }
    if (!title) title = (a.textContent || '').trim();
    let snippet = '';
    if (card) {
      const d = card.querySelector('[class*="description"], .VwiC3b, .b_caption p, .snippet-description, p');
      if (d) snippet = d.textContent.trim();
    }
    out.push({ url, title, snippet });
  });
  return out;
}
"""

# --- reliability detection (mirrors linkedin.js) ---------------------------

CHALLENGE_RE = re.compile(
    r'unusual traffic|verify you are human|are you a robot|complete the captcha|'
    r'solve the captcha|captcha to continue|prove you\'?re human', re.I)

# A page whose result-count widget shows a huge open-ended number, with zero
# real LinkedIn links, for a query that clearly asked for a narrow subset
# (a quoted phrase) — the engine silently dropped site:/quoted-phrase filters
# and returned an ordinary broad-match page instead. See looksLikeIgnoredSiteOperator
# in linkedin.js for the identical reasoning.
RESULT_COUNT_RE = re.compile(r'\b(of\s+)?(about\s+)?[\d][\d,]{3,}\s*results?\b', re.I)
QUOTED_PHRASE_RE = re.compile(r'"[^"]{4,}"')

# Google increasingly renders organic results client-side from a JSON payload
# embedded in a <script> tag rather than static <a href> markup — the raw HTML
# has real LinkedIn URLs in it, but a DOM scan finds none. Extract that payload
# directly: each result is a JS array literal
#   ["https://in.linkedin.com/in/...","Name - Title","snippet text", ...]
GOOGLE_JSON_RE = re.compile(r'\["(https?://[^"]*linkedin\.com/in/[^"]+)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)"')


def unescape_js_string(s):
    return re.sub(r'\\u([0-9a-fA-F]{4})|\\(.)', lambda m: (
        chr(int(m.group(1), 16)) if m.group(1) else
        '\n' if m.group(2) == 'n' else
        '\t' if m.group(2) == 't' else m.group(2)
    ), s or '')


def clean_profile_url(url):
    try:
        m = re.match(r'https?://(?:[a-z]{2,3}\.)?linkedin\.com(/in/[^?&#]+)', url, re.I)
        if not m:
            return ''
        return 'https://www.linkedin.com' + m.group(1).rstrip('/')
    except Exception:
        return ''


def parse_google_json_results(html):
    out, seen = [], set()
    for m in GOOGLE_JSON_RE.finditer(html):
        url = clean_profile_url(unescape_js_string(m.group(1)))
        if not url or url in seen:
            continue
        seen.add(url)
        out.append({
            'url': url,
            'title': unescape_js_string(m.group(2)).strip(),
            'snippet': unescape_js_string(m.group(3)).strip(),
        })
    return out


def looks_like_challenge(html):
    return bool(CHALLENGE_RE.search(html or ''))


def looks_like_ignored_site_operator(html, query):
    if 'linkedin.com/in/' in (html or '').lower():
        return False
    if not QUOTED_PHRASE_RE.search(query or ''):
        return False
    return bool(RESULT_COUNT_RE.search(html or ''))


def wait_for_manual_solve(page, deadline_s=120):
    """Headful mode: wait for the user to clear a shown CAPTCHA by hand."""
    print("    ⚠ CAPTCHA — please solve it in the browser window (waiting up to 2 min)…", flush=True)
    try:
        page.bring_to_front()
    except Exception:
        pass
    deadline = time.time() + deadline_s
    while time.time() < deadline:
        page.wait_for_timeout(2500)
        try:
            html = page.content()
        except Exception:
            html = ''
        if not looks_like_challenge(html) and '/sorry/index' not in page.url:
            print("    CAPTCHA cleared — continuing.", flush=True)
            return True
    print("    CAPTCHA not solved in time — continuing.", flush=True)
    return False


# --- parsing & classification (used only for standalone CSV/Excel output) --

def parse_title(title):
    t = re.sub(r'\s*[|–-]\s*LinkedIn.*$', '', title or '', flags=re.I).strip()
    parts = [p.strip() for p in re.split(r'\s+[-–|]\s+', t) if p.strip()]
    name = parts[0] if parts else ''
    if re.match(r'^(web results|results|more results|see more|profiles|view)\b', name, re.I) or re.search(r'linkedin', name, re.I):
        name = ''
    desig = parts[1] if len(parts) > 1 else ''
    comp = parts[2] if len(parts) > 2 else ''
    if not comp and re.search(r'\s+at\s+', desig, re.I):
        m = re.match(r'^(.*?)\s+at\s+(.+)$', desig, re.I)
        if m:
            desig, comp = m.group(1).strip(), m.group(2).strip()
    return name, desig, comp


SENIORITY = [
    (r'\b(chief|cxo|c[a-z]o|ceo|cto|cio|cmo|cfo|coo|chro|cpo|cdo|cgo|ciso)\b', 'C-Level', 95),
    (r'\b(founder|co-?founder|owner|proprietor|managing director|md|partner)\b', 'Founder/MD', 92),
    (r'\b(president|vice president|svp|evp|avp|vp)\b', 'VP', 82),
    (r'\b(director|head|country head|business head|unit head|general manager|gm)\b', 'Director/Head', 70),
    (r'\b(manager|lead|principal|senior|specialist)\b', 'Manager/Lead', 48),
]
DEPARTMENT = [
    (r'market|brand|growth|demand|advertis|communicat|\bpr\b', 'Marketing'),
    (r'tech|engineer|\bit\b|software|\bdata\b|\bai\b|\bml\b|cloud|security|cyber|information|developer', 'Technology'),
    (r'talent|recruit|\bhr\b|human resource|people|hiring', 'HR'),
    (r'sales|revenue|business development|\bbd\b', 'Sales'),
    (r'product', 'Product'),
    (r'financ|\bcfo\b|treasur|account', 'Finance'),
    (r'operation|\bcoo\b|supply|logistic', 'Operations'),
    (r'customer|\bcx\b|success|experience', 'Customer'),
    (r'strateg|innovation|transformation|digital', 'Strategy/Digital'),
]
JUNK = re.compile(r'\b(intern|internship|student|trainee|fresher|apprentice|aspiring|seeking|looking for|job ?seeker|unemployed|ex-|former|retired|freelanc)\b', re.I)


def classify(desig, name):
    seniority, score = 'Individual', (30 if desig else 20)
    for pat, lvl, s in SENIORITY:
        if re.search(pat, desig, re.I):
            seniority, score = lvl, s
            break
    dept = 'General'
    for pat, d in DEPARTMENT:
        if re.search(pat, desig, re.I):
            dept = d
            break
    junk = bool(JUNK.search(desig or '')) or bool(JUNK.search(name or ''))
    return seniority, dept, score, junk


# --- scraping ---------------------------------------------------------------

def scrape(queries, pages, headful, log=print, profile_dir=None):
    """Returns {url: {url, title, snippet}} — raw candidates, unclassified.

    In headful mode, uses a persistent browser profile (like the Node app's
    HEADFUL flow) so a CAPTCHA you solve by hand stays solved across runs
    instead of starting from a brand-new, zero-reputation browser every time.
    """
    from playwright.sync_api import sync_playwright  # imported here so --help works without it

    seen = {}
    with sync_playwright() as pw:
        owns_browser = True
        if headful and profile_dir:
            ctx = pw.chromium.launch_persistent_context(
                profile_dir, headless=False,
                args=['--no-sandbox', '--disable-blink-features=AutomationControlled'],
                viewport={'width': 1280, 'height': 900}, user_agent=UA,
            )
            browser = None
            owns_browser = False
            # Drop any tabs Chrome restored from a previous crashed/killed run —
            # they're stale and just clutter the window.
            for p in ctx.pages:
                try:
                    p.close()
                except Exception:
                    pass
        else:
            browser = pw.chromium.launch(headless=not headful, args=['--no-sandbox', '--disable-blink-features=AutomationControlled'])
            ctx = browser.new_context(user_agent=UA, viewport={'width': 1280, 'height': 900})
        ctx.add_cookies([{'name': 'CONSENT', 'value': 'YES+cb', 'domain': '.google.com', 'path': '/'}])
        page = ctx.new_page()
        gave_up_on = set()  # scoped to this one process/run only
        try:
            for qi, q in enumerate(queries, 1):
                log(f"[{qi}/{len(queries)}] {q[:90]}")
                for eng_name, url_of in ENGINES:
                    if eng_name in gave_up_on:
                        continue
                    got = False
                    for p in range(pages):
                        try:
                            page.goto(url_of(q, p), wait_until='domcontentloaded', timeout=25000)
                            page.wait_for_load_state('networkidle', timeout=5000)
                        except Exception:
                            pass
                        try:
                            html = page.content()
                        except Exception as e:
                            log(f"    [{eng_name}] p{p+1}: {str(e)[:60]}")
                            break

                        if looks_like_challenge(html):
                            if headful and wait_for_manual_solve(page):
                                # Solving usually lands on a confirmation page, not
                                # the results — re-run the actual query.
                                try:
                                    page.goto(url_of(q, p), wait_until='domcontentloaded', timeout=25000)
                                    page.wait_for_load_state('networkidle', timeout=5000)
                                    html = page.content()
                                except Exception:
                                    pass
                                if looks_like_challenge(html):
                                    gave_up_on.add(eng_name)
                                    log(f"    [{eng_name}] re-challenged right after being solved — skipping for the rest of this run.")
                                    break
                            else:
                                log(f"    [{eng_name}] CAPTCHA/blocked — skipping.")
                                break

                        try:
                            items = page.evaluate(JS_EXTRACT)
                        except Exception as e:
                            log(f"    [{eng_name}] parse error: {str(e)[:60]}")
                            break

                        # Google's client-rendered JSON payload fallback when the
                        # DOM scan found nothing but the page has real LinkedIn URLs.
                        if not items and 'linkedin.com/in/' in html.lower():
                            items = parse_google_json_results(html)

                        if not items and looks_like_ignored_site_operator(html, q):
                            log(f"    [{eng_name}] ignored the site: filter on this query — skipping.")
                            break

                        added = 0
                        for it in items:
                            if it['url'] not in seen:
                                # 0-based index of the query this candidate came from,
                                # so a caller batching many queries in one process
                                # (e.g. one per company) can re-attach its own tag.
                                seen[it['url']] = {**it, 'query_index': qi - 1}
                                added += 1
                                got = True
                        log(f"    [{eng_name}] p{p+1}: +{added} (total {len(seen)})")
                        if not items and p == 0:
                            break
                        if p > 0 and added == 0:
                            break
                        time.sleep(1.2)
                    if got:
                        break  # one engine per query is enough
        finally:
            if owns_browser:
                browser.close()
            else:
                ctx.close()
    return seen


def build_rows(seen, keep_all):
    rows = []
    for url, it in seen.items():
        name, desig, comp = parse_title(it['title'])
        if not name:
            continue
        seniority, dept, score, junk = classify(desig, name)
        if junk and not keep_all:
            continue
        rows.append({
            'Name': name, 'Designation': desig, 'Seniority': seniority, 'Department': dept,
            'Company': comp, 'LinkedIn URL': url, 'Decision Score': score,
        })
    rows.sort(key=lambda r: -r['Decision Score'])
    return rows


HEADERS = ['Name', 'Designation', 'Seniority', 'Department', 'Company', 'LinkedIn URL', 'Decision Score']


def write_csv(rows, path):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=HEADERS)
        w.writeheader()
        w.writerows(rows)


def write_xlsx(rows, path):
    try:
        from openpyxl import Workbook
    except ImportError:
        print("(!) --xlsx needs openpyxl:  pip install openpyxl  — skipping Excel.")
        return
    wb = Workbook()
    ws = wb.active
    ws.title = 'Leads'
    ws.append(HEADERS)
    for r in rows:
        ws.append([r[h] for h in HEADERS])
    wb.save(path)


def main():
    ap = argparse.ArgumentParser(description='Scrape LinkedIn leads from a Google/Bing search prompt.')
    ap.add_argument('queries', nargs='*', help='One or more search prompts (each scraped & merged).')
    ap.add_argument('--query-file', help='Read the prompt from a file (whole file = one query).')
    ap.add_argument('--pages', type=int, default=2, help='Result pages per engine (1–2 recommended; higher risks CAPTCHA).')
    ap.add_argument('--out', default='leads.csv', help='Output CSV path (default leads.csv). Ignored with --json.')
    ap.add_argument('--xlsx', action='store_true', help='Also write an .xlsx next to the CSV. Ignored with --json.')
    ap.add_argument('--headful', action='store_true', help='Show the browser window (lets you solve a CAPTCHA by hand).')
    ap.add_argument('--profile-dir', default=DEFAULT_PROFILE_DIR,
                     help=f'Persistent browser profile used in --headful mode, so a solved CAPTCHA is '
                          f'remembered across runs (default: {DEFAULT_PROFILE_DIR}).')
    ap.add_argument('--keep-all', action='store_true', help='Keep students/interns/job-seekers too (CSV mode only).')
    ap.add_argument('--json', action='store_true',
                     help='Print raw {url,title,snippet} candidates as JSON to stdout instead of writing a '
                          'classified CSV — used when another program (the Node app) calls this script and '
                          'does its own classification/filtering.')
    args = ap.parse_args()

    queries = list(args.queries)
    if args.query_file:
        with open(args.query_file, encoding='utf-8') as f:
            queries.append(' '.join(f.read().split()))
    if not queries and not sys.stdin.isatty():
        text = sys.stdin.read().strip()
        if text:
            queries = [' '.join(text.split())]
    if not queries:
        ap.error('Provide at least one search prompt (positional, --query-file, or piped via stdin).')

    pages = max(1, min(20, args.pages))
    # In --json mode, progress lines must go to stderr — stdout is reserved for
    # the JSON payload the caller parses.
    log = (lambda *a, **k: print(*a, file=sys.stderr, **k)) if args.json else print
    seen = scrape(queries, pages, args.headful, log=log, profile_dir=args.profile_dir)

    if args.json:
        print(json.dumps(list(seen.values())))
        return

    rows = build_rows(seen, args.keep_all)
    write_csv(rows, args.out)
    if args.xlsx:
        write_xlsx(rows, args.out.rsplit('.', 1)[0] + '.xlsx')

    print(f"\nDone: {len(rows)} lead(s) written to {args.out}"
          + (f" and {args.out.rsplit('.', 1)[0]}.xlsx" if args.xlsx else ""))
    if not rows:
        print("No leads found — the engines likely rate-limited this IP, or every query's results were "
              "filtered out. Wait a few minutes, keep --pages low, and try again.")


if __name__ == '__main__':
    main()
