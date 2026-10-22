// Only an explicit shell allowlist may enter Cache Storage. APIs and admin stay online-only.
export function isShellRequest(request, origin, shell) {
  const url = new URL(request.url);
  return (
    request.method === 'GET' &&
    url.origin === origin &&
    !url.search &&
    !request.headers.has('authorization') &&
    shell.includes(url.pathname)
  );
}
