import * as cheerio from 'cheerio';
import { clean, absoluteUrl, dedupeMerge, normalizeName, normalizeCompany } from '../normalize/normalize.js';

/**
 * Extract speakers & companies from rendered HTML.
 *
 * Two passes:
 *   1. Selector-driven extraction using the (possibly configured) selectors.
 *   2. Heuristic discovery when selectors yield too little — scans for repeated
 *      card-like structures containing a name + image.
 *
 * Returns { speakers, companies, confidence } where confidence in [0,1] signals
 * how trustworthy the parse is (drives the optional AI fallback).
 */
export function extract(html, baseUrl, selectors, logger, scope) {
  let $ = cheerio.load(html);
  // Optional section scope: restrict extraction to one container (e.g. a single
  // country tab `#Indiamembers`). Lets the caller pull just one group from a page
  // whose tabs are all present in the DOM and toggled client-side.
  if (scope) {
    const $scoped = $(scope);
    if ($scoped.length) {
      $ = cheerio.load($scoped.map((_, el) => $.html(el)).get().join('\n'));
      logger?.info(`Scoped extraction to "${scope}" (${$scoped.length} match(es)).`);
    } else {
      logger?.warn(`Scope "${scope}" matched nothing — extracting the whole page.`);
    }
  }
  // Drop noise that pollutes heuristics. The site's own chrome (top nav, header,
  // footer, cookie bars) is where stray logos like "Home" / the event logo live,
  // so we strip it before discovery to keep partners/speakers clean.
  $('script, style, noscript, svg, header, footer, nav, [role="navigation"], [class*="cookie"], [class*="navbar"], [class*="menu"]').remove();

  let speakers = extractCards($, baseUrl, selectors.speaker, 'speaker', logger);
  let companies = extractCards($, baseUrl, selectors.company, 'company', logger);

  if (speakers.length < 2) {
    logger?.warn('Few speakers via selectors — running heuristic discovery.');
    speakers = mergeLists(speakers, heuristicSpeakers($, baseUrl, logger));
  }
  if (companies.length < 2) {
    logger?.warn('Few companies via selectors — running heuristic discovery.');
    companies = mergeLists(companies, heuristicCompanies($, baseUrl, logger));
  }

  speakers = dedupeMerge(speakers, (s) => normalizeName(s.name) || normalizeKeyish(s.name));
  companies = dedupeMerge(companies, (c) => normalizeCompany(c.company) || normalizeKeyish(c.company));

  speakers = speakers.filter((s) => s.name);
  companies = companies.filter((c) => c.company);

  const confidence = scoreConfidence(speakers, companies);
  return { speakers, companies, confidence };
}

function normalizeKeyish(v) {
  return clean(v).toLowerCase();
}

function firstMatch($, $scope, candidates, attr) {
  for (const sel of candidates) {
    const $el = $scope.find(sel).first();
    if ($el.length) {
      if (attr === 'href') return $el.attr('href');
      if (attr === 'src') return $el.attr('src') || $el.attr('data-src');
      if (attr === 'alt') return $el.attr('alt');
      const text = clean($el.text());
      if (text) return text;
    }
  }
  return '';
}

function extractCards($, baseUrl, sel, kind, logger) {
  const seen = new Set();
  let $cards = $();
  for (const cardSel of sel.card) {
    const $found = $(cardSel);
    if ($found.length) {
      $found.each((_, el) => {
        if (!seen.has(el)) {
          seen.add(el);
          $cards = $cards.add(el);
        }
      });
    }
  }
  if (!$cards.length) return [];
  logger?.info(`Selector pass: ${$cards.length} candidate ${kind} card(s).`);

  const out = [];
  $cards.each((_, el) => {
    const $c = $(el);
    if (kind === 'speaker') {
      const rec = {
        name: firstMatch($, $c, sel.name) || (looksLikeName(clean($c.find('img').first().attr('alt'))) ? clean($c.find('img').first().attr('alt')) : ''),
        designation: firstMatch($, $c, sel.designation),
        company: firstMatch($, $c, sel.company),
        profileUrl: absoluteUrl(firstMatch($, $c, sel.profileUrl, 'href'), baseUrl),
        imageUrl: absoluteUrl(firstMatch($, $c, sel.imageUrl, 'src'), baseUrl),
      };
      // Fallback when the role/company live in a generic, unclassed element (e.g.
      // a bare <span> "Group CHRO, Interglobe Aviation"): take the card's text
      // lines other than the name. splitDesignationCompany (in scraper.js) later
      // separates "Role, Company" / "Role (Company)" into the two fields.
      if (rec.name && !rec.designation) {
        const key = normalizeKeyish(rec.name);
        const lines = textLines($, $c).filter((t) => normalizeKeyish(t) !== key);
        rec.designation = lines[0] || '';
        if (!rec.company) rec.company = guessCompany(lines) || '';
      }
      if (rec.name) out.push(rec);
    } else {
      let name = firstMatch($, $c, sel.name);
      if (!name) name = firstMatch($, $c, sel.name, 'alt');
      const rec = {
        company: name,
        category: firstMatch($, $c, sel.category),
        website: absoluteUrl(firstMatch($, $c, sel.website, 'href'), baseUrl),
        logoUrl: absoluteUrl(firstMatch($, $c, sel.logoUrl, 'src'), baseUrl),
      };
      if (rec.company) out.push(rec);
    }
  });
  return out;
}

