import { Link } from 'react-router-dom';
import { ArrowUpRight, Footprints, HeartHandshake, Compass, ChevronDown } from 'lucide-react';
import { useContent } from '../App';
import { ParallaxImage, Reveal, Signup, usePageTitle } from '../components';
import { useEffect, useRef, useState } from 'react';
import { FirstDepartureGuide } from '../features/FirstDepartureGuide';

function Journey() {
  const { settings } = useContent();
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.innerWidth < 760 || window.innerHeight < 650 || settings.growthSteps.length > 4 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const update = () => { const rect = el.getBoundingClientRect(); const range = Math.max(1, el.offsetHeight - window.innerHeight); const progress = Math.min(.999, Math.max(0, -rect.top / range)); setActive(Math.floor(progress * (settings.growthSteps.length || 4))); raf = 0; };
    const scroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    scroll(); window.addEventListener('scroll', scroll, { passive: true }); return () => { window.removeEventListener('scroll', scroll); cancelAnimationFrame(raf); };
  }, [settings.growthSteps.length]);
  const steps = settings.growthSteps.length ? settings.growthSteps : [{title:'普通活动', description:'从一场徒步开始。'}, {title:'系统训练', description:'在练习中积累技能。'}, {title:'队伍选拔', description:'学习协作与责任。'}, {title:'专业攀登', description:'走向更远的山。'}];
  return <section className={`journey-section ${steps.length > 4 ? 'many-steps' : ''}`} ref={ref}><div className="journey-sticky"><div className="container"><div className="section-heading"><div><span className="eyebrow">THE WAY WE GROW</span><h2>从第一次出发，<br/>走向更远的山。</h2></div><p>成长有自己的节奏，<br/>每一步，都有人同行。</p></div><div className="journey-layout"><div className="journey-photo"><img src={active > 1 ? settings.storyClimbing : settings.storyHiking} alt={settings.demoMode !== false ? '从森林徒步到山地攀登的示意影像' : '从徒步到专业攀登'}/><div className="journey-photo-label"><span>YOUR NEXT CHAPTER</span><strong>0{active + 1}<small> / {steps.length.toString().padStart(2, '0')}</small></strong></div></div><div className="journey-steps">{steps.map((step, i) => <div key={i} className={`journey-step ${active === i ? 'active' : ''}`}><span className="step-number">0{i + 1}</span><div><h3>{step.title}</h3><p>{step.description}</p></div>{active === i && <span className="step-indicator"/>}</div>)}</div></div></div></div></section>;
}

export default function AboutPage() {
  usePageTitle('认识川衡');
  const { settings } = useContent();
  return <>
    <section className="about-hero"><div className="container about-hero-grid"><div className="about-hero-copy"><span className="eyebrow">HELLO, WE'RE CHUANHENG.</span><h1>山野之间，<br/>找到同路人<span>。</span></h1><p>{settings.intro}</p><a href="#about-us" className="round-scroll" aria-label="了解川衡"><ChevronDown size={23}/></a><div className="about-hero-meta"><span>SINCE {settings.founded?.slice(0,4) || '2018'}</span><span>{settings.school}</span></div></div><div className="about-hero-photo"><ParallaxImage src={settings.heroAbout} alt={settings.demoMode !== false ? '温暖阳光中的森林小径示意影像' : '川衡社团生活影像'}/><span className="photo-stamp">GO OUTSIDE.<br/>COME TOGETHER.</span>{settings.demoMode !== false && <span className="image-caption">AI 生成示意影像</span>}</div></div></section>
    <section id="about-us" className="about-intro container"><Reveal><span className="eyebrow">A STUDENT COMMUNITY, AN OPEN TRAIL.</span><div className="about-intro-grid"><h2>我们是川衡。<br/>在山野中相遇，<br/>在同行中成长。</h2><div><p className="big-paragraph">{settings.aboutDescription}</p><Link to="/" className="text-link">看看我们最近在做什么 <ArrowUpRight size={18}/></Link></div></div></Reveal><div className="values-grid">{[{icon:Footprints, title:'从走出去开始',text:'徒步、登山、攀岩与户外探索，让课余生活多一种可能。'}, {icon:HeartHandshake,title:'一起走，也一起成长',text:'结识同路人，练习协作，在共同经历中建立信任。'}, {icon:Compass,title:'好奇心，也需要准备',text:'逐步学习户外技能、路线规划与团队协作，认真对待每一次出发。'}].map((value, i) => <Reveal key={value.title} delay={i * 80}><value.icon size={29} strokeWidth={1.3}/><h3>{value.title}</h3><p>{value.text}</p></Reveal>)}</div></section>
    <FirstDepartureGuide settings={settings}/>
    <Journey/>
    <section className="about-team-preview container"><Reveal><div className="team-preview-grid"><div className="team-preview-image"><img src={settings.heroTeam} alt={settings.demoMode !== false ? '专业攀登方向的雪山示意影像' : '川衡登山队影像'}/></div><div><span className="eyebrow">FOR THOSE WHO WANT TO GO FURTHER</span><h2>如果你想，<br/>走得更远。</h2><p>登山队以雪山攀登、专业领队培养和攀冰为目标，通过系统训练与队伍选拔，走向更专业的山地实践。</p><Link to="/team" className="button button-green">认识川衡登山队 <ArrowUpRight size={18}/></Link></div></div></Reveal></section>
    <section id="join" className="join-section"><div className="container"><Reveal><div className="section-heading"><div><span className="eyebrow">YOUR FIRST STEP</span><h2>下一次出发，<br/>希望有你。</h2></div><p>先认识我们，<br/>再选择适合自己的起点。</p></div><Signup settings={settings}/></Reveal><div className="join-faq"><details><summary>没有户外经验，可以了解或参加吗？</summary><p>可以先从公众号了解活动。具体活动的经验、体能和装备要求，以每次正式公告为准，选择适合自己的入门活动。</p></details><details><summary>如何了解加入协会的方式？</summary><p>关注协会公众号，查看招新通知与活动报名说明。正式的招新时间、对象和流程将通过公众号公布。</p></details><details><summary>加入协会就能参加雪山攀登吗？</summary><p>专业攀登需要经过系统训练与队伍选拔。可以从普通活动开始积累经验，具体训练与选拔要求由登山队正式发布。</p></details></div></div></section>
  </>;
}

