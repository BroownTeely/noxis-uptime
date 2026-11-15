import { $, $$ } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast } from '../core/toast.js';
import { finishSave } from '../core/modal.js';

const HINTS = {
  http: 'Verifica status HTTP. Use "Status esperado" para aceitar códigos diferentes de 2xx.',
  api: 'Chamada de API: método, corpo JSON, autenticação e validação da resposta.',
  keyword: 'Verifica se o texto informado aparece (ou não) na resposta HTTP.',
  json: 'Lê o JSON da resposta e compara o valor do caminho informado.',
  tcp: 'Confirma se a porta aceita conexões TCP.',
  ping: 'Envia pacotes ICMP. Requer o utilitário ping instalado no servidor.',
  dns: 'Resolve o registro informado e opcionalmente compara o resultado.',
  ssl: 'Lê o certificado e alerta antes do vencimento.',
  push: 'Recebe sinais periódicos de scripts ou CRON. Falha se o sinal atrasar.',
  docker: 'Consulta o estado do container pela Docker API, somente leitura.',
};

const form = () => $('#monitorForm');
const typeSelect = () => $('#typeSelect') || form()?.querySelector('input[type="hidden"][name="type"]');

/** Mostra apenas as seções do tipo escolhido e desativa campos ocultos. */
function applyType() {
  const type = typeSelect()?.value || 'http';
  $$('[data-for-type]', form()).forEach((section) => {
    const types = section.dataset.forType.split(' ');
    const visible = types.includes(type);
    section.hidden = !visible;
    $$('input, select, textarea', section).forEach((f) => { f.disabled = !visible; });
  });
  const hint = $('#typeHint');
  if (hint) hint.textContent = HINTS[type] || '';
  // Campo "target" é compartilhado entre tipos: habilita apenas o visível.
  const targetVisible = $$('input[name="target"]', form()).find((i) => !i.disabled);
  $$('input[name="target"]', form()).forEach((i) => { i.disabled = i !== targetVisible; });
}

/** Coleta somente campos habilitados (visíveis para o tipo atual). */
function collect() {
  const data = {};
  const fd = new FormData(form());
  for (const [key, value] of fd.entries()) {
    // Campos com o mesmo nome (ex.: target de HTTP e de TCP) existem em seções diferentes:
    // usa apenas o que está habilitado, que é o que FormData já inclui.
    const field = form().querySelector(`[name="${key}"]:not([disabled])`);
    if (!field) continue;
    if (field.type === 'checkbox') {
      data[key] = field.checked;
      continue;
    }
    if (key === 'groupId') data.groupId = value ? Number(value) : null;
    else if (['intervalSeconds', 'timeoutSeconds', 'retries', 'latencyThresholdMs', 'port'].includes(key)) {
      data[key] = value === '' ? null : Number(value);
    } else if (key === 'name' || key === 'type' || key === 'target') {
      data[key] = value.trim();
    } else if (key === 'tags' || key === 'headers' || key === 'requestBody') {
      data[key] = value;
    } else {
      data[key] = value;
    }
  }
  // Checkboxes ausentes do FormData são false.
  for (const cb of $$('input[type="checkbox"]', form())) {
    if (!cb.disabled && !(cb.name in data)) data[cb.name] = false;
  }
  if (data.type === 'http' || data.type === 'keyword' || data.type === 'json') {
    data.requestBody = data.requestBody ?? '';
  }
  // Campos de autenticação em branco não sobrescrevem segredos já salvos.
  for (const key of ['authPassword', 'authToken', 'authApiKeyValue']) {
    if (data[key] === '') delete data[key];
  }
  if (!data.authType) data.authType = '';
  return data;
}

function showErrors(list) {
  const box = $('#formErrors');
  if (!list?.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = list.map((e) => `<div>${e}</div>`).join('');
}

function showTest(result) {
  const box = $('#testResult');
  box.hidden = false;
  box.className = `test-result ${result.ok ? 'is-ok' : 'is-fail'}`;
  const lat = result.latencyMs !== null && result.latencyMs !== undefined ? ` · ${result.latencyMs} ms` : '';
  box.textContent = `${result.ok ? 'Sucesso' : 'Falha'}${lat} — ${result.message || ''}`;
}

export function init() {
  typeSelect()?.addEventListener('change', applyType);
  applyType();

  const f = form();
  const id = f.dataset.monitorId;

  $('#testBtn')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Executando...';
    try {
      const data = collect();
      data.active = true;
      const result = await api('/api/monitors/test', { method: 'POST', body: data });
      showTest(result);
    } catch (err) {
      showErrors(err.details?.errors || [err.message]);
    } finally {
      e.currentTarget.disabled = false;
      e.currentTarget.textContent = 'Executar verificação de teste';
    }
  });

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#saveBtn');
    btn.disabled = true;
    try {
      const data = collect();
      if (id) {
        await api(`/api/monitors/${id}`, { method: 'PUT', body: data });
        toast('Monitor atualizado', 'up');
        finishSave(f, `/monitors/${id}`);
      } else {
        const { monitor } = await api('/api/monitors', { method: 'POST', body: data });
        toast('Monitor criado', 'up');
        finishSave(f, `/monitors/${monitor.id}`);
      }
    } catch (err) {
      showErrors(err.details?.errors || [err.message]);
      btn.disabled = false;
    }
  });
}
