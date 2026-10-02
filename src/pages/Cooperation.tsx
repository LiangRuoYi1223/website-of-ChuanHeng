import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUpRight, Mountain, Backpack, Users, Mail, Copy, Check } from 'lucide-react';
import { useContent } from '../App';
import { cooperationContent } from '../cooperation-content';
import { DemoBadge, usePageTitle } from '../components';
import './cooperation.css';

const chapters = [
  { id: 'qualifications', label: '团队与资质' },
  { id: 'projects', label: '所有项目' },
  { id: 'benefits', label: '合作方式与权益' },
  { id: 'process', label: '合作流程' },
  { id: 'contact', label: '联系我们' },
  { id: 'handbook', label: '合作手册下载' },
];
const supportIcons = [Mountain, Backpack, Users];
const number = (index: number) => String(index + 1).padStart(2, '0');
const firstSentence = (value: string) => value.split('。')[0] || '支持需求待确认';

export default function CooperationPage() {
  usePageTitle('合作');
  const { settings, projects: allProjects, cooperation: configuredContent } = useContent();
  const content = configuredContent || cooperationContent;
  const projects = allProjects.filter(project => project.status === 'published');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const titleBreak = content.title.indexOf('，');
  const hasExamples = content.qualifications.some(item => item.isDemo) || projects.some(project => project.isDemo);
  const contact = content.contact;

  async function copyWechat() {
    try { await navigator.clipboard.writeText(contact.wechat); setCopyState('copied'); }
    catch { setCopyState('failed'); }
  }

  return <div className="cooperation-page">
    <section className="coop-hero" aria-labelledby="cooperation-title">
      <div className="coop-hero-image" aria-hidden="true"><img src={settings.heroTeam} alt="" decoding="async"/></div>
      <div className="coop-hero-wash" aria-hidden="true"/>
      <div className="container coop-hero-content">
        <span className="eyebrow">CHUANHENG / PARTNERSHIP</span>
        <h1 id="cooperation-title">{titleBreak >= 0 ? <>{content.title.slice(0, titleBreak + 1)}<br/>{content.title.slice(titleBreak + 1)}</> : content.title}</h1>
        <p>{content.intro}</p>
        <div className="coop-hero-actions"><a className="button button-green" href="#projects">浏览合作项目 <ArrowDown size={17}/></a><a className="button button-outline" href="#handbook">获取合作手册 <ArrowDown size={17}/></a></div>
      </div>
      {settings.demoMode !== false && <span className="coop-hero-caption">AI 示意影像</span>}
    </section>

    <nav className="coop-chapters container" aria-label="合作页面章节">
      {chapters.map((chapter, index) => <a key={chapter.id} href={`#${chapter.id}`}><span>{number(index)}</span>{chapter.label}</a>)}
    </nav>

    <section className="coop-section container coop-qualification-layout" id="qualifications" aria-labelledby="qualifications-title">
      <div className="coop-section-heading"><span className="eyebrow">01 / TEAM &amp; QUALIFICATIONS</span><h2 id="qualifications-title" className="preserve-lines">{content.qualificationTitle}</h2><h3 className="coop-identity">{settings.school} · 川衡登山队</h3><p>{content.qualificationDescription}</p><ul className="coop-training-focus" aria-label="训练方向">{content.trainingFocus.map(item => <li key={item}>{item}</li>)}</ul></div>
      <div className="coop-qualification-evidence"><h3>队员资质与训练经历{content.qualifications.some(item => item.isDemo) && <span>（示例）</span>}</h3>{content.qualifications.length ? <div className="coop-table-wrap"><table className="coop-table qualification-table"><caption className="sr-only">登山队人员资质与训练经历清单</caption><thead><tr><th scope="col">姓名</th><th scope="col">资质 / 培训方向</th><th scope="col">资料说明</th></tr></thead><tbody>{content.qualifications.map(item => <tr key={item.id}><th scope="row">{item.name}</th><td>{item.qualification}</td><td><span title={item.description}>{item.isDemo ? '示例资料' : item.description || '资料待核验'}</span><span className="sr-only">{item.isDemo && item.description}</span></td></tr>)}</tbody></table></div> : <p className="coop-empty">人员资质与训练资料待公布。</p>}{hasExamples && <p className="coop-data-note">{content.demoNotice}</p>}</div>
    </section>

    <section className="coop-project-section" id="projects" aria-labelledby="cooperation-projects-title"><div className="container">
      <div className="coop-section-heading coop-heading-row"><div><span className="eyebrow">02 / PROJECTS</span><h2 id="cooperation-projects-title">让每一份支持，<br/>有清晰的去向。</h2></div><p>所有公开项目在这里汇集。<br/>以项目为起点，交流适合的支持方式。</p></div>
      {projects.length ? <ol className="coop-project-list">{projects.map((project, index) => <li key={project.id} className="coop-project-row">
        <Link to={`/projects/${project.id}`} className="coop-project-photo" aria-label={`了解${project.title}`}><img src={project.image || settings.heroTeam} alt={`${project.title}${project.isDemo ? '的 AI 示意影像' : '项目影像'}`} loading="lazy" decoding="async"/>{project.isDemo && <span>AI 示意影像</span>}</Link>
        <div className="coop-project-copy"><span className="coop-project-number" aria-hidden="true">{number(index)}</span><div className="coop-project-information"><div className="coop-project-heading"><h3><Link to={`/projects/${project.id}`}>{project.title}</Link></h3>{project.isDemo && <DemoBadge/>}<Link className="text-link coop-project-more" to={`/projects/${project.id}`}>了解项目 <ArrowUpRight size={16}/></Link></div><p className="coop-project-summary">{project.summary}</p><dl className="coop-project-facts"><div><dt>项目目标</dt><dd>{project.mountain || '目标与路线待确认'}{project.elevation && ` · ${project.elevation}`}</dd></div><div><dt>计划时间</dt><dd>{project.plannedDate || '计划时间待确认'}{project.duration && ` · ${project.duration}`}</dd></div><div><dt>支持需求</dt><dd>{firstSentence(project.supportNeeds)}</dd></div></dl></div></div>
      </li>)}</ol> : <div className="coop-empty"><h3>新的项目，将在这里公布。</h3><p>具体攀登与训练项目待正式发布。你可以先了解合作方式与全年训练支持。</p><a className="text-link" href="#benefits">了解合作方式 <ArrowDown size={16}/></a></div>}
      {projects.some(project => project.isDemo) && <p className="coop-data-note">以上为项目展示示例，目标、时间与具体安排以正式计划为准。</p>}
    </div></section>

    <section className="coop-section container" id="benefits" aria-labelledby="benefits-title">
      <div className="coop-benefits-heading"><div className="coop-section-heading"><span className="eyebrow">03 / PARTNERSHIP VALUE</span><h2 id="benefits-title">支持的方式，<br/>可以一起定义。</h2></div><div className="coop-support-content"><p>欢迎户外品牌、赞助方与学校共同参与，<br/>围绕实际项目和训练，找到适合彼此的合作方式。</p><ul className="coop-support-ways">{content.supportWays.map((way, index) => { const Icon = supportIcons[index % supportIcons.length]; return <li key={way.id}><Icon size={32} strokeWidth={1.25} aria-hidden="true"/><div><h3>{way.title}</h3><p>{way.description}</p></div></li>; })}</ul></div></div>
      {content.benefits.length ? <div className="coop-table-wrap"><table className="coop-table benefits-table"><caption className="sr-only">合作权益方向与需要共同确认的事项</caption><thead><tr><th scope="col">权益方向</th><th scope="col">合作内容</th><th scope="col">确认事项</th></tr></thead><tbody>{content.benefits.map(item => <tr key={item.id}><th scope="row">{item.direction}</th><td>{item.content}</td><td>{item.confirmation}</td></tr>)}</tbody></table></div> : <p className="coop-empty">合作权益可根据具体项目共同讨论。</p>}
      <p className="coop-data-note">金额、数量、具体交付与授权范围，洽谈后书面确认。</p>
    </section>

    <section className="coop-process-section" id="process" aria-labelledby="process-title"><div className="container coop-process-layout"><div className="coop-section-heading"><span className="eyebrow">04 / HOW WE WORK</span><h2 id="process-title">从想法到同行，<br/>四步开始。</h2></div><ol className="coop-process">{content.process.map((step, index) => <li key={step.id}><span className="coop-step-number" aria-hidden="true">{number(index)}</span><h3>{step.title}</h3><p>{step.description}</p></li>)}</ol></div></section>

    <section className="coop-contact-section container" id="contact" aria-labelledby="contact-title"><div className="coop-section-heading"><span className="eyebrow">05 / CONTACT</span><h2 id="contact-title">从一次沟通，<br/>开始下一段同行。</h2></div><div className="coop-contact-details"><h3>{contact.name || '合作联系人待公布'}{contact.name && contact.isDemo && <span> · 示例联系人</span>}</h3><p>欢迎围绕项目、训练或其他合作形式交流，<br/>一起寻找下一次共同出发的可能。</p><dl className="coop-contact-channels"><div><dt><Mail size={17} aria-hidden="true"/>合作邮箱</dt><dd>{contact.email && !contact.isDemo ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : '待配置'}</dd></div><div><dt>微信</dt><dd>{contact.wechat && !contact.isDemo ? <button className="text-link" onClick={copyWechat}>{copyState === 'copied' ? <Check size={15}/> : <Copy size={15}/>} {copyState === 'copied' ? '已复制微信号' : contact.wechat}</button> : '待配置'}</dd></div></dl><p className="coop-copy-feedback" role="status">{copyState === 'failed' ? '复制失败，请手动复制微信号。' : copyState === 'copied' ? '微信号已复制。' : ''}</p></div></section>

    <section className="coop-handbook-section" id="handbook" aria-labelledby="handbook-title"><div className="container coop-handbook-layout"><div className="coop-handbook-copy"><span className="eyebrow">06 / PARTNERSHIP HANDBOOK</span><h2 id="handbook-title">把合作的可能，<br/>带回去慢慢看。</h2><p>一份完整的合作介绍，包含团队资质、全部项目、<br className="coop-desktop-break"/>合作权益、流程与联系方式，方便转发和进一步交流。</p><a className="button coop-download-button" href={content.handbook.filename} download="川衡登山队合作手册.pdf">下载合作手册 PDF <ArrowDown size={18}/></a><p className="coop-handbook-meta">A4 竖版 · {content.handbook.pages} 页 · {content.handbook.versionLabel}<span>更新于 {content.handbook.updatedAt}</span></p></div><div className="coop-handbook-stage"><a href={content.handbook.filename} className="coop-handbook-book" target="_blank" rel="noopener noreferrer" aria-label="在新窗口预览合作手册 PDF"><span className="coop-book-pages" aria-hidden="true"/><span className="coop-book-spine" aria-hidden="true"/><img className="coop-book-cover" src={content.handbook.coverImage} alt={`${content.handbook.title}实际封面 · ${content.handbook.versionLabel}`} loading="lazy" decoding="async"/></a></div></div></section>
  </div>;
}
