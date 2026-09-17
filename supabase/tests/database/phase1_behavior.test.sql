create extension if not exists pgtap with schema extensions;
begin;
grant atelier_worker to postgres with inherit false;
grant usage on schema extensions to atelier_worker;
select no_plan();

-- Fixture storage is temporary and explicitly shared with the actual tested roles.
create temp table fixture (key text primary key, value uuid);
grant select, insert, update on fixture to authenticated, anon, atelier_worker;
create function pg_temp.id(text) returns uuid language sql stable as 'select value from fixture where key = $1';
create function pg_temp.sqlstate_for(command text) returns text language plpgsql as $$
begin
  execute command;
  return '00000';
exception when others then return sqlstate;
end;
$$;

-- Convert an RPC exception into a failing UUID equality assertion, keeping RED runs complete.
create function pg_temp.replay_original_job() returns uuid language plpgsql as $$
declare result uuid;
begin
  select job_id into result from public.enqueue_phase1_test_build(pg_temp.id('product_a'), pg_temp.id('revision_a'), 'm4-idempotent-key-0001');
  return result;
exception when others then return null;
end;
$$;

insert into auth.users (id, email) values
 ('10000000-0000-4000-8000-000000000001', 'm4-owner@example.test'),
 ('10000000-0000-4000-8000-000000000002', 'm4-other@example.test'),
 ('10000000-0000-4000-8000-000000000003', 'm4-nonmember@example.test');
insert into fixture select 'account_a', account_id from public.account_memberships where user_id = '10000000-0000-4000-8000-000000000001';
insert into public.accounts (id, name, created_by) values
 ('20000000-0000-4000-8000-000000000002', 'Second tenant', '10000000-0000-4000-8000-000000000002');
insert into public.account_memberships values
 ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner', now());
