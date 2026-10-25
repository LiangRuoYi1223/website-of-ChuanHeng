import type { SiteSettings } from '../types';

export const chapterBackgroundGroups = [
  {
    id: 'activities',
    title: '活动与足迹',
    chapters: [
      { id: 'departure', title: '向山而行', fallback: 'heroActivities' },
      { id: 'semester-calendar', title: '学期日历', fallback: 'storyHiking' },
      { id: 'calendar', title: '活动预告', fallback: 'heroActivities' },
      { id: 'past-adventures', title: '活动回顾', fallback: 'storyHiking' },
      { id: 'trail-album', title: '山野相册', fallback: 'storyClimbing' },
      { id: 'footprints', title: '足迹地图', fallback: 'heroActivities' },
      { id: 'outdoors-story', title: '同行故事', fallback: 'storyHiking' },
      { id: 'join', title: '一起出发', fallback: 'heroActivities' },
      { id: 'explore', title: '继续探索', fallback: 'heroTeam' },
    ],
  },
  {
    id: 'about',
    title: '认识川衡',
    chapters: [
      { id: 'about-introduction', title: '山野之间', fallback: 'heroAbout' },
      { id: 'about-us', title: '我们是川衡', fallback: 'heroActivities' },
      { id: 'first-departure', title: '第一次出发', fallback: 'storyHiking' },
      { id: 'growth-journey', title: '一起成长', fallback: 'heroActivities' },
      { id: 'team-preview', title: '走得更远', fallback: 'heroTeam' },
      { id: 'join', title: '加入川衡', fallback: 'heroAbout' },
      { id: 'explore', title: '继续探索', fallback: 'heroActivities' },
    ],
  },
] as const;

export type ChapterBackgroundGroup = (typeof chapterBackgroundGroups)[number]['id'];

export function resolveChapterBackground(
  settings: SiteSettings,
  group: ChapterBackgroundGroup,
  chapterId: string,
): string {
  const chapter = chapterBackgroundGroups
    .find((item) => item.id === group)
    ?.chapters.find((item) => item.id === chapterId);
  if (!chapter) return '';
  return settings.chapterBackgrounds?.[group]?.[chapterId]?.trim() || settings[chapter.fallback];
}
