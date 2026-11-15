import { $, $$, esc } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, confirmDialog } from '../core/toast.js';
import { formatDateTime } from '../core/format.js';

const dialog = () => $('#channelModal');
const form = () => $('#channelForm');
const STATUS_LABEL = { sent: 'enviado', failed: 'falhou', simulated: 'simulado' };

/** Mostra apenas os campos do tipo escolhido e desativa os demais (não são enviados). */
function applyType() {
  const type = form().elements.type.value;
  $$('[data-for-type]', form()).forEach((block) => {
    const show = block.dataset.forType === type;
    block.hidden = !show;
    $$('input, select, textarea', block).forEach((f) => { f.disabled = !show; });
  });
  $('#channelModalTitle').textContent = form().dataset.mode === 'edit' ? 'Editar canal' : 'Novo canal';
}

function resetForm() {
  form().reset();
  form().elements.id.value = '';
  form().elements.enabled.checked = true;
  form().elements.type.value = 'discord';
  $$('input[type="checkbox"]', form()).forEach((cb) => { if (cb.name !== 'enabled') cb.checked = false; });
  form().elements.priority.value = '4';
  $('#channelErrors').hidden = true;
  form().dataset.mode = 'create';
  form().elements.webhookUrl.placeholder = 'https://discord.com/api/webhooks/...';
  form().elements.token.placeholder = 'Mantido se vazio';
  form().elements.secret.placeholder = 'Mantido se vazio';
  applyType();
}

function fillForm(channel) {
  resetForm();
  const f = form();
  form().dataset.mode = 'edit';
  f.elements.id.value = channel.id;
  f.elements.type.value = channel.type;
  f.elements.name.value = channel.name;
  f.elements.enabled.checked = channel.enabled;
  const c = channel.config || {};
  if (channel.type === 'discord') {
    f.elements.webhookUrl.placeholder = c.webhookUrl || 'Mantido';
    f.elements.mentionUserIds.value = (c.mentionUserIds || []).join(', ');
    f.elements.mentionRoleIds.value = (c.mentionRoleIds || []).join(', ');
  } else if (channel.type === 'ntfy') {
    f.elements.serverUrl.value = c.serverUrl || '';
    f.elements.topic.value = c.topic || '';
    f.elements.priority.value = c.priority || 4;
    f.elements.token.placeholder = c.token ? 'Mantido' : 'Sem token';
  } else if (channel.type === 'telegram') {
    f.elements.chatId.value = c.chatId || '';
    f.elements.botToken.placeholder = c.botToken ? 'Mantido' : 'Token do bot';
  } else if (channel.type === 'webhook') {
    f.elements.url.value = c.url || '';
    f.elements.secret.placeholder = c.secret ? 'Mantido' : 'Sem segredo';
  }
  const check = (name, values) => $$(`input[name="${name}"]`, f).forEach((cb) => { cb.checked = values.includes(cb.value) || values.includes(Number(cb.value)); });
  check('events', channel.events);
  check('mentionOn', c.mentionOn || []);
  check('monitorIds', channel.monitorIds);
  check('groupIds', channel.groupIds);
  applyType();
}

