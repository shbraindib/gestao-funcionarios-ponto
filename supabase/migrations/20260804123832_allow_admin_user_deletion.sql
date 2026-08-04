alter table public.school_data
  drop constraint if exists school_data_updated_by_fkey;

alter table public.school_data
  add constraint school_data_updated_by_fkey
  foreign key (updated_by) references auth.users(id) on delete set null;

alter table public.audit_logs
  alter column actor_user_id drop not null;

alter table public.audit_logs
  drop constraint if exists audit_logs_actor_user_id_fkey;

alter table public.audit_logs
  add constraint audit_logs_actor_user_id_fkey
  foreign key (actor_user_id) references auth.users(id) on delete set null;
