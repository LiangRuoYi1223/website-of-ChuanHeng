import assert from 'node:assert/strict';
import test from 'node:test';
import { parseActivityPageContent, readActivityPageContent } from '../src/activities/page-content.js';

test('legacy activities retain the existing default copy without modifying the source', () => {
  const activity = { title: '旧活动', description: '原有简介', routeSnapshot: { distance: 12 } };
  const before = structuredClone(activity);
  const content = readActivityPageContent(activity);
  assert.equal(content.overview.title, '走进这段山野');
  assert.equal(content.overview.noteTitle, '活动资料与轨迹');
  assert.equal(content.itinerary.items.length, 4);
  assert.equal(content.equipment.items.length, 3);
  assert.equal(content.safety.items.length, 4);
  assert.deepEqual(activity, before);
  assert.equal(readActivityPageContent({ isDemo: true }).overview.noteTitle, '这里展示的是活动页面示例');
});

test('explicitly removed copy and all empty lists survive normalization and parsing', () => {
  const pageContent = { overview: { title: '', body: '', noteTitle: '', noteBody: '' }, itinerary: { title: '当日行程', intro: '', items: [] }, equipment: { items: [] }, safety: { items: [], outro: '' } };
  const content = readActivityPageContent({ pageContent });
  assert.equal(content.overview.body, '');
  assert.equal(content.overview.title, '');
  assert.equal(content.itinerary.intro, '');
  assert.deepEqual(content.itinerary.items, []);
  assert.deepEqual(content.equipment.items, []);
  assert.deepEqual(content.safety.items, []);
  assert.equal(content.safety.outro, '');
  assert.deepEqual(parseActivityPageContent(content), content);
});

test('custom page content preserves multiline text, duplicate titles, and chosen item order', () => {
  const pageContent = { overview: { title: '本次活动', body: '第一段\n第二段' }, itinerary: { items: [{ time: '09:00', title: '集合', description: '南门' }, { time: '10:00', title: '集合', description: '补给点' }] }, equipment: { items: [{ title: '个人装备', description: '头灯' }] }, safety: { items: ['请听从领队安排', '请查看撤退说明'] } };
  const content = readActivityPageContent({ pageContent });
  assert.equal(content.overview.body, '第一段\n第二段');
  assert.deepEqual(content.itinerary.items, pageContent.itinerary.items);
  assert.deepEqual(content.equipment.items, pageContent.equipment.items);
  assert.deepEqual(content.safety.items, pageContent.safety.items);
  content.itinerary.items[0].title = '修改';
  content.equipment.items.push({ title: '额外', description: '' });
  assert.equal(pageContent.itinerary.items[0].title, '集合');
  assert.equal(pageContent.equipment.items.length, 1);
  assert.equal(readActivityPageContent({}).equipment.items.length, 3);
});

test('saving validates bounds and refuses malformed content instead of silently dropping it', () => {
  const valid = readActivityPageContent({});
  assert.throws(() => parseActivityPageContent(null), /页面内容/);
  assert.throws(() => parseActivityPageContent({ ...valid, safety: { ...valid.safety, items: 'invalid' } }), /安全/);
  assert.throws(() => parseActivityPageContent({ ...valid, itinerary: { ...valid.itinerary, items: Array.from({ length: 51 }, () => ({ time: '', title: '', description: '' })) } }), /50/);
  assert.throws(() => parseActivityPageContent({ ...valid, overview: { ...valid.overview, title: '山'.repeat(121) } }), /120/);
  assert.throws(() => parseActivityPageContent({ ...valid, overview: { ...valid.overview, body: '山'.repeat(6001) } }), /6000/);
  assert.throws(() => parseActivityPageContent({ ...valid, equipment: { ...valid.equipment, items: [{ title: '装备', description: '山'.repeat(3001) }] } }), /3000/);
  assert.throws(() => parseActivityPageContent({ ...valid, safety: { ...valid.safety, items: [null] } }), /安全/);
});
