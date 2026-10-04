import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, realpathSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialSettings, initialActivities, initialProjects, initialCooperation, legacyActivityIds, legacyAboutDescription } from './seed.mjs';
import * as validate from './validation.mjs';
import { permissionsFor, canManage, canRegister } from './permissions.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cookieName = 'chuanheng_session';
const sessionDuration = 24 * 60 * 60 * 1000;
const maxImageBytes = 8 * 1024 * 1024;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };

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
  return { id: user.id, username: user.username, displayName: user.display_name, role: user.role, permissions: permissionsFor(user), mustChangePassword: Boolean(user.must_change_password), ...(includeActive ? { active: Boolean(user.active) } : {}) };
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
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('founder','admin','member','viewer')), permissions TEXT NOT NULL DEFAULT '[]', password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS registrations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE, created_at TEXT NOT NULL, UNIQUE(user_id, activity_id));
  `);
  const legacyUsers = !db.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get().sql.includes("'founder'");
  if (legacyUsers) {
    try {
    // Preserve identities and password hashes; previous account administrators become founders.
    // Previous editors receive no delegated write access until a founder grants it.
    db.exec(`PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;
      CREATE TABLE users_v2 (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('founder','admin','member','viewer')), permissions TEXT NOT NULL DEFAULT '[]', password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 1);
      INSERT INTO users_v2 (id, username, display_name, role, password_hash, active, must_change_password)
        SELECT id, username, display_name, CASE role WHEN 'admin' THEN 'founder' ELSE 'admin' END, password_hash, active, must_change_password FROM users;
      DROP TABLE users;
      ALTER TABLE users_v2 RENAME TO users;`);
    // Upgrade the previous design seed once, retaining edited values and deleted activities.
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
    db.prepare('INSERT INTO users (id, username, display_name, role, password_hash) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), 'admin', '协会创始者', 'founder', passwordHash(password));
    writeFileSync(path.join(dataDir, 'initial-admin.txt'), `川衡网站初始创始者\n账号：admin\n密码：${password}\n首次登录请修改密码。本文件包含敏感信息，请妥善保管，修改后删除。\n`, { mode: 0o600, flag: 'w' });
  }
  const dummyPasswordHash = passwordHash(randomBytes(24).toString('hex'));
  const loginAttempts = new Map();
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
    if (!canManage(user, permission)) validate.fail(403, '此接口尚未向你的账号开放，请联系创始者分配权限。');
  }
  function requireChangedPassword(user) {
    if (user.must_change_password) throw new validate.HttpError(403, '首次登录或密码重置后，请先修改密码再继续操作。', 'PASSWORD_CHANGE_REQUIRED');
  }
  function requireManager(req, founderOnly = false) {
    const actor = requireUser(req);
    if (!['founder', 'admin'].includes(actor.role)) validate.fail(403, '你的账号没有内容管理权限。');
    if (founderOnly && actor.role !== 'founder') validate.fail(403, '账号与接口权限仅由创始者管理。');
    if (!['GET', 'HEAD'].includes(req.method)) requireChangedPassword(actor);
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
  function protectLastFounder(existing, nextRole, nextActive) {
    if (existing.role === 'founder' && existing.active && (nextRole !== 'founder' || !nextActive) && db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'founder' AND active = 1").get().count <= 1) validate.fail(400, '不能停用或降级最后一位有效创始者。');
  }
  function checkLoginLimit(req, username) {
    const now = Date.now(), ip = req.socket.remoteAddress ?? 'unknown';
    for (const [key, item] of loginAttempts) if (item.until < now) loginAttempts.delete(key);
    const keys = [{ key: `ip:${ip}`, maximum: 30 }, { key: `user:${ip}:${username}`, maximum: 5 }];
    for (const { key, maximum } of keys) {
      const item = loginAttempts.get(key);
      if (item && item.count >= maximum) validate.fail(429, '登录尝试过于频繁，请 15 分钟后再试。');
    }
    return {
      fail() { for (const { key } of keys) { const item = loginAttempts.get(key) ?? { count: 0, until: now + 15 * 60 * 1000 }; item.count++; loginAttempts.set(key, item); } },
      success() { loginAttempts.delete(keys[1].key); },
    };
  }

  async function api(req, res, parsedUrl) {
    const route = parsedUrl.pathname, method = req.method;
    if (!['GET', 'HEAD'].includes(method)) sameOrigin(req);
    if (route === '/api/content' && method === 'GET') return json(res, 200, content());
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
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
      const token = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash(token), user.id, Date.now() + sessionDuration);
      return json(res, 200, { user: userView(user) }, { 'Set-Cookie': cookie(token) });
    }
    if (route === '/api/auth/logout' && method === 'POST') {
      const user = authenticate(req); if (user) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(user.token_hash);
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', true) });
    }
    if (route === '/api/auth/password' && method === 'POST') {
      const user = requireUser(req), body = validate.object(await readBody(req, 4096));
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
    const actor = requireManager(req, route.startsWith('/api/admin/users'));
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
      requireManager(req, true);
      const username = validate.username(body.username), displayName = validate.string(body.displayName, '显示名称', { required: true, max: 100 }), role = validate.role(body.role);
      const permissions = validate.permissions(body.permissions, role);
      const hash = passwordHash(validate.password(body.password));
      if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) validate.fail(409, '此账号已存在。');
      const newId = randomUUID();
      db.prepare('INSERT INTO users (id, username, display_name, role, permissions, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(newId, username, displayName, role, JSON.stringify(permissions), hash);
      return json(res, 201, { user: userView(db.prepare('SELECT * FROM users WHERE id = ?').get(newId), true) });
    }
    const userMatch = route.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userMatch && ['PUT', 'DELETE'].includes(method)) {
      const userId = validate.id(userMatch[1]), existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!existing) validate.fail(404, '账号不存在。');
      if (method === 'DELETE') {
        protectLastFounder(existing, existing.role, false);
        db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(userId);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
        return json(res, 200, { ok: true });
      }
      const body = validate.object(await readBody(req, 8192));
      requireManager(req, true);
      const displayName = validate.string(body.displayName ?? existing.display_name, '显示名称', { required: true, max: 100 });
      const role = body.role === undefined ? existing.role : validate.role(body.role);
      const permissions = validate.permissions(body.permissions ?? (role === 'admin' && existing.role === 'admin' ? permissionsFor(existing) : []), role);
      if (body.active !== undefined && typeof body.active !== 'boolean') validate.fail(400, '账号状态格式不正确。');
      const active = body.active === undefined ? existing.active : Number(body.active);
      const hash = body.password ? passwordHash(validate.password(body.password)) : existing.password_hash;
      protectLastFounder(existing, role, active);
      db.prepare('UPDATE users SET display_name = ?, role = ?, permissions = ?, active = ?, password_hash = ?, must_change_password = ? WHERE id = ?').run(displayName, role, JSON.stringify(permissions), active, hash, body.password ? 1 : existing.must_change_password, userId);
      const permissionsChanged = existing.role === 'admin' && role === 'admin' && JSON.stringify(permissionsFor(existing)) !== JSON.stringify(permissions);
      if (!active || body.password || role !== existing.role || permissionsChanged) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
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
    const type = types[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': statSync(file).size, 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
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
      const pathname = decodeURIComponent(parsedUrl.pathname);
      if (pathname.startsWith('/uploads/')) {
        const filename = pathname.slice('/uploads/'.length);
        if (/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(filename) && sendFile(req, res, path.join(uploadDir, filename), uploadDir)) return;
        validate.fail(404, '图片不存在。');
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
