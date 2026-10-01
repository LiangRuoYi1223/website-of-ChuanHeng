export const initialSettings = {
  logoUrl: '', demoMode: true,
  clubName: '川衡登山协会', school: '南方科技大学', founded: '2018',
  intro: '从校园走向山野，和一群愿意出发的人，一起看见更大的世界。',
  aboutDescription: '川衡登山协会成立于 2018 年，是南方科技大学的学生组织。我们以徒步、登山与户外运动为纽带，让同学们在自然中相遇，在共同的行程中建立连接。不论你是第一次走进山野，还是想继续探索新的路线，都可以从一次同行开始，找到自己的节奏。',
  teamDescription: '从日常活动到专业攀登，川衡登山队面向愿意持续训练、承担责任的同学。以雪山攀登、专业领队与攀冰为目标，我们希望在一次次准备和实践中，培养扎实的技术、彼此的信任与对山野的敬意。',
  teamTraining: '围绕体能与耐力、绳结与保护、路线规划、团队协作开展培养。通过系统训练、评估与选拔，为专业攀登做好准备。',
  teamAchievements: '',
  heroActivities: '/images/hiking.webp', heroAbout: '/images/forest.webp', heroTeam: '/images/alpine.webp',
  storyHiking: '/images/forest.webp', storyClimbing: '/images/alpine.webp',
  officialSignupUrl: '', officialQrImage: '',
  signupInstructions: '活动报名通过川衡官方公众号进行。公众号链接与二维码待协会补充，请以公众号最新推送中的要求为准。',
  contactEmail: '', contactWechat: '', contactName: '',
  growthSteps: [
    { title: '普通活动', description: '从一次徒步开始，认识伙伴，建立自己的户外节奏。' },
    { title: '系统训练', description: '持续参与训练，学习体能、基础技术与团队协作。' },
    { title: '队伍选拔', description: '依据训练表现与队伍要求，参加评估和选拔。' },
    { title: '专业攀登', description: '在充分准备和专业组织下，走向雪山与技术攀登。' },
  ],
};

const activityDefaults = {
  location: '路线待实际发布', difficulty: '以正式公告为准',
  description: '此内容为活动示例，并非已举办或已开放报名的真实活动。正式活动的路线、参与条件、装备要求与报名安排，请以协会公众号最新公告为准。',
  signupUrl: '', qrImage: '', status: 'published', isDemo: true,
};

export const initialActivities = [
  { ...activityDefaults, id: 'demo-autumn-hike', title: '秋日山野徒步 · 示例', category: '轻松徒步', kind: 'upcoming', date: '2026-10-18', summary: '把周末交给山野，在林间找回轻快的步调。活动安排为演示内容，正式信息待发布。', image: '/images/hiking.webp' },
  { ...activityDefaults, id: 'demo-rope-training', title: '绳结与基础训练 · 示例', category: '基础训练', kind: 'upcoming', date: '2026-10-25', summary: '从一根绳子开始，认识户外技术与伙伴协作。此为训练展示示例。', image: '/images/alpine.webp' },
  { ...activityDefaults, id: 'demo-forest-walk', title: '森林里的慢行时光 · 示例', category: '森林徒步', kind: 'past', date: '2026-09-20', summary: '树影、山风和一起同行的伙伴。此内容为活动回顾版式示例，待替换真实记录。', image: '/images/forest.webp' },
  { ...activityDefaults, id: 'demo-climbing', title: '第一次攀岩体验 · 示例', category: '攀岩体验', kind: 'past', date: '2026-09-13', summary: '在岩壁上找到新的支点，在伙伴间建立信任。此内容为活动回顾示例。', image: '/images/alpine.webp' },
];