/**
 * Heuristic speaker discovery: find images whose surrounding block has a short
 * "name-like" heading and optional secondary line (designation/company).
 */
function heuristicSpeakers($, baseUrl, logger) {
  const out = [];
  const blocks = collectCardBlocks($);
  for (const el of blocks) {
    const $c = $(el);
    const img = $c.find('img').first();
    // Name resolution, most-reliable source first:
    //   1. The photo's alt text — card grids commonly keep the speaker/member
    //      name only in `img[alt]` (talameet, websummit), with no heading at all.
    //      Trusted unless the image is clearly a logo/banner/icon.
    //   2. A heading / name element inside the card (improved to read the
    //      deepest text leaf so "Name + Role" blobs don't pollute the name).
    let name = '';
    const alt = clean(img.attr('alt')).replace(/\s*(?:photo|headshot|portrait|avatar|profile|picture)\s*$/i, '');
    if (looksLikeName(alt) && !isJunkName(alt) && isPersonContext($, $c, img)) {
      name = alt;
    }
    if (!name) {
      const heading = pickHeading($, $c);
      if (looksLikeName(heading) && !isJunkName(heading)) name = heading;
    }
    if (!name) continue;
    const lines = textLines($, $c).filter((t) => t !== name);
    const designation = lines[0] || '';
    const company = guessCompany(lines) || '';
    const link = $c.find('a').first();
    out.push({
      name,
      designation: clean(designation),
      company: clean(company),
      profileUrl: absoluteUrl(link.attr('href'), baseUrl),
      imageUrl: absoluteUrl(img.attr('src') || img.attr('data-src'), baseUrl),
    });
  }
  logger?.info(`Heuristic pass: ${out.length} speaker candidate(s).`);
  return out;
}

// Section headings that label a group of company logos (sponsorship tiers etc).
const CATEGORY_RE = /partner|sponsor|investor|exhibitor|ecosystem|associate|presenting|powered by|banking|incubator|accelerator|supporter|host|organiser|organizer/i;

/**
 * Heuristic company discovery: logo images with alt text / nearby brand text.
 * Walks the document in order so each logo inherits the most recent section
 * heading (e.g. "Diamond Partners", "Investors") as its category.
 */
function heuristicCompanies($, baseUrl, logger) {
  const out = [];
  let category = '';
  // Headings + images together, in document order.
  $('h1, h2, h3, h4, img').each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag !== 'img') {
      const heading = clean($(el).text());
      if (heading && heading.length <= 50 && CATEGORY_RE.test(heading)) category = heading;
      return;
    }
    const $img = $(el);
    const alt = clean($img.attr('alt'));
    const src = $img.attr('src') || $img.attr('data-src') || '';
    const looksLikeLogo =
      /logo|sponsor|partner|exhibitor|brand|company/i.test(`${alt} ${src} ${$img.attr('class') || ''}`);
    if (!looksLikeLogo || !alt) return;
    const name = alt.replace(/\s*logo\s*$/i, '').trim();
    if (!name || name.length > 60 || isJunkName(name)) return;
    const $a = $img.closest('a');
    out.push({
      company: name,
      category,
      website: absoluteUrl($a.attr('href'), baseUrl),
      logoUrl: absoluteUrl(src, baseUrl),
    });
  });
  logger?.info(`Heuristic pass: ${out.length} company candidate(s).`);
  return out;
}

/** Repeated sibling blocks that contain an image and a little text = card grid. */
function collectCardBlocks($) {
  const candidates = [];
  $('img').each((_, img) => {
    let $card = $(img).closest('li, article, .card, [class*="card"], div');
    // The image itself can match (e.g. `class="card-img-top"`); in that case the
    // real card is its parent, which actually holds the name/role text.
    if ($card.get(0) === img) $card = $(img).parent();
    const el = $card.get(0);
    if (el && el.tagName?.toLowerCase() !== 'img') candidates.push(el);
  });
  return [...new Set(candidates)];
}

