import type { Activity, PublicContent } from './types';
import { cooperationContent, cooperationProjects } from './cooperation-content.ts';

const walkingPreparation: Activity['preparation'] = {
  notice: '以下是演示核对清单。该次活动的装备、交通和集合安排，以公众号正式通知为准。',
  items: [
    { id: 'announcement', title: '读完本次活动通知', description: '核对活动日期、路线、预计时长与最新报名状态。当前安排为演示，正式路线尚待发布。' },
    { id: 'participation', title: '确认参与要求', description: '查看该次活动公布的经验、体能与个人参与条件，有疑问时先向组织者了解。' },
    { id: 'personal-items', title: '按本次通知准备个人物品', description: '按照正式通知逐项检查所需个人物品与装备，未明确的项目向组织者确认。' },
    { id: 'meeting', title: '核对集合与交通信息', description: '确认集合时间、地点与往返安排。当前集合区域待公布。' },
    { id: 'updates', title: '出发前查看最新消息', description: '再次查看该次活动的最新通知，确认时间或行程是否更新。' },
  ],
};

const skillsPreparation: Activity['preparation'] = {
  notice: '以下是训练活动的演示核对清单，具体准备要求由该次训练正式通知提供。',
  items: [
    { id: 'training-notice', title: '了解训练内容与参与条件', description: '查看本次训练的主题、时间投入与参与要求，确认报名信息。' },
    { id: 'training-venue', title: '确认场地与集合通知', description: '核对训练场地、集合时间及到场安排；当前场地信息待公布。' },
    { id: 'training-equipment', title: '核对器材安排', description: '查看正式通知说明的器材提供方式与个人准备要求，有疑问时联系组织者。' },
    { id: 'training-updates', title: '查看最新训练通知', description: '出发前确认训练通知是否有更新，按本次正式要求准备。' },
  ],
};

const forestAlbum: Activity['album'] = [
  { id: 'forest-light', src: '/images/forest.webp', alt: '金绿森林小径的 AI 示意图，并非本次活动实拍', caption: '林间的光，把脚步放慢。', isDemo: true },
  { id: 'ridge-view', src: '/images/hiking.webp', alt: '远处山脊与徒步者的 AI 示意图，并非本次活动实拍', caption: '一段山路，一段同行时光。', isDemo: true },
  { id: 'trail-rest', src: '/images/companions.webp', alt: '林间休息与同行伙伴的 AI 示意图，并非协会成员肖像', caption: '歇一会儿，聊聊下一次出发。', isDemo: true },
];

const climbingAlbum: Activity['album'] = [
  { id: 'climbing-atmosphere', src: '/images/alpine.webp', alt: '雪山与冰川的 AI 攀登氛围示意图，并非攀岩活动实拍', caption: '攀登氛围示意图 · 待替换本次活动照片。', isDemo: true },
  { id: 'climbing-companions', src: '/images/companions.webp', alt: '林间伙伴休息的 AI 示意图，并非攀岩活动实拍', caption: '同行的片刻 · 演示配图。', isDemo: true },
  { id: 'climbing-outdoors', src: '/images/hiking.webp', alt: '山野景色的 AI 示意图，并非攀岩活动实拍', caption: '出发的记忆，等待真实影像。', isDemo: true },
];

// Browser-only demonstration content. No database, account, or backend imports.
const activityDefaults = {
  location: '路线待实际发布',
  difficulty: '以正式公告为准',
  duration: '预计时长待公布',
  cost: '费用以正式公告为准',
  meetingPoint: '集合区域待公布',
  beginnerFriendly: '请查看正式活动的参与要求',
  registrationStatus: '示意安排 · 未开放报名',
  description: '此内容为活动示例，并非已举办或已开放报名的真实活动。正式活动的路线、参与条件、装备要求与报名安排，请以协会公众号最新公告为准。',
  signupUrl: '',
  qrImage: '',
  status: 'published' as const,
  isDemo: true,
};

