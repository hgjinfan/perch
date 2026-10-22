export function createEditSession({ form, capture, onState, window: host = window }) {
  let baseline,
    dirty = false,
    busy = false,
    leaving = false,
    queued = false;
  function fingerprint() {
    const fields = [...form.querySelectorAll('input,textarea,select')]
      .filter((c) => !c.closest('#preset-picker,#backup-settings'))
      .map((c) => [c.name || '', c.type, c.type === 'checkbox' ? c.checked : c.value]);
    return JSON.stringify({ config: capture(), fields });
  }
  function update() {
    if (baseline === undefined || leaving) return;
    dirty = fingerprint() !== baseline;
    onState({ dirty, busy });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      update();
    });
  }
  for (const event of ['input', 'change', 'click', 'drop']) form.addEventListener(event, schedule);
  const unload = (event) => {
    update();
    if (!leaving && (dirty || busy)) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  host.addEventListener('beforeunload', unload);
  return {
    get dirty() {
      update();
      return dirty;
    },
    saved() {
      leaving = false;
      baseline = fingerprint();
      dirty = false;
      onState({ dirty, busy });
    },
    setBusy(value) {
      busy = value;
      update();
    },
    allowLeave() {
      leaving = true;
    },
    update,
  };
}
