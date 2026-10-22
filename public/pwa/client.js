export function setupPwa({ reconnect }) {
  const install = document.querySelector('#install-app');
  const notice = document.querySelector('#notice');
  const update = document.querySelector('#update-app');
  window.addEventListener('homepage:update-required', () => {
    update.hidden = false;
    update.textContent = '更新页面';
    update.onclick = () => location.reload();
  });
  let deferredPrompt;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function connection() {
    notice.hidden = navigator.onLine;
    notice.textContent = navigator.onLine
      ? ''
      : '当前离线。已加载的内容仅供参考，联网后会自动更新。';
  }
  connection();
  window.addEventListener('offline', connection);
  window.addEventListener('online', () => {
    connection();
    reconnect();
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    install.hidden = standalone();
  });
  window.addEventListener('appinstalled', () => {
    install.hidden = true;
    deferredPrompt = null;
  });
  if (ios && !standalone()) install.hidden = false;
  install.onclick = async () => {
    if (deferredPrompt) {
      const prompt = deferredPrompt;
      deferredPrompt = null;
      install.hidden = true;
      await prompt.prompt();
      await prompt.userChoice;
    } else {
      notice.textContent = '在 Safari 的分享菜单中选择“添加到主屏幕”，即可像应用一样打开。';
      notice.hidden = false;
    }
  };
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  let wasControlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (wasControlled) location.reload();
    wasControlled = true;
  });
  navigator.serviceWorker
    .register('/sw.js', { type: 'module', updateViaCache: 'none' })
    .then((registration) => {
      function available() {
        if (!registration.waiting || !navigator.serviceWorker.controller) return;
        update.hidden = false;
        update.onclick = () => {
          update.disabled = true;
          registration.waiting?.postMessage({ type: 'ACTIVATE_UPDATE' });
        };
      }
      available();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') available();
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) registration.update().catch(() => {});
      });
    })
    .catch(() => {
      // Unsupported/disabled service workers must not break the normal homepage.
    });
}
