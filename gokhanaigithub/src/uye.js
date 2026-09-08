/* Site üyeliği — gknsoftware.com ziyaretçilerinin müşteri hesabı.
   Personel hesaplarından (users tablosu, ga_session çerezi) tamamen ayrıdır:
   ayrı tablo, ayrı çerez, ayrı uç noktalar. Bir müşteri hesabı gokhan.ai
   çalışma alanına ya da yönetim paneline erişemez. */
import crypto from 'node:crypto';
import { q } from './db.js';
import { hashPassword, verifyPassword, newSessionToken, hashToken, PASSWORD_MIN } from './auth.js';

const CEREZ = 'ga_uye';
const GUN = 24 * 60 * 60;
const OTURUM_GUN = 30;
const MAX_HATA = 5;
const KILIT_DK = 15;

export async function migrateUye() {
  await q(`
    CREATE TABLE IF NOT EXISTS musteriler (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email         text UNIQUE NOT NULL,
      ad            text NOT NULL DEFAULT '',
      firma         text NOT NULL DEFAULT '',
      telefon       text NOT NULL DEFAULT '',
      sifre_hash    text NOT NULL,
      dil           text NOT NULL DEFAULT 'tr',
      izin_eposta   boolean NOT NULL DEFAULT false,
      hatali        int NOT NULL DEFAULT 0,
      kilit_bitis   timestamptz,
      pasif         boolean NOT NULL DEFAULT false,
      olusturuldu   timestamptz NOT NULL DEFAULT now(),
      son_giris     timestamptz,
      son_ip        text
    )`);
  await q(`
    CREATE TABLE IF NOT EXISTS musteri_oturum (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      musteri_id  uuid NOT NULL REFERENCES musteriler(id) ON DELETE CASCADE,
      token_hash  text UNIQUE NOT NULL,
      ip          text,
      ua          text,
      olusturuldu timestamptz NOT NULL DEFAULT now(),
      biter       timestamptz NOT NULL
    )`);
  await q(`CREATE INDEX IF NOT EXISTS musteri_oturum_biter ON musteri_oturum (biter)`);
  await q(`
    CREATE TABLE IF NOT EXISTS uye_kayit (
      id          bigserial PRIMARY KEY,
      musteri_id  uuid,
      email       text,
      olay        text NOT NULL,
      ip          text,
      ua          text,
      zaman       timestamptz NOT NULL DEFAULT now()
    )`);
}

const cerezOku = (req, ad) => {
  const ham = req.headers.cookie || '';
  for (const p of ham.split(';')) {
    const i = p.indexOf('=');
    if (i > 0 && p.slice(0, i).trim() === ad) return decodeURIComponent(p.slice(i + 1));
  }
  return null;
};

function cerezYaz(res, token, sn, prod) {
  const b = [`${CEREZ}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly',
             'SameSite=Lax', `Max-Age=${sn}`];
  if (prod) b.push('Secure');
  res.setHeader('Set-Cookie', b.join('; '));
}
function cerezSil(res, prod) {
  const b = [`${CEREZ}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (prod) b.push('Secure');
  res.setHeader('Set-Cookie', b.join('; '));
}

const temizEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 160);
const gecerliEmail = (v) => /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(v);
const kirp = (v, n) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, n);

const acik = (m) => ({
  id: m.id, email: m.email, ad: m.ad, firma: m.firma, telefon: m.telefon,
  dil: m.dil, izinEposta: m.izin_eposta,
  olusturuldu: m.olusturuldu, sonGiris: m.son_giris
});

/* ── IP başına kaba sınır ── */
const vurus = new Map();
function sinirli(ip, adet, pencereSn) {
  const now = Date.now();
  const r = vurus.get(ip) || { n: 0, t: now };
  if (now - r.t > pencereSn * 1000) { r.n = 0; r.t = now; }
  r.n++;
  vurus.set(ip, r);
  if (vurus.size > 5000) vurus.clear();
  return r.n > adet;
}

