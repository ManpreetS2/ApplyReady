import net from "node:net";
import ipaddr from "ipaddr.js";

/**
 * Global-unicast IP classification for SSRF defenses.
 *
 * Allow semantics (default deny):
 * - IPv4: allowed only when outside the IANA IPv4 Special-Purpose Address Registry
 * - IPv6: allowed only inside 2000::/3 (global unicast) and outside the IANA
 *   IPv6 Special-Purpose Address Registry
 * - IPv4-mapped IPv6 (::ffff:x.x.x.x): classified by the embedded IPv4 address
 *
 * ipaddr.js is used for parsing/CIDR matching; special-purpose coverage comes
 * from the authoritative registries rather than a denylist-then-default-true.
 */

type Cidr = [ipaddr.IPv4 | ipaddr.IPv6, number];

function parseCidrs(cidrs: string[]): Cidr[] {
  return cidrs.map((cidr) => ipaddr.parseCIDR(cidr) as Cidr);
}

function matchesAny(addr: ipaddr.IPv4 | ipaddr.IPv6, ranges: Cidr[]): boolean {
  return ranges.some(([base, prefix]) => {
    try {
      // kinds must match for ipaddr match()
      if (addr.kind() !== base.kind()) return false;
      return addr.match(base, prefix);
    } catch {
      return false;
    }
  });
}

/**
 * IANA IPv4 Special-Purpose Address Registry (non-globally-reachable /
 * special-purpose). Anything else is treated as globally routable unicast.
 * @see https://www.iana.org/assignments/iana-ipv4-special-registry/
 */
const IPV4_SPECIAL_PURPOSE = parseCidrs([
  "0.0.0.0/8", // "This network"
  "10.0.0.0/8", // Private-Use
  "100.64.0.0/10", // Shared Address Space (CGNAT)
  "127.0.0.0/8", // Loopback
  "169.254.0.0/16", // Link Local
  "172.16.0.0/12", // Private-Use
  "192.0.0.0/24", // IETF Protocol Assignments
  "192.0.2.0/24", // Documentation (TEST-NET-1)
  "192.31.196.0/24", // AS112-v4
  "192.52.193.0/24", // AMT
  "192.88.99.0/24", // Deprecated 6to4 Relay Anycast
  "192.168.0.0/16", // Private-Use
  "192.175.48.0/24", // AS112-v4
  "198.18.0.0/15", // Benchmarking
  "198.51.100.0/24", // Documentation (TEST-NET-2)
  "203.0.113.0/24", // Documentation (TEST-NET-3)
  "224.0.0.0/4", // Multicast
  "240.0.0.0/4", // Reserved
  "255.255.255.255/32", // Limited Broadcast
]);

/** Global Unicast Address space (RFC 4291). */
const IPV6_GLOBAL_UNICAST = parseCidrs(["2000::/3"]);

/**
 * IANA IPv6 Special-Purpose Address Registry entries that fall inside (or
 * otherwise must not be treated as) globally reachable unicast destinations.
 * @see https://www.iana.org/assignments/iana-ipv6-special-registry/
 */
const IPV6_SPECIAL_PURPOSE = parseCidrs([
  "::/128", // Unspecified
  "::1/128", // Loopback
  "::ffff:0:0/96", // IPv4-mapped (handled via embedded IPv4)
  "64:ff9b::/96", // NAT64
  "64:ff9b:1::/48", // Local-Use NAT64
  "100::/64", // Discard-Only Address Block
  "2001::/23", // IETF Protocol Assignments (Teredo, benchmarking, ORCHID, …)
  "2001:db8::/32", // Documentation
  "2002::/16", // 6to4
  "fc00::/7", // Unique-Local
  "fe80::/10", // Link-Local Unicast
  "ff00::/8", // Multicast
]);

function classifyIpv4(addr: ipaddr.IPv4): boolean {
  return !matchesAny(addr, IPV4_SPECIAL_PURPOSE);
}

function classifyIpv6(addr: ipaddr.IPv6): boolean {
  if (addr.isIPv4MappedAddress()) {
    return classifyIpv4(addr.toIPv4Address());
  }
  if (!matchesAny(addr, IPV6_GLOBAL_UNICAST)) {
    return false;
  }
  if (matchesAny(addr, IPV6_SPECIAL_PURPOSE)) {
    return false;
  }
  return true;
}

/** True only for globally routable unicast addresses. */
export function isGlobalUnicastIp(ip: string): boolean {
  const normalized = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIP(normalized) === 0) return false;

  try {
    const parsed = ipaddr.parse(normalized);
    if (parsed.kind() === "ipv4") {
      return classifyIpv4(parsed as ipaddr.IPv4);
    }
    return classifyIpv6(parsed as ipaddr.IPv6);
  } catch {
    return false;
  }
}

/** Compatibility: true when the address must be blocked for SSRF. */
export function isPrivateIp(ip: string): boolean {
  return !isGlobalUnicastIp(ip);
}
