export function mountLazyPanel(root, load, mount) {
  let controller, flight;
  async function refresh() {
    if (!root.open) return;
    if (controller) return controller.refresh?.();
    if (flight) return flight;
    flight = load()
      .then((module) => {
        controller = mount(module) || {};
        return controller?.refresh?.();
      })
      .catch(() => {
        const status = root.querySelector('[role="status"]');
        if (status) status.textContent = '工具加载失败，请收起后展开重试。';
      })
      .finally(() => {
        flight = null;
      });
    return flight;
  }
  root.addEventListener('toggle', refresh);
  return { refresh };
}
