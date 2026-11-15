/**
 * Sidebar expansível/recolhível. O estado é salvo; em telas pequenas vira um
 * menu deslizante com overlay.
 */
const KEY = 'noxis.sidebar';
const mobileQuery = window.matchMedia('(max-width: 980px)');

export function initSidebar() {
  const app = document.getElementById('app');
  const toggle = document.getElementById('sidebarToggle');
  const mobileBtn = document.getElementById('mobileMenu');
  if (!app) return;

  const collapsed = localStorage.getItem(KEY) === 'collapsed';
  if (collapsed && !mobileQuery.matches) app.classList.add('is-collapsed');
  syncToggle();

  function syncToggle() {
    const isCollapsed = app.classList.contains('is-collapsed');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      toggle.title = isCollapsed ? 'Expandir menu' : 'Recolher menu';
    }
  }

  const setCollapsed = (value) => {
    app.classList.toggle('is-collapsed', value);
    localStorage.setItem(KEY, value ? 'collapsed' : 'expanded');
    syncToggle();
  };
  toggle?.addEventListener('click', () => setCollapsed(true));

  // Menu móvel: overlay + gaveta lateral.
  let scrim = null;
  const closeMobile = () => {
    app.classList.remove('is-mobile-open');
    scrim?.remove();
    scrim = null;
  };
  mobileBtn?.addEventListener('click', () => {
    if (!mobileQuery.matches) {
      // Desktop: as três barras expandem ou recolhem a sidebar.
      setCollapsed(!app.classList.contains('is-collapsed'));
      return;
    }
    app.classList.add('is-mobile-open');
    scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.addEventListener('click', closeMobile);
    document.body.appendChild(scrim);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMobile(); });
  mobileQuery.addEventListener('change', closeMobile);
  document.querySelectorAll('.sidebar .nav-item').forEach((a) => a.addEventListener('click', () => {
    if (mobileQuery.matches) closeMobile();
  }));

  // Menu de perfil
  const profile = document.getElementById('profileMenu');
  if (profile) {
    const btn = profile.querySelector('.profile__btn');
    const menu = profile.querySelector('.menu');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
  }
}
