import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown, ArrowRight, Check, ChevronDown, Compass, Flag,
  HeartHandshake, Leaf, Map, Mountain, Plus, Minus,
  RotateCcw, Route, ShieldCheck, Users,
} from 'lucide-react';
import { PageHero, SectionHeading, EmptyState, ButtonLink } from '../ui.jsx';
import './community.css';
import FootprintExplorer from '../map/FootprintMap.jsx';
import { OFFICIAL_BADGE } from '../Brand.jsx';

const roleGroups = [
  { name: '组织与协调', description: '让一次出发从想法成为可以执行的安排。' },
  { name: '活动与训练', description: '关注路线、准备与团队协作，在实践中积累经验。' },
  { name: '影像与传播', description: '记录同行的故事，让山野的记忆被更多人看见。' },
];

export function AboutPage() {
  const [activeRole, setActiveRole] = useState(0);

  return (
    <div className="community-page c-about-page">
      <PageHero title="山野之间，彼此同行。" description="川衡登山协会 · 从一次出发开始，认识山野，也认识同行的人。" image="/images/redesign-v2/team-ridge.webp">
        <a className="btn btn-outline" href="#about-story">认识川衡 <ArrowDown size={17} aria-hidden="true" /></a>
      </PageHero>

      <section className="section container c-about-intro" id="about-story">
        <div className="c-intro-photo"><img src="/images/redesign-v2/team-ridge.webp" alt="高山山脊同行的户外氛围示意影像" loading="lazy" /><span className="c-image-label">AI 示意影像</span></div>
        <div className="c-intro-copy">
          <h2>走进山野，<br />找到自己的节奏。</h2>
          <div className="c-official-identity"><img src={OFFICIAL_BADGE} alt="南方科技大学川衡社官方完整徽章" width="150" height="150" loading="lazy"/><div><strong>南方科技大学川衡社</strong><span>川衡 CHUANHENG</span></div></div><p className="c-lead">川衡，是一群愿意一起出发的人。</p>
          <p>从校园附近的一段山路，到需要认真准备的远行，我们因对户外的好奇而相遇。看过不同的风景，也在同行中学习照顾自己、理解伙伴。</p>
          <p>一次活动可以从零经验开始。一段成长，需要持续的学习、充分的准备，以及对自然和团队的尊重。这里为每一位愿意出发的人，留一个位置。</p>
          <ButtonLink to="/join">和我们一起出发</ButtonLink>
        </div>
      </section>

      <section className="section c-values-section">
        <div className="container c-values-layout">
          <div className="c-values-title"><h2>走得更远，<br />也走得更好。</h2><p>风景之外，是我们希望一直带在路上的原则。</p></div>
          <div className="c-values-list">
            <article><ShieldCheck size={27} strokeWidth={1.5} aria-hidden="true" /><div><h3>安全是每一次出发的起点</h3><p>了解路线与自己的状态，认真准备，尊重领队安排。平安返回，比完成一条路线更重要。</p></div></article>
            <article><HeartHandshake size={27} strokeWidth={1.5} aria-hidden="true" /><div><h3>在同行中学会彼此照应</h3><p>保持沟通，照顾团队的节奏。让第一次参加的人，也能找到可以信任的伙伴。</p></div></article>
            <article><Leaf size={27} strokeWidth={1.5} aria-hidden="true" /><div><h3>把自然完整地留给后来的人</h3><p>带走垃圾，减少打扰，尊重当地环境。用更轻的痕迹，换更长久的相遇。</p></div></article>
          </div>
        </div>
      </section>

      <section className="section container c-team-section">
        <SectionHeading title="每一次出发，都有人认真准备" description="从组织协调，到活动执行与影像记录。不同的角色，让同行成为可能。" />
        <div className="c-team-workspace">
          <div className="c-role-options" aria-label="查看组织团队角色">
            {roleGroups.map((role, index) => <button type="button" key={role.name} aria-pressed={activeRole === index} onClick={() => setActiveRole(index)} className={activeRole === index ? 'is-active' : ''}><span>{role.name}</span><ArrowRight size={17} aria-hidden="true" /></button>)}
          </div>
          <div className="c-role-panel" aria-live="polite"><Users size={27} strokeWidth={1.2} aria-hidden="true" /><h3>{roleGroups[activeRole].name}</h3><p>{roleGroups[activeRole].description}</p><EmptyState title="成员资料待发布" description="确认后的团队名单与角色介绍，将在这里与大家见面。" /></div>
        </div>
      </section>

      <section className="section container c-history-section">
        <SectionHeading title="一路走来" description="每一段值得留下的记忆，都从真实的经历开始。" />
        <div className="c-history-empty"><Flag size={30} strokeWidth={1.2} aria-hidden="true" /><div><h3>协会历史正在整理</h3><p>经过确认的时间、故事与活动资料，将在这里串成川衡的来路。</p></div></div>
      </section>

      <section className="section container c-about-footprints">
        <SectionHeading title="脚步所至，故事发生" description="在地图上，慢慢看见我们一起走过的地方。" to="/footprints" linkText="探索全部足迹" />
        <FootprintExplorer />
      </section>

      <section className="c-community-close"><div className="container"><div><h2>下一段故事，<br />可以从你开始。</h2><p>带着好奇心，来认识川衡。</p></div><ButtonLink to="/join">加入我们</ButtonLink></div></section>
    </div>
  );
}

