alter table public.memberships
  drop constraint if exists memberships_role_check;

alter table public.memberships
  add constraint memberships_role_check
  check (role in (
    'admin',
    'operator',
    'consulta',
    'director_admin',
    'tech_admin',
    'director_view',
    'tech_view'
  ));

create or replace function public.has_school_role(
  target_school uuid,
  allowed_roles text[] default array[
    'admin',
    'operator',
    'consulta',
    'director_admin',
    'tech_admin',
    'director_view',
    'tech_view'
  ]
)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_system_master() or exists(
    select 1
      from public.memberships m
      join public.profiles p on p.id = m.user_id
     where m.user_id = auth.uid()
       and m.school_id = target_school
       and m.active = true
       and p.active = true
       and m.role = any(allowed_roles)
  )
$$;

create or replace function public.update_school_tasks(
  target_school uuid,
  expected_version bigint,
  next_tasks jsonb
)
returns table(
  version bigint,
  updated_at timestamptz,
  updated_by uuid,
  updated_by_name text
)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  caller uuid := auth.uid();
  current_version bigint;
begin
  if caller is null then
    raise exception 'Sessao invalida.';
  end if;

  if not exists(select 1 from public.profiles p where p.id = caller and p.active = true) then
    raise exception 'Usuario inativo ou sem perfil.';
  end if;

  if not public.has_school_role(target_school, array[
    'admin',
    'operator',
    'consulta',
    'director_admin',
    'tech_admin',
    'director_view',
    'tech_view'
  ]) then
    raise exception 'Voce nao possui acesso a esta escola.';
  end if;

  if jsonb_typeof(next_tasks) <> 'array' then
    raise exception 'A lista de tarefas e invalida.';
  end if;

  if jsonb_array_length(next_tasks) > 300 then
    raise exception 'A lista de tarefas excede o limite seguro.';
  end if;

  if exists(
    select 1
      from jsonb_array_elements(next_tasks) as task(item)
     where jsonb_typeof(task.item) <> 'object'
        or length(coalesce(task.item->>'title','')) < 1
        or length(coalesce(task.item->>'title','')) > 140
        or coalesce(task.item->>'priority','baixa') not in ('baixa','media','alta')
  ) then
    raise exception 'Uma ou mais tarefas possuem dados invalidos.';
  end if;

  update public.school_data sd
     set payload = jsonb_set(coalesce(sd.payload, '{}'::jsonb), '{tasks}', next_tasks, true)
   where sd.school_id = target_school
     and sd.version = expected_version
  returning sd.version, sd.updated_at, sd.updated_by, sd.updated_by_name
       into version, updated_at, updated_by, updated_by_name;

  if not found then
    select sd.version
      into current_version
      from public.school_data sd
     where sd.school_id = target_school;

    if current_version is null then
      raise exception 'Dados da escola nao encontrados.';
    end if;

    raise exception 'Os dados foram alterados por outro usuario. Recarregue a unidade antes de salvar tarefas.';
  end if;

  insert into public.audit_logs(
    school_id,
    actor_user_id,
    effective_user_id,
    action,
    entity,
    details
  ) values (
    target_school,
    caller,
    caller,
    'update_school_tasks',
    'tasks',
    jsonb_build_object('data_version', version, 'task_count', jsonb_array_length(next_tasks))
  );

  return next;
end;
$$;

revoke all on function public.update_school_tasks(uuid,bigint,jsonb) from public;
grant execute on function public.update_school_tasks(uuid,bigint,jsonb) to authenticated;

drop policy if exists school_data_insert on public.school_data;
drop policy if exists school_data_update on public.school_data;

create policy school_data_insert on public.school_data
  for insert to authenticated
  with check (public.has_school_role(school_id,array[
    'admin',
    'operator',
    'director_admin',
    'tech_admin'
  ]));

create policy school_data_update on public.school_data
  for update to authenticated
  using (public.has_school_role(school_id,array[
    'admin',
    'operator',
    'director_admin',
    'tech_admin'
  ]))
  with check (public.has_school_role(school_id,array[
    'admin',
    'operator',
    'director_admin',
    'tech_admin'
  ]));

revoke all on function public.has_school_role(uuid,text[]) from public;
grant execute on function public.has_school_role(uuid,text[]) to authenticated;
