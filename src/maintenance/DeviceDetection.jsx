import React, { useId, useState } from 'react';
import { Activity, Archive, CalendarClock, Cpu, Database, Files, Globe, HardDrive, LockKeyhole, MemoryStick, Network, Server, ShieldCheck, Thermometer } from 'lucide-react';
import './device-detection.css';
import DeviceTrendChart, { TREND_METRICS } from './DeviceTrendChart.jsx';

const detectionItems = [
  { id: 'cpu', icon: Cpu, title: 'CPU 使用情况', detail: '处理器负载与运行时间' },
  { id: 'memory', icon: MemoryStick, title: '内存使用情况', detail: '已用内存与可用内存' },
  { id: 'temperature', icon: Thermometer, title: '设备温度', detail: '处理器与硬盘温度' },
  { id: 'disk-space', icon: HardDrive, title: '硬盘空间', detail: '总容量、剩余空间与增长情况' },
  { id: 'disk-health', icon: ShieldCheck, title: '硬盘健康', detail: '健康信息与读写异常' },
  { id: 'internet', icon: Network, title: '外网连通', detail: '出口连接、延迟与断线情况' },
  { id: 'public-entry', icon: Globe, title: '公网入口', detail: '域名解析、证书与外部访问' },
  { id: 'website', icon: Activity, title: '网站访问', detail: '页面与关键接口的可用性' },
  { id: 'login', icon: LockKeyhole, title: '登录服务', detail: '登录与会话校验' },
  { id: 'database', icon: Database, title: '数据库', detail: '连接、读写与服务状态' },
  { id: 'files', icon: Files, title: '文件处理', detail: '图片处理、上传与下载' },
  { id: 'backup', icon: Archive, title: '备份状态', detail: '数据库、文件与异地副本' },
  { id: 'cleanup', icon: ShieldCheck, title: '敏感资料清理', detail: '到期访问锁定与清理核验' },
];

const frequencies = [
  { id: 'activity', label: '每场活动' },
  { id: 'monthly', label: '每月' },
  { id: 'as-needed', label: '不定期' },
];

const maintenancePlan = [
  {
    frequency: 'activity', title: '活动前检查与结束后清理',
    tasks: [
      { title: '检查关键业务', description: '报名开放及活动开始前，核对网站访问、登录、报名、数据库读写和文件处理是否可用。' },
      { title: '核对业务备份', description: '活动重要操作前后，核对数据库、文件备份和异地副本的最近成功时间；只保留在本机不算异地备份。' },
      { title: '到期锁定与定时清理', description: '活动结束立即阻止敏感资料读写；每 3 分钟调度清理身份证、活动手机号和全部缴费图片，覆盖历史及未关联图片。' },
      { title: '确认两轮空核验', description: '连续两轮空核验，实际间隔至少 180 秒，才可停止；保留失败重试。迁移到本地设备时沿用这些规则。' },
    ],
  },
  {
    frequency: 'monthly', title: '系统维护与恢复演练',
    tasks: [
      { title: '更新系统与检查权限', description: '安排系统和软件更新，紧急安全更新及时处理；升级前备份并保留可回退版本。复核管理员权限、域名与证书到期时间，并检查磁盘健康与散热。' },
      { title: '核验每日备份计划', description: '检查数据库与文件分别备份的每日计划、失败处理和异地副本，核对保留期限。' },
      { title: '验证备份可以恢复', description: '在隔离环境演练数据库与文件恢复，核对备份完整性和恢复后的业务可用性。' },
    ],
  },
  {
    frequency: 'as-needed', title: '设备维护、导出与故障处理',
    tasks: [
      { title: '查看设备与网络巡检', description: '检查持续巡检结果，按需处理 CPU、内存、温度、硬盘空间、磁盘健康及外网异常。' },
      { title: '核对自动恢复设置', description: '确认设备不休眠、来电后可启动，网站服务随开机启动，服务异常和网络中断后能够恢复。' },
      { title: '自行清理下载的 Excel', description: '下载后的 Excel 由保管人按用途及时清理；网站的到期清理不能删除个人电脑上的副本。' },
      { title: '管理备份保留范围', description: '备份加密保存，临时敏感资料的备份保留期限单独规定；不要把到期资料长期保留在备份副本中。' },
      { title: '恢复旧库前先处理到期资料', description: '先在隔离环境清理备份中已到期的敏感资料和缴费图片，再恢复对外服务，避免旧数据重新暴露。' },
    ],
  },
];

