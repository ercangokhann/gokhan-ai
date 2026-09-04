import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

const N = 16384, r = 8, p = 1, KEYLEN = 64;

/** scrypt$N$r$p$salt$key — hiçbir yerde düz şifre saklanmaz. */
export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(plain, salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(plain, stored) {
  try {
    const [scheme, n, rr, pp, saltB64, keyB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = await scrypt(plain, salt, expected.length, {
      N: Number(n), r: Number(rr), p: Number(pp), maxmem: 64 * 1024 * 1024
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const WORDS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Okunabilir geçici şifre: 20 karakter, karıştırılabilir harfler (0/O, 1/I/l) yok. */
export function tempPassword() {
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) {
    if (i > 0 && i % 5 === 0) out += '-';
    out += WORDS[bytes[i] % WORDS.length];
  }
  return out; // örn. K7QMR-3XZTP-9WNBD-VH4FS
}

export const PASSWORD_MIN = 12;

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) {
    return `Şifre en az ${PASSWORD_MIN} karakter olmalı.`;
  }
  if (pw.length > 200) return 'Şifre çok uzun.';
  if (!/[^a-zA-Z]/.test(pw) && pw.length < 16) {
    return 'Şifre en az bir rakam veya sembol içermeli (ya da 16+ karakter olmalı).';
  }
  return null;
}

export function validUsername(u) {
  return typeof u === 'string' && /^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$/.test(u);
}

export function validEmail(e) {
  return typeof e === 'string' && e.length <= 120 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e);
}
