import { roleDescriptions, roleLabels } from './permissions';
import type { UserRole } from '../types';

export default function RoleOverview({ currentRole }: { currentRole?: UserRole }) {
  return <section className="role-overview" aria-labelledby="role-overview-title">
    <h2 id="role-overview-title">每种身份，各有权限。</h2>
    <p>账号由创始者分配，登录后自动匹配对应权限。</p>
    <dl>{(['founder', 'admin', 'member', 'viewer'] as UserRole[]).map(role => <div key={role} data-current={role === currentRole}>
      <dt>{roleLabels[role]}{role === currentRole && <span>当前身份</span>}</dt><dd>{roleDescriptions[role]}</dd>
    </div>)}</dl>
    <p className="role-footnote">未登录时，以浏览者身份查看公开页面。</p>
  </section>;
}
