import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  classifyUserAgent,
  cleanupClicks,
  createLink,
  generateSlug,
  getLink,
  linkStats,
  openDatabase,
  recordClick,
  unavailableReason,
  validateLink,
} from '../src/db.js';
import { createServer } from '../src/server.js';

let db: Database.Database;
beforeEach(() => {
  db = openDatabase(':memory:');
});
afterEach(() => {
  db.close();
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.AUTH_ENCRYPTION_KEY;
  delete process.env.API_TOKEN;
});

async function listen(options = {}) {
  const app = createServer(db, { baseUrl: 'https://go.example', ...options });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  return { server, base: `http://127.0.0.1:${(server.address() as any).port}` };
}
const json = (
  base: string,
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {}
) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('links', () => {
  it('validates targets and slugs', () => {
    expect(() => validateLink({ target: 'example.com' })).toThrow('full URL');
    expect(() => validateLink({ target: 'ftp://x.y' })).toThrow('http');
    expect(() => validateLink({ target: 'https://x.y', slug: 'bad slug' })).toThrow('slug');
    expect(() => validateLink({ target: 'https://x.y', slug: 'dashboard' })).toThrow('reserved');
    expect(() => validateLink({ target: 'https://x.y', maxClicks: 0 })).toThrow('maxClicks');
    expect(validateLink({ target: 'https://x.y/a?b=1', slug: 'ok_1' })).toMatchObject({
      slug: 'ok_1',
      enabled: true,
    });
  });
  it('generates unique slugs and rejects duplicates case-insensitively', () => {
    expect(generateSlug()).toMatch(/^[a-zA-Z0-9]{6}$/);
    const a = createLink(db, validateLink({ target: 'https://a.io' }));
    const b = createLink(db, validateLink({ target: 'https://b.io' }));
    expect(a.slug).not.toBe(b.slug);
    createLink(db, validateLink({ target: 'https://c.io', slug: 'Launch' }));
    expect(() => createLink(db, validateLink({ target: 'https://d.io', slug: 'launch' }))).toThrow('taken');
  });
  it('reports why a link is unavailable', () => {
    const link = createLink(db, validateLink({ target: 'https://a.io', maxClicks: 1 }));
    expect(unavailableReason(link)).toBeUndefined();
    recordClick(db, link.id, {});
    expect(unavailableReason(getLink(db, link.id)!)).toBe('limit reached');
    expect(unavailableReason({ ...link, expiresAt: 1 })).toBe('expired');
    expect(unavailableReason({ ...link, enabled: false })).toBe('disabled');
  });
});

describe('statistics', () => {
  it('classifies user agents and aggregates clicks without storing IPs', () => {
    expect(
      classifyUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      )
    ).toEqual({ browser: 'Safari', os: 'iOS', device: 'Mobile' });
    expect(
      classifyUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'
      )
    ).toEqual({ browser: 'Edge', os: 'Windows', device: 'Desktop' });
    expect(classifyUserAgent('curl/8.0')).toEqual({ browser: 'Bot', os: 'Other', device: 'Bot' });
    const link = createLink(db, validateLink({ target: 'https://a.io' }));
    const now = Date.now();
    recordClick(
      db,
      link.id,
      { ip: '1.2.3.4', userAgent: 'curl/8.0', referrer: 'https://www.news.example/story' },
      now - 1000
    );
    recordClick(db, link.id, { ip: '1.2.3.4', userAgent: 'curl/8.0' }, now - 2000);
    recordClick(
      db,
      link.id,
      { ip: '5.6.7.8', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0' },
      now - 2 * 86400000
    );
    recordClick(db, link.id, { ip: '9.9.9.9' }, now - 40 * 86400000);
    const stats = linkStats(db, link.id, now);
    expect(stats).toMatchObject({ total: 4, unique: 2, last24h: 2, last7d: 3 });
    expect(stats.perDay).toHaveLength(30);
    expect(stats.perDay[29].clicks).toBe(2);
    expect(stats.referrers[0]).toEqual({ referrer: 'news.example', clicks: 1 });
    expect(stats.browsers.map((b) => b.browser).sort()).toEqual(['Bot', 'Firefox']);
    const raw = db.prepare('SELECT visitor FROM clicks').all() as { visitor: string }[];
    expect(raw.some((r) => r.visitor.includes('1.2.3.4'))).toBe(false);
    expect(getLink(db, link.id)!.clicks).toBe(4);
    expect(cleanupClicks(db, 30, now)).toBe(1);
  });
});