select is((select count(*) from public.account_memberships), 2::bigint, 'signup does not grant later users owner membership');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
with created as (select * from public.create_product_with_revision(' First product ', ' Printable '))
insert into fixture select 'product_a', product_id from created union all select 'revision_a', revision_id from created;
select is((select name from public.products where id = pg_temp.id('product_a')), 'First product', 'creation trims product name');
select is((select current_revision_id from public.products where id = pg_temp.id('product_a')), pg_temp.id('revision_a'), 'creation atomically attaches initial revision');
select is((select revision_number from public.product_revisions where id = pg_temp.id('revision_a')), 1, 'initial revision numbered one');
select is((select count(*) from public.audit_events where action = 'product.created'), 1::bigint, 'creation records audit');
select throws_ok($$update public.products set name='Bypass'$$, '42501', null, 'authenticated cannot write tables directly');
select throws_ok($$select private.worker_claim_outbox(gen_random_uuid())$$, '42501', null, 'authenticated cannot invoke worker');
with enqueued as (select * from public.enqueue_phase1_test_build(pg_temp.id('product_a'), pg_temp.id('revision_a'), 'm4-idempotent-key-0001'))
insert into fixture select 'job_a', job_id from enqueued;
select is((select job_id from public.enqueue_phase1_test_build(pg_temp.id('product_a'), pg_temp.id('revision_a'), 'm4-idempotent-key-0001')), pg_temp.id('job_a'), 'enqueue replay returns same job');
select is((select was_created from public.enqueue_phase1_test_build(pg_temp.id('product_a'), pg_temp.id('revision_a'), 'm4-idempotent-key-0001')), false, 'enqueue replay marks existing work');
with appended as (select * from public.append_product_revision(pg_temp.id('product_a'), pg_temp.id('revision_a'), 'Revised product', 'Printable', '{"schemaVersion":"phase1.1","name":"Revised product","productType":"Printable"}'))
insert into fixture select 'revision_a2', revision_id from appended;
select is((select parent_revision_id from public.product_revisions where id = pg_temp.id('revision_a2')), pg_temp.id('revision_a'), 'revision records ancestry');
select is((select name from public.product_revisions where id = pg_temp.id('revision_a')), 'First product', 'append preserves old revision');
select throws_ok($$select * from public.append_product_revision(pg_temp.id('product_a'), pg_temp.id('revision_a'), 'Stale', null, '{}')$$, '40001', null, 'optimistic revision conflict rejects stale writer');
select is(pg_temp.replay_original_job(), pg_temp.id('job_a'), 'old revision enqueue replay remains idempotent');
select throws_ok($$select * from public.enqueue_phase1_test_build(pg_temp.id('product_a'), pg_temp.id('revision_a'), 'm4-old-revision-new-key')$$, '40001', null, 'new build cannot target historical revision');
select throws_ok($$select * from public.enqueue_phase1_test_build(pg_temp.id('product_a'), pg_temp.id('revision_a2'), 'm4-idempotent-key-0001')$$, '23505', null, 'idempotency key cannot name different work');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
with created as (select * from public.create_product_with_revision('Tenant B', null))
insert into fixture select 'product_b', product_id from created union all select 'revision_b', revision_id from created;
select is((select count(*) from public.products), 1::bigint, 'tenant B sees only its product');
select is((select count(*) from public.product_revisions where product_id = pg_temp.id('product_a')), 0::bigint, 'tenant B cannot read tenant A revisions');
select is((select count(*) from public.jobs), 0::bigint, 'tenant B cannot read tenant A jobs');
select throws_ok($$select * from public.append_product_revision(pg_temp.id('product_a'), pg_temp.id('revision_a2'), 'Attack', null, '{}')$$, 'P0002', null, 'cross-tenant revision command rejected');
select throws_ok($$select * from public.enqueue_phase1_test_build(pg_temp.id('product_a'), pg_temp.id('revision_a2'), 'm4-cross-tenant-key')$$, 'P0002', null, 'cross-tenant enqueue rejected');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.products), 0::bigint, 'nonmember sees no products');
select throws_ok($$select * from public.create_product_with_revision('Unauthorized', null)$$, '42501', null, 'nonmember cannot create product');
set local role anon;
select throws_ok($$select * from public.products$$, '42501', null, 'anonymous cannot read product table');
select throws_ok($$select * from public.create_product_with_revision('Anonymous', null)$$, '42501', null, 'anonymous cannot invoke creation');
reset role;
select throws_ok($$update public.product_revisions set name='Overwrite' where id=pg_temp.id('revision_a')$$, '55000', null, 'revision immutable even for privileged writer');
select throws_ok($$delete from public.product_revisions where id=pg_temp.id('revision_a')$$, '55000', null, 'revision cannot be deleted');
select is((select count(*) from public.workflow_outbox where job_id=pg_temp.id('job_a')), 1::bigint, 'enqueue replay creates one outbox row');
select is((select count(*) from public.job_events where job_id=pg_temp.id('job_a') and event_type='job.queued'), 1::bigint, 'enqueue replay creates one queued event');
select throws_ok($$insert into public.audit_events(account_id,actor_type,action,target_type,target_id,product_id) values('20000000-0000-4000-8000-000000000002','system','test','product',pg_temp.id('product_a'),pg_temp.id('product_a'))$$, '23503', null, 'audit reference cannot cross tenants');
select throws_ok($$insert into public.audit_events(account_id,actor_type,action,target_type,target_id,revision_id) values('20000000-0000-4000-8000-000000000002','system','test','revision',pg_temp.id('revision_a'),pg_temp.id('revision_a'))$$, '23503', null, 'audit revision reference cannot cross tenants');
select throws_ok($$insert into public.audit_events(account_id,actor_type,action,target_type,target_id,job_id) values('20000000-0000-4000-8000-000000000002','system','test','job',pg_temp.id('job_a'),pg_temp.id('job_a'))$$, '23503', null, 'audit job reference cannot cross tenants');


