import { $ } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { toast } from '../../core/toast.js';
import { finishSave } from '../../core/modal.js';

export function init() {
  const form = $('#groupForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = form.dataset.groupId;
    const body = { name: form.elements.name.value.trim(), description: form.elements.description.value.trim() };
    const err = $('#groupFormError');
    err.hidden = true;
    try {
      if (id) await api(`/api/groups/${id}`, { method: 'PUT', body });
      else await api('/api/groups', { method: 'POST', body });
      toast(id ? 'Grupo atualizado' : 'Grupo criado', 'up');
      finishSave(form, '/groups');
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message;
    }
  });
}
