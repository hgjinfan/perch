import { isIP, BlockList } from 'node:net';

const reserved = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  reserved.addSubnet(address, prefix, 'ipv4');
reserved.addSubnet('2001:db8::', 32, 'ipv6');

export function normalizeIp(value) {
  if (typeof value !== 'string') return null;
  let ip = value.trim().toLowerCase();
  if (ip.startsWith('::ffff:')) {
    const tail = ip.slice(7);
    if (isIP(tail) === 4) ip = tail;
    else if (/^[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(tail)) {
      const [a, b] = tail.split(':').map((part) => parseInt(part, 16));
      ip = [a >> 8, a & 255, b >> 8, b & 255].join('.');
    }
  }
  return isIP(ip) ? ip : null;
}

export function publicIp(value) {
  const ip = normalizeIp(value);
  if (!ip) return null;
  if (isIP(ip) === 4) return reserved.check(ip, 'ipv4') ? null : ip;
  // Global-unicast only; exclude loopback, local, link-local, multicast and documentation.
  return /^[23][0-9a-f]{3}:/.test(ip) && !reserved.check(ip, 'ipv6') ? ip : null;
}

export function clientIp(request, hops = 0) {
  const peer = normalizeIp(request.socket.remoteAddress);
  if (!Number.isInteger(hops) || hops < 1 || hops > 10) return peer;
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded !== 'string' || forwarded.length > 2048) return peer;
  const chain = forwarded.split(',').map(normalizeIp);
  // Count from the immediate connection, never trust the spoofable leftmost entry.
  if (chain.some((ip) => !ip) || chain.length < hops) return null;
  return chain[chain.length - hops];
}

export function visitorIp(request, hops = 0) {
  return publicIp(clientIp(request, hops));
}
