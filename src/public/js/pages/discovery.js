import { $, $$, esc } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast } from '../core/toast.js';

let current = null;

function renderRows() {
  const onlyOpen = $('#onlyOpen').checked;
  const rows = (current?.results || []).filter((r) => !onlyOpen || r.open);
  const body = $('#scanTable tbody');
  if (!current) return;
  body.innerHTML = rows.length
    ? rows.map((r) => `<tr>
        <td>${r.open ? `<input type="checkbox" data-port="${r.port}" aria-label="Criar monitor para a porta ${r.port}">` : ''}</td>
        <td class="mono">${r.port}</td>
        <td><span class="badge badge--${r.open ? 'up' : 'unknown'}">${r.open ? 'Aberta' : 'Fechada'}</span></td>
        <td>${r.open ? esc(r.service) : '<span class="muted">—</span>'}</td>
        <td class="num mono">${r.latencyMs !== null ? r.latencyMs + ' ms' : '—'}</td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">Nenhuma porta aberta encontrada</td></tr>';
  updateCreateButton();
}

function updateCreateButton() {
  $('#createSelected').disabled = !$$('#scanTable input[data-port]:checked').length;
}

export function init() {
  const form = $('#discoveryForm');
  const customField = $('#customPortsField');
  $$('input[name="preset"]').forEach((r) => r.addEventListener('change', () => {
    const custom = form.elements.preset.value === 'custom';
    customField.hidden = !custom;
    form.elements.ports.disabled = !custom;
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#scanBtn');
    const err = $('#scanError');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Verificando…';
    try {
      const custom = form.elements.preset.value === 'custom';
      current = await api('/api/discovery/ports', {
        method: 'POST',
        body: {
          host: form.elements.host.value.trim(),
          ports: custom ? form.elements.ports.value.trim() : 'common',
          authorized: form.elements.authorized.checked,
        },
      });
      $('#scanSummary').textContent = `${current.openCount} aberta(s) de ${current.scannedPorts} em ${current.host} · ${(current.durationMs / 1000).toFixed(1)} s`;
      renderRows();
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Verificar portas';
    }
  });

  $('#onlyOpen').addEventListener('change', renderRows);
  $('#scanTable').addEventListener('change', (e) => {
    if (e.target.matches('input[data-port]')) updateCreateButton();
  });

  $('#createSelected').addEventListener('click', async (e) => {
    const picked = $$('#scanTable input[data-port]:checked').map((i) => Number(i.dataset.port));
    if (!picked.length || !current) return;
    e.currentTarget.disabled = true;
    let created = 0;
    const failed = [];
    for (const port of picked) {
      const row = current.results.find((r) => r.port === port);
      try {
        await api('/api/monitors', {
          method: 'POST',
          body: {
            name: `${row.service} (${current.host}:${port})`.slice(0, 120),
            type: 'tcp',
            target: current.host,
            port,
            intervalSeconds: 60,
            timeoutSeconds: 3,
            retries: 2,
            tags: ['descoberta'],
          },
        });
        created += 1;
      } catch (ex) {
        failed.push(`${port}: ${ex.message}`);
      }
    }
    toast(`${created} monitor(es) criado(s)${failed.length ? `, ${failed.length} com erro` : ''}`, failed.length ? 'warn' : 'up', 5000);
    if (created) setTimeout(() => { window.location.href = '/monitors'; }, 800);
    else e.currentTarget.disabled = false;
  });
}
