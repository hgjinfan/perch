// Integration clients discover the fragment contract from the current document.
export async function fragmentFetch(input, options) {
  const url = new URL(input);
  if (
    url.pathname.startsWith('/fragments/') &&
    !/^\/fragments\/[a-f0-9]{20}\//.test(url.pathname)
  ) {
    const markup = await (await globalThis.fetch(url.origin + '/')).text();
    const version = markup
      .match(/data-page-version="([a-f0-9]{20}-[a-f0-9]{32})"/)[1]
      .replace('-', '/');
    url.pathname = '/fragments/' + version + url.pathname.slice('/fragments'.length);
  }
  return globalThis.fetch(url, options);
}
