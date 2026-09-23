/**
 * Injected on demand into whatever event page the user is viewing, to pull out
 * speakers/members. Mirrors the heuristics in server/src/scraper/extractor.js —
 * person-image gating, junk-name filtering, card discovery — but against the
 * live DOM (so JS-rendered pages work without a headless browser).
 *
 * Returns [{ name, designation, company }] via the injected-script return value.
 */
(() => {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  const JUNK_NAMES = new Set([
    'home', 'menu', 'search', 'login', 'log in', 'sign in', 'sign up', 'register',
    'logo', 'back', 'next', 'previous', 'close', 'open', 'toggle', 'image',
    'facebook', 'twitter', 'x', 'linkedin', 'instagram', 'youtube', 'tiktok',
    'whatsapp', 'telegram', 'share', 'download', 'apple', 'google play',
    'read more', 'learn more', 'view all', 'see all', 'all speakers', 'all partners',
    'speakers', 'partners', 'sponsors', 'exhibitors', 'about', 'contact', 'agenda',
    'schedule', 'tickets', 'register now', 'get tickets', 'banner', 'hero',
  ]);
  const LOGO_IMG_RE = /logo|sponsor|partner|brand|emblem|banner|background|\bicon\b|placeholder|favicon/i;
  const PERSON_CTX_RE = /member|speaker|panel|presenter|profile|person|people|\bteam\b|attendee|delegate|guest|author|avatar|headshot|portrait|\bface|crop=faces/i;

  const isJunkName = (text) => {
    const t = clean(text).toLowerCase();
    if (!t) return true;
    if (JUNK_NAMES.has(t)) return true;
    return /\b(icon|button|arrow|chevron|caret|banner|placeholder)\b/.test(t);
  };

  /** A plausible human name: 2–5 capitalized words, no sentence punctuation. */
  const looksLikeName = (text) => {
    const t = clean(text);
    if (!t || t.length > 60 || isJunkName(t)) return false;
    if (/[.!?;:]{1}\s|@|\d{3}/.test(t)) return false;
    const words = t.split(' ').filter(Boolean);
    if (words.length < 2 || words.length > 5) return false;
    return words.filter((w) => /^[A-Z]/.test(w)).length >= 2;
  };

  const isPersonImage = (img, card) => {
    const hay = `${img.getAttribute('alt') || ''} ${img.getAttribute('src') || ''} ${img.className || ''}`;
    if (LOGO_IMG_RE.test(hay)) return false;
    return PERSON_CTX_RE.test(`${hay} ${card?.className || ''}`);
  };

  /** Split "CEO, Acme" / "CEO at Acme" / "CEO (Acme)" into role + company. */
  const splitRoleCompany = (text) => {
    const t = clean(text);
    if (!t) return { designation: '', company: '' };
    let m = t.match(/^(.*?)[\s,]*\(([^()]+)\)\s*$/);
    if (m) return { designation: clean(m[1]), company: clean(m[2]) };
    m = t.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
    if (m) return { designation: clean(m[1]), company: clean(m[2]) };
    const c = t.indexOf(',');
    if (c > 0 && c < t.length - 1) return { designation: clean(t.slice(0, c)), company: clean(t.slice(c + 1)) };
    return { designation: t, company: '' };
  };

  /**
   * Text of the deepest single element under `el` — avoids concatenating a
   * wrapper's children (name + role) into one run-on string.
   */
  const deepestText = (el) => {
    if (!el) return '';
    let node = el;
    while (true) {
      const kids = [...node.children].filter((c) => clean(c.textContent));
      if (kids.length !== 1) break;
      node = kids[0];
    }
    // Still a wrapper with several text-bearing children? Take the first one.
    const kids = [...node.children].filter((c) => clean(c.textContent));
    return clean(kids.length > 1 ? kids[0].textContent : node.textContent);
  };

  // Ignore site chrome so nav/footer links never look like speakers.
  const CHROME = 'script,style,noscript,svg,header,footer,nav,[role="navigation"],[class*="cookie"],[class*="navbar"],[class*="menu"]';
  const inChrome = (el) => Boolean(el.closest(CHROME));

  const out = [];
  const seen = new Set();
  const push = (name, sub) => {
    const n = clean(name);
    if (!looksLikeName(n)) return;
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const { designation, company } = splitRoleCompany(sub);
    out.push({ name: n, designation, company });
  };

  // Strategy 1 — cards built around a person photo (the common speaker-grid layout).
  for (const img of document.querySelectorAll('img')) {
    if (inChrome(img)) continue;
    let card = img.closest('li, article, [class*="card"], [class*="speaker"], [class*="member"], div');
    // When the <img> itself carries the card class, climb to its parent.
    if (card === img) card = img.parentElement;
    if (!card || !isPersonImage(img, card)) continue;
    // Some layouts wrap the photo in its own text-free container (the name and
    // role are siblings further up) — climb until the card actually has text.
    let guard = 0;
    while (card.parentElement && !clean(card.textContent) && guard++ < 4) card = card.parentElement;

    // Prefer a heading inside the card; fall back to the image's alt text.
    // Read the deepest text-bearing element, not a wrapper — a container like
    // <div class="card-title"> often holds BOTH the name and the role, and
    // taking its whole subtree would glue them into one string.
    const heading = card.querySelector('h1,h2,h3,h4,h5,h6,[class*="name"],[class*="title"]');
    const name = clean(deepestText(heading)) || clean(img.getAttribute('alt'));
    if (!name) continue;

    // The line under the name is usually "Role, Company" (or "Role<br>(Company)").
    const texts = [...card.querySelectorAll('p,span,div,small,h6')]
      .filter((el) => !el.querySelector('p,span,div,small,h6')) // leaves only
      .map((el) => clean(el.textContent))
      .filter((t) => t && t !== name && t.length < 120);
    push(name, texts[0] || '');
  }

  // Strategy 2 — no photo cards found: look for heading + subtitle pairs inside
  // any container whose class/id mentions speakers/members.
  if (out.length === 0) {
    const sections = document.querySelectorAll('[class*="speaker"],[class*="member"],[class*="panel"],[id*="speaker"],[id*="member"]');
    for (const section of sections) {
      if (inChrome(section)) continue;
      for (const h of section.querySelectorAll('h1,h2,h3,h4,h5,h6,[class*="name"]')) {
        const name = clean(h.textContent);
        if (!looksLikeName(name)) continue;
        const sib = h.nextElementSibling;
        push(name, sib ? clean(sib.textContent) : '');
      }
    }
  }

  return out;
})();
