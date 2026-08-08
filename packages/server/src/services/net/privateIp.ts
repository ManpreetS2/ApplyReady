import net from "node:net";

/**
 * CIDR-correct private / non-public IP classification for SSRF defenses.
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

function isPrivateIpv4(octets: [number, number, number, number]): boolean {
  const ip = ipv4ToInt(octets);
  // 0.0.0.0/8 unspecified
  if (inIpv4Cidr(ip, [0, 0, 0, 0], 8)) return true;
  // 127.0.0.0/8 loopback
  if (inIpv4Cidr(ip, [127, 0, 0, 0], 8)) return true;
  // 10.0.0.0/8
  if (inIpv4Cidr(ip, [10, 0, 0, 0], 8)) return true;
  // 172.16.0.0/12
  if (inIpv4Cidr(ip, [172, 16, 0, 0], 12)) return true;
  // 192.168.0.0/16
  if (inIpv4Cidr(ip, [192, 168, 0, 0], 16)) return true;
  // 169.254.0.0/16 link-local
  if (inIpv4Cidr(ip, [169, 254, 0, 0], 16)) return true;
  // 100.64.0.0/10 CGNAT
  if (inIpv4Cidr(ip, [100, 64, 0, 0], 10)) return true;
  return false;
}

/** Expand IPv6 textual form to 8 hextets (0–65535). */
function parseIpv6Hextets(ip: string): number[] | null {
  const lower = ip.toLowerCase();
  if (lower.includes(".")) {
    // Embedded IPv4 (e.g. ::ffff:127.0.0.1) — handled by caller via mapped path.
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
  // ::ffff:127.0.0.1
  const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted?.[1]) return parseIpv4Octets(dotted[1]);

  // ::ffff:7f00:1 (hex form)
  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
  }

  // Fully expanded forms containing ffff then IPv4
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

function isPrivateIpv6(normalized: string): boolean {
  const mapped = parseIpv4MappedFromIpv6(normalized);
  if (mapped) return isPrivateIpv4(mapped);

  const hextets = parseIpv6Hextets(normalized);
  if (!hextets) {
    // Unparseable IPv6 → treat as blocked.
    return true;
  }
  const addr = hextetsToBigInt(hextets);

  // ::/128 unspecified
  if (addr === 0n) return true;
  // ::1/128 loopback
  if (addr === 1n) return true;
  // fc00::/7 unique local
  if (inIpv6Cidr(addr, 0xfc00_0000_0000_0000_0000_0000_0000_0000n, 7)) return true;
  // fe80::/10 link-local (covers fe80–febf)
  if (inIpv6Cidr(addr, 0xfe80_0000_0000_0000_0000_0000_0000_0000n, 10)) return true;

  return false;
}

export function isPrivateIp(ip: string): boolean {
  const normalized = ip.replace(/^\[|\]$/g, "").toLowerCase();
  const kind = net.isIP(normalized);
  if (kind === 0) return true;
  if (kind === 4) {
    const octets = parseIpv4Octets(normalized);
    if (!octets) return true;
    return isPrivateIpv4(octets);
  }
  return isPrivateIpv6(normalized);
}
