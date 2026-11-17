/* Teklif ve hizmet talepleri.
   - Sitedeki form (gokhansoftware.com, çapraz köken, oturumsuz) → POST /api/teklif
   - Üye paneli (aynı köken, ga_uye çerezi)                       → /api/uye/talepler
   - Yönetim paneli (personel, yönetici)                          → /api/yonetim/talepler
   Her talep veritabanına yazılır; SMTP ayarlıysa info@ adresine bildirim ve
   gönderene alındı e-postası gider. SMTP yoksa talep yine kaybolmaz, panelde görünür. */
import nodemailer from 'nodemailer';
import { q } from './db.js';
import { izinli } from './sor.js';

export const HIZMETLER = {
  bakim:     { tr: 'Aylık BT bakımı ve destek',          en: 'Monthly IT maintenance and support', de: 'Monatliche IT-Betreuung und Support' },
  saglik:    { tr: 'Ücretsiz BT Sağlık Raporu',          en: 'Free IT health check',               de: 'Kostenloser IT-Gesundheitscheck' },
  ag:        { tr: 'Ağ ve güvenlik duvarı kurulumu',     en: 'Network and firewall setup',         de: 'Netzwerk- und Firewall-Einrichtung' },
  guvenlik:  { tr: 'Siber güvenlik ve KVKK',             en: 'Cyber security and data protection', de: 'IT-Sicherheit und Datenschutz' },
  yazilim:   { tr: 'Size özel yazılım',                  en: 'Custom software',                    de: 'Individuelle Software' },
  eposta:    { tr: 'Kurumsal e-posta',                   en: 'Business e-mail',                    de: 'Geschäftliche E-Mail' },
  tedarik:   { tr: 'Donanım ve lisans tedariki',         en: 'Hardware and licence supply',        de: 'Hardware- und Lizenzbeschaffung' },
  diger:     { tr: 'Diğer',                              en: 'Other',                              de: 'Sonstiges' },
};
export const DURUMLAR = ['yeni', 'inceleniyor', 'teklif', 'tamamlandi', 'kapandi'];

const MSG = {
  tr: { ad: 'Ad soyad gerekli.', email: 'Geçerli bir e-posta yazın.', tel: 'Telefon numarası gerekli.',
        hizmet: 'Hizmet türünü seçin.', mesaj: 'Mesajınızı yazın (en az 10 karakter).', kvkk: 'Aydınlatma metnini onaylayın.',
        cok: 'Kısa sürede çok fazla talep gönderildi. Lütfen biraz sonra tekrar deneyin ya da bizi arayın.',
        hata: 'Talep şu an alınamadı. Lütfen 0501 051 96 60 numarasından bize ulaşın.' },
  en: { ad: 'Please enter your full name.', email: 'Please enter a valid e-mail address.', tel: 'Please enter a phone number.',
        hizmet: 'Please choose a service.', mesaj: 'Please write your message (at least 10 characters).', kvkk: 'Please accept the privacy notice.',
        cok: 'Too many requests in a short time. Please try again shortly or call us.',
        hata: 'We could not receive your request right now. Please call +90 501 051 96 60.' },
  de: { ad: 'Bitte geben Sie Ihren Namen ein.', email: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.', tel: 'Bitte geben Sie eine Telefonnummer ein.',
        hizmet: 'Bitte wählen Sie eine Leistung.', mesaj: 'Bitte schreiben Sie Ihre Nachricht (mindestens 10 Zeichen).', kvkk: 'Bitte bestätigen Sie die Datenschutzhinweise.',
        cok: 'Zu viele Anfragen in kurzer Zeit. Bitte versuchen Sie es später erneut oder rufen Sie uns an.',
        hata: 'Ihre Anfrage konnte gerade nicht angenommen werden. Bitte rufen Sie +90 501 051 96 60 an.' },
};