export function FootprintsPage() {
  return (
    <div className="community-page c-footprints-page">
      <PageHero compact title="每一次出发，都有来路。" description="只记录真实发生的川衡活动。让地点、时间和同行的故事，在这里相连。" image="/images/redesign-v2/activities-snow.webp" />
      <section className="section container c-full-map-section">
        <FootprintExplorer expanded />
        <div className="c-footprints-bottom"><div><h2>从一次出发，走向下一次。</h2><p>想成为下一段故事的一部分，先看看如何加入。</p></div><ButtonLink to="/join">了解加入方式</ButtonLink></div>
      </section>
    </div>
  );
}

const faqs = [
  { question: '没有户外经验，也可以加入吗？', answer: '可以先从了解协会、学习基础知识和适合新手的活动开始。每次活动的强度与参与条件不同，请阅读正式通知，按自己的体能与经验选择。' },
  { question: '加入协会后，如何报名活动？', answer: '完成注册后可关注网站发布的活动。正式活动会写明路线、时间、参与条件和报名方式；报名是否成功，以该次活动的确认通知为准。' },
  { question: '需要一开始就买齐所有装备吗？', answer: '先根据准备参加的具体活动了解需求，再逐步准备。不同路线、季节和活动形式的要求不同，请以正式装备清单为准，出发前有疑问及时向组织者确认。' },
  { question: '我也想参与组织或影像记录，可以吗？', answer: '欢迎关注相关招募。你可以从一次活动的协作开始，在实践中了解组织、记录与团队配合；具体角色、培训和参与要求以正式招募通知为准。' },
  { question: '天气变化时，活动会如何调整？', answer: '组织者会根据天气、路况和队伍情况决定是否调整或取消活动。出发前请留意最新通知，不把完成计划放在安全之前。' },
];

