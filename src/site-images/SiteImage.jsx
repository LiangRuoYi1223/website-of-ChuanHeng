import {useState} from 'react';
import {useSiteImages} from './SiteImagesContext.jsx';
import {defaultSiteImages,getSlotImage,imageCredit,validImageUrl} from './config.js';
import './public-images.css';

export function useResolvedSiteImage(slot,image) {
  const {config}=useSiteImages();
  const supplied=typeof image==='string'?{url:image,alt:'',credit:''}:image;
  if(supplied&&validImageUrl(supplied.url,{local:true}))return supplied;
  return slot?getSlotImage(config,slot):defaultSiteImages().heroSlides[0];
}

export default function SiteImage({slot,image,alt,className='',onError,...props}) {
  const resolved=useResolvedSiteImage(slot,image);
  const [failed,setFailed]=useState(null);
  const description=alt??resolved.alt??'山野配图';
  if(failed===resolved.url)return <span className={`site-image-unavailable ${className}`} style={props.style} role="img" aria-label={`${description||'配图'}，图片暂不可用`}>图片暂不可用</span>;
  return <img {...props} className={className||undefined} src={resolved.url} alt={description} onError={event=>{setFailed(resolved.url);onError?.(event);}}/>;
}

export function SiteImageCredit({slot,image,className='image-credit',as:Tag='small'}) {
  const resolved=useResolvedSiteImage(slot,image);
  const credit=imageCredit(resolved);
  return credit?<Tag className={className}>{credit}</Tag>:null;
}
