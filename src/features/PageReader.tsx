import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Diamond } from 'lucide-react';
import { useContent } from '../App';
import { Footer } from '../components';
import { BoundaryWheelGate } from './activity-reader-navigation';
import './page-reader.css';

export type PageChapter = { id: string; title: string; content: ReactNode };
type Edge = 'start' | 'end';
const boundaryOf = (panel: HTMLElement) => ({ atStart: panel.scrollTop <= 2, atEnd: panel.scrollHeight - panel.clientHeight - panel.scrollTop <= 2 });
const decodeHash = (hash: string) => { try { return decodeURIComponent(hash.replace(/^#/, '')); } catch { return ''; } };
const normalizeFooterHash = (id: string) => id === 'page-chapter-explore' || id === 'activity-chapter-explore' ? 'explore' : id;

function nestedCanScroll(target: EventTarget | null, panel: HTMLElement, direction: number) {
  for (let element = target instanceof Element ? target : null; element && element !== panel; element = element.parentElement) {
    if (!(element instanceof HTMLElement) || !/(auto|scroll)/.test(getComputedStyle(element).overflowY)) continue;
    if (element.scrollHeight <= element.clientHeight + 2) continue;
    const boundary = boundaryOf(element);
    if (direction > 0 ? !boundary.atEnd : !boundary.atStart) return true;
  }
  return false;
}

export default function PageReader({ title, className = '', chapters: pageChapters }: { title: string; className?: string; chapters: PageChapter[] }) {
  const { settings } = useContent();
  const chapters = pageChapters;
  const { pathname, hash, key } = useLocation();
  const navigate = useNavigate();
  const [selectedIndex, setActiveIndex] = useState(() => {
    const id = normalizeFooterHash(decodeHash(hash));
    return id === 'explore' ? chapters.length - 1 : Math.max(0, chapters.findIndex(chapter => chapter.id === id));
  });
  const activeIndex = Math.min(selectedIndex, chapters.length - 1);
  const [headerHeight, setHeaderHeight] = useState(89);
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const navListRef = useRef<HTMLOListElement>(null);
  const navButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeRef = useRef(activeIndex);
  const chaptersRef = useRef(chapters);
  const pendingEdge = useRef<Edge | null>(null);
  const pendingTarget = useRef<string | null>(null);
  const readerNavigationHash = useRef<string | null>(null);
  const wheelGate = useRef(new BoundaryWheelGate());
  chaptersRef.current = chapters;

  const positionPanel = useCallback((panel: HTMLDivElement, edge: Edge, targetId: string | null) => {
    panel.scrollTop = edge === 'end' ? panel.scrollHeight : 0;
    const target = targetId ? document.getElementById(targetId) : null;
    if (target && panel.contains(target)) panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 12;
    panel.focus({ preventScroll: true });
  }, []);

  const chapterForHash = useCallback((id: string) => {
    if (normalizeFooterHash(id) === 'explore') return chaptersRef.current.length - 1;
    const index = chaptersRef.current.findIndex(chapter => chapter.id === id || `page-chapter-${chapter.id}` === id || `activity-chapter-${chapter.id}` === id);
    if (index >= 0) return index;
    const panel = document.getElementById(id)?.closest<HTMLDivElement>('.page-reader-panel');
    return panel && stageRef.current?.contains(panel) ? panelRefs.current.indexOf(panel) : -1;
  }, []);

  const activate = useCallback((index: number, edge: Edge = 'start', updateUrl = true, targetId: string | null = null) => {
    const chapter = chaptersRef.current[index];
    if (!chapter) return;
    pendingEdge.current = edge;
    pendingTarget.current = targetId;
    if (index === activeRef.current) {
      const panel = panelRefs.current[index];
      if (panel) positionPanel(panel, edge, targetId);
      pendingEdge.current = null;
      pendingTarget.current = null;
    } else {
      activeRef.current = index;
      setActiveIndex(index);
    }
    if (updateUrl) {
      readerNavigationHash.current = `#${targetId || chapter.id}`;
      navigate({ pathname, hash: readerNavigationHash.current }, { replace: true, preventScrollReset: true });
    }
  }, [navigate, pathname, positionPanel]);

  useLayoutEffect(() => {
    activeRef.current = activeIndex;
    const panel = panelRefs.current[activeIndex];
    if (!panel) return;
    if (pendingEdge.current) {
      positionPanel(panel, pendingEdge.current, pendingTarget.current);
      pendingEdge.current = null;
      pendingTarget.current = null;
    }
    const list = navListRef.current;
    const button = navButtonRefs.current[activeIndex];
    if (list && button) {
      const listRect = list.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      if (buttonRect.top < listRect.top) list.scrollTop -= listRect.top - buttonRect.top;
      else if (buttonRect.bottom > listRect.bottom) list.scrollTop += buttonRect.bottom - listRect.bottom;
    }
  }, [activeIndex, positionPanel]);

  useLayoutEffect(() => {
    document.documentElement.classList.add('page-reader-open');
    window.scrollTo({ top: 0, behavior: 'instant' });
    const header = document.querySelector<HTMLElement>('.site-header');
    const measure = () => { if (header) setHeaderHeight(header.getBoundingClientRect().height); };
    measure();
    const resize = new ResizeObserver(measure);
    if (header) resize.observe(header);
    return () => { resize.disconnect(); document.documentElement.classList.remove('page-reader-open'); };
  }, []);

  useEffect(() => {
    if (readerNavigationHash.current === hash) { readerNavigationHash.current = null; return; }
    readerNavigationHash.current = null;
    const id = normalizeFooterHash(decodeHash(hash));
    if (id === 'main-content') { panelRefs.current[activeRef.current]?.focus({ preventScroll: true }); return; }
    const index = id ? chapterForHash(id) : 0;
    if (index >= 0) { wheelGate.current.reset(); activate(index, 'start', false, id || null); }
  }, [key, hash, activate, chapterForHash]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const blocked = () => !!document.querySelector('dialog[open], .main-nav.is-open');
    const onWheel = (event: WheelEvent) => {
      const panel = panelRefs.current[activeRef.current];
      if (!panel) return;
      const result = wheelGate.current.update({
        deltaY: event.deltaY, deltaX: event.deltaX, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey || event.metaKey,
        now: performance.now(), ...boundaryOf(panel), canPrevious: activeRef.current > 0,
        canNext: activeRef.current < chaptersRef.current.length - 1,
        nestedCanScroll: nestedCanScroll(event.target, panel, event.deltaY), blocked: blocked(),
      });
      if (result.preventDefault) event.preventDefault();
      if (result.direction) activate(activeRef.current + result.direction, result.direction > 0 ? 'start' : 'end');
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || blocked() || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, summary, [contenteditable], [role="button"], [role="slider"]')) return;
      const panel = panelRefs.current[activeRef.current];
      if (!panel) return;
      const direction = event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey) ? 1 : event.key === 'PageUp' || (event.key === ' ' && event.shiftKey) ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      const current = boundaryOf(panel);
      if (direction > 0 ? current.atEnd : current.atStart) {
        wheelGate.current.reset();
        activate(activeRef.current + direction, direction > 0 ? 'start' : 'end');
      } else panel.scrollBy({ top: direction * panel.clientHeight * .85, behavior: 'instant' });
    };
    let touch: { x: number; y: number; index: number; atStart: boolean; atEnd: boolean; nestedUp: boolean; nestedDown: boolean } | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touch = null;
      const panel = panelRefs.current[activeRef.current];
      if (!panel || event.touches.length !== 1 || blocked()) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], [role="slider"]')) return;
      const point = event.touches[0];
      touch = { x: point.clientX, y: point.clientY, index: activeRef.current, ...boundaryOf(panel), nestedUp: nestedCanScroll(event.target, panel, -1), nestedDown: nestedCanScroll(event.target, panel, 1) };
    };
    const onTouchEnd = (event: TouchEvent) => {
      const start = touch;
      touch = null;
      if (!start || start.index !== activeRef.current || blocked() || !event.changedTouches.length) return;
      const point = event.changedTouches[0];
      const delta = start.y - point.clientY;
      if (Math.abs(delta) < 64 || Math.abs(delta) < Math.abs(start.x - point.clientX) * 1.3) return;
      const direction = delta > 0 ? 1 : -1;
      if (direction > 0 ? start.atEnd && !start.nestedDown : start.atStart && !start.nestedUp) {
        wheelGate.current.reset();
        activate(activeRef.current + direction, direction > 0 ? 'start' : 'end');
      }
    };
    const onTouchCancel = () => { touch = null; };
    const onAnchor = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
      if (!link) return;
      const id = normalizeFooterHash(decodeHash(link.getAttribute('href') || ''));
      if (id === 'main-content') { event.preventDefault(); panelRefs.current[activeRef.current]?.focus({ preventScroll: true }); return; }
      const index = chapterForHash(id);
      if (index < 0) return;
      event.preventDefault();
      wheelGate.current.reset();
      activate(index, 'start', true, id);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('keydown', onKey);
    stage.addEventListener('touchstart', onTouchStart, { passive: true });
    stage.addEventListener('touchend', onTouchEnd, { passive: true });
    stage.addEventListener('touchcancel', onTouchCancel, { passive: true });
    document.addEventListener('click', onAnchor);
    return () => {
      stage.removeEventListener('wheel', onWheel); stage.removeEventListener('keydown', onKey);
      stage.removeEventListener('touchstart', onTouchStart); stage.removeEventListener('touchend', onTouchEnd); stage.removeEventListener('touchcancel', onTouchCancel);
      document.removeEventListener('click', onAnchor);
    };
  }, [activate, chapterForHash]);

  const jump = (index: number) => { wheelGate.current.reset(); activate(index); };
  const onNavKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowDown' ? Math.min(index + 1, chapters.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? chapters.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    navButtonRefs.current[next]?.focus();
  };
  return <div className={`page-reader ${className}`} style={{ '--page-reader-header-height': `${headerHeight}px` } as CSSProperties} data-active-chapter={chapters[activeIndex].id}>
    <nav className="page-reader-nav" aria-label={`${title}板块导航`}>
      <ol ref={navListRef} className="page-reader-nav-list">{chapters.map((chapter, index) => <li key={chapter.id}><button type="button" ref={element => { navButtonRefs.current[index] = element; }} className={index === activeIndex ? 'is-active' : ''} aria-label={`跳到${chapter.title}`} aria-current={index === activeIndex ? 'step' : undefined} aria-controls={`page-chapter-${chapter.id}`} title={chapter.title} onClick={() => jump(index)} onKeyDown={event => onNavKey(event, index)}><span className="page-reader-marker" aria-hidden="true"><Diamond size={6} fill="currentColor" strokeWidth={0}/></span><span className="page-reader-nav-label">{chapter.title}</span></button></li>)}</ol>
    </nav>
    <div className="page-reader-stage" ref={stageRef}>
      {chapters.map((chapter, index) => <div key={chapter.id} id={`page-chapter-${chapter.id}`} className={`page-reader-panel page-reader-panel--${chapter.id}`} ref={element => { panelRefs.current[index] = element; }} hidden={index !== activeIndex} inert={index !== activeIndex} role="region" aria-label={chapter.title} tabIndex={0}>{chapter.content}{index === chapters.length - 1 && <div id="explore" className="page-reader-footer"><Footer settings={settings}/></div>}</div>)}
    </div>
    <span className="page-reader-announcement" aria-live="polite" aria-atomic="true">第 {activeIndex + 1} 个板块，共 {chapters.length} 个：{chapters[activeIndex].title}</span>
  </div>;
}
