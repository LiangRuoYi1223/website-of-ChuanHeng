import { formatActivityTime } from './schedule.js';

export default function ActivityScheduleDetails({ activity }) {
  return <><div><dt>活动开始</dt><dd>{formatActivityTime(activity.dateStart)}</dd></div><div><dt>活动结束</dt><dd>{formatActivityTime(activity.dateEnd)}</dd></div><div><dt>报名开启</dt><dd>{formatActivityTime(activity.registrationStart)}</dd></div><div><dt>报名截止</dt><dd>{formatActivityTime(activity.registrationDeadline)}</dd></div><div><dt>时间说明</dt><dd>以上时间均为北京时间</dd></div></>;
}
