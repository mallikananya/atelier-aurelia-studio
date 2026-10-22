-- Read-only catalog/privilege acceptance; run as the project administrator.
-- Safe before and after manual credential activation. Does not inspect passwords.
begin read only;
do $$
declare
  candidate record;
  worker_oid oid;
  login_oid oid;
begin
  select oid into worker_oid from pg_roles where rolname = 'atelier_worker';
  select oid into login_oid from pg_roles where rolname = 'atelier_worker_login';
  if worker_oid is null or login_oid is null then
    raise exception 'Required worker roles are missing';
  end if;
  if exists (select 1 from pg_roles where oid in (worker_oid, login_oid)
    and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolinherit))
    or exists (select 1 from pg_roles where oid = worker_oid and rolcanlogin) then
    raise exception 'Worker roles have unsafe role attributes';
  end if;
  if not pg_has_role(login_oid, worker_oid, 'MEMBER')
    or exists (select 1 from pg_auth_members where member = login_oid
      and (roleid <> worker_oid or admin_option or inherit_option or not set_option))
    or exists (select 1 from pg_auth_members where member = worker_oid) then
    raise exception 'Worker membership is missing or excessive';
  end if;
  if not has_database_privilege(login_oid, current_database(), 'CONNECT') then
    raise exception 'Worker login cannot connect';
  end if;
  if has_database_privilege(login_oid, current_database(), 'CREATE')
    or has_database_privilege(worker_oid, current_database(), 'CREATE')
    or exists (select 1 from pg_namespace where nspname in ('public', 'private', 'auth')
      and nspowner in (login_oid, worker_oid))
    or exists (select 1 from pg_proc
      where pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'auth'::regnamespace)
        and proowner in (login_oid, worker_oid)) then
    raise exception 'Worker must not own application functions/schemas or create schemas';
  end if;
  if has_schema_privilege(login_oid, 'public', 'CREATE')
    or has_schema_privilege(login_oid, 'private', 'CREATE')
    or has_schema_privilege(worker_oid, 'public', 'CREATE')
    or has_schema_privilege(worker_oid, 'private', 'CREATE') then
    raise exception 'Worker must not create application objects';
  end if;
  for candidate in select oid from pg_class
    where relnamespace in ('public'::regnamespace, 'private'::regnamespace, 'auth'::regnamespace)
      and relkind in ('r', 'p', 'v', 'm', 'f', 'S') loop
    if candidate.oid in (select oid from pg_class where relkind = 'S') then
      if has_sequence_privilege(login_oid, candidate.oid, 'USAGE,SELECT,UPDATE')
        or has_sequence_privilege(worker_oid, candidate.oid, 'USAGE,SELECT,UPDATE') then
        raise exception 'Worker has direct sequence privileges';
      end if;
    elsif has_table_privilege(login_oid, candidate.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege(worker_oid, candidate.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'Worker has direct application/Auth table privileges';
    end if;
  end loop;
  for candidate in select oid, proname from pg_proc where pronamespace = 'private'::regnamespace loop
    if candidate.proname like 'worker\_%' escape '\' then
      if not has_function_privilege(worker_oid, candidate.oid, 'EXECUTE') then
        raise exception 'Worker RPC grant is missing';
      end if;
    elsif has_function_privilege(worker_oid, candidate.oid, 'EXECUTE') then
      raise exception 'Worker has an unexpected private RPC grant';
    end if;
    if has_function_privilege(login_oid, candidate.oid, 'EXECUTE') then
      raise exception 'Login must SET ROLE before calling private RPCs';
    end if;
  end loop;
end $$;
select 'worker privilege assertions passed; credentials and live TLS remain separate checks' as result;
rollback;
