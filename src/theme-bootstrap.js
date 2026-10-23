import { createHash } from 'node:crypto';

// Authorize only this fixed, build-owned bootstrap; never interpolate site config.
export function createThemeBootstrap(source) {
  const code = source.replace(/<\/script/gi, '<\\/script');
  const hash = 'sha256-' + createHash('sha256').update(code).digest('base64');
  return {
    hash,
    render: (html) =>
      html.replace(
        /<script\b[^>]*\bsrc=(["'])\/pwa\/theme\.js\1[^>]*>\s*<\/script>/g,
        () => `<script>${code}</script>`,
      ),
  };
}
