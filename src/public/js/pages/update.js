import { $ } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, confirmDialog } from '../core/toast.js';

/** Painel de atualização: verificar, baixar e aplicar (com confirmação). */
export function init() {
  $('#checkUpdate')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api('/api/updates/check', { method: 'POST', body: {} });
      toast('Verificação concluída', 'info');
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      toast(err.message, 'down');
      e.currentTarget.disabled = false;
    }
  });

  $('#applyUpdate')?.addEventListener('click', async (e) => {
    const ok = await confirmDialog('Aplicar a atualização agora? O sistema fará backup, instalará a nova versão e reiniciará. A interface ficará indisponível por alguns segundos.', 'Atualizar agora');
    if (!ok) return;
    e.currentTarget.disabled = true;
    toast('Atualizando… não feche esta página', 'warn', 15000);
    try {
      await api('/api/updates/apply', { method: 'POST', body: {} });
      // O servidor reinicia: aguarda e recarrega quando voltar.
      const poll = setInterval(async () => {
        try {
          const r = await fetch('/health', { cache: 'no-store' });
          if (r.ok) { clearInterval(poll); window.location.reload(); }
        } catch (_) { /* ainda reiniciando */ }
      }, 2000);
    } catch (err) {
      toast(err.message, 'down', 8000);
      e.currentTarget.disabled = false;
    }
  });
}
