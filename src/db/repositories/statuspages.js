'use strict';

const { getDatabase, transaction } = require('../connection');

const FLAGS = ['show_latency', 'show_uptime', 'show_history', 'show_incidents', 'show_maintenance', 'show_dependencies', 'show_footer'];

function map(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    title: row.title,
    description: row.description,
    isPublic: !!row.is_public,
    theme: row.theme,
    accentColor: row.accent_color,
    logoUrl: row.logo_url,
    faviconUrl: row.favicon_url,
    customDomain: row.custom_domain,
    showLatency: !!row.show_latency,
    showUptime: !!row.show_uptime,
    showHistory: !!row.show_history,
    showIncidents: !!row.show_incidents,
    showMaintenance: !!row.show_maintenance,
    showDependencies: !!row.show_dependencies,
    showFooter: !!row.show_footer,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const statusPagesRepo = {
  list() {
    return getDatabase().prepare('SELECT * FROM status_pages ORDER BY name COLLATE NOCASE').all().map((r) => {
      const page = map(r);
      page.itemCount = getDatabase().prepare('SELECT COUNT(*) AS n FROM status_page_items WHERE status_page_id = ?').get(r.id).n;
      return page;
    });
  },
  findById(id) {
    return map(getDatabase().prepare('SELECT * FROM status_pages WHERE id = ?').get(id));
  },
  findBySlug(slug) {
    return map(getDatabase().prepare('SELECT * FROM status_pages WHERE slug = ?').get(slug));
  },
  findByDomain(domain) {
    return map(getDatabase().prepare('SELECT * FROM status_pages WHERE custom_domain = ?').get(domain));
  },
  items(pageId) {
    return getDatabase()
      .prepare('SELECT monitor_id, group_label, position FROM status_page_items WHERE status_page_id = ? ORDER BY position, id')
      .all(pageId)
      .map((r) => ({ monitorId: r.monitor_id, groupLabel: r.group_label, position: r.position }));
  },
  /** Cria ou atualiza a página. `values` usa os nomes camelCase do validador. */
  save(id, v, userId = null) {
    const cols = {
      name: v.name, slug: v.slug, title: v.title, description: v.description || null,
      is_public: v.isPublic ? 1 : 0, theme: v.theme, accent_color: v.accentColor,
      logo_url: v.logoUrl || null, favicon_url: v.faviconUrl || null, custom_domain: v.customDomain || null,
      show_latency: v.showLatency ? 1 : 0, show_uptime: v.showUptime ? 1 : 0, show_history: v.showHistory ? 1 : 0,
      show_incidents: v.showIncidents ? 1 : 0, show_maintenance: v.showMaintenance ? 1 : 0,
      show_dependencies: v.showDependencies ? 1 : 0, show_footer: v.showFooter ? 1 : 0,
    };
    return transaction(() => {
      const db = getDatabase();
      let pageId = id;
      if (!id) {
        const keys = Object.keys(cols);
        const info = db.prepare(`INSERT INTO status_pages (${keys.join(',')}, created_by)
          VALUES (${keys.map(() => '?').join(',')}, ?)`).run(...keys.map((k) => cols[k]), userId);
        pageId = Number(info.lastInsertRowid);
      } else {
        const sets = Object.keys(cols).map((k) => `${k} = ?`).join(', ');
        db.prepare(`UPDATE status_pages SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
          .run(...Object.keys(cols).map((k) => cols[k]), id);
      }
      db.prepare('DELETE FROM status_page_items WHERE status_page_id = ?').run(pageId);
      const insert = db.prepare('INSERT INTO status_page_items (status_page_id, monitor_id, group_label, position) VALUES (?, ?, ?, ?)');
      v.items.forEach((item, idx) => insert.run(pageId, item.monitorId, item.groupLabel, idx));
      return pageId;
    });
  },
  tokenOf(id) {
    const row = getDatabase().prepare('SELECT access_token FROM status_pages WHERE id = ?').get(id);
    return row ? row.access_token : null;
  },
  setToken(id, token) {
    getDatabase().prepare('UPDATE status_pages SET access_token = ? WHERE id = ?').run(token, id);
  },
  remove(id) {
    getDatabase().prepare('DELETE FROM status_pages WHERE id = ?').run(id);
  },
  FLAGS,
};

module.exports = statusPagesRepo;
