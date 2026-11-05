import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowRight, MountainSnow } from 'lucide-react';
import SiteImage, {SiteImageCredit} from './site-images/SiteImage.jsx';
export function ButtonLink({to,children,className=''}){return <Link className={`btn ${className}`} to={to}>{children}<ArrowRight size={17}/></Link>}
export function SectionHeading({title,description,to,linkText='查看全部'}){return <div className="section-heading"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{to&&<Link className="text-link" to={to}>{linkText}<ArrowUpRight size={17}/></Link>}</div>}
export function PageHero({title,description,image,imageSlot,children,compact=false}){return <section className={`page-hero ${compact?'compact':''}`}><SiteImage image={image} slot={imageSlot}/><div className="page-hero-shade"/><div className="container page-hero-content"><h1>{title}</h1>{description&&<p>{description}</p>}{children}</div><SiteImageCredit image={image} slot={imageSlot}/></section>}
export function EmptyState({title='暂无内容',description='内容准备中，欢迎稍后再来。'}){return <div className="empty-state"><MountainSnow size={34} strokeWidth={1}/><h3>{title}</h3><p>{description}</p></div>}
export function StatusTag({status}){return <span className={`tag status ${status==='报名中'?'open':status==='即将开始'?'upcoming':'ended'}`}>{status}</span>}
export function SampleNote(){return <p className="sample-note">设计预览 · 活动与路线为示例，影像为 AI 示意；不代表协会真实行程或记录。</p>}
