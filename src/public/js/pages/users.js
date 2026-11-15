import { $, $$ } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast } from '../core/toast.js';

export function init() {
  $('#usersTable')?.addEventListener('change', async (e) => {
    const row = e.target.closest('tr');
    const id = row?.dataset.userId;
    if (!id) return;
    const body = {};
    if (e.target.dataset.field === 'role') body.role = e.target.value;
    if (e.target.dataset.field === 'active') body.active = e.target.checked;
    try {
      await api(`/api/users/${id}`, { method: 'PATCH', body });
      toast('Usuário atualizado', 'up');
    } catch (err) {
      toast(err.message, 'down');
      setTimeout(() => window.location.reload(), 800);
    }
  });

  const modal = $('#userModal');
  $('#newUserBtn')?.addEventListener('click', () => modal.showModal());
  modal?.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => modal.close()));
  $('#userForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const err = $('#userErrors');
    try {
      await api('/api/users', { method: 'POST', body: Object.fromEntries(fd.entries()) });
      modal.close();
      toast('Usuário criado', 'up');
      setTimeout(() => window.location.reload(), 300);
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message;
    }
  });
  void $$;
}
