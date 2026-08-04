import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const backupFormat = 'gestao-funcionarios-ponto/system-backup'
const backupVersion = 1
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const allowedRoles = new Set(['admin', 'operator', 'consulta'])
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
const clean = (value: unknown) => String(value || '').trim()
const validUuid = (value: unknown) => uuidPattern.test(clean(value))

async function allAuthUsers(admin: any) {
  const users: any[] = []
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const current = data?.users || []
    users.push(...current)
    if (current.length < 1000) return users
  }
  throw new Error('O sistema possui usuários demais para gerar um backup seguro.')
}

function requireBackup(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('O arquivo não contém um backup geral válido.')
  const backup = raw as Record<string, any>
  if (backup.format !== backupFormat || Number(backup.version) !== backupVersion)
    throw new Error('O formato ou a versão do backup geral não é compatível.')
  for (const field of ['schools', 'school_data', 'users', 'memberships']) {
    if (!Array.isArray(backup[field])) throw new Error(`O backup está incompleto: campo ${field} ausente.`)
  }
  if (!backup.schools.length) throw new Error('O backup não contém nenhuma escola.')
  if (backup.schools.length > 500 || backup.school_data.length > 500)
    throw new Error('O backup excede o limite de 500 escolas.')
  if (backup.users.length > 5000 || backup.memberships.length > 20000)
    throw new Error('O backup excede o limite seguro de usuários ou vínculos.')
  if (JSON.stringify(backup).length > 15 * 1024 * 1024)
    throw new Error('O backup excede o limite de 15 MB.')

  const schoolIds = new Set<string>()
  const schools = backup.schools.map((item: any) => {
    const id = clean(item?.id)
    const name = clean(item?.name)
    const shortName = clean(item?.short_name) || name
    if (!validUuid(id) || !name) throw new Error('O backup contém uma escola inválida.')
    if (schoolIds.has(id)) throw new Error('O backup contém escolas duplicadas.')
    if (name.length > 150 || shortName.length > 80 || clean(item?.code).length > 40)
      throw new Error(`Os dados da escola ${name} excedem o tamanho permitido.`)
    schoolIds.add(id)
    return {
      id,
      name,
      short_name: shortName,
      code: clean(item?.code) || null,
      active: item?.active !== false,
    }
  })

  const dataBySchool = new Map<string, Record<string, unknown>>()
  for (const item of backup.school_data) {
    const schoolId = clean(item?.school_id)
    if (!schoolIds.has(schoolId) || !item?.payload || typeof item.payload !== 'object' || Array.isArray(item.payload))
      throw new Error('O backup contém dados de escola inválidos ou sem unidade correspondente.')
    if (dataBySchool.has(schoolId)) throw new Error('O backup contém dados duplicados para uma escola.')
    dataBySchool.set(schoolId, item.payload)
  }
  if (dataBySchool.size !== schoolIds.size)
    throw new Error('O backup não possui os dados de todas as escolas.')

  const userIds = new Set<string>()
  const users = backup.users.map((item: any) => {
    const id = clean(item?.id)
    const email = clean(item?.email).toLocaleLowerCase('pt-BR')
    if (!validUuid(id) || !email || !email.includes('@'))
      throw new Error('O backup contém um usuário inválido.')
    if (userIds.has(id)) throw new Error('O backup contém usuários duplicados.')
    userIds.add(id)
    return {
      id,
      email,
      full_name: clean(item?.full_name) || email,
      system_role: item?.system_role === 'master' ? 'master' : 'user',
      active: item?.active !== false,
    }
  })

  const membershipKeys = new Set<string>()
  const memberships = backup.memberships.map((item: any) => {
    const userId = clean(item?.user_id)
    const schoolId = clean(item?.school_id)
    const role = clean(item?.role)
    const key = `${userId}:${schoolId}`
    if (!userIds.has(userId) || !schoolIds.has(schoolId) || !allowedRoles.has(role))
      throw new Error('O backup contém um vínculo inválido.')
    if (membershipKeys.has(key)) throw new Error('O backup contém vínculos duplicados.')
    membershipKeys.add(key)
    return { user_id: userId, school_id: schoolId, role, active: item?.active !== false }
  })

  return {
    schools,
    schoolData: [...dataBySchool].map(([school_id, payload]) => ({ school_id, payload })),
    users,
    memberships,
  }
}

