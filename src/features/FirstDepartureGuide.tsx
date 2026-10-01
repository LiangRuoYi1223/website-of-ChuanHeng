import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BellRing, BookOpen, Footprints, MessageCircle } from 'lucide-react';
import type { SiteSettings } from '../types';
import './first-departure-guide.css';

const steps = [
  {
    title: '了解活动', hint: '找到适合自己的那一次', icon: BookOpen,
    heading: '先读完一份活动预告。',
    description: '不急着决定走多远。先认识这次活动，再选择自己愿意尝试的起点。',
    details: [
      ['看活动内容', '了解时间、地点与活动安排，找到感兴趣的一次同行。'],
      ['看参与条件', '查看正式公告中的经验、体能与装备说明；有疑问，通过公告提供的联系渠道咨询。'],
      ['看报名状态', '页面中的示例活动用于展示。是否开放报名，以协会公众号的正式通知为准。'],
    ],
  },
  {
    title: '公众号报名', hint: '沿着正式通知完成报名', icon: MessageCircle,
    heading: '通过公众号，完成报名。',
    description: '报名入口、开放时间和填写方式，都以对应活动的公众号通知为准。',
    details: [
      ['找到正式入口', '查看协会公众号中对应活动的推送，按通知提供的链接或方式报名。'],
      ['核对填写信息', '提交前检查通知要求的信息与联系方式，便于接收后续安排。'],
      ['确认报名结果', '提交信息不一定代表报名成功。按正式公告的说明，确认自己的报名结果。'],
    ],
  },
  {
    title: '查看集合通知', hint: '让时间与地点都清楚', icon: BellRing,
    heading: '把集合信息，放在手边。',
    description: '报完名，再留意后续通知。把需要确认的小事提前理顺，出发就多一份从容。',
    details: [
      ['通知在哪里看', '查看公众号公告，以及报名确认时给出的后续通知渠道。'],
      ['记下集合安排', '核对集合时间、地点与活动联系人，按通知确认具体安排。'],
      ['留意最新消息', '临近活动时再查看一次通知；如果信息不明确，先联系公告中给出的负责人确认。'],
    ],
  },
  {
    title: '一起出发', hint: '从一次同行认识伙伴', icon: Footprints,
    heading: '下一段路，和同路人一起。',
    description: '第一次见面不需要很熟练。从按通知到达集合点、和伙伴打个招呼开始就好。',
    details: [
      ['出门前再核对', '再看一遍最新集合通知，给前往集合地点留出合适的时间。'],
      ['到达后确认', '按照活动通知给出的联系方式，与组织活动的同学确认自己已到达。'],
      ['有变化及时沟通', '如果自己的行程有变化，通过活动通知里的联系渠道及时沟通。'],
    ],
  },
];

export function FirstDepartureGuide({ settings }: { settings: SiteSettings }) {
  const [active, setActive] = useState(0);
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = steps[active];
  const signupUrl = settings.officialSignupUrl.trim();
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % steps.length : event.key === 'ArrowLeft' ? (index + steps.length - 1) % steps.length : event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setActive(next); buttons.current[next]?.focus();
  }
  return <section id="first-departure" className="departure-guide" aria-labelledby={`${id}-heading`}>
    <div className="departure-shell">
      <header className="departure-header">
        <div><span className="departure-eyebrow">YOUR FIRST DEPARTURE</span><h2 id={`${id}-heading`}>第一次出发，<br />也可以很从容<span>。</span></h2></div>
        <p>从了解一次活动开始。<br />四个小步骤，走近下一次同行。</p>
      </header>
      <div className="departure-steps" role="group" aria-label="选择首次出发的步骤">
        {steps.map((step, index) => <button key={step.title} type="button" ref={element => { buttons.current[index] = element; }} className={`departure-step${active === index ? ' departure-step-active' : ''}`} aria-pressed={active === index} aria-controls={`${id}-detail`} onClick={() => setActive(index)} onKeyDown={event => navigate(event, index)}>
          <span className="departure-step-top"><span className="departure-number">0{index + 1}</span><step.icon size={25} strokeWidth={1.4} aria-hidden="true" /></span>
          <span className="departure-step-title">{step.title}</span><span className="departure-step-hint">{step.hint}</span><ArrowRight className="departure-step-arrow" size={18} aria-hidden="true" />
        </button>)}
      </div>
      <div id={`${id}-detail`} className="departure-detail" aria-live="polite" aria-atomic="true">
        <div key={active} className="departure-detail-inner">
          <div className="departure-detail-copy"><span className="departure-detail-kicker">STEP 0{active + 1} / 04</span><h3>{selected.heading}</h3><p>{selected.description}</p>{active === 1 && settings.signupInstructions && <p className="departure-channel-note">{settings.signupInstructions}</p>}</div>
          <ol className="departure-checklist">{selected.details.map(([title, description], index) => <li key={title}><span className="departure-check-number">{index + 1}</span><div><h4>{title}</h4><p>{description}</p></div></li>)}</ol>
        </div>
      </div>
      <footer className="departure-footer"><p>具体报名与集合安排，以每次活动的正式通知为准。</p><div className="departure-actions"><Link className="departure-link departure-link-primary" to="/#calendar">看看近期活动 <ArrowRight size={17} aria-hidden="true" /></Link>{signupUrl ? <a className="departure-link" href={signupUrl} target="_blank" rel="noopener noreferrer">查看公众号报名 <ArrowUpRight size={17} aria-hidden="true" /></a> : <Link className="departure-link" to="/about#join">查看公众号报名 <ArrowRight size={17} aria-hidden="true" /></Link>}</div></footer>
    </div>
  </section>;
}
