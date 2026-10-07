import { useId, useState } from 'react';
import { cities, findCity } from '../features/map-data/cities';

const provinces = Array.from(new Map(cities.map(city => [city.provinceCode, city.provinceName])));

export default function ActivityCityField({value,onChange}:{value:string;onChange:(code:string)=>void}) {
  const selected = findCity(value);
  const [province, setProvince] = useState(selected?.provinceCode ?? '');
  const provinceCode = selected?.provinceCode ?? province;
  const helpId = useId();
  const options = cities.filter(city => city.provinceCode === provinceCode);

  return <fieldset className="admin-city-field">
    <legend>活动地点</legend>
    <div className="admin-grid">
      <label className="admin-field">省份 / 直辖市
        <select value={provinceCode} aria-describedby={helpId} onChange={event => {setProvince(event.target.value);onChange('');}}>
          <option value="">请选择省份 / 直辖市</option>
          {provinces.map(([code,name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      <label className="admin-field">城市 / 地区
        <select value={value} disabled={!provinceCode} aria-describedby={helpId} onChange={event => onChange(event.target.value)}>
          <option value="">{provinceCode?'请选择城市 / 地区':'请先选择省份 / 直辖市'}</option>
          {options.map(city => <option key={city.code} value={city.code}>{city.name}</option>)}
        </select>
      </label>
    </div>
    <p className="admin-help" id={helpId}>选择路线所在城市，保存并发布后会自动显示在足迹地图上。未选择城市的活动暂不显示点位。活动回顾显示绿点，活动预告显示蓝点；同城兼有两种活动时显示蓝点。</p>
  </fieldset>;
}
