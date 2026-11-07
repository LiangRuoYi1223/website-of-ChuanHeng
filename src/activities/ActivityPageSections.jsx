import { Check, ShieldCheck } from 'lucide-react';
import { readActivityPageContent } from './page-content.js';
import './page-content.css';

function Paragraph({ children, className = '' }) {
  return children ? <p className={`activity-page-text ${className}`.trim()}>{children}</p> : null;
}

export default function ActivityPageSections({ item, trackContent }) {
  const { overview, itinerary, equipment, safety } = readActivityPageContent(item);
  return <>
    <nav className="explore-anchor-nav" aria-label="活动章节">
      <a href="#activity-overview">活动介绍</a><a href="#activity-track">活动轨迹</a><a href="#activity-plan">行程安排</a><a href="#activity-equipment">装备建议</a><a href="#activity-safety">安全须知</a>
    </nav>
    <section id="activity-overview" className="explore-prose-section">
      {overview.title && <h2>{overview.title}</h2>}
      <Paragraph className="explore-lead">{item.description}</Paragraph>
      <Paragraph>{overview.body}</Paragraph>
      {(overview.noteTitle || overview.noteBody) && <div className="explore-note"><ShieldCheck size={21} /><div>{overview.noteTitle && <strong>{overview.noteTitle}</strong>}<Paragraph>{overview.noteBody}</Paragraph></div></div>}
    </section>
    <section id="activity-track" className="explore-prose-section"><h2>活动轨迹与分段海拔</h2>{trackContent}</section>
    <section id="activity-plan" className="explore-prose-section">
      {itinerary.title && <h2>{itinerary.title}</h2>}
      <Paragraph className="muted">{itinerary.intro}</Paragraph>
      {!!itinerary.items.length && <div className="explore-timeline">{itinerary.items.map((entry, index) => <div key={index}><span className="explore-timeline-number">{String(index + 1).padStart(2, '0')}</span><div>{entry.time && <small>{entry.time}</small>}{entry.title && <h3>{entry.title}</h3>}<Paragraph>{entry.description}</Paragraph></div></div>)}</div>}
    </section>
    <section id="activity-equipment" className="explore-prose-section">
      {equipment.title && <h2>{equipment.title}</h2>}
      <Paragraph>{equipment.intro}</Paragraph>
      {!!equipment.items.length && <div className="explore-equipment-grid">{equipment.items.map((entry, index) => <div key={index}><Check size={17} />{entry.title && <h3>{entry.title}</h3>}<Paragraph>{entry.description}</Paragraph></div>)}</div>}
    </section>
    <section id="activity-safety" className="explore-prose-section">
      {safety.title && <h2>{safety.title}</h2>}
      {!!safety.items.length && <ul className="explore-safety-list">{safety.items.map((entry, index) => <li className="activity-page-text" key={index}>{entry}</li>)}</ul>}
      <Paragraph className="muted">{safety.outro}</Paragraph>
    </section>
  </>;
}
