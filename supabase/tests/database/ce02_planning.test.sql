create extension if not exists pgtap with schema extensions;
begin;
select no_plan();

create temp table ce02_fixture (key text primary key, value uuid);
grant select, insert on ce02_fixture to authenticated;
create function pg_temp.product_id(text) returns uuid language sql stable
as 'select value from ce02_fixture where key = $1';

insert into auth.users (id, email) values
 ('61000000-0000-4000-8000-000000000001', 'products-owner@example.test'),
 ('61000000-0000-4000-8000-000000000002', 'products-other@example.test'),
 ('61000000-0000-4000-8000-000000000003', 'products-nonmember@example.test');
insert into public.accounts (id, name, created_by)
select '62000000-0000-4000-8000-000000000001', 'Products fixture', '61000000-0000-4000-8000-000000000001'
where not exists (
  select 1 from public.account_memberships where user_id = '61000000-0000-4000-8000-000000000001'
);
insert into public.account_memberships (account_id, user_id, role)
select '62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'owner'
where not exists (
  select 1 from public.account_memberships where user_id = '61000000-0000-4000-8000-000000000001'
);
insert into ce02_fixture select 'account', account_id from public.account_memberships
where user_id = '61000000-0000-4000-8000-000000000001';
insert into public.accounts (id, name, created_by) values
 ('62000000-0000-4000-8000-000000000002', 'Other account', '61000000-0000-4000-8000-000000000002');
