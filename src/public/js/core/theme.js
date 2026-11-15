/**
 * Gerencia o tema: claro, escuro ou padrão do sistema (prefers-color-scheme).
 * A preferência é salva localmente e aplicada sem recarregar a página.
 */
const KEY = 'noxis.theme';
const media = window.matchMedia('(prefers-color-scheme: light)');

function resolve(pref) {
  if (pref === 'system') return media.matches ? 'light' : 'dark';
  return pref;
}

export function getPreference() {
  return localStorage.getItem(KEY) || 'dark';
}

export function applyTheme(pref) {
  const root = document.documentElement;
  root.setAttribute('data-theme-pref', pref);
  root.setAttribute('data-theme', resolve(pref));
  document.querySelectorAll('[data-theme-value]').forEach((btn) => {
    btn.setAttribute('aria-checked', String(btn.dataset.themeValue === pref));
  });
}

export function setPreference(pref) {
  document.body.classList.add('theme-transition');
  localStorage.setItem(KEY, pref);
  applyTheme(pref);
  setTimeout(() => document.body.classList.remove('theme-transition'), 300);
}

export function initTheme() {
  applyTheme(getPreference());
  media.addEventListener('change', () => {
    if (getPreference() === 'system') applyTheme('system');
  });
  document.querySelectorAll('[data-theme-value]').forEach((btn) => {
    btn.addEventListener('click', () => setPreference(btn.dataset.themeValue));
  });
}
