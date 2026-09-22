-- Provider attempt ordinals fence interrupted workers without giving the provider
-- authority over persisted ownership, revision provenance, or artifact completion.
create table private.execution_fences (
  job_id uuid primary key references public.jobs(id),
  provider_attempt_number integer not null check (provider_attempt_number > 0),
  account_id uuid not null,
  attempt_id uuid not null,
  foreign key (attempt_id, job_id, account_id) references public.job_attempts(id, job_id, account_id)
);
revoke all on private.execution_fences from public, anon, authenticated, atelier_worker;

create function private.worker_execution_context(p_job_id uuid, p_run_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb;
begin
  select jsonb_build_object(
    'jobId',j.id,'accountId',j.account_id,'productId',j.product_id,
    'revisionId',j.revision_id,'revisionName',r.name,'contentSha256',r.content_sha256,
    'status',j.status,'maxAttempts',j.max_attempts
  ) into v_context
  from public.jobs j
  join public.product_revisions r on r.id=j.revision_id and r.product_id=j.product_id and r.account_id=j.account_id
  join public.workflow_bindings b on b.job_id=j.id and b.account_id=j.account_id
  where j.id=p_job_id and j.job_type='phase1_test_build' and b.provider='trigger_dev' and b.provider_run_id=p_run_id;
  if v_context is null then
    raise exception 'Job is not bound to this run' using errcode='55000';
  end if;
  return v_context;
end;
$$;

-- The runtime holds a per-job session advisory lock for the whole invocation.
-- This row lock additionally makes advancing the ordinal/fencing atomic with all
-- existing completion and failure functions, which also lock the database job.
create function private.worker_begin_execution(p_job_id uuid, p_run_id text, p_attempt_number integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs%rowtype;
  v_fence private.execution_fences%rowtype;
  v_attempt public.job_attempts%rowtype;
  v_attempt_id uuid;
begin
  if p_attempt_number is null or p_attempt_number < 1 or p_attempt_number > 1000 then
    raise exception 'Invalid provider attempt number' using errcode='22023';
  end if;
  select * into v_job from public.jobs where id=p_job_id for update;
  perform private.worker_execution_context(p_job_id,p_run_id);
  if v_job.status='succeeded' then
    return jsonb_build_object('state','succeeded','attemptId',null);
  end if;
  if v_job.status not in ('dispatched','running') then
    raise exception 'Job cannot execute' using errcode='55000';
  end if;
  select * into v_fence from private.execution_fences where job_id=p_job_id;
  if v_fence.job_id is not null then
    select * into v_attempt from public.job_attempts where id=v_fence.attempt_id;
    if p_attempt_number < v_fence.provider_attempt_number or
      (p_attempt_number=v_fence.provider_attempt_number and v_attempt.outcome<>'running') then
      raise exception 'Stale provider attempt' using errcode='55000';
    end if;
    if p_attempt_number=v_fence.provider_attempt_number then
      return jsonb_build_object('state','started','attemptId',v_fence.attempt_id);
    end if;
    if v_attempt.outcome='running' then
      perform private.worker_fail_attempt(p_job_id,v_attempt.id,'worker_interrupted','Worker retry superseded an interrupted attempt',false);
    end if;
  end if;
  v_attempt_id := private.worker_start_attempt(p_job_id,p_run_id || ':' || p_attempt_number::text);
  insert into private.execution_fences(job_id,account_id,provider_attempt_number,attempt_id)
  values(p_job_id,v_job.account_id,p_attempt_number,v_attempt_id)
  on conflict(job_id) do update set provider_attempt_number=excluded.provider_attempt_number,attempt_id=excluded.attempt_id;
  return jsonb_build_object('state','started','attemptId',v_attempt_id);
end;
$$;

-- Only a trusted server-side provider status lookup may invoke reconciliation.
-- Success is deliberately absent: only verified storage completion can succeed.
create function private.worker_reconcile_execution(p_job_id uuid, p_run_id text, p_terminal text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs%rowtype;
begin
  if p_terminal is null or p_terminal not in ('failed','canceled') then
    raise exception 'Invalid terminal provider state' using errcode='22023';
  end if;
  select * into v_job from public.jobs where id=p_job_id for update;
  perform private.worker_execution_context(p_job_id,p_run_id);
  if v_job.status in ('succeeded','failed','canceled') then return; end if;
  update public.job_attempts set outcome='failed',error_code='provider_' || p_terminal,
    error_summary='Durable provider run terminated',finished_at=now()
  where job_id=p_job_id and outcome='running';
  if p_terminal='canceled' and v_job.status<>'cancel_requested' then
    update public.jobs set status='cancel_requested',updated_at=now() where id=p_job_id;
  end if;
  update public.jobs set status=p_terminal,error_code='provider_' || p_terminal,
    error_summary='Durable provider run terminated',progress_message='Durable build terminated',
    finished_at=now(),updated_at=now() where id=p_job_id;
  insert into public.job_events(account_id,job_id,event_type,progress_percent,message,details)
  values(v_job.account_id,p_job_id,'job.' || p_terminal,v_job.progress_percent,'Durable build terminated',
    jsonb_build_object('errorCode','provider_' || p_terminal));
  insert into public.audit_events(account_id,actor_type,action,target_type,target_id,product_id,revision_id,job_id,details)
  values(v_job.account_id,'system','job.' || p_terminal,'job',p_job_id,v_job.product_id,v_job.revision_id,p_job_id,
    jsonb_build_object('errorCode','provider_' || p_terminal));
end;
$$;
revoke all on function private.worker_execution_context(uuid,text) from public, anon, authenticated;
revoke all on function private.worker_begin_execution(uuid,text,integer) from public, anon, authenticated;
revoke all on function private.worker_reconcile_execution(uuid,text,text) from public, anon, authenticated;
grant execute on function private.worker_execution_context(uuid,text) to atelier_worker;
grant execute on function private.worker_begin_execution(uuid,text,integer) to atelier_worker;
grant execute on function private.worker_reconcile_execution(uuid,text,text) to atelier_worker;

-- Bounded keyset scan lets the server reconciler inspect every active binding
-- without granting it direct access to jobs or tenant content.
create function private.worker_active_runs(p_after_job_id uuid default null, p_limit integer default 100)
returns table(job_id uuid, provider_run_id text, status text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid reconciliation batch size' using errcode='22023';
  end if;
  return query select j.id,b.provider_run_id,j.status from public.jobs j
  join public.workflow_bindings b on b.job_id=j.id and b.account_id=j.account_id
  where j.status in ('dispatched','running','cancel_requested') and b.provider='trigger_dev'
    and (p_after_job_id is null or j.id>p_after_job_id)
  order by j.id limit p_limit;
end;
$$;
revoke all on function private.worker_active_runs(uuid,integer) from public, anon, authenticated;
grant execute on function private.worker_active_runs(uuid,integer) to atelier_worker;
