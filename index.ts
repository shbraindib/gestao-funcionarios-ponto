import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})
const errorText=(value:unknown):string=>{
  if(value instanceof Error)return errorText(value.message)
  if(typeof value==='string'&&value.trim()&&value.trim()!=='[object Object]')return value.trim()
  if(value&&typeof value==='object'){
    const record=value as Record<string,unknown>
    for(const key of ['message','msg','error_description','details','hint','error']){
      const text=errorText(record[key])
      if(text)return text
    }
  }
  return 'Não foi possível concluir a operação administrativa.'
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const url=Deno.env.get('SUPABASE_URL')!
    const anon=Deno.env.get('SUPABASE_ANON_KEY')!
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader=req.headers.get('Authorization')||''
    const caller=createClient(url,anon,{global:{headers:{Authorization:authHeader}}})
    const {data:{user},error:userError}=await caller.auth.getUser()
    if(userError||!user)return reply({error:'Sessão inválida.'},401)
    const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}})
    const {data:profile}=await admin.from('profiles').select('system_role,active').eq('id',user.id).single()
    if(!profile?.active||profile.system_role!=='master')return reply({error:'Acesso exclusivo do Administrador Geral.'},403)
    const body=await req.json()
    if(body.action==='list'){
      const [{data:profiles,error:pe},{data:memberships,error:me},{data:schools,error:se},{data:authList,error:ae}]=await Promise.all([
        admin.from('profiles').select('*').order('full_name'),
        admin.from('memberships').select('id,user_id,school_id,role,active,school:schools(id,name,short_name,code,active)').order('created_at'),
        admin.from('schools').select('*').order('name'),
        admin.auth.admin.listUsers({page:1,perPage:1000})
      ])
      if(pe||me||se||ae)throw pe||me||se||ae
      const authMap=new Map((authList.users||[]).map(u=>[u.id,u]))
      const users=(profiles||[]).map(p=>({...p,email:authMap.get(p.id)?.email||'',memberships:(memberships||[]).filter(m=>m.user_id===p.id)}))
      return reply({users,schools})
    }
    if(body.action==='create'){
      if(!body.email||!body.password||!body.full_name||!body.school_id)return reply({error:'Preencha nome, e-mail, senha e escola.'},400)
      if(String(body.password).length<8)return reply({error:'A senha precisa ter pelo menos 8 caracteres.'},400)
      const {data:created,error:createError}=await admin.auth.admin.createUser({email:body.email,password:body.password,email_confirm:true,user_metadata:{full_name:body.full_name}})
      if(createError)throw createError
      const uid=created.user.id
      const {error:profileError}=await admin.from('profiles').upsert({id:uid,full_name:body.full_name,system_role:'user',active:body.active!==false},{onConflict:'id'})
      if(profileError){await admin.auth.admin.deleteUser(uid);throw profileError}
      const {error:membershipError}=await admin.from('memberships').insert({user_id:uid,school_id:body.school_id,role:body.role||'operator',active:true})
      if(membershipError){await admin.from('profiles').delete().eq('id',uid);await admin.auth.admin.deleteUser(uid);throw membershipError}
      return reply({ok:true,user_id:uid})
    }
    if(body.action==='add_membership'){
      if(!body.user_id||!body.school_id)return reply({error:'Informe usuário e escola.'},400)
      const {error}=await admin.from('memberships').upsert({user_id:body.user_id,school_id:body.school_id,role:body.role||'operator',active:true},{onConflict:'user_id,school_id'})
      if(error)throw error
      return reply({ok:true})
    }
    if(body.action==='update_user'){
      if(!body.user_id)return reply({error:'Usuário não informado.'},400)
      const {error:profileError}=await admin.from('profiles').update({active:Boolean(body.active)}).eq('id',body.user_id)
      if(profileError)throw profileError
      if(body.membership_id){
        const {error:membershipError}=await admin.from('memberships').update({role:body.role||'operator'}).eq('id',body.membership_id)
        if(membershipError)throw membershipError
      }
      return reply({ok:true})
    }
    if(body.action==='reset_password'){
      if(!body.user_id||!body.password||String(body.password).length<8)return reply({error:'Informe usuário e senha com pelo menos 8 caracteres.'},400)
      const {error}=await admin.auth.admin.updateUserById(body.user_id,{password:body.password})
      if(error)throw error
      return reply({ok:true})
    }
    if(body.action==='set_active'){
      const {error}=await admin.from('profiles').update({active:Boolean(body.active)}).eq('id',body.user_id)
      if(error)throw error
      return reply({ok:true})
    }
    return reply({error:'Ação não reconhecida.'},400)
  }catch(error){console.error(error);return reply({error:errorText(error)},400)}
})
