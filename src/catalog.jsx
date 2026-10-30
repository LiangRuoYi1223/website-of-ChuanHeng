import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as samples from './data.js';
import { supabase } from './backend.js';

export const isPreview = import.meta.env.VITE_CONTENT_MODE !== 'live';
const empty = { activities: [], routes: [], photos: [], articles: [] };
const Catalog = createContext({ ...empty, loading: false, error: '', refresh: async () => {} });
export function CatalogProvider({ children }) {
  const [content, setContent] = useState(isPreview ? samples : empty);
  const [loading, setLoading] = useState(!isPreview);
  const [error, setError] = useState('');
  const [draftActivities, setDraftActivities] = useState([]);
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
  return <Catalog.Provider value={{ ...content, footprintActivities:[...content.activities,...draftActivities], localFootprintPreview:isPreview, loading, error, refresh }}>{children}</Catalog.Provider>;
}
export function useCatalog() { return useContext(Catalog); }