export function JoinPage() {
  const [openFaq, setOpenFaq] = useState(0);

  return (
    <div className="community-page c-join-page">
      <PageHero title={<>下一座山，<br />一起去。</>} description="不必独自找到所有答案。从一次出发开始，和川衡一起看见更大的世界。" image="/images/redesign-v2/join-hiker.webp">
        <ButtonLink to="/login?mode=register">开启你的山野故事</ButtonLink>
        <a className="c-hero-secondary" href="#join-reasons">先了解一下 <ArrowDown size={16} aria-hidden="true" /></a>
      </PageHero>

      <section className="section container c-join-reasons" id="join-reasons">
        <div className="c-join-reasons-copy"><h2>让周末，<br />多一种可能。</h2><p className="c-reasons-intro">出发的理由可以很简单。想呼吸山里的空气，想认识新的朋友，或只是想试试一条没走过的路。</p><div className="c-reason-list">
          <article><Mountain size={23} strokeWidth={1.5} aria-hidden="true" /><div><h3>走出日常，看见不同风景</h3><p>把注意力交给脚下的路，把周末留给真实的山风。</p></div></article>
          <article><Users size={23} strokeWidth={1.5} aria-hidden="true" /><div><h3>找到愿意同行的伙伴</h3><p>在一段共同走过的山路上，让陌生变成熟悉。</p></div></article>
          <article><Compass size={23} strokeWidth={1.5} aria-hidden="true" /><div><h3>在每次实践里多会一点</h3><p>从装备准备、节奏管理，到风险意识与团队协作。</p></div></article>
        </div></div>
        <div className="c-join-reasons-photo"><img src="/images/redesign-v2/routes-coast.webp" alt="海岸山脊与深蓝海湾的户外氛围示意影像" loading="lazy" /><span className="c-image-label">AI 示意影像</span><p>把脚步放慢，<br />让世界变大。</p></div>
      </section>

      <section className="section c-growth-section"><div className="container">
        <SectionHeading title="你的节奏，你的成长" description="从参与到协作，再到承担更多责任。成长没有统一速度，每一步都值得认真对待。" />
        <div className="c-growth-path">
          <article><Route size={29} strokeWidth={1.4} aria-hidden="true" /><h3>从一次参与开始</h3><p>选择适合自己的活动，做好个人准备，认识同行的伙伴。</p><span>参与者</span></article>
          <ArrowRight className="c-growth-arrow" size={25} strokeWidth={1.3} aria-hidden="true" />
          <article><HeartHandshake size={29} strokeWidth={1.4} aria-hidden="true" /><h3>和团队一起完成</h3><p>持续学习并参与协作，从照顾自己到有能力帮助同行的人。</p><span>协作伙伴</span></article>
          <ArrowRight className="c-growth-arrow" size={25} strokeWidth={1.3} aria-hidden="true" />
          <article><Flag size={29} strokeWidth={1.4} aria-hidden="true" /><h3>为下一次出发准备</h3><p>通过相应培训与评估，逐步承担活动组织或带队工作。</p><span>组织与领队方向</span></article>
        </div>
        <p className="c-growth-note">以上为成长方向介绍。具体招募、培训、评估与角色要求，以协会正式通知为准。</p>
      </div></section>

      <section className="section container c-join-steps">
        <SectionHeading title="准备好，就从这里开始" description="先认识，再加入。每一场活动，都有清楚的出发准备。" />
        <ol className="c-join-process">
          <li><span className="c-process-number">1</span><h3>创建你的账号</h3><p>完成注册，保留用于接收通知的有效联系方式。</p></li>
          <li><span className="c-process-number">2</span><h3>了解活动要求</h3><p>阅读路线、强度与装备说明，选择适合自己的活动。</p></li>
          <li><span className="c-process-number">3</span><h3>按通知报名</h3><p>按正式活动公告完成报名，等待组织者确认。</p></li>
          <li><span className="c-process-number">4</span><h3>做好准备，一起出发</h3><p>核对集合与物资，关注行前更新，准时与伙伴见面。</p></li>
        </ol>
        <div className="c-process-action"><ButtonLink to="/login?mode=register">创建账号</ButtonLink><span><Check size={15} aria-hidden="true" />具体活动报名以正式通知为准</span></div>
      </section>

      <section className="section c-faq-section" id="faq"><div className="container c-faq-layout">
        <div><h2>出发之前，<br />你可能想知道。</h2><p>把疑问留在出发前，<br />把好奇带去山里。</p></div>
        <div className="c-faq-list">{faqs.map((faq, index) => <article className={openFaq === index ? 'is-open' : ''} key={faq.question}><h3><button type="button" aria-expanded={openFaq === index} aria-controls={`join-faq-${index}`} onClick={() => setOpenFaq(openFaq === index ? null : index)}>{faq.question}<Plus size={19} aria-hidden="true" /></button></h3><div className="c-faq-answer" id={`join-faq-${index}`} hidden={openFaq !== index}><p>{faq.answer}</p></div></article>)}</div>
      </div></section>

      <section className="c-join-close"><img src="/images/redesign-v2/activities-snow.webp" alt="" loading="lazy" /><div className="container"><h2>新的风景，<br />从这一步开始。</h2><p>带上好奇心。我们山野见。</p><ButtonLink to="/login?mode=register">加入川衡</ButtonLink><span className="c-close-image-label">AI 示意影像</span></div></section>
    </div>
  );
}
