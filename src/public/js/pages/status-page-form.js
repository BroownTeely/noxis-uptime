import { $, $$ } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast } from '../core/toast.js';
import { finishSave } from '../core/modal.js';

/** Move a linha do serviço para cima ou para baixo (ordem da página). */
function move(row, dir) {
  const sib = dir === 'up' ? row.previousElementSibling : row.nextElementSibling;
  if (!sib || !sib.classList.contains('sp-row')) return;
  if (dir === 'up') sib.before(row); else sib.after(row);
}

function collect(form) {
  const f = form.elements;
  const items = [];
  for (const row of $$('#spRows .sp-row', form)) {
    if (!row.querySelector('input[name="selected"]').checked) continue;
    items.push({
      monitorId: Number(row.dataset.monitorId),
      groupLabel: row.querySelector('input[name="groupLabel"]').value.trim() || 'Serviços',
    });
  }
  const flag = (n) => !!f[n]?.checked;
  return {
    name: f.name.value.trim(),
    slug: f.slug.value.trim().toLowerCase(),
    title: f.title.value.trim(),
    description: f.description.value.trim(),
    customDomain: f.customDomain.value.trim(),
    isPublic: flag('isPublic'),
    theme: f.theme.value,
    accentColor: f.accentColor.value,
    logoUrl: f.logoUrl.value.trim(),
    faviconUrl: f.faviconUrl.value.trim(),
    showUptime: flag('showUptime'),
    showLatency: flag('showLatency'),
    showHistory: flag('showHistory'),
    showIncidents: flag('showIncidents'),
    showMaintenance: flag('showMaintenance'),
    showDependencies: flag('showDependencies'),
    showFooter: flag('showFooter'),
    items,
  };
}

export function init() {
  const form = $('#statusPageForm');
  if (!form) return;

  $('#spRows').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-move]');
    if (btn) move(btn.closest('.sp-row'), btn.dataset.move);
  });

  $('#regenToken')?.addEventListener('click', async (e) => {
    const id = e.currentTarget.dataset.id;
    try {
      await api(`/api/status-pages/${id}/token`, { method: 'POST', body: {} });
      toast('Novo token gerado. O link anterior foi invalidado.', 'up');
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      toast(err.message, 'down');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = form.dataset.pageId;
    const errBox = $('#spErrors');
    errBox.hidden = true;
    $('#spSave').disabled = true;
    try {
      const body = collect(form);
      if (id) await api(`/api/status-pages/${id}`, { method: 'PUT', body });
      else await api('/api/status-pages', { method: 'POST', body });
      toast('Status page salva', 'up');
      finishSave(form, '/status-pages');
    } catch (err) {
      errBox.hidden = false;
      errBox.innerHTML = (err.details?.error || err.message).replace(/</g, '&lt;');
      $('#spSave').disabled = false;
    }
  });
}
