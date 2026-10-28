import { createHash } from 'node:crypto';

// Only fixed application code is embedded. No configuration or user content is executable.
export function createLayoutBootstrap(source) {
  const code = source.replace(/<\/script/gi, '<\\/script');
  return {
    hash: 'sha256-' + createHash('sha256').update(code).digest('base64'),
    render: (html) => html.replace('<!--perch:initial-layout-->', () => `<script>${code}</script>`),
  };
}
