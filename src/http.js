export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(response, data, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

export function requireMethod(request, ...methods) {
  if (!methods.includes(request.method)) throw new HttpError(405, 'Method not allowed');
}

export async function readJson(request, limit = 65536) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, '配置过大');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON 格式无效');
  }
}

export function requireSameOriginJson(request) {
  let origin;
  try {
    origin = new URL(request.headers.origin);
  } catch {
    throw new HttpError(403, '请求来源无效');
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.host !== request.headers.host ||
    request.headers['sec-fetch-site'] === 'cross-site' ||
    !request.headers['content-type']?.startsWith('application/json')
  ) {
    throw new HttpError(403, '请求来源无效');
  }
}

export function securityHeaders(response, { scriptHashes = [] } = {}) {
  const allowedScripts = scriptHashes
    .filter((hash) => /^sha256-[A-Za-z0-9+/]{43}=$/.test(hash))
    .map((hash) => ` '${hash}'`)
    .join('');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'${allowedScripts}; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'`,
  );
}
