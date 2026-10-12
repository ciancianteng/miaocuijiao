-- MEOW CUI JIAO service catalog, order requirement snapshots, and technical certification.
-- The local dev server persists the same model in data/mcj-ops.sqlite.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  price_min NUMERIC,
  price_max NUMERIC,
  unit TEXT NOT NULL DEFAULT '每小时',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requirement_fields (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'textarea', 'radio', 'checkbox', 'select', 'number')),
  options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  show_boss BOOLEAN NOT NULL DEFAULT TRUE,
  show_companion BOOLEAN NOT NULL DEFAULT TRUE,
  show_order_detail BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS companions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  game TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offerings (
  companion_id TEXT NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  quote_price NUMERIC,
  intro TEXT NOT NULL DEFAULT '',
  show_on_card BOOLEAN NOT NULL DEFAULT FALSE,
  show_price BOOLEAN NOT NULL DEFAULT FALSE,
  show_intro BOOLEAN NOT NULL DEFAULT FALSE,
  show_badge BOOLEAN NOT NULL DEFAULT FALSE,
  accept_orders BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (companion_id, service_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  boss_id TEXT NOT NULL,
  boss_name TEXT NOT NULL,
  companion_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit_price NUMERIC NOT NULL,
  total_price NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  service_snapshot_json JSONB NOT NULL,
  requirements_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cert_applications (
  id TEXT PRIMARY KEY,
  companion_id TEXT NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  cert_item TEXT NOT NULL,
  tech_level TEXT NOT NULL,
  exam_note TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  proof TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cert_reviews (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES cert_applications(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS badges (
  id TEXT PRIMARY KEY,
  companion_id TEXT NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES cert_applications(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  cert_item TEXT NOT NULL,
  tech_level TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS examiners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  wechat TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  qq TEXT NOT NULL DEFAULT '',
  telegram TEXT NOT NULL DEFAULT '',
  game TEXT NOT NULL,
  exam_note TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
