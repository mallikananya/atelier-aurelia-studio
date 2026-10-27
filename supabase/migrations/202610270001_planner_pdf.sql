-- One fixed planner edition; reuse dispatch, retries, fencing and atomic provenance.
alter table public.jobs drop constraint jobs_job_type_check;
alter table public.jobs add constraint jobs_job_type_check check (job_type in ('phase1_test_build','planner_pdf_v1'));
alter table public.artifacts drop constraint artifacts_role_check;
alter table public.artifacts add constraint artifacts_role_check check (role in ('phase1-test-build','planner-pdf'));

create function public.enqueue_planner_build(
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
      and job.product_id = p_product_id and job.revision_id = p_revision_id and job.job_type = 'planner_pdf_v1') then
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
    v_revision.account_id, p_product_id, p_revision_id, 'planner_pdf_v1', p_idempotency_key, v_actor_id
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
  values (v_revision.account_id, v_job_id, 'job.queued', 0, 'Planner PDF queued');

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

create or replace function private.worker_execution_context(p_job_id uuid, p_run_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb;
begin
  select jsonb_build_object(
    'jobId',j.id,'accountId',j.account_id,'productId',j.product_id,
    'revisionId',j.revision_id,'revisionName',r.name,'contentSha256',r.content_sha256,
    'jobType',j.job_type,'status',j.status,'maxAttempts',j.max_attempts
  ) into v_context
  from public.jobs j
  join public.product_revisions r on r.id=j.revision_id and r.product_id=j.product_id and r.account_id=j.account_id
  join public.workflow_bindings b on b.job_id=j.id and b.account_id=j.account_id
  where j.id=p_job_id and j.job_type in ('phase1_test_build','planner_pdf_v1') and b.provider='trigger_dev' and b.provider_run_id=p_run_id;
  if v_context is null then
    raise exception 'Job is not bound to this run' using errcode='55000';
  end if;
  return v_context;
end;
$$;

create or replace function private.worker_complete_test_build(
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
    'accounts/%s/products/%s/revisions/%s/artifacts/%s/%s',
    v_job.account_id, v_job.product_id, v_job.revision_id, p_artifact_id, case when v_job.job_type = 'planner_pdf_v1' then 'planner.pdf' else 'payload.txt' end
  );
  if p_artifact_id is null or p_attempt_id is null or p_storage_key is null
    or p_storage_bucket is null or p_storage_version_id is null or p_sha256 is null
    or p_size_bytes is null or p_media_type is null
    or p_storage_key <> v_expected_key
    or char_length(btrim(p_storage_bucket)) not between 1 and 255
    or char_length(btrim(p_storage_version_id)) not between 1 and 1024
    or p_sha256 !~ '^[a-f0-9]{64}$'
    or p_size_bytes <= 0
    or p_media_type <> (case when v_job.job_type = 'planner_pdf_v1' then 'application/pdf' else 'text/plain' end) then
    raise exception 'Invalid artifact provenance' using errcode = '22023';
  end if;

  insert into public.artifacts (
    id, account_id, product_id, revision_id, job_id, role, state,
    sha256, size_bytes, media_type, storage_bucket, storage_key, storage_version_id, available_at
  ) values (
    p_artifact_id, v_job.account_id, v_job.product_id, v_job.revision_id, p_job_id,
    case when v_job.job_type = 'planner_pdf_v1' then 'planner-pdf' else 'phase1-test-build' end, 'available', p_sha256, p_size_bytes, p_media_type, p_storage_bucket,
    p_storage_key, p_storage_version_id, now()
  );

  update public.job_attempts
  set outcome = 'succeeded', finished_at = now()
  where id = p_attempt_id and job_id = p_job_id and outcome = 'running';

  if not found then
    raise exception 'Running attempt not found' using errcode = 'P0002';
  end if;

  update public.jobs
  set status = 'succeeded', progress_percent = 100, progress_message = 'Build complete',
      finished_at = now(), updated_at = now()
  where id = p_job_id;

  insert into public.job_events (account_id, job_id, event_type, progress_percent, message, details)
  values (
    v_job.account_id, p_job_id, 'job.succeeded', 100, 'Build complete',
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


revoke all on function public.enqueue_planner_build(uuid,uuid,text) from public, anon;
grant execute on function public.enqueue_planner_build(uuid,uuid,text) to authenticated;

-- Reject idempotency collisions in both directions between editions.
create or replace function public.enqueue_phase1_test_build(
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
      and job.product_id = p_product_id and job.revision_id = p_revision_id and job.job_type = 'phase1_test_build') then
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

