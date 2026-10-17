import * as dns from 'node:dns';
import * as net from 'node:net';

/**
 * Addresses a scan must never connect to: this machine, private networks, and
 * link-local addresses. Link-local includes cloud metadata services such as AWS's
 * 169.254.169.254, a classic SSRF target because it hands out credentials.
 */
const BLOCKED = new net.BlockList();
BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4'); // "this network"
BLOCKED.addSubnet('10.0.0.0', 8, 'ipv4'); // private
BLOCKED.addSubnet('100.64.0.0', 10, 'ipv4'); // carrier-grade NAT
BLOCKED.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local, cloud metadata
BLOCKED.addSubnet('172.16.0.0', 12, 'ipv4'); // private
BLOCKED.addSubnet('192.168.0.0', 16, 'ipv4'); // private
BLOCKED.addSubnet('224.0.0.0', 3, 'ipv4'); // multicast and reserved
BLOCKED.addAddress('::', 'ipv6'); // unspecified
BLOCKED.addAddress('::1', 'ipv6'); // loopback
BLOCKED.addSubnet('fc00::', 7, 'ipv6'); // unique local (private)
BLOCKED.addSubnet('fe80::', 10, 'ipv6'); // link-local
BLOCKED.addSubnet('ff00::', 8, 'ipv6'); // multicast

export function isPrivateAddress(address: string): boolean {
  // An IPv4 address written in IPv6 form ("::ffff:127.0.0.1") is judged as IPv4.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
  if (mapped) return isPrivateAddress(mapped);
  return BLOCKED.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

/**
 * A replacement for dns.lookup that refuses private addresses. It is passed as the
 * `lookup` option of every socket the scanner opens (tls.connect, http.request).
 *
 * Because the check runs inside the connection itself, the address we approve is
 * exactly the address we connect to. Checking once when a domain is added would not
 * be enough: its DNS can later be changed to point inside our network ("DNS rebinding").
 */
export const publicOnlyLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '');

    const blocked = addresses.find(({ address }) => isPrivateAddress(address));
    if (blocked) {
      const message =
        `${hostname} resolves to a private address (${blocked.address}); scanning internal ` +
        'networks is disabled (set ALLOW_PRIVATE_TARGETS=true to allow it)';
      return callback(Object.assign(new Error(message), { code: 'EPRIVATEADDRESS' }), '');
    }

    if (options.all) return callback(null, addresses);
    const [first] = addresses;
    callback(null, first?.address ?? '', first?.family);
  });
};
