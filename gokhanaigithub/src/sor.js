/* Siteden gelen herkese açık soru kutusu.
   gknsoftware.com'daki ziyaretçi giriş yapmadan soru sorabiliyor.
   Ücretsiz Gemini kotasını korumak için sınırlar sıkı tutuldu. */
import { chat } from './ai.js';

const IZIN = (process.env.SITE_ORIGINS ||
  'https://gknsoftware.com,https://www.gknsoftware.com')
  .split(',').map((s) => s.trim()).filter(Boolean);

const izinli = (o) =>
  !!o && (IZIN.includes(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o));

/* ── sınırlar ── */
const SAAT_BASI = Number(process.env.SOR_SAAT || 6);      // IP başına saatte
const GUN_BASI  = Number(process.env.SOR_GUN || 20);      // IP başına günde
const TOPLAM_GUN = Number(process.env.SOR_TOPLAM || 400); // tüm site, günde
const MAX_UZUNLUK = 400;

const ip_saat = new Map(), ip_gun = new Map();
let toplam = { n: 0, gun: new Date().toDateString() };

function sinir(ip) {
  const now = Date.now(), bugun = new Date().toDateString();
  if (toplam.gun !== bugun) toplam = { n: 0, gun: bugun };
  if (toplam.n >= TOPLAM_GUN) return 'toplam';

  const s = ip_saat.get(ip) || { n: 0, t: now };
  if (now - s.t > 3600000) { s.n = 0; s.t = now; }
  if (s.n >= SAAT_BASI) return 'saat';

  const g = ip_gun.get(ip) || { n: 0, gun: bugun };
  if (g.gun !== bugun) { g.n = 0; g.gun = bugun; }
  if (g.n >= GUN_BASI) return 'gun';

  s.n++; g.n++; toplam.n++;
  ip_saat.set(ip, s); ip_gun.set(ip, g);
  if (ip_saat.size > 4000) ip_saat.clear();
  if (ip_gun.size > 4000) ip_gun.clear();
  return null;
}

