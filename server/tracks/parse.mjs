import { XMLParser, XMLValidator } from 'fast-xml-parser';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_POINTS = 30000;
const MAX_SEGMENTS = 100;
const MAX_DEPTH = 64;
const EARTH_RADIUS_M = 6371008.8;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export class TrackError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'TrackError';
    this.code = code;
    this.status = status;
  }
}

const fail = (code, message, status) => { throw new TrackError(code, message, status); };
const validXmlCharacter = code => code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
const localName = name => name.split(':').at(-1);
const tag = node => Object.keys(node).find(key => key !== ':@' && !key.startsWith('#') && !key.startsWith('?'));
const children = node => node[tag(node)] || [];
const elements = node => children(node).filter(item => tag(item));
const named = (node, name) => elements(node).filter(item => localName(tag(item)) === name);
const cleanName = (value, maximum = 160) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);

function scalar(node) {
  if (elements(node).length) fail('INVALID_XML', '轨迹字段包含无效的嵌套结构。');
  return children(node).map(item => item['#text'] ?? item['#cdata'] ?? '').join('');
}

function field(node, name) {
  const matches = named(node, name);
  if (matches.length > 1) fail('INVALID_XML', '轨迹包含重复的单值字段。');
  return matches.length ? scalar(matches[0]).trim() : undefined;
}

function decodeInput(input) {
  let xml;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > MAX_BYTES) fail('FILE_TOO_LARGE', '轨迹文件不能超过 5 MiB。', 413);
    xml = input;
  } else if (input instanceof Uint8Array) {
    if (input.byteLength > MAX_BYTES) fail('FILE_TOO_LARGE', '轨迹文件不能超过 5 MiB。', 413);
    try { xml = new TextDecoder('utf-8', { fatal: true }).decode(input); }
    catch { fail('INVALID_XML', '轨迹文件必须使用有效的 UTF-8 编码。'); }
  } else fail('INVALID_INPUT', '请提供 GPX 或 KML 的 UTF-8 文件内容。');
  for (const character of xml) if (!validXmlCharacter(character.codePointAt(0))) fail('INVALID_XML', '轨迹包含 XML 不允许的字符。');
  return xml.replace(/^\uFEFF/, '');
}

