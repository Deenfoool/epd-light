import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Company, DocumentRow, Driver, Profile, Vehicle } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const cloudEnabled = Boolean(url && key)
export const supabase: SupabaseClient | null = cloudEnabled ? createClient(url!, key!) : null

const DEMO_USER='demo@epd-lite.local'
const storeKey=(name:string)=>`epd-lite:${name}`
const read=<T>(name:string,fallback:T):T=>{ try{const v=localStorage.getItem(storeKey(name)); return v?JSON.parse(v):fallback}catch{return fallback} }
const write=<T>(name:string,v:T)=>localStorage.setItem(storeKey(name),JSON.stringify(v))

export async function getSessionEmail():Promise<string|null>{
  if(supabase){ const {data}=await supabase.auth.getSession(); return data.session?.user.email??null }
  return localStorage.getItem(storeKey('session'))
}
export async function signUp(email:string,password:string):Promise<boolean>{
  if(supabase){ const {data,error}=await supabase.auth.signUp({email,password}); if(error) throw error; return Boolean(data.session) }
  if(password.length<6) throw new Error('Пароль должен содержать минимум 6 символов')
  localStorage.setItem(storeKey('session'),email)
  return true
}
export async function signIn(email:string,password:string){
  if(supabase){ const {error}=await supabase.auth.signInWithPassword({email,password}); if(error) throw error; return }
  if(!email||password.length<1) throw new Error('Введите email и пароль')
  localStorage.setItem(storeKey('session'),email||DEMO_USER)
}
export async function signOut(){ if(supabase) await supabase.auth.signOut(); else localStorage.removeItem(storeKey('session')) }
export function subscribeAuth(fn:()=>void){ if(!supabase) return ()=>{}; const {data}=supabase.auth.onAuthStateChange(()=>fn()); return ()=>data.subscription.unsubscribe() }

async function uid(){ if(!supabase) return 'demo'; const {data}=await supabase.auth.getUser(); if(!data.user) throw new Error('Не выполнен вход'); return data.user.id }

const defaultProfile:Profile={company_name:'',inn:'',kpp:'',org_type:'org',phone:'',email:'',onboarded:false}
export async function getProfile():Promise<Profile>{
  if(!supabase) return read('profile',defaultProfile)
  const userId=await uid(); const {data,error}=await supabase.from('profiles').select('*').eq('user_id',userId).maybeSingle(); if(error) throw error
  return data?{company_name:data.company_name,inn:data.inn,kpp:data.kpp,org_type:data.org_type,phone:data.phone,email:data.email,onboarded:data.onboarded}:defaultProfile
}
export async function saveProfile(p:Profile){
  if(!supabase){write('profile',p);return}
  const userId=await uid(); const {error}=await supabase.from('profiles').upsert({user_id:userId,...p}); if(error) throw error
}

export async function listDocuments():Promise<DocumentRow[]>{
  if(!supabase) return read<DocumentRow[]>('documents',[]).sort((a,b)=>b.updated_at.localeCompare(a.updated_at))
  const {data,error}=await supabase.from('documents').select('*').order('updated_at',{ascending:false}); if(error) throw error
  return (data??[]) as DocumentRow[]
}
export async function saveDocument(d:DocumentRow):Promise<DocumentRow>{
  const next={...d,updated_at:new Date().toISOString()}
  if(!supabase){ const all=read<DocumentRow[]>('documents',[]); const i=all.findIndex(x=>x.id===next.id); if(i>=0)all[i]=next; else all.unshift(next); write('documents',all); return next }
  const userId=await uid(); const payload={id:next.id,user_id:userId,doc_number:next.doc_number,doc_date:next.doc_date,status:next.status,data:next.data,created_at:next.created_at,updated_at:next.updated_at}
  const {data,error}=await supabase.from('documents').upsert(payload).select('*').single(); if(error) throw error; return data as DocumentRow
}
export async function deleteDocument(id:string){ if(!supabase){write('documents',read<DocumentRow[]>('documents',[]).filter(x=>x.id!==id));return}; const {error}=await supabase.from('documents').delete().eq('id',id); if(error) throw error }

export async function listCompanies():Promise<Company[]>{ if(!supabase)return read('companies',[]); const {data,error}=await supabase.from('companies').select('*').order('name'); if(error)throw error; return (data??[]) as Company[] }
export async function saveCompany(c:Company){ if(!supabase){const all=read<Company[]>('companies',[]);const i=all.findIndex(x=>x.id===c.id);if(i>=0)all[i]=c;else all.push(c);write('companies',all);return}; const userId=await uid();const {error}=await supabase.from('companies').upsert({...c,user_id:userId});if(error)throw error }
export async function deleteCompany(id:string){ if(!supabase){write('companies',read<Company[]>('companies',[]).filter(x=>x.id!==id));return}; const {error}=await supabase.from('companies').delete().eq('id',id);if(error)throw error }