/* ── firma bilgisi ── */
const FIRMA = `
GOKHAN SOFTWARE — kurumsal yazılım, siber güvenlik ve BT hizmetleri firması.
Web: gknsoftware.com
Telefon: +90 501 051 96 60
E-posta: ercangokhann@hotmail.com
Sektörde 8 yıllık deneyim.

GELİŞTİRDİĞİ YAZILIMLAR
- Rücu Takip Sistemi: sigorta şirketleri ve hukuk büroları için rücu dosyası, taksit,
  ödeme, masraf ve faiz takibi. Eski sistemden eksiksiz veri aktarımı, OCR ile belge
  okuma, gelen e-postayı dosyayla eşleştirme. Kurum içi sunucuda çalışabilir.
- Veri Sızıntısı Önleme (DLP): kurum verisinin USB, e-posta, bulut ve yazıcı üzerinden
  izinsiz çıkmasının engellenmesi; KVKK için kayıt ve raporlama.
- Ağır Hasar Süreç Yönetimi: sigorta ağır hasar dosyalarının takibi.
- gokhan.ai: kurum içi yapay zeka çalışma alanı. Excel, PDF ve Word yüklenip analiz
  ettirilir; giriş kayıtları tutulur, sohbetler kişiye özeldir.

BT HİZMETLERİ
- Sunucu ve sistem: Windows Server, Active Directory, dosya sunucusu ve yetkiler,
  sanallaştırma, NAS ve depolama, sunucu taşıma.
- Yedekleme: otomatik yedek, yerinde + bulut kopya, fidye yazılımına dayanıklı yedek,
  geri dönüş tatbikatı, aylık kontrol raporu.
- Güvenlik: FortiGate güvenlik duvarı, Kaspersky uç nokta güvenliği, VPN ve şubeler
  arası bağlantı, Cisco switch ve kablosuz ağ, içerik denetimi, zafiyet taraması.
- Microsoft 365: paket seçimi, e-posta göçü, Exchange Online, Teams/SharePoint/OneDrive,
  çok adımlı doğrulama (MFA), güvenlik ayarları, Windows ve Office lisansları.
- E-posta: mail sunucusu kurulumu, MailStore ile arşivleme, SPF/DKIM/DMARC,
  spam ve oltalama filtresi.
- Donanım: bilgisayar, yazıcı, tarayıcı, barkod, UPS tedariki ve kurulumu; sarf malzeme.
- Destek: uzaktan destek, yerinde müdahale, sistem izleme, yıllık bakım anlaşması.

KURUMSAL KİMLİK VE SOSYAL MEDYA (uzman ekiplerle yürütülüyor)
- Kurumsal kimlik: logo tasarımı, renk ve yazı tipi sistemi, kartvizit/antetli/kaşe,
  sunum ve teklif şablonu, marka kullanım kılavuzu, tabela ve araç giydirme.
- Sosyal medya yönetimi: hesap kurulumu, içerik takvimi, düzenli paylaşım,
  yorum ve mesaj yönetimi, aylık performans raporu.
- İçerik üretimi: görsel tasarım, kısa video ve reels, metin yazımı, hikâye kapakları,
  blog ve haber içeriği.
- Video: tanıtım filmi, ürün ve süreç videosu, röportaj ve eğitim videosu, kurgu ve
  renk düzenleme, TR/EN/DE altyazı, mecraya göre teslim.
- Fotoğraf: ürün, mekân ve ofis, ekip ve portre, sosyal medya içerik seti, rötuş ve arşiv.

ÇALIŞTIĞI MARKALAR: Kaspersky, FortiGate, Cisco, Microsoft 365, MailStore.
SEKTÖRLER: sigorta, hukuk, kurumsal BT, kamu ve KOBİ.

ÇALIŞMA ŞEKLİ
1) Dinleme — işi yapan kişiyle görüşme, ücretsiz.
2) Yazılı teklif — ne yapılacağı, süresi ve fiyatı yazılı.
3) Parça parça teslim.
4) Veri aktarımı ve devreye alma; eski sistem bir süre paralel çalışabilir.
5) Sonrasında destek — doğrudan yazılımı yazan kişiye ulaşılır.

BİLİNEN CEVAPLAR
- İlk görüşme ücretsizdir.
- Fiyat listesi yayınlanmaz; teklif kuruma göre yazılır ve aynı gün gönderilir.
- Geliştirilen özel yazılımın kaynak kodu müşteriye teslim edilir.
- Sistemler kurum içi sunucuda çalışabilir; veri kurum dışına çıkmak zorunda değildir.
- Mevcut programdaki veri yeni sisteme taşınabilir.
- Yalnızca destek/bakım anlaşması da yapılabilir.
- Müşteri isimleri KVKK gereği paylaşılmaz; talep edilirse ilgili kurumdan izin alınıp
  doğrudan referans görüşmesi ayarlanabilir.
`.trim();

const KURAL = {
tr: `Sen GOKHAN SOFTWARE'in web sitesindeki yardımcısısın. Ziyaretçinin sorusunu
aşağıdaki firma bilgisine dayanarak yanıtla.

Kurallar:
- Kısa yaz. En fazla 3 kısa paragraf ya da 5 madde.
- Sadece firmanın işi, hizmetleri ve çalışma şekli hakkında konuş. Konu dışı sorularda
  kibarca "ben bu firmanın hizmetleri hakkında yardımcı olabiliyorum" de.
- Bilgide olmayan hiçbir şeyi UYDURMA. Özellikle telefon numarası, e-posta adresi,
  adres, fiyat, süre, referans müşteri adı ve sertifika UYDURMA.
- İletişim bilgisi sorulursa yukarıdaki telefon ve e-postayı verebilirsin; bunların
  DIŞINDA başka numara, adres veya kişi adı UYDURMA.
- Fiyat sorulursa: fiyat listesi yayınlanmadığını, ihtiyaç yazıldığında aynı gün yazılı
  teklif gönderildiğini ve ilk görüşmenin ücretsiz olduğunu söyle.
- Emin değilsen bunu açıkça söyle ve iletişime yönlendir.
- Türkçe yanıtla.`,
en: `You are the assistant on GOKHAN SOFTWARE's website. Answer the visitor's question
using only the company information below.

Rules:
- Be brief. At most 3 short paragraphs or 5 bullet points.
- Only discuss the company's work, services and way of working. For unrelated questions,
  politely say you can only help with this company's services.
- NEVER invent anything not in the information. In particular never invent a phone number,
  e-mail address, postal address, price, timeline, client name or certification.
- If asked for contact details you may give the phone number and e-mail above; never
  invent any other number, address or person's name.
- If asked about price: say no price list is published, that a written quote is sent the
  same day once the requirement is described, and that the first meeting is free.
- If you are unsure, say so plainly and point to the contact page.
- Answer in English.`,
de: `Du bist die Assistenz auf der Website von GOKHAN SOFTWARE. Beantworte die Frage
der Besucherin oder des Besuchers ausschließlich anhand der folgenden Firmenangaben.

Regeln:
- Fasse dich kurz. Höchstens 3 kurze Absätze oder 5 Stichpunkte.
- Sprich nur über die Arbeit, die Leistungen und die Arbeitsweise der Firma. Bei
  Fragen außerhalb davon sage höflich, dass du nur zu den Leistungen dieser Firma helfen kannst.
- ERFINDE nichts, was nicht in den Angaben steht. Insbesondere niemals Telefonnummern,
  E-Mail-Adressen, Anschriften, Preise, Fristen, Kundennamen oder Zertifikate erfinden.
- Bei Fragen nach Kontaktdaten darfst du die obige Telefonnummer und E-Mail nennen;
  erfinde niemals weitere Nummern, Anschriften oder Personennamen.
- Bei Preisfragen: es wird keine Preisliste veröffentlicht; nach Beschreibung des Bedarfs
  kommt am selben Tag ein schriftliches Angebot, und das erste Gespräch ist kostenlos.
- Wenn du unsicher bist, sage das offen und verweise auf die Kontaktseite.
- Antworte auf Deutsch.`,
};

