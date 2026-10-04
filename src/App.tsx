import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { demoContent } from './demo-content';
import type { PublicContent } from './types';
import { Header } from './components';
import PageReader from './features/PageReader';
import { ActivitiesPage, ActivityDetail } from './pages/Activities';
import AboutPage from './pages/About';
import CooperationPage from './pages/Cooperation';
import { TeamPage, ProjectDetail } from './pages/Team';
import { api } from './api';
import LoginPage from './auth/LoginPage';
import AccountPage from './auth/AccountPage';
import './auth/auth.css';

const AdminApp = lazy(() => import('./admin/AdminApp'));

const ContentContext = createContext<PublicContent | null>(null);
export function useContent() { const value = useContext(ContentContext); if (!value) throw new Error('Content is unavailable'); return value; }

function PublicApp() {
  const content = useContent();
  const { pathname } = useLocation();
  return <><a href="#main-content" className="skip-link">跳到页面内容</a><Header settings={content.settings}/><main id="main-content"><Routes key={pathname}><Route path="/" element={<ActivitiesPage/>}/><Route path="/activities" element={<ActivitiesPage/>}/><Route path="/activities/:id" element={<ActivityDetail/>}/><Route path="/about" element={<AboutPage/>}/><Route path="/team" element={<TeamPage/>}/><Route path="/cooperation" element={<CooperationPage/>}/><Route path="/projects/:id" element={<ProjectDetail/>}/><Route path="/login" element={<LoginPage/>}/><Route path="/account" element={<AccountPage/>}/><Route path="*" element={<PageReader title="页面未找到" chapters={[{ id: 'not-found', title: '页面未找到', content: <div className="not-found container"><span className="eyebrow">404 · LOST ON THE TRAIL</span><h1>这条路还未开辟。</h1><Link to="/" className="button button-green">回到活动首页</Link></div> }]}/>}/></Routes></main></>;
}

export default function App() {
  const [content, setContent] = useState<PublicContent>(demoContent);
  const { pathname } = useLocation();
  useEffect(() => {
    let current = true;
    api<PublicContent>('/content').then(result => {
      if (current) setContent({ ...result, cooperation: result.cooperation ?? demoContent.cooperation });
    }).catch(() => { /* Static previews remain readable when the API is unavailable. */ });
    return () => { current = false; };
  }, [pathname]);
  return <ContentContext.Provider value={content}><Routes>
    <Route path="/admin/*" element={<Suspense fallback={<div className="auth-loading" role="status">正在打开内容管理…</div>}><AdminApp/></Suspense>}/>
    <Route path="*" element={<PublicApp/>}/>
  </Routes></ContentContext.Provider>;
}
