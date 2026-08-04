alter table public.school_data
  add column if not exists version bigint not null default 1,
  add column if not exists updated_by_name text;

create or replace function public.touch_school_data()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.updated_by = (select auth.uid());
  select p.full_name
    into new.updated_by_name
    from public.profiles p
   where p.id = (select auth.uid());

  if tg_op = 'UPDATE' then
    new.version = old.version + 1;
  else
    new.version = coalesce(new.version, 1);
  end if;

  return new;
end;
$$;

drop trigger if exists school_data_touch on public.school_data;
create trigger school_data_touch
before insert or update on public.school_data
for each row execute function public.touch_school_data();

revoke all on function public.touch_school_data() from public;
grant execute on function public.touch_school_data() to authenticated;
