import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

/**
 * Dosyaları sunucuda okuyup modele gidecek kompakt metne çevirir.
 * Amaç: 40 sayfalık dosyayı ham göndermek yerine işe yarayan kısmı göndermek —
 * token maliyetini 5-20 kat düşürür, ücretsiz katmanların dar limitlerine sığdırır.
 */

const MAX_CHARS = 60000;          // tek dosyadan modele gidecek üst sınır
const SHEET_HEAD = 60;            // tablo başından alınacak satır
const SHEET_TAIL = 15;            // tablo sonundan alınacak satır

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function kindOf(name = '', mime = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['xlsx', 'xlsm', 'xls'].includes(ext)) return 'excel';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'docx') return 'word';
  if (['txt', 'md', 'json', 'log', 'xml', 'html'].includes(ext)) return 'metin';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'gorsel';
  return 'bilinmeyen';
}

const clip = (s, n = MAX_CHARS) =>
  s.length <= n ? s : s.slice(0, n) + `\n\n[… kırpıldı, toplam ${s.length.toLocaleString('tr-TR')} karakter]`;

const cell = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return v.toLocaleDateString('tr-TR');
  if (typeof v === 'object') {
    if (v.result !== undefined) return String(v.result);   // formül sonucu
    if (v.text !== undefined) return String(v.text);       // zengin metin / köprü
    if (v.richText) return v.richText.map((r) => r.text).join('');
    return '';
  }
  return String(v);
};

/** Sayısal sütunlar için özet — model her satırı görmese de bütünü anlasın. */
function columnSummary(headers, rows) {
  const out = [];
  headers.forEach((h, i) => {
    const nums = rows.map((r) => Number(String(r[i]).replace(/\./g, '').replace(',', '.')))
                     .filter((n) => Number.isFinite(n));
    if (nums.length >= Math.max(3, rows.length * 0.6)) {
      const sum = nums.reduce((a, b) => a + b, 0);
      out.push(`${h || 'sütun ' + (i + 1)}: toplam ${sum.toLocaleString('tr-TR')}, ` +
               `ortalama ${(sum / nums.length).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}, ` +
               `en düşük ${Math.min(...nums).toLocaleString('tr-TR')}, en yüksek ${Math.max(...nums).toLocaleString('tr-TR')}`);
    }
  });
  return out;
}

function tableToText(title, headers, rows) {
  const lines = [`### ${title}`, `${rows.length} satır × ${headers.length} sütun`, ''];
  lines.push('| ' + headers.map((h, i) => h || 'sütun ' + (i + 1)).join(' | ') + ' |');
  lines.push('|' + headers.map(() => '---').join('|') + '|');

  const show = rows.length <= SHEET_HEAD + SHEET_TAIL
    ? rows
    : rows.slice(0, SHEET_HEAD);
  show.forEach((r) => lines.push('| ' + headers.map((_, i) => r[i] ?? '').join(' | ') + ' |'));

  if (rows.length > SHEET_HEAD + SHEET_TAIL) {
    lines.push(`| … ${rows.length - SHEET_HEAD - SHEET_TAIL} satır atlandı … |`);
    rows.slice(-SHEET_TAIL).forEach((r) => lines.push('| ' + headers.map((_, i) => r[i] ?? '').join(' | ') + ' |'));
  }

  const sums = columnSummary(headers, rows);
  if (sums.length) lines.push('', 'Sütun özetleri (tüm satırlar üzerinden hesaplandı):', ...sums.map((s) => '- ' + s));
  return lines.join('\n');
}

async function parseExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const parts = [];
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (c, i) => { vals[i - 1] = cell(c.value); });
      if (vals.some((v) => v !== undefined && String(v).trim() !== '')) rows.push(vals);
    });
    if (!rows.length) return;
    const headers = rows[0].map((h) => String(h ?? '').trim());
    parts.push(tableToText(`Sayfa: ${ws.name}`, headers, rows.slice(1)));
  });
  if (!parts.length) return 'Dosyada okunabilir veri bulunamadı.';
  return parts.join('\n\n');
}

function splitCsvLine(line, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(buffer) {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return 'Dosya boş.';
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const rows = lines.map((l) => splitCsvLine(l, sep));
  return tableToText('Tablo', rows[0].map((h) => h.trim()), rows.slice(1));
}

async function parsePdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const res = await parser.getText();
    const text = (res.text || '').replace(/\n{3,}/g, '\n\n').trim();
    const pages = res.pages?.length || res.total || null;
    if (!text) return 'PDF içinden metin çıkarılamadı — belge taranmış görüntü olabilir.';
    return (pages ? `${pages} sayfalık PDF.\n\n` : '') + text;
  } finally {
    try { await parser.destroy?.(); } catch {}
  }
}

async function parseWord(buffer) {
  const res = await mammoth.extractRawText({ buffer });
  return (res.value || '').replace(/\n{3,}/g, '\n\n').trim() || 'Belgede metin bulunamadı.';
}

/** @returns {Promise<{name,kind,bytes,text,chars,approxTokens,error?}>} */
export async function parseFile(file) {
  const name = file.originalname || file.name || 'dosya';
  const kind = kindOf(name, file.mimetype);
  const buffer = file.buffer;
  let text = '';

  try {
    if (kind === 'excel') text = await parseExcel(buffer);
    else if (kind === 'csv') text = parseCsv(buffer);
    else if (kind === 'pdf') text = await parsePdf(buffer);
    else if (kind === 'word') text = await parseWord(buffer);
    else if (kind === 'metin') text = buffer.toString('utf8');
    else if (kind === 'gorsel') text = '[Görsel dosya — bu sürümde görsel içeriği okunmuyor.]';
    else return { name, kind, bytes: buffer.length, text: '', chars: 0, approxTokens: 0,
                  error: 'Bu dosya türü desteklenmiyor.' };
  } catch (e) {
    return { name, kind, bytes: buffer.length, text: '', chars: 0, approxTokens: 0,
             error: 'Dosya okunamadı: ' + e.message };
  }

  const clipped = clip(text);
  return {
    name, kind, bytes: buffer.length,
    text: clipped,
    chars: clipped.length,
    approxTokens: Math.ceil(clipped.length / 4)
  };
}

/** Modele verilecek belge bloğu. */
export function asContext(parsed) {
  return `<belge ad="${parsed.name}" tur="${parsed.kind}">\n${parsed.text}\n</belge>`;
}
