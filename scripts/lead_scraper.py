#!/usr/bin/env python3
"""
lead_scraper.py — scrape LinkedIn leads from a Google (or Bing/Brave) search prompt.

Give it the exact search prompt you'd paste into Google (a LinkedIn X-ray query),
and it drives a real headless browser to collect the matching linkedin.com/in
profiles, parses Name / Designation / Company, scores each lead by seniority,
removes duplicates, and writes a CSV (and optional Excel).

WHY A REAL BROWSER: plain HTTP requests to Google get blocked instantly. Playwright
(a real Chromium) passes most of that — best from a normal/residential IP. Google
still CAPTCHAs after aggressive use, so keep --pages low (1–2) and don't hammer it.

SETUP (one time):
    pip install playwright
    playwright install chromium
    # optional, for --xlsx output:  pip install openpyxl

USAGE:
    # one prompt
    python lead_scraper.py 'site:linkedin.com/in ("CTO" OR "CIO") ("Gurgaon" OR "Noida")'

    # several prompts (each scraped, all merged & deduped)
    python lead_scraper.py "query one" "query two" --pages 2 --out leads.csv

    # read a multi-line prompt from a file
    python lead_scraper.py --query-file prompt.txt --xlsx

    # watch it work (non-headless) and keep every lead (no junk filtering)
    python lead_scraper.py "..." --headful --keep-all
"""

import argparse
import csv
import re
import sys
import time
import urllib.parse

# --- config ---------------------------------------------------------------

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# Paginated engine URLs. Google first — it's the only one that does
# `site:linkedin.com/in` X-ray searches well.
ENGINES = [
    ("Google", lambda q, p: f"https://www.google.com/search?q={urllib.parse.quote(q)}&num=20&start={p*10}&hl=en"),
    ("Brave",  lambda q, p: f"https://search.brave.com/search?q={urllib.parse.quote(q)}&offset={p}"),
    ("Bing",   lambda q, p: f"https://www.bing.com/search?q={urllib.parse.quote(q)}&first={p*10+1}"),
]

# JS run inside the results page: collect {url, title} for every linkedin.com/in
# link, decoding Google's /url?q= and Bing/Ecosia's base64 redirect wrappers.
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
    seen.add(url);
    const card = a.closest('div.g, div.tF2Cxc, div.MjjYud, li.b_algo, .snippet, article, .result');
    let title = '';
    if (card) { const h = card.querySelector('h3, h2, [role=heading]'); if (h) title = h.textContent.trim(); }
    if (!title) title = (a.textContent || '').trim();
    out.push({ url, title });
  });
  return out;
}
"""

# --- parsing & classification (mirrors the Node app) ----------------------

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


# --- scraping -------------------------------------------------------------

def scrape(queries, pages, headful):
    from playwright.sync_api import sync_playwright  # imported here so --help works without it

    seen = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not headful, args=['--no-sandbox', '--disable-blink-features=AutomationControlled'])
        ctx = browser.new_context(user_agent=UA, viewport={'width': 1280, 'height': 900})
        ctx.add_cookies([{'name': 'CONSENT', 'value': 'YES+cb', 'domain': '.google.com', 'path': '/'}])
        page = ctx.new_page()
        try:
            for qi, q in enumerate(queries, 1):
                print(f"[{qi}/{len(queries)}] {q[:90]}")
                for eng_name, url_of in ENGINES:
                    got = False
                    for p in range(pages):
                        try:
                            page.goto(url_of(q, p), wait_until='domcontentloaded', timeout=25000)
                            page.wait_for_timeout(1500)
                            html = page.content()
                        except Exception as e:
                            print(f"    [{eng_name}] p{p+1}: {str(e)[:60]}")
                            break
                        if eng_name == 'Google' and len(html) < 15000 and 'linkedin.com/in' not in html:
                            print(f"    [{eng_name}] CAPTCHA/blocked — skipping (wait a few minutes, lower --pages)")
                            break
                        try:
                            items = page.evaluate(JS_EXTRACT)
                        except Exception as e:
                            print(f"    [{eng_name}] parse error: {str(e)[:60]}")
                            break
                        added = 0
                        for it in items:
                            if it['url'] not in seen:
                                seen[it['url']] = it
                                added += 1
                                got = True
                        print(f"    [{eng_name}] p{p+1}: +{added} (total {len(seen)})")
                        if not items and p == 0:
                            break
                        if p > 0 and added == 0:
                            break
                        time.sleep(1.2)
                    if got:
                        break  # one engine per query is enough
        finally:
            browser.close()
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
    ap = argparse.ArgumentParser(description='Scrape LinkedIn leads from a Google search prompt.')
    ap.add_argument('queries', nargs='*', help='One or more search prompts (each scraped & merged).')
    ap.add_argument('--query-file', help='Read the prompt from a file (whole file = one query).')
    ap.add_argument('--pages', type=int, default=2, help='Result pages per engine (1–2 recommended; higher risks CAPTCHA).')
    ap.add_argument('--out', default='leads.csv', help='Output CSV path (default leads.csv).')
    ap.add_argument('--xlsx', action='store_true', help='Also write an .xlsx next to the CSV.')
    ap.add_argument('--headful', action='store_true', help='Show the browser window.')
    ap.add_argument('--keep-all', action='store_true', help='Keep students/interns/job-seekers too.')
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

    pages = max(1, min(3, args.pages))
    seen = scrape(queries, pages, args.headful)
    rows = build_rows(seen, args.keep_all)

    write_csv(rows, args.out)
    if args.xlsx:
        write_xlsx(rows, args.out.rsplit('.', 1)[0] + '.xlsx')

    print(f"\nDone: {len(rows)} lead(s) written to {args.out}"
          + (f" and {args.out.rsplit('.', 1)[0]}.xlsx" if args.xlsx else ""))
    if not rows:
        print("No leads found — the engines likely rate-limited this IP. Wait a few minutes, "
              "keep --pages at 1–2, and try again (residential IPs recover fastest).")


if __name__ == '__main__':
    main()
