-- CE-03C.2.1: bounded holder-fenced leases. No historical revision changes.
alter table private.planning_requests add column holder_token_hash bytea;
alter table private.planning_requests add column hard_deadline timestamptz;
update private.planning_requests set hard_deadline=created_at+interval '17 minutes';
alter table private.planning_requests alter column hard_deadline set not null;
alter table private.planning_requests add constraint planning_lease_deadline check(expires_at<=hard_deadline);

create function private.protect_planning_lease() returns trigger language plpgsql set search_path='' as $$
begin
  if TG_OP='INSERT' then
    new.hard_deadline := new.created_at+interval '17 minutes';
  elsif new.id is distinct from old.id or new.created_at is distinct from old.created_at
    or new.hard_deadline is distinct from old.hard_deadline
    or new.owner_id is distinct from old.owner_id or new.product_id is distinct from old.product_id
    or new.expected_revision_id is distinct from old.expected_revision_id
    or new.request_key is distinct from old.request_key
    or new.holder_token_hash is distinct from old.holder_token_hash
    or (old.completed_at is not null and new.completed_at is distinct from old.completed_at) then
    raise exception 'Immutable planning lease identity' using errcode='22023';
  end if;
  return new;
end $$;
create trigger protect_planning_lease before insert or update on private.planning_requests
for each row execute function private.protect_planning_lease();
revoke all on function private.protect_planning_lease() from public,anon,authenticated,atelier_planning_writer;
revoke all on function public.reserve_planning_request(uuid,uuid,text) from authenticated;
revoke all on function private.append_planning_revision(uuid,jsonb),private.release_planning_request(uuid) from atelier_planning_writer;

create or replace function public.reserve_planning_request(p_product_id uuid, p_expected_current_revision_id uuid, p_request_key text, p_holder_token uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_product public.products%rowtype;
  v_now timestamptz;
  v_id uuid;
begin
  if p_holder_token is null then raise exception 'Holder token required' using errcode='22023'; end if;
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_request_key is null or char_length(p_request_key) not between 1 and 128 then
    raise exception 'Invalid request identity' using errcode = '22023';
  end if;
  -- Serializes admission for this owner across products and app processes.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text, 2131));
  select * into v_product from public.products where id = p_product_id for update;
  if v_product.id is null or not exists (select 1 from public.account_memberships
    where account_id = v_product.account_id and user_id = v_actor and role = 'owner') then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  perform 1 from public.account_memberships where account_id=v_product.account_id
    and user_id=v_actor and role='owner' for share;
  if not found then raise exception 'Product not found' using errcode='P0002'; end if;
  if v_product.current_revision_id is distinct from p_expected_current_revision_id then
    raise exception 'Revision conflict' using errcode = '40001';
  end if;
  v_now := clock_timestamp();
  if exists(select 1 from private.planning_requests where owner_id=v_actor and request_key=p_request_key) then
    raise exception 'Duplicate planning request' using errcode='23505';
  end if;
  if exists(select 1 from private.planning_requests where product_id=p_product_id and completed_at is null and expires_at>v_now)
    or (select count(*) from private.planning_requests where owner_id=v_actor and completed_at is null and expires_at>v_now)>=2
    or (select count(*) from private.planning_requests where product_id=p_product_id and created_at>v_now-interval '10 minutes')>=5
    or (select count(*) from private.planning_requests where owner_id=v_actor and created_at>v_now-interval '10 minutes')>=10 then
    raise exception 'Planning request limit reached' using errcode='53300';
  end if;
  insert into private.planning_requests(owner_id,product_id,expected_revision_id,request_key,created_at,expires_at,holder_token_hash,hard_deadline)
    values(v_actor,p_product_id,p_expected_current_revision_id,p_request_key,v_now,v_now+interval '120 seconds',extensions.digest(p_holder_token::text,'sha256'),v_now+interval '17 minutes') returning id into v_id;
  return v_id;
end $$;
revoke all on function public.reserve_planning_request(uuid,uuid,text,uuid) from public, anon;
grant execute on function public.reserve_planning_request(uuid,uuid,text,uuid) to authenticated;