const MESAJ = {
 tr:{saat:'Saatlik soru sınırına ulaştınız. Biraz sonra tekrar deneyin ya da iletişim sayfasından yazın.',
     gun:'Bugünlük soru hakkınız doldu. İletişim sayfasından bize doğrudan yazabilirsiniz.',
     toplam:'Soru kutusu bugün çok yoğun. İletişim sayfasından bize doğrudan yazabilirsiniz.',
     bos:'Bir soru yazın.', uzun:'Soru çok uzun. Lütfen kısaltın.',
     hata:'Şu an cevap veremiyorum. İletişim sayfasından bize yazabilirsiniz.'},
 en:{saat:'You have reached the hourly limit. Try again shortly, or write to us from the contact page.',
     gun:'You have used today\'s questions. You can write to us directly from the contact page.',
     toplam:'The ask box is very busy today. Please write to us from the contact page.',
     bos:'Please type a question.', uzun:'That question is too long. Please shorten it.',
     hata:'I cannot answer right now. Please write to us from the contact page.'},
 de:{saat:'Sie haben das Stundenlimit erreicht. Versuchen Sie es später erneut oder schreiben Sie uns über die Kontaktseite.',
     gun:'Ihre Fragen für heute sind aufgebraucht. Schreiben Sie uns gern direkt über die Kontaktseite.',
     toplam:'Das Fragefeld ist heute stark ausgelastet. Bitte schreiben Sie uns über die Kontaktseite.',
     bos:'Bitte geben Sie eine Frage ein.', uzun:'Die Frage ist zu lang. Bitte kürzen Sie sie.',
     hata:'Ich kann gerade nicht antworten. Bitte schreiben Sie uns über die Kontaktseite.'},
};

/** Uygulamaya bağlar. app.use('/api', csrfGuard) satırından ÖNCE çağrılmalı. */
export function mountSor(app, ipOf) {
  function cors(req, res) {
    const o = req.headers.origin;
    if (izinli(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  app.options('/api/sor', (req, res) => { cors(req, res); res.status(204).end(); });

  app.post('/api/sor', async (req, res) => {
    cors(req, res);
    const dil = ['tr','en','de'].includes(req.body?.dil) ? req.body.dil : 'tr';
    const M = MESAJ[dil];
    const soru = String(req.body?.soru || '').trim();

    if (!soru) return res.status(400).json({ error: M.bos });
    if (soru.length > MAX_UZUNLUK) return res.status(400).json({ error: M.uzun });

    const engel = sinir(ipOf(req));
    if (engel) return res.status(429).json({ error: M[engel] });

    try {
      let cevap = '';
      await chat({
        maxTokens: 500,
        messages: [
          { role: 'system', content: KURAL[dil] + '\n\n--- FİRMA BİLGİSİ ---\n' + FIRMA },
          { role: 'user', content: soru }
        ]
      }, (d) => { cevap += d; });
      res.json({ cevap: cevap.trim() });
    } catch (e) {
      console.error('[sor]', e?.message || e);
      res.status(502).json({ error: M.hata });
    }
  });
}
