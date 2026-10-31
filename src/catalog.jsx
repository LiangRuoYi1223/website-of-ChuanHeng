import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as samples from './data.js';
import { supabase } from './backend.js';
import { runtimeMode } from './runtime-mode.js';
import { effectiveActivityStatus } from './activities/schedule.js';
import { resolveActivityView } from './activities/presentation.js';

export const isPreview = runtimeMode.sampleContent;
const empty = { activities: [], routes: [], photos: [], articles: [] };
const Catalog = createContext({ ...empty, loading: false, error: '', refresh: async () => {} });
export function CatalogProvider({ children }) {
  const [content, setContent] = useState(isPreview ? samples : empty);
  const [loading, setLoading] = useState(!isPreview);
  const [error, setError] = useState('');
  const [draftActivities, setDraftActivities] = useState([]);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (![...content.activities, ...draftActivities].some(item => item.dateEnd || item.registrationStart)) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [content.activities, draftActivities]);
  useEffect(() => {
    if (!isPreview) return;
    const update = () => {
      try {
        const rows = JSON.parse(localStorage.getItem('chuanheng-drafts') || '[]');
        setDraftActivities(Array.isArray(rows) ? rows.filter(row=>row.kind==='activity' && row.payload && !row.payload.archived).map(row=>({...row.payload,id:row.id,published:false,localDraft:true})) : []);
      } catch { setDraftActivities([]); }
    };
    update();window.addEventListener('chuanheng-drafts-updated',update);window.addEventListener('storage',update);
    return()=>{window.removeEventListener('chuanheng-drafts-updated',update);window.removeEventListener('storage',update)};
  }, []);
  const refresh = useCallback(async () => {
    if (isPreview) return;
    if (!supabase) { setError('内容服务暂未连接，请稍后再试。'); setLoading(false); return; }
    setLoading(true);
    const { data, error: failure } = await supabase.from('content_items').select('id,kind,payload').eq('published', true).order('created_at', { ascending: false });
    if (failure) setError('暂时无法加载内容，请稍后重试。');
    else {
      const next = { activities: [], routes: [], photos: [], articles: [] };
      const kindMap = { activity: 'activities', route: 'routes', photo: 'photos', article: 'articles' };
      for (const row of data || []) {
        const key = kindMap[row.kind];
        if (key && row.payload && row.payload.isDemo !== true && !row.payload.archived) next[key].push({ ...row.payload, id: row.id, published: true });
      }
      setContent(next); setError('');
    }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); window.addEventListener('chuanheng-content-updated', refresh); return () => window.removeEventListener('chuanheng-content-updated', refresh); }, [refresh]);
  const activities = content.activities.map(source => ({ ...resolveActivityView(source), status: effectiveActivityStatus(source, clock) }));
  return <Catalog.Provider value={{ ...content, activities, footprintActivities:[...activities,...draftActivities.map(resolveActivityView)], localFootprintPreview:isPreview, loading, error, refresh }}>{children}</Catalog.Provider>;
}
export function useCatalog() { return useContext(Catalog); }
