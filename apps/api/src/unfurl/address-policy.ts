import ipaddr from 'ipaddr.js';

/** Where unfurl may connect: decided per address and port, before any connection (spec §6.8). */
export interface AddressPolicy {
  allows(address: string, port: number): boolean;
}

/**
 * True only for a public unicast address. It's an allowlist: ipaddr.js names every special-purpose
 * range (private, loopback, link-local, CGNAT, NAT64, 6to4, Teredo, reserved and so on), and
 * anything it doesn't call `unicast` is refused, including a range nobody here thought to list.
 * process() first turns an IPv4-mapped IPv6 address into the IPv4 address it carries.
 */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.process(address).range() === 'unicast';
}

/** Production: public addresses, on the web's two ports. */
export const PUBLIC_WEB: AddressPolicy = {
  allows: (address, port) => (port === 80 || port === 443) && isPublicAddress(address),
};
