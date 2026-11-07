const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value, fallback) => typeof value === 'string' ? value : fallback;

// Defaults preserve the existing page for activities created before page editing existed.
// Explicit empty strings and arrays are intentional removals, never a request for defaults.
export function readActivityPageContent(activity = {}) {
  const page = object(activity.pageContent);
  const overview = object(page.overview);
  const itinerary = object(page.itinerary);
  const equipment = object(page.equipment);
  const safety = object(page.safety);
  return {
    overview: {
      title: text(overview.title, '走进这段山野'),
      body: text(overview.body, '把脚步放慢，去留意一条山脊的延伸、一片森林的呼吸，以及同行伙伴之间自然生长的默契。川衡倡导有准备、有边界的山野探索。'),
      noteTitle: text(overview.noteTitle, activity.isDemo ? '这里展示的是活动页面示例' : '活动资料与轨迹'),
      noteBody: text(overview.noteBody, `${activity.isDemo ? '当前日期、地点与活动参数用于界面演示，尚未发布可报名的正式行程。' : '活动使用所选路线的历史轨迹版本，地图与海拔根据原始文件生成。'}领队、集合方式、费用及保障方案需由协会核实并另行公布。`),
    },
    itinerary: {
      title: text(itinerary.title, '行程安排'),
      intro: text(itinerary.intro, '以下为准备流程示例，不构成实际带队行程或导航依据。'),
      items: (Array.isArray(itinerary.items) ? itinerary.items : [
        { time: '行前', title: '充分准备', description: '了解活动要求，评估体能与装备，确认天气、交通及撤退方案。' },
        { time: '出发', title: '集合与检查', description: '正式活动应由领队完成签到、装备检查和安全说明，确认同行伙伴状态。' },
        { time: '途中', title: '在山野中同行', description: '依照正式路线和队伍节奏行进，及时补水补给，尊重环境并关注彼此。' },
        { time: '归来', title: '完成与回顾', description: '确认全员安全返回，整理装备与垃圾，共同回顾这一次出发。' },
      ]).map(item => ({ time: text(item?.time, ''), title: text(item?.title, ''), description: text(item?.description, '') })),
    },
    equipment: {
      title: text(equipment.title, '装备建议'),
      intro: text(equipment.intro, '装备需求随海拔、季节、天气和技术条件变化。以下仅作通用准备提示，请以正式活动装备清单为准。'),
      items: (Array.isArray(equipment.items) ? equipment.items : [
        { title: '穿着与防护', description: '合脚徒步鞋、分层衣物、防风防雨外层、遮阳与防晒用品。' },
        { title: '补给与照明', description: '适量饮水与食物、备用能量补给、头灯及备用电源。' },
        { title: '应急与通信', description: '个人常用药、保温用品、离线地图与通信设备。' },
      ]).map(item => ({ title: text(item?.title, ''), description: text(item?.description, '') })),
    },
    safety: {
      title: text(safety.title, '安全，是每次出发的前提'),
      items: (Array.isArray(safety.items) ? safety.items : [
        '如实评估健康与体能状况，主动告知领队可能影响参与的情况。',
        '尊重天气与山地环境的变化，必要时调整计划或及时撤退。',
        '遵循正式活动的领队安排，不擅自离队，不冒险追赶进度。',
        '带走所有垃圾，减少对野生动植物和当地社区的干扰。',
      ]).map(item => text(item, '')),
      outro: text(safety.outro, '本页不替代专业培训、实际风险评估及正式活动说明。'),
    },
  };
}

function validateText(value, limit, label) {
  if (typeof value !== 'string') throw new Error(`${label}必须是文字。`);
  if (value.length > limit) throw new Error(`${label}最多 ${limit} 字。`);
}

export function parseActivityPageContent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('活动页面内容格式无效，请重新打开编辑页。');
  const definitions = {
    overview: { label: '活动介绍', fields: { title: 120, body: 6000, noteTitle: 120, noteBody: 6000 } },
    itinerary: { label: '行程安排', fields: { title: 120, intro: 6000 }, itemFields: { time: 120, title: 120, description: 3000 } },
    equipment: { label: '装备建议', fields: { title: 120, intro: 6000 }, itemFields: { title: 120, description: 3000 } },
    safety: { label: '安全须知', fields: { title: 120, outro: 6000 }, itemText: true },
  };
  for (const [key, definition] of Object.entries(definitions)) {
    if (!Object.hasOwn(value, key)) continue;
    const section = value[key];
    if (!section || typeof section !== 'object' || Array.isArray(section)) throw new Error(`${definition.label}内容格式无效。`);
    for (const [field, limit] of Object.entries(definition.fields)) if (Object.hasOwn(section, field)) validateText(section[field], limit, definition.label);
    if (!definition.itemFields && !definition.itemText || !Object.hasOwn(section, 'items')) continue;
    if (!Array.isArray(section.items)) throw new Error(`${definition.label}须为条目列表。`);
    if (section.items.length > 50) throw new Error(`${definition.label}最多添加 50 项。`);
    for (const item of section.items) {
      if (definition.itemText) validateText(item, 3000, definition.label);
      else {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${definition.label}条目格式无效。`);
        for (const [field, limit] of Object.entries(definition.itemFields)) if (Object.hasOwn(item, field)) validateText(item[field], limit, definition.label);
      }
    }
  }
  return readActivityPageContent({ pageContent: value });
}
