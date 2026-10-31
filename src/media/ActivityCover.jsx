import { useState } from 'react';
import './public-cover.css';

const fallback = '/images/redesign-v2/activities-snow.webp';
function safeSource(value) {
  if (typeof value !== 'string') return '';
  if (/^\/(?!\/)/.test(value) || /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? value : ''; } catch { return ''; }
}

export default function ActivityCover({ item, loading = 'lazy' }) {
  const original = safeSource(item?.image);
  const [failure, setFailure] = useState({ source: null, fallback: false });
  const sourceFailed = failure.source === original;
  const source = original && !sourceFailed ? original : fallback;
  const unavailable = source === fallback && sourceFailed && failure.fallback;
  const illustrative = source === fallback || source.startsWith('/images/redesign-v2/') || item?.isDemo === true;
  return <>{unavailable ? <span className="activity-cover-placeholder" role="img" aria-label={`${item?.title || '活动'}，封面暂不可用`}>封面暂不可用</span> : <img className="activity-cover-photo" src={source} alt={illustrative ? `${item?.title || '活动'}，AI 示意影像` : item?.title || '活动封面'} loading={loading} onError={() => setFailure({ source: original, fallback: source === fallback })} />}{!unavailable && illustrative && <span className="activity-cover-note">AI 示意影像 · 非活动实拍</span>}</>;
}
