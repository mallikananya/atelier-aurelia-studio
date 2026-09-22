import { describe, expect, it } from 'vitest';
import { workerDatabaseConfig } from './postgres.ts';

describe('worker database configuration', () => {
  it('requires a dedicated server credential', () => {
    expect(() => workerDatabaseConfig({})).toThrow('WORKER_DATABASE_URL');
    expect(() => workerDatabaseConfig({ WORKER_DATABASE_URL: 'https://example.com' })).toThrow('PostgreSQL');
  });
  it('sets bounded database timeouts and retains TLS verification', () => {
    expect(workerDatabaseConfig({ WORKER_DATABASE_URL: 'postgresql://worker:password@db.example.com/db?sslmode=verify-full' }))
      .toMatchObject({ connectionTimeoutMillis: 10000, statement_timeout: 30000, max: 3 });
  });
});

import { vi } from 'vitest';
import type pg from 'pg';
import { PostgresWorkflowRepository } from './postgres.ts';

function setup() {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  return { client, repo: new PostgresWorkflowRepository(pool as unknown as pg.Pool) };
}
it('scopes every RPC transaction to the worker role and parameterizes IDs', async () => {
  const { client, repo } = setup();
  expect(await repo.claim('worker')).toBeNull();
  expect(client.query.mock.calls[0]).toEqual(['begin']);
  expect(client.query.mock.calls[1]).toEqual(['set local role atelier_worker']);
  expect(client.query.mock.calls[2][1]).toEqual(['worker']);
  expect(client.query).toHaveBeenLastCalledWith('commit');
  expect(client.release).toHaveBeenCalledOnce();
});
it('rolls back and releases a failed database RPC', async () => {
  const { client, repo } = setup();
  client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('db'));
  await expect(repo.claim('worker')).rejects.toThrow('db');
  expect(client.query).toHaveBeenLastCalledWith('rollback');
  expect(client.release).toHaveBeenCalledOnce();
});
it('rejects overlapping execution and destroys its session', async () => {
  const { client, repo } = setup();
  client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ acquired: false }] });
  const work = vi.fn();
  await expect(repo.withExecutionLock('job', work)).rejects.toThrow('already active');
  expect(work).not.toHaveBeenCalled();
  expect(client.release).toHaveBeenCalledWith(true);
});
it('retains one advisory lock session through execution and releases on interruption', async () => {
  const { client, repo } = setup();
  client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ acquired: true }] });
  await expect(repo.withExecutionLock('job', async (locked) => {
    await locked.fail({ jobId: 'job', attemptId: 'attempt', isFinal: false });
    throw new Error('interrupted');
  })).rejects.toThrow('interrupted');
  expect(client.query.mock.calls[2][1]).toEqual(['job', 'attempt', 'build_failed', 'Phase 1 test build failed', false]);
  expect(client.release).toHaveBeenCalledWith(true);
});
it('passes exact artifact version and the existing plain text completion media contract', async () => {
  const { client, repo } = setup();
  await repo.complete({ jobId: 'j', attemptId: 'a', artifactId: 'f', bucket: 'private',
    result: { key: 'canonical', versionId: 'exact-version', sha256: 'digest', sizeBytes: 7 } });
  expect(client.query.mock.calls[2][1]).toEqual(['j', 'a', 'f', 'private', 'canonical', 'exact-version', 'digest', 7, 'text/plain']);
});
it('rejects privileged logins and remote connections without verified TLS', () => {
  expect(() => workerDatabaseConfig({ WORKER_DATABASE_URL: 'postgresql://postgres:secret@localhost/db' })).toThrow('least-privilege');
  for (const mode of ['', '?sslmode=disable', '?sslmode=require', '?sslmode=no-verify']) {
    expect(() => workerDatabaseConfig({ WORKER_DATABASE_URL: `postgresql://worker:secret@remote/db${mode}` })).toThrow('verify-full');
  }
  expect(workerDatabaseConfig({ WORKER_DATABASE_URL: 'postgresql://worker:secret@127.0.0.1/db' })).toMatchObject({ max: 3 });
});
it('binds and releases only the leased outbox identity', async () => {
  const { client, repo } = setup();
  const claim = { outboxId: 'o', leaseToken: 'l', jobId: 'j', accountId: 'a', productId: 'p', revisionId: 'r' };
  await repo.bind(claim, 'run');
  expect(client.query.mock.calls[2][1]).toEqual(['o', 'l', 'run']);
  client.query.mockClear();
  const retryAt = new Date();
  await repo.release(claim, retryAt);
  expect(client.query.mock.calls[2][1]).toEqual(['o', 'l', retryAt, 'Workflow dispatch temporarily unavailable']);
});
it('returns database-owned context and attempt state without recreating authority', async () => {
  const { client, repo } = setup();
  const result = { state: 'succeeded', attemptId: null };
  client.query.mockResolvedValue({ rows: [{ result }] });
  expect(await repo.executionContext('job', 'run')).toBe(result);
  expect(await repo.beginExecution({ jobId: 'job', runId: 'run', attemptNumber: 2 })).toBe(result);
  expect(client.query.mock.calls[6][1]).toEqual(['job', 'run', 2]);
});
it('pages bound runs by server cursor and sends only terminal reconciliation values', async () => {
  const { client, repo } = setup();
  await repo.activeRuns();
  expect(client.query.mock.calls[2][1]).toEqual([null]);
  await repo.activeRuns('last');
  expect(client.query.mock.calls[6][1]).toEqual(['last']);
  await repo.reconcile('job', 'run', 'canceled');
  expect(client.query.mock.calls[10][1]).toEqual(['job', 'run', 'canceled']);
});
it('rejects malformed URLs without exposing the supplied value', () => {
  expect(() => workerDatabaseConfig({ WORKER_DATABASE_URL: 'secret invalid' })).toThrow('A PostgreSQL worker URL is required');
});
