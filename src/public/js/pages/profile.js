import { $ } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast } from '../core/toast.js';

export function init() {
  $('#passwordForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const box = $('#pwErrors');
    box.hidden = true;
    try {
      const res = await api('/api/auth/password', { method: 'POST', body: Object.fromEntries(fd.entries()) });
      toast('Senha alterada. Entre novamente.', 'up');
      window.location.href = res.redirect || '/login';
    } catch (err) {
      box.hidden = false;
      box.textContent = err.message;
    }
  });
}
