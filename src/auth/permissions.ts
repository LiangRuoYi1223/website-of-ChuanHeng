import type { ContentPermission, User, UserRole } from '../types';

export const roleLabels: Record<UserRole, string> = {
  founder: '创始者', admin: '管理员', member: '社员', viewer: '浏览者',
};
export const roleDescriptions: Record<UserRole, string> = {
  founder: '可修改网站全部内容，并管理账号与接口授权。',
  admin: '可修改创始者已授权接口内的内容。',
  member: '可浏览网站并报名参加开放的活动。',
  viewer: '可浏览网站公开内容。',
};
export const permissionLabels: Record<ContentPermission, string> = {
  'settings:write': '协会设置', 'activities:write': '活动管理',
  'projects:write': '攀登项目', 'uploads:write': '图片上传',
};
export function canManageContent(user: User | null): boolean {
  return user?.role === 'founder' || user?.role === 'admin';
}
export function canViewMemberActivities(user: User | null): boolean {
  return !!user && ['founder', 'admin', 'member'].includes(user.role);
}
export function hasPermission(user: User | null, permission: string): boolean {
  return user?.role === 'founder' || (user?.role === 'admin' && user.permissions.includes(permission));
}
export function canRegister(user: User | null): boolean {
  return canViewMemberActivities(user) && !user?.mustChangePassword;
}
