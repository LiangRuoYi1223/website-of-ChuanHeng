import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, realpathSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialSettings, initialActivities, initialProjects, initialCooperation, legacyActivityIds, legacyAboutDescription } from './seed.mjs';
import * as validate from './validation.mjs';
import { permissionsFor, canManage, canRegister } from './permissions.mjs';
import { findCity } from '../src/features/map-data/cities.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cookieName = 'chuanheng_session';
const sessionDuration = 24 * 60 * 60 * 1000;
const maxImageBytes = 8 * 1024 * 1024;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.pdf': 'application/pdf' };

function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}
function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, hash] = storedHash.split(':');
  const expected = Buffer.from(hash, 'hex'), actual = scryptSync(password, salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
const tokenHash = token => createHash('sha256').update(token).digest('hex');
function userView(user, includeActive = false) {
  return { id: user.id, username: user.username, displayName: user.display_name, role: user.role, isPresident: Boolean(user.is_president), permissions: permissionsFor(user), mustChangePassword: Boolean(user.must_change_password), ...(includeActive ? { active: Boolean(user.active) } : {}) };
}

function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(data));
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0, overLimit = false;
    const chunks = [];
    if (Number(req.headers['content-length']) > limit) {
      req.resume(); reject(new validate.HttpError(413, '请求内容过大。')); return;
    }
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        if (!overLimit) { overLimit = true; chunks.length = 0; reject(new validate.HttpError(413, '请求内容过大。')); }
      } else if (!overLimit) chunks.push(chunk);
    });
    req.on('end', () => {
      if (overLimit) return;
      try { resolve(size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new validate.HttpError(400, '请求内容不是有效的 JSON。')); }
    });
    req.on('error', reject);
  });
}

