import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})
const clean=(value:unknown)=>String(value||'').trim()

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
      const authMap=new Map((authList.users||[]).map(item=>[item.id,item]))
      const users=(profiles||[]).map(item=>({...item,email:authMap.get(item.id)?.email||'',memberships:(memberships||[]).filter(membership=>membership.user_id===item.id)}))
      return reply({users,schools})
    }

    if(body.action==='create'){
      const fullName=clean(body.full_name),email=clean(body.email).toLocaleLowerCase('pt-BR'),password=String(body.password||'')
      if(!email||!password||!fullName||!body.school_id)return reply({error:'Preencha nome, e-mail, senha e escola.'},400)
      if(password.length<8)return reply({error:'A senha precisa ter pelo menos 8 caracteres.'},400)
      const {data:created,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:fullName}})
      if(createError)throw createError
      const uid=created.user.id
      const {error:profileError}=await admin.from('profiles').upsert({id:uid,full_name:fullName,system_role:'user',active:body.active!==false},{onConflict:'id'})
      if(profileError){await admin.auth.admin.deleteUser(uid);throw profileError}
      const {error:membershipError}=await admin.from('memberships').upsert({user_id:uid,school_id:body.school_id,role:body.role||'operator',active:true},{onConflict:'user_id,school_id'})
      if(membershipError){await admin.auth.admin.deleteUser(uid);throw membershipError}
      return reply({ok:true,user_id:uid})
    }

    if(body.action==='add_membership'){
      if(!body.user_id||!body.school_id)return reply({error:'Informe usuário e escola.'},400)
      const {error}=await admin.from('memberships').upsert({user_id:body.user_id,school_id:body.school_id,role:body.role||'operator',active:true},{onConflict:'user_id,school_id'})
      if(error)throw error
      return reply({ok:true})
    }

    if(body.action==='update_user_details'){
      const userId=clean(body.user_id),membershipId=clean(body.membership_id),schoolId=clean(body.school_id)
      const fullName=clean(body.full_name),email=clean(body.email).toLocaleLowerCase('pt-BR'),password=String(body.password||'')
      if(!userId||!membershipId||!schoolId||!fullName||!email)return reply({error:'Preencha nome, e-mail, escola e permissão.'},400)
      if(password&&password.length<8)return reply({error:'A nova senha precisa ter pelo menos 8 caracteres.'},400)
      const {data:targetProfile,error:targetError}=await admin.from('profiles').select('system_role').eq('id',userId).single()
      if(targetError)throw targetError
      if(targetProfile.system_role==='master')return reply({error:'A conta mestre não pode ser alterada por esta ação.'},400)
      const {data:membership,error:membershipReadError}=await admin.from('memberships').select('id,user_id').eq('id',membershipId).single()
      if(membershipReadError)throw membershipReadError
      if(membership.user_id!==userId)return reply({error:'O vínculo informado não pertence ao usuário.'},400)
      const {data:duplicate,error:duplicateError}=await admin.from('memberships').select('id').eq('user_id',userId).eq('school_id',schoolId).neq('id',membershipId).maybeSingle()
      if(duplicateError)throw duplicateError
      if(duplicate)return reply({error:'Este usuário já possui vínculo com a escola selecionada.'},409)
      const {data:{user:authUser},error:authReadError}=await admin.auth.admin.getUserById(userId)
      if(authReadError)throw authReadError
      const attributes:{email:string;email_confirm:boolean;user_metadata:Record<string,unknown>;password?:string}={email,email_confirm:true,user_metadata:{...(authUser?.user_metadata||{}),full_name:fullName}}
      if(password)attributes.password=password
      const {error:authUpdateError}=await admin.auth.admin.updateUserById(userId,attributes)
      if(authUpdateError)throw authUpdateError
      const {error:profileError}=await admin.from('profiles').update({full_name:fullName,active:body.active!==false}).eq('id',userId)
      if(profileError)throw profileError
      const {error:membershipError}=await admin.from('memberships').update({school_id:schoolId,role:body.role||'operator',active:true}).eq('id',membershipId).eq('user_id',userId)
      if(membershipError)throw membershipError
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

    if(body.action==='delete_user'){
      const userId=clean(body.user_id)
      if(!userId)return reply({error:'Usuário não informado.'},400)
      if(userId===user.id)return reply({error:'Você não pode excluir a própria conta mestre.'},400)
      const {data:targetProfile,error:targetError}=await admin.from('profiles').select('system_role').eq('id',userId).single()
      if(targetError)throw targetError
      if(targetProfile.system_role==='master')return reply({error:'A conta mestre não pode ser excluída.'},400)
      const {error}=await admin.auth.admin.deleteUser(userId)
      if(error)throw error
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
  }catch(error){
    console.error(error)
    const message=error&&typeof error==='object'&&'message' in error?String((error as {message:unknown}).message):String(error)
    return reply({error:message},400)
  }
})
