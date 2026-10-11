import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { initAuth } from './auth.js';

export interface Link {
  id: number;
  slug: string;
  target: string;
  title: string;
  enabled: boolean;
  expiresAt: number | null;
  maxClicks: number | null;
  clicks: number;
  createdAt: number;
  updatedAt: number;
}
export interface Click {
  id: number;
  linkId: number;
  at: number;
  referrer: string | null;
  browser: string;
  os: string;
  device: string;
  visitor: string;
}
export interface LinkStats {
  total: number;
  unique: number;
  last24h: number;
  last7d: number;
  perDay: { day: string; clicks: number }[];
  referrers: { referrer: string; clicks: number }[];
  browsers: { browser: string; clicks: number }[];
  os: { os: string; clicks: number }[];
  devices: { device: string; clicks: number }[];
}

/** Slugs that are routes of the application itself and can never be short links. */
export const RESERVED_SLUGS = new Set([
  'api',
  'dashboard',
  'login',
  'healthz',
  'status',
  'assets',
  'favicon.ico',
  'robots.txt',
]);
const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function openDatabase(filename: string): Database.Database {
  const dir = path.dirname(filename);
  if (dir !== '.' && filename !== ':memory:') fs.mkdirSync(dir, { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initAuth(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      target TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      expires_at INTEGER,
      max_clicks INTEGER,
      clicks INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      at INTEGER NOT NULL,
      referrer TEXT,
      browser TEXT NOT NULL DEFAULT 'Other',
      os TEXT NOT NULL DEFAULT 'Other',
      device TEXT NOT NULL DEFAULT 'Desktop',
      visitor TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS clicks_link_time ON clicks(link_id, at);
  `);
  return db;
}

/* ---------- Links ---------- */
const columns =
  'id,slug,target,title,enabled,expires_at as expiresAt,max_clicks as maxClicks,clicks,created_at as createdAt,updated_at as updatedAt FROM links';
const toLink = (row: any): Link => ({ ...row, enabled: Boolean(row.enabled) });

export function generateSlug(length = 6) {
  const bytes = randomBytes(length);
  let slug = '';
  for (let i = 0; i < length; i++) slug += ALPHABET[bytes[i] % ALPHABET.length];
  return slug;
}

export function validateLink(raw: unknown) {
  const l = (raw ?? {}) as Record<string, unknown>;
  const targetText = typeof l.target === 'string' ? l.target.trim() : '';
  let target: URL;
  try {
    target = new URL(targetText);
  } catch {
    throw new Error('target must be a full URL such as https://example.com/page');
  }
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('target must use http or https');
  const slug = typeof l.slug === 'string' ? l.slug.trim() : '';
  if (slug && !SLUG_PATTERN.test(slug)) throw new Error('slug may contain letters, digits, - and _ (max 64)');
  if (slug && RESERVED_SLUGS.has(slug.toLowerCase())) throw new Error(`"${slug}" is reserved`);
  const title = typeof l.title === 'string' ? l.title.trim().slice(0, 200) : '';
  const expiresAt = l.expiresAt == null || l.expiresAt === '' ? null : Number(l.expiresAt);
  if (expiresAt !== null && !Number.isFinite(expiresAt)) throw new Error('expiresAt must be a timestamp');
  const maxClicks = l.maxClicks == null || l.maxClicks === '' ? null : Number(l.maxClicks);
  if (maxClicks !== null && (!Number.isInteger(maxClicks) || maxClicks < 1))
    throw new Error('maxClicks must be a positive integer');
  return { slug, target: target.toString(), title, enabled: l.enabled !== false, expiresAt, maxClicks };
}

export function createLink(db: Database.Database, input: ReturnType<typeof validateLink>): Link {
  const now = Date.now();
  const insert = db.prepare(
    'INSERT INTO links (slug,target,title,enabled,expires_at,max_clicks,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)'
  );
  if (input.slug) {
    if (getLinkBySlug(db, input.slug)) throw new Error(`"${input.slug}" is already taken`);
    const id = insert.run(
      input.slug,
      input.target,
      input.title,
      input.enabled ? 1 : 0,
      input.expiresAt,
      input.maxClicks,
      now,
      now
    ).lastInsertRowid;
    return getLink(db, Number(id))!;
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const slug = generateSlug(attempt < 5 ? 6 : 8);
    if (getLinkBySlug(db, slug)) continue;
    const id = insert.run(
      slug,
      input.target,
      input.title,
      input.enabled ? 1 : 0,
      input.expiresAt,
      input.maxClicks,
      now,
      now
    ).lastInsertRowid;
    return getLink(db, Number(id))!;
  }
  throw new Error('Could not generate a unique slug');
}
export function updateLink(db: Database.Database, id: number, input: ReturnType<typeof validateLink>): Link {
  const current = getLink(db, id);
  if (!current) throw new Error('Link not found');
  const slug = input.slug || current.slug;
  const clash = getLinkBySlug(db, slug);
  if (clash && clash.id !== id) throw new Error(`"${slug}" is already taken`);
  db.prepare(
    'UPDATE links SET slug=?,target=?,title=?,enabled=?,expires_at=?,max_clicks=?,updated_at=? WHERE id=?'
  ).run(
    slug,
    input.target,
    input.title,
    input.enabled ? 1 : 0,
    input.expiresAt,
    input.maxClicks,
    Date.now(),
    id
  );
  return getLink(db, id)!;
}
export function getLink(db: Database.Database, id: number): Link | undefined {
  const row = db.prepare(`SELECT ${columns} WHERE id=?`).get(id);
  return row ? toLink(row) : undefined;
}
export function getLinkBySlug(db: Database.Database, slug: string): Link | undefined {
  const row = db.prepare(`SELECT ${columns} WHERE slug=? COLLATE NOCASE`).get(slug);
  return row ? toLink(row) : undefined;
}
export function listLinks(db: Database.Database, search = ''): Link[] {
  const like = `%${search.trim()}%`;
  return db
    .prepare(
      `SELECT ${columns}${search.trim() ? ' WHERE slug LIKE ? OR target LIKE ? OR title LIKE ?' : ''} ORDER BY created_at DESC`
    )
    .all(...(search.trim() ? [like, like, like] : []))
    .map(toLink);
}
export function removeLink(db: Database.Database, id: number) {
  return db.prepare('DELETE FROM links WHERE id=?').run(id).changes > 0;
}

/** Why a link cannot be followed right now, or undefined when it is live. */
export function unavailableReason(link: Link, now = Date.now()) {
  if (!link.enabled) return 'disabled';
  if (link.expiresAt !== null && link.expiresAt <= now) return 'expired';
  if (link.maxClicks !== null && link.clicks >= link.maxClicks) return 'limit reached';
  return undefined;
}

/* ---------- Clicks ---------- */
export interface Visit {
  referrer?: string;
  userAgent?: string;
  ip?: string;
}
/** Minimal user-agent classification; good enough for a dashboard, no external database. */
export function classifyUserAgent(ua = '') {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl|wget|python|bot|crawler|spider/i.test(ua)
              ? 'Bot'
              : 'Other';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Other';
  const device = /iPad|Tablet/.test(ua)
    ? 'Tablet'
    : /Mobi|Android|iPhone/.test(ua)
      ? 'Mobile'
      : browser === 'Bot'
        ? 'Bot'
        : 'Desktop';
  return { browser, os, device };
}
function referrerHost(referrer?: string) {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}
/** Daily-rotating visitor hash: counts unique visitors without storing IP addresses. */
function visitorHash(ip = '', ua = '', at: number) {
  const day = new Date(at).toISOString().slice(0, 10);
  return createHash('sha256').update(`${day}|${ip}|${ua}`).digest('hex').slice(0, 24);
}
export function recordClick(db: Database.Database, linkId: number, visit: Visit, at = Date.now()) {
  const { browser, os, device } = classifyUserAgent(visit.userAgent);
  db.transaction(() => {
    db.prepare(
      'INSERT INTO clicks (link_id,at,referrer,browser,os,device,visitor) VALUES (?,?,?,?,?,?,?)'
    ).run(
      linkId,
      at,
      referrerHost(visit.referrer),
      browser,
      os,
      device,
      visitorHash(visit.ip, visit.userAgent, at)
    );
    db.prepare('UPDATE links SET clicks=clicks+1 WHERE id=?').run(linkId);
  })();
}
export function linkStats(db: Database.Database, linkId: number, now = Date.now()): LinkStats {
  const since = now - 30 * 86400000;
  const count = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n;
  const top = <K extends string>(column: K) =>
    db
      .prepare(
        `SELECT ${column}, COUNT(*) as clicks FROM clicks WHERE link_id=? AND at>=? AND ${column} IS NOT NULL GROUP BY ${column} ORDER BY clicks DESC LIMIT 10`
      )
      .all(linkId, since) as any[];
  const perDayRows = db
    .prepare(
      "SELECT strftime('%Y-%m-%d', at/1000, 'unixepoch') as day, COUNT(*) as clicks FROM clicks WHERE link_id=? AND at>=? GROUP BY day"
    )
    .all(linkId, since) as { day: string; clicks: number }[];
  const byDay = new Map(perDayRows.map((r) => [r.day, r.clicks]));
  const perDay = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(now - i * 86400000).toISOString().slice(0, 10);
    perDay.push({ day, clicks: byDay.get(day) ?? 0 });
  }
  return {
    total: count('SELECT COUNT(*) as n FROM clicks WHERE link_id=?', linkId),
    unique: count('SELECT COUNT(DISTINCT visitor) as n FROM clicks WHERE link_id=? AND at>=?', linkId, since),
    last24h: count('SELECT COUNT(*) as n FROM clicks WHERE link_id=? AND at>=?', linkId, now - 86400000),
    last7d: count('SELECT COUNT(*) as n FROM clicks WHERE link_id=? AND at>=?', linkId, now - 7 * 86400000),
    perDay,
    referrers: top('referrer'),
    browsers: top('browser'),
    os: top('os'),
    devices: top('device'),
  };
}
export function overview(db: Database.Database, now = Date.now()) {
  const count = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n;
  return {
    links: count('SELECT COUNT(*) as n FROM links'),
    clicks: count('SELECT COUNT(*) as n FROM clicks'),
    last24h: count('SELECT COUNT(*) as n FROM clicks WHERE at>=?', now - 86400000),
    last7d: count('SELECT COUNT(*) as n FROM clicks WHERE at>=?', now - 7 * 86400000),
  };
}
export function cleanupClicks(db: Database.Database, retentionDays: number, now = Date.now()) {
  if (!retentionDays) return 0;
  return db.prepare('DELETE FROM clicks WHERE at<?').run(now - retentionDays * 86400000).changes;
}
