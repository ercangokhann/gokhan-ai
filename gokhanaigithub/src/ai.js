/**
 * Sağlayıcı adaptörü.
 * Model değiştirmek tek ayar satırı: AI_PROVIDER + AI_MODEL + AI_API_KEY.
 * Gemini, Groq ve OpenRouter aynı (OpenAI uyumlu) yolu kullanır; Claude'un kendi yolu var.
 * Anahtar tanımlı değilse "demo" sağlayıcısı devreye girer — sistem çalışır, ücret işlemez.
 */

const PRESETS = {
  gemini: {
    label: 'Google Gemini (ücretsiz katman)',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    style: 'openai',
    free: true,
    note: 'Ücretsiz katmanda gönderdiğin içerik Google tarafından ürün geliştirmede kullanılabilir.'
  },
  groq: {
    label: 'Groq (ücretsiz katman)',
    base: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    style: 'openai',
    free: true,
    note: 'Dakikalık token sınırı dar; uzun belgelerde yetmeyebilir.'
  },
  openrouter: {
    label: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    style: 'openai',
    free: true,
    note: 'Günlük kota düşüktür.'
  },
  anthropic: {
    label: 'Claude (ücretli)',
    base: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5',
    style: 'anthropic',
    free: false,
    note: 'Kullandığın kadar ödersin; gönderdiğin içerik model eğitiminde kullanılmaz.'
  },
  demo: { label: 'Demo (anahtar yok)', style: 'demo', free: true, note: 'Anahtar tanımlanmadı.' }
};

function resolve(secure = false) {
  const p = secure ? process.env.AI_SECURE_PROVIDER : process.env.AI_PROVIDER;
  const key = secure ? process.env.AI_SECURE_API_KEY : process.env.AI_API_KEY;
  const model = secure ? process.env.AI_SECURE_MODEL : process.env.AI_MODEL;
  const name = (p || (secure ? '' : 'gemini')).toLowerCase();
  const preset = PRESETS[name];
  if (!preset || !key) return { ...PRESETS.demo, name: 'demo', key: null };
  return { ...preset, name, key, model: model || preset.model };
}

export function providerInfo() {
  const std = resolve(false), sec = resolve(true);
  return {
    standart: { ad: std.label, model: std.model || null, ucretsiz: std.free, not: std.note },
    gizli: sec.name === 'demo' ? null : { ad: sec.label, model: sec.model, ucretsiz: sec.free, not: sec.note },
    hazir: std.name !== 'demo'
  };
}

export const SYSTEM_PROMPT = [
  'Sen gokhan.ai içindeki yardımcısın. Kullanıcı Türkçe yazar, sen de Türkçe cevap verirsin.',
  'Kısa ve doğrudan yaz; gereksiz giriş cümlesi kurma. Sayıları Türkçe biçimde yaz (1.234,56).',
  'Sana <belge> etiketleri içinde dosya içeriği verilebilir. Cevabında hangi dosyaya dayandığını belirt.',
  'Belgede olmayan bir şeyi uydurma; bilgi yoksa "dosyada bu bilgi yok" de.',
  'Tablo istendiğinde markdown tablosu kullan.'
].join(' ');

const DEMO = [
  'Şu an bir yapay zeka anahtarı tanımlı değil, bu yüzden örnek bir cevap veriyorum. ',
  'Sistem çalışıyor: dosyan okundu, metne çevrildi ve modele gönderilmeye hazır. ',
  'Ayarlara ücretsiz bir Gemini anahtarı girildiğinde bu mesajın yerini gerçek cevap alacak.'
].join('');

/**
 * Akışlı cevap üretir.
 * @param {{messages:Array<{role,content}>, secure?:boolean, maxTokens?:number}} opts
 * @param {(chunk:string)=>void} onDelta
 * @returns {Promise<{text:string, inputTokens:number, outputTokens:number, provider:string, model:string}>}
 */
