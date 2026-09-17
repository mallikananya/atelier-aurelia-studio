create extension if not exists pgtap with schema extensions;

begin;
select plan(33);

select has_table('public', 'users', 'users table exists');
select has_table('public', 'accounts', 'accounts table exists');
select has_table('public', 'account_memberships', 'memberships table exists');
select has_table('public', 'products', 'products table exists');
select has_table('public', 'product_revisions', 'revisions table exists');
select has_table('public', 'artifacts', 'artifacts table exists');
select has_table('public', 'artifact_lineage', 'artifact lineage table exists');
select has_table('public', 'jobs', 'jobs table exists');
select has_table('public', 'job_attempts', 'job attempts table exists');
select has_table('public', 'job_events', 'job events table exists');
select has_table('public', 'workflow_bindings', 'workflow bindings table exists');
select has_table('public', 'workflow_outbox', 'workflow outbox table exists');
select has_table('public', 'audit_events', 'audit events table exists');

select has_function('public', 'create_product_with_revision', array['text', 'text'], 'product creation RPC exists');
select has_function('public', 'append_product_revision', array['uuid', 'uuid', 'text', 'text', 'jsonb'], 'revision RPC exists');
select has_function('public', 'enqueue_phase1_test_build', array['uuid', 'uuid', 'text'], 'enqueue RPC exists');
select has_function('private', 'worker_claim_outbox', array['uuid'], 'worker claim function exists');
select has_function('private', 'worker_complete_test_build', array['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text', 'bigint', 'text'], 'worker completion function exists');

select ok((select relrowsecurity from pg_class where oid = 'public.accounts'::regclass), 'row-level security isolates accounts');
select ok((select relrowsecurity from pg_class where oid = 'public.products'::regclass), 'products have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.product_revisions'::regclass), 'revisions have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.artifacts'::regclass), 'artifacts have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.jobs'::regclass), 'jobs have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_events'::regclass), 'audit events have RLS');

select has_trigger('public', 'product_revisions', 'append_only_product_revisions', 'prior revision cannot be updated');
select has_trigger('public', 'job_attempts', 'append_only_job_attempts', 'job attempts are append-only');
select has_trigger('public', 'job_events', 'append_only_job_events', 'job events are append-only');
select has_trigger('public', 'audit_events', 'append_only_audit_events', 'audit events are append-only');
select has_trigger('public', 'artifacts', 'append_only_artifacts', 'artifacts are append-only');
select has_trigger('public', 'jobs', 'jobs_enforce_state', 'job transitions are checked');

select col_is_pk('public', 'products', 'id', 'products have stable identifiers');
select col_is_pk('public', 'product_revisions', 'id', 'revisions have stable identifiers');
select has_index('public', 'jobs', 'jobs_account_id_idempotency_key_key', 'enqueue is idempotent');

select * from finish();
rollback;
