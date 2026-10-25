'use client';

import * as React from 'react';
import './ink-blot-background.css';

export type InkBlotBackgroundProps = {
  image: string;
  /** Duration of the ink bloom in milliseconds. */
  duration?: number;
  /** Positive values bloom from the right, negative values from the left. */
  direction?: number;
  className?: string;
  /** Called once when the latest image request settles, including a load failure. */
  onTransitionEnd?: () => void;
};

type Size = { width: number; height: number };
type Bloom = { id: number; image: string; duration: number; direction: number };
type Drop = [number, number, number];

const IMAGE_LOAD_TIMEOUT = 12000;
const BLEED = 90;

function easeInOut(t: number): number {
  const progress = Math.min(1, Math.max(0, t));
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function satelliteDrops(seed: number): Drop[] {
  let state = seed >>> 0 || 1;
  const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: 7 }, () => {
    const angle = random() * Math.PI * 2;
    const distance = 40 + random() * 140;
    return [Math.cos(angle) * distance, Math.sin(angle) * distance, 0.25 + random() * 0.4];
  });
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  React.useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  return reduced;
}

function InkBloomLayer({
  bloom,
  size,
  onDone,
}: {
  bloom: Bloom;
  size: Size;
  onDone: (bloom: Bloom) => void;
}) {
  const id = `ink-${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const circles = React.useRef<(SVGCircleElement | null)[]>([]);
  const latest = React.useRef({ size, onDone });
  latest.current = { size, onDone };

  const origin = React.useMemo(() => {
    const random = (bloom.id * 0.618) % 1;
    return {
      x: bloom.direction >= 0 ? 0.62 + random * 0.25 : 0.13 + random * 0.25,
      y: 0.3 + random * 0.4,
    };
  }, [bloom.id, bloom.direction]);
  const parts = React.useMemo(
    () => [[0, 0, 1] as Drop, ...satelliteDrops(Math.round(origin.x * 7000 + origin.y * 13000))],
    [origin],
  );

  React.useEffect(() => {
    const start = performance.now();
    let frame = 0;
    let finished = false;

    const paint = (progress: number) => {
      const { width, height } = latest.current.size;
      const x = width * origin.x;
      const y = height * origin.y;
      const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y)) * 1.3;
      const dropScale = Math.min(1, Math.min(width, height) / 600);
      const growth = easeInOut(progress);
      parts.forEach(([dx, dy, scale], index) => {
        const circle = circles.current[index];
        if (!circle) return;
        circle.setAttribute('cx', String(x + dx * dropScale));
        circle.setAttribute('cy', String(y + dy * dropScale));
        circle.setAttribute('r', String(radius * growth * (index ? scale * 1.6 : 1)));
      });
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(deadline);
      paint(1);
      latest.current.onDone(bloom);
    };
    const step = (now: number) => {
      if (finished) return;
      const progress = Math.min(1, (now - start) / bloom.duration);
      paint(progress);
      if (progress < 1) frame = requestAnimationFrame(step);
      else finish();
    };

    // A deadline also settles the request when a background tab suspends rAF.
    const deadline = window.setTimeout(finish, bloom.duration + 120);
    paint(0);
    frame = requestAnimationFrame(step);
    return () => {
      finished = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(deadline);
    };
  }, [bloom, origin, parts]);

  return (
    <svg
      className="ink-blot-background__bloom"
      viewBox={`0 0 ${size.width} ${size.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter
          id={`${id}-filter`}
          filterUnits="userSpaceOnUse"
          x={-BLEED}
          y={-BLEED}
          width={size.width + BLEED * 2}
          height={size.height + BLEED * 2}
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012"
            numOctaves={3}
            seed={3}
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={BLEED}
            xChannelSelector="R"
            yChannelSelector="G"
          />
          <feGaussianBlur stdDeviation={1.5} />
        </filter>
        <mask
          id={`${id}-mask`}
          maskUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={size.width}
          height={size.height}
          style={{ maskType: 'luminance' }}
        >
          <rect width={size.width} height={size.height} fill="black" />
          <g filter={`url(#${id}-filter)`}>
            {parts.map((_, index) => (
              <circle
                key={index}
                ref={(element) => {
                  circles.current[index] = element;
                }}
                r={0}
                fill="white"
              />
            ))}
          </g>
        </mask>
      </defs>
      <image
        href={bloom.image}
        x={0}
        y={0}
        width={size.width}
        height={size.height}
        preserveAspectRatio="xMidYMid slice"
        mask={`url(#${id}-mask)`}
      />
    </svg>
  );
}

