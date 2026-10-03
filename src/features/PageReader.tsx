import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Diamond } from 'lucide-react';
import { useContent } from '../App';
import { Footer } from '../components';
import { getChapterProgress } from './page-reader-progress';
import './page-reader.css';

export type PageChapter = { id: string; title: string; content: ReactNode };
const decodeHash = (hash: string) => { try { return decodeURIComponent(hash.replace(/^#/, '')); } catch { return ''; } };
const normalizeFooterHash = (id: string) => id === 'page-chapter-explore' || id === 'activity-chapter-explore' ? 'explore' : id;

export default function PageReader({ title, className = '', chapters }: { title: string; className?: string; chapters: PageChapter[] }) {
  const { settings } = useContent();
  const { pathname, hash, key, state } = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const readerId = useId();
  const [reading, setReading] = useState(() => {
    const id = normalizeFooterHash(decodeHash(hash));
    return { index: id === 'explore' ? chapters.length - 1 : Math.max(0, chapters.findIndex(chapter => chapter.id === id)), progress: 0 };
  });
  const activeIndex = Math.min(reading.index, chapters.length - 1);
  const [headerHeight, setHeaderHeight] = useState(89);
  const [headerReady, setHeaderReady] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const navListRef = useRef<HTMLOListElement>(null);
  const navButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const navItemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const activeRef = useRef(activeIndex);
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;

  const replaceHash = useCallback((nextHash: string) => {
    // Tag every internal replacement so fast scroll updates cannot be mistaken for a new anchor request.
    navigate({ pathname, hash: nextHash }, { replace: true, preventScrollReset: true, state: { pageReaderNavigation: readerId } });
  }, [navigate, pathname, readerId]);

  const updateNavTone = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const panels = panelRefs.current.map(panel => panel?.getBoundingClientRect());
    const footer = document.getElementById('explore')?.getBoundingClientRect();
    const teamPage = stage.parentElement?.classList.contains('team-page');
    navItemRefs.current.forEach((item, index) => {
      const button = navButtonRefs.current[index];
      if (!item || !button) return;
      const rect = button.getBoundingClientRect();
      const y = rect.top + rect.height / 2;
      const panelIndex = panels.findIndex(panel => panel && panel.top <= y && panel.bottom > y);
      const chapterId = chaptersRef.current[panelIndex]?.id;
      const overFooter = footer && footer.top <= y && footer.bottom > y;
      const image = panelRefs.current[panelIndex]?.querySelector('.activities-hero, .outdoors-story')?.getBoundingClientRect();
      const overImage = image && image.top <= y && image.bottom > y;
      const dark = overFooter || overImage || (teamPage && chapterId !== 'projects') || ['handbook', 'project-contact'].includes(chapterId || '');
      item.dataset.tone = dark ? 'dark' : 'light';
    });
  }, []);

  const readPosition = useCallback((updateUrl = true) => {
    const stage = stageRef.current;
    if (!stage) return;
    updateNavTone();
    const stageTop = stage.getBoundingClientRect().top;
    const starts = chaptersRef.current.map((_, index) => (panelRefs.current[index]?.getBoundingClientRect().top ?? stageTop) - stageTop + stage.scrollTop);
    // Native scrolling can quantize fractional positions by less than a CSS pixel.
    const position = starts.find(start => Math.abs(start - stage.scrollTop) < 1) ?? stage.scrollTop;
    const next = getChapterProgress(starts, position, stage.scrollHeight - stage.clientHeight);
    if (next.index === chaptersRef.current.length - 1 && stage.scrollHeight - stage.clientHeight - stage.scrollTop <= 1) next.progress = 1;
    const changedChapter = next.index !== activeRef.current;
    activeRef.current = next.index;
    setReading(previous => previous.index === next.index && Math.abs(previous.progress - next.progress) < .0001 ? previous : next);
    if (changedChapter && updateUrl) replaceHash(`#${chaptersRef.current[next.index].id}`);
  }, [replaceHash, updateNavTone]);

  const chapterForHash = useCallback((id: string) => {
    if (normalizeFooterHash(id) === 'explore') return chaptersRef.current.length - 1;
    const index = chaptersRef.current.findIndex(chapter => chapter.id === id || `page-chapter-${chapter.id}` === id || `activity-chapter-${chapter.id}` === id);
    if (index >= 0) return index;
    const panel = document.getElementById(id)?.closest<HTMLDivElement>('.page-reader-panel');
    return panel && stageRef.current?.contains(panel) ? panelRefs.current.indexOf(panel) : -1;
  }, []);

  const scrollToChapter = useCallback((index: number, targetId: string | null = null, smooth = false, updateUrl = true) => {
    const stage = stageRef.current;
    const panel = panelRefs.current[index];
    if (!stage || !panel) return;
    const target = targetId ? document.getElementById(targetId) : null;
    const destination = target && stage.contains(target) ? target : panel;
    const top = destination.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop;
    const behavior = smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant';
    stage.scrollTo({ top, behavior });
    panel.focus({ preventScroll: true });
    if (updateUrl) replaceHash(`#${targetId || chaptersRef.current[index].id}`);
    if (behavior === 'instant') readPosition(false);
  }, [readPosition, replaceHash]);

  useLayoutEffect(() => {
    const list = navListRef.current;
    const button = navButtonRefs.current[activeIndex];
    if (!list || !button) return;
    const listRect = list.getBoundingClientRect();
    const buttonRect = button.parentElement!.getBoundingClientRect();
    if (buttonRect.top < listRect.top) list.scrollTop -= listRect.top - buttonRect.top;
    else if (buttonRect.bottom > listRect.bottom) list.scrollTop += buttonRect.bottom - listRect.bottom;
    updateNavTone();
  }, [activeIndex, updateNavTone]);

  useLayoutEffect(() => {
    document.documentElement.classList.add('page-reader-open');
    window.scrollTo({ top: 0, behavior: 'instant' });
    const header = document.querySelector<HTMLElement>('.site-header');
    const measure = () => { if (header) setHeaderHeight(header.getBoundingClientRect().height); setHeaderReady(true); };
    measure();
    const resize = new ResizeObserver(measure);
    if (header) resize.observe(header);
    return () => { resize.disconnect(); document.documentElement.classList.remove('page-reader-open'); };
  }, []);

  useLayoutEffect(() => {
    if (!headerReady || (navigationType === 'REPLACE' && state?.pageReaderNavigation === readerId)) return;
    const id = normalizeFooterHash(decodeHash(hash));
    if (id === 'main-content') { stageRef.current?.focus({ preventScroll: true }); return; }
    const index = id ? chapterForHash(id) : 0;
    if (index >= 0) scrollToChapter(index, id || null, false, false);
  }, [key, hash, state, navigationType, readerId, headerReady, chapterForHash, scrollToChapter]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !headerReady) return;
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; readPosition(); }); };
    stage.addEventListener('scroll', schedule, { passive: true });
    navListRef.current?.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(stage);
    panelRefs.current.forEach(panel => { if (panel) resize.observe(panel); });
    schedule();
    const navList = navListRef.current;
    return () => { stage.removeEventListener('scroll', schedule); navList?.removeEventListener('scroll', schedule); resize.disconnect(); cancelAnimationFrame(frame); };
  }, [chapters.length, headerReady, readPosition]);

  useEffect(() => {
    const onAnchor = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
      if (!link) return;
      const id = normalizeFooterHash(decodeHash(link.getAttribute('href') || ''));
      if (id === 'main-content') { event.preventDefault(); stageRef.current?.focus({ preventScroll: true }); return; }
      const index = chapterForHash(id);
      if (index < 0) return;
      event.preventDefault();
      scrollToChapter(index, id, true);
    };
    document.addEventListener('click', onAnchor);
    return () => document.removeEventListener('click', onAnchor);
  }, [chapterForHash, scrollToChapter]);

  const onNavKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowDown' ? Math.min(index + 1, chapters.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? chapters.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    navButtonRefs.current[next]?.focus();
  };

  return <div className={`page-reader ${className}`} style={{ '--page-reader-header-height': `${headerHeight}px`, '--chapter-progress': reading.progress } as CSSProperties} data-active-chapter={chapters[activeIndex].id}>
    <nav className="page-reader-nav" aria-label={`${title}板块导航`}>
      <ol ref={navListRef} className="page-reader-nav-list">{chapters.map((chapter, index) => <li key={chapter.id} ref={element => { navItemRefs.current[index] = element; }}>
        <button type="button" ref={element => { navButtonRefs.current[index] = element; }} className={index === activeIndex ? 'is-active' : ''} aria-label={`跳到${chapter.title}`} aria-current={index === activeIndex ? 'step' : undefined} aria-controls={`page-chapter-${chapter.id}`} title={chapter.title} onClick={() => scrollToChapter(index, null, true)} onKeyDown={event => onNavKey(event, index)}><span className="page-reader-marker" aria-hidden="true"><Diamond size={6} fill="currentColor" strokeWidth={0}/></span><span className="page-reader-nav-label">{chapter.title}</span></button>
        {index === activeIndex && <span className="page-reader-progress" role="progressbar" aria-label={`${chapter.title}阅读进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(reading.progress * 100)}><span/></span>}
      </li>)}</ol>
    </nav>
    <div className="page-reader-stage" ref={stageRef} tabIndex={0} role="region" aria-label={`${title}正文`}>
      {chapters.map((chapter, index) => <div key={chapter.id} id={`page-chapter-${chapter.id}`} className={`page-reader-panel page-reader-panel--${chapter.id}`} ref={element => { panelRefs.current[index] = element; }} role="region" aria-label={chapter.title} tabIndex={-1}>{chapter.content}{index === chapters.length - 1 && <div id="explore" className="page-reader-footer"><Footer settings={settings}/></div>}</div>)}
    </div>
    <span className="page-reader-announcement" aria-live="polite" aria-atomic="true">第 {activeIndex + 1} 个板块，共 {chapters.length} 个：{chapters[activeIndex].title}</span>
  </div>;
}
