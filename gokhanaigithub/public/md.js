/* Küçük markdown çevirici — modelden gelen metni güvenle HTML'e döndürür.
   Önce her şey kaçırılır (escape), sonra biçim eklenir; XSS yok. */
window.MD = (function () {
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, function (_, c) { return '<code>' + c + '</code>'; })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
               '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function tableRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
  }
  const isDivider = (l) => /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(l) && l.indexOf('-') > -1;

  function render(src) {
    const lines = esc(String(src || '')).split('\n');
    let out = '', i = 0, para = [];

    const flush = () => {
      if (para.length) { out += '<p>' + inline(para.join('<br>')) + '</p>'; para = []; }
    };

    while (i < lines.length) {
      const line = lines[i];

      // kod bloğu
      if (/^\s*```/.test(line)) {
        flush();
        i++;
        const buf = [];
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out += '<pre><code>' + buf.join('\n') + '</code></pre>';
        continue;
      }

      // tablo
      if (line.indexOf('|') > -1 && i + 1 < lines.length && isDivider(lines[i + 1])) {
        flush();
        const head = tableRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].indexOf('|') > -1 && lines[i].trim() !== '') rows.push(tableRow(lines[i++]));
        out += '<div class="tablewrap"><table><thead><tr>' +
               head.map(function (h) { return '<th>' + inline(h) + '</th>'; }).join('') +
               '</tr></thead><tbody>' +
               rows.map(function (r) {
                 return '<tr>' + head.map(function (_, k) { return '<td>' + inline(r[k] || '') + '</td>'; }).join('') + '</tr>';
               }).join('') + '</tbody></table></div>';
        continue;
      }

      // başlık
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { flush(); out += '<h3>' + inline(h[2]) + '</h3>'; i++; continue; }

      // alıntı
      if (/^\s*>\s?/.test(line)) {
        flush();
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        out += '<blockquote>' + inline(buf.join('<br>')) + '</blockquote>';
        continue;
      }

      // liste
      if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
        flush();
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
          items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
        }
        out += (ordered ? '<ol>' : '<ul>') +
               items.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') +
               (ordered ? '</ol>' : '</ul>');
        continue;
      }

      // ayraç
      if (/^\s*(---|___|\*\*\*)\s*$/.test(line)) { flush(); i++; continue; }

      if (line.trim() === '') { flush(); i++; continue; }

      para.push(line);
      i++;
    }
    flush();
    return out;
  }

  return { render: render, esc: esc };
})();
