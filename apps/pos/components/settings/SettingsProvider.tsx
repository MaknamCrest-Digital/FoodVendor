"use client";
import {createContext,useCallback,useContext,useEffect,useState,type ReactNode} from 'react';
import {defaultSettings,settingRows,settingsFromRows,refreshSettings,saveSetting,setDisplayCurrency,type Section,type Settings,type SettingRow} from '../../src/lib/settings';
import {useAuth} from '../auth/AuthProvider';
type State={settings:Settings;rows:SettingRow[];ready:boolean;error:string;refresh:()=>Promise<void>;save:(section:Section,values:Settings[Section],confirmCurrencyChange?:boolean)=>Promise<void>};
const Context=createContext<State|null>(null);
export function SettingsProvider({children}:{children:ReactNode}){
 const {session}=useAuth();const [settings,setSettings]=useState(defaultSettings);const [rows,setRows]=useState<SettingRow[]>([]);const [ready,setReady]=useState(false);const [error,setError]=useState('');
 const apply=useCallback((next:SettingRow[])=>{const values=settingsFromRows(next);setDisplayCurrency(values.general.currency);setRows(next);setSettings(values);setReady(true);},[]);
 const refresh=useCallback(async()=>{try{apply(await refreshSettings());setError('');}catch(e){setError((e as Error).message);}},[apply]);
 useEffect(()=>{let active=true;void settingRows().then(next=>{if(active){apply(next);void refresh();}});const load=()=>void settingRows().then(apply);window.addEventListener('online',refresh);window.addEventListener('settings-changed',load);return()=>{active=false;window.removeEventListener('online',refresh);window.removeEventListener('settings-changed',load);};},[session?.user.id,apply,refresh]);
 useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)');const theme=()=>{document.documentElement.dataset.theme=settings.appearance.theme==='SYSTEM'?(media.matches?'dark':'light'):settings.appearance.theme.toLowerCase();document.documentElement.dataset.density=settings.appearance.density.toLowerCase();};theme();media.addEventListener('change',theme);return()=>media.removeEventListener('change',theme);},[settings.appearance]);
 async function save(section:Section,values:Settings[Section],confirm=false){apply(await saveSetting(section,values,rows.find(row=>row.section===section)?.revision||0,confirm));}
 return <Context.Provider value={{settings,rows,ready,error,refresh,save}}>{ready?children:<div role="status" className="auth-loading">Loading restaurant settings…</div>}</Context.Provider>;
}
export function useSettings(){const value=useContext(Context);if(!value)throw new Error('SettingsProvider required');return value;}