describe('HTTP', () => {
  it('creates links through the API, redirects, counts clicks, and serves QR codes', async () => {
    const { server, base } = await listen();
    const created = await json(base, '/api/admin/links', 'POST', {
      target: 'https://example.com/page',
      slug: 'hello',
      title: 'Hi',
    });
    expect(created.status).toBe(201);
    const link = await created.json();
    expect(link.shortUrl).toBe('https://go.example/hello');
    const redirect = await fetch(`${base}/HELLO`, {
      redirect: 'manual',
      headers: { 'user-agent': 'curl/8.0', referer: 'https://t.co/x' },
    });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('https://example.com/page');
    const detail = await (await fetch(`${base}/api/admin/links/${link.id}`)).json();
    expect(detail.clicks).toBe(1);
    expect(detail.stats.referrers[0].referrer).toBe('t.co');
    const qr = await fetch(`${base}/api/admin/links/${link.id}/qr.png`);
    expect(qr.headers.get('content-type')).toContain('image/png');
    expect((await fetch(`${base}/missing`, { redirect: 'manual' })).status).toBe(404);
    await json(base, `/api/admin/links/${link.id}`, 'PUT', {
      target: 'https://example.com/page',
      slug: 'hello',
      title: 'Hi',
      enabled: false,
    });
    expect((await fetch(`${base}/hello`, { redirect: 'manual' })).status).toBe(410);
    expect(
      (await json(base, '/api/admin/links', 'POST', { target: 'https://x.y', slug: 'hello' })).status
    ).toBe(400);
    const list = await (await fetch(`${base}/api/admin/links?q=Hi`)).json();
    expect(list).toHaveLength(1);
    expect((await (await fetch(`${base}/api/admin/overview`)).json()).clicks).toBe(1);
    for (const path of ['/dashboard', '/dashboard/security', '/login']) {
      const html = await (await fetch(`${base}${path}`)).text();
      const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
      if (script) expect(() => new Function(script)).not.toThrow();
    }
    expect((await fetch(`${base}/api/admin/links/${link.id}`, { method: 'DELETE' })).status).toBe(204);
    server.close();
  });

  it('uses 301 with caching when configured', async () => {
    const { server, base } = await listen({ redirectStatus: 301 });
    const link = await (
      await json(base, '/api/admin/links', 'POST', { target: 'https://example.com' })
    ).json();
    const redirect = await fetch(`${base}/${link.slug}`, { redirect: 'manual' });
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('cache-control')).toContain('max-age');
    server.close();
  });

  it('protects the dashboard with sessions and allows API tokens for scripts', async () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'pw';
    process.env.AUTH_ENCRYPTION_KEY = 'k'.repeat(40);
    process.env.API_TOKEN = 'script-token';
    const { server, base } = await listen();
    expect((await fetch(`${base}/api/admin/links`)).status).toBe(401);
    expect((await fetch(`${base}/dashboard`, { redirect: 'manual' })).status).toBe(302);
    expect(
      (
        await json(
          base,
          '/api/admin/links',
          'POST',
          { target: 'https://x.y' },
          { Authorization: 'Bearer wrong' }
        )
      ).status
    ).toBe(401);
    const viaToken = await json(
      base,
      '/api/admin/links',
      'POST',
      { target: 'https://x.y' },
      { Authorization: 'Bearer script-token' }
    );
    expect(viaToken.status).toBe(201);
    const slug = (await viaToken.json()).slug;
    expect((await fetch(`${base}/${slug}`, { redirect: 'manual' })).status).toBe(302);
    const login = await json(
      base,
      '/api/auth/login',
      'POST',
      {},
      { Authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') }
    );
    expect(login.status).toBe(200);
    const jar = login.headers
      .getSetCookie()
      .map((v) => v.split(';', 1)[0])
      .join('; ');
    expect((await fetch(`${base}/api/admin/links`, { headers: { Cookie: jar } })).status).toBe(200);
    expect(
      (await json(base, '/api/admin/links', 'POST', { target: 'https://x.y' }, { Cookie: jar })).status
    ).toBe(403);
    server.close();
  });
});
