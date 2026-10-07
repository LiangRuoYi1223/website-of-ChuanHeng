import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { roleLabels, roleDescriptions, userRoleLabel } from '../auth/permissions';
import type { User } from '../types';

type ManagedUser = User & { active?: boolean };
type UserForm = { username: string; displayName: string; password: string; role: User['role']; isPresident: boolean; active: boolean };
const blank = (): UserForm => ({ username: '', displayName: '', password: '', role: 'member', isPresident: false, active: true });
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';

export function AdminUsers({ currentUser, onError, onUserSaved }: { currentUser: User; onError: (message: string) => void; onUserSaved?: (user: User) => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [form, setForm] = useState<UserForm>(blank), [editingId, setEditingId] = useState<string | null>(null), [message, setMessage] = useState(''), [dirty, setDirty] = useState(false);
  useEffect(() => {
    let alive = true;
    api<{ users: ManagedUser[] }>('/admin/users').then(result => { if (alive) setUsers(result.users); }).catch(error => { if (alive) onError(errorText(error)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [onError]);
  async function refresh() { const result = await api<{ users: ManagedUser[] }>('/admin/users'); setUsers(result.users); }
  const editingSelf = editingId === currentUser.id;
  const update = <K extends keyof UserForm>(key: K, value: UserForm[K]) => { setDirty(true); setForm(current => ({ ...current, [key]: value })); };
  function mayDiscard() { return !dirty || confirm('有未保存的账号修改，是否放弃？'); }
  function edit(user: ManagedUser) {
    if (!mayDiscard()) return;
    setMessage(''); setEditingId(user.id); setDirty(false);
    setForm({ username: user.username, displayName: user.displayName, password: '', role: user.role, isPresident: user.role === 'admin' && user.isPresident, active: user.active !== false });
  }
  function reset() { setEditingId(null); setForm(blank()); setDirty(false); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage('');
    try {
      const identity = { displayName: form.displayName, role: form.role, isPresident: form.role === 'admin' && form.isPresident };
      const body = editingId ? { ...identity, active: form.active, ...(form.password && !editingSelf ? { password: form.password } : {}) } : { ...identity, username: form.username, password: form.password };
      const result = await api<{ user: ManagedUser }>(editingId ? `/admin/users/${editingId}` : '/admin/users', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(body) });
      setUsers(current => editingId ? current.map(user => user.id === result.user.id ? result.user : user) : [...current, result.user]);
      setMessage(editingId ? '账号已更新。重置密码或变更身份后，该账号需要重新登录。' : '账号已创建。请私下交付初始密码，首次登录须修改密码。');
      reset(); onUserSaved?.(result.user);
      if (result.user.id !== currentUser.id) await refresh();
    } catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function deactivate(user: ManagedUser) {
    if (busy || user.id === currentUser.id) return;
    if (editingId === user.id && !mayDiscard()) return;
    setBusy(true); setMessage('');
    try {
      await api<{ ok: boolean }>(`/admin/users/${user.id}`, { method: 'DELETE' });
      await refresh(); if (editingId === user.id) reset(); setMessage(`${user.displayName}的账号已停用。需要时可编辑账号重新启用。`);
    } catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <section className="admin-panel">
    <div className="admin-toolbar"><div><h2>账号与权限</h2><p className="admin-help">管理员可管理全部账号。社长属于管理员，另有网站关停与重启权限。</p></div><button type="button" className="admin-button admin-secondary" disabled={busy} onClick={() => { if (!mayDiscard()) return; reset(); setMessage(''); }}>新增账号</button></div>
    {message && <p className="admin-alert admin-success" role="status">{message}</p>}
    {loading ? <p role="status">正在加载账号…</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">账号</th><th scope="col">显示名称</th><th scope="col">身份</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody>
      {users.map(user => <tr key={user.id}><td>{user.username}{user.id === currentUser.id && <small>（当前账号）</small>}</td><td>{user.displayName}</td><td><strong>{userRoleLabel(user)}</strong><small className="admin-table-permissions">{user.role === 'admin' ? user.isPresident ? '全站管理，可关停与重启网站' : '全站内容与账号管理' : roleDescriptions[user.role]}</small></td><td>{user.active === false ? '已停用' : user.mustChangePassword ? '待修改密码' : '正常'}</td><td><div className="admin-actions"><button type="button" className="admin-button admin-secondary" disabled={busy} onClick={() => edit(user)}>编辑</button>{user.active !== false && <button type="button" className="admin-button admin-secondary" disabled={busy || user.id === currentUser.id} onClick={() => void deactivate(user)}>停用</button>}</div></td></tr>)}
      {!users.length && <tr><td colSpan={5}>暂无可显示的账号。</td></tr>}
    </tbody></table></div>}
    <h3 className="admin-user-form-heading">{editingId ? `编辑账号：${form.username}` : '新增账号'}</h3>
    <form className="admin-form" data-dirty={dirty} onSubmit={submit}>
      <fieldset disabled={busy} className="admin-form-fieldset"><div className="admin-grid">
        <label className="admin-field">登录账号<input value={form.username} readOnly={Boolean(editingId)} required minLength={3} maxLength={40} pattern="[a-zA-Z0-9_.\-]{3,40}" autoComplete="off" onChange={event => update('username', event.target.value)} /><span className="admin-help">3–40 位字母、数字、点、横线或下划线；创建后不能修改。</span></label>
        <label className="admin-field">显示名称<input value={form.displayName} required maxLength={100} onChange={event => update('displayName', event.target.value)} /></label>
        <label className="admin-field">身份<select value={form.role} disabled={editingSelf} onChange={event => { const role = event.target.value as User['role']; setDirty(true); setForm(current => ({ ...current, role, isPresident: role === 'admin' && current.isPresident })); }}>{(['admin', 'member', 'viewer'] as const).map(role => <option value={role} key={role}>{roleLabels[role]}</option>)}</select><span className="admin-help">{roleDescriptions[form.role]}{editingSelf && ' 当前账号的身份请由另一位管理员调整。'}</span></label>
        <label className="admin-field">{editingId ? '重置密码（留空则保持原密码）' : '初始密码'}<input type="password" value={form.password} disabled={editingSelf} required={!editingId} minLength={12} maxLength={128} autoComplete="new-password" onChange={event => update('password', event.target.value)} /><span className="admin-help">12–128 个字符；创建或重置后须首次登录改密。{editingSelf && ' 当前账号请使用个人密码入口。'}</span></label>
        {form.role === 'admin' && <label className="admin-check"><input type="checkbox" checked={form.isPresident} onChange={event => update('isPresident', event.target.checked)} /><span>设为社长<small className="admin-registration-help">保留管理员全部功能，另可验证自身密码后关停或重启网站。</small></span></label>}
        {editingId && <label className="admin-check"><input type="checkbox" checked={form.active} disabled={editingSelf} onChange={event => update('active', event.target.checked)} />启用账号{editingSelf && <span className="admin-help">不能停用当前账号。</span>}</label>}
      </div></fieldset>
      <div className="admin-actions"><button className="admin-button admin-primary" type="submit" disabled={busy || loading}>{busy ? '保存中…' : editingId ? '保存账号修改' : '创建账号'}</button>{editingId && <button type="button" className="admin-button admin-secondary" disabled={busy} onClick={() => { if (mayDiscard()) reset(); }}>取消编辑</button>}</div>
    </form>
  </section>;
}
