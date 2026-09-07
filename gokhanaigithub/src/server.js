import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, migrate, audit, pool } from './db.js';
import {
  hashPassword, verifyPassword, newSessionToken, hashToken,
  tempPassword, passwordProblem, validUsername, validEmail, PASSWORD_MIN
} from './auth.js';
import { chatRouter, migrateChat } from './chat.js';
import { mountSor } from './sor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const PROD = process.env.NODE_ENV === 'production';
const COOKIE = 'ga_session';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

/* ── yardımcılar ─────────────────────────────────────── */

const ipOf = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
const uaOf = (req) => String(req.headers['user-agent'] || '').slice(0, 250);
/** Tarayıcıya yazılan kalıcı cihaz kimliği — MAC adresi internetten görülemez,
    bunun yerine cihazı ayırt etmeye yarayan kendi ürettiğimiz kimliği kullanıyoruz. */
const devOf = (req) => String(req.headers['x-ga-device'] || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80) || null;

/** Aydınlatma metni sürümü — metin değişince burayı artır, herkes yeniden onaylar. */
const PRIVACY_VERSION = process.env.PRIVACY_VERSION || '2026-09-04';

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

function setSessionCookie(res, token, maxAgeSec) {
  const bits = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (PROD) bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}

function clearSessionCookie(res) {
  const bits = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (PROD) bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}

const publicUser = (u) => ({
  id: u.id, username: u.username, displayName: u.display_name, email: u.email, role: u.role,
  mustChange: u.must_change, disabled: u.disabled, lockedUntil: u.locked_until,
  lastLoginAt: u.last_login_at, lastLoginIp: u.last_login_ip, createdAt: u.created_at
});