export async function listVehicles():Promise<Vehicle[]>{ if(!supabase)return read('vehicles',[]); const {data,error}=await supabase.from('vehicles').select('*').order('plate');if(error)throw error;return (data??[]) as Vehicle[] }
export async function saveVehicle(v:Vehicle){ if(!supabase){const all=read<Vehicle[]>('vehicles',[]);const i=all.findIndex(x=>x.id===v.id);if(i>=0)all[i]=v;else all.push(v);write('vehicles',all);return};const userId=await uid();const {error}=await supabase.from('vehicles').upsert({...v,user_id:userId});if(error)throw error }
export async function deleteVehicle(id:string){ if(!supabase){write('vehicles',read<Vehicle[]>('vehicles',[]).filter(x=>x.id!==id));return};const {error}=await supabase.from('vehicles').delete().eq('id',id);if(error)throw error }

export async function listDrivers():Promise<Driver[]>{ if(!supabase)return read('drivers',[]);const {data,error}=await supabase.from('drivers').select('*').order('full_name');if(error)throw error;return (data??[]) as Driver[] }
export async function saveDriver(d:Driver){ if(!supabase){const all=read<Driver[]>('drivers',[]);const i=all.findIndex(x=>x.id===d.id);if(i>=0)all[i]=d;else all.push(d);write('drivers',all);return};const userId=await uid();const {error}=await supabase.from('drivers').upsert({...d,user_id:userId});if(error)throw error }
export async function deleteDriver(id:string){ if(!supabase){write('drivers',read<Driver[]>('drivers',[]).filter(x=>x.id!==id));return};const {error}=await supabase.from('drivers').delete().eq('id',id);if(error)throw error }

export async function saveIntegrationRequest(req:{company_name:string;inn:string;operator:string;contact:string}){ if(!supabase){const all=read<any[]>('integrationRequests',[]);all.push({...req,id:crypto.randomUUID(),created_at:new Date().toISOString()});write('integrationRequests',all);return};const userId=await uid();const {error}=await supabase.from('integration_requests').insert({...req,user_id:userId});if(error)throw error }

export function seedDemo(){
  if(read<DocumentRow[]>('documents',[]).length) return
  const now=new Date().toISOString();
  const demo:DocumentRow={id:crypto.randomUUID(),doc_number:'ЭТрН-2026-118',doc_date:'2026-09-01',status:'ready',created_at:now,updated_at:now,data:{
    shipper:{kind:'org',name:'ООО «Вымышленный Склад»',inn:'7700000000',kpp:'770001001',phone:'+7 900 000-00-01',email:'demo1@example.test',address:'г. Москва, Тестовая ул., 1'},
    consignee:{kind:'org',name:'ООО «Пример Ритейл»',inn:'6900000000',kpp:'690001001',phone:'+7 900 000-00-02',email:'demo2@example.test',address:'г. Тверь, Примерная ул., 2'},
    carrier:{kind:'ip',name:'ИП Тестовый Иван Иванович',inn:'690000000001',kpp:'',phone:'+7 900 000-00-03',email:'demo3@example.test',address:'г. Тверь'},
    route:{loadAddress:'Москва, Тестовая ул., 1',loadDate:'2026-09-01',loadTime:'09:00',unloadAddress:'Тверь, Примерная ул., 2',unloadDate:'2026-09-01',unloadTime:'15:00',note:''},
    cargo:[{id:crypto.randomUUID(),name:'Демонстрационный товар',places:'12',unit:'мест',weight:'840',value:'',packaging:'короб',conditions:''}],
    transport:{brand:'Тестовая Марка',model:'Cargo',plate:'А001АА777',trailerPlate:'',driverName:'Иванов Иван Иванович',driverPhone:'+7 900 000-00-03',driverLicense:''},
    terms:{contractNumber:'ДЕМО-001',contractDate:'2026-08-31',price:'15000',comment:'Только демонстрационные данные',extra:''}
  }}
  write('documents',[demo])
  write('companies',[
    {id:crypto.randomUUID(),name:'ООО «Вымышленный Склад»',inn:'7700000000',kpp:'770001001',roles:['грузоотправитель'],address:'г. Москва, Тестовая ул., 1',phone:'+7 900 000-00-01',email:'demo1@example.test'},
    {id:crypto.randomUUID(),name:'ООО «Пример Ритейл»',inn:'6900000000',kpp:'690001001',roles:['грузополучатель'],address:'г. Тверь, Примерная ул., 2',phone:'+7 900 000-00-02',email:'demo2@example.test'},
  ])
  write('vehicles',[{id:crypto.randomUUID(),brand:'Тестовая Марка',model:'Cargo',plate:'А001АА777',vehicle_type:'грузовой',trailer_plate:''}])
  write('drivers',[{id:crypto.randomUUID(),full_name:'Иванов Иван Иванович',phone:'+7 900 000-00-03',license:''}])
}
