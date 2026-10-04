import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowUpRight, Menu, X, Mountain, Mail, Copy, Check, ExternalLink, UserRound, LogIn } from 'lucide-react';
import type { SiteSettings } from './types';
import { useAuth } from './auth/AuthContext';
import { roleLabels } from './auth/permissions';

export function Mark({ className = '' }: { className?: string }) {
  return <svg className={className} width="45" height="43" viewBox="0 0 48 44" aria-hidden="true"><path d="M2 35 18 8l11 18 7-13 11 22H2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="m12 18 6 5 5-4m7 7 6 4 5-4M2 41h45" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg>;
}

export function Header({ settings }: { settings: SiteSettings }) {
  const [open, setOpen] = useState(false);
  const { user, checking } = useAuth();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.hash]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && open) { setOpen(false); toggleRef.current?.focus(); } }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [open]);
  return <header className="site-header"><div className="header-inner"><Link className="brand" to="/" aria-label="川衡登山协会活动首页">{settings.logoUrl ? <img className="brand-logo" src={settings.logoUrl} alt=""/> : <Mark/>}<span><strong>{settings.clubName || '川衡登山协会'}</strong><small>CHUANHENG · SINCE {settings.founded?.slice(0,4) || '2018'}</small></span></Link><nav id="mobile-navigation" className={`main-nav ${open ? 'is-open' : ''}`} aria-label="主要导航" onClick={event => { if ((event.target as Element).closest('a')) setOpen(false); }}><NavLink to="/" end>活动与足迹</NavLink><NavLink to="/about">认识川衡</NavLink><NavLink to="/team">川衡登山队</NavLink><NavLink to="/cooperation">合作</NavLink><Link to="/about#join" className="nav-join">一起出发 <ArrowUpRight size={17}/></Link></nav><div className="header-account-actions">{checking ? <span className="header-login is-checking" role="status">连接中…</span> : user ? <Link className="header-login header-signed-in" to="/account" aria-label={`${user.displayName}，${roleLabels[user.role]}，打开个人页面`}><UserRound size={17}/><span className="header-user-name">{user.displayName}</span><span className="header-role">{roleLabels[user.role]}</span></Link> : <Link className="header-login" to={`/login?redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`}><LogIn size={17}/>登录</Link>}<button ref={toggleRef} className="mobile-menu" aria-label={open ? '关闭导航' : '打开导航'} aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)}>{open ? <X/> : <Menu/>}</button></div></div></header>;
}

export function Footer({ settings }: { settings: SiteSettings }) {
  return <footer className="site-footer" role="contentinfo"><div className="footer-top container"><div className="footer-brand">{settings.logoUrl ? <img className="brand-logo" src={settings.logoUrl} alt=""/> : <Mark/>}<h2>山野很远，<br/>同路人很近。</h2><p>{settings.clubName} · {settings.school}</p></div><div className="footer-links"><div><span>继续探索</span><Link to="/">活动与足迹</Link><Link to="/about">认识川衡</Link><Link to="/team">川衡登山队</Link><Link to="/cooperation">合作</Link></div><div><span>找到我们</span><Link to="/about#join">加入川衡</Link><Link to="/cooperation">合作与支持</Link>{settings.contactEmail ? <a href={`mailto:${settings.contactEmail}`}>联系协会</a> : <Link to="/about#join">公众号报名</Link>}</div></div></div><div className="footer-bottom container"><span>© {new Date().getFullYear()} 川衡登山协会</span>{settings.demoMode !== false && <span className="footer-note">演示版本 · AI 生成示意影像</span>}</div></footer>;
}

export function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.classList.add('reveal-ready');
    const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting) { el.classList.add('revealed'); observer.disconnect(); } }, { threshold: .09 });
    observer.observe(el); return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

export function ParallaxImage({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth < 760) return;
    let raf = 0;
    const limit = Number.parseFloat(getComputedStyle(el).getPropertyValue('--parallax-limit')) || 48;
    const update = () => { const rect = el.getBoundingClientRect(); const offset = Math.max(-limit, Math.min(limit, (window.innerHeight / 2 - rect.top - rect.height / 2) * .12)); el.style.setProperty('--parallax', `${offset}px`); raf = 0; };
    const scroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update(); window.addEventListener('scroll', scroll, { passive: true });
    return () => { window.removeEventListener('scroll', scroll); cancelAnimationFrame(raf); };
  }, []);
  return <div ref={ref} className={`parallax-image ${className}`}><img src={src || '/images/hiking.webp'} alt={alt} loading="eager" decoding="async"/></div>;
}

export function DemoBadge({ className = '' }: { className?: string }) { return <span className={`demo-badge ${className}`}>示意内容</span>; }

export function Signup({ settings, signupUrl, qrImage, compact = false }: { settings: SiteSettings; signupUrl?: string; qrImage?: string; compact?: boolean }) {
  const url = signupUrl || settings.officialSignupUrl;
  const qr = qrImage || settings.officialQrImage;
  return <div className={`signup-box ${compact ? 'compact' : ''}`}>
    <div><span className="eyebrow">LET'S GET OUTSIDE</span><h3>从第一次出发开始。</h3><p>{settings.signupInstructions || '关注川衡登山协会公众号，了解活动安排与报名方式。'}</p>{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="button button-green">前往公众号报名 <ExternalLink size={17}/></a> : <p className="muted-notice">公众号报名入口待补充</p>}</div>
    {qr ? <div className="qr-box"><img src={qr} alt="川衡登山协会公众号报名二维码"/><span>扫码关注公众号</span></div> : <div className="qr-placeholder"><Mountain size={32}/><span>公众号二维码<br/>待补充</span></div>}
  </div>;
}

export function Contact({ settings }: { settings: SiteSettings }) {
  const [copied, setCopied] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(settings.contactWechat); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } }
  return <div className="contact-box"><span className="eyebrow">LET'S MAKE IT POSSIBLE</span><h3>一起，让下一次攀登发生。</h3><p>欢迎就攀登项目、装备支持与全年训练，和川衡登山队交流合作。</p>{settings.contactName && <p className="contact-name">合作联系人 · {settings.contactName}</p>}<div className="contact-actions">{settings.contactEmail && <a className="button button-lime" href={`mailto:${settings.contactEmail}`}><Mail size={18}/> 联系合作</a>}{settings.contactWechat && <button className="button button-outline light" onClick={copy}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? '已复制微信号' : settings.contactWechat}</button>}{!settings.contactEmail && !settings.contactWechat && <p className="contact-pending">合作联系方式待公布</p>}</div></div>;
}

export function usePageTitle(title: string) { useEffect(() => { document.title = `${title} · 川衡登山协会`; }, [title]); }
