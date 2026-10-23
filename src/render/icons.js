import { icons } from 'lucide';

// Lucide definitions stay on the server. Only the selected SVG enters the HTML.
// Copyright Lucide Contributors / Feather; see THIRD_PARTY_NOTICES.md.
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const pascal = (value) =>
  value.replace(
    /(\w)(\w*)(_|-|\s*)/g,
    (_, first, rest) => first.toUpperCase() + rest.toLowerCase(),
  );
const cache = new Map();
function serialize([tag, attrs, children = []]) {
  return `<${tag}${Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escape(value)}"`)
    .join('')}>${children.map(serialize).join('')}</${tag}>`;
}
export function renderIcon(name) {
  const requested = typeof name === 'string' && /^[a-z0-9-]{1,60}$/.test(name) ? name : 'box';
  const key = pascal(requested);
  const cacheKey = Object.hasOwn(icons, key) ? key : 'Box';
  const definition = icons[cacheKey];
  // Cache by the actual definition name, so arbitrary invalid input cannot grow the map.
  const resolved = definition === icons.Box ? 'box' : requested;
  if (!cache.has(cacheKey)) {
    const [tag, attrs, children] = definition;
    cache.set(
      cacheKey,
      serialize([
        tag,
        {
          ...attrs,
          class: 'lucide',
          'data-lucide': resolved,
          'aria-hidden': 'true',
          focusable: 'false',
        },
        children,
      ]),
    );
  }
  return cache.get(cacheKey);
}