async function exportSystemBackup(admin: any, callerId: string, appVersion: unknown) {
  const [profilesResult, membershipsResult, schoolsResult, schoolDataResult, authUsers] = await Promise.all([
    admin.from('profiles').select('id,full_name,system_role,active,created_at,updated_at').order('full_name'),
    admin.from('memberships').select('id,user_id,school_id,role,active,created_at').order('created_at'),
    admin.from('schools').select('id,name,short_name,code,active,created_at,updated_at').order('name'),
    admin.from('school_data').select('school_id,payload,updated_at,version').order('school_id'),
    allAuthUsers(admin),
  ])
  const error = profilesResult.error || membershipsResult.error || schoolsResult.error || schoolDataResult.error
  if (error) throw error
  const authMap = new Map(authUsers.map((item: any) => [item.id, item]))
  const users = (profilesResult.data || []).map((item: any) => ({
    ...item,
    email: authMap.get(item.id)?.email || '',
  }))
  if (users.some((item: any) => !item.email))
    throw new Error('Há perfis sem login correspondente. Corrija os usuários antes de gerar o backup geral.')
  return {
    format: backupFormat,
    version: backupVersion,
    exported_at: new Date().toISOString(),
    exported_by: callerId,
    app_version: clean(appVersion) || '2.0 Online',
    includes_passwords: false,
    schools: schoolsResult.data || [],
    school_data: schoolDataResult.data || [],
    users,
    memberships: membershipsResult.data || [],
  }
}

