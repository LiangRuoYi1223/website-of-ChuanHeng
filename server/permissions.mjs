// New management interfaces must be added explicitly here before they can be delegated.
export const roles = ['founder', 'admin', 'member', 'viewer'];
export const contentPermissions = ['settings:write', 'activities:write', 'projects:write', 'uploads:write'];

export function permissionsFor(user) {
  if (user.role === 'founder') return [...contentPermissions];
  if (user.role !== 'admin') return [];
  try {
    const stored = JSON.parse(user.permissions ?? '[]');
    return Array.isArray(stored) ? contentPermissions.filter(permission => stored.includes(permission)) : [];
  } catch { return []; }
}

export function canManage(user, permission) {
  return user.role === 'founder' || (user.role === 'admin' && permissionsFor(user).includes(permission));
}

export const canRegister = user => ['founder', 'admin', 'member'].includes(user.role);