export default function DeviceDetection() {
  const [frequency, setFrequency] = useState('activity');
  const [selectedMetric, setSelectedMetric] = useState('cpu');
  const [networkRange, setNetworkRange] = useState('week');
  const [networkDays, setNetworkDays] = useState(7);
  const [customDays, setCustomDays] = useState('');
  const [rangeError, setRangeError] = useState('');
  const id = useId();
  const visiblePlan = maintenancePlan.filter(group => group.frequency === frequency);
  function selectNetworkRange(range) {
    setNetworkRange(range); setRangeError('');
    if (range !== 'custom') setNetworkDays(range === 'week' ? 7 : 30);
  }
  function applyCustomDays(event) {
    event.preventDefault();
    const input = customDays.trim();
    const days = Number(input);
    if (!/^\d+$/.test(input) || !Number.isSafeInteger(days) || days < 1 || !Number.isSafeInteger(days * 86400000)) {
      setRangeError('请输入有效的正整数天数。'); return;
    }
    setNetworkDays(days); setRangeError('');
  }

  return <section className="device-detection" aria-label="设备检测与维护">
    <section className="device-detection-machine" aria-labelledby={`${id}-machine`}>
      <div className="device-detection-machine-header">
        <div className="device-detection-machine-title">
          <Server size={23} strokeWidth={1.6} aria-hidden="true" />
          <div>
            <div className="device-detection-title-line"><h2 id={`${id}-machine`}>本地小电脑</h2><span className="device-detection-planned">规划设备</span></div>
            <p>计划承接网站、登录、数据库与文件处理。</p>
          </div>
        </div>
        <dl className="device-detection-connection" aria-label="设备连接状态">
          <div><dt>连接状态</dt><dd><span className="device-detection-disconnected"><i aria-hidden="true" />未接入</span></dd></div>
          <div><dt>最近检测</dt><dd>—</dd></div>
        </dl>
      </div>
      <dl className="device-detection-specs">
        <div><dt>处理器</dt><dd>Intel i5-3330<small>四核四线程</small></dd></div>
        <div><dt>内存</dt><dd>8 GB</dd></div>
        <div><dt>存储</dt><dd>120 GB 固态</dd></div>
        <div><dt>操作系统</dt><dd>待确定</dd></div>
      </dl>
      <p className="device-detection-spec-note">配置来自拟购商品标称，尚未实机核验，固态接口待确认。</p>
    </section>

    <p className="device-detection-connection-note">检测接口等待接入，当前没有实测数据。故障通知将在后续接入。</p>

    <div className="device-detection-columns" aria-label="设备监测">
      <section className="device-detection-checks" aria-labelledby={`${id}-checks`}>
        <header className="device-detection-section-header">
          <h2 id={`${id}-checks`}>设备与服务</h2>
          <p>选择硬件或网络指标，在右侧查看趋势。</p>
        </header>
        <div className="device-detection-values"><table className="device-detection-table" aria-label="设备与服务检测项">
          <thead><tr><th scope="col">检测项</th><th scope="col">检测值</th><th scope="col">状态</th></tr></thead>
          <tbody>{detectionItems.map(({ id: itemId, icon: Icon, title, detail }) => <tr key={itemId} className={selectedMetric === itemId ? 'is-selected' : undefined}>
            <th scope="row">{TREND_METRICS.some(metric => metric.id === itemId) ? <button className="device-detection-item device-detection-metric-select" type="button" data-trend-metric={itemId} aria-label={`查看${title}趋势`} aria-pressed={selectedMetric === itemId} aria-controls={`${id}-trend`} onClick={() => setSelectedMetric(itemId)}><Icon size={17} strokeWidth={1.6} aria-hidden="true" /><span>{title}<small>{detail}</small></span></button> : <div className="device-detection-item"><Icon size={17} strokeWidth={1.6} aria-hidden="true" /><span>{title}<small>{detail}</small></span></div>}</th>
            <td data-metric-value>—</td>
            <td data-metric-status>等待接入</td>
          </tr>)}</tbody>
        </table></div>
      </section>
      <section className="device-detection-trend-panel" id={`${id}-trend`} aria-label="性能趋势">
        {selectedMetric === 'internet' && <div className="device-network-range" aria-label="网络观察范围">
          <div className="device-network-range-buttons" role="group" aria-label="选择网络观察范围">{[['week', '一周'], ['month', '一月'], ['custom', '自定义']].map(([range, label]) => <button key={range} type="button" aria-pressed={networkRange === range} onClick={() => selectNetworkRange(range)}>{label}</button>)}</div>
          {networkRange === 'custom' && <form onSubmit={applyCustomDays} noValidate><label htmlFor={`${id}-days`}>观测天数</label><div><input id={`${id}-days`} aria-label="观测天数" aria-describedby={`${id}-range-help${rangeError ? ` ${id}-range-error` : ''}`} aria-invalid={Boolean(rangeError)} type="text" inputMode="numeric" value={customDays} onInput={event => setCustomDays(event.currentTarget.value)} onChange={event => setCustomDays(event.currentTarget.value)} placeholder="输入天数" /><span>天</span><button type="submit">应用</button></div><p id={`${id}-range-help`}>输入正整数，应用后更新观察范围。</p>{rangeError && <p id={`${id}-range-error`} role="alert">{rangeError}</p>}</form>}
        </div>}
        <DeviceTrendChart metric={selectedMetric} windowDays={networkDays} />
      </section>
    </div>
      <section className="device-detection-maintenance" aria-label="日常维护计划" aria-labelledby={`${id}-maintenance`}>
        <header className="device-detection-section-header">
          <h2 id={`${id}-maintenance`}><CalendarClock size={18} strokeWidth={1.6} aria-hidden="true" />日常维护计划</h2>
          <p>按频率查看维护事项；这份清单不代表任务已执行。</p>
        </header>
        <div className="device-detection-filters" role="group" aria-label="维护计划频率">
          {frequencies.map(option => <button key={option.id} type="button" aria-pressed={frequency === option.id} aria-controls={`${id}-plan`} onClick={() => setFrequency(option.id)}>{option.label}</button>)}
        </div>
        <div className="device-detection-plan" id={`${id}-plan`}>
          {visiblePlan.map(group => <section key={group.frequency} className="device-detection-plan-group" data-maintenance-frequency={group.frequency} aria-labelledby={`${id}-${group.frequency}`}>
            <header><span className="device-detection-frequency">{frequencies.find(option => option.id === group.frequency).label}</span><h3 id={`${id}-${group.frequency}`}>{group.title}</h3></header>
            <ul>{group.tasks.map(task => <li key={task.title}><strong>{task.title}</strong><p>{task.description}</p></li>)}</ul>
          </section>)}
        </div>
        <p className="device-detection-plan-note">维护计划仅供人工核对；自动检测、备份和清理的实际结果需在接口接入后确认。</p>
      </section>
  </section>;
}
