import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { User } from '../types';

interface AuthState {
  user: User | null; checking: boolean; error: string;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<User | null>;
  setUser: (user: User | null) => void;
}
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, updateUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true), [error, setError] = useState('');
  const requestVersion = useRef(0);
  const setUser = useCallback((next: User | null) => {
    requestVersion.current++; updateUser(next); setError(''); setChecking(false);
  }, []);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const result = await api<{ user: User | null }>('/auth/me');
      if (version === requestVersion.current) { updateUser(result.user); setError(''); }
      return result.user;
    } catch (failure) {
      if (version === requestVersion.current) { updateUser(null); setError((failure as Error).message); }
      return null;
    } finally { if (version === requestVersion.current) setChecking(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const expired = () => { void refresh(); };
    const focused = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('auth-expired', expired);
    window.addEventListener('focus', focused);
    window.addEventListener('auth-recheck', focused);
    return () => {
      requestVersion.current++;
      window.removeEventListener('auth-expired', expired);
      window.removeEventListener('focus', focused);
      window.removeEventListener('auth-recheck', focused);
    };
  }, [refresh, setUser]);
  const login = async (username: string, password: string) => {
    const result = await api<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    setUser(result.user); return result.user;
  };
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); };
  return <AuthContext.Provider value={{ user, checking, error, login, logout, refresh, setUser }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is unavailable');
  return value;
}
