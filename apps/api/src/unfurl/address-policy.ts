import ipaddr from 'ipaddr.js';

/** Where unfurl may connect: decided per address and port, before any connection (spec §6.8). */
export interface AddressPolicy {
  allows(address: string, port: number): boolean;
}

const GLOBAL_UNICAST_V6 = ipaddr.parseCIDR('2000::/3');

/**
 * True only for a public unicast address. It's an allowlist: ipaddr.js names every special-purpose
 * range (private, loopback, link-local, CGNAT, NAT64, 6to4, Teredo, reserved and so on), and
 * anything it doesn't call `unicast` is refused, including a range nobody here thought to list.
 * process() first turns an IPv4-mapped IPv6 address into the IPv4 address it carries.
 *
 * ipaddr.js also calls some IPv6 space `unicast` that no public host uses, such as the deprecated
 * IPv4-compatible form (`::7f00:1`), which a host with a `sit0` device treats as IPv4. So an IPv6
 * address must also be inside 2000::/3, the space allocated for global unicast.
 */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  if (parsed.range() !== 'unicast') return false;
  return parsed.kind() === 'ipv4' || parsed.match(GLOBAL_UNICAST_V6);
}

/** Production: public addresses, on the web's two ports. */
export const PUBLIC_WEB: AddressPolicy = {
  allows: (address, port) => (port === 80 || port === 443) && isPublicAddress(address),
};
