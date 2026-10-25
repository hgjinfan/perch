import { selectFeedEntries } from './feeds/filter.js';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

import { safeUrl } from '../shared/url.js';
export { safeUrl } from '../shared/url.js';
const list = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);
const text = (value) =>
  typeof value === 'object' ? String(value?.['#text'] ?? '') : String(value ?? '');
export function parseFeed(xml, limit = 5, filters) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error('Invalid feed');
  const doc = new XMLParser({
    ignoreAttributes: false,
    processEntities: true,
    trimValues: true,
  }).parse(xml);
  if (!doc.rss && !doc.feed && !doc['rdf:RDF']) throw new Error('Not an RSS or Atom feed');
  const entries = doc.rss?.channel?.item ?? doc.feed?.entry ?? doc['rdf:RDF']?.item;
  const parsed = list(entries).flatMap((item) => {
    const links = list(item.link);
    const link =
      links.find((l) => l?.['@_rel'] === 'alternate') ??
      links.find((l) => !l?.['@_rel']) ??
      links[0];
    const url = safeUrl(typeof link === 'object' ? link?.['@_href'] : link);
    if (!url) return [];
    const date = text(item.pubDate ?? item.published ?? item.updated ?? item['dc:date']);
    return [
      {
        title:
          text(item.title)
            .replace(/<[^>]*>/g, '')
            .trim() || '未命名文章',
        url,
        date: Number.isNaN(Date.parse(date)) ? null : new Date(date).toISOString(),
      },
    ];
  });
  return selectFeedEntries(parsed, limit, filters);
}
export async function readRemote(url, fetcher = fetch) {
  if (!safeUrl(url)) throw new Error('Invalid URL');
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      'User-Agent': 'PerchHomepage/0.1',
      Accept:
        'application/rss+xml, application/atom+xml, application/json, text/xml;q=0.9, */*;q=0.5',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error('Invalid feed');
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Response too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function createCache(now = Date.now, { maxEntries = 512, onEvent } = {}) {
  const emit = (event) => {
    try {
      onEvent?.(event);
    } catch {
      /* Diagnostics must not affect content loading. */
    }
  };
  const cache = new Map(),
    inflight = new Map();
  return async (key, ttl, loader) => {
    const previous = cache.get(key);
    if (previous && now() < previous.expires) {
      emit({ key, type: 'hit', state: previous.result.state, expiresAt: previous.expires });
      return previous.result;
    }
    if (inflight.has(key)) return inflight.get(key);
    emit({ key, type: 'start' });
    const promise = Promise.resolve().then(async () => {
      try {
        const result = {
          state: 'ready',
          data: await loader(),
          updatedAt: new Date(now()).toISOString(),
        };
        const expires = now() + ttl;
        cache.set(key, { result, expires });
        emit({ key, type: 'success', expiresAt: expires });
        if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        return result;
      } catch (error) {
        const result = previous?.result.data
          ? { ...previous.result, state: 'stale', message: '暂时无法更新，显示上次内容' }
          : { state: 'error', message: '暂时无法获取，请稍后刷新' };
        const expires = now() + 30_000;
        cache.set(key, { result, expires });
        emit({
          key,
          type: 'error',
          error,
          hasData: Boolean(previous?.result.data),
          expiresAt: expires,
        });
        if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        return result;
      } finally {
        inflight.delete(key);
      }
    });
    inflight.set(key, promise);
    return promise;
  };
}
export async function checkService(service, fetcher = fetch, onError = () => {}) {
  const url = safeUrl(service.healthUrl || service.url || service.internalUrl);
  if (!url) return { id: service.id, state: 'unconfigured' };
  const start = performance.now();
  try {
    const response = await fetcher(url, {
      method: 'GET',
      redirect: 'follow',
      headersOnly: true,
      signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel();
    const accessible = response.ok || [401, 403].includes(response.status);
    return {
      id: service.id,
      state: accessible ? 'online' : 'degraded',
      latency: Math.round(performance.now() - start),
      status: response.status,
    };
  } catch (error) {
    try {
      onError(error);
    } catch {
      /* Observation must not change service availability. */
    }
    return { id: service.id, state: 'offline' };
  }
}
