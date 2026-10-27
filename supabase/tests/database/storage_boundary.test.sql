begin;
grant atelier_worker to postgres with inherit false;
grant usage on schema extensions to atelier_worker;
select no_plan();

insert into auth.users(id) values ('71000000-0000-4000-8000-000000000001');
insert into public.accounts (id, name, created_by)
select '72000000-0000-4000-8000-000000000001', 'Storage fixture', '71000000-0000-4000-8000-000000000001'
where not exists (
  select 1 from public.account_memberships where user_id = '71000000-0000-4000-8000-000000000001'
);
insert into public.account_memberships (account_id, user_id, role)
select '72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'owner'
where not exists (
  select 1 from public.account_memberships where user_id = '71000000-0000-4000-8000-000000000001'
);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table storage_fixture as
select product_id, revision_id, gen_random_uuid() as artifact_id from public.create_product_with_revision('Storage boundary');
reset role;
alter table storage_fixture add column job_id uuid;
alter table storage_fixture add column attempt_id uuid;
grant select, update on storage_fixture to authenticated, atelier_worker;
set local role authenticated;
update storage_fixture set job_id = (select job_id from public.enqueue_phase1_test_build(product_id, revision_id, 'storage-boundary-acceptance'));
set local role atelier_worker;
select private.worker_bind_run(outbox_id, lease_token, 'storage-boundary-fixture') from private.worker_claim_outbox(gen_random_uuid());
update storage_fixture set attempt_id = private.worker_start_attempt(job_id, 'storage-boundary-attempt');
reset role;
-- Resolve the authorized identity as fixture administrator; the runtime worker has no table SELECT.
create temporary table storage_identity as select format('accounts/%s/products/%s/revisions/%s/artifacts/%s/payload.txt',
j.account_id,f.product_id,f.revision_id,f.artifact_id) as key from storage_fixture f join public.jobs j on j.id=f.job_id;
grant select on storage_identity to atelier_worker, authenticated;
create or replace function pg_temp.complete_storage(key_override text default null, digest text default repeat('a',64), size bigint default 12, version text default 'verified-version')
returns uuid language sql as $$
select private.worker_complete_test_build(f.job_id,f.attempt_id,f.artifact_id,'private-artifacts',
coalesce(key_override,(select key from storage_identity)),version,digest,size,'text/plain') from storage_fixture f
$$;
set local role atelier_worker;
select throws_ok($$select pg_temp.complete_storage('../../escape')$$,'22023',null,'path traversal is not canonical provenance');
select throws_ok($$select pg_temp.complete_storage('accounts/other/payload.txt')$$,'22023',null,'another identity cannot become artifact provenance');
select throws_ok($$select pg_temp.complete_storage(null,'etag-is-not-sha256')$$,'22023',null,'ETag-like value cannot substitute for SHA256');
select throws_ok($$select pg_temp.complete_storage(null,repeat('A',64))$$,'22023',null,'noncanonical digest rejected');
select throws_ok($$select pg_temp.complete_storage(null,repeat('a',64),0)$$,'22023',null,'zero byte length rejected');
select throws_ok($$select pg_temp.complete_storage(null,repeat('a',64),-1)$$,'22023',null,'negative byte length rejected');
select throws_ok($$select pg_temp.complete_storage(null,repeat('a',64),12,'')$$,'22023',null,'empty storage version rejected');
select throws_ok($$select pg_temp.complete_storage(null,repeat('a',64),12,null)$$,'22023',null,'missing storage version rejected');
reset role;
select is((select count(*) from public.artifacts where id=(select artifact_id from storage_fixture)),0::bigint,'all invalid completions leave no available metadata');
select is((select status from public.jobs where id=(select job_id from storage_fixture)),'running','invalid metadata leaves job running');
set local role authenticated;
select throws_ok($$select pg_temp.complete_storage()$$,'42501',null,'authenticated owner cannot bypass verified worker completion');
select throws_ok($$insert into public.artifacts(id) values(gen_random_uuid())$$,'42501',null,'authenticated owner cannot manufacture artifact availability');
set local role atelier_worker;
select is(pg_temp.complete_storage(),(select artifact_id from storage_fixture),'worker completion accepts exact canonical provenance');
reset role;
select is((select storage_key from public.artifacts where id=(select artifact_id from storage_fixture)),(select key from storage_identity),'available artifact retains canonical storage key');
select is((select storage_version_id from public.artifacts where id=(select artifact_id from storage_fixture)),'verified-version','available artifact retains exact object version');
select is((select revision_id from public.artifacts where id=(select artifact_id from storage_fixture)),(select revision_id from storage_fixture),'artifact belongs to exact immutable revision');
select ok((select available_at is not null from public.artifacts where id=(select artifact_id from storage_fixture)),'completion records availability timestamp');
select throws_ok($$delete from public.artifacts where id=(select artifact_id from storage_fixture)$$,'55000',null,'artifact provenance cannot be deleted');
select throws_ok($$update public.artifacts set storage_version_id='replacement' where id=(select artifact_id from storage_fixture)$$,'55000',null,'artifact storage identity cannot be replaced');
set local role authenticated;
select is((select count(*) from public.artifacts),1::bigint,'owner reads completed artifact through RLS');
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000099', true);
select is((select count(*) from public.artifacts),0::bigint,'nonmember cannot read artifact provenance');
set local role anon;
select throws_ok($$select * from public.artifacts$$,'42501',null,'anonymous cannot read artifact provenance');
reset role;
select * from finish();
rollback;
