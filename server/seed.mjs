// Node.js 24 strips the type annotations. Public pages and fresh databases share one source.
import { demoContent } from '../src/demo-content.ts';

export const initialSettings = demoContent.settings;
export const initialActivities = demoContent.activities.map(activity => ({ ...activity, registrationOpen: false }));
export const initialProjects = demoContent.projects;
export const initialCooperation = demoContent.cooperation;

export const legacyActivityIds = ['demo-autumn-hike', 'demo-rope-training', 'demo-forest-walk', 'demo-climbing'];
export const legacyAboutDescription = '川衡登山协会成立于 2018 年，是南方科技大学的学生组织。我们以徒步、登山与户外运动为纽带，让同学们在自然中相遇，在共同的行程中建立连接。不论你是第一次走进山野，还是想继续探索新的路线，都可以从一次同行开始，找到自己的节奏。';