function pickHeading($, $c) {
  for (const sel of ['h2', 'h3', 'h4', 'h5', '[class*="name"]', 'strong', 'b', 'a']) {
    const $el = $c.find(sel).first();
    if (!$el.length) continue;
    // Read the deepest text leaf, not the concatenated subtree — a name wrapper
    // like `.memberName > .lheignt(name) + .badge(role)` should yield just the
    // name, not "Name Role Company" mashed together.
    const own = clean($el.clone().children().remove().end().text());
    const t = own || clean($el.text());
    if (t) return t;
  }
  return '';
}

function textLines($, $c) {
  const text = clean($c.text());
  if (!text) return [];
  // Split on the heading boundaries by re-walking child text nodes.
  const parts = [];
  $c.find('*').each((_, el) => {
    const own = clean($(el).clone().children().remove().end().text());
    if (own && own.length < 80) parts.push(own);
  });
  return [...new Set(parts)];
}

function guessCompany(lines) {
  // The line most likely to be a company often follows the designation and may
  // contain "at"/"@" or capitalized brand words.
  for (const l of lines) {
    const m = l.match(/\b(?:at|@)\s+(.+)$/i);
    if (m) return m[1];
  }
  return lines[1] || '';
}

// Generic site-chrome / UI words that masquerade as a name or brand in alt text
// or headings (the site's own logo, nav items, social icons, CTA buttons).
const JUNK_NAMES = new Set([
  'home', 'menu', 'search', 'login', 'log in', 'sign in', 'sign up', 'register',
  'logo', 'back', 'next', 'previous', 'close', 'open', 'toggle', 'image',
  'facebook', 'twitter', 'x', 'linkedin', 'instagram', 'youtube', 'tiktok',
  'whatsapp', 'telegram', 'share', 'download', 'apple', 'google play',
  'read more', 'learn more', 'view all', 'see all', 'all speakers', 'all partners',
  'speakers', 'partners', 'sponsors', 'exhibitors', 'about', 'contact', 'agenda',
  'schedule', 'tickets', 'register now', 'get tickets', 'banner', 'hero',
]);

// Gate for the "read the name from img[alt]" path so partner logos / decorative
// graphics aren't mistaken for speakers. We accept an alt as a person's name
// only when the image (or its surrounding card) looks person-ish AND is not a
// logo/banner/icon. Signals are checked across the image's alt/src/class and the
// enclosing card's class, so e.g. talameet's `.memberCard`, websummit's
// `/avatars/…?crop=faces`, and generic `speaker`/`team`/`profile` cards qualify
// while sponsor logos and social-feed thumbnails do not.
const LOGO_IMG_RE = /logo|sponsor|partner|brand|emblem|banner|background|\bicon\b|placeholder|favicon/i;
const PERSON_CTX_RE = /member|speaker|panel|presenter|profile|person|people|\bteam\b|attendee|delegate|guest|author|avatar|headshot|portrait|\bface|crop=faces/i;

function isPersonContext($, $c, img) {
  const $img = $(img);
  const imgHay = `${$img.attr('alt') || ''} ${$img.attr('src') || ''} ${$img.attr('data-src') || ''} ${$img.attr('class') || ''}`;
  if (LOGO_IMG_RE.test(imgHay)) return false;
  return PERSON_CTX_RE.test(`${imgHay} ${$c.attr('class') || ''}`);
}

function isJunkName(text) {
  const t = clean(text).toLowerCase();
  if (!t) return true;
  if (JUNK_NAMES.has(t)) return true;
  // Pure social/nav icon alts like "facebook icon", "menu button".
  if (/\b(icon|button|arrow|chevron|caret|banner|placeholder)\b/.test(t)) return true;
  return false;
}

function looksLikeName(text) {
  if (!text) return false;
  const t = clean(text);
  if (t.length < 3 || t.length > 50) return false;
  const words = t.split(' ');
  if (words.length < 2 || words.length > 5) return false;
  if (/[0-9@]/.test(t)) return false;
  // Mostly capitalized words.
  const capish = words.filter((w) => /^[A-Z]/.test(w)).length;
  return capish >= Math.ceil(words.length / 2);
}

function mergeLists(a, b) {
  return [...a, ...b];
}

function scoreConfidence(speakers, companies) {
  let score = 0;
  if (speakers.length >= 3) score += 0.4;
  else if (speakers.length >= 1) score += 0.2;
  if (companies.length >= 3) score += 0.3;
  else if (companies.length >= 1) score += 0.15;
  // Field richness bonus.
  const richSpeakers = speakers.filter((s) => s.designation || s.company).length;
  if (speakers.length && richSpeakers / speakers.length > 0.5) score += 0.3;
  return Math.min(1, Number(score.toFixed(2)));
}