/** Decorative, controlled background: the parent owns all navigation and timing. */
export default function InkBlotBackground({
  image,
  duration = 2400,
  direction = 1,
  className,
  onTransitionEnd,
}: InkBlotBackgroundProps) {
  const root = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState<Size>({ width: 1, height: 1 });
  const [currentImage, setCurrentImage] = React.useState('');
  const [bloom, setBloom] = React.useState<Bloom | null>(null);
  const current = React.useRef('');
  const active = React.useRef<Bloom | null>(null);
  const request = React.useRef(0);
  const settledRequest = React.useRef(0);
  const reducedMotion = useReducedMotion();
  const options = React.useRef({ duration, direction, reducedMotion });
  const callback = React.useRef(onTransitionEnd);
  options.current = { duration, direction, reducedMotion };
  callback.current = onTransitionEnd;

  const settle = React.useCallback((id: number) => {
    if (request.current !== id || settledRequest.current === id) return;
    settledRequest.current = id;
    callback.current?.();
  }, []);

  const commit = React.useCallback((next: string) => {
    current.current = next;
    setCurrentImage(next);
  }, []);

  const finishBloom = React.useCallback(
    (completed: Bloom) => {
      if (active.current?.id !== completed.id) return;
      active.current = null;
      commit(completed.image);
      setBloom(null);
      settle(completed.id);
    },
    [commit, settle],
  );

  React.useEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      setSize((previous) =>
        previous.width === bounds.width && previous.height === bounds.height
          ? previous
          : { width: bounds.width, height: bounds.height },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const id = ++request.current;
    let cancelled = false;
    let loadingComplete = false;
    let decoding = false;
    let deadline: number | undefined;
    const loader = new Image();
    const isCurrent = () => !cancelled && request.current === id;
    const fail = () => {
      if (!isCurrent() || loadingComplete) return;
      loadingComplete = true;
      window.clearTimeout(deadline);
      loader.onload = null;
      loader.onerror = null;
      loader.removeAttribute('src');
      settle(id);
    };
    const ready = async () => {
      if (!isCurrent() || loadingComplete || decoding) return;
      if (!loader.naturalWidth || !loader.naturalHeight) {
        fail();
        return;
      }
      decoding = true;
      // onload is authoritative; a decode rejection need not reject a valid SVG.
      if (typeof loader.decode === 'function') await loader.decode().catch(() => undefined);
      if (!isCurrent() || loadingComplete) return;
      loadingComplete = true;
      window.clearTimeout(deadline);

      // If a new request interrupts a bloom, settle its already loaded image
      // before starting the latest one. Pending network results never win.
      const previous = active.current?.image || current.current;
      if (previous) commit(previous);
      const preferences = options.current;
      const milliseconds = Number.isFinite(preferences.duration)
        ? Math.max(0, preferences.duration)
        : 2400;
      if (!previous || previous === image || preferences.reducedMotion || milliseconds === 0) {
        active.current = null;
        setBloom(null);
        commit(image);
        settle(id);
        return;
      }
      const next = { id, image, duration: milliseconds, direction: preferences.direction };
      active.current = next;
      setBloom(next);
    };

    loader.onload = () => {
      void ready();
    };
    loader.onerror = fail;
    if (image.trim()) {
      deadline = window.setTimeout(fail, IMAGE_LOAD_TIMEOUT);
      loader.src = image;
      if (loader.complete)
        queueMicrotask(() => {
          void ready();
        });
    } else {
      // Defer an empty request so Strict Mode's cancelled setup cannot notify.
      queueMicrotask(fail);
    }
    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
      loader.onload = null;
      loader.onerror = null;
      loader.removeAttribute('src');
    };
  }, [image, commit, settle]);

  React.useEffect(() => {
    if (reducedMotion && active.current) finishBloom(active.current);
  }, [reducedMotion, finishBloom]);

  return (
    <div
      ref={root}
      className={['ink-blot-background', className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      {currentImage && (
        <img
          className="ink-blot-background__base"
          src={currentImage}
          alt=""
          decoding="async"
          draggable={false}
        />
      )}
      {bloom && <InkBloomLayer key={bloom.id} bloom={bloom} size={size} onDone={finishBloom} />}
    </div>
  );
}
