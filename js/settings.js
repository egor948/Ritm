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
      const draw = () => {
        clear(api.body);
        const list = S.settings().widgets;
        api.body.append(
          groupNote('Включайте нужные виджеты и меняйте порядок стрелками. Изменения видны сразу на экране «Сегодня».'),
          group(...list.map((w, i) => row(WIDGET_NAMES[w.id][0], h('div', { class: 'w-edit' },
            h('button', { class: 'icon-btn', disabled: i === 0, 'aria-label': 'Выше', onclick: () => move(i, -1) }, ic('up', 18)),
            h('button', { class: 'icon-btn', disabled: i === list.length - 1, 'aria-label': 'Ниже', onclick: () => move(i, 1) }, ic('down', 18)),
            toggle(w.on, (v) => { const n = S.settings().widgets.map((x) => (x.id === w.id ? { ...x, on: v } : x)); S.setSettings({ widgets: n }); })), { icon: 'sparkle', iconColor: 'blue' }))),
          h('div', { class: 'sheet-pad' }));
        api.body.querySelectorAll('.row').forEach((r, i) => { const s = h('small', { class: 'row-sub' }, WIDGET_NAMES[list[i].id][1]); r.querySelector('.row-label').appendChild(s); });
      };
      const move = (i, d) => {
        const list = [...S.settings().widgets];
        const j = i + d;
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        S.setSettings({ widgets: list });
        draw();
      };
      draw();
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
            row(sy.configured ? (sy.signedIn ? sy.email : 'Вход не выполнен') : 'Сервер не подключён', sy.configured && sy.signedIn ? h('span', { class: 'dim' }, sy.busy ? 'Синхронизация…' : sy.lastSyncAt ? 'Готово' : '') : null, { icon: 'cloud', iconColor: 'blue' }),
            sy.configured
              ? (sy.signedIn
                ? [h('button', { class: 'row-btn', onclick: async () => { await Sync.syncNow(true); draw(); } }, 'Синхронизировать сейчас'), h('button', { class: 'row-btn danger', onclick: async () => { await Sync.signOut(); draw(); } }, 'Выйти')]
                : h('button', { class: 'row-btn', onclick: () => openSignIn(draw) }, 'Войти или создать аккаунт'))
              : h('div', { class: 'row' }, h('span', { class: 'dim small' }, 'Укажите адрес и ключ Supabase в файле config.js. Подробности в README.'))),
          sy.configured ? groupNote('У каждого аккаунта отдельные данные. При первом входе локальные данные объединяются с облачными; перед объединением создаётся резервная копия.') : null,
          groupTitle('Уведомления'),
          group(
            row('Push-уведомления', ps.supported ? (ps.subscribed ? h('span', { class: 'ok-text' }, 'Включены') : ps.permission === 'denied' ? h('span', { class: 'bad-text' }, 'Запрещены') : h('span', { class: 'dim' }, 'Выключены')) : h('span', { class: 'dim' }, 'Недоступны'), { icon: 'bell', iconColor: 'orange' }),
            ps.supported && !ps.subscribed && ps.permission !== 'denied' ? h('button', { class: 'row-btn', onclick: async () => { await Push.enable(); draw(); } }, 'Включить напоминания') : null,
            ps.subscribed ? [h('button', { class: 'row-btn', onclick: () => Push.test() }, 'Отправить тестовое'), h('button', { class: 'row-btn danger', onclick: async () => { await Push.disable(); draw(); } }, 'Выключить')] : null,
            row('Для дел без времени', selectInput(['07:00', '08:00', '09:00', '10:00', '12:00', '18:00'].map((v) => ({ v, label: v })), st.defaultRemindAt || '09:00', (v) => S.setSettings({ defaultRemindAt: v })))),
          groupNote(ps.supported ? (ps.hint || 'На iPhone push работает после установки приложения на экран «Домой» (iOS 16.4+).') : 'Установите приложение на экран «Домой» через «Поделиться → На экран “Домой”», затем включите уведомления.'),
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
          if (!email.includes('@') || pass.length < 6) { msg.textContent = 'Введите email и пароль (не короче 6 символов)'; return; }
          try {
            const res = mode === 'in' ? await Sync.signIn(email, pass) : await Sync.signUp(email, pass);
            if (res && res.needsConfirm) { msg.textContent = 'Мы отправили письмо — подтвердите адрес и войдите.'; mode = 'in'; return; }
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
                h('svg:circle', { cx: 12, cy: 12, r: 3 })))),
          msg,
          h('button', { class: 'link-btn', onclick: () => { mode = mode === 'in' ? 'up' : 'in'; draw(); } }, mode === 'in' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'),
          h('div', { class: 'sheet-pad' }));
      };
      draw();
    },
  });
}