async function restoreSystemBackup(admin: any, callerId: string, rawBackup: unknown) {
  const backup = requireBackup(rawBackup)
  const [authUsers, currentProfilesResult, currentSchoolsResult] = await Promise.all([
    allAuthUsers(admin),
    admin.from('profiles').select('id,full_name,system_role,active'),
    admin.from('schools').select('id'),
  ])
  if (currentProfilesResult.error || currentSchoolsResult.error)
    throw currentProfilesResult.error || currentSchoolsResult.error

  const currentProfiles = currentProfilesResult.data || []
  const profileById = new Map(currentProfiles.map((item: any) => [item.id, item]))
  const authById = new Map(authUsers.map((item: any) => [item.id, item]))
  const authByEmail = new Map(authUsers.map((item: any) => [clean(item.email).toLocaleLowerCase('pt-BR'), item]))
  const userIdMap = new Map<string, string>()
  const missingUsers: Array<{ id: string; email: string; full_name: string }> = []

  for (const backupUser of backup.users) {
    const authUser = authById.get(backupUser.id) || authByEmail.get(backupUser.email)
    if (!authUser) {
      missingUsers.push({ id: backupUser.id, email: backupUser.email, full_name: backupUser.full_name })
      continue
    }
    userIdMap.set(backupUser.id, authUser.id)
  }

  const profileRows = backup.users
    .filter((item: any) => userIdMap.has(item.id))
    .map((item: any) => {
      const id = userIdMap.get(item.id)!
      const current = profileById.get(id)
      const protectedMaster = current?.system_role === 'master'
      return {
        id,
        full_name: protectedMaster ? current.full_name : item.full_name,
        system_role: protectedMaster ? 'master' : 'user',
        active: protectedMaster ? true : item.active,
      }
    })

  const { error: schoolError } = await admin.from('schools').upsert(backup.schools, { onConflict: 'id' })
  if (schoolError) throw schoolError
  if (profileRows.length) {
    const { error } = await admin.from('profiles').upsert(profileRows, { onConflict: 'id' })
    if (error) throw error
  }

  const nonMasterIds = currentProfiles
    .filter((item: any) => item.system_role !== 'master')
    .map((item: any) => item.id)
  for (let index = 0; index < nonMasterIds.length; index += 200) {
    const { error } = await admin.from('memberships').delete().in('user_id', nonMasterIds.slice(index, index + 200))
    if (error) throw error
  }

  for (const row of backup.schoolData) {
    const { error } = await admin.from('school_data').upsert(row, { onConflict: 'school_id' })
    if (error) throw error
  }

  const restoredMemberships = backup.memberships
    .filter((item: any) => userIdMap.has(item.user_id))
    .filter((item: any) => backup.users.find((user: any) => user.id === item.user_id)?.system_role !== 'master')
    .filter((item: any) => profileById.get(userIdMap.get(item.user_id))?.system_role !== 'master')
    .map((item: any) => ({
      user_id: userIdMap.get(item.user_id),
      school_id: item.school_id,
      role: item.role,
      active: item.active,
    }))
  if (restoredMemberships.length) {
    const { error } = await admin.from('memberships').upsert(restoredMemberships, { onConflict: 'user_id,school_id' })
    if (error) throw error
  }

  const restoredSchoolIds = new Set(backup.schools.map((item: any) => item.id))
  const staleSchoolIds = (currentSchoolsResult.data || [])
    .map((item: any) => item.id)
    .filter((id: string) => !restoredSchoolIds.has(id))
  for (let index = 0; index < staleSchoolIds.length; index += 200) {
    const { error } = await admin.from('schools').delete().in('id', staleSchoolIds.slice(index, index + 200))
    if (error) throw error
  }

  const restoredLiveUserIds = new Set(profileRows.map((item: any) => item.id))
  const usersToDeactivate = nonMasterIds.filter((id: string) => !restoredLiveUserIds.has(id))
  for (let index = 0; index < usersToDeactivate.length; index += 200) {
    const { error } = await admin.from('profiles').update({ active: false }).in('id', usersToDeactivate.slice(index, index + 200))
    if (error) throw error
  }

  const result = {
    schools_restored: backup.schools.length,
    data_restored: backup.schoolData.length,
    users_restored: profileRows.filter((item: any) => item.system_role !== 'master').length,
    memberships_restored: restoredMemberships.length,
    schools_removed: staleSchoolIds.length,
    users_deactivated: usersToDeactivate.length,
    missing_users: missingUsers,
  }
  const { error: auditError } = await admin.from('audit_logs').insert({
    school_id: null,
    actor_user_id: callerId,
    effective_user_id: callerId,
    action: 'restore_system_backup',
    entity: 'system',
    details: result,
  })
  if (auditError) console.error('Não foi possível registrar a auditoria da restauração:', auditError)
  return result
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = req.headers.get('Authorization') || ''
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: userError } = await caller.auth.getUser()
    if (userError || !user) return reply({ error: 'Sessão inválida.' }, 401)

    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: profile } = await admin.from('profiles').select('system_role,active').eq('id', user.id).single()
    if (!profile?.active || profile.system_role !== 'master')
      return reply({ error: 'Acesso exclusivo do Administrador Geral.' }, 403)
    const body = await req.json()

    if (body.action === 'list') {
      const [{ data: profiles, error: pe }, { data: memberships, error: me }, { data: schools, error: se }, authUsers] = await Promise.all([
        admin.from('profiles').select('*').order('full_name'),
        admin.from('memberships').select('id,user_id,school_id,role,active,school:schools(id,name,short_name,code,active)').order('created_at'),
        admin.from('schools').select('*').order('name'),
        allAuthUsers(admin),
      ])
      if (pe || me || se) throw pe || me || se
      const authMap = new Map(authUsers.map((item: any) => [item.id, item]))
      const users = (profiles || []).map((item: any) => ({
        ...item,
        email: authMap.get(item.id)?.email || '',
        memberships: (memberships || []).filter((membership: any) => membership.user_id === item.id),
      }))
      return reply({ users, schools })
    }

    if (body.action === 'export_system_backup')
      return reply({ backup: await exportSystemBackup(admin, user.id, body.app_version) })

    if (body.action === 'restore_system_backup') {
      if (body.mode !== 'replace') return reply({ error: 'Modo de restauração inválido.' }, 400)
      return reply(await restoreSystemBackup(admin, user.id, body.backup))
    }

    if (body.action === 'create') {
      const fullName = clean(body.full_name)
      const email = clean(body.email).toLocaleLowerCase('pt-BR')
      const password = String(body.password || '')
      if (!email || !password || !fullName || !body.school_id)
        return reply({ error: 'Preencha nome, e-mail, senha e escola.' }, 400)
      if (password.length < 8) return reply({ error: 'A senha precisa ter pelo menos 8 caracteres.' }, 400)
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (createError) throw createError
      const uid = created.user.id
      const { error: profileError } = await admin.from('profiles').upsert(
        { id: uid, full_name: fullName, system_role: 'user', active: body.active !== false },
        { onConflict: 'id' },
      )
      if (profileError) {
        await admin.auth.admin.deleteUser(uid)
        throw profileError
      }
      const { error: membershipError } = await admin.from('memberships').upsert(
        { user_id: uid, school_id: body.school_id, role: body.role || 'operator', active: true },
        { onConflict: 'user_id,school_id' },
      )
      if (membershipError) {
        await admin.auth.admin.deleteUser(uid)
        throw membershipError
      }
      return reply({ ok: true, user_id: uid })
    }

    if (body.action === 'add_membership') {
      if (!body.user_id || !body.school_id) return reply({ error: 'Informe usuário e escola.' }, 400)
      const { error } = await admin.from('memberships').upsert(
        { user_id: body.user_id, school_id: body.school_id, role: body.role || 'operator', active: true },
        { onConflict: 'user_id,school_id' },
      )
      if (error) throw error
      return reply({ ok: true })
    }

    if (body.action === 'update_user_details') {
      const userId = clean(body.user_id)
      const membershipId = clean(body.membership_id)
      const schoolId = clean(body.school_id)
      const fullName = clean(body.full_name)
      const email = clean(body.email).toLocaleLowerCase('pt-BR')
      const password = String(body.password || '')
      if (!userId || !membershipId || !schoolId || !fullName || !email)
        return reply({ error: 'Preencha nome, e-mail, escola e permissão.' }, 400)
      if (password && password.length < 8)
        return reply({ error: 'A nova senha precisa ter pelo menos 8 caracteres.' }, 400)
      const { data: targetProfile, error: targetError } = await admin.from('profiles').select('system_role').eq('id', userId).single()
      if (targetError) throw targetError
      if (targetProfile.system_role === 'master')
        return reply({ error: 'A conta mestre não pode ser alterada por esta ação.' }, 400)
      const { data: membership, error: membershipReadError } = await admin.from('memberships').select('id,user_id').eq('id', membershipId).single()
      if (membershipReadError) throw membershipReadError
      if (membership.user_id !== userId) return reply({ error: 'O vínculo informado não pertence ao usuário.' }, 400)
      const { data: duplicate, error: duplicateError } = await admin
        .from('memberships')
        .select('id')
        .eq('user_id', userId)
        .eq('school_id', schoolId)
        .neq('id', membershipId)
        .maybeSingle()
      if (duplicateError) throw duplicateError
      if (duplicate) return reply({ error: 'Este usuário já possui vínculo com a escola selecionada.' }, 409)
      const { data: { user: authUser }, error: authReadError } = await admin.auth.admin.getUserById(userId)
      if (authReadError) throw authReadError
      const attributes: {
        email: string
        email_confirm: boolean
        user_metadata: Record<string, unknown>
        password?: string
      } = {
        email,
        email_confirm: true,
        user_metadata: { ...(authUser?.user_metadata || {}), full_name: fullName },
      }
      if (password) attributes.password = password
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, attributes)
      if (authUpdateError) throw authUpdateError
      const { error: profileError } = await admin.from('profiles').update({ full_name: fullName, active: body.active !== false }).eq('id', userId)
      if (profileError) throw profileError
      const { error: membershipError } = await admin
        .from('memberships')
        .update({ school_id: schoolId, role: body.role || 'operator', active: true })
        .eq('id', membershipId)
        .eq('user_id', userId)
      if (membershipError) throw membershipError
      return reply({ ok: true })
    }

    if (body.action === 'update_user') {
      if (!body.user_id) return reply({ error: 'Usuário não informado.' }, 400)
      const { error: profileError } = await admin.from('profiles').update({ active: Boolean(body.active) }).eq('id', body.user_id)
      if (profileError) throw profileError
      if (body.membership_id) {
        const { error: membershipError } = await admin.from('memberships').update({ role: body.role || 'operator' }).eq('id', body.membership_id)
        if (membershipError) throw membershipError
      }
      return reply({ ok: true })
    }

    if (body.action === 'delete_user') {
      const userId = clean(body.user_id)
      if (!userId) return reply({ error: 'Usuário não informado.' }, 400)
      if (userId === user.id) return reply({ error: 'Você não pode excluir a própria conta mestre.' }, 400)
      const { data: targetProfile, error: targetError } = await admin.from('profiles').select('system_role').eq('id', userId).single()
      if (targetError) throw targetError
      if (targetProfile.system_role === 'master') return reply({ error: 'A conta mestre não pode ser excluída.' }, 400)
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) throw error
      return reply({ ok: true })
    }

    if (body.action === 'reset_password') {
      if (!body.user_id || !body.password || String(body.password).length < 8)
        return reply({ error: 'Informe usuário e senha com pelo menos 8 caracteres.' }, 400)
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password })
      if (error) throw error
      return reply({ ok: true })
    }

    if (body.action === 'set_active') {
      const { error } = await admin.from('profiles').update({ active: Boolean(body.active) }).eq('id', body.user_id)
      if (error) throw error
      return reply({ ok: true })
    }

    return reply({ error: 'Ação não reconhecida.' }, 400)
  } catch (error) {
    console.error(error)
    const message = error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)
    return reply({ error: message }, 400)
  }
})