function collect() {
  const f = form();
  const list = (v) => String(v || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const checked = (name) => $$(`input[name="${name}"]:checked`, f).map((cb) => cb.value);
  const type = f.elements.type.value;
  const body = {
    type,
    name: f.elements.name.value.trim(),
    enabled: f.elements.enabled.checked,
    events: checked('events'),
    monitorIds: checked('monitorIds').map(Number),
    groupIds: checked('groupIds').map(Number),
  };
  if (type === 'discord') {
    Object.assign(body, {
      webhookUrl: f.elements.webhookUrl.value.trim(),
      mentionOn: checked('mentionOn'),
      mentionUserIds: list(f.elements.mentionUserIds.value),
      mentionRoleIds: list(f.elements.mentionRoleIds.value),
    });
  } else if (type === 'ntfy') {
    Object.assign(body, {
      serverUrl: f.elements.serverUrl.value.trim(),
      topic: f.elements.topic.value.trim(),
      priority: Number(f.elements.priority.value) || 4,
      token: f.elements.token.value,
    });
  } else if (type === 'telegram') {
    Object.assign(body, { botToken: f.elements.botToken.value.trim(), chatId: f.elements.chatId.value.trim() });
  } else {
    Object.assign(body, { url: f.elements.url.value.trim(), secret: f.elements.secret.value });
  }
  return body;
}

async function refreshPreview() {
  const kind = $('#previewKind').value;
  const box = $('#embedBox');
  try {
    const { payload } = await api('/api/channels/preview', { method: 'POST', body: { kind } });
    const e = payload.embeds[0];
    box.style.borderLeftColor = `#${e.color.toString(16).padStart(6, '0')}`;
    box.innerHTML = `
      <div class="embed__title">${esc(e.title)}</div>
      <div class="embed__desc">${esc(e.description)}</div>
      <div class="embed__fields">${e.fields.map((f) => `
        <div><div class="embed__field-name">${esc(f.name)}</div><div class="embed__field-value">${esc(f.value)}</div></div>`).join('')}</div>
      <div class="embed__footer">${esc(e.footer.text)} · ${esc(formatDateTime(e.timestamp))}</div>`;
  } catch (err) {
    box.textContent = err.message;
  }
}

export function init() {
  form().elements.type.addEventListener('change', applyType);
  $('#newChannelBtn')?.addEventListener('click', () => { resetForm(); dialog().showModal(); refreshPreview(); });
  $('#previewBtn')?.addEventListener('click', refreshPreview);
  $('#previewKind')?.addEventListener('change', refreshPreview);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  form().addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = form().elements.id.value;
    const body = collect();
    try {
      if (id) await api(`/api/channels/${id}`, { method: 'PUT', body });
      else await api('/api/channels', { method: 'POST', body });
      dialog().close();
      toast('Canal salvo', 'up');
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      $('#channelErrors').hidden = false;
      $('#channelErrors').textContent = err.details?.error || err.message;
    }
  });

  $('#channelList')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.action;
    try {
      if (act === 'edit') {
        const { channel } = await api(`/api/channels/${id}`);
        fillForm(channel);
        dialog().showModal();
        if (channel.type === 'discord') refreshPreview();
      } else if (act === 'test') {
        btn.disabled = true;
        const r = await api(`/api/channels/${id}/test`, { method: 'POST', body: {} });
        const ok = r.ok || r.state === 'simulated';
        toast(r.state === 'simulated' ? 'Simulação: nenhuma mensagem foi enviada' : ok ? 'Mensagem de teste enviada' : `Falha no envio: ${r.error || r.status}`, ok ? 'up' : 'down');
        btn.disabled = false;
        if (!ok) setTimeout(() => window.location.reload(), 600);
      } else if (act === 'log') {
        const { log } = await api(`/api/channels/${id}`);
        $('#logBody').innerHTML = (log || []).map((l) => `<tr>
          <td class="mono">${esc(formatDateTime(l.createdAt))}</td><td>${esc(l.event)}</td>
          <td><span class="badge badge--${l.status === 'sent' ? 'up' : l.status === 'simulated' ? 'unknown' : 'down'}">${esc(STATUS_LABEL[l.status] || l.status)}</span></td>
          <td class="mono">${l.httpStatus ?? '—'}</td><td>${l.attempts}</td><td class="muted truncate">${esc(l.error || '')}</td></tr>`).join('')
          || '<tr><td colspan="6" class="empty">Nenhum envio registrado</td></tr>';
        $('#logModal').showModal();
      } else if (act === 'delete') {
        if (!(await confirmDialog('Excluir este canal?', 'Excluir'))) return;
        await api(`/api/channels/${id}`, { method: 'DELETE' });
        btn.closest('.channel').remove();
        toast('Canal excluído', 'warn');
      }
    } catch (err) {
      toast(err.message, 'down');
    }
  });
}
