// Временное состояние завершённых задач для короткой анимации и отмены.
const VISIBLE_MS = 2200;
const EXIT_MS = 380;
const pending = new Map();

function rerender() {
  if (typeof document !== 'undefined') document.dispatchEvent(new Event('rerender'));
}

export function isTaskInCompletionWindow(id) {
  return pending.has(id);
}

export function isTaskExitStarted(id) {
  return !!pending.get(id)?.exitStarted;
}

export function beginTaskCompletion(id) {
  cancelTaskCompletion(id);
  const entry = { exitStarted: false, visibleTimer: null, exitTimer: null };
  pending.set(id, entry);
  entry.visibleTimer = setTimeout(() => {
    if (pending.get(id) !== entry) return;
    entry.exitStarted = true;
    if (typeof document !== 'undefined') {
      document.querySelectorAll('[data-task-id]').forEach((el) => {
        if (el.dataset.taskId === String(id) && el.dataset.taskDone === 'true') el.classList.add('task-completion-exit');
      });
    }
    entry.exitTimer = setTimeout(() => {
      if (pending.get(id) !== entry) return;
      pending.delete(id);
      rerender();
    }, EXIT_MS);
  }, VISIBLE_MS);
}

export function cancelTaskCompletion(id) {
  const entry = pending.get(id);
  if (entry) {
    clearTimeout(entry.visibleTimer);
    clearTimeout(entry.exitTimer);
    pending.delete(id);
  }
  if (typeof document !== 'undefined') {
    document.querySelectorAll('[data-task-id]').forEach((el) => {
      if (el.dataset.taskId === String(id)) el.classList.remove('task-completion-exit');
    });
  }
}
