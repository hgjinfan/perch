import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.js';
import { clientIp, normalizeIp } from './client-ip.js';

export function authorize(header, username, password) {
  if (!password || !header?.startsWith('Basic ')) return false;
  const supplied = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(supplied), digest(`${username}:${password}`));
}

export function createAdminGuard({
  username = 'admin',
  password,
  now = Date.now,
  trustProxyHops = 0,
  maxEntries = 4096,
}) {
  const attempts = new Map();
  return (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!password)
      throw new HttpError(503, '管理入口未启用，请在服务器设置 ADMIN_PASSWORD 后重启。');
    const address =
      clientIp(request, trustProxyHops) ||
      normalizeIp(request.socket.remoteAddress) ||
      'unresolved';
    const attempt = attempts.get(address);
    if (attempt && attempt.count >= 10 && now() < attempt.until)
      throw new HttpError(429, '尝试过多，请十分钟后重试。');
    if (!authorize(request.headers.authorization, username, password)) {
      if (request.headers.authorization) {
        for (const [key, entry] of attempts) if (entry.until < now()) attempts.delete(key);
        attempts.set(address, {
          count: (attempt && now() < attempt.until ? attempt.count : 0) + 1,
          until: now() + 600000,
        });
        if (attempts.size > maxEntries) attempts.delete(attempts.keys().next().value);
      }
      response.setHeader('WWW-Authenticate', 'Basic realm="Perch Admin", charset="UTF-8"');
      throw new HttpError(401, '请使用管理员账号登录。');
    }
    attempts.delete(address);
  };
}
