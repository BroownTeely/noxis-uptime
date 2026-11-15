'use strict';

/**
 * Migrations versionadas. Cada entrada é aplicada uma única vez e registrada em
 * schema_migrations. Não altere migrations já publicadas; adicione uma nova.
 */
const migrations = [
  {
    id: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
        active INTEGER NOT NULL DEFAULT 1,
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_expires ON sessions(expires_at);

      CREATE TABLE monitor_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE monitors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        target TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        tags TEXT NOT NULL DEFAULT '[]',
        group_id INTEGER REFERENCES monitor_groups(id) ON DELETE SET NULL,
        interval_seconds INTEGER NOT NULL DEFAULT 60,
        timeout_seconds INTEGER NOT NULL DEFAULT 10,
        retries INTEGER NOT NULL DEFAULT 2,
        latency_threshold_ms INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'PENDING',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_latency_ms INTEGER,
        last_message TEXT,
        last_check_at TEXT,
        next_check_at TEXT,
        last_status_change_at TEXT,
        push_token TEXT UNIQUE,
        last_push_at TEXT,
        last_ssl_alert_at TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_monitors_group ON monitors(group_id);
      CREATE INDEX idx_monitors_status ON monitors(status);

      CREATE TABLE monitor_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        checked_at TEXT NOT NULL,
        ok INTEGER NOT NULL,
        status TEXT NOT NULL,
        latency_ms INTEGER,
        message TEXT,
        details TEXT
      );
      CREATE INDEX idx_checks_monitor_time ON monitor_checks(monitor_id, checked_at);
      CREATE INDEX idx_checks_time ON monitor_checks(checked_at);

      CREATE TABLE incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER REFERENCES monitors(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT,
        severity TEXT NOT NULL DEFAULT 'major' CHECK (severity IN ('minor','major','critical')),
        status TEXT NOT NULL DEFAULT 'investigating'
          CHECK (status IN ('investigating','identified','monitoring','resolved')),
        started_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        auto_created INTEGER NOT NULL DEFAULT 1,
        acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        acknowledged_at TEXT
      );
      CREATE INDEX idx_incidents_status ON incidents(status);
      CREATE INDEX idx_incidents_monitor ON incidents(monitor_id, status);

      CREATE TABLE incident_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
        status TEXT,
        message TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_incident_updates_incident ON incident_updates(incident_id);

      CREATE TABLE monitor_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER REFERENCES monitors(id) ON DELETE CASCADE,
        previous_status TEXT,
        new_status TEXT NOT NULL,
        message TEXT,
        duration_seconds INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_events_time ON monitor_events(created_at);
      CREATE INDEX idx_events_monitor ON monitor_events(monitor_id, created_at);

      CREATE TABLE maintenance_windows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        monitor_ids TEXT NOT NULL DEFAULT '[]',
        group_ids TEXT NOT NULL DEFAULT '[]',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE notification_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'discord',
        config TEXT NOT NULL DEFAULT '{}',
        events TEXT NOT NULL DEFAULT '[]',
        monitor_ids TEXT NOT NULL DEFAULT '[]',
        group_ids TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_sent_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE notification_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER REFERENCES notification_channels(id) ON DELETE CASCADE,
        event TEXT NOT NULL,
        title TEXT,
        status TEXT NOT NULL,
        http_status INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_notif_log_time ON notification_log(created_at);

      CREATE TABLE api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        scopes TEXT NOT NULL DEFAULT 'read',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        last_used_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        username TEXT,
        action TEXT NOT NULL,
        entity TEXT,
        entity_id TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        details TEXT,
        ip TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_audit_time ON audit_logs(created_at);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `,
  },
  {
    id: 2,
    name: 'dependencies_and_status_pages',
    up: `
      CREATE TABLE monitor_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        depends_on_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        required INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (monitor_id, depends_on_id),
        CHECK (monitor_id <> depends_on_id)
      );
      CREATE INDEX idx_deps_depends_on ON monitor_dependencies(depends_on_id);

      CREATE TABLE status_pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        is_public INTEGER NOT NULL DEFAULT 1,
        theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark','light','auto')),
        accent_color TEXT NOT NULL DEFAULT '#22d3ee',
        logo_url TEXT,
        favicon_url TEXT,
        custom_domain TEXT UNIQUE,
        show_latency INTEGER NOT NULL DEFAULT 1,
        show_uptime INTEGER NOT NULL DEFAULT 1,
        show_history INTEGER NOT NULL DEFAULT 1,
        show_incidents INTEGER NOT NULL DEFAULT 1,
        show_maintenance INTEGER NOT NULL DEFAULT 1,
        show_dependencies INTEGER NOT NULL DEFAULT 0,
        show_footer INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE status_page_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status_page_id INTEGER NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
        monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        group_label TEXT NOT NULL DEFAULT 'Serviços',
        position INTEGER NOT NULL DEFAULT 0,
        UNIQUE (status_page_id, monitor_id)
      );
      CREATE INDEX idx_spi_page ON status_page_items(status_page_id, position);
    `,
  },
  {
    id: 3,
    name: 'status_page_access_token',
    up: `
      ALTER TABLE status_pages ADD COLUMN access_token TEXT;
    `,
  },
];

function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`);
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  const record = db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)');
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(migration.up);
      record.run(migration.id, migration.name);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw new Error(`Falha na migration ${migration.id} (${migration.name}): ${err.message}`);
    }
  }
}

module.exports = { migrations, runMigrations };
