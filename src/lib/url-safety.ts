/**
 * URL Safety and Canonicalization Utility
 */

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
  'fbclid',
  'gclid',
  '_hsenc',
  '_hsmi',
  'mc_cid',
  'mc_eid',
  'msclkid',
]);

/**
 * Checks whether an IPv4 string is in a private or loopback range.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(isNaN)) return false;

  // 127.0.0.0/8 (Loopback)
  if (parts[0] === 127) return true;
  // 10.0.0.0/8 (Private)
  if (parts[0] === 10) return true;
  // 172.16.0.0/12 (Private)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 169.254.0.0/16 (Link-local)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0
  if (parts[0] === 0) return true;

  return false;
}

/**
 * Checks whether an IPv6 string is private, loopback, or link-local.
 */
function isPrivateIPv6(ip: string): boolean {
  const clean = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (clean === '::1' || clean === '::') return true;
  if (clean.startsWith('fe80:')) return true; // Link-local
  if (clean.startsWith('fc00:') || clean.startsWith('fd00:')) return true; // Unique local
  return false;
}

export interface UrlSafetyOptions {
  allowedDomains?: string[];
}

/**
 * Validates that a URL is safe to retrieve:
 * - Only http and https
 * - Rejects localhost, .local, .internal
 * - Rejects private IPv4, loopback, and private IPv6
 * - Matches allowedDomains if provided
 */
export function isSafeUrl(rawUrl: string, options: UrlSafetyOptions = {}): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;

  try {
    const url = new URL(rawUrl);

    // Only http and https
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }

    const hostname = url.hostname.toLowerCase();

    // Check hostnames
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname === '0.0.0.0'
    ) {
      return false;
    }

    // Check IPv4
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      if (isPrivateIPv4(hostname)) {
        return false;
      }
    }

    // Check IPv6
    if (hostname.includes(':')) {
      if (isPrivateIPv6(hostname)) {
        return false;
      }
    }

    // Optional allowed domains check
    if (options.allowedDomains && options.allowedDomains.length > 0) {
      const allowed = options.allowedDomains.some((d) => {
        const domain = d.toLowerCase();
        return hostname === domain || hostname.endsWith('.' + domain);
      });
      if (!allowed) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Canonicalizes a URL by removing hash fragments, common tracking parameters,
 * and normalizing trailing slashes for standard root/directories.
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);

    // Remove hash fragment
    url.hash = '';

    // Remove tracking search params
    const keysToDelete: string[] = [];
    url.searchParams.forEach((_, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    });
    for (const key of keysToDelete) {
      url.searchParams.delete(key);
    }

    // Sort search params for canonical ordering
    url.searchParams.sort();

    // Remove default ports
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = '';
    }

    let result = url.toString();
    // Strip trailing slash if path is just '/' and no search query
    if (url.pathname === '/' && !url.search && result.endsWith('/')) {
      result = result.slice(0, -1);
    }

    return result;
  } catch {
    return rawUrl;
  }
}

/**
 * Calculates a source ranking score based on publisher domain characteristics:
 *   first-party: 0.95
 *   uploaded: 0.9
 *   gov/edu: 0.85
 *   news: 0.7
 *   business directory: 0.6
 *   generic: 0.5
 *   jobs: 0.25
 *   social: 0.2
 */
export function calculateSourceScore(url: string, targetDomain?: string): number {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (targetDomain) {
      const cleanTarget = targetDomain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
      if (cleanTarget && (host === cleanTarget || host.endsWith('.' + cleanTarget))) {
        return 0.95; // first-party
      }
    }

    if (host.endsWith('.gov') || host.endsWith('.edu') || host.endsWith('.mil') || host.includes('.ac.')) {
      return 0.85;
    }

    // Social networks
    const socialDomains = ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'reddit.com', 'tiktok.com', 'threads.net'];
    if (socialDomains.some((d) => host === d || host.endsWith('.' + d))) {
      return 0.2;
    }

    // Job boards
    const jobDomains = ['greenhouse.io', 'lever.co', 'workday.com', 'linkedin.com/jobs', 'indeed.com', 'glassdoor.com'];
    if (jobDomains.some((d) => host === d || host.endsWith('.' + d) || url.toLowerCase().includes(d))) {
      return 0.25;
    }

    // Business directories / registries
    const dirDomains = ['crunchbase.com', 'pitchbook.com', 'bloomberg.com/profile', 'sec.gov', 'opencorporates.com', 'dnb.com'];
    if (dirDomains.some((d) => host === d || host.endsWith('.' + d))) {
      return 0.6;
    }

    // Prominent news organizations
    const newsKeywords = ['reuters.com', 'apnews.com', 'bloomberg.com', 'wsj.com', 'ft.com', 'nytimes.com', 'bbc.com', 'forbes.com', 'techcrunch.com', 'theverge.com', 'cnbc.com'];
    if (newsKeywords.some((d) => host === d || host.endsWith('.' + d))) {
      return 0.7;
    }

    return 0.5; // generic
  } catch {
    return 0.5;
  }
}

