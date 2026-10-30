import { useSearchParams } from 'react-router-dom';
import { ArrowDown, Check, MountainSnow } from 'lucide-react';
import FootprintExplorer from '../map/FootprintMap.jsx';
import themes from '../map/map-themes.json' with { type: 'json' };
import geography from '../map/geography.json' with { type: 'json' };
import './map-color-samples.css';

function MiniMap({ palette }) {
  return <svg viewBox="0 0 1000 640" className="color-mini-map" role="img" aria-label={`${palette.name}地图配色样本`} style={{background:palette.background}}>
    <g transform="translate(40,-5)" fillRule="evenodd">
      {geography.provinces.map(item => <path key={item.id} d={item.path} fill={palette.land} stroke={palette.border} strokeWidth=".7" vectorEffect="non-scaling-stroke"/>)}
      <g pointerEvents="none" fill={palette.label} fontSize="12" textAnchor="middle">{geography.provinces.filter(item=>['650000','540000','510000','440000','230000','150000','630000','710000'].includes(item.adcode)).map(item=><text key={item.id} x={item.label[0]} y={item.label[1]}>{item.name.replace(/[省市]$/,'').replace('维吾尔自治区','').replace('自治区','')}</text>)}</g>
      <rect x={geography.inset.frame.x} y={geography.inset.frame.y} width={geography.inset.frame.width} height={geography.inset.frame.height} fill={palette.background} stroke={palette.border} strokeWidth=".6"/>
      {geography.inset.paths.map(item=><path key={item.id} d={item.path} fill={palette.land} stroke={palette.border} strokeWidth=".6" vectorEffect="non-scaling-stroke"/>)}
    </g>
  </svg>;
}

export default function MapColorSamplesPage() {
  const [params, setParams] = useSearchParams();
  const selected = themes.find(item=>item.id===params.get('theme')) || themes[0];
  function choose(palette) { setParams({theme:palette.id}, {replace:true}); }
  return <div className="map-color-page container">
    <div className="map-color-intro"><div><h1>川衡足迹，选一种山野底色。</h1><p>四个地图配色样本。橙色强调保持一致，点击样本可查看大图和交互效果。</p></div><span>官网当前配色：A · 曜石黑</span></div>
    <div className="map-color-options" role="group" aria-label="地图配色样本">
      {themes.map(palette=><button key={palette.id} className={`map-color-option ${selected.id===palette.id?'is-selected':''}`} aria-pressed={selected.id===palette.id} onClick={()=>choose(palette)}>
        <div className="color-card-title"><span className="color-letter">{palette.letter}</span><strong>{palette.name}</strong>{palette.recommended&&<span className="color-recommend">推荐</span>}{selected.id===palette.id&&<Check className="color-selected-check" size={16}/>}</div>
        <MiniMap palette={palette}/>
        <div className="color-card-copy"><p>{palette.description}</p><div className="color-swatches" aria-label="主要颜色">{[palette.background,palette.land,palette.border,palette.label,'#F07827'].map((color,index)=><span key={index} style={{background:color}} title={color}/>)}</div></div>
      </button>)}
    </div>
    <div className="map-color-live-heading" id="map-color-live"><div><h2><span>{selected.letter}</span>{selected.name}</h2><p>{selected.description}</p></div><a href="#full-color-map">查看完整效果<ArrowDown size={15}/></a></div>
    <div id="full-color-map"><FootprintExplorer key={selected.id} palette={selected.id}/></div>
    <div className="map-color-choice-note"><MountainSnow size={23} strokeWidth={1.3}/><p><strong>A 曜石黑</strong> 已应用到关于川衡和独立足迹地图。其他配色仍可在此比较。</p><span>此页切换仅用于预览。</span></div>
  </div>;
}
