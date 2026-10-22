import { randomBytes } from 'node:crypto';
// Public tokens intentionally do not expose the administrative config digest.
export function createPageVersion(store, assetVersion) {
  let reference, serialized, token;
  return () => {
    const config = store.get();
    if (config !== reference) {
      const next = JSON.stringify(config);
      if (next !== serialized) token = randomBytes(16).toString('hex');
      reference = config;
      serialized = next;
    }
    return `${assetVersion}-${token}`;
  };
}
