/**
 * The SSRF guard — boundary ⑤ in docs/14-threat-model.md §2, §5.
 *
 * prisme reads an entire personal workspace out of two external tools, and that
 * content carries arbitrary URLs pasted from the open web. The moment any of
 * them is fetched, the process's network position becomes the attacker's: it
 * sits inside a cluster, beside a PostgreSQL instance, holding read/write
 * tokens to the workspace it just read the URL out of.
 *
 * `packages/connectors` states the first half of the answer — a URL found in
 * content is *collected, never fetched*, and its `isFetchAllowed` denies
 * everything. This is the second half: for the few URLs prisme does fetch, an
 * **explicit allow-list of origins**, and a refusal of the shapes that make a
 * URL interesting to an attacker in the first place.
 *
 * ### Why an origin allow-list rather than a blocked-address list
 *
 * A blocked list of private ranges is the intuitive design and it loses. There
 * is always another encoding (`0177.0.0.1`, `[::ffff:127.0.0.1]`, a decimal
 * integer host), always another metadata endpoint, and always a DNS name that
 * resolves to a private address at the moment the request is made rather than
 * at the moment it is checked. An allow-list of exact origins does not care:
 * a host that is not on the list is refused whatever it resolves to.
 *
 * The literal-address checks below are therefore **defence in depth, not the
 * control**. They exist because a misconfigured allow-list is possible, and a
 * loopback entry in one should be visible rather than quietly effective.
 */

export class UrlRejected extends Error {
  readonly reason: 'malformed' | 'scheme' | 'userinfo' | 'literal_address' | 'not_allowed';

  constructor(reason: UrlRejected['reason'], message: string) {
    super(message);
    this.name = 'UrlRejected';
    this.reason = reason;
  }
}

export interface UrlGuardOptions {
  /**
   * Exact origins, `https://host[:port]`. Deny by default: an empty list
   * refuses everything, which is the correct reading of "nothing is allowed
   * yet" and the opposite of what an empty *deny* list would mean.
   */
  readonly allowedOrigins: readonly string[];
}

/** Dotted-quad, decimal, octal or hexadecimal — every spelling of an IPv4 host. */
function ipv4Of(host: string): readonly number[] | undefined {
  const parts = host.split('.');
  if (parts.length > 4 || parts.some((part) => part === '')) return undefined;

  const numbers: number[] = [];
  for (const part of parts) {
    let value: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) value = Number.parseInt(part.slice(2), 16);
    else if (/^0[0-7]+$/.test(part)) value = Number.parseInt(part.slice(1), 8);
    else if (/^\d+$/.test(part)) value = Number.parseInt(part, 10);
    else return undefined;
    if (!Number.isSafeInteger(value) || value < 0) return undefined;
    numbers.push(value);
  }

  // `127.1` and `2130706433` are both loopback. Expand to four octets the way
  // inet_aton does, because that is what the resolver will do.
  const last = numbers.pop() as number;
  const octets = [...numbers];
  const span = 4 - octets.length;
  if (last >= 2 ** (8 * span)) return undefined;
  for (let index = span - 1; index >= 0; index -= 1) {
    octets.push((last >>> (8 * index)) & 0xff);
  }
  return octets.every((octet) => octet <= 0xff) ? octets : undefined;
}

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, and the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const inner = host.replace(/^\[|]$/g, '').toLowerCase();
  if (inner === '::1' || inner === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(inner)) return true; // unique-local
  if (inner.startsWith('fe80:')) return true; // link-local
  // `::ffff:127.0.0.1` — an IPv4 address wearing an IPv6 hat.
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(inner);
  if (dotted) {
    const octets = ipv4Of(dotted[1] as string);
    return octets === undefined || isPrivateIpv4(octets);
  }
  // …and the same address after `new URL` has normalised it, which it does:
  // `[::ffff:127.0.0.1]` comes back out of `url.hostname` as `[::ffff:7f00:1]`.
  // Checking only the dotted spelling would have left the one form the guard
  // actually receives unmatched — found by a test, not by reading.
  const hextet = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(inner);
  if (hextet) {
    const high = Number.parseInt(hextet[1] as string, 16);
    const low = Number.parseInt(hextet[2] as string, 16);
    return isPrivateIpv4([high >>> 8, high & 0xff, low >>> 8, low & 0xff]);
  }
  return false;
}

/**
 * Parse and check one URL, or throw.
 *
 * Returns the parsed `URL` so the caller fetches **the checked object** rather
 * than re-parsing the string. Re-parsing is how a check and a fetch end up
 * disagreeing about what the URL was.
 */
export function assertUrlAllowed(raw: string, options: UrlGuardOptions): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlRejected('malformed', 'not an absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlRejected('scheme', `the ${url.protocol} scheme is never fetched`);
  }
  if (url.username !== '' || url.password !== '') {
    // Credentials in a URL are both a leak into every log and a classic way to
    // make a host look like something it is not: `https://allowed.example@evil`.
    throw new UrlRejected('userinfo', 'a URL carrying credentials is refused');
  }

  const host = url.hostname;
  const octets = ipv4Of(host);
  if ((octets !== undefined && isPrivateIpv4(octets)) || isPrivateIpv6(host)) {
    throw new UrlRejected('literal_address', 'a private or loopback address is refused');
  }

  if (!options.allowedOrigins.includes(url.origin)) {
    throw new UrlRejected('not_allowed', 'the origin is not on the allow-list');
  }

  return url;
}

export function isUrlAllowed(raw: string, options: UrlGuardOptions): boolean {
  try {
    assertUrlAllowed(raw, options);
    return true;
  } catch {
    return false;
  }
}
