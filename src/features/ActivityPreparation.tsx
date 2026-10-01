import { useEffect, useId, useState } from 'react';
import { Check, ClipboardCheck, RotateCcw } from 'lucide-react';
import type { Activity } from '../types';
import './activity-preparation.css';

function fallbackItems(past: boolean) {
  return [
    { id: 'official-notice', title: '正式公告确认', description: past ? '回看该次活动的正式通知，了解当时的活动内容、时间与报名说明。' : '阅读该次活动的正式通知，核对活动内容、时间与报名状态。' },
    { id: 'participation', title: '参与条件确认', description: past ? '回顾正式通知中列出的参与条件与准备说明，不把回顾内容当作新的报名要求。' : '查看该次通知中的参与条件与准备说明，有疑问先通过通知提供的联系渠道确认。' },
    { id: 'meeting', title: '集合信息确认', description: past ? '回看当时发布的集合、交通与联系信息，整理自己的活动回顾。' : '核对该次正式通知中的集合时间、地点、交通安排与活动联系人。' },
  ];
}

export default function ActivityPreparation({ activity }: { activity: Activity }) {
  const past = activity.kind === 'past';
  const preparation = activity.preparation;
  const items = preparation?.items?.length ? preparation.items : fallbackItems(past);
  const [session, setSession] = useState<{ activityId: string; checked: string[] }>({ activityId: activity.id, checked: [] });
  const id = useId();
  useEffect(() => { setSession({ activityId: activity.id, checked: [] }); }, [activity.id]);
  const checked = session.activityId === activity.id ? session.checked : [];
  const completed = items.filter(item => checked.includes(item.id)).length;
  const progress = Math.round(completed / items.length * 100);
  function toggle(itemId: string) {
    setSession(current => {
      const previous = current.activityId === activity.id ? current.checked : [];
      return { activityId: activity.id, checked: previous.includes(itemId) ? previous.filter(value => value !== itemId) : [...previous, itemId] };
    });
  }
  return <section id="activity-preparation" className="activity-preparation-card" aria-labelledby={`${id}-title`}>
    <header className="activity-preparation-header">
      <div className="activity-preparation-heading"><span className="activity-preparation-eyebrow"><ClipboardCheck size={16} strokeWidth={1.5} aria-hidden="true" /> DEPARTURE CHECKLIST</span><h2 id={`${id}-title`}>{past ? '准备清单回顾' : '出发前，把小事准备好。'}</h2><p>{past ? '回看这次活动的行前信息，按自己的阅读进度勾选。' : '读一读、核对一下，用自己的节奏做好这次行前确认。'}</p></div>
      <div className="activity-preparation-status"><span className="activity-preparation-count" aria-live="polite" aria-atomic="true"><strong>{completed.toString().padStart(2, '0')}</strong><span> / {items.length.toString().padStart(2, '0')} 项已核对</span></span><button type="button" className="activity-preparation-reset" disabled={completed === 0} onClick={() => setSession({ activityId: activity.id, checked: [] })}><RotateCcw size={14} aria-hidden="true" />全部重置</button></div>
    </header>
    <div className="activity-preparation-progress" role="progressbar" aria-label={past ? '准备清单回顾进度' : '出发前准备核对进度'} aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={completed} aria-valuetext={`已核对 ${completed} 项，共 ${items.length} 项`}><span style={{ width: `${progress}%` }} /></div>
    {preparation?.notice && <p className="activity-preparation-notice">{preparation.notice}</p>}
    <div className="activity-preparation-items" data-count={items.length}>
      {items.map((item, index) => <label key={item.id} className={`activity-preparation-item${checked.includes(item.id) ? ' activity-preparation-item-checked' : ''}`} htmlFor={`${id}-item-${index}`}>
        <input id={`${id}-item-${index}`} className="activity-preparation-native-checkbox" type="checkbox" checked={checked.includes(item.id)} onChange={() => toggle(item.id)} />
        <span className="activity-preparation-checkbox" aria-hidden="true"><Check size={15} strokeWidth={2} /></span>
        <span className="activity-preparation-item-copy"><strong>{item.title}</strong><span>{item.description}</span></span>
      </label>)}
    </div>
    <footer className="activity-preparation-footer">
      {activity.isDemo && <span className="activity-preparation-demo">演示核对清单</span>}
      <p>{activity.isDemo ? '此清单用于展示核对流程，不能作为真实活动的准备要求。' : past ? '本清单仅用于回顾已结束的活动。' : ''}所有实际装备、集合与交通安排，以该次活动的正式通知为准。</p>
      <span className="activity-preparation-local">勾选只保留在本页，切换活动或刷新后重置。</span>
    </footer>
  </section>;
}
