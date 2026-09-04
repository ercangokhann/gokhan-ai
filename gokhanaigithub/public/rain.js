/* Akan kod arka planı — sıcak kil tonlarında. */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cv = document.getElementById('rain');
  if (!cv) return;
  var ctx = cv.getContext('2d');
  var GLYPHS = 'アカサタナハマヤラワイキシチニヒミリヲ0123456789ABCDEF<>{}[]/\\|=+-*#$%&_:;'.split('');
  var cols = [], fs = 15, W = 0, H = 0, intensity = 1, target = 1;

  function pick() { return GLYPHS[(Math.random() * GLYPHS.length) | 0]; }

  window.rainPush = function (v) {
    target = v;
    clearTimeout(window._rt);
    window._rt = setTimeout(function () { target = 1; }, 1500);
  };
  window.rainSet = function (v) { target = v; };

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fs = W < 640 ? 13 : 15;
    var n = Math.ceil(W / fs);
    cols = [];
    for (var i = 0; i < n; i++) {
      cols.push({ y: Math.random() * -60, sp: 0.18 + Math.random() * 0.42, char: pick(), bright: Math.random() < 0.14 });
    }
    ctx.fillStyle = '#14110D'; ctx.fillRect(0, 0, W, H);
    if (reduce) still();
  }

  function still() {
    ctx.font = fs + 'px "JetBrains Mono", monospace';
    for (var i = 0; i < cols.length; i++) {
      for (var y = 0; y < H / fs; y++) {
        if (Math.random() < 0.14) {
          ctx.fillStyle = 'rgba(217,119,87,' + (0.08 + Math.random() * 0.22).toFixed(2) + ')';
          ctx.fillText(pick(), i * fs, y * fs);
        }
      }
    }
  }

  var last = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (ts - last < 46) return;
    last = ts;
    intensity += (target - intensity) * 0.06;

    ctx.fillStyle = 'rgba(20,17,13,0.085)';
    ctx.fillRect(0, 0, W, H);
    ctx.font = fs + 'px "JetBrains Mono", monospace';
    ctx.textBaseline = 'top';

    for (var i = 0; i < cols.length; i++) {
      var c = cols[i], x = i * fs, y = c.y * fs;
      if (y > -fs && y < H) {
        if (Math.random() < 0.55) c.char = pick();
        ctx.fillStyle = c.bright ? 'rgba(243,238,230,0.92)' : 'rgba(240,165,126,0.86)';
        ctx.shadowColor = 'rgba(217,119,87,0.85)';
        ctx.shadowBlur = c.bright ? 12 : 7;
        ctx.fillText(c.char, x, y);
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(217,119,87,0.30)';
        ctx.fillText(pick(), x, y - fs);
      }
      c.y += c.sp * intensity;
      if (y > H && Math.random() > 0.975) {
        c.y = -2 - Math.random() * 30;
        c.sp = 0.18 + Math.random() * 0.42;
        c.bright = Math.random() < 0.14;
      }
    }
  }

  window.addEventListener('resize', resize);
  resize();
  if (!reduce) requestAnimationFrame(frame);
})();
