export interface FootprintPoint {
  id: string;
  city: string;
  region: string;
  provinceCode: string;
  longitude: number;
  latitude: number;
  activityKind: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  labelOffset: [number, number];
  isDemo: boolean;
}

// Location examples only. These are NOT the association's completed outings.
// Keep the location, copy, image and demonstration flag together when replacing.
export const footprintPoints: FootprintPoint[] = [
  {
    id: 'location-example-shenzhen', city: '深圳', region: '广东 · 深圳', provinceCode: '440000',
    longitude: 114.0579, latitude: 22.5431, activityKind: '森林徒步 · 类型示例',
    title: '从城市到山野的呈现方式',
    description: '这里演示一个城市周边的徒步地点如何呈现在地图上。真实路线、日期和同行记录，等待协会资料补充。',
    image: '/images/forest.webp', imageAlt: '金绿森林小径的 AI 示意配图，不是深圳活动实拍',
    labelOffset: [19, 34], isDemo: true,
  },
  {
    id: 'location-example-shaoguan', city: '韶关', region: '广东 · 韶关', provinceCode: '440000',
    longitude: 113.5972, latitude: 24.8104, activityKind: '山地徒步 · 类型示例',
    title: '一段山路的呈现方式',
    description: '这里演示山地徒步记录的展示方式。地图位置、故事与配图相互联动，尚未对应任何协会真实行程。',
    image: '/images/hiking.webp', imageAlt: '青绿山脊的 AI 示意配图，不是韶关活动实拍',
    labelOffset: [20, -7], isDemo: true,
  },
  {
    id: 'location-example-guilin', city: '桂林', region: '广西 · 桂林', provinceCode: '450000',
    longitude: 110.2902, latitude: 25.2736, activityKind: '自然探索 · 类型示例',
    title: '自然探索的呈现方式',
    description: '这里演示一条自然探索足迹如何被整理。地点只是交互示例，路线记录与真实影像将在资料齐备后替换。',
    image: '/images/forest.webp', imageAlt: '森林同伴的 AI 示意配图，不是桂林活动实拍',
    labelOffset: [-23, -17], isDemo: true,
  },
  {
    id: 'location-example-chengdu', city: '成都', region: '四川 · 成都', provinceCode: '510000',
    longitude: 104.0665, latitude: 30.5723, activityKind: '户外探索 · 类型示例',
    title: '更远的出发地，如何被记录',
    description: '这里演示不同地区的地点切换，展示未来足迹页面的组织方式。它不代表协会已在成都开展活动或完成攀登。',
    image: '/images/hiking.webp', imageAlt: '山地晨光的 AI 示意配图，不是成都活动实拍',
    labelOffset: [-19, -18], isDemo: true,
  },
];
