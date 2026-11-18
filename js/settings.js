// Настройки, редактор виджетов, резервные копии. Синхронизация и push подключаются из sync.js / push.js.
import { h, clear, plural } from './util.js';
import * as S from './store.js';
import { openSheet, actionSheet, group, groupTitle, groupNote, row, toggle, seg, selectInput, toast, ic } from './ui.js';
import * as Sync from './sync.js';
import * as Push from './push.js';

const WIDGET_NAMES = {
  day: ['Прогресс дня', 'Кольцо выполнения дел и привычек'],
  next: ['Ближайшее', 'Что и когда дальше'],
  habits: ['Привычки', 'Отметка в одно касание'],
  agenda: ['Расписание', 'События и задачи со временем'],
  tasks: ['Задачи на сегодня', 'Список с быстрым добавлением'],
  goals: ['Цели', 'Кольца прогресса по целям'],
  week: ['Неделя', 'Столбики выполнения за 7 дней'],
  streak: ['Серия', 'Самая длинная текущая серия'],
  overdue: ['Просрочено', 'Сколько задач ждёт'],
};

function widgetVisibilityToggle(value, onChange) {
  return h('label', { class: 'widget-switch-control' },
    h('input', {
      type: 'checkbox',
      class: 'widget-switch-input',
      checked: !!value,
      'aria-label': 'Показывать виджет',
      onchange: (event) => onChange(event.target.checked),
    }),
    h('span', { class: 'widget-switch-track', 'aria-hidden': 'true' },
      h('span', { class: 'widget-switch-thumb' })));
}

export function applyTheme() {
  const t = S.settings().theme || 'auto';
  document.documentElement.dataset.theme = t === 'auto' ? '' : t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#000000' : '#f2f2f7';
}

