import { AMAZON_HOSTS, EBAY_HOSTS, ETSY_HOSTS, parse } from './url.js';

/**
 * Which query parameters `cleanLink` removes on a host (D118). The rule is **when in doubt, keep
 * it**: a name is listed only when it is shown to be tracking, a campaign or an affiliate tag, never
 * because it looks like one. ClearURLs' rules (github.com/ClearURLs/Rules) were a reference for which
 * names to check; nothing of theirs is copied. Names are matched case-insensitively.
 */
interface Rules {
  readonly names: readonly string[];
  readonly prefixes: readonly string[];
}

/** Ad-click IDs, analytics campaign tags and email-campaign IDs, on any host. */
const GLOBAL: Rules = {
  names: [
    'fbclid', // Meta ad and link click
    'gclid', // Google Ads click
    'gbraid', // Google Ads click (iOS app)
    'wbraid', // Google Ads click (iOS web)
    'dclid', // Google Display & Video click
    'msclkid', // Microsoft Ads click
    'yclid', // Yandex Direct click
    'twclid', // X (Twitter) ad click
    'ttclid', // TikTok ad click
    'li_fat_id', // LinkedIn ad click
    'mc_cid', // Mailchimp campaign
    'mc_eid', // Mailchimp subscriber
    '_hsenc', // HubSpot email
    '_hsmi', // HubSpot email
    'mkt_tok', // Marketo email
    'igshid', // Instagram share
    'igsh', // Instagram share
    '_ga', // Google Analytics cross-domain linker
    '_gl', // Google Analytics cross-domain linker
  ],
  prefixes: ['utm_'], // Google Analytics campaign tags
};

/** `si` names who shared a link on YouTube and Spotify; elsewhere it may mean something else. */
const SHARE_ID_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'open.spotify.com',
]);
const SHARE_ID: Rules = { names: ['si'], prefixes: [] };

/**
 * Amazon's search, placement and affiliate tags. Kept on purpose: `th` and `psc` (the chosen
 * variant), `smid` (the seller whose offer was chosen) and `keywords`, which on a search link
 * (`/s`, `/gp/search`) is the search itself.
 */
const AMAZON: Rules = {
  names: [
    'ref',
    'ref_',
    'tag', // Associates (affiliate) ID
    'ascsubtag', // Associates sub-tag
    'linkcode',
    'linkid',
    'creative',
    'creativeasin',
    'camp',
    'content-id',
    'qid', // search query time
    'sr', // search result position
    'sprefix', // search box prefix
    'crid', // search session
    'dib', // search session blob
    'dib_tag',
    'social_share',
    'starsleft',
    'spia', // sponsored placement
    'sp_csd', // sponsored placement
  ],
  prefixes: ['pd_rd_', 'pf_rd_'], // placement and page-widget tracking
};
/** Amazon's `/ref=…` path segment: where on Amazon the link was clicked. */
const AMAZON_REF_SEGMENT = /\/ref=[^/?#]*/g;

/** eBay's click tracking and Partner Network (affiliate) tags. Kept on purpose: `var` and `hash`. */
const EBAY: Rules = {
  names: [
    '_trkparms',
    '_trksid',
    '_from',
    'mkevt',
    'mkcid',
    'mkrid',
    'campid',
    'toolid',
    'customid',
  ],
  prefixes: [],
};

/** Etsy's click and search tracking. Kept on purpose: `variation0`, `variation1` and the rest. */
const ETSY: Rules = {
  names: [
    'click_key',
    'click_sum',
    'organic_search_click',
    'ref',
    'pro',
    'frs',
    'sts',
    'sr_prefetch',
    'pf_from',
  ],
  prefixes: ['ga_'], // search filters and ordering from the results page
};

function rulesFor(hostname: string): Rules[] {
  const rules = [GLOBAL];
  if (SHARE_ID_HOSTS.has(hostname)) rules.push(SHARE_ID);
  if (AMAZON_HOSTS.has(hostname)) rules.push(AMAZON);
  if (EBAY_HOSTS.has(hostname)) rules.push(EBAY);
  if (ETSY_HOSTS.has(hostname)) rules.push(ETSY);
  return rules;
}

/** A query segment's name, decoded and lowercased; null when it can't be decoded. */
function nameOf(segment: string): string | null {
  const raw = segment.split('=', 1)[0] ?? '';
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' ')).toLowerCase();
  } catch {
    return null;
  }
}

function isTracking(segment: string, rules: readonly Rules[]): boolean {
  const name = nameOf(segment);
  if (!name) return false;
  return rules.some(
    (r) => r.names.includes(name) || r.prefixes.some((prefix) => name.startsWith(prefix)),
  );
}

/**
 * A pasted link without its known tracking, campaign and affiliate parameters (D118). The link is
 * edited as text, never rebuilt from a parsed URL, so case, encoding, `+`, ports and trailing slashes
 * stay as pasted; a link with nothing to remove comes back unchanged. The fragment is never touched.
 * Anything that isn't an http(s) link comes back as given. Never throws.
 */
export function cleanLink(url: string): string {
  const parsed = parse(url);
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return url;
  const hash = url.indexOf('#');
  const fragment = hash === -1 ? '' : url.slice(hash);
  const beforeFragment = hash === -1 ? url : url.slice(0, hash);
  const mark = beforeFragment.indexOf('?');
  let path = mark === -1 ? beforeFragment : beforeFragment.slice(0, mark);
  const query = mark === -1 ? null : beforeFragment.slice(mark + 1);

  const hostname = parsed.hostname.toLowerCase();
  if (AMAZON_HOSTS.has(hostname)) path = path.replace(AMAZON_REF_SEGMENT, '');

  const rules = rulesFor(hostname);
  const segments = query === null ? [] : query.split('&');
  const kept = segments.filter((segment) => !isTracking(segment, rules));
  if (kept.length === segments.length) {
    // No parameter removed: keep the query exactly, `?` and all.
    const pathChanged = path.length !== (mark === -1 ? beforeFragment.length : mark);
    return pathChanged ? `${path}${mark === -1 ? '' : beforeFragment.slice(mark)}${fragment}` : url;
  }
  return `${path}${kept.length ? `?${kept.join('&')}` : ''}${fragment}`;
}
