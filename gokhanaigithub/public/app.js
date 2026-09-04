/* Ortak yardımcılar */
window.NP = (function () {
  var H = { 'Content-Type': 'application/json', 'X-GA-Request': '1' };

  async function call(method, url, body) {
    try {
      var res = await fetch(url, {
        method: method,
        headers: H,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      var data = {};
      try { data = await res.json(); } catch (e) {}
      return { ok: res.ok, status: res.status, data: data };
    } catch (e) {
      return { ok: false, status: 0, data: { error: 'Sunucuya ulaşılamadı.' } };
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function two(n) { return String(n).padStart(2, '0'); }

  function hhmmss(d) { return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()); }

  function stamp(iso) {
    var d = new Date(iso);
    return two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + hhmmss(d);
  }

  function ago(iso) {
    if (!iso) return '—';
    var s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'az önce';
    if (s < 3600) return Math.floor(s / 60) + ' dk önce';
    if (s < 86400) return Math.floor(s / 3600) + ' sa önce';
    return Math.floor(s / 86400) + ' gün önce';
  }

  /** Kaba tarayıcı/işletim sistemi özeti — user-agent'tan. */
  function device(ua) {
    if (!ua) return '—';
    var os = /Windows/.test(ua) ? 'Windows'
      : /iPhone|iPad/.test(ua) ? 'iOS'
      : /Android/.test(ua) ? 'Android'
      : /Mac OS X/.test(ua) ? 'macOS'
      : /Linux/.test(ua) ? 'Linux' : '?';
    var br = /Edg\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera'
      : /Chrome\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) ? 'Safari'
      : /Firefox\//.test(ua) ? 'Firefox' : '?';
    return br + ' · ' + os;
  }

  function say(elId, html) {
    var box = document.getElementById(elId);
    if (!box) return;
    var el = document.createElement('div');
    el.innerHTML = '<span class="t">' + hhmmss(new Date()) + '</span> ' + html;
    box.appendChild(el);
    while (box.children.length > 12) box.removeChild(box.firstChild);
  }

  function clock(id) {
    var el = document.getElementById(id);
    if (!el) return;
    function t() { el.textContent = hhmmss(new Date()); }
    t(); setInterval(t, 1000);
  }

  function capsWatch(input, capsId) {
    var caps = document.getElementById(capsId);
    if (!input || !caps) return;
    function chk(e) { if (e.getModifierState) caps.classList.toggle('on', e.getModifierState('CapsLock')); }
    input.addEventListener('keydown', chk);
    input.addEventListener('keyup', chk);
  }

  function revealToggle(inputId, btnId) {
    var inp = document.getElementById(inputId), btn = document.getElementById(btnId);
    if (!inp || !btn) return;
    btn.addEventListener('click', function () {
      var shown = inp.type === 'text';
      inp.type = shown ? 'password' : 'text';
      btn.textContent = shown ? 'göster' : 'gizle';
      inp.focus();
    });
  }

  function rainOnType(ids) {
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || !window.rainSet) return;
      el.addEventListener('focus', function () { window.rainSet(1.5); });
      el.addEventListener('blur', function () { window.rainSet(1); });
      el.addEventListener('input', function () { window.rainPush(2.1); });
    });
  }

  async function guard(opts) {
    var r = await call('GET', '/api/me');
    if (!r.ok) { location.href = '/'; return null; }
    var u = r.data.user;
    if (u.mustChange && !opts.allowMustChange) { location.href = '/change.html'; return null; }
    if (opts.adminOnly && u.role !== 'admin') { location.href = '/chat.html'; return null; }
    return u;
  }

  return {
    get: function (u) { return call('GET', u); },
    post: function (u, b) { return call('POST', u, b || {}); },
    patch: function (u, b) { return call('PATCH', u, b || {}); },
    del: function (u) { return call('DELETE', u); },
    esc: esc, stamp: stamp, ago: ago, device: device, hhmmss: hhmmss,
    say: say, clock: clock, capsWatch: capsWatch, revealToggle: revealToggle,
    rainOnType: rainOnType, guard: guard
  };
})();
