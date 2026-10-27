-- Run once in the selected Supabase project. No client-side database writes.
create table if not exists public.dispatch_state (
  id integer primary key check (id = 1),
  revision bigint not null default 0,
  document jsonb not null default '{"rosters":{},"bookings":[],"jobs":[]}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.dispatch_state(id) values(1) on conflict do nothing;
create table if not exists public.dispatch_requests (
  request_id uuid primary key,
  revision bigint not null,
  created_at timestamptz not null default now()
);
create table if not exists public.dispatch_audit (
  id bigint generated always as identity primary key,
  revision bigint not null,
  actor text not null,
  action text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.dispatch_identity (
  id integer primary key check(id=1),
  line_user_id text,
  binding_hash text,
  binding_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.dispatch_identity(id) values(1) on conflict do nothing;
create table if not exists public.dispatch_pending (
  actor text primary key,
  code text not null,
  payload jsonb not null,
  expires_at timestamptz not null
);
alter table public.dispatch_pending enable row level security;
revoke all on public.dispatch_pending from anon,authenticated;
grant all on public.dispatch_pending to service_role;
alter table public.dispatch_state enable row level security;
alter table public.dispatch_requests enable row level security;
alter table public.dispatch_audit enable row level security;
alter table public.dispatch_identity enable row level security;
revoke all on public.dispatch_state,public.dispatch_requests,public.dispatch_audit,public.dispatch_identity from anon,authenticated;
grant all on public.dispatch_state,public.dispatch_requests,public.dispatch_audit,public.dispatch_identity to service_role;
grant usage,select on sequence public.dispatch_audit_id_seq to service_role;

create or replace function public.dispatch_commit(p_revision bigint,p_document jsonb,p_request uuid,p_actor text,p_action text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare current_row dispatch_state%rowtype; already bigint;
begin
  select * into current_row from dispatch_state where id=1 for update;
  select revision into already from dispatch_requests where request_id=p_request;
  if already is not null then return jsonb_build_object('duplicate',true,'revision',current_row.revision,'document',current_row.document); end if;
  if current_row.revision<>p_revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  if jsonb_typeof(p_document->'rosters')<>'object' or jsonb_typeof(p_document->'bookings')<>'array' or jsonb_typeof(p_document->'jobs')<>'array' then raise exception 'INVALID_DOCUMENT'; end if;
  update dispatch_state set document=p_document,revision=revision+1,updated_at=now() where id=1 returning * into current_row;
  insert into dispatch_requests(request_id,revision) values(p_request,current_row.revision);
  insert into dispatch_audit(revision,actor,action) values(current_row.revision,left(p_actor,100),left(p_action,500));
  delete from dispatch_requests where created_at<now()-interval '7 days';
  delete from dispatch_audit where created_at<now()-interval '180 days';
  return jsonb_build_object('revision',current_row.revision,'document',current_row.document);
end $$;
revoke all on function public.dispatch_commit(bigint,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.dispatch_commit(bigint,jsonb,uuid,text,text) to service_role;

create or replace function public.dispatch_bind(p_hash text,p_line_user text)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  update dispatch_identity set line_user_id=p_line_user,binding_hash=null,binding_expires_at=null,updated_at=now()
  where id=1 and binding_hash=p_hash and binding_expires_at>now();
  return found;
end $$;
revoke all on function public.dispatch_bind(text,text) from public,anon,authenticated;
grant execute on function public.dispatch_bind(text,text) to service_role;

