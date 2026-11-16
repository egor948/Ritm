// Навигация между вкладками и общее «мгновенное» состояние экранов.
import { todayStr } from './util.js';

let handler = () => {};
export const setNavHandler = (fn) => { handler = fn; };
export const go = (tab, patch) => {
  if (patch) Object.assign(view, patch);
  handler(tab);
};

/** Состояние, которое экраны передают друг другу (какую дату открыть, какой фильтр включить). */
export const view = {
  calDate: todayStr(),
  tasksFilter: 'today',
  habitsTab: 'today',
  goalsCategory: 'all',
};
