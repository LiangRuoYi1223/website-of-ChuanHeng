import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useAuth } from './AuthContext';
import type { SiteStatus } from '../types';

interface SiteStatusState {
  status: SiteStatus | null; checking: boolean; error: string;
  refresh: () => Promise<SiteStatus | null>;
  setStatus: (status: SiteStatus) => void;
}
const SiteStatusContext = createContext<SiteStatusState | null>(null);

export function SiteStatusProvider({children}:{children:ReactNode}) {
  const { refresh: refreshAuth } = useAuth();
  const [status, updateStatus] = useState<SiteStatus | null>(null);
  const [checking, setChecking] = useState(true), [error, setError] = useState('');
  const version = useRef(0);
  const inFlight = useRef<Promise<SiteStatus | null> | null>(null);
  const setStatus = useCallback((next:SiteStatus) => {
    version.current++; inFlight.current = null;
    updateStatus(next); setError(''); setChecking(false);
  }, []);
  const refresh = useCallback(():Promise<SiteStatus | null> => {
    if (inFlight.current) return inFlight.current;
    const requestVersion = ++version.current;
    const request = api<SiteStatus>('/site-status').then(next => {
      if (requestVersion === version.current) {
        updateStatus(next); setError('');
        if (next.paused) void refreshAuth();
      }
      return next;
    }).catch(failure => {
      if (requestVersion === version.current) setError((failure as Error).message);
      return null;
    }).finally(() => {
      if (requestVersion === version.current) setChecking(false);
      if (inFlight.current === request) inFlight.current = null;
    });
    inFlight.current = request;
    return request;
  }, [refreshAuth]);
  useEffect(() => {
    void refresh();
    const recheck = () => { void refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') recheck(); };
    const interval = window.setInterval(visible, 5000);
    window.addEventListener('focus', recheck);
    window.addEventListener('site-status-recheck', recheck);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', recheck);
      window.removeEventListener('site-status-recheck', recheck);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  return <SiteStatusContext.Provider value={{status,checking,error,refresh,setStatus}}>{children}</SiteStatusContext.Provider>;
}
export function useSiteStatus() {
  const value = useContext(SiteStatusContext);
  if (!value) throw new Error('SiteStatusProvider is unavailable');
  return value;
}
