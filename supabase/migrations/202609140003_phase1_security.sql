do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'atelier_worker') then
    create role atelier_worker noinherit nologin;
  end if;
end;
$$;

alter table public.users enable row level security;
alter table public.accounts enable row level security;
alter table public.account_memberships enable row level security;
alter table public.products enable row level security;
alter table public.product_revisions enable row level security;
alter table public.artifacts enable row level security;
alter table public.artifact_lineage enable row level security;
alter table public.jobs enable row level security;
alter table public.job_attempts enable row level security;
alter table public.job_events enable row level security;
alter table public.workflow_bindings enable row level security;
alter table public.workflow_outbox enable row level security;
alter table public.audit_events enable row level security;

alter table public.users force row level security;
alter table public.accounts force row level security;
alter table public.account_memberships force row level security;
alter table public.products force row level security;
alter table public.product_revisions force row level security;
alter table public.artifacts force row level security;
alter table public.artifact_lineage force row level security;
alter table public.jobs force row level security;
alter table public.job_attempts force row level security;
alter table public.job_events force row level security;
alter table public.workflow_bindings force row level security;
alter table public.workflow_outbox force row level security;
alter table public.audit_events force row level security;

create policy users_select_self on public.users
for select to authenticated using (id = auth.uid());

create policy accounts_select_member on public.accounts
for select to authenticated using (private.is_account_member(id));

create policy memberships_select_member on public.account_memberships
for select to authenticated using (private.is_account_member(account_id));

create policy products_select_member on public.products
for select to authenticated using (private.is_account_member(account_id));

create policy revisions_select_member on public.product_revisions
for select to authenticated using (private.is_account_member(account_id));

create policy artifacts_select_member on public.artifacts
for select to authenticated using (private.is_account_member(account_id));

create policy artifact_lineage_select_member on public.artifact_lineage
for select to authenticated using (private.is_account_member(account_id));

create policy jobs_select_member on public.jobs
for select to authenticated using (private.is_account_member(account_id));

create policy job_attempts_select_member on public.job_attempts
for select to authenticated using (private.is_account_member(account_id));

create policy job_events_select_member on public.job_events
for select to authenticated using (private.is_account_member(account_id));

create policy audit_events_select_member on public.audit_events
for select to authenticated using (private.is_account_member(account_id));

revoke all on all tables in schema public from anon, authenticated;
grant select on public.users, public.accounts, public.account_memberships,
  public.products, public.product_revisions, public.artifacts, public.artifact_lineage,
  public.jobs, public.job_attempts, public.job_events, public.audit_events
to authenticated;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.create_product_with_revision(text, text) to authenticated;
grant execute on function public.append_product_revision(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.enqueue_phase1_test_build(uuid, uuid, text) to authenticated;

revoke all on schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_account_member(uuid) to authenticated;
grant usage on schema private to atelier_worker;
grant execute on function private.worker_claim_outbox(uuid) to atelier_worker;
grant execute on function private.worker_bind_run(uuid, uuid, text) to atelier_worker;
grant execute on function private.worker_release_outbox(uuid, uuid, timestamptz, text) to atelier_worker;
grant execute on function private.worker_start_attempt(uuid, text) to atelier_worker;
grant execute on function private.worker_record_progress(uuid, uuid, integer, text) to atelier_worker;
grant execute on function private.worker_complete_test_build(uuid, uuid, uuid, text, text, text, text, bigint, text) to atelier_worker;
grant execute on function private.worker_fail_attempt(uuid, uuid, text, text, boolean) to atelier_worker;
