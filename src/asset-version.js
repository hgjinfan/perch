import { init, parse } from 'es-module-lexer/minimal';

// Resolve the entire module graph against canonical paths before adding a release prefix.
export async function versionModule(source, path, urlFor, known) {
  await init();
  const [imports] = parse(source);
  for (const item of [...imports].reverse()) {
    if (!item.n || !/^(\.{1,2}\/|\/)/.test(item.n)) continue;
    const target = new URL(item.n, `https://assets.invalid${path}`);
    if (!known(target.pathname)) throw new Error(`Unknown module import: ${path} -> ${item.n}`);
    const value = urlFor(target.pathname) + target.search + target.hash;
    source =
      source.slice(0, item.s) +
      (item.d >= 0 ? JSON.stringify(value) : value) +
      source.slice(item.e);
  }
  return source;
}

export function versionHtml(source, urlFor, known) {
  return source.replace(/\b(src|href)=(['"])(\/[^'"\s]*)\2/g, (match, attribute, quote, path) =>
    known(path) && path !== '/' ? `${attribute}=${quote}${urlFor(path)}${quote}` : match,
  );
}

export function canonicalAsset(path, version) {
  const prefix = `/assets/${version}/`;
  return path.startsWith(prefix) ? '/' + path.slice(prefix.length) : null;
}