export async function migrateTeklif() {
  await q(`
    CREATE TABLE IF NOT EXISTS talepler (
      id           bigserial PRIMARY KEY,
      ad           text NOT NULL,
      email        text NOT NULL,
      telefon      text NOT NULL DEFAULT '',
      firma        text NOT NULL DEFAULT '',
      hizmet       text NOT NULL,
      mesaj        text NOT NULL,
      tercih_tarih date,
      dil          text NOT NULL DEFAULT 'tr',
      kaynak       text NOT NULL DEFAULT 'site',
      sayfa        text NOT NULL DEFAULT '',
      musteri_id   uuid,
      durum        text NOT NULL DEFAULT 'yeni',
      yanit        text NOT NULL DEFAULT '',
      eposta_ok    boolean NOT NULL DEFAULT false,
      ip           text,
      ua           text,
      olusturuldu  timestamptz NOT NULL DEFAULT now(),
      guncellendi  timestamptz NOT NULL DEFAULT now()
    )`);
  await q(`CREATE INDEX IF NOT EXISTS talepler_email ON talepler (lower(email))`);
  await q(`CREATE INDEX IF NOT EXISTS talepler_tarih ON talepler (olusturuldu DESC)`);
}

/* ── e-posta ── */
const HEDEF = process.env.TEKLIF_TO || 'info@gokhansoftware.com';
let tasiyici = null;
function postaci() {
  if (tasiyici !== null) return tasiyici;
  const host = process.env.SMTP_HOST, user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn('[teklif] SMTP ayarlı değil — talepler yalnızca veritabanına yazılacak.');
    tasiyici = false;
    return tasiyici;
  }
  const port = Number(process.env.SMTP_PORT || 465);
  tasiyici = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  return tasiyici;
}
export const smtpVar = () => !!postaci();

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function bildir(t) {
  const p = postaci();
  if (!p) return false;
  const from = `"GOKHAN SOFTWARE" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`;
  const hz = (HIZMETLER[t.hizmet] || HIZMETLER.diger).tr;
  const satir = (k, v) => v ? `<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top">${k}</td><td style="padding:6px 0">${esc(v)}</td></tr>` : '';
  try {
    await p.sendMail({
      from, to: HEDEF, replyTo: `"${t.ad.replace(/"/g, '')}" <${t.email}>`,
      subject: `Yeni talep #${t.id} · ${hz} · ${t.ad}${t.firma ? ' (' + t.firma + ')' : ''}`,
      text: [`Yeni talep #${t.id}`, `Hizmet: ${hz}`, `Ad soyad: ${t.ad}`, `Firma: ${t.firma || '-'}`,
             `E-posta: ${t.email}`, `Telefon: ${t.telefon || '-'}`,
             t.tercih_tarih ? `Tercih edilen tarih: ${t.tercih_tarih}` : '',
             `Kaynak: ${t.kaynak} ${t.sayfa || ''} · Dil: ${t.dil}`, '', t.mesaj].filter(Boolean).join('\n'),
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:600px">
        <h2 style="margin:0 0 12px;font-size:18px">Yeni talep #${t.id}</h2>
        <table cellpadding="0" cellspacing="0">${satir('Hizmet', hz)}${satir('Ad soyad', t.ad)}${satir('Firma', t.firma)}
        ${satir('E-posta', t.email)}${satir('Telefon', t.telefon)}${satir('Tercih edilen tarih', t.tercih_tarih)}
        ${satir('Kaynak', `${t.kaynak} ${t.sayfa || ''} · ${t.dil}`)}</table>
        <div style="margin-top:14px;padding:12px 14px;background:#f5f2eb;border-radius:8px;white-space:pre-wrap">${esc(t.mesaj)}</div>
        <p style="color:#888;font-size:12px;margin-top:14px">Yanıtla tuşuna basmanız müşteriye yazar. Durumu yönetim panelindeki Talepler sekmesinden güncelleyin.</p></div>`
    });
    // gönderene alındı bilgisi
    const AL = {
      tr: ['Talebiniz alındı', `Merhaba ${t.ad},\n\n"${hz}" konulu talebiniz bize ulaştı (talep no: #${t.id}). Aynı iş günü içinde size dönüş yapacağız.\n\nAcil durumlarda: 0501 051 96 60 (telefon / WhatsApp)\n\nGOKHAN SOFTWARE\ngokhansoftware.com`],
      en: ['We received your request', `Hello ${t.ad},\n\nYour request about "${(HIZMETLER[t.hizmet] || HIZMETLER.diger).en}" has reached us (request no. #${t.id}). We will get back to you within the same business day.\n\nUrgent: +90 501 051 96 60 (phone / WhatsApp)\n\nGOKHAN SOFTWARE\ngokhansoftware.com`],
      de: ['Ihre Anfrage ist eingegangen', `Guten Tag ${t.ad},\n\nIhre Anfrage zu „${(HIZMETLER[t.hizmet] || HIZMETLER.diger).de}" ist bei uns eingegangen (Anfrage-Nr. #${t.id}). Wir melden uns noch am selben Werktag.\n\nDringend: +90 501 051 96 60 (Telefon / WhatsApp)\n\nGOKHAN SOFTWARE\ngokhansoftware.com`],
    }[t.dil] || null;
    if (AL) await p.sendMail({ from, to: t.email, replyTo: HEDEF, subject: `${AL[0]} · #${t.id}`, text: AL[1] }).catch((e) => console.error('[teklif] alındı e-postası', e?.message));
    await q('UPDATE talepler SET eposta_ok = true WHERE id = $1', [t.id]);
    return true;
  } catch (e) {
    console.error('[teklif] e-posta gönderilemedi:', e?.message || e);
    return false;
  }
}

/* ── doğrulama ── */
const kirp = (v, n) => String(v ?? '').trim().replace(/[ \t]+/g, ' ').slice(0, n);
const gecerliEmail = (v) => /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(v);

function topla(body, dil) {
  const M = MSG[dil];
  const t = {
    ad: kirp(body?.ad, 80),
    email: kirp(body?.email, 160).toLowerCase(),
    telefon: kirp(body?.telefon, 32),
    firma: kirp(body?.firma, 120),
    hizmet: HIZMETLER[body?.hizmet] ? body.hizmet : '',
    mesaj: String(body?.mesaj ?? '').trim().slice(0, 4000),
    tercih_tarih: /^\d{4}-\d{2}-\d{2}$/.test(String(body?.tarih || '')) ? body.tarih : null,
    sayfa: kirp(body?.sayfa, 120),
    dil,
  };
  let hata = null;
  if (!t.ad) hata = M.ad;
  else if (!gecerliEmail(t.email)) hata = M.email;
  else if (t.telefon.replace(/\D/g, '').length < 7) hata = M.tel;
  else if (!t.hizmet) hata = M.hizmet;
  else if (t.mesaj.length < 10) hata = M.mesaj;
  return { t, hata };
}

async function kaydet(t, kaynak, musteriId, ip, ua) {
  const { rows } = await q(
    `INSERT INTO talepler (ad, email, telefon, firma, hizmet, mesaj, tercih_tarih, dil, kaynak, sayfa, musteri_id, ip, ua)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [t.ad, t.email, t.telefon, t.firma, t.hizmet, t.mesaj, t.tercih_tarih, t.dil, kaynak, t.sayfa, musteriId, ip, ua]);
  const kayit = rows[0];
  kayit.tercih_tarih = t.tercih_tarih;
  bildir(kayit); // yanıtı bekletmeden
  return kayit;
}

/* ── IP başına sınır ── */
const vurus = new Map();
function sinirli(anahtar, adet, sn) {
  const now = Date.now(), r = vurus.get(anahtar) || { n: 0, t: now };
  if (now - r.t > sn * 1000) { r.n = 0; r.t = now; }
  r.n++; vurus.set(anahtar, r);
  if (vurus.size > 5000) vurus.clear();
  return r.n > adet;
}

const disari = (r) => ({
  id: r.id, hizmet: r.hizmet, mesaj: r.mesaj, tercihTarih: r.tercih_tarih,
  durum: r.durum, yanit: r.yanit, olusturuldu: r.olusturuldu, guncellendi: r.guncellendi
});

/** Herkese açık uç. csrfGuard'dan ÖNCE bağlanır (çapraz köken, oturumsuz). */
export function mountTeklifAcik(app, { ipOf, uaOf }) {
  function cors(req, res) {
    const o = req.headers.origin;
    if (izinli(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  app.options('/api/teklif', (req, res) => { cors(req, res); res.status(204).end(); });

  app.post('/api/teklif', async (req, res) => {
    cors(req, res);
    const dil = ['tr', 'en', 'de'].includes(req.body?.dil) ? req.body.dil : 'tr';
    const M = MSG[dil];
    // bot tuzağı: görünmeyen alan doluysa sessizce kabul edip kaydetme
    if (req.body?.web) return res.json({ ok: true, no: 0 });
    const o = req.headers.origin;
    if (o && !izinli(o)) return res.status(403).json({ error: M.hata });
    const ip = ipOf(req);
    if (sinirli('teklif:' + ip, 5, 3600)) return res.status(429).json({ error: M.cok });
    if (!req.body?.kvkk) return res.status(400).json({ error: M.kvkk });
    const { t, hata } = topla(req.body, dil);
    if (hata) return res.status(400).json({ error: hata });
    try {
      const k = await kaydet(t, 'site', null, ip, uaOf(req));
      res.json({ ok: true, no: Number(k.id) });
    } catch (e) {
      console.error('[teklif]', e?.message || e);
      res.status(500).json({ error: M.hata });
    }
  });
}

/** Üye ve yönetim uçları. csrfGuard'dan SONRA bağlanır. */
export function mountTeklifPanel(app, { ipOf, uaOf, uyeGetir, requireAuth, requireAdmin }) {
  /* üyenin talepleri: hesaptan açılanlar + aynı e-postayla siteden gönderilenler */
  app.get('/api/uye/talepler', async (req, res) => {
    const m = await uyeGetir(req);
    if (!m) return res.status(401).json({ error: 'Oturum yok.' });
    const { rows } = await q(
      `SELECT * FROM talepler WHERE musteri_id = $1 OR lower(email) = lower($2)
        ORDER BY olusturuldu DESC LIMIT 100`, [m.id, m.email]);
    res.json({ talepler: rows.map(disari) });
  });

  app.post('/api/uye/talepler', async (req, res) => {
    const m = await uyeGetir(req);
    if (!m) return res.status(401).json({ error: 'Oturum yok.' });
    const dil = ['tr', 'en', 'de'].includes(m.dil) ? m.dil : 'tr';
    if (sinirli('uye-talep:' + m.id, 10, 3600)) return res.status(429).json({ error: MSG[dil].cok });
    const { t, hata } = topla({
      ...req.body, ad: m.ad, email: m.email,
      telefon: req.body?.telefon || m.telefon, firma: req.body?.firma || m.firma
    }, dil);
    if (hata) return res.status(400).json({ error: hata });
    try {
      const k = await kaydet(t, 'panel', m.id, ipOf(req), uaOf(req));
      res.json({ talep: disari(k) });
    } catch (e) {
      console.error('[teklif.uye]', e?.message || e);
      res.status(500).json({ error: MSG[dil].hata });
    }
  });

  /* yönetim */
  app.get('/api/yonetim/talepler', requireAuth, requireAdmin, async (req, res) => {
    const durum = DURUMLAR.includes(req.query.durum) ? req.query.durum : null;
    const { rows } = await q(
      `SELECT * FROM talepler ${durum ? 'WHERE durum = $1' : ''} ORDER BY olusturuldu DESC LIMIT 300`,
      durum ? [durum] : []);
    const { rows: say } = await q(`SELECT durum, count(*)::int n FROM talepler GROUP BY durum`);
    res.json({ talepler: rows, sayilar: Object.fromEntries(say.map((r) => [r.durum, r.n])), smtp: smtpVar() });
  });

  app.patch('/api/yonetim/talepler/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const durum = DURUMLAR.includes(req.body?.durum) ? req.body.durum : null;
    const yanit = req.body?.yanit === undefined ? null : String(req.body.yanit).slice(0, 2000);
    const { rows } = await q(
      `UPDATE talepler SET durum = COALESCE($2, durum), yanit = COALESCE($3, yanit), guncellendi = now()
        WHERE id = $1 RETURNING *`, [id, durum, yanit]);
    if (!rows[0]) return res.status(404).json({ error: 'Talep bulunamadı.' });
    res.json({ talep: rows[0] });
  });
}
