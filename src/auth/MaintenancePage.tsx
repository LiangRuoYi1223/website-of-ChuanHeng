import { Link } from 'react-router-dom';
import { LogIn, Mountain } from 'lucide-react';
import LoginPage from './LoginPage';
import { usePageTitle } from '../components';
import { useSiteStatus } from './SiteStatusContext';
import './maintenance.css';

export default function MaintenancePage({login=false}:{login?:boolean}) {
  const {status,error,refresh,checking} = useSiteStatus();
  usePageTitle(login ? '登录' : status?.paused ? '网站暂停服务' : '网站服务');
  return <div className="maintenance-page">
    <header className="maintenance-header"><Link className="maintenance-brand" to="/" aria-label="川衡登山协会"><Mountain size={36} aria-hidden="true"/><span><strong>川衡登山协会</strong><small>CHUANHENG · SINCE 2018</small></span></Link><Link className="header-login" to="/login?redirect=%2Fadmin"><LogIn size={17} aria-hidden="true"/>登录</Link></header>
    <main id="main-content">{login ? <LoginPage/> : <section className="maintenance-message" aria-labelledby="maintenance-title">
      <span className="eyebrow">CHUANHENG MOUNTAINEERING ASSOCIATION</span>
      <h1 id="maintenance-title">{status?.paused ? '网站暂停服务，敬请等待。' : checking ? '正在连接网站…' : '暂时无法连接网站。'}</h1>
      <p>{status?.paused ? '服务恢复后，你可以继续浏览活动与山野足迹。' : '请稍后重试，或通过右上角登录入口进入管理。'}</p>
      {error && !status?.paused && <button className="button button-outline" onClick={()=>void refresh()}>重新连接</button>}
    </section>}</main>
  </div>;
}
