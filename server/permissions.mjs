export const roles = ['admin', 'member', 'viewer'];
export const contentPermissions = ['settings:write', 'activities:write', 'projects:write', 'uploads:write'];

export function permissionsFor(user) {
  return user.role === 'admin' ? [...contentPermissions] : [];
}

export function canManage(user, permission) {
  return user.role === 'admin' && contentPermissions.includes(permission);
}

export const canRegister = user => ['admin', 'member'].includes(user.role);
