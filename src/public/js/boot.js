/* Aplica o tema antes da primeira pintura, evitando flash de cor. Carregado de forma síncrona no <head>. */
(function () {
  try {
    var pref = localStorage.getItem('noxis.theme') || 'dark';
    var resolved = pref === 'system'
      ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : pref;
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-pref', pref);
    var collapsed = localStorage.getItem('noxis.sidebar') === 'collapsed';
    if (collapsed && window.innerWidth > 980) document.documentElement.classList.add('sidebar-collapsed');
  } catch (e) { /* armazenamento indisponível: usa o padrão escuro */ }
})();
