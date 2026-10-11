import express from 'express';
import type Database from 'better-sqlite3';
import { timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import {
  basicCredentials,
  createSession,
  deleteTotp,
  destroySession,
  hasTotp,
  initAuth,
  randomTotpSetup,
  saveTotp,
  session,
  validateAuthEncryptionKey,
  validCsrf,
  verifyTotp,
} from './auth.js';
import {
  createLink,
  getLink,
  getLinkBySlug,
  linkStats,
  listLinks,
  overview,
  recordClick,
  removeLink,
  unavailableReason,
  updateLink,
  validateLink,
} from './db.js';
import { dashboardPage, gonePage, loginPage, securityPage } from './ui.js';

const SESSION_HOURS = 8;
const LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function sameString(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface ServerOptions {
  baseUrl?: string;
  redirectStatus?: 301 | 302;
}

export function createServer(db: Database.Database, options: ServerOptions = {}) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const configured = Boolean(username || password);
  if (configured && (!username || !password))
    throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be configured together');
  if (configured) validateAuthEncryptionKey();
  initAuth(db);
  const apiToken = process.env.API_TOKEN?.trim() || undefined;
  const redirectStatus = options.redirectStatus ?? (process.env.REDIRECT_STATUS === '301' ? 301 : 302);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  app.use(express.json({ limit: '50kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  const baseUrl = (req: express.Request) =>
    (options.baseUrl ?? process.env.BASE_URL?.trim() ?? '').replace(/\/+$/, '') ||
    `${req.protocol}://${req.get('host')}`;
  const shortUrl = (req: express.Request, slug: string) => `${baseUrl(req)}/${slug}`;
  const cookie = (req: express.Request, name: string) =>
    req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${name}=`))
      ?.slice(name.length + 1);
  const basicOk = (req: express.Request) => {
    const c = basicCredentials(req);
    return Boolean(
      c && username && password && sameString(c.username, username) && sameString(c.password, password)
    );
  };
  const bearerOk = (req: express.Request) => {
    const value = req.headers.authorization;
    return Boolean(apiToken && value?.startsWith('Bearer ') && sameString(value.slice(7).trim(), apiToken));
  };
  const setAuthCookies = (
    req: express.Request,
    res: express.Response,
    s: { token: string; csrf: string }
  ) => {
    const secure = process.env.NODE_ENV === 'production' || req.secure;
    const attrs = `Path=/; Max-Age=${SESSION_HOURS * 60 * 60}; SameSite=Strict${secure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', [`session=${s.token}; HttpOnly; ${attrs}`, `csrf=${s.csrf}; ${attrs}`]);
  };
  const clearAuthCookies = (res: express.Response) =>
    res.setHeader('Set-Cookie', [
      'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict',
      'csrf=; Path=/; Max-Age=0; SameSite=Strict',
    ]);
  const failures = new Map<string, { count: number; until: number }>();
  const auth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!configured) return next();
    if (req.originalUrl.startsWith('/api/') && bearerOk(req)) return next();
    const row = session(db, cookie(req, 'session'));
    if (!row)
      return req.originalUrl.startsWith('/api/')
        ? res.status(401).json({ error: 'Authentication required' })
        : res.redirect('/login');
    if (req.method !== 'GET' && !validCsrf(row, req.headers['x-csrf-token'] as string))
      return res.status(403).json({ error: 'CSRF validation failed' });
    next();
  };
  const setup = () => {
    const s = randomTotpSetup();
    return { ...s, otpauth: `otpauth://totp/Link%20Shortener?secret=${s.secret}&issuer=Link%20Shortener` };
  };
  const setupResponse = async (
    res: express.Response,
    s: { secret: string; codes: string[]; otpauth: string }
  ) =>
    res.json({
      secret: s.secret,
      recoveryCodes: s.codes,
      otpauth: s.otpauth,
      qrDataUrl: await QRCode.toDataURL(s.otpauth),
    });
  const badRequest = (res: express.Response, e: unknown) =>
    res.status(400).send(e instanceof Error ? e.message : 'Invalid request');
  const present = (req: express.Request, link: ReturnType<typeof getLink>) =>
    link ? { ...link, shortUrl: shortUrl(req, link.slug) } : undefined;

  /* ---------- Public ---------- */
  app.get('/', (_q, r) => r.redirect('/dashboard'));
  app.get('/healthz', (_q, r) => r.json({ ok: true }));
  app.get('/robots.txt', (_q, r) =>
    r.type('text/plain').send('User-agent: *\nDisallow: /dashboard\nDisallow: /api/\n')
  );
  app.get('/login', (_q, r) => (configured ? r.type('html').send(loginPage()) : r.redirect('/dashboard')));
  app.post('/api/auth/login', (req, res) => {
    if (!configured) return res.status(401).json({ error: 'Authentication is not configured' });
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const old = failures.get(ip);
    if (old && old.until > now && old.count >= LOGIN_ATTEMPTS)
      return res.status(429).json({ error: 'Too many attempts, try again later' });
    const passwordOk = basicOk(req);
    const totpOk = !hasTotp(db) || (passwordOk && verifyTotp(db, String(req.body?.code ?? '').trim()));
    if (!passwordOk || !totpOk) {
      const count = (old?.count ?? 0) + 1;
      failures.set(ip, { count, until: now + (count >= LOGIN_ATTEMPTS ? LOCKOUT_MS : 60 * 1000) });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    failures.delete(ip);
    setAuthCookies(req, res, createSession(db));
    return res.json({ ok: true });
  });
  app.post('/api/auth/logout', auth, (req, res) => {
    destroySession(db, cookie(req, 'session'));
    clearAuthCookies(res);
    res.json({ ok: true });
  });

  /* ---------- Admin ---------- */
  app.use(['/dashboard', '/api/admin'], auth);
  app.get('/dashboard', (_q, r) => r.type('html').send(dashboardPage()));
  app.get('/dashboard/security', (_q, r) => r.type('html').send(securityPage()));
  app.get('/api/admin/security', (_q, r) =>
    r.json({ authConfigured: configured, totpConfigured: hasTotp(db) })
  );
  app.post('/api/admin/security/regenerate', async (_q, r) => {
    if (!configured)
      return r.status(400).json({ error: 'Set ADMIN_USERNAME and ADMIN_PASSWORD before enabling TOTP' });
    const s = setup();
    saveTotp(db, s.secret, s.codes);
    return setupResponse(r, s);
  });
  app.post('/api/admin/security/disable', (_q, r) => {
    deleteTotp(db);
    r.json({ ok: true });
  });

  app.get('/api/admin/overview', (_q, r) => r.json(overview(db)));
  app.get('/api/admin/links', (q, r) =>
    r.json(listLinks(db, typeof q.query.q === 'string' ? q.query.q : '').map((l) => present(q, l)))
  );
  app.post('/api/admin/links', (q, r) => {
    try {
      r.status(201).json(present(q, createLink(db, validateLink(q.body))));
    } catch (e) {
      badRequest(r, e);
    }
  });
  app.get('/api/admin/links/:id', (q, r) => {
    const link = getLink(db, Number(q.params.id));
    if (!link) return r.sendStatus(404);
    r.json({ ...present(q, link), stats: linkStats(db, link.id) });
  });
  app.get('/api/admin/links/:id/qr.png', async (q, r) => {
    const link = getLink(db, Number(q.params.id));
    if (!link) return r.sendStatus(404);
    r.type('png').send(await QRCode.toBuffer(shortUrl(q, link.slug), { width: 320, margin: 1 }));
  });
  app.put('/api/admin/links/:id', (q, r) => {
    if (!getLink(db, Number(q.params.id))) return r.sendStatus(404);
    try {
      r.json(present(q, updateLink(db, Number(q.params.id), validateLink(q.body))));
    } catch (e) {
      badRequest(r, e);
    }
  });
  app.delete('/api/admin/links/:id', (q, r) =>
    removeLink(db, Number(q.params.id)) ? r.sendStatus(204) : r.sendStatus(404)
  );

  /* ---------- Redirects ---------- */
  app.get('/:slug', (req, res) => {
    const link = getLinkBySlug(db, req.params.slug);
    if (!link) return res.status(404).type('html').send(gonePage('This short link does not exist.'));
    const reason = unavailableReason(link);
    if (reason)
      return res
        .status(410)
        .type('html')
        .send(gonePage(`This short link is ${reason}.`));
    recordClick(db, link.id, { referrer: req.get('referer'), userAgent: req.get('user-agent'), ip: req.ip });
    res.setHeader('Cache-Control', redirectStatus === 301 ? 'public, max-age=3600' : 'no-store');
    res.redirect(redirectStatus, link.target);
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (error as any)?.type === 'entity.parse.failed' ? 400 : ((error as any)?.status ?? 500);
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status === 400 ? 'Invalid JSON body' : 'Internal server error' });
  });
  return app;
}