set local role atelier_worker;
select throws_ok($$select * from public.products$$, '42501', null, 'worker has no direct product read grant');
select throws_ok($$update public.jobs set status='succeeded'$$, '42501', null, 'worker has no direct job write grant');
select throws_ok($$select * from public.create_product_with_revision('Worker bypass',null)$$, '42501', null, 'worker cannot invoke user command');
with claim as (select * from private.worker_claim_outbox('30000000-0000-4000-8000-000000000001'))
insert into fixture select 'outbox_a',outbox_id from claim union all select 'lease_a',lease_token from claim;
select is((select count(*) from private.worker_claim_outbox('30000000-0000-4000-8000-000000000002')), 0::bigint, 'active lease excludes competing claim');
reset role;
update public.workflow_outbox set lease_expires_at=now()-interval '1 second' where id=pg_temp.id('outbox_a');
set local role atelier_worker;
select throws_ok($$select private.worker_release_outbox(pg_temp.id('outbox_a'),pg_temp.id('lease_a'),now(),'Expired')$$, '55000', null, 'expired lease cannot release item');
select throws_ok($$select private.worker_bind_run(pg_temp.id('outbox_a'),pg_temp.id('lease_a'),'expired-run')$$, '55000', null, 'expired lease cannot bind run');
with claim as (select * from private.worker_claim_outbox('30000000-0000-4000-8000-000000000002'))
insert into fixture select 'lease_a2',lease_token from claim;
select isnt(pg_temp.id('lease_a2'), pg_temp.id('lease_a'), 'reclaim rotates lease token');
select throws_ok($$select private.worker_release_outbox(pg_temp.id('outbox_a'),pg_temp.id('lease_a'),now(),'Stale')$$, '55000', null, 'stale token cannot release new lease');
select throws_ok($$select private.worker_start_attempt(pg_temp.id('job_a'),'unbound-attempt')$$,'55000',null,'worker cannot start before workflow binding');
select lives_ok($$select private.worker_bind_run(pg_temp.id('outbox_a'),pg_temp.id('lease_a2'),'m4-provider-run-a')$$, 'current lease binds workflow');
insert into fixture values('attempt_a',private.worker_start_attempt(pg_temp.id('job_a'),'m4-provider-attempt-a'));
select is(private.worker_start_attempt(pg_temp.id('job_a'),'m4-provider-attempt-a'), pg_temp.id('attempt_a'), 'provider attempt replay returns same attempt');
select throws_ok($$select private.worker_start_attempt(pg_temp.id('job_a'),'m4-overlapping-attempt')$$, '55000', null, 'overlapping distinct attempt rejected');
select lives_ok($$select private.worker_record_progress(pg_temp.id('job_a'),pg_temp.id('attempt_a'),40,'Building')$$, 'worker records monotonic progress');
select throws_ok($$select private.worker_record_progress(pg_temp.id('job_a'),pg_temp.id('attempt_a'),30,'Regress')$$, '22023', null, 'progress cannot regress');
reset role;
insert into fixture values('artifact_a',gen_random_uuid());
create function pg_temp.complete_a(attempt uuid, media text) returns uuid language sql as $$
select private.worker_complete_test_build(pg_temp.id('job_a'),attempt,pg_temp.id('artifact_a'),'private-artifacts',
format('accounts/%s/products/%s/revisions/%s/artifacts/%s/payload.txt',pg_temp.id('account_a'),pg_temp.id('product_a'),pg_temp.id('revision_a'),pg_temp.id('artifact_a')),
'version-1',repeat('a',64),100,media)
$$;
set local role atelier_worker;
select throws_ok($$select pg_temp.complete_a(pg_temp.id('attempt_a'),'application/json')$$,'22023',null,'invalid completion media rejected before persistence');
reset role;
select is((select count(*) from public.artifacts where job_id=pg_temp.id('job_a')),0::bigint,'invalid completion leaves no artifact');
select is((select status from public.jobs where id=pg_temp.id('job_a')),'running','invalid completion preserves running job');
set local role atelier_worker;
select is(pg_temp.complete_a(pg_temp.id('attempt_a'),'text/plain'),pg_temp.id('artifact_a'),'completion creates artifact');
select is(pg_temp.complete_a(pg_temp.id('attempt_a'),'text/plain'),pg_temp.id('artifact_a'),'identical completion replay succeeds');
select isnt(pg_temp.sqlstate_for($$select pg_temp.complete_a(pg_temp.id('attempt_a'),'application/json')$$),'00000','completion replay rejects different media type');
select isnt(pg_temp.sqlstate_for($$select pg_temp.complete_a(gen_random_uuid(),'text/plain')$$),'00000','completion replay rejects wrong attempt');
reset role;
select is((select status from public.jobs where id=pg_temp.id('job_a')),'succeeded','completion terminalizes job');
select is((select progress_percent from public.jobs where id=pg_temp.id('job_a')),100,'completion reaches full progress');
select is((select count(*) from public.artifacts where job_id=pg_temp.id('job_a')),1::bigint,'completion replay does not duplicate artifact');
select is((select count(*) from public.job_events where job_id=pg_temp.id('job_a') and event_type='job.succeeded'),1::bigint,'completion replay does not duplicate success event');
select throws_ok($$update public.jobs set progress_message='Changed' where id=pg_temp.id('job_a')$$,'55000',null,'succeeded job immutable');
select throws_ok($$update public.artifacts set size_bytes=200 where id=pg_temp.id('artifact_a')$$,'55000',null,'artifact provenance immutable');
select throws_ok($$update public.job_attempts set error_summary='Changed' where id=pg_temp.id('attempt_a')$$,'55000',null,'terminal attempt immutable');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
insert into fixture select 'job_retry',job_id from public.enqueue_phase1_test_build(pg_temp.id('product_a'),pg_temp.id('revision_a2'),'m4-retry-exhaustion-key');
set local role atelier_worker;
with claim as (select * from private.worker_claim_outbox('30000000-0000-4000-8000-000000000001'))
insert into fixture select 'outbox_retry',outbox_id from claim union all select 'lease_retry',lease_token from claim;
select lives_ok($$select private.worker_bind_run(pg_temp.id('outbox_retry'),pg_temp.id('lease_retry'),'m4-provider-run-retry')$$,'retry job dispatched');
insert into fixture values('retry_1',private.worker_start_attempt(pg_temp.id('job_retry'),'retry-attempt-1'));
select lives_ok($$select private.worker_fail_attempt(pg_temp.id('job_retry'),pg_temp.id('retry_1'),'transient','Temporary',false)$$,'first failure schedules retry');
insert into fixture values('retry_2',private.worker_start_attempt(pg_temp.id('job_retry'),'retry-attempt-2'));
select throws_ok($$select private.worker_record_progress(pg_temp.id('job_retry'),pg_temp.id('retry_1'),20,'Stale attempt')$$,'55000',null,'failed prior attempt cannot advance active retry progress');
select lives_ok($$select private.worker_record_progress(pg_temp.id('job_retry'),pg_temp.id('retry_2'),20,'Current retry')$$,'current retry may advance progress');
select lives_ok($$select private.worker_fail_attempt(pg_temp.id('job_retry'),pg_temp.id('retry_2'),'transient','Temporary',false)$$,'second failure schedules retry');
insert into fixture values('retry_3',private.worker_start_attempt(pg_temp.id('job_retry'),'retry-attempt-3'));
select lives_ok($$select private.worker_fail_attempt(pg_temp.id('job_retry'),pg_temp.id('retry_3'),'transient','Exhausted',false)$$,'exhaustion handled even without provider final hint');
reset role;
select is((select status from public.jobs where id=pg_temp.id('job_retry')),'failed','max attempts terminalizes job');
select ok((select finished_at is not null from public.jobs where id=pg_temp.id('job_retry')),'exhausted job has finished time');
select is((select count(*) from public.job_attempts where job_id=pg_temp.id('job_retry')),3::bigint,'retry attempts preserve history');
select throws_ok($$update public.jobs set progress_message='Changed' where id=pg_temp.id('job_retry')$$,'55000',null,'failed job is terminal and immutable');
select throws_ok($$update public.job_events set message='Changed' where job_id=pg_temp.id('job_retry')$$,'55000',null,'job events append only');
select throws_ok($$delete from public.audit_events where job_id=pg_temp.id('job_retry')$$,'55000',null,'audit events append only');
select throws_ok($$update public.jobs set status='queued', progress_message='Retry requested' where id=pg_temp.id('job_retry')$$,'55000',null,'bound exhausted job cannot be stranded by direct requeue');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.artifacts),0::bigint,'other tenant cannot see completed artifact');
select is((select count(*) from public.job_attempts),0::bigint,'other tenant cannot see attempts');
select is((select count(*) from public.job_events),0::bigint,'other tenant cannot see job events');
select is((select count(*) from public.audit_events where account_id=pg_temp.id('account_a')),0::bigint,'other tenant cannot see audit history');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
-- Isolate delivered-workflow requeue from attempt exhaustion and uncleared terminal fields.
insert into fixture select 'job_delivered',job_id from public.enqueue_phase1_test_build(pg_temp.id('product_a'),pg_temp.id('revision_a2'),'m4-delivered-requeue-key');
set local role atelier_worker;
with claim as (select * from private.worker_claim_outbox('30000000-0000-4000-8000-000000000001'))
insert into fixture select 'outbox_delivered',outbox_id from claim union all select 'lease_delivered',lease_token from claim;
select private.worker_bind_run(pg_temp.id('outbox_delivered'),pg_temp.id('lease_delivered'),'m4-delivered-requeue-run');
insert into fixture values('attempt_delivered',private.worker_start_attempt(pg_temp.id('job_delivered'),'delivered-attempt-1'));
select private.worker_fail_attempt(pg_temp.id('job_delivered'),pg_temp.id('attempt_delivered'),'permanent','Final provider failure',true);
reset role;
select ok((select attempt_count < max_attempts from public.jobs where id=pg_temp.id('job_delivered')),'delivered requeue fixture retains attempt budget');
select throws_ok($$update public.jobs set status='queued', finished_at=null, error_code=null, error_summary=null where id=pg_temp.id('job_delivered')$$,'55000',null,'delivered workflow cannot be stranded even with cleared terminal fields and remaining budget');
select is((select status from public.jobs where id=pg_temp.id('job_delivered')),'failed','rejected delivered requeue leaves job failed');
select is((select state from public.workflow_outbox where id=pg_temp.id('outbox_delivered')),'delivered','rejected requeue preserves delivery receipt');
set local role authenticated;
select is((select job_id from public.enqueue_phase1_test_build(pg_temp.id('product_a'),pg_temp.id('revision_a2'),'m4-delivered-requeue-key')),pg_temp.id('job_delivered'),'failed enqueue replay returns original job');
select is((select was_created from public.enqueue_phase1_test_build(pg_temp.id('product_a'),pg_temp.id('revision_a2'),'m4-delivered-requeue-key')),false,'failed enqueue replay does not create work');
reset role;
select is((select count(*) from public.workflow_outbox where job_id=pg_temp.id('job_delivered')),1::bigint,'failed replay preserves exactly one outbox record');
select is((select state from public.workflow_outbox where job_id=pg_temp.id('job_delivered')),'delivered','failed replay does not rearm delivered work');
set local role atelier_worker;
select throws_ok($$select private.worker_bind_run(pg_temp.id('outbox_delivered'),pg_temp.id('lease_delivered'),'m4-delivered-requeue-run')$$,'55000',null,'old delivery lease cannot bind again');
select is((select count(*) from private.worker_claim_outbox('30000000-0000-4000-8000-000000000001')),0::bigint,'failed replay does not cause duplicate dispatch');
reset role;
select is((select count(*) from public.workflow_bindings where job_id=pg_temp.id('job_delivered')),1::bigint,'delivery replay preserves one workflow binding');
set local role authenticated;
insert into fixture select 'job_dispatch',job_id from public.enqueue_phase1_test_build(pg_temp.id('product_a'),pg_temp.id('revision_a2'),'m4-dispatch-exhaustion-key');
set local role atelier_worker;
with claim as (select * from private.worker_claim_outbox('30000000-0000-4000-8000-000000000001'))
insert into fixture select 'outbox_dispatch',outbox_id from claim union all select 'lease_dispatch',lease_token from claim;
reset role;
-- Nine previous dispatch failures are fixture state; the tenth real claim exhausts dispatch.
update public.workflow_outbox set dispatch_attempts=9, lease_expires_at=now()-interval '1 second'
where id=pg_temp.id('outbox_dispatch');
set local role atelier_worker;
with claim as (select * from private.worker_claim_outbox('30000000-0000-4000-8000-000000000001'))
insert into fixture select 'lease_dispatch_final',lease_token from claim;
select lives_ok($$select private.worker_release_outbox(pg_temp.id('outbox_dispatch'),pg_temp.id('lease_dispatch_final'),now(),'Dispatch exhausted')$$,'tenth dispatch failure dead letters outbox');
reset role;
select is((select state from public.workflow_outbox where id=pg_temp.id('outbox_dispatch')),'dead','exhausted dispatch enters dead state');
select is((select status from public.jobs where id=pg_temp.id('job_dispatch')),'failed','dispatch exhaustion terminalizes queued job');
select is((select error_code from public.jobs where id=pg_temp.id('job_dispatch')),'dispatch_exhausted','dispatch exhaustion records machine readable error');
select is((select count(*) from public.job_attempts where job_id=pg_temp.id('job_dispatch')),0::bigint,'dispatch exhaustion never starts worker attempt');
set local role atelier_worker;
select is((select count(*) from private.worker_claim_outbox('30000000-0000-4000-8000-000000000001')),0::bigint,'dead dispatch cannot be reclaimed');
reset role;
select throws_ok($$update public.jobs set status='queued', finished_at=null, error_code=null, error_summary=null where id=pg_temp.id('job_dispatch')$$,'55000',null,'dead dispatch must be prepared before requeue');
-- A privileged future retry command must prepare dispatch atomically, before the state transition.
update public.workflow_outbox set state='pending', dispatch_attempts=0, available_at=clock_timestamp(), last_error=null
where id=pg_temp.id('outbox_dispatch');
select lives_ok($$update public.jobs set status='queued', finished_at=null, error_code=null, error_summary=null where id=pg_temp.id('job_dispatch')$$,'prepared unbound dispatch can follow approved requeue transition');
set local role atelier_worker;
select is((select job_id from private.worker_claim_outbox('30000000-0000-4000-8000-000000000001')),pg_temp.id('job_dispatch'),'prepared requeue has a real claimable dispatch path');
select is((select count(*) from private.worker_claim_outbox('30000000-0000-4000-8000-000000000002')),0::bigint,'prepared requeue cannot be claimed twice while leased');
reset role;
select is((select count(*) from public.workflow_outbox where job_id=pg_temp.id('job_dispatch')),1::bigint,'prepared requeue reuses one outbox identity');
select * from finish();
rollback;