-- Shared validation acquires locks in reservation -> product -> membership order.
-- Wall clock is checked after every potentially blocking lock acquisition.
create function private.lock_planning_lease(p_reservation_id uuid,p_holder_token uuid)
returns private.planning_requests language plpgsql security definer set search_path='' as $$
declare r private.planning_requests%rowtype; p public.products%rowtype;
begin
  select * into r from private.planning_requests where id=p_reservation_id for update;
  if r.id is null or p_holder_token is null or r.holder_token_hash is null
    or r.holder_token_hash <> extensions.digest(p_holder_token::text,'sha256')
    or r.completed_at is not null or r.expires_at<=clock_timestamp() or r.hard_deadline<=clock_timestamp() then
    raise exception 'Invalid or expired planning reservation' using errcode='42501';
  end if;
  select * into p from public.products where id=r.product_id for update;
  perform 1 from public.account_memberships where account_id=p.account_id and user_id=r.owner_id and role='owner' for share;
  if not found then raise exception 'Product not found' using errcode='P0002'; end if;
  if r.expires_at<=clock_timestamp() or r.hard_deadline<=clock_timestamp() then
    raise exception 'Expired planning reservation' using errcode='42501';
  end if;
  if p.current_revision_id is distinct from r.expected_revision_id then
    raise exception 'Revision conflict' using errcode='40001';
  end if;
  return r;
end $$;
revoke all on function private.lock_planning_lease(uuid,uuid) from public,anon,authenticated,atelier_planning_writer;

create function private.renew_planning_request(p_reservation_id uuid,p_holder_token uuid)
returns table(expires_at timestamptz,hard_deadline timestamptz,server_now timestamptz)
language plpgsql security definer set search_path='' as $$
declare r private.planning_requests%rowtype; v_now timestamptz;
begin
  r := private.lock_planning_lease(p_reservation_id,p_holder_token);
  v_now := clock_timestamp();
  return query update private.planning_requests q
    set expires_at=least(v_now+interval '120 seconds',r.hard_deadline)
    where q.id=r.id and q.expires_at>clock_timestamp() and q.hard_deadline>clock_timestamp()
    returning q.expires_at,q.hard_deadline,v_now;
  if not found then raise exception 'Expired planning reservation' using errcode='42501'; end if;
end $$;

create function private.append_planning_revision(p_reservation_id uuid,p_holder_token uuid,p_content jsonb)
returns table(product_id uuid,revision_id uuid,revision_number integer)
language plpgsql security definer set search_path='' as $$
declare r private.planning_requests%rowtype;
begin
  r := private.lock_planning_lease(p_reservation_id,p_holder_token);
  -- Existing implementation rechecks lease immediately before insertion, while all
  -- locks remain held. expires_at<=hard_deadline makes that check fence both bounds.
  return query select * from private.append_planning_revision(p_reservation_id,p_content);
  if r.expires_at<=clock_timestamp() or r.hard_deadline<=clock_timestamp() then
    raise exception 'Expired planning reservation' using errcode='42501';
  end if;
end $$;

create function private.release_planning_request(p_reservation_id uuid,p_holder_token uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r private.planning_requests%rowtype;
begin
  select * into r from private.planning_requests where id=p_reservation_id for update;
  if r.id is null or p_holder_token is null or r.holder_token_hash is null
    or r.holder_token_hash <> extensions.digest(p_holder_token::text,'sha256') then
    raise exception 'Invalid planning holder' using errcode='42501';
  end if;
  if r.completed_at is not null then return; end if;
  perform private.lock_planning_lease(p_reservation_id,p_holder_token);
  update private.planning_requests set completed_at=clock_timestamp() where id=p_reservation_id;
end $$;
revoke all on function private.renew_planning_request(uuid,uuid),private.append_planning_revision(uuid,uuid,jsonb),private.release_planning_request(uuid,uuid) from public,anon,authenticated;
grant execute on function private.renew_planning_request(uuid,uuid),private.append_planning_revision(uuid,uuid,jsonb),private.release_planning_request(uuid,uuid) to atelier_planning_writer;

-- A delayed COMMIT must not turn an expired reservation into a completed write.
create function private.fence_planning_completion() returns trigger language plpgsql set search_path='' as $$
begin
  if new.expires_at<=clock_timestamp() or new.hard_deadline<=clock_timestamp() then
    raise exception 'Expired planning reservation at commit' using errcode='42501';
  end if;
  return null;
end $$;
revoke all on function private.fence_planning_completion() from public,anon,authenticated,atelier_planning_writer;
create constraint trigger fence_planning_completion after update on private.planning_requests
  deferrable initially deferred for each row
  when (old.completed_at is null and new.completed_at is not null)
  execute function private.fence_planning_completion();
