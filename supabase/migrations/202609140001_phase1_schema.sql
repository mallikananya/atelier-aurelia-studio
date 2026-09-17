create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

create table public.users (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.account_memberships (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

create unique index account_memberships_single_owner_idx
on public.account_memberships(account_id)
where role = 'owner';

create table public.products (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  name text not null check (char_length(name) between 1 and 160),
  product_type text check (product_type is null or char_length(product_type) between 1 and 240),
  status text not null default 'idea'
    check (status in ('idea', 'concept', 'building', 'qa', 'ready_for_review', 'approved', 'etsy_draft', 'archived')),
  current_revision_id uuid,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, account_id)
);

create table public.product_revisions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  product_id uuid not null,
  parent_revision_id uuid,
  revision_number integer not null check (revision_number > 0),
  schema_version text not null check (schema_version = 'phase1.1'),
  name text not null check (char_length(name) between 1 and 160),
  product_type text check (product_type is null or char_length(product_type) between 1 and 240),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  unique (product_id, revision_number),
  unique (id, product_id, account_id),
  unique (id, account_id),
  foreign key (product_id, account_id) references public.products(id, account_id),
  foreign key (parent_revision_id, product_id, account_id)
    references public.product_revisions(id, product_id, account_id)
);

alter table public.products
  add constraint products_current_revision_same_product
  foreign key (current_revision_id, id, account_id)
  references public.product_revisions(id, product_id, account_id);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  product_id uuid not null,
  revision_id uuid not null,
  job_type text not null check (job_type = 'phase1_test_build'),
  status text not null default 'queued'
    check (status in ('queued', 'dispatched', 'running', 'succeeded', 'failed', 'cancel_requested', 'canceled')),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  progress_message text not null default 'Queued' check (char_length(progress_message) between 1 and 500),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  error_code text,
  error_summary text check (error_summary is null or char_length(error_summary) <= 1000),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (account_id, idempotency_key),
  unique (id, account_id),
  unique (id, account_id, product_id, revision_id),
  foreign key (revision_id, product_id, account_id)
    references public.product_revisions(id, product_id, account_id)
);

create table public.job_attempts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  job_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  provider_attempt_id text not null check (char_length(btrim(provider_attempt_id)) between 1 and 300),
  outcome text not null default 'running' check (outcome in ('running', 'succeeded', 'failed')),
  error_code text,
  error_summary text check (error_summary is null or char_length(error_summary) <= 1000),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (job_id, attempt_number),
  unique (job_id, provider_attempt_id),
  unique (id, job_id, account_id),
  foreign key (job_id, account_id) references public.jobs(id, account_id)
);

create unique index job_attempts_one_running_idx on public.job_attempts(job_id) where outcome = 'running';

create table public.job_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  job_id uuid not null,
  event_sequence bigint generated always as identity,
  event_type text not null check (char_length(event_type) between 1 and 80),
  progress_percent integer check (progress_percent is null or progress_percent between 0 and 100),
  message text not null check (char_length(message) between 1 and 500),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  unique (job_id, event_sequence),
  foreign key (job_id, account_id) references public.jobs(id, account_id)
);

create table public.workflow_bindings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  job_id uuid not null,
  provider text not null check (provider = 'trigger_dev'),
  provider_run_id text not null check (char_length(provider_run_id) between 1 and 300),
  created_at timestamptz not null default now(),
  unique (job_id),
  unique (provider, provider_run_id),
  foreign key (job_id, account_id) references public.jobs(id, account_id)
);

create table public.workflow_outbox (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  job_id uuid not null,
  message_type text not null default 'dispatch_phase1_test_build'
    check (message_type = 'dispatch_phase1_test_build'),
  state text not null default 'pending' check (state in ('pending', 'leased', 'delivered', 'dead')),
  dispatch_attempts integer not null default 0 check (dispatch_attempts >= 0),
  available_at timestamptz not null default now(),
  leased_by uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, message_type),
  foreign key (job_id, account_id) references public.jobs(id, account_id)
);

create table public.artifacts (
  id uuid primary key,
  account_id uuid not null,
  product_id uuid not null,
  revision_id uuid not null,
  job_id uuid not null,
  role text not null check (role = 'phase1-test-build'),
  state text not null default 'available' check (state = 'available'),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  media_type text not null check (char_length(media_type) between 1 and 255),
  storage_bucket text not null check (char_length(storage_bucket) between 1 and 255),
  storage_key text not null check (char_length(storage_key) between 1 and 1024),
  storage_version_id text not null check (char_length(storage_version_id) between 1 and 1024),
  created_at timestamptz not null default now(),
  available_at timestamptz,
  unique (storage_bucket, storage_key),
  unique (id, account_id),
  unique (id, account_id, product_id),
  foreign key (job_id, account_id, product_id, revision_id)
    references public.jobs(id, account_id, product_id, revision_id),
  foreign key (revision_id, product_id, account_id)
    references public.product_revisions(id, product_id, account_id)
);

