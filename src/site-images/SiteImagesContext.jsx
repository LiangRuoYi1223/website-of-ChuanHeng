import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {supabase} from '../backend.js';
import {runtimeMode} from '../runtime-mode.js';
import {defaultSiteImages,readLocalSiteImages,readSiteImages,LOCAL_IMAGES_KEY,localSiteImagesMode} from './config.js';

const SiteImages=createContext({config:defaultSiteImages(),refresh:async()=>{},loading:false,error:''});
export function SiteImagesProvider({children,local=localSiteImagesMode(runtimeMode,'',Boolean(supabase))}){
  const [config,setConfig]=useState(defaultSiteImages),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    const current=++generation.current;setLoading(true);
    try{
      const next=local?readLocalSiteImages():supabase?await readSiteImages(supabase):null;
      if(current===generation.current){if(next)setConfig(next.config);setError('');}
    }catch{if(current===generation.current)setError('暂时无法刷新图片，将继续显示已有图片。');}
    finally{if(current===generation.current)setLoading(false);}
  },[local]);
  useEffect(()=>{
    refresh();
    const update=event=>{if(event.type==='storage'&&event.key!==LOCAL_IMAGES_KEY&&event.key!==null)return;refresh();};
    window.addEventListener('chuanheng-site-images-updated',update);
    window.addEventListener('storage',update);
    window.addEventListener('focus',update);
    return()=>{generation.current++;window.removeEventListener('chuanheng-site-images-updated',update);window.removeEventListener('storage',update);window.removeEventListener('focus',update);};
  },[refresh]);
  return <SiteImages.Provider value={{config,loading,error,refresh}}>{children}</SiteImages.Provider>;
}
export function useSiteImages(){return useContext(SiteImages);}
