create extension if not exists pgtap with schema extensions;
begin;
select no_plan();

create temp table products_fixture (key text primary key, value uuid);
grant select, insert on products_fixture to authenticated;
create function pg_temp.product_id(text) returns uuid language sql stable
as 'select value from products_fixture where key = $1';

insert into auth.users (id, email) values
 ('61000000-0000-4000-8000-000000000001', 'products-owner@example.test'),
 ('61000000-0000-4000-8000-000000000002', 'products-other@example.test'),
 ('61000000-0000-4000-8000-000000000003', 'products-nonmember@example.test');
insert into products_fixture select 'account', account_id from public.account_memberships
where user_id = '61000000-0000-4000-8000-000000000001';
insert into public.accounts (id, name, created_by) values
 ('62000000-0000-4000-8000-000000000002', 'Other account', '61000000-0000-4000-8000-000000000002');
insert into public.account_memberships (account_id, user_id, role) values
 ('62000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', 'owner');

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.products), 0::bigint, 'new owner has an empty persisted library');
with created as (select * from public.create_product_with_revision('Soft Discipline'))
insert into products_fixture select 'product', product_id from created union all select 'revision', revision_id from created;
select is((select count(*) from public.products), 1::bigint, 'one create command persists one product');
select is((select name from public.products where id=pg_temp.product_id('product')), 'Soft Discipline', 'canonical acceptance product is persisted');
select is((select status from public.products where id=pg_temp.product_id('product')), 'idea', 'new product retains approved initial status');
select is((select account_id from public.products where id=pg_temp.product_id('product')), pg_temp.product_id('account'), 'product belongs to authorized account');
select is((select created_by from public.products where id=pg_temp.product_id('product')), '61000000-0000-4000-8000-000000000001'::uuid, 'product provenance identifies authenticated owner');
select is((select count(*) from public.product_revisions where product_id=pg_temp.product_id('product')), 1::bigint, 'create persists exactly one initial revision');
select is((select current_revision_id from public.products where id=pg_temp.product_id('product')), pg_temp.product_id('revision'), 'current pointer identifies returned immutable revision');
select is((select revision_number from public.product_revisions where id=pg_temp.product_id('revision')), 1, 'initial revision is Revision 1');
select is((select parent_revision_id from public.product_revisions where id=pg_temp.product_id('revision')), null::uuid, 'Revision 1 has no ancestor');
select is((select account_id from public.product_revisions where id=pg_temp.product_id('revision')), pg_temp.product_id('account'), 'revision shares account provenance');
select is((select created_by from public.product_revisions where id=pg_temp.product_id('revision')), '61000000-0000-4000-8000-000000000001'::uuid, 'revision records owner provenance');
select is((select schema_version from public.product_revisions where id=pg_temp.product_id('revision')), 'phase1.1', 'revision uses approved schema version');
select is((select content from public.product_revisions where id=pg_temp.product_id('revision')), '{"schemaVersion":"phase1.1","name":"Soft Discipline"}'::jsonb, 'name-only creation introduces no creative taxonomy');
select is((select content_sha256 from public.product_revisions where id=pg_temp.product_id('revision')), (select encode(extensions.digest(content::text, 'sha256'), 'hex') from public.product_revisions where id=pg_temp.product_id('revision')), 'revision hash uses authoritative PostgreSQL JSON representation');
select is((select count(*) from public.audit_events where product_id=pg_temp.product_id('product') and revision_id=pg_temp.product_id('revision') and actor_id=auth.uid() and action='product.created'), 1::bigint, 'creation has one owner-attributed audit record');
select throws_ok($$insert into public.products(account_id,name,created_by) values(pg_temp.product_id('account'),'Bypass',auth.uid())$$, '42501', null, 'owner cannot bypass closed command with product insert');
select throws_ok($$update public.product_revisions set name='Changed' where id=pg_temp.product_id('revision')$$, '42501', null, 'owner cannot mutate revision directly');
select throws_ok($$delete from public.products where id=pg_temp.product_id('product')$$, '42501', null, 'owner cannot delete product directly');
select throws_ok($$select * from public.create_product_with_revision('   ')$$, '22023', null, 'invalid creation is rejected');
select is((select count(*) from public.products), 1::bigint, 'failed creation adds no product');
select is((select count(*) from public.product_revisions), 1::bigint, 'failed creation adds no revision');

-- The existing command has no replay key: a repeated invocation creates a distinct
-- product. Pin that boundary instead of falsely claiming database idempotency.
with created as (select * from public.create_product_with_revision('Soft Discipline'))
insert into products_fixture select 'replayed_product', product_id from created union all select 'replayed_revision', revision_id from created;
select isnt(pg_temp.product_id('replayed_product'), pg_temp.product_id('product'), 'repeated creation has a distinct product identity');
select isnt(pg_temp.product_id('replayed_revision'), pg_temp.product_id('revision'), 'repeated creation has a distinct revision identity');
select is((select count(*) from public.product_revisions where product_id=pg_temp.product_id('product')), 1::bigint, 'repeated invocation never adds another initial revision to original product');
select is((select count(*) from public.product_revisions where product_id=pg_temp.product_id('replayed_product') and revision_number=1), 1::bigint, 'repeated invocation creates exactly one revision for its new product');

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.products), 0::bigint, 'other account library excludes owner products');
select is((select count(*) from public.products where id=pg_temp.product_id('product')), 0::bigint, 'known cross-account product ID reveals no row');
select is((select count(*) from public.products where id='63000000-0000-4000-8000-000000000001'), 0::bigint, 'nonexistent ID has same empty result as cross-account ID');
select is((select count(*) from public.product_revisions where id=pg_temp.product_id('revision')), 0::bigint, 'known cross-account revision ID reveals no row');
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.products), 0::bigint, 'nonmember cannot view products');
select is((select count(*) from public.product_revisions), 0::bigint, 'nonmember cannot view revision metadata');
select throws_ok($$select * from public.create_product_with_revision('Unauthorized')$$, '42501', null, 'nonmember cannot create');
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select is((select current_revision_id from public.products where id=pg_temp.product_id('product')), pg_temp.product_id('revision'), 'revisiting under owner session resolves same persisted revision');
reset role;
select throws_ok($$update public.product_revisions set content='{}'::jsonb where id=pg_temp.product_id('revision')$$, '55000', null, 'even privileged writes cannot overwrite immutable revision content');
select throws_ok($$delete from public.product_revisions where id=pg_temp.product_id('revision')$$, '55000', null, 'even privileged writes cannot remove immutable Revision 1');
select is((select count(*) from public.product_revisions where product_id=pg_temp.product_id('product')), 1::bigint, 'authorization and mutation attempts preserve exactly one initial revision');
select * from finish();
rollback;