function inspectXml(xml) {
  // Scan literals once. A lazy global comment regex can repeatedly scan a
  // hostile file containing many unterminated comment openers.
  const chunks = [];
  let literalPosition = 0;
  let chunkStart = 0;
  while ((literalPosition = xml.indexOf('<', literalPosition)) >= 0) {
    const marker = xml.startsWith('<!--', literalPosition) ? ['-->', 4] : xml.startsWith('<![CDATA[', literalPosition) ? [']]>', 9] : null;
    if (!marker) { literalPosition++; continue; }
    chunks.push(xml.slice(chunkStart, literalPosition));
    const end = xml.indexOf(marker[0], literalPosition + marker[1]);
    if (end < 0) fail('INVALID_XML', 'XML 注释或 CDATA 未正确结束。');
    literalPosition = end + marker[0].length;
    chunkStart = literalPosition;
  }
  chunks.push(xml.slice(chunkStart));
  const outsideLiterals = chunks.join('');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(outsideLiterals)) fail('UNSAFE_XML', '不接受含 DTD 或实体声明的轨迹文件。');
  const encoding = /^\s*<\?xml\b[^?]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(xml)?.[1];
  if (encoding && !/^utf-?8$/i.test(encoding)) fail('INVALID_XML', '轨迹文件必须使用 UTF-8 编码。');
  const unresolved = outsideLiterals.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, entity => {
    if (entity.startsWith('&#')) {
      const hexadecimal = entity.startsWith('&#x');
      const code = Number.parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
      if (!validXmlCharacter(code)) fail('INVALID_XML', '轨迹包含无效的字符引用。');
    }
    return '';
  });
  if (unresolved.includes('&')) fail('INVALID_XML', '轨迹包含未定义或无效的 XML 实体。');

  // Bound depth before the XML parser allocates its tree. Respect quoted >,
  // comments, CDATA and processing instructions instead of matching tag regexes.
  let position = 0;
  let roots = 0;
  const stack = [];
  while (position < xml.length) {
    const opening = xml.indexOf('<', position);
    const before = xml.slice(position, opening < 0 ? xml.length : opening);
    if (!stack.length && before.trim()) fail('INVALID_XML', 'XML 根元素之外存在无效内容。');
    if (opening < 0) break;
    const special = xml.startsWith('<!--', opening) ? ['-->', 4] : xml.startsWith('<![CDATA[', opening) ? [']]>', 9] : xml.startsWith('<?', opening) ? ['?>', 2] : null;
    if (special) {
      if (special[1] === 9 && !stack.length) fail('INVALID_XML', 'CDATA 不能出现在根元素之外。');
      const end = xml.indexOf(special[0], opening + special[1]);
      if (end < 0) fail('INVALID_XML', 'XML 注释或声明未正确结束。');
      position = end + special[0].length;
      continue;
    }
    let cursor = opening + 1;
    let quote = '';
    for (; cursor < xml.length; cursor++) {
      const character = xml[cursor];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (cursor >= xml.length) fail('INVALID_XML', 'XML 标签未正确结束。');
    const content = xml.slice(opening + 1, cursor);
    if (content.startsWith('/')) {
      const closing = /^\/([^\s/>]+)\s*$/.exec(content)?.[1];
      if (!closing || stack.pop() !== closing) fail('INVALID_XML', 'XML 标签不匹配。');
    } else {
      const name = /^([^\s/>!]+)(?:\s|\/?$)/.exec(content)?.[1];
      if (!name) fail('INVALID_XML', 'XML 标签结构无效。');
      if (!stack.length && ++roots > 1) fail('INVALID_XML', '轨迹 XML 必须只有一个根元素。');
      if (stack.length + 1 > MAX_DEPTH) fail('XML_TOO_DEEP', 'XML 嵌套不能超过 64 层。', 413);
      if (!/\/\s*$/.test(content)) stack.push(name);
    }
    position = cursor + 1;
  }
  if (stack.length || roots !== 1 || XMLValidator.validate(xml, { allowBooleanAttributes: false }) !== true) fail('INVALID_XML', '轨迹 XML 格式无效或不完整。');
}

function numeric(value, elevation = false) {
  const code = elevation ? 'INVALID_ELEVATION' : 'INVALID_COORDINATE';
  const message = elevation ? '轨迹海拔必须是有效的有限数字。' : '轨迹经纬度必须是有效数字，且经度在 ±180°、纬度在 ±90° 内。';
  if (typeof value !== 'string' || !NUMBER.test(value.trim())) fail(code, message);
  const number = Number(value);
  if (!Number.isFinite(number)) fail(code, message);
  return number;
}

function coordinate(lon, lat, elevation, absolute = true) {
  const longitude = numeric(lon);
  const latitude = numeric(lat);
  if (Math.abs(longitude) > 180 || Math.abs(latitude) > 90) fail('INVALID_COORDINATE', '轨迹经纬度超出允许范围。');
  const height = elevation === undefined || elevation.trim() === '' ? null : numeric(elevation, true);
  return [longitude, latitude, absolute ? height : null];
}

function haversine(a, b) {
  const radians = Math.PI / 180;
  const dLat = (b[1] - a[1]) * radians;
  const dLon = (((b[0] - a[0] + 540) % 360) - 180) * radians;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, Math.max(0, value))));
}

function calculateStats(points, distances) {
  const heights = points.map(point => point[2]).filter(value => value !== null);
  const complete = heights.length === points.length;
  let ascent = 0;
  let descent = 0;
  if (complete) for (let index = 1; index < points.length; index++) {
    const change = points[index][2] - points[index - 1][2];
    if (change > 0) ascent += change;
    else descent -= change;
  }
  if (!Number.isFinite(ascent) || !Number.isFinite(descent)) fail('INVALID_ELEVATION', '轨迹海拔差值超出可计算的数值范围。');
  return { distanceM: distances.at(-1) || 0, ascentM: complete ? ascent : null, descentM: complete ? descent : null, minElevationM: heights.length ? Math.min(...heights) : null, maxElevationM: heights.length ? Math.max(...heights) : null, elevationCoverage: heights.length / points.length };
}

/** Convert UTF-8 GPX/KML into unsimplified, disconnected line segments.
 * Time, speed, arbitrary XML metadata and links are deliberately not returned.
 * No external resources are resolved or downloaded.
 */
