import { Link } from 'react-router-dom';
import { ArrowUpRight, Footprints, HeartHandshake, Compass, ChevronDown } from 'lucide-react';
import { useContent } from '../App';
import { ParallaxImage, Reveal, Signup, usePageTitle } from '../components';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { FirstDepartureGuide } from '../features/FirstDepartureGuide';
import PageReader from '../features/PageReader';
import './about-reader.css';

function Journey() {
  const { settings } = useContent();
  const imageId = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(0);
  const steps = settings.growthSteps.length ? settings.growthSteps : [{title:'普通活动', description:'从一场徒步开始。'}, {title:'系统训练', description:'在练习中积累技能。'}, {title:'队伍选拔', description:'学习协作与责任。'}, {title:'专业攀登', description:'走向更远的山。'}];
  function selectStep(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % steps.length
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index + steps.length - 1) % steps.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    buttons.current[next]?.focus();
  }
  return <section id="growth-journey" className="journey-section"><div className="journey-sticky"><div className="container"><div className="section-heading"><div><span className="eyebrow">THE WAY WE GROW</span><h2>从第一次出发，<br/>走向更远的山。</h2></div><p>成长有自己的节奏，<br/>每一步，都有人同行。</p></div><div className="journey-layout"><div className="journey-photo" id={imageId}><img src={active > 1 ? settings.storyClimbing : settings.storyHiking} alt={settings.demoMode !== false ? '从森林徒步到山地攀登的示意影像' : '从徒步到专业攀登'}/><div className="journey-photo-label"><span>YOUR NEXT CHAPTER</span><strong aria-live="polite" aria-atomic="true">{String(active + 1).padStart(2, '0')}<small> / {steps.length.toString().padStart(2, '0')}</small></strong></div></div><div className="journey-steps" role="group" aria-label="选择成长阶段">{steps.map((step, i) => <button key={i} type="button" ref={element => { buttons.current[i] = element; }} className={`journey-step ${active === i ? 'active' : ''}`} aria-pressed={active === i} aria-controls={imageId} onClick={() => setActive(i)} onKeyDown={event => selectStep(event, i)}><span className="step-number">{String(i + 1).padStart(2, '0')}</span><span><span className="journey-step-title">{step.title}</span><span className="journey-step-description">{step.description}</span></span>{active === i && <span className="step-indicator" aria-hidden="true"/>}</button>)}</div></div></div></div></section>;
}

export default function AboutPage() {
  usePageTitle('认识川衡');
  const { settings } = useContent();
  return <PageReader title="认识川衡" className="about-page" chapters={[
    { id: 'about-introduction', title: '山野之间', content:
    <section id="about-introduction" className="about-hero"><div className="container about-hero-grid"><div className="about-hero-copy"><span className="eyebrow">HELLO, WE'RE CHUANHENG.</span><h1>山野之间，<br/>找到同路人<span>。</span></h1><p>{settings.intro}</p><a href="#about-us" className="round-scroll" aria-label="了解川衡"><ChevronDown size={23}/></a><div className="about-hero-meta"><span>SINCE {settings.founded?.slice(0,4) || '2018'}</span><span>{settings.school}</span></div></div><div className="about-hero-photo"><ParallaxImage src={settings.heroAbout} alt={settings.demoMode !== false ? '温暖阳光中的森林小径示意影像' : '川衡社团生活影像'}/><span className="photo-stamp">GO OUTSIDE.<br/>COME TOGETHER.</span>{settings.demoMode !== false && <span className="image-caption">AI 生成示意影像</span>}</div></div></section>
    },
    { id: 'about-us', title: '我们是川衡', content:
    <section id="about-us" className="about-intro container"><Reveal><span className="eyebrow">A STUDENT COMMUNITY, AN OPEN TRAIL.</span><div className="about-intro-grid"><h2>我们是川衡。<br/>在山野中相遇，<br/>在同行中成长。</h2><div><p className="big-paragraph">{settings.aboutDescription}</p><Link to="/" className="text-link">看看我们最近在做什么 <ArrowUpRight size={18}/></Link></div></div></Reveal><div className="values-grid">{[{icon:Footprints, title:'从走出去开始',text:'徒步、登山、攀岩与户外探索，让课余生活多一种可能。'}, {icon:HeartHandshake,title:'一起走，也一起成长',text:'结识同路人，练习协作，在共同经历中建立信任。'}, {icon:Compass,title:'好奇心，也需要准备',text:'逐步学习户外技能、路线规划与团队协作，认真对待每一次出发。'}].map((value, i) => <Reveal key={value.title} delay={i * 80}><value.icon size={29} strokeWidth={1.3}/><h3>{value.title}</h3><p>{value.text}</p></Reveal>)}</div></section>
    },
    { id: 'first-departure', title: '第一次出发', content: <FirstDepartureGuide settings={settings}/> },
    { id: 'growth-journey', title: '一起成长', content: <Journey/> },
    { id: 'team-preview', title: '走得更远', content:
    <section id="team-preview" className="about-team-preview container"><Reveal><div className="team-preview-grid"><div className="team-preview-image"><img src={settings.heroTeam} alt={settings.demoMode !== false ? '专业攀登方向的雪山示意影像' : '川衡登山队影像'}/></div><div><span className="eyebrow">FOR THOSE WHO WANT TO GO FURTHER</span><h2>如果你想，<br/>走得更远。</h2><p>登山队以雪山攀登、专业领队培养和攀冰为目标，通过系统训练与队伍选拔，走向更专业的山地实践。</p><Link to="/team" className="button button-green">认识川衡登山队 <ArrowUpRight size={18}/></Link></div></div></Reveal></section>
    },
    { id: 'join', title: '加入川衡', content:
    <section id="join" className="join-section"><div className="container"><Reveal><div className="section-heading"><div><span className="eyebrow">YOUR FIRST STEP</span><h2>下一次出发，<br/>希望有你。</h2></div><p>先认识我们，<br/>再选择适合自己的起点。</p></div><Signup settings={settings}/></Reveal><div className="join-faq"><details><summary>没有户外经验，可以了解或参加吗？</summary><p>可以先从公众号了解活动。具体活动的经验、体能和装备要求，以每次正式公告为准，选择适合自己的入门活动。</p></details><details><summary>如何了解加入协会的方式？</summary><p>关注协会公众号，查看招新通知与活动报名说明。正式的招新时间、对象和流程将通过公众号公布。</p></details><details><summary>加入协会就能参加雪山攀登吗？</summary><p>专业攀登需要经过系统训练与队伍选拔。可以从普通活动开始积累经验，具体训练与选拔要求由登山队正式发布。</p></details></div></div></section>
    },
  ]}/>;
}

