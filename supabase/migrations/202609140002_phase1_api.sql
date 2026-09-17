create function private.is_account_member(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_memberships membership
    where membership.account_id = p_account_id
      and membership.user_id = auth.uid()
  );
$$;

create function private.current_account_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  select membership.account_id
  into v_account_id
  from public.account_memberships membership
  where membership.user_id = auth.uid()
  order by membership.created_at
  limit 1;

  if v_account_id is null then
    raise exception 'No account membership' using errcode = '42501';
  end if;

  return v_account_id;
end;
$$;

create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  insert into public.users (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''));

  perform pg_advisory_xact_lock(hashtextextended('atelier-aurelia-owner-bootstrap', 0));
  select account.id into v_account_id from public.accounts account order by account.created_at limit 1;

  if v_account_id is null then
    v_account_id := gen_random_uuid();
    insert into public.accounts (id, name, created_by)
    values (v_account_id, 'Atelier Aurelia', new.id);

    insert into public.account_memberships (account_id, user_id, role)
    values (v_account_id, new.id, 'owner');
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create function public.create_product_with_revision(p_name text, p_product_type text default null)
returns table (product_id uuid, revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_account_id uuid;
  v_product_id uuid := gen_random_uuid();
  v_revision_id uuid := gen_random_uuid();
  v_name text := btrim(p_name);
  v_product_type text := nullif(btrim(p_product_type), '');
  v_content jsonb;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_name is null or char_length(v_name) not between 1 and 160 then
    raise exception 'Product name must contain 1 to 160 characters' using errcode = '22023';
  end if;

  if v_product_type is not null and char_length(v_product_type) > 240 then
    raise exception 'Product type must not exceed 240 characters' using errcode = '22023';
  end if;

  v_account_id := private.current_account_id();
  v_content := jsonb_strip_nulls(jsonb_build_object(
    'schemaVersion', 'phase1.1',
    'name', v_name,
    'productType', v_product_type
  ));

  insert into public.products (id, account_id, name, product_type, created_by)
  values (v_product_id, v_account_id, v_name, v_product_type, v_actor_id);

  insert into public.product_revisions (
    id, account_id, product_id, parent_revision_id, revision_number, schema_version,
    name, product_type, content, content_sha256, created_by
  ) values (
    v_revision_id, v_account_id, v_product_id, null, 1, 'phase1.1',
    v_name, v_product_type, v_content,
    encode(extensions.digest(v_content::text, 'sha256'), 'hex'),
    v_actor_id
  );

  update public.products
  set current_revision_id = v_revision_id, updated_at = now()
  where id = v_product_id;

  insert into public.audit_events (
    account_id, actor_id, actor_type, action, target_type, target_id,
    product_id, revision_id, details
  ) values (
    v_account_id, v_actor_id, 'user', 'product.created', 'product', v_product_id,
    v_product_id, v_revision_id, jsonb_build_object('revisionId', v_revision_id)
  );

  return query select v_product_id, v_revision_id;
end;
$$;

create function public.append_product_revision(
  p_product_id uuid,
  p_expected_current_revision_id uuid,
  p_name text,
  p_product_type text,
  p_content jsonb
)
returns table (product_id uuid, revision_id uuid, revision_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_product public.products%rowtype;
  v_revision_id uuid := gen_random_uuid();
  v_revision_number integer;
  v_name text := btrim(p_name);
  v_product_type text := nullif(btrim(p_product_type), '');
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;

  if v_product.id is null or not private.is_account_member(v_product.account_id) then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  if v_product.current_revision_id is distinct from p_expected_current_revision_id then
    raise exception 'Revision conflict' using errcode = '40001';
  end if;

  if v_name is null or char_length(v_name) not between 1 and 160
    or (v_product_type is not null and char_length(v_product_type) > 240)
    or p_content is null or jsonb_typeof(p_content) <> 'object'
    or octet_length(p_content::text) > 65536 then
    raise exception 'Invalid revision content' using errcode = '22023';
  end if;

  select coalesce(max(revision.revision_number), 0) + 1
  into v_revision_number
  from public.product_revisions revision
  where revision.product_id = p_product_id;

  insert into public.product_revisions (
    id, account_id, product_id, parent_revision_id, revision_number, schema_version,
    name, product_type, content, content_sha256, created_by
  ) values (
    v_revision_id, v_product.account_id, p_product_id, p_expected_current_revision_id,
    v_revision_number, 'phase1.1', v_name, v_product_type, p_content,
    encode(extensions.digest(p_content::text, 'sha256'), 'hex'), v_actor_id
  );

  update public.products
  set name = v_name, product_type = v_product_type,
      current_revision_id = v_revision_id, updated_at = now()
  where id = p_product_id;

  insert into public.audit_events (
    account_id, actor_id, actor_type, action, target_type, target_id,
    product_id, revision_id, details
  ) values (
    v_product.account_id, v_actor_id, 'user', 'product.revision_created', 'revision', v_revision_id,
    p_product_id, v_revision_id, jsonb_build_object('productId', p_product_id, 'revisionNumber', v_revision_number)
  );

  return query select p_product_id, v_revision_id, v_revision_number;
end;
$$;

create function public.enqueue_phase1_test_build(
  p_product_id uuid,
  p_revision_id uuid,
  p_idempotency_key text
)
returns table (job_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_revision public.product_revisions%rowtype;
  v_product public.products%rowtype;
  v_job_id uuid;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;

  select * into v_revision
  from public.product_revisions
  where id = p_revision_id and product_id = p_product_id;

  if v_revision.id is null or not private.is_account_member(v_revision.account_id) then
    raise exception 'Revision not found' using errcode = 'P0002';
  end if;

  -- Serialize account-scoped idempotency keys, including requests for different products.
  perform pg_advisory_xact_lock(hashtextextended(v_revision.account_id::text || ':' || p_idempotency_key, 0));
  select job.id into v_job_id from public.jobs job
  where job.account_id = v_revision.account_id and job.idempotency_key = p_idempotency_key;
  if v_job_id is not null then
    if not exists (select 1 from public.jobs job where job.id = v_job_id
      and job.product_id = p_product_id and job.revision_id = p_revision_id) then
      raise exception 'Idempotency key belongs to different work' using errcode = '23505';
    end if;
    return query select v_job_id, false;
    return;
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if v_product.current_revision_id is distinct from p_revision_id then
    raise exception 'Only the current revision can be built' using errcode = '40001';
  end if;

  insert into public.jobs (
    account_id, product_id, revision_id, job_type, idempotency_key, created_by
  ) values (
    v_revision.account_id, p_product_id, p_revision_id, 'phase1_test_build', p_idempotency_key, v_actor_id
  )
  on conflict (account_id, idempotency_key) do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select job.id into v_job_id
    from public.jobs job
    where job.account_id = v_revision.account_id
      and job.idempotency_key = p_idempotency_key
      and job.product_id = p_product_id
      and job.revision_id = p_revision_id;

    if v_job_id is null then
      raise exception 'Idempotency key belongs to different work' using errcode = '23505';
    end if;

    return query select v_job_id, false;
    return;
  end if;

  insert into public.job_events (account_id, job_id, event_type, progress_percent, message)
  values (v_revision.account_id, v_job_id, 'job.queued', 0, 'Test build queued');

  insert into public.workflow_outbox (account_id, job_id)
  values (v_revision.account_id, v_job_id);

  insert into public.audit_events (
    account_id, actor_id, actor_type, action, target_type, target_id,
    product_id, revision_id, job_id, details
  ) values (
    v_revision.account_id, v_actor_id, 'user', 'job.enqueued', 'job', v_job_id,
    p_product_id, p_revision_id, v_job_id, jsonb_build_object('productId', p_product_id, 'revisionId', p_revision_id)
  );

  return query select v_job_id, true;
end;
$$;

create function private.worker_claim_outbox(p_worker_id uuid)
returns table (
  outbox_id uuid,
  lease_token uuid,
  job_id uuid,
  account_id uuid,
  product_id uuid,
  revision_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null then
    raise exception 'Worker identity is required' using errcode = '22023';
  end if;
  return query
  with claimable as (
    select item.id
    from public.workflow_outbox item
    join public.jobs job on job.id = item.job_id
    where item.available_at <= clock_timestamp()
      and (item.state = 'pending' or (item.state = 'leased' and item.lease_expires_at <= clock_timestamp()))
      and job.status in ('queued', 'dispatched')
    order by item.created_at
    for update skip locked
    limit 1
  ), claimed as (
  update public.workflow_outbox item
  set state = 'leased',
      leased_by = p_worker_id,
      lease_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp() + interval '2 minutes',
      dispatch_attempts = item.dispatch_attempts + 1,
      updated_at = clock_timestamp()
  from claimable
  where item.id = claimable.id
  returning item.id, item.lease_token, item.job_id
  ), dispatched_job as (
  update public.jobs job
  set status = 'dispatched',
      progress_message = 'Dispatching to durable worker',
      updated_at = clock_timestamp()
  from claimed
  where job.id = claimed.job_id and job.status = 'queued'
  returning job.account_id, job.id, job.progress_percent
  ), dispatched_event as (
  insert into public.job_events (account_id, job_id, event_type, progress_percent, message)
  select dispatched_job.account_id, dispatched_job.id, 'job.dispatched',
    dispatched_job.progress_percent, 'Dispatching to durable worker'
  from dispatched_job
  returning id
  )
  select claimed.id, claimed.lease_token, job.id, job.account_id, job.product_id, job.revision_id
  from claimed join public.jobs job on job.id = claimed.job_id;
end;
$$;

create function private.worker_bind_run(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_provider_run_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_outbox public.workflow_outbox%rowtype;
begin
  if p_provider_run_id is null or char_length(btrim(p_provider_run_id)) not between 1 and 300 then
    raise exception 'Invalid provider run' using errcode = '22023';
  end if;
  select * into v_outbox from public.workflow_outbox where id = p_outbox_id for update;
  if v_outbox.id is null or v_outbox.state <> 'leased'
    or v_outbox.lease_token is distinct from p_lease_token
    or v_outbox.lease_expires_at <= clock_timestamp() then
    raise exception 'Outbox lease is not active' using errcode = '55000';
  end if;

  select * into v_job from public.jobs where id = v_outbox.job_id for update;
  if v_job.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  insert into public.workflow_bindings (account_id, job_id, provider, provider_run_id)
  values (v_job.account_id, v_job.id, 'trigger_dev', btrim(p_provider_run_id))
  on conflict (job_id) do nothing;

  if not exists (
    select 1 from public.workflow_bindings binding
    where binding.job_id = v_job.id and binding.provider_run_id = btrim(p_provider_run_id)
  ) then
    raise exception 'Conflicting provider run' using errcode = '23505';
  end if;

  update public.jobs
  set progress_message = 'Dispatched to durable worker', updated_at = clock_timestamp()
  where id = v_job.id and status = 'dispatched';

  update public.workflow_outbox
  set state = 'delivered', delivered_at = clock_timestamp(), lease_expires_at = null,
      leased_by = null, lease_token = null, updated_at = clock_timestamp()
  where id = p_outbox_id;

  insert into public.job_events (account_id, job_id, event_type, progress_percent, message)
  values (v_job.account_id, v_job.id, 'workflow.bound', v_job.progress_percent, 'Bound to durable worker');

  insert into public.audit_events (
    account_id, actor_id, actor_type, action, target_type, target_id,
    product_id, revision_id, job_id, details
  ) values (
    v_job.account_id, null, 'system', 'job.dispatched', 'job', v_job.id,
    v_job.product_id, v_job.revision_id, v_job.id,
    jsonb_build_object('adapter', 'trigger_dev')
  );
end;
$$;

create function private.worker_release_outbox(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_retry_at timestamptz,
  p_error_summary text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.workflow_outbox%rowtype;
begin
  if p_retry_at is null then
    raise exception 'Retry time is required' using errcode = '22023';
  end if;
  update public.workflow_outbox
  set state = case when dispatch_attempts >= 10 then 'dead' else 'pending' end,
      available_at = greatest(p_retry_at, clock_timestamp()),
      last_error = left(coalesce(nullif(btrim(p_error_summary), ''), 'Dispatch failed'), 1000),
      leased_by = null, lease_token = null, lease_expires_at = null, updated_at = clock_timestamp()
  where id = p_outbox_id and state = 'leased' and lease_token = p_lease_token
    and lease_expires_at > clock_timestamp()
  returning * into v_outbox;

  if v_outbox.id is null then
    raise exception 'Outbox lease is not active' using errcode = '55000';
  end if;

  if v_outbox.state = 'dead' then
    update public.jobs
    set status = 'failed', error_code = 'dispatch_exhausted', error_summary = v_outbox.last_error,
        progress_message = 'Workflow dispatch failed', finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_outbox.job_id and status = 'dispatched';

    insert into public.job_events (account_id, job_id, event_type, progress_percent, message, details)
    select job.account_id, job.id, 'job.failed', job.progress_percent, 'Workflow dispatch failed',
      jsonb_build_object('errorCode', 'dispatch_exhausted')
    from public.jobs job where job.id = v_outbox.job_id;

    insert into public.audit_events (
      account_id, actor_id, actor_type, action, target_type, target_id,
      product_id, revision_id, job_id, details
    )
    select job.account_id, null, 'system', 'job.failed', 'job', job.id,
      job.product_id, job.revision_id, job.id,
      jsonb_build_object('errorCode', 'dispatch_exhausted')
    from public.jobs job
    where job.id = v_outbox.job_id;
  end if;
end;
$$;

create function private.worker_start_attempt(p_job_id uuid, p_provider_attempt_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_attempt_id uuid := gen_random_uuid();
  v_attempt_number integer;
  v_existing_attempt uuid;
begin
  if p_provider_attempt_id is null or char_length(btrim(p_provider_attempt_id)) not between 1 and 300 then
    raise exception 'Invalid provider attempt' using errcode = '22023';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  select attempt.id into v_existing_attempt from public.job_attempts attempt
  where attempt.job_id = p_job_id and attempt.provider_attempt_id = p_provider_attempt_id;
  if v_existing_attempt is not null then
    return v_existing_attempt;
  end if;
  if exists (select 1 from public.job_attempts where job_id = p_job_id and outcome = 'running') then
    raise exception 'An attempt is already running' using errcode = '55000';
  end if;
  if v_job.id is null or v_job.status not in ('dispatched', 'running')
    or not exists (select 1 from public.workflow_bindings where job_id = p_job_id) then
    raise exception 'Job cannot start' using errcode = '55000';
  end if;

  v_attempt_number := v_job.attempt_count + 1;
  if v_attempt_number > v_job.max_attempts then
    raise exception 'Maximum attempts exceeded' using errcode = '54000';
  end if;

  insert into public.job_attempts (
    id, account_id, job_id, attempt_number, provider_attempt_id
  ) values (
    v_attempt_id, v_job.account_id, p_job_id, v_attempt_number, p_provider_attempt_id
  );

  update public.jobs
  set status = 'running', attempt_count = v_attempt_number, started_at = coalesce(started_at, now()), finished_at = null,
      error_code = null, error_summary = null, progress_message = 'Test build running', updated_at = now()
  where id = p_job_id;

  insert into public.job_events (account_id, job_id, event_type, progress_percent, message)
  values (v_job.account_id, p_job_id, 'job.started', v_job.progress_percent, 'Test build running');

  return v_attempt_id;
end;
$$;

create function private.worker_record_progress(p_job_id uuid, p_attempt_id uuid, p_percent integer, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'running' then
    raise exception 'Job is not running' using errcode = '55000';
  end if;
  if not exists (select 1 from public.job_attempts
    where id = p_attempt_id and job_id = p_job_id and outcome = 'running') then
    raise exception 'Attempt is not running' using errcode = '55000';
  end if;
  if p_percent is null or p_message is null or p_percent < v_job.progress_percent or p_percent not between 0 and 99
    or char_length(btrim(p_message)) not between 1 and 500 then
    raise exception 'Invalid progress' using errcode = '22023';
  end if;

  update public.jobs
  set progress_percent = p_percent, progress_message = btrim(p_message), updated_at = now()
  where id = p_job_id;

  insert into public.job_events (account_id, job_id, event_type, progress_percent, message)
  values (v_job.account_id, p_job_id, 'job.progress', p_percent, btrim(p_message));
end;
$$;

create function private.worker_complete_test_build(
  p_job_id uuid,
  p_attempt_id uuid,
  p_artifact_id uuid,
  p_storage_bucket text,
  p_storage_key text,
  p_storage_version_id text,
  p_sha256 text,
  p_size_bytes bigint,
  p_media_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_expected_key text;
  v_existing public.artifacts%rowtype;
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  select * into v_existing from public.artifacts where id = p_artifact_id;

  if v_existing.id is not null then
    if v_existing.job_id = p_job_id and v_existing.storage_bucket = p_storage_bucket
      and v_existing.storage_key = p_storage_key and v_existing.storage_version_id = p_storage_version_id
      and v_existing.sha256 = p_sha256 and v_existing.size_bytes = p_size_bytes
      and v_existing.media_type = p_media_type and v_job.status = 'succeeded'
      and exists (select 1 from public.job_attempts where id = p_attempt_id
        and job_id = p_job_id and outcome = 'succeeded') then
      return p_artifact_id;
    end if;
    raise exception 'Artifact identity conflict' using errcode = '23505';
  end if;

  if v_job.id is null or v_job.status <> 'running' then
    raise exception 'Job is not running' using errcode = '55000';
  end if;

  v_expected_key := format(
    'accounts/%s/products/%s/revisions/%s/artifacts/%s/payload.txt',
    v_job.account_id, v_job.product_id, v_job.revision_id, p_artifact_id
  );
  if p_artifact_id is null or p_attempt_id is null or p_storage_key is null
    or p_storage_bucket is null or p_storage_version_id is null or p_sha256 is null
    or p_size_bytes is null or p_media_type is null
    or p_storage_key <> v_expected_key
    or char_length(btrim(p_storage_bucket)) not between 1 and 255
    or char_length(btrim(p_storage_version_id)) not between 1 and 1024
    or p_sha256 !~ '^[a-f0-9]{64}$'
    or p_size_bytes <= 0
    or p_media_type <> 'text/plain' then
    raise exception 'Invalid artifact provenance' using errcode = '22023';
  end if;

  insert into public.artifacts (
    id, account_id, product_id, revision_id, job_id, role, state,
    sha256, size_bytes, media_type, storage_bucket, storage_key, storage_version_id, available_at
  ) values (
    p_artifact_id, v_job.account_id, v_job.product_id, v_job.revision_id, p_job_id,
    'phase1-test-build', 'available', p_sha256, p_size_bytes, p_media_type, p_storage_bucket,
    p_storage_key, p_storage_version_id, now()
  );

  update public.job_attempts
  set outcome = 'succeeded', finished_at = now()
  where id = p_attempt_id and job_id = p_job_id and outcome = 'running';

  if not found then
    raise exception 'Running attempt not found' using errcode = 'P0002';
  end if;

  update public.jobs
  set status = 'succeeded', progress_percent = 100, progress_message = 'Test build complete',
      finished_at = now(), updated_at = now()
  where id = p_job_id;

  insert into public.job_events (account_id, job_id, event_type, progress_percent, message, details)
  values (
    v_job.account_id, p_job_id, 'job.succeeded', 100, 'Test build complete',
    jsonb_build_object('artifactId', p_artifact_id)
  );

  insert into public.audit_events (
    account_id, actor_id, actor_type, action, target_type, target_id,
    product_id, revision_id, job_id, details
  ) values (
    v_job.account_id, null, 'system', 'artifact.created', 'artifact', p_artifact_id,
    v_job.product_id, v_job.revision_id, p_job_id,
    jsonb_build_object('jobId', p_job_id, 'revisionId', v_job.revision_id, 'sha256', p_sha256)
  );

  insert into public.audit_events (
    account_id, actor_id, actor_type, action, target_type, target_id,
    product_id, revision_id, job_id
  ) values (
    v_job.account_id, null, 'system', 'job.succeeded', 'job', p_job_id,
    v_job.product_id, v_job.revision_id, p_job_id
  );

  return p_artifact_id;
end;
$$;

create function private.worker_fail_attempt(
  p_job_id uuid,
  p_attempt_id uuid,
  p_error_code text,
  p_error_summary text,
  p_is_final boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_is_final boolean;
  v_safe_summary text := left(coalesce(nullif(btrim(p_error_summary), ''), 'Test build failed'), 1000);
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'running' then
    raise exception 'Job is not running' using errcode = '55000';
  end if;

  if p_is_final is null or p_error_code is null or char_length(btrim(p_error_code)) not between 1 and 120 then
    raise exception 'Invalid attempt failure' using errcode = '22023';
  end if;
  v_is_final := p_is_final or v_job.attempt_count >= v_job.max_attempts;

  update public.job_attempts
  set outcome = 'failed', error_code = left(p_error_code, 120), error_summary = v_safe_summary, finished_at = now()
  where id = p_attempt_id and job_id = p_job_id and outcome = 'running';

  if not found then
    raise exception 'Running attempt not found' using errcode = 'P0002';
  end if;

  update public.jobs
  set status = case when v_is_final then 'failed' else 'running' end,
      error_code = case when v_is_final then left(p_error_code, 120) else null end,
      error_summary = case when v_is_final then v_safe_summary else null end,
      progress_message = case when v_is_final then 'Test build failed' else 'Retry scheduled' end,
      finished_at = case when v_is_final then now() else null end,
      updated_at = now()
  where id = p_job_id;

  insert into public.job_events (account_id, job_id, event_type, progress_percent, message, details)
  values (
    v_job.account_id, p_job_id,
    case when v_is_final then 'job.failed' else 'job.retry_scheduled' end,
    v_job.progress_percent,
    case when v_is_final then 'Test build failed' else 'Retry scheduled' end,
    jsonb_build_object('errorCode', left(p_error_code, 120))
  );

  if v_is_final then
    insert into public.audit_events (
      account_id, actor_id, actor_type, action, target_type, target_id,
      product_id, revision_id, job_id, details
    ) values (
      v_job.account_id, null, 'system', 'job.failed', 'job', p_job_id,
      v_job.product_id, v_job.revision_id, p_job_id,
      jsonb_build_object('errorCode', left(p_error_code, 120))
    );
  end if;
end;
$$;
