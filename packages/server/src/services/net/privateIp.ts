import net from "node:net";

/**
 * Global-unicast IP classification for SSRF defenses.
 * Only globally routable unicast addresses are allowed.
 */

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => {
    if (!/^\d+$/.test(p)) return NaN;
    const n = Number(p);
    return n >= 0 && n <= 255 ? n : NaN;
  });
  if (octets.some((n) => !Number.isFinite(n))) return null;
  return octets as [number, number, number, number];
}

function ipv4ToInt(octets: [number, number, number, number]): number {
  return (
    ((octets[0] << 24) >>> 0) +
    ((octets[1] << 16) >>> 0) +
    ((octets[2] << 8) >>> 0) +
    (octets[3] >>> 0)
  );
}

function inIpv4Cidr(
  ip: number,
  base: [number, number, number, number],
  prefixLen: number,
): boolean {
  const baseInt = ipv4ToInt(base);
  const mask =
    prefixLen === 0 ? 0 : ((0xffffffff << (32 - prefixLen)) >>> 0);
  return (ip & mask) === (baseInt & mask);
}

function isGlobalUnicastIpv4(octets: [number, number, number, number]): boolean {
  const ip = ipv4ToInt(octets);
  // 0.0.0.0/8 unspecified
  if (inIpv4Cidr(ip, [0, 0, 0, 0], 8)) return false;
  // 127.0.0.0/8 loopback
  if (inIpv4Cidr(ip, [127, 0, 0, 0], 8)) return false;
  // 10.0.0.0/8
  if (inIpv4Cidr(ip, [10, 0, 0, 0], 8)) return false;
  // 172.16.0.0/12
  if (inIpv4Cidr(ip, [172, 16, 0, 0], 12)) return false;
  // 192.168.0.0/16
  if (inIpv4Cidr(ip, [192, 168, 0, 0], 16)) return false;
  // 169.254.0.0/16 link-local
  if (inIpv4Cidr(ip, [169, 254, 0, 0], 16)) return false;
  // 100.64.0.0/10 CGNAT
  if (inIpv4Cidr(ip, [100, 64, 0, 0], 10)) return false;
  // 192.0.0.0/24 IETF protocol assignments
  if (inIpv4Cidr(ip, [192, 0, 0, 0], 24)) return false;
  // 192.0.2.0/24 TEST-NET-1
  if (inIpv4Cidr(ip, [192, 0, 2, 0], 24)) return false;
  // 198.51.100.0/24 TEST-NET-2
  if (inIpv4Cidr(ip, [198, 51, 100, 0], 24)) return false;
  // 203.0.113.0/24 TEST-NET-3
  if (inIpv4Cidr(ip, [203, 0, 113, 0], 24)) return false;
  // 198.18.0.0/15 benchmark
  if (inIpv4Cidr(ip, [198, 18, 0, 0], 15)) return false;
  // 224.0.0.0/4 multicast
  if (inIpv4Cidr(ip, [224, 0, 0, 0], 4)) return false;
  // 240.0.0.0/4 reserved
  if (inIpv4Cidr(ip, [240, 0, 0, 0], 4)) return false;
  return true;
}

/** Expand IPv6 textual form to 8 hextets (0–65535). */
function parseIpv6Hextets(ip: string): number[] | null {
  const lower = ip.toLowerCase();
  if (lower.includes(".")) {
    return null;
  }

  const sides = lower.split("::");
  if (sides.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const parts = side.split(":");
    const out: number[] = [];
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };

  if (sides.length === 1) {
    const hextets = parseSide(sides[0]!);
    if (!hextets || hextets.length !== 8) return null;
    return hextets;
  }

  const left = parseSide(sides[0]!);
  const right = parseSide(sides[1]!);
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

function hextetsToBigInt(hextets: number[]): bigint {
  let value = 0n;
  for (const h of hextets) {
    value = (value << 16n) + BigInt(h);
  }
  return value;
}

function inIpv6Cidr(addr: bigint, prefix: bigint, prefixLen: number): boolean {
  if (prefixLen === 0) return true;
  const shift = BigInt(128 - prefixLen);
  return addr >> shift === prefix >> shift;
}

function parseIpv4MappedFromIpv6(normalized: string): [number, number, number, number] | null {
  const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted?.[1]) return parseIpv4Octets(dotted[1]);

  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
  }

  const hextets = parseIpv6Hextets(normalized);
  if (
    hextets &&
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0xffff
  ) {
    const hi = hextets[6]!;
    const lo = hextets[7]!;
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
  }
  return null;
}

function isGlobalUnicastIpv6(normalized: string): boolean {
  const mapped = parseIpv4MappedFromIpv6(normalized);
  if (mapped) return isGlobalUnicastIpv4(mapped);

  const hextets = parseIpv6Hextets(normalized);
  if (!hextets) {
    return false;
  }
  const addr = hextetsToBigInt(hextets);

  // ::/128 unspecified
  if (addr === 0n) return false;
  // ::1/128 loopback
  if (addr === 1n) return false;
  // fc00::/7 unique local
  if (inIpv6Cidr(addr, 0xfc00_0000_0000_0000_0000_0000_0000_0000n, 7)) return false;
  // fe80::/10 link-local
  if (inIpv6Cidr(addr, 0xfe80_0000_0000_0000_0000_0000_0000_0000n, 10)) return false;
  // ff00::/8 multicast
  if (inIpv6Cidr(addr, 0xff00_0000_0000_0000_0000_0000_0000_0000n, 8)) return false;
  // 2001:db8::/32 documentation
  if (inIpv6Cidr(addr, 0x2001_0db8_0000_0000_0000_0000_0000_0000n, 32)) return false;
  // ::ffff:0:0/96 already handled via mapped path when parseable
  // IPv4-compatible deprecated ::/96 (excluding :: and ::1) — treat non-global
  if (
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0
  ) {
    return false;
  }

  return true;
}

/** True only for globally routable unicast addresses. */
export function isGlobalUnicastIp(ip: string): boolean {
  const normalized = ip.replace(/^\[|\]$/g, "").toLowerCase();
  const kind = net.isIP(normalized);
  if (kind === 0) return false;
  if (kind === 4) {
    const octets = parseIpv4Octets(normalized);
    if (!octets) return false;
    return isGlobalUnicastIpv4(octets);
  }
  return isGlobalUnicastIpv6(normalized);
}

/** Compatibility: true when the address must be blocked for SSRF. */
export function isPrivateIp(ip: string): boolean {
  return !isGlobalUnicastIp(ip);
}
