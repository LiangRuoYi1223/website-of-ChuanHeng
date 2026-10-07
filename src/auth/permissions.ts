import type { ContentPermission, User, UserRole } from '../types';

export const roleLabels: Record<UserRole, string> = {
  admin: '管理员', member: '社员', viewer: '浏览者',
};
export const roleDescriptions: Record<UserRole, string> = {
  admin: '可修改网站全部内容，并管理账号。社长属于管理员，另可暂停和恢复网站服务。',
  member: '可浏览网站并报名参加开放的活动。',
  viewer: '可浏览网站公开内容。',
};
export const permissionLabels: Record<ContentPermission, string> = {
  'settings:write': '协会设置', 'activities:write': '活动管理',
  'projects:write': '攀登项目', 'uploads:write': '图片上传',
};
export function canManageContent(user: User | null): boolean {
  return user?.role === 'admin';
}
export function canViewMemberActivities(user: User | null): boolean {
  return !!user && ['admin', 'member'].includes(user.role);
}
export function hasPermission(user: User | null, permission: string): boolean {
  return user?.role === 'admin' && Object.hasOwn(permissionLabels, permission);
}
export function canRegister(user: User | null): boolean {
  return canViewMemberActivities(user) && !user?.mustChangePassword;
}

export function userRoleLabel(user: User): string {
  return user.role === 'admin' && user.isPresident ? '管理员 · 社长' : roleLabels[user.role];
}
