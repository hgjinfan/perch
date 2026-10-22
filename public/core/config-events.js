export const CONFIG_CHANNEL = 'kyrie-homepage-config-updates';
export function notifyConfigChange() {
  try {
    if (!globalThis.BroadcastChannel) return;
    const channel = new BroadcastChannel(CONFIG_CHANNEL);
    channel.postMessage({ type: 'changed' });
    channel.close();
  } catch {
    /* Periodic version checks remain available without cross-tab messaging. */
  }
}