insert into public.account_memberships (account_id, user_id, role) values
 ('62000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', 'owner');

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
with created as (select * from public.create_product_with_revision('Planning'))
insert into ce02_fixture select 'product', product_id from created union all select 'revision', revision_id from created;
reset role;
insert into public.account_memberships (account_id,user_id,role)
values(pg_temp.product_id('account'),'61000000-0000-4000-8000-000000000003','member');
create function pg_temp.envelope() returns jsonb language sql stable as $$
select jsonb_build_object('schemaVersion','planning-envelope/1','productId',pg_temp.product_id('product'),
'revisionId','64000000-0000-4000-8000-000000000001','parentRevisionId',pg_temp.product_id('revision'),'revisionNumber',2,
'plan',jsonb_build_object('manifest',jsonb_build_object('pages',jsonb_build_array(jsonb_build_object('id','cover')))),
'provenance',jsonb_build_object('retainedPageIds','[]'::jsonb))
$$;
-- Test-only trusted writer shim. Production uses CE-01 validation before this private call.
create function pg_temp.trusted_append(uuid,uuid,text,text,jsonb)
returns table(product_id uuid, revision_id uuid, revision_number integer)
language plpgsql security definer set search_path='' as $$
declare token uuid;
begin
  if $5 ->> 'schemaVersion' not like 'planning-envelope%' then
    return query select * from public.append_product_revision($1,$2,$3,$4,$5);
    return;
  end if;
  token := public.reserve_planning_request($1,$2,gen_random_uuid()::text);
  return query select * from private.append_planning_revision(token,$5);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000003',true);
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,pg_temp.envelope())$$,'P0002',null,'same-account member cannot bypass owner authorization');
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,pg_temp.envelope())$$,'P0002',null,'cross-account owner cannot append');
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select throws_ok($$select * from public.append_product_revision(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,pg_temp.envelope())$$,'22023',null,'ordinary owner cannot persist incomplete planning envelope directly');
select throws_ok($$select * from public.append_product_revision(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,pg_temp.envelope()-'schemaVersion')$$,'22023',null,'missing envelope marker cannot disguise planning as Phase 1');
select throws_ok($$select * from private.append_planning_revision(gen_random_uuid(),pg_temp.envelope())$$,'42501',null,'ordinary owner cannot execute trusted planning writer');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,jsonb_set(pg_temp.envelope(),'{productId}','"64000000-0000-4000-8000-000000000099"'))$$,'22023',null,'reject product mismatch');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,jsonb_set(pg_temp.envelope(),'{parentRevisionId}','null'))$$,'22023',null,'reject parent mismatch');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,jsonb_set(pg_temp.envelope(),'{revisionNumber}','3'))$$,'22023',null,'reject number mismatch');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,jsonb_set(pg_temp.envelope(),'{revisionId}','"invalid"'))$$,'22023',null,'reject malformed revision ID');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,jsonb_set(pg_temp.envelope(),'{schemaVersion}','"planning-envelope/2"'))$$,'22023',null,'reject unknown planning marker');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,jsonb_set(pg_temp.envelope(),'{revisionId}',to_jsonb(pg_temp.product_id('revision')::text)))$$,'22023',null,'reject reused revision identity');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,jsonb_set(pg_temp.envelope(),'{parentRevisionId}','"64000000-0000-4000-8000-000000000099"'))$$,'22023',null,'reject nonexistent parent');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,jsonb_set(pg_temp.envelope(),'{provenance,retainedPageIds}','["invented"]'))$$,'22023',null,'reject invented retained identity on first plan');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,jsonb_set(pg_temp.envelope(),'{plan,manifest,pages}','{}'))$$,'22023',null,'reject malformed manifest identity container');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,jsonb_set(pg_temp.envelope(),'{provenance,retainedPageIds}','[null]'))$$,'22023',null,'reject nonstring retained identity');
select lives_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,pg_temp.envelope())$$,'owner persists first planning revision');
select is((select id::text from public.product_revisions where product_id=pg_temp.product_id('product') and revision_number=2),'64000000-0000-4000-8000-000000000001','envelope ID is persisted row ID');
select is((select schema_version from public.product_revisions where revision_number=2 and product_id=pg_temp.product_id('product')),'phase1.1','outer persistence schema preserved');
select is((select content_sha256 from public.product_revisions where id='64000000-0000-4000-8000-000000000001'),encode(extensions.digest(pg_temp.envelope()::text,'sha256'),'hex'),'authoritative hash preserved');
select is((select count(*) from public.audit_events where revision_id='64000000-0000-4000-8000-000000000001' and action='product.revision_created'),1::bigint,'append audit preserved');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),pg_temp.product_id('revision'),'Planning',null,pg_temp.envelope())$$,'40001',null,'concurrent stale writer loses optimistic conflict');
reset role;
create function pg_temp.next_envelope() returns jsonb language sql stable as $$
select pg_temp.envelope() || jsonb_build_object('revisionId','64000000-0000-4000-8000-000000000002','parentRevisionId','64000000-0000-4000-8000-000000000001','revisionNumber',3,'provenance',jsonb_build_object('retainedPageIds',jsonb_build_array('cover')))
$$;
set local role authenticated;
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),'64000000-0000-4000-8000-000000000001','Planning',null,jsonb_set(pg_temp.next_envelope(),'{provenance,retainedPageIds}','[]'))$$,'22023',null,'reject omitted retained identity');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),'64000000-0000-4000-8000-000000000001','Planning',null,jsonb_set(pg_temp.next_envelope(),'{provenance,retainedPageIds}','["cover","cover"]'))$$,'22023',null,'reject duplicate retained identity');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),'64000000-0000-4000-8000-000000000001','Planning',null,jsonb_set(pg_temp.next_envelope(),'{plan,manifest,pages}','[{"id":"replacement"}]'))$$,'22023',null,'reject lost retained page');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),'64000000-0000-4000-8000-000000000001','Planning',null,jsonb_set(pg_temp.next_envelope(),'{plan,manifest,pages}','[{"id":"cover"},{"id":"cover"}]'))$$,'22023',null,'reject duplicate output IDs');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),'64000000-0000-4000-8000-000000000001','Planning',null,'{"schemaVersion":"phase1.1"}'::jsonb)$$,'22023',null,'reject legacy downgrade');
select lives_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),'64000000-0000-4000-8000-000000000001','Planning',null,pg_temp.next_envelope())$$,'valid retained lineage appends');
select is((select count(*) from public.product_revisions where product_id=pg_temp.product_id('product')),3::bigint,'rejected writes leave no revisions');
select is((select content from public.product_revisions where id='64000000-0000-4000-8000-000000000001'),pg_temp.envelope(),'historical envelope unchanged');
-- Phase 1 callers keep arbitrary JSON content and server-generated identity.
with created as (select * from public.create_product_with_revision('Legacy'))
insert into ce02_fixture select 'legacy_product',product_id from created union all select 'legacy_revision',revision_id from created;
select lives_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('legacy_product'),pg_temp.product_id('legacy_revision'),'Legacy edited','planner','{"schemaVersion":"phase1.1","plan":{"note":"legacy custom content"}}')$$,'legacy append remains compatible');
select is((select schema_version from public.product_revisions where product_id=pg_temp.product_id('legacy_product') and revision_number=2),'phase1.1','legacy schema unchanged');
select is((select parent_revision_id from public.product_revisions where product_id=pg_temp.product_id('legacy_product') and revision_number=2),pg_temp.product_id('legacy_revision'),'legacy ancestry unchanged');
select is((select count(*) from public.audit_events where product_id=pg_temp.product_id('legacy_product') and action='product.revision_created'),1::bigint,'legacy audit retained');
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('legacy_product'),pg_temp.product_id('legacy_revision'),'Legacy edited',null,'{}')$$,'40001',null,'legacy stale writer still conflicts');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select * from pg_temp.trusted_append(pg_temp.product_id('product'),'64000000-0000-4000-8000-000000000002','Planning',null,pg_temp.next_envelope())$$,'42501',null,'missing authentication cannot append');
select * from finish();
rollback;
