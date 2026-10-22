// Pure scheduling logic: no document, intervals or rendering dependencies.
export function createScheduler({ now = Date.now } = {}) {
  const tasks = new Map();
  return {
    register(id, run, interval) {
      tasks.set(id, { run, interval, due: 0, pending: null });
    },
    async refresh(force = false) {
      const pending = [];
      for (const task of tasks.values()) {
        if (task.pending) {
          pending.push(task.pending);
          continue;
        }
        if (!force && now() < task.due) continue;
        task.pending = Promise.resolve()
          .then(task.run)
          .finally(() => {
            task.due = now() + task.interval;
            task.pending = null;
          });
        pending.push(task.pending);
      }
      await Promise.allSettled(pending);
      return pending.length > 0;
    },
  };
}