create table public.artifact_lineage (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  product_id uuid not null,
  child_artifact_id uuid not null,
  parent_artifact_id uuid not null,
  relationship text not null check (char_length(relationship) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (child_artifact_id, parent_artifact_id, relationship),
  check (child_artifact_id <> parent_artifact_id),
  foreign key (child_artifact_id, account_id, product_id) references public.artifacts(id, account_id, product_id),
  foreign key (parent_artifact_id, account_id, product_id) references public.artifacts(id, account_id, product_id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  actor_id uuid references public.users(id),
  actor_type text not null check (actor_type in ('user', 'system')),
  action text not null check (char_length(action) between 1 and 120),
  target_type text not null check (char_length(target_type) between 1 and 80),
  target_id uuid not null,
  product_id uuid,
  revision_id uuid,
  job_id uuid,
  request_id text check (request_id is null or char_length(request_id) <= 200),
  payload_sha256 text check (payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 8192),
  created_at timestamptz not null default now(),
  check (
    (actor_type = 'user' and actor_id is not null)
    or (actor_type = 'system' and actor_id is null)
  ),
  foreign key (revision_id, account_id) references public.product_revisions(id, account_id),
  foreign key (product_id, account_id) references public.products(id, account_id),
  foreign key (revision_id, product_id, account_id)
    references public.product_revisions(id, product_id, account_id),
  foreign key (job_id, account_id) references public.jobs(id, account_id),
  foreign key (job_id, account_id, product_id, revision_id) references public.jobs(id, account_id, product_id, revision_id)
);

create index account_memberships_user_idx on public.account_memberships(user_id, account_id);
create index products_account_created_idx on public.products(account_id, created_at desc);
create index product_revisions_product_number_idx on public.product_revisions(product_id, revision_number desc);
create index jobs_product_created_idx on public.jobs(product_id, created_at desc);
create index job_events_job_sequence_idx on public.job_events(job_id, event_sequence);
create index workflow_outbox_dispatch_idx on public.workflow_outbox(state, available_at, lease_expires_at);
create index artifacts_revision_created_idx on public.artifacts(revision_id, created_at desc);
create index audit_events_account_created_idx on public.audit_events(account_id, created_at desc);

create function private.reject_append_only_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

create trigger append_only_product_revisions
before update or delete on public.product_revisions
for each row execute function private.reject_append_only_change();

create function private.enforce_job_attempt_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.outcome <> 'running' or new.outcome not in ('succeeded', 'failed')
    or new.id is distinct from old.id or new.job_id is distinct from old.job_id
    or new.account_id is distinct from old.account_id
    or new.attempt_number is distinct from old.attempt_number
    or new.provider_attempt_id is distinct from old.provider_attempt_id
    or new.started_at is distinct from old.started_at then
    raise exception 'job_attempts are immutable after one terminal transition' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger append_only_job_attempts
before update or delete on public.job_attempts
for each row execute function private.enforce_job_attempt_update();

create function private.enforce_job_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_transition_allowed boolean;
begin
  if new.id is distinct from old.id or new.account_id is distinct from old.account_id
    or new.product_id is distinct from old.product_id or new.revision_id is distinct from old.revision_id
    or new.job_type is distinct from old.job_type or new.idempotency_key is distinct from old.idempotency_key
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'Job identity is immutable' using errcode = '55000';
  end if;

  if old.status in ('succeeded', 'canceled') or (old.status = 'failed' and new.status <> 'queued') then
    raise exception 'Terminal jobs are immutable' using errcode = '55000';
  end if;

  -- A state change alone cannot resurrect a delivered/dead workflow. Only an
  -- unbound dispatch with a prepared outbox can be explicitly requeued.
  if old.status = 'failed' and new.status = 'queued' and (
    new.finished_at is not null or new.error_code is not null or new.error_summary is not null
    or new.attempt_count >= new.max_attempts
    or exists (select 1 from public.workflow_bindings where job_id = old.id)
    or exists (select 1 from public.job_attempts where job_id = old.id and outcome = 'running')
    or not exists (select 1 from public.workflow_outbox where job_id = old.id
      and state = 'pending' and dispatch_attempts < 10 and delivered_at is null
      and lease_token is null and lease_expires_at is null)
  ) then
    raise exception 'Retry requires a prepared unbound dispatch' using errcode = '55000';
  end if;

  if new.progress_percent < old.progress_percent then
    raise exception 'Job progress cannot decrease' using errcode = '22023';
  end if;

  v_transition_allowed := old.status = new.status or (old.status, new.status) in (
    ('queued', 'dispatched'), ('queued', 'cancel_requested'),
    ('dispatched', 'running'), ('dispatched', 'failed'), ('dispatched', 'cancel_requested'),
    ('running', 'succeeded'), ('running', 'failed'), ('running', 'cancel_requested'),
    ('failed', 'queued'),
    ('cancel_requested', 'canceled'), ('cancel_requested', 'failed')
  );

  if not v_transition_allowed or (new.status = 'succeeded' and new.progress_percent <> 100) then
    raise exception 'Invalid job state transition' using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger jobs_enforce_state
before update on public.jobs
for each row execute function private.enforce_job_update();

create trigger append_only_job_events
before update or delete on public.job_events
for each row execute function private.reject_append_only_change();

create trigger append_only_audit_events
before update or delete on public.audit_events
for each row execute function private.reject_append_only_change();

create trigger append_only_artifact_lineage
before update or delete on public.artifact_lineage
for each row execute function private.reject_append_only_change();

create trigger append_only_artifacts
before update or delete on public.artifacts
for each row execute function private.reject_append_only_change();

create trigger append_only_workflow_bindings
before update or delete on public.workflow_bindings
for each row execute function private.reject_append_only_change();