async function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const { rows } = await q(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`, [hashToken(token)]);
  const u = rows[0];
  if (!u || u.disabled) return null;
  return u;
}

/** CSRF: SameSite=Strict + her yazma isteğinde özel başlık şartı. */
function csrfGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (req.headers['x-ga-request'] !== '1') return res.status(403).json({ error: 'İstek reddedildi.' });
  next();
}

async function requireAuth(req, res, next) {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'Oturum yok veya süresi doldu.' });
  req.user = u;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekli.' });
  next();
}

// IP başına kaba hız sınırı (bellekte)
const hits = new Map();
function throttle(req, res, next) {
  const key = ipOf(req), now = Date.now();
  const rec = hits.get(key) || { n: 0, t: now };
  if (now - rec.t > 60000) { rec.n = 0; rec.t = now; }
  rec.n++;
  hits.set(key, rec);
  if (hits.size > 5000) hits.clear();
  if (rec.n > 40) return res.status(429).json({ error: 'Çok fazla deneme. Bir dakika bekleyin.' });
  next();
}

const actorOf = (req) => ({
  actor: req.user.username, name: req.user.display_name, email: req.user.email,
  ip: ipOf(req), ua: uaOf(req), device: devOf(req)
});

/* Siteden gelen herkese açık soru kutusu — CSRF korumasından önce bağlanıyor,
   çünkü gknsoftware.com'dan çapraz köken isteği geliyor ve oturum kullanmıyor. */
mountSor(app, ipOf);

app.use('/api', csrfGuard);

/* ── oturum ──────────────────────────────────────────── */

app.post('/api/login', throttle, async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const keep = !!req.body?.keep;
  const ip = ipOf(req), ua = uaOf(req), device = devOf(req);

  if (!username || !password) return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });

  // kimlik alanına e-posta da yazılabilsin
  const { rows } = await q(
    'SELECT * FROM users WHERE username = $1 OR (email <> \'\' AND lower(email) = $1)', [username]);
  const u = rows[0];

  if (!u) {
    await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'); // sabit süre
    await audit({ actor: username, action: 'login.fail', detail: 'bilinmeyen kullanıcı', ip, ua, device, ok: false });
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  }

  const who = { actor: u.username, name: u.display_name, email: u.email, ip, ua, device };

  if (u.disabled) {
    await audit({ ...who, action: 'login.blocked', detail: 'hesap devre dışı', ok: false });
    return res.status(403).json({ error: 'Bu hesap devre dışı bırakılmış.' });
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(u.locked_until) - Date.now()) / 60000);
    await audit({ ...who, action: 'login.locked', detail: `kilit sürüyor (${mins} dk)`, ok: false });
    return res.status(423).json({ error: `Hesap geçici olarak kilitli. ${mins} dk sonra tekrar deneyin.` });
  }

  if (!(await verifyPassword(password, u.password_hash))) {
    const n = u.failed_attempts + 1;
    const lock = n >= MAX_FAILED ? `now() + interval '${LOCK_MINUTES} minutes'` : 'locked_until';
    await q(`UPDATE users SET failed_attempts=$1, locked_until=${lock} WHERE id=$2`, [n, u.id]);
    await audit({ ...who, action: 'login.fail', detail: `hatalı şifre (${n}/${MAX_FAILED})`, ok: false });
    if (n >= MAX_FAILED) {
      return res.status(423).json({ error: `Çok fazla hatalı deneme. Hesap ${LOCK_MINUTES} dakika kilitlendi.` });
    }
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.', remaining: MAX_FAILED - n });
  }

  const token = newSessionToken();
  const hours = keep ? 12 : 1;
  await q(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip, ua, device_id)
     VALUES ($1,$2, now() + ($3 || ' hours')::interval, $4, $5, $6)`,
    [hashToken(token), u.id, String(hours), ip, ua, device]);
  await q('UPDATE users SET failed_attempts=0, locked_until=NULL, last_login_at=now(), last_login_ip=$2 WHERE id=$1', [u.id, ip]);
  // cihaz tanıma: daha önce görülmemiş cihazdan giriş ayrıca işaretlenir
  let yeniCihaz = false;
  if (device) {
    const { rows: dev } = await q(
      `INSERT INTO devices (user_id, device_id, label, first_ip, last_ip)
       VALUES ($1,$2,$3,$4,$4)
       ON CONFLICT (user_id, device_id)
       DO UPDATE SET last_seen = now(), last_ip = EXCLUDED.last_ip, logins = devices.logins + 1
       RETURNING logins`, [u.id, device, ua.slice(0, 120), ip]);
    yeniCihaz = dev[0]?.logins === 1;
  }
  await audit({ ...who, action: yeniCihaz ? 'login.newdevice' : 'login.ok',
                detail: (yeniCihaz ? 'YENİ CİHAZ · ' : '') + `oturum ${hours} saat`, ok: true });

  setSessionCookie(res, token, hours * 3600);
  res.json({ ok: true, user: publicUser(u) });
});

app.post('/api/logout', async (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) {
    const { rows } = await q('DELETE FROM sessions WHERE token_hash=$1 RETURNING user_id', [hashToken(token)]);
    if (rows[0]) {
      const { rows: u } = await q('SELECT * FROM users WHERE id=$1', [rows[0].user_id]);
      if (u[0]) await audit({
        actor: u[0].username, name: u[0].display_name, email: u[0].email,
        action: 'logout', ip: ipOf(req), ua: uaOf(req), ok: true
      });
    }
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'Oturum yok.' });
  const { rows } = await q(
    'SELECT 1 FROM consents WHERE user_id=$1 AND version=$2 LIMIT 1', [u.id, PRIVACY_VERSION]);
  res.json({ user: publicUser(u), onay: { gerekli: !rows[0], surum: PRIVACY_VERSION } });
});

/* ── KVKK aydınlatma onayı ────────────────────────────── */