export function openWidgetsEditor() {
  openSheet({
    title: 'Виджеты', left: null, right: { label: 'Готово', bold: true }, tall: true,
    build(api) {
      clear(api.body);
      const list = S.settings().widgets;
      const entries = list.map((w) => {
        const handle = h('button', {
          type: 'button',
          class: 'widget-drag-handle',
          'data-no-scroll-restore': true,
          'aria-label': 'Перетащить виджет «' + WIDGET_NAMES[w.id][0] + '»',
          title: 'Удерживайте и перетащите',
        }, ic('drag', 18));
        const controls = h('div', { class: 'w-edit' },
          handle,
          widgetVisibilityToggle(w.on, (v) => {
            const next = S.settings().widgets.map((x) => (x.id === w.id ? { ...x, on: v } : x));
            S.setSettings({ widgets: next });
          }));
        const itemRow = row(WIDGET_NAMES[w.id][0], controls, {
          icon: 'sparkle', iconColor: 'blue', cls: 'widget-edit-row',
        });
        itemRow.dataset.widgetId = w.id;
        itemRow.querySelector('.row-label').appendChild(h('small', { class: 'row-sub' }, WIDGET_NAMES[w.id][1]));
        return { itemRow, handle };
      });
      const widgetGroup = group(...entries.map((entry) => entry.itemRow));
      widgetGroup.classList.add('widget-edit-group');

      const getRows = () => [...widgetGroup.children].filter((node) => node.classList.contains('widget-edit-row'));
      const capturePositions = (rows) => new Map(rows.map((node) => [node, node.getBoundingClientRect().top]));
      const animatePositions = (positions) => {
        for (const [node, oldTop] of positions) {
          if (!node.isConnected) continue;
          const delta = oldTop - node.getBoundingClientRect().top;
          if (Math.abs(delta) < 1) continue;
          node.getAnimations().forEach((animation) => animation.cancel());
          node.animate(
            [{ transform: 'translateY(' + delta + 'px)' }, { transform: 'translateY(0)' }],
            { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          );
        }
      };

      const saveOrder = () => {
        const current = S.settings().widgets;
        const byId = new Map(current.map((widget) => [widget.id, widget]));
        const ids = getRows().map((node) => node.dataset.widgetId);
        const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
        if (ordered.length === current.length && ordered.some((widget, index) => widget.id !== current[index].id)) {
          S.setSettings({ widgets: ordered });
        }
      };

      const moveByKeyboard = (itemRow, delta, handle) => {
        const rows = getRows();
        const index = rows.indexOf(itemRow);
        const nextIndex = index + delta;
        if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) return;
        const positions = capturePositions(rows);
        if (delta < 0) widgetGroup.insertBefore(itemRow, rows[nextIndex]);
        else widgetGroup.insertBefore(rows[nextIndex], itemRow);
        animatePositions(positions);
        saveOrder();
        handle.focus({ preventScroll: true });
      };

      const bindDrag = ({ itemRow, handle }) => {
        let pointerId = null;
        let startY = 0;
        let grabOffsetY = 0;
        let latestY = 0;
        let holdTimer = null;
        let dragging = false;
        let changed = false;
        let frameId = 0;
        let placeholder = null;
        let preview = null;

        const movePlaceholder = (y) => {
          if (!placeholder || !dragging) return;
          const candidates = getRows().filter((node) => node !== itemRow);
          // offsetTop остаётся стабильным во время FLIP-анимации соседних строк.
          const contentY = y - widgetGroup.getBoundingClientRect().top;
          const before = candidates.find((node) => contentY < node.offsetTop + node.offsetHeight / 2) || null;
          if (before === placeholder.nextElementSibling) return;
          if (!before && widgetGroup.lastElementChild === placeholder) return;

          const positions = capturePositions(candidates);
          if (before) widgetGroup.insertBefore(placeholder, before);
          else widgetGroup.appendChild(placeholder);
          animatePositions(positions);
          changed = true;
        };

        const dragFrame = () => {
          frameId = 0;
          if (!dragging || !preview) return;
          preview.style.top = (latestY - grabOffsetY) + 'px';

          const bounds = api.body.getBoundingClientRect();
          let scrollDelta = 0;
          if (latestY < bounds.top + 54) scrollDelta = -9;
          else if (latestY > bounds.bottom - 54) scrollDelta = 9;
          let didScroll = false;
          if (scrollDelta) {
            const previousScrollTop = api.body.scrollTop;
            api.body.scrollTop = Math.max(0, previousScrollTop + scrollDelta);
            didScroll = api.body.scrollTop !== previousScrollTop;
          }

          movePlaceholder(latestY);
          if (didScroll) frameId = requestAnimationFrame(dragFrame);
        };

        const scheduleDragFrame = () => {
          if (!frameId) frameId = requestAnimationFrame(dragFrame);
        };

        const startDrag = () => {
          if (pointerId == null || dragging) return;
          const rect = itemRow.getBoundingClientRect();
          const groupRect = widgetGroup.getBoundingClientRect();
          dragging = true;
          changed = false;
          handle.setAttribute('aria-grabbed', 'true');
          grabOffsetY = startY - rect.top;
          api.body.dataset.scrollMode = 'free';

          placeholder = h('div', {
            class: 'widget-drop-placeholder',
            'aria-hidden': 'true',
            style: { height: rect.height + 'px' },
          });
          widgetGroup.insertBefore(placeholder, itemRow);

          // Оригинал остаётся в DOM и сохраняет pointer capture; его место занимает placeholder.
          itemRow.classList.add('drag-source');
          itemRow.style.position = 'absolute';
          itemRow.style.left = '0';
          itemRow.style.top = (rect.top - groupRect.top) + 'px';
          itemRow.style.width = '100%';
          itemRow.style.height = rect.height + 'px';
          itemRow.style.margin = '0';
          itemRow.style.opacity = '0.01';

          // Отдельная визуальная карточка следует за пальцем и не ограничена overflow списка.
          preview = itemRow.cloneNode(true);
          preview.classList.remove('drag-source');
          preview.classList.add('widget-drag-preview');
          preview.setAttribute('aria-hidden', 'true');
          for (const property of ['position', 'left', 'top', 'width', 'height', 'margin', 'opacity']) {
            preview.style.removeProperty(property);
          }
          preview.style.position = 'fixed';
          preview.style.left = rect.left + 'px';
          preview.style.top = rect.top + 'px';
          preview.style.width = rect.width + 'px';
          preview.style.height = rect.height + 'px';
          document.body.appendChild(preview);
          scheduleDragFrame();
        };

        const finish = (event) => {
          if (pointerId == null || (event && event.pointerId !== pointerId)) return;
          clearTimeout(holdTimer);
          holdTimer = null;
          if (frameId) cancelAnimationFrame(frameId);
          frameId = 0;

          if (dragging && placeholder && placeholder.isConnected) {
            const releaseTop = preview ? Number.parseFloat(preview.style.top) : itemRow.getBoundingClientRect().top;
            const finalPositions = capturePositions(getRows().filter((node) => node !== itemRow));
            placeholder.replaceWith(itemRow);
            if (preview) preview.remove();
            preview = null;
            placeholder = null;

            itemRow.classList.remove('drag-source');
            for (const property of ['position', 'left', 'top', 'width', 'height', 'margin', 'opacity']) {
              itemRow.style.removeProperty(property);
            }
            animatePositions(finalPositions);
            const finalTop = itemRow.getBoundingClientRect().top;
            const delta = releaseTop - finalTop;
            if (Math.abs(delta) > 1) {
              itemRow.animate(
                [
                  { transform: 'translateY(' + delta + 'px) scale(1.025)', boxShadow: '0 14px 34px rgba(0,0,0,.18)' },
                  { transform: 'translateY(0) scale(1)', boxShadow: '0 0 0 rgba(0,0,0,0)' },
                ],
                { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
              );
            }
            if (changed) saveOrder();
          } else {
            if (preview) preview.remove();
            if (placeholder) placeholder.remove();
            preview = null;
            placeholder = null;
          }

          delete api.body.dataset.scrollMode;
          if (handle.hasPointerCapture && handle.hasPointerCapture(pointerId)) {
            try { handle.releasePointerCapture(pointerId); } catch (_) { /* указатель уже освобождён */ }
          }
          pointerId = null;
          dragging = false;
          changed = false;
          handle.setAttribute('aria-grabbed', 'false');
        };

        handle.addEventListener('pointerdown', (event) => {
          if (pointerId != null || (event.pointerType === 'mouse' && event.button !== 0)) return;
          pointerId = event.pointerId;
          startY = event.clientY;
          latestY = event.clientY;
          dragging = false;
          changed = false;
          handle.setAttribute('aria-grabbed', 'false');
          if (handle.setPointerCapture) {
            try { handle.setPointerCapture(pointerId); } catch (_) { /* fallback без pointer capture */ }
          }
          holdTimer = setTimeout(startDrag, 210);
        });

        handle.addEventListener('pointermove', (event) => {
          if (event.pointerId !== pointerId) return;
          latestY = event.clientY;
          if (!dragging) {
            if (Math.abs(latestY - startY) > 16) {
              clearTimeout(holdTimer);
              holdTimer = null;
            }
            return;
          }
          event.preventDefault();
          scheduleDragFrame();
        });

        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
        handle.addEventListener('lostpointercapture', finish);
        handle.addEventListener('keydown', (event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          moveByKeyboard(itemRow, event.key === 'ArrowUp' ? -1 : 1, handle);
        });
      };

      entries.forEach(bindDrag);
      api.body.append(
        groupNote('Удерживайте значок с точками и перетащите виджет на нужное место. Порядок в этом списке и на экране «Сегодня» обновится одновременно.'),
        widgetGroup,
        h('div', { class: 'sheet-pad' }),
      );
    },
  });
}
export function openSettings() {
  openSheet({
    title: 'Настройки', left: null, right: { label: 'Готово', bold: true }, tall: true,
    build(api) {
      const draw = () => {
        const st = S.settings();
        const sy = Sync.status();
        const ps = Push.state();
        clear(api.body);
        api.body.append(
          groupTitle('Оформление'),
          group(
            h('div', { class: 'row' }, seg({ options: [{ v: 'auto', label: 'Авто' }, { v: 'light', label: 'Светлая' }, { v: 'dark', label: 'Тёмная' }], value: st.theme || 'auto', onChange: (v) => { S.setSettings({ theme: v }); applyTheme(); } })),
            row('Неделя начинается с', selectInput([{ v: 1, label: 'Понедельника' }, { v: 0, label: 'Воскресенья' }], st.weekStart, (v) => S.setSettings({ weekStart: Number(v) })), { icon: 'calendar', iconColor: 'red' })),
          groupTitle('Синхронизация между устройствами'),
          group(
            h('div', { class: 'sync-summary' },
              row(sy.configured ? (sy.signedIn ? sy.email : 'Вход не выполнен') : 'Сервер не подключён', null, { icon: 'cloud', iconColor: 'blue' }),
              sy.configured && sy.signedIn
                ? h('div', { class: 'sync-status-line' },
                    h('span', { class: 'sync-state ' + (sy.error || !sy.online ? 'sync-bad' : sy.busy || sy.pending ? 'sync-wait' : sy.realtime === 'connected' ? 'sync-good' : 'sync-muted') },
                      sy.error ? 'Ошибка синхронизации' : !sy.online ? 'Нет соединения' : sy.busy || sy.pending ? 'Синхронизация…' : sy.realtime === 'connected' ? 'Синхронизировано · онлайн' : sy.realtime === 'connecting' ? 'Подключение…' : sy.lastSyncAt ? 'Синхронизировано · резервный режим' : 'Ожидание синхронизации'))
                : null),
            sy.configured
              ? (sy.signedIn
                ? [h('button', { class: 'row-btn', onclick: () => openAccountSheet(draw) }, 'Личный кабинет'), h('button', { class: 'row-btn', onclick: async () => { await Sync.syncNow(true); draw(); } }, 'Синхронизировать сейчас'), h('button', { class: 'row-btn danger', onclick: async () => { await Sync.signOut(); draw(); } }, 'Выйти')]
                : h('button', { class: 'row-btn', onclick: () => openSignIn(draw) }, 'Войти или создать аккаунт'))
              : h('div', { class: 'row' }, h('span', { class: 'dim small' }, 'Укажите адрес и ключ Supabase в файле config.js. Подробности в README.'))),
          sy.configured ? groupNote('У каждого аккаунта отдельные данные. При первом входе локальные данные объединяются с облачными; перед объединением создаётся резервная копия.') : null,
          groupTitle('Уведомления'),
          group(
            row('Push-уведомления', ps.supported ? (ps.subscribed ? h('span', { class: 'ok-text' }, 'Включены') : ps.permission === 'denied' ? h('span', { class: 'bad-text' }, 'Запрещены') : h('span', { class: 'dim' }, 'Выключены')) : h('span', { class: 'dim' }, 'Недоступны'), { icon: 'bell', iconColor: 'orange' }),
            ps.supported && !ps.subscribed && ps.permission !== 'denied' ? h('button', { class: 'row-btn', onclick: async () => { await Push.enable(); draw(); } }, 'Включить напоминания') : null,
            ps.subscribed ? [h('button', { class: 'row-btn', onclick: () => Push.test() }, 'Отправить тестовое'), h('button', { class: 'row-btn danger', onclick: async () => { await Push.disable(); draw(); } }, 'Выключить')] : null,
            row('Напоминания о задачах', toggle(st.notifyTasks !== false, (v) => { S.setSettings({ notifyTasks: v }); Push.scheduleLocal(); Sync.pushReminders().catch(() => {}); draw(); }), { icon: 'check-square', iconColor: 'blue' }),
            row('Напоминания о событиях', toggle(st.notifyEvents !== false, (v) => { S.setSettings({ notifyEvents: v }); Push.scheduleLocal(); Sync.pushReminders().catch(() => {}); draw(); }), { icon: 'calendar', iconColor: 'red' }),
            row('Время для событий на весь день', selectInput(['07:00', '08:00', '09:00', '10:00', '12:00', '18:00'].map((v) => ({ v, label: v })), st.defaultRemindAt || '09:00', (v) => { S.setSettings({ defaultRemindAt: v }); Push.scheduleLocal(); Sync.pushReminders().catch(() => {}); }))),
          groupNote(ps.supported ? (ps.hint || 'В уведомлении будут название задачи или события и время. На iPhone push работает после установки приложения на экран «Домой» (iOS 16.4+).') : 'Установите приложение на экран «Домой» через «Поделиться → На экран “Домой”», затем включите уведомления.'),
          groupTitle('Данные'),
          group(
            h('button', { class: 'row-btn', onclick: exportData }, 'Экспорт резервной копии'),
            h('button', { class: 'row-btn', onclick: () => importData(api) }, 'Импорт из копии'),
            h('button', { class: 'row-btn danger', onclick: () => actionSheet({ title: 'Удалить все данные?', message: 'Цели, задачи, события и привычки будут удалены на этом устройстве и на остальных после синхронизации.', actions: [{ label: 'Удалить всё', danger: true, onClick: () => { S.resetAll(); toast('Данные удалены'); } }] }) }, 'Удалить все данные')),
          h('div', { class: 'about' }, h('b', null, 'Ритм'), h('span', null, 'Цели, задачи, привычки и календарь в одном месте')),
          h('div', { class: 'sheet-pad' }));
      };
      draw();
      const unsub = Sync.onChange(() => api.body.isConnected && draw());
      void unsub;
    },
  });
}

function exportData() {
  const blob = new Blob([S.exportJSON()], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `ritm-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function importData(api) {
  const inp = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    if (!f) return;
    try { S.importJSON(await f.text(), { replace: true }); toast('Данные восстановлены'); api.close(); } catch (e) { toast(e.message || 'Не удалось прочитать файл'); }
  });
  document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
}

function openSignIn(done) {
  let email = '', pass = '', mode = 'in';
  openSheet({
    title: 'Вход', left: { label: 'Отмена' }, tall: false,
    build(api) {
      const msg = h('div', { class: 'group-note bad-text' });
      const draw = () => {
        clear(api.body);
        api.setTitle(mode === 'in' ? 'Вход' : 'Новый аккаунт');
        api.setRight({ label: mode === 'in' ? 'Войти' : 'Создать', bold: true, onClick: async () => {
          msg.textContent = '';
          if (!email.includes('@') || !pass || (mode === 'up' && pass.length < 8)) { msg.textContent = mode === 'up' ? 'Введите корректный email и пароль (не короче 8 символов)' : 'Введите корректный email и пароль'; return; }
          try {
            const res = mode === 'in' ? await Sync.signIn(email, pass) : await Sync.signUp(email, pass);
            api.close(true); toast('Синхронизация включена'); done && done();
          } catch (e) { msg.textContent = e.message || 'Не удалось войти'; }
        } });
        api.body.append(
          h('button', { class: 'row-btn', onclick: async () => {
            msg.textContent = '';
            try { await Sync.startGoogleOAuth(); }
            catch (e) { msg.textContent = e.message || 'Не удалось открыть Google'; }
          } }, 'Продолжить с Google'),
          groupNote('Или войдите по email и паролю'),
          group(
            h('div', { class: 'row solo' }, h('input', { class: 'inp', type: 'email', placeholder: 'Email', autocomplete: 'email', value: email, oninput: (e) => (email = e.target.value.trim()) })),
            h('div', { class: 'row solo password-row' },
              h('input', { class: 'inp', type: 'password', placeholder: 'Пароль', autocomplete: mode === 'in' ? 'current-password' : 'new-password', value: pass, oninput: (e) => (pass = e.target.value) }),
              h('button', { type: 'button', class: 'password-eye', 'aria-label': 'Показать пароль', title: 'Показать пароль', onclick: (e) => {
                const input = e.currentTarget.parentElement.querySelector('input');
                const visible = input.type === 'password';
                input.type = visible ? 'text' : 'password';
                e.currentTarget.innerHTML = visible
                  ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5.2 0 8.7 4.2 10 7-.4.9-1.2 2.1-2.3 3.2M6.2 6.2C3.9 7.7 2.5 10 2 12c1.3 2.8 4.8 7 10 7 1.2 0 2.3-.2 3.3-.6"/></svg>'
                  : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
                e.currentTarget.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль');
                e.currentTarget.setAttribute('title', visible ? 'Скрыть пароль' : 'Показать пароль');
              } },
              h('svg:svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
                h('svg:path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z' }),
                h('svg:circle', { cx: 12, cy: 12, r: 3 }))))),
          msg,
          mode === 'in' ? h('button', { class: 'link-btn', onclick: () => requestPasswordResetFromSignIn(email, msg) }, 'Забыли пароль?') : null,
          h('button', { class: 'link-btn', onclick: () => { mode = mode === 'in' ? 'up' : 'in'; draw(); } }, mode === 'in' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'),
          h('div', { class: 'sheet-pad' }));
      };
      draw();
    },
  });
}


function openAccountSheet(onChanged) {
  openSheet({
    title: 'Личный кабинет', left: { label: 'Назад' }, tall: true,
    build(api) {
      const message = h('div', { class: 'group-note' }, 'Загружаем профиль…');
      const body = h('div', { class: 'account-profile' });
      api.body.append(body);
      const button = (label, fn, danger = false) => h('button', { class: 'row-btn' + (danger ? ' danger' : ''), onclick: fn }, label);
      const showError = (e) => { message.className = 'group-note bad-text'; message.textContent = e.message || 'Не удалось выполнить действие'; };
      const draw = async () => {
        clear(body);
        body.append(message);
        try {
          const p = await Sync.getProfile();
          message.textContent = '';
          clear(body);
          const avatar = p.avatar
            ? h('img', { class: 'account-avatar', src: p.avatar, alt: '' })
            : h('div', { class: 'account-avatar account-avatar-fallback' }, (p.name || p.email || '?').slice(0, 1).toUpperCase());
          const providers = p.providers.map((x) => x === 'google' ? 'Google' : x === 'email' ? 'Email' : x).join(' · ');
          body.append(
            h('div', { class: 'account-hero' }, avatar,
              h('b', null, p.name || 'Пользователь'),
              h('span', null, p.email || ''),
              h('small', null, providers || 'Аккаунт Ritm')),
            groupTitle('Профиль'),
            group(button('Изменить имя', () => editAccountName(p, draw, showError))),
            groupTitle('Безопасность'),
            group(
              button('Изменить пароль', () => editAccountPassword(draw, showError)),
              button('Изменить Email', () => editAccountEmail(draw, showError)),
              button('Отправить письмо для сброса пароля', async () => {
                try { await Sync.requestPasswordReset(p.email); toast('Письмо для восстановления отправлено'); }
                catch (e) { showError(e); }
              })),
            groupNote('При смене Email Supabase отправит письма для подтверждения. Новый адрес изменится после подтверждения.'),
            groupTitle('Данные и аккаунт'),
            group(button('Удалить аккаунт', () => confirmAccountDeletion(api, onChanged), true)),
            h('div', { class: 'sheet-pad' }));
        } catch (e) { showError(e); }
      };
      draw();
    },
  });
}

function editAccountName(profile, refresh, showError) {
  let name = profile.name || '';
  openSheet({
    title: 'Имя профиля', left: { label: 'Отмена' },
    build(api) {
      const input = h('input', { class: 'inp', type: 'text', maxlength: 60, placeholder: 'Как к вам обращаться', value: name, oninput: (e) => { name = e.target.value; } });
      const msg = h('div', { class: 'group-note' });
      api.body.append(group(input), msg);
      api.setRight({ label: 'Сохранить', bold: true, onClick: async () => {
        try { await Sync.updateProfile(name); api.close(); toast('Имя обновлено'); refresh(); }
        catch (e) { msg.className = 'group-note bad-text'; msg.textContent = e.message; }
      } });
    },
  });
}

function editAccountPassword(refresh, showError) {
  let password = '', repeat = '';
  openSheet({
    title: 'Новый пароль', left: { label: 'Отмена' },
    build(api) {
      const first = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', placeholder: 'Новый пароль (от 8 символов)', oninput: (e) => { password = e.target.value; } });
      const second = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', placeholder: 'Повторите пароль', oninput: (e) => { repeat = e.target.value; } });
      const msg = h('div', { class: 'group-note' });
      const eye = (input) => h('button', { type: 'button', class: 'password-eye', 'aria-label': 'Показать пароль', onclick: (e) => {
        const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
        e.currentTarget.innerHTML = visible
          ? '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5.2 0 8.7 4.2 10 7-.4.9-1.2 2.1-2.3 3.2M6.2 6.2C3.9 7.7 2.5 10 2 12c1.3 2 4.8 7 10 7 1.2 0 2.3-.2 3.3-.6"/></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
      } }, ic('eye', 18));
      const field = (input) => h('div', { class: 'row solo password-row' }, input, eye(input));
      api.body.append(group(field(first), field(second)), msg);
      api.setRight({ label: 'Сохранить', bold: true, onClick: async () => {
        if (password.length < 8) { msg.textContent = 'Пароль должен содержать минимум 8 символов'; return; }
        if (password !== repeat) { msg.textContent = 'Пароли не совпадают'; return; }
        try { await Sync.changePassword(password); api.close(); toast('Пароль изменён'); refresh(); }
        catch (e) { msg.className = 'group-note bad-text'; msg.textContent = e.message; }
      } });
    },
  });
}

function editAccountEmail(refresh) {
  openSheet({
    title: 'Новый Email', left: { label: 'Отмена' },
    build(api) {
      const input = h('input', { class: 'inp', type: 'email', autocomplete: 'email', placeholder: 'Новый email' });
      const msg = h('div', { class: 'group-note' });
      api.body.append(group(input), msg);
      api.setRight({ label: 'Отправить', bold: true, onClick: async () => {
        try { await Sync.changeEmail(input.value); api.close(); toast('Письмо для подтверждения отправлено'); refresh(); }
        catch (e) { msg.className = 'group-note bad-text'; msg.textContent = e.message; }
      } });
    },
  });
}

function confirmAccountDeletion(parentApi, onChanged) {
  actionSheet({
    title: 'Удалить аккаунт Ritm?',
    message: 'Будут безвозвратно удалены аккаунт, облачные цели, задачи, привычки, события и связанные подписки. Экспортируйте резервную копию перед удалением. Это действие нельзя отменить.',
    actions: [{
      label: 'Удалить аккаунт навсегда', danger: true,
      onClick: async () => {
        try {
          await Sync.deleteAccount();
          parentApi.close(true);
          toast('Аккаунт и облачные данные удалены');
          onChanged && onChanged();
        } catch (e) { toast(e.message || 'Не удалось удалить аккаунт'); }
      },
    }],
  });
}

export function openPasswordRecoverySheet() {
  openSheet({
    title: 'Новый пароль', left: null, tall: false,
    build(api) {
      let password = '', repeat = '';
      const first = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', placeholder: 'Новый пароль (от 8 символов)', oninput: (e) => { password = e.target.value; } });
      const second = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', placeholder: 'Повторите пароль', oninput: (e) => { repeat = e.target.value; } });
      const msg = h('div', { class: 'group-note bad-text' });
      api.body.append(group(first, second), msg);
      api.setRight({ label: 'Сохранить', bold: true, onClick: async () => {
        if (password.length < 8) { msg.textContent = 'Пароль должен содержать минимум 8 символов'; return; }
        if (password !== repeat) { msg.textContent = 'Пароли не совпадают'; return; }
        try { await Sync.changePassword(password); api.close(true); await Sync.signOut(); toast('Пароль обновлён. Теперь войдите с новым паролем.'); }
        catch (e) { msg.textContent = e.message || 'Не удалось обновить пароль'; }
      } });
    },
  });
}

function requestPasswordResetFromSignIn(email, message) {
  if (!email || !email.includes('@')) { message.textContent = 'Сначала укажите Email'; return; }
  Sync.requestPasswordReset(email)
    .then(() => { message.className = 'group-note'; message.textContent = 'Письмо для восстановления отправлено, проверьте почту.'; })
    .catch((e) => { message.className = 'group-note bad-text'; message.textContent = e.message || 'Не удалось отправить письмо'; });
}
