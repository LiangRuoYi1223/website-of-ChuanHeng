import { createContext, useContext } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { demoContent } from './demo-content';
import type { PublicContent } from './types';
import { Header } from './components';
import PageReader from './features/PageReader';
import { ActivitiesPage, ActivityDetail } from './pages/Activities';
import AboutPage from './pages/About';
import CooperationPage from './pages/Cooperation';
import { TeamPage, ProjectDetail } from './pages/Team';

const ContentContext = createContext<PublicContent | null>(null);
export function useContent() { const value = useContext(ContentContext); if (!value) throw new Error('Content is unavailable'); return value; }

export default function App() {
  const content = demoContent;
  const { pathname } = useLocation();
  return <ContentContext.Provider value={content}><a href="#main-content" className="skip-link">跳到页面内容</a><Header settings={content.settings}/><main id="main-content"><Routes key={pathname}><Route path="/" element={<ActivitiesPage/>}/><Route path="/activities" element={<ActivitiesPage/>}/><Route path="/activities/:id" element={<ActivityDetail/>}/><Route path="/about" element={<AboutPage/>}/><Route path="/team" element={<TeamPage/>}/><Route path="/cooperation" element={<CooperationPage/>}/><Route path="/projects/:id" element={<ProjectDetail/>}/><Route path="*" element={<PageReader title="页面未找到" chapters={[{ id: 'not-found', title: '页面未找到', content: <div className="not-found container"><span className="eyebrow">404 · LOST ON THE TRAIL</span><h1>这条路还未开辟。</h1><Link to="/" className="button button-green">回到活动首页</Link></div> }]}/>}/></Routes></main></ContentContext.Provider>;
}
