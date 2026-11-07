import {useId, useRef} from 'react';
import {ArrowDown, ArrowUp, Plus, Trash2} from 'lucide-react';

const MAX_ITEMS = 50;

function TextField({label, name, value, onChange, disabled, multiline = false, maxLength = 120, rows = 3, placeholder}) {
  const props = {name: `pageContent.${name}`, value, disabled, maxLength, placeholder, onChange: event => onChange(event.target.value)};
  return <label>{label}{multiline ? <textarea {...props} rows={rows} /> : <input {...props} type="text" />}</label>;
}

function EditableList({items, onChange, kind, addLabel, createItem, disabled, children}) {
  const prefix = useId();
  const serial = useRef(0);
  const keys = useRef([]);
  // Keys belong to the editing session, not the published activity payload.
  // Moving or deleting an item carries its key with it so input nodes retain identity.
  while (keys.current.length < items.length) keys.current.push(`${prefix}-${serial.current++}`);
  if (keys.current.length > items.length) keys.current = keys.current.slice(0, items.length);

  function move(index, offset) {
    const destination = index + offset;
    if (disabled || destination < 0 || destination >= items.length) return;
    const next = [...items];
    [next[index], next[destination]] = [next[destination], next[index]];
    const nextKeys = [...keys.current];
    [nextKeys[index], nextKeys[destination]] = [nextKeys[destination], nextKeys[index]];
    keys.current = nextKeys;
    onChange(next);
  }
  function remove(index) {
    if (disabled) return;
    keys.current = keys.current.filter((_, itemIndex) => itemIndex !== index);
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  }
  function add() {
    if (disabled || items.length >= MAX_ITEMS) return;
    keys.current.push(`${prefix}-${serial.current++}`);
    onChange([...items, createItem()]);
  }
  function edit(index, value) {
    if (disabled) return;
    onChange(items.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  return <div className="activity-editor-list">
    {!items.length && <p className="activity-editor-empty">暂无{kind}内容，点击下方按钮添加。</p>}
    {items.map((item, index) => <div className="activity-editor-item" role="group" aria-label={`${kind}第${index + 1}项`} key={keys.current[index]}>
      <div className="activity-editor-item-heading"><h3>{kind}第{index + 1}项</h3><div className="activity-editor-item-actions">
        <button type="button" aria-label={`上移${kind}第${index + 1}项`} title="上移" disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} aria-hidden="true" /></button>
        <button type="button" aria-label={`下移${kind}第${index + 1}项`} title="下移" disabled={disabled || index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} aria-hidden="true" /></button>
        <button type="button" className="danger" aria-label={`删除${kind}第${index + 1}项`} title="删除此项" disabled={disabled} onClick={() => remove(index)}><Trash2 size={15} aria-hidden="true" /></button>
      </div></div>
      {children(item, index, value => edit(index, value))}
    </div>)}
    <div className="activity-editor-list-footer"><button type="button" className="admin-btn activity-editor-add" disabled={disabled || items.length >= MAX_ITEMS} onClick={add}><Plus size={15} aria-hidden="true" />{addLabel}</button><span className="activity-editor-list-count">{items.length} / {MAX_ITEMS} 项{items.length >= MAX_ITEMS ? '，已达上限' : ''}</span></div>
  </div>;
}

/** Controlled public-page copy. The parent owns persistence and the preview. */
export default function ActivityContentFields({value, onChange, disabled = false}) {
  function setField(section, field, next) {
    if (disabled) return;
    onChange({...value, [section]: {...value[section], [field]: next}});
  }
  const field = (section, key, label, options = {}) => <TextField label={label} name={`${section}.${key}`} value={value[section][key]} onChange={next => setField(section, key, next)} disabled={disabled} {...options} />;

  return <div className="activity-content-fields">
    <input type="hidden" name="pageContent" value={JSON.stringify(value)} />
    <section id="editor-overview" className="activity-editor-section">
      <div className="activity-editor-section-heading"><h2>活动介绍</h2><p>编辑活动正文和资料提示，内容会同步显示在右侧预览。</p></div>
      {field('overview', 'title', '介绍标题')}
      {field('overview', 'body', '介绍正文', {multiline: true, maxLength: 6000, rows: 5, placeholder: '介绍活动特色、参与方式和需要了解的信息'})}
      {field('overview', 'noteTitle', '资料提示标题')}
      {field('overview', 'noteBody', '资料提示内容', {multiline: true, maxLength: 6000, rows: 4, placeholder: '填写领队、集合方式、费用和保障说明等已核实信息'})}
    </section>
    <section id="editor-itinerary" className="activity-editor-section">
      <div className="activity-editor-section-heading"><h2>行程安排</h2><p>按顺序添加行程，可随时调整或删除。</p></div>
      {field('itinerary', 'title', '行程标题')}
      {field('itinerary', 'intro', '行程说明', {multiline: true, maxLength: 6000})}
      <EditableList items={value.itinerary.items} onChange={next => setField('itinerary', 'items', next)} kind="行程" addLabel="添加行程项" createItem={() => ({time: '', title: '', description: ''})} disabled={disabled}>
        {(item, index, update) => <>
          <div className="admin-field-grid"><TextField label="时间或阶段" name={`itinerary.items.${index}.time`} value={item.time} onChange={next => update({...item, time: next})} disabled={disabled} placeholder="例如：08:00 或行前" /><TextField label="行程小标题" name={`itinerary.items.${index}.title`} value={item.title} onChange={next => update({...item, title: next})} disabled={disabled} placeholder="例如：集合与检查" /></div>
          <TextField label="行程内容" name={`itinerary.items.${index}.description`} value={item.description} onChange={next => update({...item, description: next})} disabled={disabled} multiline maxLength={3000} />
        </>}
      </EditableList>
    </section>
    <section id="editor-equipment" className="activity-editor-section">
      <div className="activity-editor-section-heading"><h2>装备建议</h2><p>每个模块展示一类装备，按活动需要增减。</p></div>
      {field('equipment', 'title', '装备标题')}
      {field('equipment', 'intro', '装备说明', {multiline: true, maxLength: 6000})}
      <EditableList items={value.equipment.items} onChange={next => setField('equipment', 'items', next)} kind="装备" addLabel="添加装备模块" createItem={() => ({title: '', description: ''})} disabled={disabled}>
        {(item, index, update) => <>
          <TextField label="模块标题" name={`equipment.items.${index}.title`} value={item.title} onChange={next => update({...item, title: next})} disabled={disabled} placeholder="例如：穿着与防护" />
          <TextField label="装备清单或建议" name={`equipment.items.${index}.description`} value={item.description} onChange={next => update({...item, description: next})} disabled={disabled} multiline maxLength={3000} />
        </>}
      </EditableList>
    </section>
    <section id="editor-safety" className="activity-editor-section">
      <div className="activity-editor-section-heading"><h2>安全须知</h2><p>逐条填写活动安全要求，标题和补充说明也可以修改。</p></div>
      {field('safety', 'title', '安全标题')}
      <EditableList items={value.safety.items} onChange={next => setField('safety', 'items', next)} kind="安全" addLabel="添加安全条目" createItem={() => ''} disabled={disabled}>
        {(item, index, update) => <TextField label="安全条目内容" name={`safety.items.${index}`} value={item} onChange={update} disabled={disabled} multiline maxLength={3000} />}
      </EditableList>
      {field('safety', 'outro', '安全补充说明', {multiline: true, maxLength: 6000})}
    </section>
  </div>;
}