export function mountUye(app, { ipOf, uaOf, PROD }) {
  const kayit = (musteri_id, email, olay, req) =>
    q(`INSERT INTO uye_kayit (musteri_id, email, olay, ip, ua) VALUES ($1,$2,$3,$4,$5)`,
      [musteri_id, email, olay, ipOf(req), uaOf(req)]).catch(() => {});

  /** Oturumdaki müşteriyi getirir; yoksa null. */
  async function uyeGetir(req) {
    const token = cerezOku(req, CEREZ);
    if (!token) return null;
    const { rows } = await q(
      `SELECT m.* FROM musteri_oturum o
         JOIN musteriler m ON m.id = o.musteri_id
        WHERE o.token_hash = $1 AND o.biter > now() AND m.pasif = false`,
      [hashToken(token)]);
    return rows[0] || null;
  }

  async function oturumAc(res, musteri, req) {
    const token = newSessionToken();
    await q(`INSERT INTO musteri_oturum (musteri_id, token_hash, ip, ua, biter)
             VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval)`,
      [musteri.id, hashToken(token), ipOf(req), uaOf(req), String(OTURUM_GUN)]);
    cerezYaz(res, token, OTURUM_GUN * GUN, PROD);
  }

  /* ── kayıt ── */
  app.post('/api/uye/kayit', async (req, res) => {
    const ip = ipOf(req);
    if (sinirli('kayit:' + ip, 5, 3600))
      return res.status(429).json({ error: 'Çok fazla kayıt denemesi. Bir saat sonra tekrar deneyin.' });

    const email = temizEmail(req.body?.email);
    const ad = kirp(req.body?.ad, 80);
    const firma = kirp(req.body?.firma, 120);
    const telefon = kirp(req.body?.telefon, 32);
    const sifre = String(req.body?.sifre || '');
    const dil = ['tr', 'en', 'de'].includes(req.body?.dil) ? req.body.dil : 'tr';
    const izin = !!req.body?.izinEposta;

    if (!ad) return res.status(400).json({ error: 'Ad soyad gerekli.' });
    if (!gecerliEmail(email)) return res.status(400).json({ error: 'Geçerli bir e-posta yazın.' });
    if (sifre.length < PASSWORD_MIN)
      return res.status(400).json({ error: `Şifre en az ${PASSWORD_MIN} karakter olmalı.` });

    const { rows: var_ } = await q('SELECT 1 FROM musteriler WHERE email = $1', [email]);
    if (var_.length) {
      await kayit(null, email, 'kayit.tekrar', req);
      // hesabın var olduğunu ele vermemek için aynı mesaj
      return res.status(409).json({ error: 'Bu e-posta ile kayıt yapılamadı. Giriş yapmayı deneyin.' });
    }

    const { rows } = await q(
      `INSERT INTO musteriler (email, ad, firma, telefon, sifre_hash, dil, izin_eposta)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [email, ad, firma, telefon, await hashPassword(sifre), dil, izin]);
    await kayit(rows[0].id, email, 'kayit', req);
    await oturumAc(res, rows[0], req);
    res.json({ uye: acik(rows[0]) });
  });

  /* ── giriş ── */
  app.post('/api/uye/giris', async (req, res) => {
    const ip = ipOf(req);
    if (sinirli('giris:' + ip, 20, 900))
      return res.status(429).json({ error: 'Çok fazla deneme. Biraz sonra tekrar deneyin.' });

    const email = temizEmail(req.body?.email);
    const sifre = String(req.body?.sifre || '');
    const { rows } = await q('SELECT * FROM musteriler WHERE email = $1', [email]);
    const m = rows[0];

    if (!m || m.pasif) {
      await kayit(null, email, 'giris.basarisiz', req);
      return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
    }
    if (m.kilit_bitis && new Date(m.kilit_bitis) > new Date()) {
      return res.status(423).json({ error: `Hesap geçici olarak kilitli. ${KILIT_DK} dakika sonra deneyin.` });
    }
    if (!(await verifyPassword(sifre, m.sifre_hash))) {
      const yeni = m.hatali + 1;
      if (yeni >= MAX_HATA) {
        await q(`UPDATE musteriler SET hatali = 0, kilit_bitis = now() + ($2 || ' minutes')::interval
                 WHERE id = $1`, [m.id, String(KILIT_DK)]);
      } else {
        await q('UPDATE musteriler SET hatali = $2 WHERE id = $1', [m.id, yeni]);
      }
      await kayit(m.id, email, 'giris.basarisiz', req);
      return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
    }

    await q(`UPDATE musteriler SET hatali = 0, kilit_bitis = NULL,
             son_giris = now(), son_ip = $2 WHERE id = $1`, [m.id, ip]);
    await kayit(m.id, email, 'giris', req);
    await oturumAc(res, m, req);
    res.json({ uye: acik(m) });
  });

  /* ── çıkış ── */
  app.post('/api/uye/cikis', async (req, res) => {
    const token = cerezOku(req, CEREZ);
    if (token) await q('DELETE FROM musteri_oturum WHERE token_hash = $1', [hashToken(token)]);
    cerezSil(res, PROD);
    res.json({ ok: true });
  });

  /* ── ben kimim ── */
  app.get('/api/uye/ben', async (req, res) => {
    const m = await uyeGetir(req);
    if (!m) return res.status(401).json({ error: 'Oturum yok.' });
    res.json({ uye: acik(m) });
  });

  /* ── bilgi güncelle ── */
  app.patch('/api/uye/ben', async (req, res) => {
    const m = await uyeGetir(req);
    if (!m) return res.status(401).json({ error: 'Oturum yok.' });
    const ad = kirp(req.body?.ad, 80) || m.ad;
    const firma = kirp(req.body?.firma, 120);
    const telefon = kirp(req.body?.telefon, 32);
    const izin = !!req.body?.izinEposta;
    const { rows } = await q(
      `UPDATE musteriler SET ad=$2, firma=$3, telefon=$4, izin_eposta=$5
       WHERE id=$1 RETURNING *`, [m.id, ad, firma, telefon, izin]);
    res.json({ uye: acik(rows[0]) });
  });

  /* ── şifre değiştir ── */
  app.post('/api/uye/sifre', async (req, res) => {
    const m = await uyeGetir(req);
    if (!m) return res.status(401).json({ error: 'Oturum yok.' });
    const eski = String(req.body?.eski || ''), yeni = String(req.body?.yeni || '');
    if (!(await verifyPassword(eski, m.sifre_hash)))
      return res.status(400).json({ error: 'Mevcut şifre hatalı.' });
    if (yeni.length < PASSWORD_MIN)
      return res.status(400).json({ error: `Yeni şifre en az ${PASSWORD_MIN} karakter olmalı.` });
    await q('UPDATE musteriler SET sifre_hash = $2 WHERE id = $1', [m.id, await hashPassword(yeni)]);
    // diğer cihazlardaki oturumlar kapansın
    const token = cerezOku(req, CEREZ);
    await q('DELETE FROM musteri_oturum WHERE musteri_id = $1 AND token_hash <> $2',
            [m.id, hashToken(token || '')]);
    await kayit(m.id, m.email, 'sifre.degisti', req);
    res.json({ ok: true });
  });

  /* ── hesabı kapat (KVKK: silme hakkı) ── */
  app.post('/api/uye/kapat', async (req, res) => {
    const m = await uyeGetir(req);
    if (!m) return res.status(401).json({ error: 'Oturum yok.' });
    if (!(await verifyPassword(String(req.body?.sifre || ''), m.sifre_hash)))
      return res.status(400).json({ error: 'Şifre hatalı.' });
    await q('DELETE FROM musteriler WHERE id = $1', [m.id]);
    await kayit(null, m.email, 'hesap.kapatildi', req);
    cerezSil(res, PROD);
    res.json({ ok: true });
  });

  return { uyeGetir };
}
