/* Teklif / iletişim formu — talebi gokhan.ai sunucusuna gönderir;
   sunucu kaydedip info@gokhansoftware.com adresine iletir. */
(function () {
  var f = document.getElementById('teklifForm');
  if (!f) return;
  var API = 'https://gokhan-ai.onrender.com/api/teklif';
  var dil = (document.documentElement.lang || 'tr').slice(0, 2);
  var T = {
    tr: { gonder: 'Gönderiliyor…', tamam: 'Talebiniz alındı. Talep numaranız #{no}. Aynı iş günü içinde size dönüş yapacağız; e-postanıza da bir onay gönderdik.',
          zorunlu: 'Lütfen işaretli alanları doldurun.', ag: 'Bağlantı kurulamadı. Lütfen tekrar deneyin ya da 0501 051 96 60 numarasından bize ulaşın.',
          uyan: 'Sunucu uyanıyor, bu ilk seferde 30–60 saniye sürebilir…' },
    en: { gonder: 'Sending…', tamam: 'Your request has been received. Your request number is #{no}. We will get back to you within the same business day and have sent a confirmation to your e-mail.',
          zorunlu: 'Please fill in the required fields.', ag: 'Could not connect. Please try again or call +90 501 051 96 60.',
          uyan: 'The server is waking up; the first request can take 30–60 seconds…' },
    de: { gonder: 'Wird gesendet…', tamam: 'Ihre Anfrage ist eingegangen. Ihre Anfrage-Nr. ist #{no}. Wir melden uns noch am selben Werktag und haben Ihnen eine Bestätigung per E-Mail geschickt.',
          zorunlu: 'Bitte füllen Sie die Pflichtfelder aus.', ag: 'Keine Verbindung. Bitte erneut versuchen oder +90 501 051 96 60 anrufen.',
          uyan: 'Der Server startet gerade; die erste Anfrage kann 30–60 Sekunden dauern…' }
  }[dil] || null;
  var M = T || { gonder: '…', tamam: '#{no}', zorunlu: '!', ag: '!', uyan: '…' };
  var msg = document.getElementById('teklifMesaj');
  var btn = f.querySelector('button[type=submit]');
  var hizmet = f.elements.hizmet, tarihAlan = document.getElementById('teklifTarihAlan');

  function goster(metin, tur) { msg.textContent = metin; msg.className = 'form-mesaj gorun ' + (tur || 'hata'); }
  function tarihGoster() { if (tarihAlan) tarihAlan.hidden = hizmet.value !== 'saglik'; }

  // ?hizmet=saglik gibi bağlantılar formu hazır seçili açar
  var p = new URLSearchParams(location.search).get('hizmet');
  if (p && hizmet.querySelector('option[value="' + p + '"]')) hizmet.value = p;
  hizmet.addEventListener('change', tarihGoster); tarihGoster();
  if (f.elements.tarih) f.elements.tarih.min = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

  f.addEventListener('submit', async function (e) {
    e.preventDefault();
    msg.className = 'form-mesaj';
    var el = f.elements;
    var veri = {
      ad: el.ad.value, firma: el.firma.value, email: el.email.value, telefon: el.telefon.value,
      hizmet: el.hizmet.value, mesaj: el.mesaj.value, tarih: el.tarih ? el.tarih.value : '',
      kvkk: el.kvkk.checked, web: el.web.value, dil: dil, sayfa: location.pathname
    };
    if (!veri.ad.trim() || !veri.email.trim() || !veri.telefon.trim() || !veri.hizmet || !veri.mesaj.trim() || !veri.kvkk) {
      goster(M.zorunlu); return;
    }
    var eski = btn.textContent; btn.disabled = true; btn.textContent = M.gonder;
    var yavas = setTimeout(function () { goster(M.uyan, 'bilgi'); }, 6000);
    try {
      var r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(veri) });
      var d = {}; try { d = await r.json(); } catch (x) {}
      clearTimeout(yavas);
      if (r.ok) { f.reset(); tarihGoster(); goster(M.tamam.replace('{no}', d.no), 'iyi'); msg.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      else goster(d.error || M.ag);
    } catch (x) { clearTimeout(yavas); goster(M.ag); }
    btn.disabled = false; btn.textContent = eski;
  });
})();
