/* gknsoftware.com — hareketli arka plan ve kaydırma canlanması.
   Görünmeyen bölümlerde çizim durur; hareket azaltma tercihi varsa tek kare çizilir. */
(function () {
  var azalt = window.matchMedia &&
              window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ═══ 1) Hareketli arka planlar ═══ */
  var CESIT = {
    hero:      { n: 34, hiz: 0.16, mesafe: 190, nokta: 1.9, cizgi: 0.26, isik: 0.16, kare: 46 },
    projeler:  { n: 26, hiz: 0.13, mesafe: 210, nokta: 1.7, cizgi: 0.22, isik: 0.13, kare: 56 },
    magaza:    { n: 22, hiz: 0.11, mesafe: 230, nokta: 2.0, cizgi: 0.18, isik: 0.12, kare: 64 },
    hizmetler: { n: 28, hiz: 0.14, mesafe: 200, nokta: 1.7, cizgi: 0.20, isik: 0.13, kare: 52 },
    medya:     { n: 31, hiz: 0.19, mesafe: 175, nokta: 2.2, cizgi: 0.24, isik: 0.15, kare: 48 }
  };

  var sahneler = [];

  function kur(el) {
    var cv = el.querySelector('canvas.arka');
    if (!cv) return;
    var ayar = CESIT[el.dataset.arka] || CESIT.hero;
    var s = { el: el, cv: cv, ctx: cv.getContext('2d'), a: ayar,
              p: [], w: 0, h: 0, dpr: 1, gorunur: false, t: Math.random() * 1000 };
    olc(s);
    sahneler.push(s);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (girisler) {
        girisler.forEach(function (g) { s.gorunur = g.isIntersecting; });
      }, { rootMargin: '120px' }).observe(el);
    } else { s.gorunur = true; }
  }

  function olc(s) {
    var r = s.el.getBoundingClientRect();
    s.w = Math.max(1, Math.round(r.width));
    s.h = Math.max(1, Math.round(r.height));
    s.dpr = Math.min(window.devicePixelRatio || 1, 2);
    s.cv.width = s.w * s.dpr;
    s.cv.height = s.h * s.dpr;
    s.cv.style.width = s.w + 'px';
    s.cv.style.height = s.h + 'px';
    s.ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);

    var n = Math.round(s.a.n * Math.min(1.35, Math.max(0.55, s.w / 1200)));
    s.p = [];
    for (var i = 0; i < n; i++) {
      s.p.push({
        x: Math.random() * s.w,
        y: Math.random() * s.h,
        vx: (Math.random() - 0.5) * s.a.hiz,
        vy: (Math.random() - 0.5) * s.a.hiz,
        r: s.a.nokta * (0.7 + Math.random() * 0.9),
        f: Math.random() * Math.PI * 2               // parıltı fazı
      });
    }
  }

  function ciz(s, dt) {
    var c = s.ctx, a = s.a, w = s.w, h = s.h, p = s.p, i, j;
    c.clearRect(0, 0, w, h);

    /* üstten inen sıcak ışık */
    var g = c.createRadialGradient(w * 0.5, h * 0.06, 0, w * 0.5, h * 0.06, Math.max(w, h) * 0.78);
    g.addColorStop(0, 'rgba(217,119,87,' + a.isik + ')');
    g.addColorStop(1, 'rgba(217,119,87,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);

    /* ince ızgara — çok sönük */
    c.strokeStyle = 'rgba(244,241,234,0.030)';
    c.lineWidth = 1;
    c.beginPath();
    for (var x = (s.t * 0.006 % a.kare); x < w; x += a.kare) {
      c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, h);
    }
    for (var y = 0; y < h; y += a.kare) {
      c.moveTo(0, Math.round(y) + 0.5); c.lineTo(w, Math.round(y) + 0.5);
    }
    c.stroke();

    /* düğümler arası bağlantılar */
    for (i = 0; i < p.length; i++) {
      for (j = i + 1; j < p.length; j++) {
        var dx = p[i].x - p[j].x, dy = p[i].y - p[j].y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < a.mesafe) {
          c.strokeStyle = 'rgba(217,119,87,' + (a.cizgi * (1 - d / a.mesafe)).toFixed(3) + ')';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(p[i].x, p[i].y); c.lineTo(p[j].x, p[j].y);
          c.stroke();
        }
      }
    }

    /* düğümler */
    for (i = 0; i < p.length; i++) {
      var o = p[i];
      var par = 0.5 + 0.5 * Math.sin(s.t * 0.0012 + o.f);
      c.beginPath();
      c.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      c.fillStyle = 'rgba(239,152,115,' + (0.32 + par * 0.42).toFixed(3) + ')';
      c.fill();
      if (o.r > 2.2) {
        c.beginPath();
        c.arc(o.x, o.y, o.r * 4.2, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(217,119,87,' + (0.05 + par * 0.07).toFixed(3) + ')';
        c.lineWidth = 1;
        c.stroke();
      }
      if (dt) {
        o.x += o.vx * dt; o.y += o.vy * dt;
        if (o.x < -30) o.x = w + 30; else if (o.x > w + 30) o.x = -30;
        if (o.y < -30) o.y = h + 30; else if (o.y > h + 30) o.y = -30;
      }
    }
  }

  var son = 0;
  function dongu(ts) {
    requestAnimationFrame(dongu);
    var gecen = ts - son;
    if (gecen < 38) return;                    // ~26 fps yeter, pil dostu
    son = ts;
    var dt = Math.min(gecen / 16.7, 3);
    for (var i = 0; i < sahneler.length; i++) {
      var s = sahneler[i];
      if (!s.gorunur) continue;
      s.t += gecen;
      ciz(s, dt);
    }
  }

  function baslat() {
    var hedef = document.querySelectorAll('[data-arka]');
    for (var i = 0; i < hedef.length; i++) kur(hedef[i]);
    if (!sahneler.length) return;

    if (azalt) { sahneler.forEach(function (s) { s.gorunur = true; ciz(s, 0); }); return; }
    requestAnimationFrame(dongu);

    var zam;
    window.addEventListener('resize', function () {
      clearTimeout(zam);
      zam = setTimeout(function () { sahneler.forEach(olc); }, 180);
    });
  }

  /* ═══ 2) Kaydırınca içeriğin belirmesi ═══ */
  function canlandir() {
    var sec = '.sec-head, .card, .proje, .urun, .adim, .bt-grup, .ga-serit,' +
              ' .iletisim, .sayfa-bas > .wrap, .serit, .ic-menu, .sss-grup';
    var ogeler = document.querySelectorAll(sec);
    if (!ogeler.length) return;

    if (azalt || !('IntersectionObserver' in window)) {
      for (var i = 0; i < ogeler.length; i++) ogeler[i].classList.add('gor', 'acik');
      return;
    }
    var goz = new IntersectionObserver(function (girisler) {
      girisler.forEach(function (g) {
        if (!g.isIntersecting) return;
        g.target.classList.add('acik');
        goz.unobserve(g.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

    for (var j = 0; j < ogeler.length; j++) {
      ogeler[j].classList.add('gor');
      // gecikmeyi grup içinde kademelendir
      var k = ogeler[j].parentNode ? Array.prototype.indexOf.call(ogeler[j].parentNode.children, ogeler[j]) : 0;
      ogeler[j].style.transitionDelay = Math.min(k, 5) * 55 + 'ms';
      goz.observe(ogeler[j]);
    }
  }

  function hazir() { baslat(); canlandir(); }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', hazir);
  else hazir();
})();