app.post('/api/consent', requireAuth, async (req, res) => {
  if (String(req.body?.version || '') !== PRIVACY_VERSION) {
    return res.status(400).json({ error: 'Aydınlatma metni güncellenmiş, sayfayı yenileyin.' });
  }
  await q(`INSERT INTO consents (user_id, version, ip, ua, device_id) VALUES ($1,$2,$3,$4,$5)`,
    [req.user.id, PRIVACY_VERSION, ipOf(req), uaOf(req), devOf(req)]);
  await audit({ ...actorOf(req), action: 'consent.accept', detail: 'sürüm ' + PRIVACY_VERSION, ok: true });
  res.json({ ok: true });
});

app.get('/api/consents', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await q(`
    SELECT u.username, u.display_name, u.email,
           c.version, c.accepted_at, c.ip, c.ua, c.device_id
    FROM users u
    LEFT JOIN LATERAL (
      SELECT * FROM consents c2 WHERE c2.user_id = u.id ORDER BY accepted_at DESC LIMIT 1
    ) c ON true
    ORDER BY u.created_at ASC`);
  res.json({ rows, surum: PRIVACY_VERSION });
});

app.get('/api/devices', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await q(`
    SELECT d.device_id, d.label, d.first_ip, d.last_ip, d.first_seen, d.last_seen, d.logins,
           u.username, u.display_name, u.email
    FROM devices d JOIN users u ON u.id = d.user_id
    ORDER BY d.last_seen DESC LIMIT 200`);
  res.json({ devices: rows });
});

/* ── kendi şifresini değiştirme ───────────────────────── */

app.post('/api/password', requireAuth, async (req, res) => {
  const current = String(req.body?.current || '');
  const next = String(req.body?.next || '');

  if (!(await verifyPassword(current, req.user.password_hash))) {
    await audit({ ...actorOf(req), action: 'password.change.fail', detail: 'mevcut şifre hatalı', ok: false });
    return res.status(401).json({ error: 'Mevcut şifre hatalı.' });
  }
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem });
  if (current === next) return res.status(400).json({ error: 'Yeni şifre eskisiyle aynı olamaz.' });

  await q('UPDATE users SET password_hash=$1, must_change=false WHERE id=$2', [await hashPassword(next), req.user.id]);
  const token = readCookie(req, COOKIE);
  await q('DELETE FROM sessions WHERE user_id=$1 AND token_hash <> $2', [req.user.id, hashToken(token || '')]);
  await audit({ ...actorOf(req), action: 'password.change', detail: 'kendi şifresini değiştirdi', ok: true });
  res.json({ ok: true });
});

/* ── yönetici: kullanıcılar ───────────────────────────── */

app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await q('SELECT * FROM users ORDER BY created_at ASC');
  res.json({ users: rows.map(publicUser) });
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const displayName = String(req.body?.displayName || '').trim().slice(0, 80);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 120);
  const role = req.body?.role === 'admin' ? 'admin' : 'operator';

  if (!validUsername(username)) {
    return res.status(400).json({ error: 'Kullanıcı adı 3-32 karakter olmalı; küçük harf, rakam, nokta, tire ve alt çizgi kullanın.' });
  }
  if (!displayName) return res.status(400).json({ error: 'Ad soyad gerekli.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin.' });

  const { rows: dupe } = await q('SELECT 1 FROM users WHERE username=$1 OR lower(email)=$2', [username, email]);
  if (dupe[0]) return res.status(409).json({ error: 'Bu kullanıcı adı veya e-posta zaten kayıtlı.' });

  const temp = tempPassword();
  const { rows } = await q(
    `INSERT INTO users (username, display_name, email, password_hash, role, must_change)
     VALUES ($1,$2,$3,$4,$5,true) RETURNING *`,
    [username, displayName, email, await hashPassword(temp), role]);
  await audit({ ...actorOf(req), action: 'user.create', detail: `${username} · ${email} · ${role}`, ok: true });
  res.json({ user: publicUser(rows[0]), tempPassword: temp });
});