export async function chat(opts, onDelta) {
  const cfg = resolve(!!opts.secure);
  const messages = opts.messages;
  const maxTokens = opts.maxTokens || 2000;

  if (cfg.style === 'demo') {
    let out = '';
    for (const w of DEMO.split(' ')) {
      out += (out ? ' ' : '') + w;
      onDelta((out === w ? '' : ' ') + w);
      await new Promise((r) => setTimeout(r, 22));
    }
    return { text: out, inputTokens: estimate(messages), outputTokens: Math.ceil(out.length / 4),
             provider: 'demo', model: 'demo' };
  }

  return cfg.style === 'anthropic'
    ? anthropicChat(cfg, messages, maxTokens, onDelta)
    : openaiChat(cfg, messages, maxTokens, onDelta);
}

const estimate = (messages) =>
  Math.ceil(messages.reduce((n, m) => n + String(m.content || '').length, 0) / 4);

/** SSE gövdesini satır satır okur. */
async function* sseLines(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.trim();
}

async function openaiChat(cfg, messages, maxTokens, onDelta) {
  const res = await fetch(cfg.base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
    body: JSON.stringify(Object.assign({
      model: cfg.model,
      messages,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true }
    }, cfg.name === 'gemini'
      // Gemini varsayılan olarak uzun uzun "düşünüyor": ilk kelime 20+ saniye
      // sonra geliyor ve düşünme bütçesi cevabı yiyor. Düşük seviyede tutuyoruz.
      ? { reasoning_effort: process.env.AI_REASONING || 'low' }
      : {}))
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(providerError(res.status, body, cfg));
  }

  let text = '', usage = null;
  for await (const line of sseLines(res)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') break;
    let j; try { j = JSON.parse(payload); } catch { continue; }
    if (j.usage) usage = j.usage;
    const d = j.choices?.[0]?.delta?.content;
    if (d) { text += d; onDelta(d); }
  }

  return {
    text,
    inputTokens: usage?.prompt_tokens ?? estimate(messages),
    outputTokens: usage?.completion_tokens ?? Math.ceil(text.length / 4),
    provider: cfg.name, model: cfg.model
  };
}

async function anthropicChat(cfg, messages, maxTokens, onDelta) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const rest = messages.filter((m) => m.role !== 'system');

  const res = await fetch(cfg.base + '/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: cfg.model, system, messages: rest, max_tokens: maxTokens, stream: true })
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(providerError(res.status, body, cfg));
  }

  let text = '', inTok = 0, outTok = 0;
  for await (const line of sseLines(res)) {
    if (!line.startsWith('data:')) continue;
    let j; try { j = JSON.parse(line.slice(5).trim()); } catch { continue; }
    if (j.type === 'content_block_delta' && j.delta?.text) { text += j.delta.text; onDelta(j.delta.text); }
    if (j.type === 'message_start') inTok = j.message?.usage?.input_tokens || 0;
    if (j.type === 'message_delta') outTok = j.usage?.output_tokens || outTok;
  }

  return {
    text,
    inputTokens: inTok || estimate(messages),
    outputTokens: outTok || Math.ceil(text.length / 4),
    provider: cfg.name, model: cfg.model
  };
}

function providerError(status, body, cfg) {
  let detail = '';
  try { detail = JSON.parse(body)?.error?.message || ''; } catch { detail = body.slice(0, 200); }
  if (status === 401 || status === 403) return `${cfg.label}: API anahtarı geçersiz veya yetkisiz.`;
  if (status === 429) return `${cfg.label}: ücretsiz kota doldu ya da çok hızlı istek gönderildi. Biraz bekleyip tekrar deneyin.`;
  if (status === 400 && /token|context|length/i.test(detail)) {
    return `${cfg.label}: içerik modelin sınırına sığmadı. Daha küçük bir dosya deneyin.`;
  }
  if (status >= 500) return `${cfg.label} şu an cevap vermiyor. Biraz sonra tekrar deneyin.`;
  return `${cfg.label} hatası (${status})${detail ? ': ' + detail : ''}`;
}
