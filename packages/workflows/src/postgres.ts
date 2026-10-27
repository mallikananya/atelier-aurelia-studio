import pg from 'pg';
import type { PoolConfig, PoolClient } from 'pg';
import type { DispatchClaim, ExecutionContext, ExecutionInput, WorkflowRepository } from './ports.ts';

export function workerDatabaseConfig(env: NodeJS.ProcessEnv): PoolConfig {
  const connectionString = env.WORKER_DATABASE_URL;
  if (!connectionString) throw new Error('WORKER_DATABASE_URL is required');
  let url: URL;
  let username: string;
  try {
    url = new URL(connectionString);
    username = decodeURIComponent(url.username);
  } catch { throw new Error('A PostgreSQL worker URL is required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('A PostgreSQL worker URL is required');
  if (['postgres', 'supabase_admin', 'service_role'].includes(username.split('.')[0])) {
    throw new Error('A dedicated least-privilege worker login is required');
  }
  if (url.hostname.endsWith('.supabase.com') && url.port === '6543') {
    throw new Error('Worker advisory locks require a direct or session pooler connection');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && url.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('Remote worker connections require sslmode=verify-full');
  }
  return { connectionString, max: 3, connectionTimeoutMillis: 10_000, statement_timeout: 30_000,
    idleTimeoutMillis: 10_000, application_name: 'atelier-phase1-worker' };
}

export function createWorkerRepository(env: NodeJS.ProcessEnv = process.env) {
  const pool = new pg.Pool(workerDatabaseConfig(env));
  // Idle connection errors must not expose connection strings or terminate the worker.
  pool.on('error', () => console.error(JSON.stringify({ event: 'worker.database.connection_failed' })));
  const repository = new PostgresWorkflowRepository(pool);
  return { repository, close: () => pool.end() };
}

export class PostgresWorkflowRepository implements WorkflowRepository {
  constructor(private readonly pool: pg.Pool, private readonly session?: PoolClient) {}

  private async query<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    if (this.session) return (await this.session.query(sql, values)).rows as T[];
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role atelier_worker');
      const result = await client.query(sql, values);
      await client.query('commit');
      return result.rows as T[];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }

  async claim(workerId: string): Promise<DispatchClaim | null> {
    const [row] = await this.query<DispatchClaim>(`select outbox_id as "outboxId", lease_token as "leaseToken",
      job_id as "jobId", account_id as "accountId", product_id as "productId", revision_id as "revisionId"
      from private.worker_claim_outbox($1::uuid)`, [workerId]);
    return row ?? null;
  }
  async bind(claim: DispatchClaim, runId: string): Promise<void> {
    await this.query('select private.worker_bind_run($1::uuid,$2::uuid,$3::text)', [claim.outboxId, claim.leaseToken, runId]);
  }
  async release(claim: DispatchClaim, retryAt: Date): Promise<void> {
    await this.query('select private.worker_release_outbox($1::uuid,$2::uuid,$3::timestamptz,$4::text)',
      [claim.outboxId, claim.leaseToken, retryAt, 'Workflow dispatch temporarily unavailable']);
  }
  async withExecutionLock<T>(jobId: string, work: (repository: WorkflowRepository) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('set role atelier_worker');
      const lock = await client.query<{ acquired: boolean }>(
        'select pg_try_advisory_lock(hashtextextended($1::text, 8)) as acquired', [jobId]);
      if (!lock.rows[0]?.acquired) throw new Error('Build execution is already active');
      return await work(new PostgresWorkflowRepository(this.pool, client));
    } finally {
      // Destroying the session releases its advisory lock even after network/SQL errors.
      client.release(true);
    }
  }
  async executionContext(jobId: string, runId: string): Promise<ExecutionContext> {
    const [row] = await this.query<{ result: ExecutionContext }>(
      'select private.worker_execution_context($1::uuid,$2::text) as result', [jobId, runId]);
    return row.result;
  }
  async beginExecution(input: ExecutionInput): Promise<{ state: 'started' | 'succeeded'; attemptId: string | null }> {
    const [row] = await this.query<{ result: { state: 'started' | 'succeeded'; attemptId: string | null } }>(
      'select private.worker_begin_execution($1::uuid,$2::text,$3::integer) as result',
      [input.jobId, input.runId, input.attemptNumber]);
    return row.result;
  }
  async complete(input: Parameters<WorkflowRepository['complete']>[0]): Promise<void> {
    await this.query('select private.worker_complete_test_build($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::bigint,$9::text)',
      [input.jobId, input.attemptId, input.artifactId, input.bucket, input.result.key,
        input.result.versionId, input.result.sha256, input.result.sizeBytes, input.mediaType ?? 'text/plain']);
  }
  async fail(input: Parameters<WorkflowRepository['fail']>[0]): Promise<void> {
    await this.query('select private.worker_fail_attempt($1::uuid,$2::uuid,$3::text,$4::text,$5::boolean)',
      [input.jobId, input.attemptId, 'build_failed', 'Phase 1 test build failed', input.isFinal]);
  }
  async activeRuns(afterJobId: string | null = null): Promise<{ jobId: string; runId: string; status: string }[]> {
    return this.query('select job_id as "jobId", provider_run_id as "runId", status from private.worker_active_runs($1::uuid,100)', [afterJobId]);
  }
  async reconcile(jobId: string, runId: string, terminal: 'failed' | 'canceled'): Promise<void> {
    await this.query('select private.worker_reconcile_execution($1::uuid,$2::text,$3::text)', [jobId, runId, terminal]);
  }
}
