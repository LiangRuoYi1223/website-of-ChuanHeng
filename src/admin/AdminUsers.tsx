import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { roleLabels, roleDescriptions } from '../auth/permissions';
import type { User } from '../types';

type ManagedUser = User & { active?: boolean };
type UserForm = { username: string; displayName: string; password: string; role: User['role']; permissions: string[]; active: boolean };
const blank = (): UserForm => ({ username: '', displayName: '', password: '', role: 'member', permissions: [], active: true });
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
const permissions = [
  { value: 'activities:write', label: '活动管理', description: '新建、编辑、发布与删除活动。' },
  { value: 'projects:write', label: '攀登项目', description: '维护攀登计划与项目内容。' },
  { value: 'settings:write', label: '协会设置', description: '修改网站介绍、素材地址及联系方式。' },
  { value: 'uploads:write', label: '图片上传', description: '在已获授权的内容接口中上传图片。' },
] as const;

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
    setForm({ username: user.username, displayName: user.displayName, password: '', role: user.role, permissions: [...user.permissions], active: user.active !== false });
  }
  function reset() { setEditingId(null); setForm(blank()); setDirty(false); }
  function togglePermission(permission: string, checked: boolean) { update('permissions', checked ? [...form.permissions, permission] : form.permissions.filter(value => value !== permission)); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage('');
    try {
      const grants = form.role === 'admin' ? form.permissions : [];
      const body = editingId ? { displayName: form.displayName, role: form.role, permissions: grants, active: form.active, ...(form.password && !editingSelf ? { password: form.password } : {}) } : { username: form.username, displayName: form.displayName, password: form.password, role: form.role, permissions: grants };
      const result = await api<{ user: ManagedUser }>(editingId ? `/admin/users/${editingId}` : '/admin/users', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(body) });
      onUserSaved?.(result.user);
      await refresh(); setMessage(editingId ? '账号已更新。重置密码或更改权限后，该账号需要重新登录。' : '账号已创建。请私下将初始密码交给使用者，首次登录须修改密码。'); reset();
    } catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function deactivate(user: ManagedUser) {
    if (busy || user.id === currentUser.id) return;
    if (editingId === user.id && !mayDiscard()) return;
    setBusy(true); setMessage('');
    try {
      await api<{ ok: boolean }>(`/admin/users/${user.id}`, { method: 'DELETE' });
      await refresh(); if (editingId === user.id) reset(); setMessage(`${user.displayName}的账号已停用，现有登录已失效。需要时可编辑账号重新启用。`);
    } catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <section className="admin-panel">
    <div className="admin-toolbar"><div><h2>账号与权限</h2><p className="admin-help">创始者分配四级身份，并逐项开放管理员接口。停用账号保留记录，立即撤销登录。</p></div><button type="button" className="admin-button admin-secondary" disabled={busy} onClick={() => { if (!mayDiscard()) return; reset(); setMessage(''); }}>新增账号</button></div>
    {message && <p className="admin-alert admin-success" role="status">{message}</p>}
    {loading ? <p role="status">正在加载账号…</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">账号</th><th scope="col">显示名称</th><th scope="col">身份与权限</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody>
      {users.map(user => <tr key={user.id}><td>{user.username}{user.id === currentUser.id && <small>（当前账号）</small>}</td><td>{user.displayName}</td><td><strong>{roleLabels[user.role]}</strong><small className="admin-table-permissions">{user.role === 'admin' ? permissions.filter(permission => user.permissions.includes(permission.value)).map(permission => permission.label).join('、') || '尚未授权内容接口' : roleDescriptions[user.role]}</small></td><td>{user.active === false ? '已停用' : user.mustChangePassword ? '待修改密码' : '正常'}</td><td><div className="admin-actions"><button type="button" className="admin-button admin-secondary" disabled={busy} onClick={() => edit(user)}>编辑</button>{user.active !== false && <button type="button" className="admin-button admin-secondary" disabled={busy || user.id === currentUser.id} onClick={() => void deactivate(user)}>停用</button>}</div></td></tr>)}
      {!users.length && <tr><td colSpan={5}>暂无可显示的账号。</td></tr>}
    </tbody></table></div>}
    <h3 className="admin-user-form-heading">{editingId ? `编辑账号：${form.username}` : '新增账号'}</h3>
    <form className="admin-form" data-dirty={dirty} onSubmit={submit}>
      <fieldset disabled={busy} className="admin-form-fieldset"><div className="admin-grid">
        <label className="admin-field">登录账号<input value={form.username} readOnly={Boolean(editingId)} required minLength={3} maxLength={40} pattern="[a-zA-Z0-9_.\-]{3,40}" autoComplete="off" onChange={event => update('username', event.target.value)} /><span className="admin-help">3–40 位英文字母、数字、点、横线或下划线；创建后不能修改。</span></label>
        <label className="admin-field">显示名称<input value={form.displayName} required maxLength={100} onChange={event => update('displayName', event.target.value)} /></label>
        <label className="admin-field">身份<select value={form.role} disabled={editingSelf} onChange={event => { setDirty(true); setForm(current => ({ ...current, role: event.target.value as User['role'], permissions: [] })); }}><option value="founder">创始者</option><option value="admin">管理员</option><option value="member">社员</option><option value="viewer">浏览者</option></select><span className="admin-help">{roleDescriptions[form.role]}{form.role === 'admin' && ' 默认不开放任何内容修改权限。'}{editingSelf && ' 当前账号的身份请由另一位创始者调整。'}</span></label>
        <label className="admin-field">{editingId ? '重置密码（留空则保持原密码）' : '初始密码'}<input type="password" value={form.password} disabled={editingSelf} required={!editingId} minLength={12} maxLength={128} autoComplete="new-password" onChange={event => update('password', event.target.value)} /><span className="admin-help">12–128 个字符；创建或重置后须首次登录改密。{editingSelf && ' 当前账号请使用个人密码入口。'}</span></label>
        {editingId && <label className="admin-check"><input type="checkbox" checked={form.active} disabled={editingSelf} onChange={event => update('active', event.target.checked)} />启用账号{editingSelf && <span className="admin-help">不能停用当前账号。</span>}</label>}
      </div>
      {form.role === 'admin' && <fieldset className="admin-permission-fieldset"><legend>开放给管理员的接口</legend><p className="admin-help">只开放勾选的功能。图片上传权限需配合内容编辑接口使用。</p><div className="admin-permission-options">{permissions.map(permission => <label className="admin-permission-option" key={permission.value}><input type="checkbox" checked={form.permissions.includes(permission.value)} onChange={event => togglePermission(permission.value, event.target.checked)} /><span><strong>{permission.label}</strong><small>{permission.description}</small></span></label>)}</div></fieldset>}
      </fieldset>
      <div className="admin-actions"><button className="admin-button admin-primary" type="submit" disabled={busy || loading}>{busy ? '保存中…' : editingId ? '保存账号修改' : '创建账号'}</button>{editingId && <button type="button" className="admin-button admin-secondary" disabled={busy} onClick={() => { if (mayDiscard()) reset(); }}>取消编辑</button>}</div>
    </form>
  </section>;
}