export function createApp(options = {}) {
  const dataDir = path.resolve(options.dataDir ?? path.join(projectRoot, 'data'));
  const uploadDir = path.resolve(options.uploadDir ?? path.join(projectRoot, 'uploads'));
  const distDir = path.resolve(options.distDir ?? path.join(projectRoot, 'dist'));
  const publicDir = path.resolve(options.publicDir ?? path.join(projectRoot, 'public'));
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const secureCookies = options.secureCookies ?? process.env.COOKIE_SECURE === 'true';
  const publicOrigin = options.publicOrigin ?? process.env.SITE_ORIGIN ?? '';
  const allowedOrigins = options.allowedOrigins ?? (production ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']);
  mkdirSync(dataDir, { recursive: true }); mkdirSync(uploadDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'chuanheng.sqlite'));
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS site_settings (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member','viewer')), is_president INTEGER NOT NULL DEFAULT 0 CHECK(is_president IN (0,1) AND (is_president = 0 OR role = 'admin')), permissions TEXT NOT NULL DEFAULT '[]', password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS registrations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE, created_at TEXT NOT NULL, UNIQUE(user_id, activity_id));
    CREATE TABLE IF NOT EXISTS site_status (id INTEGER PRIMARY KEY CHECK(id = 1), paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1));
    INSERT OR IGNORE INTO site_status (id, paused, revision) VALUES (1, 0, 1);
  `);
  // Add route/city metadata only to stored rows, so deleted demonstration activities stay deleted.
  // A city's demonstration assignment is safe only while its original seed location is unchanged.
  try {
    db.exec('BEGIN IMMEDIATE');
    const seeds = new Map(initialActivities.map(activity => [activity.id, activity]));
    const update = db.prepare('UPDATE activities SET payload = ?, revision = revision + 1 WHERE id = ?');
    for (const row of db.prepare('SELECT id, payload FROM activities').all()) {
      const existing = JSON.parse(row.payload), next = { ...existing }, seed = seeds.get(row.id);
      if (existing.routeName === undefined) {
        next.routeName = typeof existing.location === 'string' ? existing.location : '';
        next.location = next.routeName;
      }
      if (existing.cityCode === undefined) {
        const uneditedSeedLocation = existing.isDemo === true && seed && existing.location === seed.location
          && (existing.routeName === undefined || existing.routeName === seed.routeName);
        next.cityCode = uneditedSeedLocation && findCity(seed.cityCode) ? seed.cityCode : '';
      }
      if (existing.routeName === undefined || existing.cityCode === undefined) update.run(JSON.stringify(next), row.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  const userSchema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get().sql;
  const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
  const legacyDesignSeed = userSchema.includes("'editor'") && !userColumns.has('is_president');
  if (userSchema.includes("'founder'") || userSchema.includes("'editor'") || !userColumns.has('is_president')) {
    try {
    // Rebuild the role constraint while retaining IDs, password hashes, sessions and registrations.
    // Existing accounts receive no president marker unless it was already explicitly stored.
    db.exec(`PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;
      CREATE TABLE users_v3 (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member','viewer')), is_president INTEGER NOT NULL DEFAULT 0 CHECK(is_president IN (0,1) AND (is_president = 0 OR role = 'admin')), permissions TEXT NOT NULL DEFAULT '[]', password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 1);
      INSERT INTO users_v3 (id, username, display_name, role, is_president, permissions, password_hash, active, must_change_password)
        SELECT id, username, CASE display_name WHEN '协会创始者' THEN '协会管理员' ELSE display_name END, CASE role WHEN 'founder' THEN 'admin' WHEN 'editor' THEN 'admin' ELSE role END,
          ${userColumns.has('is_president') ? "CASE WHEN role IN ('founder','admin','editor') AND is_president = 1 THEN 1 ELSE 0 END" : '0'},
          ${userColumns.has('permissions') ? 'permissions' : "'[]'"}, password_hash, active, must_change_password FROM users;
      DROP TABLE users;
      ALTER TABLE users_v3 RENAME TO users;`);
    // Upgrade the previous design seed once, retaining edited values and deleted activities.
    if (legacyDesignSeed) {
    const storedSettings = db.prepare('SELECT payload FROM site_settings WHERE id = 1').get();
    if (storedSettings) {
      const settings = JSON.parse(storedSettings.payload);
      if (settings.aboutDescription === legacyAboutDescription) settings.aboutDescription = initialSettings.aboutDescription;
      for (const field of ['semesterName', 'semesterStart', 'semesterEnd']) if (settings[field] === undefined) settings[field] = initialSettings[field];
      db.prepare('UPDATE site_settings SET payload = ? WHERE id = 1').run(JSON.stringify(settings));
    }
    for (const activity of initialActivities) {
      const row = db.prepare('SELECT payload FROM activities WHERE id = ?').get(activity.id);
      if (!row) {
        if (!legacyActivityIds.includes(activity.id)) db.prepare('INSERT INTO activities (id, payload, revision) VALUES (?, ?, 1)').run(activity.id, JSON.stringify(activity));
        continue;
      }
      const existing = JSON.parse(row.payload);
      const next = { ...activity, ...existing };
      db.prepare('UPDATE activities SET payload = ? WHERE id = ?').run(JSON.stringify(next), activity.id);
    }
    const insertProject = db.prepare('INSERT OR IGNORE INTO projects (id, payload, revision) VALUES (?, ?, 1)');
    for (const project of initialProjects) insertProject.run(project.id, JSON.stringify(project));
    }
    db.exec('COMMIT; PRAGMA foreign_keys = ON;');
    } catch (error) {
      db.exec('ROLLBACK; PRAGMA foreign_keys = ON;');
      db.close();
      throw error;
    }
  }
  if (!db.prepare('SELECT id FROM site_settings WHERE id = 1').get()) {
    db.prepare('INSERT INTO site_settings (id, payload, revision) VALUES (1, ?, 1)').run(JSON.stringify(initialSettings));
    const insert = db.prepare('INSERT OR IGNORE INTO activities (id, payload, revision) VALUES (?, ?, 1)');
    for (const item of initialActivities) insert.run(item.id, JSON.stringify(item));
    const insertProject = db.prepare('INSERT OR IGNORE INTO projects (id, payload, revision) VALUES (?, ?, 1)');
    for (const item of initialProjects) insertProject.run(item.id, JSON.stringify(item));
  }
  if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
    const password = options.initialPassword ?? randomBytes(24).toString('base64url');
    validate.password(password);
    db.prepare('INSERT INTO users (id, username, display_name, role, is_president, password_hash) VALUES (?, ?, ?, ?, 1, ?)').run(randomUUID(), 'admin', '协会初始管理员', 'admin', passwordHash(password));
    writeFileSync(path.join(dataDir, 'initial-admin.txt'), `川衡网站初始管理员（社长）\n账号：admin\n密码：${password}\n首次登录请修改密码。本文件包含敏感信息，请妥善保管，修改后删除。\n`, { mode: 0o600, flag: 'w' });
  }
  const dummyPasswordHash = passwordHash(randomBytes(24).toString('hex'));
  const loginAttempts = new Map();
  const statusPasswordAttempts = new Map();
  const cookie = (token, clear = false) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : sessionDuration / 1000}${secureCookies ? '; Secure' : ''}`;

  function sameOrigin(req) {
    const origin = req.headers.origin;
    const requestOrigin = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
    if (!origin || (!allowedOrigins.includes(origin) && origin !== requestOrigin && origin !== publicOrigin)) validate.fail(403, '请从网站本身发起此操作。');
  }
  function authenticate(req) {
    const rawCookie = req.headers.cookie?.split(';').find(value => value.trim().startsWith(`${cookieName}=`));
    const token = rawCookie?.trim().slice(cookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const user = db.prepare('SELECT users.*, sessions.token_hash FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1').get(tokenHash(token), Date.now());
    return user ?? null;
  }
  function requireUser(req) {
    const user = authenticate(req);
    if (!user) validate.fail(401, '请先登录。');
    return user;
  }
  function requirePermission(user, permission) {
    if (!canManage(user, permission)) validate.fail(403, '你的账号没有内容管理权限。');
  }
  function requireChangedPassword(user) {
    if (user.must_change_password) throw new validate.HttpError(403, '首次登录或密码重置后，请先修改密码再继续操作。', 'PASSWORD_CHANGE_REQUIRED');
  }
  function requireManager(req) {
    const actor = requireUser(req);
    if (actor.role !== 'admin') validate.fail(403, '你的账号没有内容管理权限。');
    if (!['GET', 'HEAD'].includes(req.method)) requireChangedPassword(actor);
    return actor;
  }
  function siteStatus() {
    const status = db.prepare('SELECT paused, revision FROM site_status WHERE id = 1').get();
    return { paused: Boolean(status.paused), revision: status.revision };
  }
  function requireSiteAccess(req, actor = authenticate(req)) {
    if (siteStatus().paused && actor?.role !== 'admin') throw new validate.HttpError(503, '网站暂时停止开放，请稍后再访问。', 'SITE_PAUSED');
  }
  function requirePresident(req) {
    const actor = requireManager(req);
    if (!actor.is_president) validate.fail(403, '只有社长可以关停或恢复网站。');
    return actor;
  }
  function contentItem(row) { return { ...JSON.parse(row.payload), ...(row.id === 1 ? {} : { id: row.id }), revision: row.revision }; }
  function content(actor = null) {
    const settings = { logoUrl: '', demoMode: true, ...contentItem(db.prepare('SELECT * FROM site_settings WHERE id = 1').get()) };
    const list = table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid DESC`).all().map(contentItem).filter(item => (actor && canManage(actor, `${table}:write`)) || item.status === 'published');
    return { settings, activities: list('activities'), projects: list('projects'), cooperation: initialCooperation };
  }
  function checkRevision(inputRevision, currentRevision) {
    if ((inputRevision === undefined && currentRevision !== 1) || (inputRevision !== undefined && inputRevision !== currentRevision)) validate.fail(409, '内容已被其他维护者更新，请重新加载最新内容后再保存。');
  }
  function protectLastManager(existing, nextRole, nextActive, nextPresident) {
    if (existing.role === 'admin' && existing.active && (nextRole !== 'admin' || !nextActive)
      && db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1").get().count <= 1) validate.fail(400, '不能停用或降级最后一位有效管理员。');
    if (siteStatus().paused && existing.role === 'admin' && existing.active && existing.is_president
      && (nextRole !== 'admin' || !nextActive || !nextPresident)
      && db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND is_president = 1").get().count <= 1) validate.fail(400, '网站暂停时，不能停用、降级或取消最后一位有效社长的标记。');
  }
  function checkLoginLimit(req, username, attempts = loginAttempts, action = '登录') {
    const now = Date.now(), ip = req.socket.remoteAddress ?? 'unknown';
    for (const [key, item] of attempts) if (item.until < now) attempts.delete(key);
    const keys = [{ key: `ip:${ip}`, maximum: 30 }, { key: `user:${ip}:${username}`, maximum: 5 }];
    for (const { key, maximum } of keys) {
      const item = attempts.get(key);
      if (item && item.count >= maximum) validate.fail(429, `${action}尝试过于频繁，请 15 分钟后再试。`);
    }
    return {
      fail() { for (const { key } of keys) { const item = attempts.get(key) ?? { count: 0, until: now + 15 * 60 * 1000 }; item.count++; attempts.set(key, item); } },
      success() { attempts.delete(keys[1].key); },
    };
  }

  async function api(req, res, parsedUrl) {
    const route = parsedUrl.pathname, method = req.method;
    if (!['GET', 'HEAD'].includes(method)) sameOrigin(req);
    if (route === '/api/site-status' && method === 'GET') return json(res, 200, siteStatus());
    if (route === '/api/auth/me' && method === 'GET') {
      const user = authenticate(req); return json(res, 200, { user: user ? userView(user) : null });
    }
    if (route === '/api/auth/login' && method === 'POST') {
      const body = validate.object(await readBody(req, 4096));
      const username = validate.username(body.username), limit = checkLoginLimit(req, username);
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      const valid = verifyPassword(body.password, user?.password_hash ?? dummyPasswordHash);
      if (!user || !user.active || !valid) { limit.fail(); validate.fail(401, '账号或密码不正确。'); }
      limit.success();
      requireSiteAccess(req, user);
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
      const token = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash(token), user.id, Date.now() + sessionDuration);
      return json(res, 200, { user: userView(user) }, { 'Set-Cookie': cookie(token) });
    }
    if (route === '/api/auth/logout' && method === 'POST') {
      const user = authenticate(req); if (user) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(user.token_hash);
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', true) });
    }
    if (route === '/api/admin/site-status' && method === 'POST') {
      requirePresident(req);
      const input = validate.siteStatus(await readBody(req, 4096));
      let next;
      db.exec('BEGIN IMMEDIATE');
      try {
        // Re-read the live session, marker, password and revision after receiving the entire body.
        const currentActor = requirePresident(req);
        const limit = checkLoginLimit(req, currentActor.id, statusPasswordAttempts, '密码确认');
        if (!verifyPassword(input.password, currentActor.password_hash)) { limit.fail(); validate.fail(400, '密码确认不正确。'); }
        limit.success();
        const current = siteStatus();
        if (input.revision !== current.revision) validate.fail(409, '网站状态已被更新，请重新加载最新状态后再操作。');
        next = { paused: input.paused, revision: current.revision + 1 };
        db.prepare('UPDATE site_status SET paused = ?, revision = ? WHERE id = 1').run(Number(next.paused), next.revision);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, next);
    }
    requireSiteAccess(req);
    if (route === '/api/content' && method === 'GET') return json(res, 200, content());
    if (route === '/api/auth/password' && method === 'POST') {
      requireUser(req);
      const body = validate.object(await readBody(req, 4096)), user = requireUser(req);
      requireSiteAccess(req, user);
      if (!verifyPassword(body.currentPassword, user.password_hash)) validate.fail(400, '当前密码不正确。');
      const newPassword = validate.password(body.newPassword);
      if (verifyPassword(newPassword, user.password_hash)) validate.fail(400, '新密码需要与当前密码不同。');
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(passwordHash(newPassword), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(user.id, user.token_hash);
      return json(res, 200, { user: userView({ ...user, must_change_password: 0 }) });
    }
    const registrationMatch = route.match(/^\/api\/registrations(?:\/([^/]+))?$/);
    if (registrationMatch) {
      const actor = requireUser(req);
      if (!canRegister(actor)) validate.fail(403, '浏览者只能浏览活动，社员才可报名参加。');
      const activityId = registrationMatch[1];
      const registrationView = row => ({ id: row.id, activityId: row.activity_id, createdAt: row.created_at });
      if (method === 'GET' && !activityId) {
        return json(res, 200, { registrations: db.prepare('SELECT * FROM registrations WHERE user_id = ? ORDER BY created_at DESC').all(actor.id).map(registrationView) });
      }
      if (method === 'POST' && !activityId) {
        requireChangedPassword(actor);
        const body = validate.object(await readBody(req, 4096)), requestedActivity = validate.id(body.activityId);
        const currentActor = requireUser(req);
        requireSiteAccess(req, currentActor);
        if (!canRegister(currentActor)) validate.fail(403, '浏览者只能浏览活动，社员才可报名参加。');
        requireChangedPassword(currentActor);
        const row = db.prepare('SELECT * FROM activities WHERE id = ?').get(requestedActivity);
        if (!row || JSON.parse(row.payload).status !== 'published') validate.fail(404, '活动不存在或尚未发布。');
        const activity = JSON.parse(row.payload);
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        if (activity.isDemo || activity.kind !== 'upcoming' || activity.registrationOpen !== true || activity.date < today) validate.fail(400, '此活动尚未开放站内报名，或报名已经结束。');
        if (db.prepare('SELECT id FROM registrations WHERE user_id = ? AND activity_id = ?').get(actor.id, requestedActivity)) validate.fail(409, '你已报名此活动。');
        const registration = { id: randomUUID(), user_id: actor.id, activity_id: requestedActivity, created_at: new Date().toISOString() };
        db.prepare('INSERT INTO registrations (id, user_id, activity_id, created_at) VALUES (?, ?, ?, ?)').run(registration.id, registration.user_id, registration.activity_id, registration.created_at);
        return json(res, 201, { registration: registrationView(registration) });
      }
      if (method === 'DELETE' && activityId) {
        requireChangedPassword(actor);
        validate.id(activityId);
        const removed = db.prepare('DELETE FROM registrations WHERE user_id = ? AND activity_id = ?').run(actor.id, activityId);
        if (!removed.changes) validate.fail(404, '你尚未报名此活动。');
        return json(res, 200, { ok: true });
      }
      validate.fail(404, '接口不存在。');
    }
    if (!route.startsWith('/api/admin/')) validate.fail(404, '接口不存在。');
    const actor = requireManager(req);
    if (route === '/api/admin/content' && method === 'GET') return json(res, 200, content(actor));
    if (route === '/api/admin/settings' && method === 'PUT') {
      requirePermission(actor, 'settings:write');
      const input = validate.settings(await readBody(req));
      requirePermission(requireManager(req), 'settings:write');
      const current = db.prepare('SELECT revision FROM site_settings WHERE id = 1').get();
      checkRevision(input.revision, current.revision);
      const nextRevision = current.revision + 1;
      delete input.revision;
      db.prepare('UPDATE site_settings SET payload = ?, revision = ? WHERE id = 1').run(JSON.stringify(input), nextRevision);
      return json(res, 200, { settings: { ...input, revision: nextRevision } });
    }
    const contentMatch = route.match(/^\/api\/admin\/(activities|projects)(?:\/([^/]+))?$/);
    if (contentMatch) {
      const table = contentMatch[1], resultKey = table === 'activities' ? 'activity' : 'project', itemId = contentMatch[2];
      requirePermission(actor, `${table}:write`);
      if (method === 'POST' && !itemId) {
        const body = validate.object(await readBody(req));
        requirePermission(requireManager(req), `${table}:write`);
        const item = table === 'activities' ? validate.activity(body) : validate.project(body);
        const newId = body.id ? validate.id(body.id) : randomUUID();
        if (db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(newId)) validate.fail(409, '该内容 ID 已存在。');
        delete item.revision;
        db.prepare(`INSERT INTO ${table} VALUES (?, ?, 1)`).run(newId, JSON.stringify(item));
        return json(res, 201, { [resultKey]: { ...item, id: newId, revision: 1 } });
      }
      if (itemId && ['PUT', 'DELETE'].includes(method)) {
        validate.id(itemId);
        const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(itemId);
        if (!current) validate.fail(404, '内容不存在，可能已被删除。');
        if (method === 'DELETE') {
          const requestedRevision = parsedUrl.searchParams.get('revision');
          if (requestedRevision !== null) { const value = Number(requestedRevision); validate.revision(value); checkRevision(value, current.revision); }
          db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(itemId);
          return json(res, 200, { ok: true });
        }
        const body = validate.object(await readBody(req));
        requirePermission(requireManager(req), `${table}:write`);
        if (body.id && body.id !== itemId) validate.fail(400, '请求 ID 与内容 ID 不一致。');
        const item = table === 'activities' ? validate.activity(body) : validate.project(body);
        checkRevision(item.revision, current.revision);
        const nextRevision = current.revision + 1;
        delete item.revision;
        db.prepare(`UPDATE ${table} SET payload = ?, revision = ? WHERE id = ?`).run(JSON.stringify(item), nextRevision, itemId);
        return json(res, 200, { [resultKey]: { ...item, id: itemId, revision: nextRevision } });
      }
    }
    if (route === '/api/admin/users' && method === 'GET') return json(res, 200, { users: db.prepare('SELECT * FROM users ORDER BY username').all().map(user => userView(user, true)) });
    if (route === '/api/admin/users' && method === 'POST') {
      const body = validate.object(await readBody(req, 8192));
      requireManager(req);
      const username = validate.username(body.username), displayName = validate.string(body.displayName, '显示名称', { required: true, max: 100 }), role = validate.role(body.role);
      const permissions = validate.permissions(body.permissions, role);
      const isPresident = validate.isPresident(body.isPresident, role);
      const hash = passwordHash(validate.password(body.password));
      if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) validate.fail(409, '此账号已存在。');
      const newId = randomUUID();
      db.prepare('INSERT INTO users (id, username, display_name, role, is_president, permissions, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId, username, displayName, role, Number(isPresident), JSON.stringify(permissions), hash);
      return json(res, 201, { user: userView(db.prepare('SELECT * FROM users WHERE id = ?').get(newId), true) });
    }
    const userMatch = route.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userMatch && ['PUT', 'DELETE'].includes(method)) {
      const userId = validate.id(userMatch[1]);
      let existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!existing) validate.fail(404, '账号不存在。');
      if (method === 'DELETE') {
        db.exec('BEGIN IMMEDIATE');
        try {
          existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
          if (!existing) validate.fail(404, '账号不存在。');
          protectLastManager(existing, existing.role, false, Boolean(existing.is_president));
          db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(userId);
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, { ok: true });
      }
      const body = validate.object(await readBody(req, 8192));
      requireManager(req);
      existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!existing) validate.fail(404, '账号不存在。');
      const displayName = validate.string(body.displayName ?? existing.display_name, '显示名称', { required: true, max: 100 });
      const role = body.role === undefined ? existing.role : validate.role(body.role);
      const permissions = validate.permissions(body.permissions === undefined ? [] : body.permissions, role);
      const isPresident = validate.isPresident(body.isPresident === undefined ? (role === 'admin' && Boolean(existing.is_president)) : body.isPresident, role);
      if (body.active !== undefined && typeof body.active !== 'boolean') validate.fail(400, '账号状态格式不正确。');
      const active = body.active === undefined ? existing.active : Number(body.active);
      const hash = body.password ? passwordHash(validate.password(body.password)) : existing.password_hash;
      db.exec('BEGIN IMMEDIATE');
      try {
        protectLastManager(existing, role, active, isPresident);
        db.prepare('UPDATE users SET display_name = ?, role = ?, is_president = ?, permissions = ?, active = ?, password_hash = ?, must_change_password = ? WHERE id = ?').run(displayName, role, Number(isPresident), JSON.stringify(permissions), active, hash, body.password ? 1 : existing.must_change_password, userId);
        if (!active || body.password || role !== existing.role) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { user: userView(db.prepare('SELECT * FROM users WHERE id = ?').get(userId), true) });
    }
    if (route === '/api/admin/upload' && method === 'POST') {
      requirePermission(actor, 'uploads:write');
      const body = validate.object(await readBody(req, 12 * 1024 * 1024));
      requirePermission(requireManager(req), 'uploads:write');
      validate.string(body.filename, '文件名', { required: true, max: 255 });
      if (typeof body.dataUrl !== 'string') validate.fail(400, '请选择 JPEG、PNG 或 WebP 图片。');
      const match = body.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) validate.fail(400, '仅支持 JPEG、PNG 或 WebP 图片，不支持 SVG。');
      const buffer = Buffer.from(match[2], 'base64');
      if (!buffer.length || buffer.length > maxImageBytes) validate.fail(413, '图片须小于或等于 8 MB。');
      let mime, extension;
      if (buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.toString('ascii', 12, 16) === 'IHDR') { mime = 'image/png'; extension = 'png'; }
      else if (buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 && buffer[buffer.length - 2] === 255 && buffer[buffer.length - 1] === 217) { mime = 'image/jpeg'; extension = 'jpg'; }
      else if (buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' && buffer.readUInt32LE(4) + 8 === buffer.length && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))) { mime = 'image/webp'; extension = 'webp'; }
      if (mime !== match[1]) validate.fail(400, '图片内容与文件类型不匹配，请使用有效图片。');
      const filename = `${randomUUID()}.${extension}`;
      writeFileSync(path.join(uploadDir, filename), buffer, { flag: 'wx', mode: 0o644 });
      return json(res, 201, { url: `/uploads/${filename}` });
    }
    validate.fail(404, '接口不存在。');
  }

  function sendFile(req, res, file, root) {
    if (!existsSync(file) || !statSync(file).isFile()) return false;
    const resolved = realpathSync(file), resolvedRoot = realpathSync(root);
    if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) return false;
    const extension = path.extname(file).toLowerCase();
    const shellAsset = ['.html', '.js', '.css', '.woff', '.woff2', '.ttf', '.otf', '.ico'].includes(extension)
      || /^favicon(?:-[^.]+)?\.(?:svg|png)$/i.test(path.basename(file));
    if (!shellAsset) requireSiteAccess(req);
    const type = types[extension] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': statSync(file).size, 'Cache-Control': shellAsset ? (file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600') : 'no-store' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
    return true;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      if (parsedUrl.pathname === '/api' || parsedUrl.pathname.startsWith('/api/')) return await api(req, res, parsedUrl);
      if (!['GET', 'HEAD'].includes(req.method)) validate.fail(405, '此资源仅支持读取。');
      const decodedPathname = decodeURIComponent(parsedUrl.pathname);
      if (decodedPathname.includes('\\') || decodedPathname.includes('\0')) validate.fail(400, '请求路径格式不正确。');
      const pathname = path.posix.normalize(decodedPathname);
      if (/^\/(?:uploads|images|docs)(?:\/|$)/i.test(pathname)) requireSiteAccess(req);
      if (pathname.startsWith('/uploads/')) {
        const filename = pathname.slice('/uploads/'.length);
        if (/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(filename) && sendFile(req, res, path.join(uploadDir, filename), uploadDir)) return;
        validate.fail(404, '图片不存在。');
      }
      if (!production && /^\/(?:images|docs)\//i.test(pathname)) {
        const publicFile = path.resolve(publicDir, `.${pathname}`);
        if (publicFile.startsWith(`${publicDir}${path.sep}`) && sendFile(req, res, publicFile, publicDir)) return;
      }
      const file = path.resolve(distDir, `.${pathname}`);
      if (file.startsWith(`${distDir}${path.sep}`) && sendFile(req, res, file, distDir)) return;
      if (/^\/(?:activities(?:\/[^/]+)?|projects\/[^/]+|about|team(?:\/[^/]+)?|cooperation|login|account|admin(?:\/.*)?)?\/?$/.test(pathname) && sendFile(req, res, path.join(distDir, 'index.html'), distDir)) return;
      validate.fail(404, '页面不存在。开发时请访问 http://127.0.0.1:5173；生产前请先构建网站。');
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (error instanceof validate.HttpError) json(res, error.status, { error: error.message, ...(error.code ? { code: error.code } : {}) });
      else if (error instanceof URIError) json(res, 400, { error: '请求路径格式不正确。' });
      else { console.error('后台请求失败：', error.message); json(res, 500, { error: '服务暂时无法处理请求，请稍后重试。' }); }
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  let closed = false;
  return {
    server, dataDir, uploadDir,
    async close() {
      if (closed) return;
      closed = true;
      if (server.listening) await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
      db.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3001), host = process.env.HOST ?? '127.0.0.1';
  app.server.listen(port, host, () => {
    console.log(`川衡网站服务已启动：http://${host}:${port}`);
    console.log(`首次管理员凭据保存在：${path.join(app.dataDir, 'initial-admin.txt')}（不会在日志中显示密码）`);
  });
  app.server.on('error', error => { console.error(`无法启动网站：${error.message}`); process.exitCode = 1; void app.close(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
}
