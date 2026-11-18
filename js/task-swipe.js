// Горизонтальное удаление строк задач с безопасной отменой.
import { h } from './util.js';
import * as S from './store.js';
import { ic, toast } from './ui.js';

const ACTION_WIDTH = 96;
const DRAG_THRESHOLD = 8;
const pendingRemoval = new Map();
let openShell = null;

function closeOpenShell() {
  if (openShell) openShell.close();
}

export function withTaskSwipe(task, row, beforeDelete) {
  const foreground = h('div', { class: 'task-swipe-foreground' }, row);
  const deleteButton = h('button', {
    type: 'button',
    class: 'task-swipe-delete',
    'aria-label': `Удалить задачу «${task.title}»`,
    tabindex: '-1',
    onclick: (e) => {
      e.stopPropagation();
      animateDelete();
    },
  }, ic('trash', 19), h('span', null, 'Удалить'));
  const shell = h('div', { class: 'task-swipe-shell', 'data-task-swipe': task.id }, deleteButton, foreground);

  let isOpen = false;
  let pointer = null;
  let suppressClickUntil = 0;

  function setOpen(next) {
    isOpen = !!next;
    shell.classList.toggle('is-open', isOpen);
    deleteButton.setAttribute('tabindex', isOpen ? '0' : '-1');
    if (isOpen) {
      openShell = { shell, close: () => setOpen(false) };
    } else if (openShell?.shell === shell) {
      openShell = null;
    }
    foreground.style.transform = '';
    foreground.style.transition = '';
    shell.classList.remove('is-dragging');
  }

  function dragOffset(offset) {
    foreground.style.transform = `translate3d(${Math.min(0, offset)}px, 0, 0)`;
  }

  function animateDelete() {
    if (pendingRemoval.has(task.id)) return;
    closeOpenShell();
    pointer = null;
    shell.classList.remove('is-open', 'is-dragging');
    shell.classList.add('is-deleting');
    foreground.style.transform = '';
    const timer = setTimeout(() => {
      pendingRemoval.delete(task.id);
      const inverse = S.remove('tasks', task.id);
      if (!inverse.length) return;
      if (typeof beforeDelete === 'function') beforeDelete();
      toast('Задача удалена', {
        label: 'Отменить',
        onClick: () => S.undo(inverse),
      });
    }, 190);
    pendingRemoval.set(task.id, timer);
  }

  shell.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, a, input, textarea, select, [data-no-swipe]')) return;
    if (openShell?.shell !== shell) closeOpenShell();
    const startOffset = isOpen ? -ACTION_WIDTH : 0;
    pointer = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startOffset,
      offset: startOffset,
      decided: false,
      horizontal: false,
      moved: false,
    };
  });

  shell.addEventListener('pointermove', (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    if (!pointer.decided) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD) return;
      pointer.decided = true;
      if (Math.abs(dy) > Math.abs(dx) * 1.12) {
        pointer = null;
        return;
      }
      pointer.horizontal = true;
      shell.classList.add('is-dragging');
      try { shell.setPointerCapture(e.pointerId); } catch (_) {}
    }
    if (!pointer.horizontal) return;
    pointer.moved = true;
    const width = shell.getBoundingClientRect().width || 320;
    const maxOffset = Math.min(width * 0.72, 280);
    pointer.offset = Math.max(-maxOffset, Math.min(0, pointer.startOffset + dx));
    dragOffset(pointer.offset);
    if (e.cancelable) e.preventDefault();
  });

  function finishPointer(e, cancelled = false) {
    if (!pointer || e.pointerId !== pointer.id) return;
    const current = pointer;
    pointer = null;
    if (!current.horizontal) return;
    shell.classList.remove('is-dragging');
    suppressClickUntil = Date.now() + 420;
    if (cancelled) {
      setOpen(isOpen);
      return;
    }
    const width = shell.getBoundingClientRect().width || 320;
    const maxOffset = Math.min(width * 0.72, 280);
    const deleteThreshold = Math.min(maxOffset - 8, Math.max(150, width * 0.42));
    if (current.offset <= -deleteThreshold) {
      animateDelete();
    } else {
      setOpen(current.offset <= -ACTION_WIDTH * 0.42);
    }
  }

  shell.addEventListener('pointerup', (e) => finishPointer(e, false));
  shell.addEventListener('pointercancel', (e) => finishPointer(e, true));

  // Не даём завершившемуся свайпу открыть редактор обычным click-событием.
  shell.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil && foreground.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      suppressClickUntil = 0;
      return;
    }
    if (isOpen && foreground.contains(e.target)) {
      setOpen(false);
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }, true);

  return shell;
}