app.post('/api/users/:id/reset', requireAuth, requireAdmin, async (req, res) => {
  const temp = tempPassword();
  const { rows } = await q(
    `UPDATE users SET password_hash=$1, must_change=true, failed_attempts=0, locked_until=NULL
     WHERE id=$2 RETURNING *`, [await hashPassword(temp), req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  await q('DELETE FROM sessions WHERE user_id=$1', [req.params.id]);
  await audit({ ...actorOf(req), action: 'password.reset', detail: `${rows[0].username} · ${rows[0].email}`, ok: true });
  res.json({ user: publicUser(rows[0]), tempPassword: temp });
});

app.post('/api/users/:id/unlock', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await q('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=$1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  await audit({ ...actorOf(req), action: 'user.unlock', detail: rows[0].username, ok: true });
  res.json({ user: publicUser(rows[0]) });
});

app.patch('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { rows: cur } = await q('SELECT * FROM users WHERE id=$1', [req.params.id]);
  const target = cur[0];
  if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

  const disabled = typeof req.body?.disabled === 'boolean' ? req.body.disabled : target.disabled;
  const role = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'operator' ? 'operator' : target.role;
  const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim().slice(0, 80) : target.display_name;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 120) : target.email;

  if (email && !validEmail(email)) return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin.' });
  if (email !== target.email) {
    const { rows: dupe } = await q('SELECT 1 FROM users WHERE lower(email)=$1 AND id<>$2', [email, target.id]);
    if (dupe[0]) return res.status(409).json({ error: 'Bu e-posta başka bir hesapta kayıtlı.' });
  }
  if (target.id === req.user.id && (disabled || role !== 'admin')) {
    return res.status(400).json({ error: 'Kendi hesabınızı devre dışı bırakamaz veya yetkinizi düşüremezsiniz.' });
  }
  if (target.role === 'admin' && (role !== 'admin' || disabled)) {
    const { rows: admins } = await q(`SELECT count(*)::int c FROM users WHERE role='admin' AND disabled=false`);
    if (admins[0].c <= 1) return res.status(400).json({ error: 'Sistemde en az bir aktif yönetici kalmalı.' });
  }

  const { rows } = await q(
    'UPDATE users SET disabled=$1, role=$2, display_name=$3, email=$4 WHERE id=$5 RETURNING *',
    [disabled, role, displayName, email, target.id]);
  if (disabled) await q('DELETE FROM sessions WHERE user_id=$1', [target.id]);
  await audit({ ...actorOf(req), action: 'user.update', detail: `${target.username} → ${role}${disabled ? ', devre dışı' : ''}`, ok: true });
  res.json({ user: publicUser(rows[0]) });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz.' });
  const { rows: cur } = await q('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!cur[0]) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  if (cur[0].role === 'admin') {
    const { rows: admins } = await q(`SELECT count(*)::int c FROM users WHERE role='admin' AND disabled=false`);
    if (admins[0].c <= 1) return res.status(400).json({ error: 'Sistemde en az bir yönetici kalmalı.' });
  }
  await q('DELETE FROM users WHERE id=$1', [req.params.id]);
  await audit({ ...actorOf(req), action: 'user.delete', detail: `${cur[0].username} · ${cur[0].email}`, ok: true });
  res.json({ ok: true });
});

/* ── yönetici: kayıtlar ───────────────────────────────── */

app.get('/api/log', requireAuth, requireAdmin, async (req, res) => {
  const scope = req.query.scope === 'all' ? 'all' : 'login';
  const search = String(req.query.q || '').trim().toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 100, 300);

  const where = [];
  const params = [];
  if (scope === 'login') where.push(`action LIKE 'login%'`);
  if (search) {
    params.push('%' + search + '%');
    where.push(`(lower(coalesce(actor,'')) LIKE $${params.length}
              OR lower(coalesce(actor_name,'')) LIKE $${params.length}
              OR lower(coalesce(actor_email,'')) LIKE $${params.length}
              OR coalesce(ip,'') LIKE $${params.length})`);
  }
  params.push(limit);
  const { rows } = await q(
    `SELECT id, at, actor, actor_name, actor_email, action, detail, ip, ua, ok, device_id
     FROM audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY at DESC LIMIT $${params.length}`, params);
  res.json({ events: rows });
});

