-- Run only on the reviewed staging project, after all committed migrations.
-- Intentionally contains no password and cannot enable login. Re-running does not
-- disable an already activated login or rotate its secret.
begin;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'atelier_worker') then
    raise exception 'Apply the Step 1 migrations before preparing the worker';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'atelier_worker_login') then
    create role atelier_worker_login nologin noinherit nosuperuser nocreatedb
      nocreaterole noreplication nobypassrls connection limit 3;
  end if;
end $$;
grant atelier_worker to atelier_worker_login;
grant connect on database postgres to atelier_worker_login;
commit;
-- Run verify_worker.sql before setting a password or enabling LOGIN.
