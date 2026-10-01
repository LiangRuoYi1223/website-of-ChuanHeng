import { useMemo } from 'react';
import { Clock3, Compass, Footprints, RotateCcw } from 'lucide-react';
import type { Activity } from '../types';
import './activity-filters.css';

export type ActivityFilterState = { category: string; time: string; experience: string };
export const initialActivityFilters: ActivityFilterState = { category: '全部', time: '全部', experience: '全部' };
type FilterableActivity = Activity & {
  timeCommitment?: 'half-day' | 'full-day' | 'multi-day';
  experience?: 'relaxed' | 'scenic' | 'skills';
};
const timeOptions = [
  { value: '全部', label: '全部' },
  { value: 'half-day', label: '半日以内' },
  { value: 'full-day', label: '一整天' },
  { value: 'multi-day', label: '多日' },
  { value: 'pending', label: '待公布' },
];
const experienceOptions = [
  { value: '全部', label: '全部' },
  { value: 'relaxed', label: '轻松漫步' },
  { value: 'scenic', label: '山野探索' },
  { value: 'skills', label: '技能练习' },
  { value: 'pending', label: '待公布' },
];

/** Selections use enum values; Chinese labels are accepted for external callers too. */
export function filterActivities(activities: Activity[], filters: ActivityFilterState): Activity[] {
  const time = timeOptions.find(option => option.value === filters.time || option.label === filters.time)?.value ?? filters.time;
  const experience = experienceOptions.find(option => option.value === filters.experience || option.label === filters.experience)?.value ?? filters.experience;
  return activities.filter(activity => {
    const item = activity as FilterableActivity;
    return (filters.category === '全部' || activity.category === filters.category)
      && (time === '全部' || (item.timeCommitment || 'pending') === time)
      && (experience === '全部' || (item.experience || 'pending') === experience);
  });
}

export function ActivityFilters({ activities, filters, onChange }: { activities: Activity[]; filters: ActivityFilterState; onChange: (next: ActivityFilterState) => void }) {
  const categories = useMemo(() => ['全部', ...new Set(activities.map(activity => activity.category).filter(category => category && category !== '全部'))], [activities]);
  const count = useMemo(() => filterActivities(activities, filters).length, [activities, filters]);
  const hasSelection = filters.category !== '全部' || filters.time !== '全部' || filters.experience !== '全部';
  const groups = [
    { key: 'category' as const, title: '活动类别', icon: Footprints, options: categories.map(value => ({ value, label: value })) },
    { key: 'time' as const, title: '可以留出多久', icon: Clock3, options: timeOptions },
    { key: 'experience' as const, title: '想怎样出发', icon: Compass, options: experienceOptions },
  ];
  return <div className="activity-filters" aria-label="按活动类别、时间与体验筛选活动">
    <div className="activity-filters-head"><div><span>FIND YOUR NEXT OUTING</span><p>按你的时间，选一次出发。</p></div><p className="activity-filters-combine">时间和体验，可以一起选。</p></div>
    <div className="activity-filters-groups">{groups.map(group => <fieldset className="activity-filters-group" key={group.key}><legend><group.icon size={17} strokeWidth={1.5}/>{group.title}</legend><div className="activity-filters-options">{group.options.map(option => <button key={option.value} type="button" className="activity-filters-option" aria-pressed={filters[group.key] === option.value || filters[group.key] === option.label} onClick={() => onChange({ ...filters, [group.key]: option.value })}>{option.label}</button>)}</div></fieldset>)}</div>
    <div className="activity-filters-foot"><p aria-live="polite" aria-atomic="true">{hasSelection ? '符合选择' : '可浏览'}<strong>{count}</strong>场活动{hasSelection && <span> / 共 {activities.length} 场</span>}</p>{hasSelection ? <button type="button" className="activity-filters-clear" onClick={() => onChange({ ...initialActivityFilters })}><RotateCcw size={14}/>清除筛选</button> : <span className="activity-filters-hint">选择活动后，查看完整安排</span>}</div>
  </div>;
}
