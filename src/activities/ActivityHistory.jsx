import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useCatalog } from '../catalog.jsx';
import { selectHistoryActivities } from './history.js';
import { activityDateLabel } from './schedule.js';

export default function ActivityHistory() {
  const { activities, loading, error, refresh } = useCatalog();

  if (loading) return <div className="c-history-feedback" role="status">正在加载大事记…</div>;
  if (error) return (
    <div className="c-history-feedback" role="alert">
      <p>{error}</p>
      <button type="button" className="btn btn-outline" onClick={refresh}>重试</button>
    </div>
  );

  const history = selectHistoryActivities(activities);
  if (!history.length) return (
    <div className="c-history-empty">
      <div><h3>尚无大事记</h3><p>经过协会确认的大事记发布后，将在这里与大家见面。</p></div>
    </div>
  );

  return (
    <ol className="c-history-timeline" aria-label="川衡大事记">
      {history.map(activity => (
        <li key={activity.id}>
          <div className="c-history-meta">
            <span className="c-history-date">{activityDateLabel(activity)}</span>
            {activity.type && <span className="c-history-type">{activity.type}</span>}
          </div>
          <div className="c-history-story">
            <h3><Link to={`/activities/${activity.id}`}>{activity.title}<ArrowUpRight size={18} aria-hidden="true" /></Link></h3>
            {activity.description && <p>{activity.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
