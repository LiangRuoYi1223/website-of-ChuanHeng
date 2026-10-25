import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Diamond } from 'lucide-react';
import { useContent } from '../App';
import { Footer } from '../components';
import InkBlotBackground from '../components/ui/ink-blot-background';
import type { PageChapter } from './PageReader';
import { BoundaryWheelGate, getPanelProgress } from './section-reader-navigation';
import './section-reader.css';

type Edge = 'start' | 'end';
const decodeHash = (hash: string) => {
  try {
    return decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return '';
  }
};
const normalizeHash = (id: string) =>
  ['page-chapter-explore', 'activity-chapter-explore'].includes(id) ? 'explore' : id;
const boundaryOf = (panel: HTMLElement) => ({
  atStart: panel.scrollTop <= 1,
  atEnd: panel.scrollHeight - panel.clientHeight - panel.scrollTop <= 1,
});

function nestedCanScroll(target: EventTarget | null, panel: HTMLElement, direction: number) {
  for (
    let element = target instanceof Element ? target : null;
    element && element !== panel;
    element = element.parentElement
  ) {
    if (
      !(element instanceof HTMLElement) ||
      !/(auto|scroll)/.test(getComputedStyle(element).overflowY) ||
      element.scrollHeight <= element.clientHeight + 1
    )
      continue;
    const boundary = boundaryOf(element);
    if (direction > 0 ? !boundary.atEnd : !boundary.atStart) return true;
  }
  return false;
}

