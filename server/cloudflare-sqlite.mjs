// Local development uses Node's SQLite. Workers always inject PostgreSQL.
export class DatabaseSync {
  constructor() {
    throw new Error('Cloudflare 必须使用 Supabase 数据库。');
  }
}
