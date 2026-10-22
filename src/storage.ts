import { createStore, validateStore, type Store } from './domain';
export const STORAGE_KEY = 'human3.workbench.v1';
export function loadStore(): {store:Store;error:string|null} {
  try { const raw=localStorage.getItem(STORAGE_KEY); return {store:raw?validateStore(JSON.parse(raw)):createStore(),error:null}; }
  catch { return {store:createStore(),error:'本地记录无法读取，原始数据仍保留。请先下载故障备份，再导入有效备份或开始新的记录。'}; }
}
export function saveStore(store:Store) { localStorage.setItem(STORAGE_KEY,JSON.stringify(validateStore(store))); }
export function downloadFile(data:BlobPart,name:string,type:string) { const url=URL.createObjectURL(new Blob([data],{type})); const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
