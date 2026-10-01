import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { User } from '../types';

type ManagedUser = User & { active?: boolean };
type UserForm = { username: string; displayName: string; password: string; role: User['role']; active: boolean };
const blank = (): UserForm => ({ username: '', displayName: '', password: '', role: 'editor', active: true });
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';

export function AdminUsers({ currentUser, onError }: { currentUser: User; onError: (message: string) => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [form, setForm] = useState<UserForm>(blank), [editingId, setEditingId] = useState<string | null>(null), [message, setMessage] = useState(''), [dirty, setDirty] = useState(false);
  useEffect(() => {
    let alive = true;
    api<{ users: ManagedUser[] }>('/admin/users').then(result => { if (alive) setUsers(result.users); }).catch(error => { if (alive) onError(errorText(error)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [onError]);
  async function refresh() {
    const result = await api<{ users: ManagedUser[] }>('/admin/users'); setUsers(result.users);
  }
  const editingSelf = editingId === currentUser.id;
  const update = <K extends keyof UserForm>(key: K, value: UserForm[K]) => { setDirty(true); setForm(current => ({ ...current, [key]: value })); };
  function edit(user: ManagedUser) {
    setMessage(''); setEditingId(user.id); setDirty(false);
    setForm({ username: user.username, displayName: user.displayName, password: '', role: user.role, active: user.active !== false });
  }
  function reset() { setEditingId(null); setForm(blank()); setDirty(false); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage('');
    try {
      const body = editingId ? { displayName: form.displayName, role: form.role, active: form.active, ...(form.password && !editingSelf ? { password: form.password } : {}) } : { username: form.username, displayName: form.displayName, password: form.password, role: form.role };
      await api<{ user: ManagedUser }>(editingId ? `/admin/users/${editingId}` : '/admin/users', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(body) });
      await refresh(); setMessage(editingId ? '账号已更新。重置密码或更改权限后，该账号需要重新登录。' : '维护账号已创建。请私下将初始密码交给该同学，首次登录须修改密码。'); reset();
    } catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function deactivate(user: ManagedUser) {
    if (busy || user.id === currentUser.id) return;
    setBusy(true); setMessage('');
    try {
      await api<{ ok: boolean }>(`/admin/users/${user.id}`, { method: 'DELETE' });
      await refresh(); if (editingId === user.id) reset(); setMessage(`${user.displayName}的账号已停用，现有登录已失效。需要时可编辑账号重新启用。`);
    } catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <section className="admin-panel">
    <div className="admin-toolbar"><div><h2>维护账号</h2><p className="admin-help">管理员管理账号；维护者可以编辑与发布网站内容。停用账号保留记录，并立即撤销登录。</p></div><button type="button" className="admin-button admin-secondary" disabled={busy} onClick={() => { reset(); setMessage(''); }}>新增维护账号</button></div>
    {message && <p className="admin-alert" role="status">{message}</p>}
    {loading ? <p role="status">正在加载账号…</p> : <div style={{ overflowX: 'auto' }}><table className="admin-table"><thead><tr><th scope="col">账号</th><th scope="col">显示名称</th><th scope="col">权限</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody>
      {users.map(user => <tr key={user.id}><td>{user.username}{user.id === currentUser.id && <small>（当前账号）</small>}</td><td>{user.displayName}</td><td>{user.role === 'admin' ? '管理员' : '维护者'}</td><td>{user.active === false ? '已停用' : user.mustChangePassword ? '待修改密码' : '正常'}</td><td><div className="admin-toolbar"><button type="button" className="admin-button admin-secondary" disabled={busy} onClick={() => edit(user)}>编辑</button>{user.active !== false && <button type="button" className="admin-button admin-secondary" disabled={busy || user.id === currentUser.id} onClick={() => void deactivate(user)}>停用</button>}</div></td></tr>)}
      {!users.length && <tr><td colSpan={5}>暂无可显示的维护账号。</td></tr>}
    </tbody></table></div>}
    <h3>{editingId ? `编辑账号：${form.username}` : '新增维护账号'}</h3>
    <form className="admin-form" data-dirty={dirty} onSubmit={submit}>
      <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0 }}><div className="admin-grid">
        <label className="admin-field">登录账号<input value={form.username} readOnly={Boolean(editingId)} required minLength={3} maxLength={40} pattern="[a-zA-Z0-9_.\-]{3,40}" autoComplete="off" onChange={event => update('username', event.target.value)} /><span className="admin-help">3–40 位英文字母、数字、点、横线或下划线；创建后不能修改。</span></label>
        <label className="admin-field">显示名称<input value={form.displayName} required maxLength={100} onChange={event => update('displayName', event.target.value)} /></label>
        <label className="admin-field">权限<select value={form.role} disabled={editingSelf} onChange={event => update('role', event.target.value as User['role'])}><option value="editor">维护者：编辑与发布内容</option><option value="admin">管理员：同时管理维护账号</option></select>{editingSelf && <span className="admin-help">请由其他管理员调整当前账号权限。</span>}</label>
        <label className="admin-field">{editingId ? '重置密码（留空则保持原密码）' : '初始密码'}<input type="password" value={form.password} disabled={editingSelf} required={!editingId} minLength={12} maxLength={128} autoComplete="new-password" onChange={event => update('password', event.target.value)} /><span className="admin-help">12–128 个字符，由管理员自行设置；不会显示或自动填入公开密码。{editingSelf ? '当前账号请使用后台的修改密码入口。' : '创建或重置后，账号须在首次登录时改密。'}</span></label>
        {editingId && <label className="admin-field" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}><input type="checkbox" checked={form.active} disabled={editingSelf} style={{ width: 'auto' }} onChange={event => update('active', event.target.checked)} />启用账号{editingSelf && <span className="admin-help">不能停用当前账号。</span>}</label>}
      </div></fieldset>
      <div className="admin-toolbar"><button className="admin-button admin-primary" type="submit" disabled={busy || loading}>{busy ? '保存中…' : editingId ? '保存账号修改' : '创建账号'}</button>{editingId && <button type="button" className="admin-button admin-secondary" disabled={busy} onClick={reset}>取消编辑</button>}</div>
    </form>
  </section>;
}