export const demoContent: PublicContent = {
  settings: {
    logoUrl: '',
    demoMode: true,
    semesterName: '2026 秋季学期',
    semesterStart: '2026-09-01',
    semesterEnd: '2027-01-31',
    clubName: '川衡登山协会',
    school: '南方科技大学',
    founded: '2018',
    intro: '从校园走向山野，和一群愿意出发的人，一起看见更大的世界。',
    aboutDescription: '川衡登山协会成立于 2018 年，是南方科技大学的学生组织。我们以徒步、登山与户外活动为纽带，让愿意出发的人在山野中相遇。你可以从适合自己的活动开始，找到自己的节奏。\n\n“川衡”是《周礼》记载的古代职官名称，属地官系统，主要负责管理川泽的禁令。今天，我们倡导无痕山野，在亲近自然的同时，尽量减少留下的影响。\n\n在同行中，从学会照顾自己，到有能力照顾同行的人；从参与一次活动，到一起组织下一次出发。如果希望继续进阶，也可以通过系统训练与队伍选拔，加入川衡登山队。',
    teamDescription: '从日常活动到专业攀登，川衡登山队面向愿意持续训练、承担责任的同学。以雪山攀登、专业领队与攀冰为目标，我们希望在一次次准备和实践中，培养扎实的技术、彼此的信任与对山野的敬意。',
    teamTraining: '围绕体能与耐力、绳结与保护、路线规划、团队协作开展培养。通过系统训练、评估与选拔，为专业攀登做好准备。',
    teamAchievements: '',
    heroActivities: '/images/hiking.webp',
    heroAbout: '/images/forest.webp',
    heroTeam: '/images/alpine.webp',
    storyHiking: '/images/forest.webp',
    storyClimbing: '/images/alpine.webp',
    officialSignupUrl: '',
    officialQrImage: '',
    signupInstructions: '活动报名通过川衡官方公众号进行。公众号链接与二维码待协会补充，请以公众号最新推送中的要求为准。',
    contactEmail: '',
    contactWechat: '',
    contactName: '',
    growthSteps: [
      { title: '普通活动', description: '从一次徒步开始，认识伙伴，建立自己的户外节奏。' },
      { title: '系统训练', description: '持续参与训练，学习体能、基础技术与团队协作。' },
      { title: '队伍选拔', description: '依据训练表现与队伍要求，参加评估和选拔。' },
      { title: '专业攀登', description: '在充分准备和专业组织下，走向雪山与技术攀登。' },
    ],
  },
  activities: [
    { ...activityDefaults, id: 'demo-autumn-hike', title: '秋日山野徒步 · 示例', category: '轻松徒步', kind: 'upcoming', date: '2026-10-18', duration: '半日（演示参考）', timeCommitment: 'half-day', experience: 'relaxed', preparation: walkingPreparation, beginnerFriendly: '入门活动版式 · 要求待正式公布', summary: '把周末交给山野，在林间找回轻快的步调。活动安排为演示内容，正式信息待发布。', image: '/images/hiking.webp' },
    { ...activityDefaults, id: 'demo-rope-training', title: '绳结与基础训练 · 示例', category: '基础训练', kind: 'upcoming', date: '2026-10-25', duration: '约 2 小时（演示参考）', timeCommitment: 'half-day', experience: 'skills', preparation: skillsPreparation, summary: '从一根绳子开始，认识户外技术与伙伴协作。此为训练展示示例。', image: '/images/alpine.webp' },
    { ...activityDefaults, id: 'demo-november-trail', title: '山脊上的周末 · 示例', category: '轻松徒步', kind: 'upcoming', date: '2026-11-08', duration: '一日（演示参考）', timeCommitment: 'full-day', experience: 'scenic', preparation: walkingPreparation, summary: '把脚步放慢，把视野打开。此为十一月活动日历演示，路线和参与要求待正式发布。', image: '/images/hiking.webp' },
    { ...activityDefaults, id: 'demo-december-forest', title: '冬日林间慢行 · 示例', category: '森林徒步', kind: 'upcoming', date: '2026-12-06', duration: '半日（演示参考）', timeCommitment: 'half-day', experience: 'relaxed', preparation: walkingPreparation, summary: '留一个周末给林间的光与风。此为十二月活动日历演示，正式安排待发布。', image: '/images/forest.webp' },
    { ...activityDefaults, id: 'demo-january-training', title: '新年基础训练 · 示例', category: '基础训练', kind: 'upcoming', date: '2027-01-10', duration: '约 2 小时（演示参考）', timeCommitment: 'half-day', experience: 'skills', preparation: skillsPreparation, summary: '在一次练习中，为下一次出发做准备。此为一月训练日历演示，正式安排待发布。', image: '/images/alpine.webp' },
    { ...activityDefaults, id: 'demo-forest-walk', title: '森林里的慢行时光 · 示例', category: '森林徒步', kind: 'past', date: '2026-09-20', timeCommitment: 'half-day', experience: 'relaxed', preparation: walkingPreparation, album: forestAlbum, registrationStatus: '回顾版式示例', summary: '树影、山风和一起同行的伙伴。此内容为活动回顾版式示例，待替换真实记录。', image: '/images/forest.webp' },
    { ...activityDefaults, id: 'demo-climbing', title: '第一次攀岩体验 · 示例', category: '攀岩体验', kind: 'past', date: '2026-09-13', timeCommitment: 'half-day', experience: 'skills', preparation: skillsPreparation, album: climbingAlbum, registrationStatus: '回顾版式示例', summary: '在岩壁上找到新的支点，在伙伴间建立信任。此内容为活动回顾示例。', image: '/images/alpine.webp' },
  ],
  projects: cooperationProjects,
  cooperation: cooperationContent,
};
