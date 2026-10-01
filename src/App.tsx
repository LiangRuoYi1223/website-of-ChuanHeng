import { createContext, useContext } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { demoContent } from './demo-content';
import type { PublicContent } from './types';
import { Header, Footer, ScrollReset } from './components';
import { ActivitiesPage, ActivityDetail } from './pages/Activities';
import AboutPage from './pages/About';
import { TeamPage, ProjectDetail } from './pages/Team';

const ContentContext = createContext<PublicContent | null>(null);
export function useContent() { const value = useContext(ContentContext); if (!value) throw new Error('Content is unavailable'); return value; }

export default function App() {
  const content = demoContent;
  return <ContentContext.Provider value={content}><ScrollReset/><a href="#main-content" className="skip-link">跳到页面内容</a><Header settings={content.settings}/><main id="main-content"><Routes><Route path="/" element={<ActivitiesPage/>}/><Route path="/activities" element={<ActivitiesPage/>}/><Route path="/activities/:id" element={<ActivityDetail/>}/><Route path="/about" element={<AboutPage/>}/><Route path="/team" element={<TeamPage/>}/><Route path="/projects/:id" element={<ProjectDetail/>}/><Route path="*" element={<div className="not-found container"><span className="eyebrow">404 · LOST ON THE TRAIL</span><h1>这条路还未开辟。</h1><Link to="/" className="button button-green">回到活动首页</Link></div>}/></Routes></main><Footer settings={content.settings}/></ContentContext.Provider>;
}
