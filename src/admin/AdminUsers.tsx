import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import {
  roleLabels,
  roleDescriptions,
  userRoleLabel,
  userPermissionLabels,
} from '../auth/permissions';
import type { User } from '../types';

type ManagedUser = User & { active?: boolean };
type UserForm = {
  username: string;
  displayName: string;
  password: string;
  role: User['role'];
  isPresident: boolean;
  active: boolean;
};
const blank = (): UserForm => ({
  username: '',
  displayName: '',
  password: '',
  role: 'member',
  isPresident: false,
  active: true,
});
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试。';

export function AdminUsers({
  currentUser,
  onError,
  onUserSaved,
}: {
  currentUser: User;
  onError: (message: string) => void;
  onUserSaved?: (user: User) => void;
}) {
  const [users, setUsers] = useState<ManagedUser[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState<UserForm>(blank),
    [editingId, setEditingId] = useState<string | null>(null),
    [message, setMessage] = useState(''),
    [dirty, setDirty] = useState(false);
  const formHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let alive = true;
    api<{ users: ManagedUser[] }>('/admin/users')
      .then((result) => {
        if (alive) setUsers(result.users);
      })
      .catch((error) => {
        if (alive) onError(errorText(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [onError]);
  async function refresh() {
    const result = await api<{ users: ManagedUser[] }>('/admin/users');
    setUsers(result.users);
  }
  const editingSelf = editingId === currentUser.id;
  const update = <K extends keyof UserForm>(key: K, value: UserForm[K]) => {
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  };
  function mayDiscard() {
    return !dirty || confirm('有未保存的账号修改，是否放弃？');
  }
  function focusForm() {
    requestAnimationFrame(() => {
      formHeading.current?.scrollIntoView({ block: 'start' });
      formHeading.current?.focus({ preventScroll: true });
    });
  }
  function edit(user: ManagedUser, promote = false) {
    if (!mayDiscard()) return;
    setMessage('');
    setEditingId(user.id);
    setDirty(promote);
    setForm({
      username: user.username,
      displayName: user.displayName,
      password: '',
      role: promote ? 'admin' : user.role,
      isPresident: user.role === 'admin' && user.isPresident,
      active: user.active !== false,
    });
    focusForm();
  }
  function reset() {
    setEditingId(null);
    setForm(blank());
    setDirty(false);
  }
  function create(president = false) {
    if (!mayDiscard()) return;
    reset();
    setMessage('');
    if (president) setForm({ ...blank(), role: 'admin', isPresident: true });
    focusForm();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const identity = {
        displayName: form.displayName,
        role: form.role,
        isPresident: form.role === 'admin' && form.isPresident,
      };
      const body = editingId
        ? {
            ...identity,
            active: form.active,
            ...(form.password && !editingSelf ? { password: form.password } : {}),
          }
        : { ...identity, username: form.username, password: form.password };
      const result = await api<{ user: ManagedUser }>(
        editingId ? `/admin/users/${editingId}` : '/admin/users',
        { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(body) },
      );
      setUsers((current) =>
        editingId
          ? current.map((user) => (user.id === result.user.id ? result.user : user))
          : [...current, result.user],
      );
      setMessage(
        editingId
          ? '账号已更新。重置密码或变更身份后，该账号需要重新登录。'
          : '账号已创建。请私下交付初始密码，首次登录须修改密码。',
      );
      reset();
      onUserSaved?.(result.user);
      if (result.user.id !== currentUser.id) await refresh();
    } catch (error) {
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function deactivate(user: ManagedUser) {
    if (busy || user.id === currentUser.id) return;
    if (editingId === user.id && !mayDiscard()) return;
    setBusy(true);
    setMessage('');
    try {
      await api<{ ok: boolean }>(`/admin/users/${user.id}`, { method: 'DELETE' });
      await refresh();
      if (editingId === user.id) reset();
      setMessage(`${user.displayName}的账号已停用。需要时可编辑账号重新启用。`);
    } catch (error) {
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-panel">
      <div className="admin-toolbar">
        <div>
          <h2>全部账号与权限</h2>
          <p className="admin-help">
            社长与所有管理员均可查看全部账号及权限。选择社员的“设为管理员”，保存后即可授权。
          </p>
        </div>
        <div className="admin-actions">
          <button
            type="button"
            className="admin-button admin-secondary"
            disabled={busy}
            onClick={() => create(true)}
          >
            新建社长账号
          </button>
          <button
            type="button"
            className="admin-button admin-secondary"
            disabled={busy}
            onClick={() => create()}
          >
            新增账号
          </button>
        </div>
      </div>
      {message && (
        <p className="admin-alert admin-success" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">正在加载账号…</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table admin-user-table">
            <caption className="admin-help">
              全部 {users.length} 个账号，包含已停用账号；停用后无法使用所列权限。
            </caption>
            <thead>
              <tr>
                <th scope="col">账号</th>
                <th scope="col">显示名称</th>
                <th scope="col">身份</th>
                <th scope="col">权限</th>
                <th scope="col">状态</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td data-label="账号">
                    <span>
                      {user.username}
                      {user.id === currentUser.id && <small>（当前账号）</small>}
                    </span>
                  </td>
                  <td data-label="显示名称">{user.displayName}</td>
                  <td data-label="身份">
                    <strong>{userRoleLabel(user)}</strong>
                  </td>
                  <td data-label="权限">
                    <span className="admin-table-permissions">
                      {userPermissionLabels(user).join('、')}
                    </span>
                  </td>
                  <td data-label="状态">
                    {user.active === false
                      ? '已停用'
                      : user.mustChangePassword
                        ? '待修改密码'
                        : '正常'}
                  </td>
                  <td data-label="操作">
                    <div className="admin-actions">
                      {user.role === 'member' && user.active !== false && (
                        <button
                          type="button"
                          className="admin-button admin-secondary"
                          disabled={busy}
                          onClick={() => edit(user, true)}
                        >
                          设为管理员
                        </button>
                      )}
                      <button
                        type="button"
                        className="admin-button admin-secondary"
                        disabled={busy}
                        onClick={() => edit(user)}
                      >
                        编辑
                      </button>
                      {user.active !== false && (
                        <button
                          type="button"
                          className="admin-button admin-secondary"
                          disabled={busy || user.id === currentUser.id}
                          onClick={() => void deactivate(user)}
                        >
                          停用
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length && (
                <tr>
                  <td colSpan={6}>暂无可显示的账号。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <h3
        className="admin-user-form-heading"
        id="account-form-heading"
        ref={formHeading}
        tabIndex={-1}
      >
        {editingId
          ? `编辑账号：${form.username}`
          : form.isPresident
            ? '新建管理员 · 社长账号'
            : '新增账号'}
      </h3>
      {!editingId && form.isPresident && (
        <p className="admin-help">
          请填写社长的登录账号、显示名称与密码。首次登录修改初始密码后，可使用全部账号管理与网站服务功能。
        </p>
      )}
      {editingId &&
        form.role === 'admin' &&
        users.find((user) => user.id === editingId)?.role === 'member' && (
          <p className="admin-alert">
            保存后，此社员将获得全部内容与账号管理权限，需要重新登录。未填写重置密码时，保留原密码。
          </p>
        )}
      <form
        className="admin-form"
        aria-labelledby="account-form-heading"
        data-dirty={dirty}
        onSubmit={submit}
      >
        <fieldset disabled={busy} className="admin-form-fieldset">
          <div className="admin-grid">
            <label className="admin-field">
              登录账号
              <input
                value={form.username}
                readOnly={Boolean(editingId)}
                required
                minLength={3}
                maxLength={40}
                pattern="[a-zA-Z0-9_.\-]{3,40}"
                autoComplete="off"
                onChange={(event) => update('username', event.target.value)}
              />
              <span className="admin-help">
                3–40 位字母、数字、点、横线或下划线；创建后不能修改。
              </span>
            </label>
            <label className="admin-field">
              显示名称
              <input
                value={form.displayName}
                required
                maxLength={100}
                onChange={(event) => update('displayName', event.target.value)}
              />
            </label>
            <label className="admin-field">
              身份
              <select
                value={form.role}
                disabled={editingSelf}
                onChange={(event) => {
                  const role = event.target.value as User['role'];
                  setDirty(true);
                  setForm((current) => ({
                    ...current,
                    role,
                    isPresident: role === 'admin' && current.isPresident,
                  }));
                }}
              >
                {(['admin', 'member', 'viewer'] as const).map((role) => (
                  <option value={role} key={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
              <span className="admin-help">
                {roleDescriptions[form.role]}
                {editingSelf && ' 当前账号的身份请由另一位管理员调整。'}
              </span>
            </label>
            <label className="admin-field">
              {editingId ? '重置密码（留空则保持原密码）' : '初始密码'}
              <input
                type="password"
                value={form.password}
                disabled={editingSelf}
                required={!editingId}
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                onChange={(event) => update('password', event.target.value)}
              />
              <span className="admin-help">
                12–128 个字符；创建或重置后须首次登录改密。
                {editingSelf && ' 当前账号请使用个人密码入口。'}
              </span>
            </label>
            {form.role === 'admin' && (
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={form.isPresident}
                  onChange={(event) => update('isPresident', event.target.checked)}
                />
                <span>
                  设为社长
                  <small className="admin-registration-help">
                    保留管理员全部功能，另可验证自身密码后关停或重启网站。
                  </small>
                </span>
              </label>
            )}
            {editingId && (
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={form.active}
                  disabled={editingSelf}
                  onChange={(event) => update('active', event.target.checked)}
                />
                启用账号{editingSelf && <span className="admin-help">不能停用当前账号。</span>}
              </label>
            )}
          </div>
        </fieldset>
        <div className="admin-actions">
          <button className="admin-button admin-primary" type="submit" disabled={busy || loading}>
            {busy ? '保存中…' : editingId ? '保存账号修改' : '创建账号'}
          </button>
          {editingId && (
            <button
              type="button"
              className="admin-button admin-secondary"
              disabled={busy}
              onClick={() => {
                if (mayDiscard()) reset();
              }}
            >
              取消编辑
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