app.get('/api/sessions', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await q(
    `SELECT s.token_hash, s.created_at, s.expires_at, s.ip, s.ua, s.device_id,
            u.username, u.display_name, u.email
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.expires_at > now() ORDER BY s.created_at DESC LIMIT 100`);
  res.json({ sessions: rows.map(r => ({
    id: r.token_hash.slice(0, 12), createdAt: r.created_at, expiresAt: r.expires_at,
    ip: r.ip, ua: r.ua, deviceId: r.device_id,
    username: r.username, displayName: r.display_name, email: r.email
  })) });
});

/* ── sohbet ve yapay zeka ─────────────────────────────── */

app.use('/api', chatRouter({ requireAuth, audit, actorOf }));

/* ── sayfalar ────────────────────────────────────────── */

app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: PROD ? '1h' : 0 }));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

/* ── açılış ──────────────────────────────────────────── */

async function bootstrapAdmin() {
  const { rows } = await q('SELECT count(*)::int c FROM users');
  if (rows[0].c > 0) return;

  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const name = process.env.ADMIN_DISPLAY_NAME || 'Yönetici';
  const pw = process.env.ADMIN_PASSWORD || tempPassword();

  await q(
    `INSERT INTO users (username, display_name, email, password_hash, role, must_change)
     VALUES ($1,$2,$3,$4,'admin',true)`,
    [username, name, email, await hashPassword(pw)]);
  await audit({ actor: 'system', action: 'bootstrap', detail: `ilk yönetici: ${username}`, ok: true });

  console.log('\n' + '='.repeat(58));
  console.log('  İLK YÖNETİCİ HESABI OLUŞTURULDU');
  console.log('  kimlik : ' + username);
  console.log('  şifre  : ' + pw);
  console.log('  (ilk girişte değiştirmeniz istenecek)');
  console.log('='.repeat(58) + '\n');
}

async function sweep() {
  try {
    await q('DELETE FROM sessions WHERE expires_at < now()');
    await q(`DELETE FROM audit WHERE at < now() - interval '180 days'`);
  } catch {}
}


/* ── uyanık tutma ─────────────────────────────────────
   Render ücretsiz planda 15 dakika dış trafik gelmezse servisi uyutuyor ve
   uyanması ~1 dakika sürüyor. Mesai saatlerinde kendi genel adresimize istek
   atıp uyanık kalıyoruz; geceleri uyumasına izin veriyoruz ki ücretsiz plandaki
   aylık çalışma saati kotası dolmasın (750 saat).                            */
const SELF_URL   = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || '';
const AWAKE_FROM = Number(process.env.AWAKE_FROM_UTC ?? 4);   // 07:00 Türkiye
const AWAKE_TO   = Number(process.env.AWAKE_TO_UTC ?? 18);    // 21:00 Türkiye

function keepAwake() {
  if (!SELF_URL) return;
  setInterval(() => {
    const h = new Date().getUTCHours();
    if (h < AWAKE_FROM || h >= AWAKE_TO) return;
    fetch(SELF_URL + '/healthz').catch(() => {});
  }, 10 * 60 * 1000);
  console.log(`[boot] uyanık tutma açık · ${SELF_URL} · UTC ${AWAKE_FROM}:00-${AWAKE_TO}:00`);
}

const PORT = process.env.PORT || 3000;
migrate()
  .then(migrateChat)
  .then(bootstrapAdmin)
  .then(() => {
    setInterval(sweep, 30 * 60 * 1000);
    keepAwake();
    app.listen(PORT, () => console.log(`[boot] gokhan.ai dinlemede :${PORT} (min şifre ${PASSWORD_MIN})`));
  })
  .catch((e) => { console.error('[boot] başarısız:', e); process.exit(1); });

process.on('SIGTERM', () => pool.end().finally(() => process.exit(0)));