export default function SectionReader({
  title,
  className = '',
  chapters: pageChapters,
  footerBackground,
}: {
  title: string;
  className?: string;
  chapters: PageChapter[];
  footerBackground?: string;
}) {
  const { settings } = useContent();
  const chapters: PageChapter[] = [
    ...pageChapters,
    {
      id: 'explore',
      title: '继续探索',
      background: footerBackground,
      backgroundTone: 'photo',
      content: (
        <div id="explore" className="page-reader-footer">
          <Footer settings={settings} />
        </div>
      ),
    },
  ];
  const { pathname, hash, key, state } = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const readerId = useId();
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      chapters.findIndex((chapter) => chapter.id === normalizeHash(decodeHash(hash))),
    ),
  );
  const [progress, setProgress] = useState(1);
  const [direction, setDirection] = useState(1);
  const [headerHeight, setHeaderHeight] = useState(89);
  const [headerReady, setHeaderReady] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const contentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const navListRef = useRef<HTMLOListElement>(null);
  const navButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeRef = useRef(activeIndex);
  const chaptersRef = useRef(chapters);
  const pending = useRef<{ edge: Edge; targetId: string | null } | null>(null);
  const wheelGate = useRef(new BoundaryWheelGate());
  chaptersRef.current = chapters;

  const readProgress = useCallback(() => {
    const panel = panelRefs.current[activeRef.current];
    if (panel)
      setProgress(getPanelProgress(panel.scrollTop, panel.scrollHeight, panel.clientHeight));
  }, []);

  const positionPanel = useCallback(
    (panel: HTMLDivElement, edge: Edge, targetId: string | null) => {
      panel.scrollTop = edge === 'end' ? panel.scrollHeight : 0;
      const target = targetId ? document.getElementById(targetId) : null;
      if (target && panel.contains(target))
        panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top;
      panel.focus({ preventScroll: true });
    },
    [],
  );

  const chapterForHash = useCallback((id: string) => {
    id = normalizeHash(id);
    const index = chaptersRef.current.findIndex(
      (chapter) =>
        chapter.id === id ||
        `page-chapter-${chapter.id}` === id ||
        `activity-chapter-${chapter.id}` === id,
    );
    if (index >= 0) return index;
    const panel = document.getElementById(id)?.closest<HTMLDivElement>('.page-reader-panel');
    return panel && stageRef.current?.contains(panel) ? panelRefs.current.indexOf(panel) : -1;
  }, []);

  const activate = useCallback(
    (index: number, edge: Edge = 'start', updateUrl = true, targetId: string | null = null) => {
      const chapter = chaptersRef.current[index];
      if (!chapter) return;
      const previous = activeRef.current;
      if (index === previous) {
        const panel = panelRefs.current[index];
        if (panel) positionPanel(panel, edge, targetId);
        readProgress();
      } else {
        pending.current = { edge, targetId };
        activeRef.current = index;
        setDirection(index > previous ? 1 : -1);
        setActiveIndex(index);
      }
      if (updateUrl)
        navigate(
          { pathname, hash: `#${targetId || chapter.id}` },
          { replace: true, preventScrollReset: true, state: { pageReaderNavigation: readerId } },
        );
    },
    [navigate, pathname, readerId, positionPanel, readProgress],
  );

  useLayoutEffect(() => {
    document.documentElement.classList.add('page-reader-open');
    window.scrollTo({ top: 0, behavior: 'instant' });
    const header = document.querySelector<HTMLElement>('.site-header');
    const measure = () => {
      if (header) setHeaderHeight(header.getBoundingClientRect().height);
      setHeaderReady(true);
    };
    measure();
    const resize = new ResizeObserver(measure);
    if (header) resize.observe(header);
    return () => {
      resize.disconnect();
      document.documentElement.classList.remove('page-reader-open');
    };
  }, []);

  useLayoutEffect(() => {
    if (!headerReady || (navigationType === 'REPLACE' && state?.pageReaderNavigation === readerId))
      return;
    const id = normalizeHash(decodeHash(hash));
    if (id === 'main-content') {
      panelRefs.current[activeRef.current]?.focus({ preventScroll: true });
      return;
    }
    const index = id ? chapterForHash(id) : 0;
    if (index >= 0) {
      wheelGate.current.reset();
      activate(index, 'start', false, id || null);
    }
  }, [key, hash, state, navigationType, readerId, headerReady, activate, chapterForHash]);

  useLayoutEffect(() => {
    const panel = panelRefs.current[activeIndex];
    if (!panel) return;
    if (pending.current) {
      positionPanel(panel, pending.current.edge, pending.current.targetId);
      pending.current = null;
    }
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          readProgress();
        });
    };
    readProgress();
    const resize = new ResizeObserver(schedule);
    resize.observe(panel);
    const content = contentRefs.current[activeIndex];
    if (content) resize.observe(content);
    panel.addEventListener('scroll', schedule, { passive: true });
    return () => {
      resize.disconnect();
      panel.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frame);
    };
  }, [activeIndex, headerHeight, positionPanel, readProgress]);

  useLayoutEffect(() => {
    const list = navListRef.current;
    const item = navButtonRefs.current[activeIndex]?.parentElement;
    if (!list || !item) return;
    const listRect = list.getBoundingClientRect(),
      itemRect = item.getBoundingClientRect();
    if (itemRect.top < listRect.top) list.scrollTop -= listRect.top - itemRect.top;
    else if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom;
  }, [activeIndex]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const blocked = () => !!document.querySelector('dialog[open], .main-nav.is-open');
    const onWheel = (event: WheelEvent) => {
      const panel = panelRefs.current[activeRef.current];
      if (!panel) return;
      const result = wheelGate.current.update({
        deltaY: event.deltaY,
        deltaX: event.deltaX,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey || event.metaKey,
        now: performance.now(),
        ...boundaryOf(panel),
        canPrevious: activeRef.current > 0,
        canNext: activeRef.current < chaptersRef.current.length - 1,
        nestedCanScroll: nestedCanScroll(event.target, panel, event.deltaY),
        blocked: blocked(),
      });
      if (result.preventDefault) event.preventDefault();
      if (result.direction)
        activate(activeRef.current + result.direction, result.direction > 0 ? 'start' : 'end');
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || blocked() || event.ctrlKey || event.metaKey || event.altKey)
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'button, a, input, textarea, select, summary, [contenteditable], [role="button"], [role="slider"], [role="radio"], [role="tab"]',
        )
      )
        return;
      const panel = panelRefs.current[activeRef.current];
      if (
        !panel ||
        nestedCanScroll(
          event.target,
          panel,
          ['PageUp', 'ArrowUp'].includes(event.key) || (event.key === ' ' && event.shiftKey)
            ? -1
            : 1,
        )
      )
        return;
      const direction =
        ['PageDown', 'ArrowDown'].includes(event.key) || (event.key === ' ' && !event.shiftKey)
          ? 1
          : ['PageUp', 'ArrowUp'].includes(event.key) || (event.key === ' ' && event.shiftKey)
            ? -1
            : 0;
      if (!direction) return;
      event.preventDefault();
      const boundary = boundaryOf(panel);
      if (direction > 0 ? boundary.atEnd : boundary.atStart) {
        wheelGate.current.reset();
        activate(activeRef.current + direction, direction > 0 ? 'start' : 'end');
      } else
        panel.scrollBy({
          top: direction * (event.key.startsWith('Arrow') ? 48 : panel.clientHeight * 0.85),
          behavior: 'instant',
        });
    };
    let touch: {
      x: number;
      y: number;
      index: number;
      atStart: boolean;
      atEnd: boolean;
      nestedUp: boolean;
      nestedDown: boolean;
    } | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touch = null;
      const panel = panelRefs.current[activeRef.current];
      if (!panel || event.touches.length !== 1 || blocked()) return;
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable], [role="slider"]')
      )
        return;
      const point = event.touches[0];
      touch = {
        x: point.clientX,
        y: point.clientY,
        index: activeRef.current,
        ...boundaryOf(panel),
        nestedUp: nestedCanScroll(event.target, panel, -1),
        nestedDown: nestedCanScroll(event.target, panel, 1),
      };
    };
    const onTouchEnd = (event: TouchEvent) => {
      const start = touch;
      touch = null;
      if (!start || start.index !== activeRef.current || blocked() || !event.changedTouches.length)
        return;
      const point = event.changedTouches[0],
        delta = start.y - point.clientY;
      if (Math.abs(delta) < 64 || Math.abs(delta) < Math.abs(start.x - point.clientX) * 1.3) return;
      const direction = delta > 0 ? 1 : -1;
      if (direction > 0 ? start.atEnd && !start.nestedDown : start.atStart && !start.nestedUp) {
        wheelGate.current.reset();
        activate(activeRef.current + direction, direction > 0 ? 'start' : 'end');
      }
    };
    const onTouchCancel = () => {
      touch = null;
    };
    const onAnchor = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[href^="#"]')
          : null;
      if (!link) return;
      const id = normalizeHash(decodeHash(link.getAttribute('href') || ''));
      if (id === 'main-content') {
        event.preventDefault();
        panelRefs.current[activeRef.current]?.focus({ preventScroll: true });
        return;
      }
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
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('keydown', onKey);
      stage.removeEventListener('touchstart', onTouchStart);
      stage.removeEventListener('touchend', onTouchEnd);
      stage.removeEventListener('touchcancel', onTouchCancel);
      document.removeEventListener('click', onAnchor);
    };
  }, [activate, chapterForHash]);

  const onNavKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === 'ArrowDown'
        ? Math.min(index + 1, chapters.length - 1)
        : event.key === 'ArrowUp'
          ? Math.max(index - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? chapters.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    navButtonRefs.current[next]?.focus();
  };
  const active = chapters[activeIndex];
  return (
    <div
      className={`page-reader section-reader ${className}`}
      style={
        {
          '--page-reader-header-height': `${headerHeight}px`,
          '--chapter-progress': progress,
        } as CSSProperties
      }
      data-active-chapter={active.id}
      data-background-tone={active.backgroundTone || 'paper'}
    >
      <InkBlotBackground
        image={active.background || settings.heroActivities}
        direction={direction}
      />
      <div className="section-reader-veil" aria-hidden="true" />
      <nav className="page-reader-nav" aria-label={`${title}板块导航`}>
        <ol ref={navListRef} className="page-reader-nav-list">
          {chapters.map((chapter, index) => (
            <li key={chapter.id} data-tone={active.backgroundTone === 'photo' ? 'dark' : 'light'}>
              <button
                type="button"
                ref={(element) => {
                  navButtonRefs.current[index] = element;
                }}
                className={index === activeIndex ? 'is-active' : ''}
                aria-label={`跳到${chapter.title}`}
                aria-current={index === activeIndex ? 'step' : undefined}
                aria-controls={`page-chapter-${chapter.id}`}
                title={chapter.title}
                onClick={() => {
                  wheelGate.current.reset();
                  activate(index);
                }}
                onKeyDown={(event) => onNavKey(event, index)}
              >
                <span className="page-reader-marker" aria-hidden="true">
                  <Diamond size={6} fill="currentColor" strokeWidth={0} />
                </span>
                <span className="page-reader-nav-label">{chapter.title}</span>
              </button>
              {index === activeIndex && (
                <span
                  className="page-reader-progress"
                  role="progressbar"
                  aria-label={`${chapter.title}阅读进度`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                >
                  <span />
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="page-reader-stage" ref={stageRef} role="region" aria-label={`${title}正文`}>
        {chapters.map((chapter, index) => (
          <div
            key={chapter.id}
            id={`page-chapter-${chapter.id}`}
            className={`page-reader-panel page-reader-panel--${chapter.id}`}
            ref={(element) => {
              panelRefs.current[index] = element;
            }}
            hidden={index !== activeIndex}
            inert={index !== activeIndex}
            role="region"
            aria-label={chapter.title}
            tabIndex={-1}
          >
            <div
              className="section-reader-content"
              ref={(element) => {
                contentRefs.current[index] = element;
              }}
            >
              {chapter.content}
            </div>
          </div>
        ))}
      </div>
      <span className="page-reader-announcement" aria-live="polite" aria-atomic="true">
        第 {activeIndex + 1} 个板块，共 {chapters.length} 个：{active.title}
      </span>
    </div>
  );
}
