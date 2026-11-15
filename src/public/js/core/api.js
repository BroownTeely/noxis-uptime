import { readAppData } from './dom.js';

const appData = readAppData();
export const csrf = appData.csrf || '';

/**
 * Cliente HTTP do painel. Envia JSON, o token CSRF e trata erros de forma
 * uniforme. Lança Error com a mensagem do servidor quando a resposta não é ok.
 */
export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const headers = { Accept: 'application/json', 'X-CSRF-Token': csrf };
  const init = { method, headers, credentials: 'same-origin' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (raw) return res;
  let data = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) data = await res.json();
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error('Sessão expirada');
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.errors?.join(' ') || `Erro ${res.status}`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

export const apiGet = (path) => api(path);
export const apiPost = (path, body) => api(path, { method: 'POST', body: body ?? {} });
export const apiPut = (path, body) => api(path, { method: 'PUT', body });
export const apiPatch = (path, body) => api(path, { method: 'PATCH', body });
export const apiDelete = (path) => api(path, { method: 'DELETE' });
