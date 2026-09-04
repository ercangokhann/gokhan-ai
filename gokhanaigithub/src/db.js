import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[boot] DATABASE_URL tanımlı değil.');
  process.exit(1);
}

export const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000
});

export async function q(text, params) {
  return pool.query(text, params);
}

export async function migrate() {
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username        text UNIQUE NOT NULL,
      display_name    text NOT NULL DEFAULT '',
      email           text NOT NULL DEFAULT '',
      password_hash   text NOT NULL,
      role            text NOT NULL DEFAULT 'operator',
      must_change     boolean NOT NULL DEFAULT true,
      disabled        boolean NOT NULL DEFAULT false,
      failed_attempts integer NOT NULL DEFAULT 0,
      locked_until    timestamptz,
      last_login_at   timestamptz,
      last_login_ip   text,
      created_at      timestamptz NOT NULL DEFAULT now()
    )`);

  // daha eski kurulumlar için
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT ''`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip text`);

  await q(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY,
      user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      ip         text,
      ua         text
    )`);

  await q(`
    CREATE TABLE IF NOT EXISTS audit (
      id           bigserial PRIMARY KEY,
      at           timestamptz NOT NULL DEFAULT now(),
      actor        text,
      actor_name   text,
      actor_email  text,
      action       text NOT NULL,
      detail       text,
      ip           text,
      ua           text,
      ok           boolean
    )`);

  await q(`ALTER TABLE audit ADD COLUMN IF NOT EXISTS actor_name text`);
  await q(`ALTER TABLE audit ADD COLUMN IF NOT EXISTS actor_email text`);
  await q(`ALTER TABLE audit ADD COLUMN IF NOT EXISTS ua text`);
  await q(`ALTER TABLE audit ADD COLUMN IF NOT EXISTS ok boolean`);

  // cihaz kimliği: tarayıcıya yazılan kalıcı rastgele kimlik + pasif parmak izi özeti
  await q(`ALTER TABLE audit ADD COLUMN IF NOT EXISTS device_id text`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_id text`);

  await q(`
    CREATE TABLE IF NOT EXISTS devices (
      id          bigserial PRIMARY KEY,
      user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id   text NOT NULL,
      label       text,
      first_ip    text,
      last_ip     text,
      first_seen  timestamptz NOT NULL DEFAULT now(),
      last_seen   timestamptz NOT NULL DEFAULT now(),
      logins      integer NOT NULL DEFAULT 1,
      UNIQUE (user_id, device_id)
    )`);

  // KVKK aydınlatma onayı — kim, ne zaman, hangi sürümü onayladı
  await q(`
    CREATE TABLE IF NOT EXISTS consents (
      id          bigserial PRIMARY KEY,
      user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      version     text NOT NULL,
      accepted_at timestamptz NOT NULL DEFAULT now(),
      ip          text,
      ua          text,
      device_id   text
    )`);
  await q(`CREATE INDEX IF NOT EXISTS consent_user_idx ON consents (user_id, accepted_at DESC)`);

  await q(`CREATE INDEX IF NOT EXISTS audit_at_idx ON audit (at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS audit_action_idx ON audit (action)`);
  await q(`CREATE INDEX IF NOT EXISTS sessions_exp_idx ON sessions (expires_at)`);
}

/**
 * Denetim kaydı. Kim (kimlik/isim/e-posta), ne yaptı, nereden (IP), hangi cihazla.
 * e = { actor, name, email, action, detail, ip, ua, ok }
 */
export async function audit(e) {
  try {
    await q(
      `INSERT INTO audit (actor, actor_name, actor_email, action, detail, ip, ua, ok, device_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [e.actor || null, e.name || null, e.email || null, e.action,
       e.detail || null, e.ip || null, (e.ua || '').slice(0, 250) || null,
       typeof e.ok === 'boolean' ? e.ok : null, e.device || null]);
  } catch (err) {
    console.error('[audit]', err.message);
  }
}