export function convertTrack(input, options = {}) {
  const xml = decodeInput(input);
  inspectXml(xml);
  let parsed;
  try {
    parsed = new XMLParser({
      preserveOrder: true, ignoreAttributes: false, parseTagValue: false,
      parseAttributeValue: false, trimValues: false, ignoreDeclaration: true,
      ignorePiTags: true, maxNestedTags: MAX_DEPTH,
      processEntities: { enabled: true, maxExpandedLength: MAX_BYTES, maxTotalExpansions: MAX_BYTES },
      // Enable numeric references and only XML's five predefined named entities.
      // inspectXml has already rejected DTDs and all other named references.
      htmlEntities: { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" },
    }).parse(xml);
  } catch { fail('INVALID_XML', '无法解析轨迹 XML。'); }
  const root = parsed.find(node => tag(node));
  const format = root && localName(tag(root));
  if (format !== 'gpx' && format !== 'kml') fail('UNSUPPORTED_FORMAT', '仅支持 GPX 或 KML 线轨迹文件。', 415);
  const sourceFile = cleanName(typeof options?.filename === 'string' ? options.filename.split(/[\\/]/).at(-1) : `track.${format}`, 200) || `track.${format}`;
  const fallbackName = cleanName(sourceFile.replace(/\.[^.]*$/, '')) || '未命名轨迹';
  let name = '';
  let pointCount = 0;
  let geometryCount = 0;
  const rawSegments = [];
  const warnings = new Set();
  const countGeometry = () => { if (++geometryCount > MAX_SEGMENTS) fail('TOO_MANY_SEGMENTS', '轨迹不能超过 100 个分段。', 413); };
  const addPoint = point => { if (++pointCount > MAX_POINTS) fail('TOO_MANY_POINTS', '轨迹不能超过 30000 个点。', 413); return point; };
  const addSegment = (points, segmentName) => {
    if (!points.length) return;
    if (rawSegments.length >= MAX_SEGMENTS) fail('TOO_MANY_SEGMENTS', '轨迹不能超过 100 个分段。', 413);
    rawSegments.push({ points, name: cleanName(segmentName) });
  };

  if (format === 'gpx') {
    const tracks = named(root, 'trk');
    const hasTrackPoints = tracks.some(track => named(track, 'trkseg').some(segment => named(segment, 'trkpt').length));
    const sources = hasTrackPoints ? tracks : named(root, 'rte');
    name = cleanName(sources.map(item => field(item, 'name')).find(Boolean) || field(named(root, 'metadata')[0] || { metadata: [] }, 'name'));
    for (const source of sources) {
      const segments = hasTrackPoints ? named(source, 'trkseg') : [source];
      for (const segment of segments) {
        countGeometry();
        const points = named(segment, hasTrackPoints ? 'trkpt' : 'rtept').map(item => {
          const attrs = item[':@'] || {};
          const attribute = attributeName => Object.entries(attrs).find(([key]) => localName(key.replace(/^@_/, '')) === attributeName)?.[1];
          return addPoint(coordinate(attribute('lon'), attribute('lat'), field(item, 'ele')));
        });
        addSegment(points, field(source, 'name'));
      }
    }
  } else {
    const modeOf = node => field(node, 'altitudeMode');
    const parseGeometry = (node, context, isTrack) => {
      countGeometry();
      const altitudeMode = modeOf(node) ?? context.mode;
      // Some GPS exporters omit the display mode but retain recorded heights.
      // Keep supplied heights in that case; explicit relative/clamped modes win.
      const readElevation = altitudeMode === undefined || altitudeMode === 'absolute';
      if (!readElevation) warnings.add('KML 未使用 absolute 海拔模式；高度未当作绝对海拔，已保留为空。');
      let current = [];
      const flush = () => { addSegment(current, context.name); current = []; };
      const tuple = (value, gx) => {
        if (!value.trim() || (!gx && /^,+$/.test(value.trim()))) { flush(); return; }
        const values = gx ? value.trim().split(/\s+/) : value.trim().split(',');
        if (values.length < 2 || values.length > 3) fail('INVALID_COORDINATE', 'KML 坐标必须是经度、纬度与可选海拔。');
        const point = coordinate(values[0], values[1], values[2], readElevation);
        if (altitudeMode === undefined && point[2] !== null) warnings.add('KML 未声明海拔模式；已按文件提供的高度值兼容读取海拔，未进行高程校正。');
        current.push(addPoint(point));
      };
      if (isTrack) for (const item of named(node, 'coord')) tuple(scalar(item), true);
      else for (const item of named(node, 'coordinates')) {
        const lines = scalar(item).trim().split(/\r\n|\n|\r/);
        for (const line of lines) {
          if (!line.trim()) flush();
          else for (const value of line.trim().split(/\s+/)) tuple(value, false);
        }
        flush();
      }
      flush();
    };
    const visit = (node, context = {}) => {
      const kind = localName(tag(node));
      if (kind === 'LineString' || kind === 'Track') return parseGeometry(node, context, kind === 'Track');
      if (!['kml', 'Document', 'Folder', 'Placemark', 'MultiGeometry', 'MultiTrack'].includes(kind)) return;
      const ownName = cleanName(field(node, 'name'));
      if (!name && ownName && ['Document', 'Placemark'].includes(kind)) name = ownName;
      const next = { name: kind === 'Placemark' ? ownName : context.name, mode: kind === 'MultiTrack' ? modeOf(node) : context.mode };
      for (const item of elements(node)) visit(item, next);
    };
    visit(root);
  }

  const usable = rawSegments.filter(segment => segment.points.length >= 2);
  if (usable.length !== rawSegments.length) warnings.add('已忽略断点附近不足两个点的孤立片段，未将其连接到其他分段。');
  if (!usable.length) fail('EMPTY_TRACK', '没有可用的线轨迹；每段至少需要两个有效坐标。');
  const profile = [];
  const segments = [];
  const coordinates = [];
  const allPoints = [];
  let totalDistance = 0;
  for (const [index, segment] of usable.entries()) {
    const distances = [0];
    for (let pointIndex = 1; pointIndex < segment.points.length; pointIndex++) distances.push(distances.at(-1) + haversine(segment.points[pointIndex - 1], segment.points[pointIndex]));
    const stats = calculateStats(segment.points, distances);
    segments.push({ index, name: segment.name || `第 ${index + 1} 段`, pointCount: segment.points.length, stats });
    for (const [pointIndex, point] of segment.points.entries()) {
      profile.push({ segment: index, distanceM: totalDistance + distances[pointIndex], segmentDistanceM: distances[pointIndex], elevationM: point[2], lon: point[0], lat: point[1] });
      allPoints.push(point);
    }
    coordinates.push(segment.points);
    totalDistance += stats.distanceM;
  }
  const knownHeights = allPoints.filter(point => point[2] !== null).map(point => point[2]);
  const complete = knownHeights.length === allPoints.length;
  if (!knownHeights.length) warnings.add('轨迹缺失有效绝对海拔；海拔与累计爬升、下降统计不可用。');
  else if (!complete) warnings.add('部分轨迹点缺失海拔；总爬升和下降保留为空，仅显示已有海拔的范围。');
  else warnings.add('累计爬升、下降为原始海拔逐点差值，未进行平滑或高程校正。');
  const stats = { distanceM: totalDistance, ascentM: complete ? segments.reduce((sum, segment) => sum + segment.stats.ascentM, 0) : null, descentM: complete ? segments.reduce((sum, segment) => sum + segment.stats.descentM, 0) : null, minElevationM: knownHeights.length ? Math.min(...knownHeights) : null, maxElevationM: knownHeights.length ? Math.max(...knownHeights) : null, elevationCoverage: knownHeights.length / allPoints.length };
  if ((stats.ascentM !== null && !Number.isFinite(stats.ascentM)) || (stats.descentM !== null && !Number.isFinite(stats.descentM))) fail('INVALID_ELEVATION', '累计海拔差值超出可计算的数值范围。');
  return { version: 1, name: name || fallbackName, format, sourceFile, pointCount: allPoints.length, segmentCount: usable.length, bounds: [Math.min(...allPoints.map(point => point[0])), Math.min(...allPoints.map(point => point[1])), Math.max(...allPoints.map(point => point[0])), Math.max(...allPoints.map(point => point[1]))], geojson: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates } }, profile, segments, stats, warnings: [...warnings] };
}
