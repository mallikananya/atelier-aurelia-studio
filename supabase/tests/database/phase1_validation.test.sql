begin;
grant atelier_worker to postgres with inherit false;
grant usage on schema extensions to atelier_worker;
select no_plan();
insert into auth.users(id) values ('11000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok($$select public.create_product_with_revision(null)$$, '22023', null, 'NULL name fails at the RPC boundary');
select throws_ok($$select public.create_product_with_revision('   ')$$, '22023', null, 'blank name is rejected');
create temporary table validation_product as select * from public.create_product_with_revision('Validation');
select throws_ok($$select public.append_product_revision(product_id, revision_id, 'Revision', null, null) from validation_product$$,
 '22023', null, 'NULL revision content is rejected');
select throws_ok($$select public.enqueue_phase1_test_build(product_id, revision_id, null) from validation_product$$,
 '22023', null, 'NULL idempotency key is rejected');
reset role;
set local role atelier_worker;
select throws_ok($$select private.worker_claim_outbox(null)$$, '22023', null, 'NULL worker identity is rejected even when queue is empty');
reset role;
select * from finish();
rollback;
