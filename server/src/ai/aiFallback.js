import * as cheerio from 'cheerio';
import { clean } from '../normalize/normalize.js';

/**
 * Optional AI fallback. Only invoked when HTML parsing confidence is low AND a
 * key is configured. Normal operation never requires this.
 *
 * Uses the Anthropic Messages API (Claude) if ANTHROPIC_API_KEY is set.
 * Returns { speakers, companies } or null if unavailable/failed.
 */
export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Reduce the page to compact text blocks to keep the prompt small. */
function extractTextBlocks(html, limit = 12000) {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const blocks = [];
  $('body *').each((_, el) => {
    const own = clean($(el).clone().children().remove().end().text());
    if (own && own.length > 1 && own.length < 120) blocks.push(own);
  });
  const text = [...new Set(blocks)].join('\n');
  return text.slice(0, limit);
}

export async function aiExtract(html, logger) {
  if (!aiEnabled()) {
    logger?.warn('AI fallback requested but ANTHROPIC_API_KEY is not set.');
    return null;
  }
  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
  const text = extractTextBlocks(html);
  logger?.info(`AI fallback: sending ${text.length} chars to ${model}.`);

  const prompt = `You are extracting structured data from a conference website's text.
Identify speakers and companies from the text blocks below.
Return ONLY valid minified JSON of the shape:
{"speakers":[{"name":"","designation":"","company":""}],"companies":[{"company":"","category":""}]}
Do not invent entries. If unsure, omit. Text blocks:\n\n${text}`;

  try {
    const { default: axios } = await import('axios');
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 60000,
      }
    );
    const raw = res.data?.content?.[0]?.text || '';
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const speakers = Array.isArray(json.speakers) ? json.speakers.map((s) => ({
      name: clean(s.name), designation: clean(s.designation), company: clean(s.company),
      profileUrl: '', imageUrl: '',
    })) : [];
    const companies = Array.isArray(json.companies) ? json.companies.map((c) => ({
      company: clean(c.company), category: clean(c.category), website: '', logoUrl: '',
    })) : [];
    logger?.success(`AI fallback: parsed ${speakers.length} speakers, ${companies.length} companies.`);
    return { speakers, companies };
  } catch (err) {
    logger?.error(`AI fallback failed: ${err.message}`);
    return null;
  }
}
