import { $, $$, esc } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, confirmDialog } from '../core/toast.js';
import { on } from '../core/socket.js';
import { formatDateTime } from '../core/format.js';

function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

async function saveForm(form) {
  try {
    await api('/api/settings', { method: 'PUT', body: formValues(form) });
    toast('Configurações salvas', 'up');
  } catch (err) {
    toast(err.message, 'down');
  }
}

/** Atualiza só os campos presentes no payload (o evento em tempo real não traz todos). */
const lastSystem = {};
function renderSystem(s) {
  Object.assign(lastSystem, Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)));
  const set = (k, v) => { const el = document.querySelector(`[data-sys="${k}"]`); if (el) el.textContent = v; };
  if (lastSystem.nodeVersion) set('node', lastSystem.nodeVersion);
  if (lastSystem.dbSizeKb !== undefined) set('db', `${lastSystem.dbSizeKb} KB`);
  if (lastSystem.uptimeSeconds !== undefined) {
    const u = lastSystem.uptimeSeconds;
    set('uptime', `${Math.floor(u / 3600)}h ${Math.floor((u % 3600) / 60)}min`);
  }
  if (lastSystem.memoryRssMb !== undefined) set('rss', `${lastSystem.memoryRssMb} MB`);
  if (lastSystem.engine) {
    set('running', `${lastSystem.engine.running} / ${lastSystem.engine.maxConcurrent}`);
    set('queued', String(lastSystem.engine.queued));
  }
}

export function init() {
  // Abas
  const tabs = $$('.settings__tabs [data-tab]');
  const panels = $$('[data-tab-panel]');
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    panels.forEach((p) => { p.hidden = p.dataset.tabPanel !== t.dataset.tab; });
    if (t.dataset.tab === 'sistema') loadSystem();
  }));

  $('#settingsForm')?.addEventListener('submit', (e) => { e.preventDefault(); saveForm(e.currentTarget); });
  $('#settingsFormMon')?.addEventListener('submit', (e) => { e.preventDefault(); saveForm(e.currentTarget); });
  $('#settingsFormSec')?.addEventListener('submit', (e) => { e.preventDefault(); saveForm(e.currentTarget); });

  $('#apiKeyForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const scopes = $$('input[name="scopes"]:checked', form).map((c) => c.value);
    try {
      const res = await api('/api/api-keys', { method: 'POST', body: { name: form.elements.name.value, scopes } });
      const box = $('#newKeyBox');
      box.hidden = false;
      box.innerHTML = `<strong>Chave criada.</strong> ${esc(res.note)}<br>${esc(res.key)}`;
      form.reset();
      toast('Chave de API criada', 'up');
    } catch (err) {
      toast(err.message, 'down');
    }
  });

  $('#apiKeysTable')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action="revoke-key"]');
    if (!btn) return;
    if (!(await confirmDialog('Revogar esta chave? Integrações que a usam deixarão de funcionar.', 'Revogar'))) return;
    try {
      await api(`/api/api-keys/${btn.dataset.id}`, { method: 'DELETE' });
      toast('Chave revogada', 'warn');
      setTimeout(() => window.location.reload(), 300);
    } catch (err) { toast(err.message, 'down'); }
  });

  $('#backupNow')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api('/api/system/backups', { method: 'POST', body: {} });
      toast('Backup criado', 'up');
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      toast(err.message, 'down');
      e.currentTarget.disabled = false;
    }
  });

  on('system:stats', (s) => { if (!$('[data-tab-panel="sistema"]').hidden) renderSystem(s); });
  void formatDateTime;
}

async function loadSystem() {
  try {
    const s = await api('/api/system');
    renderSystem(s);
  } catch (_) { /* sem acesso */ }
}
