import { buildPreset } from '../../public/admin/preset-definitions.js';

// Public evaluation services: no credentials, lightweight read-only requests only.
export function publicPresetWidgets() {
  return [
    buildPreset(
      'prometheus',
      {
        base: 'https://demo.promlabs.com',
        query: 'sum(up)',
        unit: '个',
        auth: 'none',
      },
      'public-prometheus',
    ),
    buildPreset(
      'jellyfin-version',
      {
        base: 'https://demo.jellyfin.org/stable',
      },
      'public-jellyfin',
    ),
  ];
}
