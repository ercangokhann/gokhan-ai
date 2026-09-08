/* Üye sayfaları için ortak yardımcılar. */
window.UYE = (function () {
  var SITE = 'https://gknsoftware.onrender.com';
  var H = { 'Content-Type': 'application/json', 'X-GA-Request': '1' };

  async function cagir(yontem, yol, govde) {
    try {
      var r = await fetch(yol, {
        method: yontem, headers: H, credentials: 'same-origin',
        body: govde === undefined ? undefined : JSON.stringify(govde)
      });
      var d = {}; try { d = await r.json(); } catch (e) {}
      return { ok: r.ok, durum: r.status, veri: d };
    } catch (e) {
      return { ok: false, durum: 0, veri: { error: 'Sunucuya ulaşılamadı.' } };
    }
  }

  function mesaj(id, metin, tur) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = metin || '';
    el.className = 'mesaj' + (metin ? ' gorun ' + (tur || 'hata') : '');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function tarih(iso) {
    if (!iso) return '—';
    var d = new Date(iso), i = function (n) { return String(n).padStart(2, '0'); };
    return i(d.getDate()) + '.' + i(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  /** Formu kilitler, iş bitince açar. */
  function mesgul(btn, v, yaziMesgul) {
    if (!btn) return;
    if (v) { btn.dataset.eski = btn.textContent; btn.textContent = yaziMesgul || '…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.eski || btn.textContent; btn.disabled = false; }
  }

  return {
    site: SITE,
    get: function (y) { return cagir('GET', y); },
    post: function (y, b) { return cagir('POST', y, b || {}); },
    patch: function (y, b) { return cagir('PATCH', y, b || {}); },
    mesaj: mesaj, esc: esc, tarih: tarih, mesgul: mesgul
  };
})();
