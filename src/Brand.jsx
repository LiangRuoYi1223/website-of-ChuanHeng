import { Link } from 'react-router-dom';

export const OFFICIAL_BADGE = '/brand/chuanheng-official-badge.jpg';

export default function Brand({ variant = 'default' }) {
  return <Link to="/" className={`brand brand--${variant}`} aria-label="川衡首页">
    <img className="official-badge" src={OFFICIAL_BADGE} alt="川衡社官方圆形徽章" width={variant === 'footer' ? 96 : 44} height={variant === 'footer' ? 96 : 44}/>
    <span><strong>川衡</strong><small>CHUANHENG</small></span>
  </Link>;
}
