import express from 'express';
import multer from 'multer';
import { q } from './db.js';
import { parseFile, asContext, MAX_UPLOAD_BYTES } from './docs.js';
import { chat, providerInfo, SYSTEM_PROMPT } from './ai.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 6 }
});

// Bağlam bütçesi: geçmiş mesajlar + belgeler için üst sınır (karakter)
const HISTORY_CHARS = 24000;
const DOC_CHARS = 90000;

const MONTHLY_TOKEN_LIMIT = Number(process.env.AI_MONTHLY_TOKEN_LIMIT || 3000000);
const DAILY_REQUEST_LIMIT = Number(process.env.AI_DAILY_REQUEST_LIMIT || 300);

export async function migrateChat() {
  await q(`
    CREATE TABLE IF NOT EXISTS conversations (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      text NOT NULL DEFAULT 'Yeni sohbet',
      secure     boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);

  await q(`
    CREATE TABLE IF NOT EXISTS messages (
      id              bigserial PRIMARY KEY,
      conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            text NOT NULL,
      content         text NOT NULL,
      tokens_in       integer NOT NULL DEFAULT 0,
      tokens_out      integer NOT NULL DEFAULT 0,
      provider        text,
      model           text,
      created_at      timestamptz NOT NULL DEFAULT now()
    )`);

  await q(`
    CREATE TABLE IF NOT EXISTS attachments (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name            text NOT NULL,
      kind            text NOT NULL,
      bytes           integer NOT NULL DEFAULT 0,
      chars           integer NOT NULL DEFAULT 0,
      content         text NOT NULL DEFAULT '',
      used            boolean NOT NULL DEFAULT false,
      created_at      timestamptz NOT NULL DEFAULT now()
    )`);

  await q(`CREATE INDEX IF NOT EXISTS conv_user_idx ON conversations (user_id, updated_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS msg_conv_idx ON messages (conversation_id, id)`);
  await q(`CREATE INDEX IF NOT EXISTS msg_created_idx ON messages (created_at)`);
}

async function usageOf(userId) {
  const { rows } = await q(`
    SELECT
      coalesce(sum(m.tokens_in),0)::bigint  AS gelen,
      coalesce(sum(m.tokens_out),0)::bigint AS giden,
      count(*) FILTER (WHERE m.role='assistant')::int AS istek
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = $1 AND m.created_at >= date_trunc('month', now())`, [userId]);
  const { rows: today } = await q(`
    SELECT count(*)::int AS istek FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = $1 AND m.role='assistant' AND m.created_at >= date_trunc('day', now())`, [userId]);
  const toplam = Number(rows[0].gelen) + Number(rows[0].giden);
  return {
    ayToken: toplam, ayIstek: rows[0].istek, gunIstek: today[0].istek,
    aylikSinir: MONTHLY_TOKEN_LIMIT, gunlukSinir: DAILY_REQUEST_LIMIT,
    kalanYuzde: Math.max(0, Math.round((1 - toplam / MONTHLY_TOKEN_LIMIT) * 100))
  };
}

async function ownConversation(id, user) {
  const { rows } = await q('SELECT * FROM conversations WHERE id=$1', [id]);
  const c = rows[0];
  if (!c) return null;
  if (c.user_id !== user.id) return null;   // sohbetler kişiye özel — yönetici de göremez
  return c;
}

export function chatRouter({ requireAuth, audit, actorOf }) {
  const r = express.Router();

  /* ── durum ─────────────────────────────────────────── */
  r.get('/ai/info', requireAuth, async (req, res) => {
    res.json({ saglayici: providerInfo(), kullanim: await usageOf(req.user.id) });
  });

  /* ── konuşmalar ────────────────────────────────────── */
  r.get('/conversations', requireAuth, async (req, res) => {
    const { rows } = await q(`
      SELECT c.id, c.title, c.secure, c.updated_at,
             (SELECT count(*) FROM messages m WHERE m.conversation_id=c.id)::int AS mesaj
      FROM conversations c WHERE c.user_id=$1 ORDER BY c.updated_at DESC LIMIT 60`, [req.user.id]);
    res.json({ conversations: rows });
  });

  r.post('/conversations', requireAuth, async (req, res) => {
    const secure = !!req.body?.secure;
    const { rows } = await q(
      `INSERT INTO conversations (user_id, title, secure) VALUES ($1,'Yeni sohbet',$2) RETURNING *`,
      [req.user.id, secure]);
    res.json({ conversation: rows[0] });
  });

  r.get('/conversations/:id', requireAuth, async (req, res) => {
    const c = await ownConversation(req.params.id, req.user);
    if (!c) return res.status(404).json({ error: 'Sohbet bulunamadı.' });
    const { rows: msgs } = await q(
      `SELECT id, role, content, created_at FROM messages
       WHERE conversation_id=$1 ORDER BY id ASC LIMIT 200`, [c.id]);
    const { rows: files } = await q(
      `SELECT id, name, kind, bytes, chars FROM attachments
       WHERE conversation_id=$1 ORDER BY created_at ASC`, [c.id]);
    res.json({ conversation: c, messages: msgs, attachments: files });
  });

  r.patch('/conversations/:id', requireAuth, async (req, res) => {
    const c = await ownConversation(req.params.id, req.user);
    if (!c) return res.status(404).json({ error: 'Sohbet bulunamadı.' });
    const title = String(req.body?.title ?? c.title).trim().slice(0, 120) || c.title;
    const secure = typeof req.body?.secure === 'boolean' ? req.body.secure : c.secure;
    const { rows } = await q(
      'UPDATE conversations SET title=$1, secure=$2, updated_at=now() WHERE id=$3 RETURNING *',
      [title, secure, c.id]);
    res.json({ conversation: rows[0] });
  });

  r.delete('/conversations/:id', requireAuth, async (req, res) => {
    const c = await ownConversation(req.params.id, req.user);
    if (!c) return res.status(404).json({ error: 'Sohbet bulunamadı.' });
    await q('DELETE FROM conversations WHERE id=$1', [c.id]);
    res.json({ ok: true });
  });

  /* ── dosya yükleme ─────────────────────────────────── */
  r.post('/uploads', requireAuth, (req, res) => {
    upload.array('files', 6)(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          error: err.code === 'LIMIT_FILE_SIZE'
            ? 'Dosya 25 MB sınırını aşıyor.'
            : 'Dosya yüklenemedi: ' + err.message
        });
      }
      const convId = req.body?.conversationId || null;
      if (convId && !(await ownConversation(convId, req.user))) {
        return res.status(404).json({ error: 'Sohbet bulunamadı.' });
      }
      if (!req.files?.length) return res.status(400).json({ error: 'Dosya seçilmedi.' });

      const out = [];
      for (const f of req.files) {
        const parsed = await parseFile(f);
        if (parsed.error) { out.push({ name: parsed.name, error: parsed.error }); continue; }
        const { rows } = await q(
          `INSERT INTO attachments (conversation_id, user_id, name, kind, bytes, chars, content)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, kind, bytes, chars`,
          [convId, req.user.id, parsed.name, parsed.kind, parsed.bytes, parsed.chars, parsed.text]);
        out.push({ ...rows[0], approxTokens: parsed.approxTokens });
      }
      await audit({ ...actorOf(req), action: 'file.upload',
                    detail: out.map((f) => f.name).join(', ').slice(0, 200), ok: true });
      res.json({ files: out });
    });
  });

  /* ── sohbet (akışlı) ───────────────────────────────── */
  r.post('/chat', requireAuth, async (req, res) => {
    const text = String(req.body?.text || '').trim();
    const ids = Array.isArray(req.body?.attachmentIds) ? req.body.attachmentIds.slice(0, 6) : [];
    let convId = req.body?.conversationId || null;

    if (!text && !ids.length) return res.status(400).json({ error: 'Mesaj boş.' });

    const use = await usageOf(req.user.id);
    if (use.ayToken >= use.aylikSinir) {
      return res.status(429).json({ error: 'Bu ay için ayrılan yapay zeka kotası doldu. Yöneticinize başvurun.' });
    }
    if (use.gunIstek >= use.gunlukSinir) {
      return res.status(429).json({ error: 'Günlük istek sınırına ulaşıldı. Yarın tekrar deneyin.' });
    }

    let conv;
    if (convId) {
      conv = await ownConversation(convId, req.user);
      if (!conv) return res.status(404).json({ error: 'Sohbet bulunamadı.' });
    } else {
      const { rows } = await q(
        `INSERT INTO conversations (user_id, title, secure) VALUES ($1,$2,$3) RETURNING *`,
        [req.user.id, text.slice(0, 60) || 'Dosya incelemesi', !!req.body?.secure]);
      conv = rows[0]; convId = conv.id;
    }

    // dosyaları bu sohbete bağla
    let docs = [];
    if (ids.length) {
      const { rows } = await q(
        `UPDATE attachments SET conversation_id=$1, used=true
         WHERE id = ANY($2::uuid[]) AND user_id=$3 RETURNING name, kind, content`,
        [convId, ids, req.user.id]);
      docs = rows;
    }

    // geçmiş
    const { rows: hist } = await q(
      `SELECT role, content FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 20`, [convId]);
    hist.reverse();
    let budget = HISTORY_CHARS;
    const history = [];
    for (let i = hist.length - 1; i >= 0; i--) {
      const c = hist[i].content;
      if (budget - c.length < 0) break;
      budget -= c.length;
      history.unshift({ role: hist[i].role, content: c });
    }

    let docBlock = '';
    for (const d of docs) {
      const block = asContext({ name: d.name, kind: d.kind, text: d.content });
      if (docBlock.length + block.length > DOC_CHARS) break;
      docBlock += block + '\n\n';
    }

    const userContent = docBlock ? docBlock + (text || 'Bu dosyaları incele ve özetle.') : text;
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history, { role: 'user', content: userContent }];

    await q('INSERT INTO messages (conversation_id, role, content) VALUES ($1,$2,$3)',
      [convId, 'user', (docs.length ? docs.map((d) => '📎 ' + d.name).join(', ') + '\n' : '') + (text || '(dosya gönderildi)')]);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
    send({ type: 'start', conversationId: convId });

    try {
      const out = await chat({ messages, secure: conv.secure }, (d) => send({ type: 'delta', text: d }));

      await q(`INSERT INTO messages (conversation_id, role, content, tokens_in, tokens_out, provider, model)
               VALUES ($1,'assistant',$2,$3,$4,$5,$6)`,
        [convId, out.text, out.inputTokens, out.outputTokens, out.provider, out.model]);

      const title = conv.title === 'Yeni sohbet' && text ? text.slice(0, 60) : conv.title;
      await q('UPDATE conversations SET updated_at=now(), title=$2 WHERE id=$1', [convId, title]);

      send({ type: 'done', usage: { in: out.inputTokens, out: out.outputTokens },
             provider: out.provider, model: out.model, title });
    } catch (e) {
      console.error('[chat]', e.message);
      send({ type: 'error', error: e.message });
    }
    res.end();
  });

  /* ── yönetici: kullanım ────────────────────────────── */
  r.get('/usage', requireAuth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Yönetici yetkisi gerekli.' });
    const { rows } = await q(`
      SELECT u.username, u.display_name, u.email,
             coalesce(sum(m.tokens_in),0)::bigint  AS gelen,
             coalesce(sum(m.tokens_out),0)::bigint AS giden,
             count(*) FILTER (WHERE m.role='assistant')::int AS istek,
             max(m.created_at) AS son
      FROM users u
      LEFT JOIN conversations c ON c.user_id = u.id
      LEFT JOIN messages m ON m.conversation_id = c.id AND m.created_at >= date_trunc('month', now())
      GROUP BY u.id ORDER BY (coalesce(sum(m.tokens_in),0)+coalesce(sum(m.tokens_out),0)) DESC`);
    res.json({ rows, aylikSinir: MONTHLY_TOKEN_LIMIT, saglayici: providerInfo() });
  });

  return r;
}
