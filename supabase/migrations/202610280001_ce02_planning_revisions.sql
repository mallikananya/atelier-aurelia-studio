-- Forward-only: preserve tables, history, grants, hashing and audit semantics.
create or replace function public.append_product_revision(
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
  v_previous public.product_revisions%rowtype;
  v_page_ids text[];
  v_retained_ids text[];
  v_previous_ids text[];
  v_uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
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

  if v_product.id is null or not exists (
    select 1 from public.account_memberships membership
    where membership.account_id = v_product.account_id
      and membership.user_id = v_actor_id and membership.role = 'owner'
  ) then
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

  select revision.* into v_previous from public.product_revisions revision
  where revision.id = v_product.current_revision_id and revision.product_id = p_product_id;

  -- Legacy revisions keep their original format. Once planning starts, every
  -- descendant must retain its identity lineage; a legacy write cannot erase it.
  if p_content ->> 'schemaVersion' = 'planning-envelope/1' then
    if jsonb_typeof(p_content -> 'revisionId') is distinct from 'string'
      or (p_content ->> 'revisionId') !~ v_uuid_pattern
      or jsonb_typeof(p_content -> 'productId') is distinct from 'string'
      or (p_content ->> 'productId') !~ v_uuid_pattern
      or jsonb_typeof(p_content -> 'parentRevisionId') is distinct from 'string'
      or (p_content ->> 'parentRevisionId') !~ v_uuid_pattern then
      raise exception 'Invalid planning identity' using errcode = '22023';
    end if;
    v_revision_id := (p_content ->> 'revisionId')::uuid;
    if p_content ->> 'revisionId' <> v_revision_id::text
      or p_content ->> 'productId' <> p_product_id::text
      or p_content ->> 'parentRevisionId' <> v_previous.id::text
      or (p_content ->> 'productId')::uuid <> p_product_id
      or (p_content ->> 'parentRevisionId')::uuid is distinct from v_previous.id
      or v_previous.id is null or v_revision_id = v_previous.id
      or p_content -> 'revisionNumber' is distinct from to_jsonb(v_revision_number)
      or exists (select 1 from public.product_revisions where id = v_revision_id) then
      raise exception 'Invalid planning lineage' using errcode = '22023';
    end if;

    -- CE-01 owns creative validation. This boundary independently enforces the
    -- persistent identities that cannot safely be trusted to an RPC caller.
    if jsonb_typeof(p_content #> '{plan,manifest,pages}') is distinct from 'array'
      or jsonb_typeof(p_content #> '{provenance,retainedPageIds}') is distinct from 'array' then
      raise exception 'Invalid planning page identities' using errcode = '22023';
    end if;
    if jsonb_array_length(p_content #> '{plan,manifest,pages}') not between 1 and 200
      or jsonb_array_length(p_content #> '{provenance,retainedPageIds}') > 200
      or exists (select 1 from jsonb_array_elements(p_content #> '{plan,manifest,pages}') page
        where jsonb_typeof(page -> 'id') is distinct from 'string'
          or char_length(page ->> 'id') not between 1 and 100
          or (page ->> 'id') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]*$')
      or exists (select 1 from jsonb_array_elements(p_content #> '{provenance,retainedPageIds}') id
        where jsonb_typeof(id) is distinct from 'string'
          or char_length(id #>> '{}') not between 1 and 100
          or (id #>> '{}') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]*$') then
      raise exception 'Invalid planning page identities' using errcode = '22023';
    end if;
    select coalesce(array_agg(page ->> 'id' order by page ->> 'id'), '{}'::text[])
      into v_page_ids from jsonb_array_elements(p_content #> '{plan,manifest,pages}') page;
    select coalesce(array_agg(id order by id), '{}'::text[]) into v_retained_ids
      from jsonb_array_elements_text(p_content #> '{provenance,retainedPageIds}') id;
    select coalesce(array_agg(page ->> 'id' order by page ->> 'id'), '{}'::text[])
      into v_previous_ids from jsonb_array_elements(
        case when v_previous.content ->> 'schemaVersion' = 'planning-envelope/1'
          then v_previous.content #> '{plan,manifest,pages}' else '[]'::jsonb end) page;
    if cardinality(v_page_ids) <> (select count(distinct id) from unnest(v_page_ids) id)
      or cardinality(v_retained_ids) <> (select count(distinct id) from unnest(v_retained_ids) id)
      or v_retained_ids is distinct from v_previous_ids
      or not (v_page_ids @> v_retained_ids) then
      raise exception 'Invalid retained page identities' using errcode = '22023';
    end if;
  elsif v_previous.content ->> 'schemaVersion' = 'planning-envelope/1'
    or coalesce(p_content ->> 'schemaVersion', '') like 'planning-envelope%' then
    raise exception 'Invalid planning envelope version' using errcode = '22023';
  end if;

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
