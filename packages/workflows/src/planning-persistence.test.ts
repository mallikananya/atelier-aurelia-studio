import { describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { planProduct } from '../../ai/src/planning.ts';
import { readingPlan, planningRequest } from '../../ai/src/fixtures/planning.ts';
import { createPlanningPersistence, planningDatabaseConfig, PostgresPlanningPersistence } from './planning-persistence.ts';

const reservation = '50000000-0000-4000-8000-000000000001';
function setup() {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client), end: vi.fn().mockResolvedValue(undefined) };
  return { client, pool, persistence: new PostgresPlanningPersistence(pool as unknown as pg.Pool) };
}
async function envelope() {
  const result = await planProduct({ generate: async () => JSON.stringify(readingPlan) }, planningRequest);
  if (!result.ok) throw new Error('Invalid fixture');
  return result.envelope;
}
describe('trusted planning persistence', () => {
  it('rejects invalid content and reservation identities before opening SQL connections', async () => {
    const { pool, persistence } = setup();
    for (const content of [{}, { schemaVersion: 'planning-envelope/1' }, { ...await envelope(), plan: {} }]) {
      await expect(persistence.save(reservation, content)).rejects.toMatchObject({ code: '22023' });
    }
    await expect(persistence.save('invalid', await envelope())).rejects.toMatchObject({ code: '22023' });
    await expect(persistence.release('invalid')).rejects.toMatchObject({ code: '22023' });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('rejects semantic planning defects at the trusted boundary without any SQL', async () => {
    const { pool, persistence } = setup();
    const valid = await envelope();
    const plan = valid.plan;
    const invalid = [
      { ...valid, unexpected: true },
      { ...valid, plan: { ...plan, brief: { ...plan.brief, name: " " } } },
      { ...valid, plan: { ...plan, visualDNA: { ...plan.visualDNA, mood: [] } } },
      { ...valid, plan: { ...plan, deliverables: { ...plan.deliverables, items: [] } } },
      { ...valid, plan: { ...plan, manifest: { ...plan.manifest, targetPageCount: 200 } } },
      { ...valid, plan: { ...plan, manifest: { ...plan.manifest, pages: plan.manifest.pages.map(
        (page, index) => index === 0 ? { ...page, dependsOnPageIds: [page.id] } : page) } } },
      { ...valid, plan: { ...plan, manifest: { ...plan.manifest, pages: plan.manifest.pages.map(
        (page, index) => index === 0 ? { ...page, sourceIds: ['unknown-source'] } : page) } } },
      { ...valid, provenance: { ...valid.provenance, attempts: 4 } },
      { ...valid, provenance: { ...valid.provenance, retainedPageIds: ['unknown-page'] } },
    ];
    for (const content of invalid) await expect(persistence.save(reservation, content)).rejects.toMatchObject({ code: '22023' });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('validates a snapshot and parameterizes writes inside the restricted role transaction', async () => {
    const { client, persistence } = setup();
    const content = await envelope();
    const rows = [{ product_id: content.productId, revision_id: content.revisionId, revision_number: 1 }];
    client.query.mockResolvedValue({ rows });
    expect(await persistence.save(reservation, content)).toEqual(rows);
    expect(client.query.mock.calls).toEqual([
      ['begin'], ['set local role atelier_planning_writer'],
      ['select * from private.append_planning_revision($1::uuid,$2::jsonb)', [reservation, JSON.stringify(content)]], ['commit'],
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('preserves SQL conflict codes and releases a failed transaction', async () => {
    const { client, persistence } = setup();
    const failure = Object.assign(new Error('conflict'), { code: '40001' });
    client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(failure);
    await expect(persistence.save(reservation, await envelope())).rejects.toBe(failure);
    expect(client.query).toHaveBeenLastCalledWith('rollback');
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('discards broken connections without masking the original error', async () => {
    const { client, persistence } = setup();
    const failure = Object.assign(new Error('unavailable'), { code: '08006' });
    client.query.mockRejectedValue(failure);
    await expect(persistence.release(reservation)).rejects.toBe(failure);
    expect(client.release).toHaveBeenCalledWith(true);
  });
  it('releases only the reservation and closes its pool', async () => {
    const { client, pool, persistence } = setup();
    await persistence.release(reservation);
    expect(client.query.mock.calls[2]).toEqual(['select private.release_planning_request($1::uuid)', [reservation]]);
    await persistence.close();
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
describe('planning database configuration', () => {
  it('requires dedicated credentials without a service-role fallback', () => {
    expect(() => planningDatabaseConfig({ SUPABASE_SERVICE_ROLE_KEY: 'secret' })).toThrow('PLANNING_DATABASE_URL');
    for (const value of ['secret', 'https://host', 'postgresql://%ZZ:secret@localhost/db']) {
      expect(() => planningDatabaseConfig({ PLANNING_DATABASE_URL: value })).toThrow('PostgreSQL');
    }
    for (const role of ['postgres', 'supabase_admin', 'service_role', 'postgres.project', '']) {
      expect(() => planningDatabaseConfig({ PLANNING_DATABASE_URL: `postgresql://${role}:secret@localhost/db` })).toThrow('least-privilege');
    }
  });
  it('requires verified TLS outside loopback and bounds connection resources', () => {
    for (const suffix of ['', '?sslmode=require', '?sslmode=disable']) {
      expect(() => planningDatabaseConfig({ PLANNING_DATABASE_URL: `postgresql://planner:secret@database/db${suffix}` })).toThrow('verify-full');
    }
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'database']) {
      expect(planningDatabaseConfig({ PLANNING_DATABASE_URL: `postgresql://planner:secret@${host}/db?sslmode=verify-full` }))
        .toMatchObject({ max: 3, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
    }
  });
});

it('handles idle database errors without exposing credentials', async () => {
  const on = vi.fn();
  const end = vi.fn().mockResolvedValue(undefined);
  const constructor = vi.spyOn(pg, 'Pool').mockImplementation(function () {
    return { on, end } as unknown as pg.Pool;
  });
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const persistence = createPlanningPersistence({ PLANNING_DATABASE_URL: 'postgresql://planner:secret@localhost/db' });
    expect(on.mock.calls[0][0]).toBe('error');
    on.mock.calls[0][1](new Error('secret credential'));
    expect(log).toHaveBeenCalledExactlyOnceWith('{"event":"planning.database.connection_failed"}');
    await persistence.close();
    expect(end).toHaveBeenCalledOnce();
  } finally { constructor.mockRestore(); log.mockRestore(); }
});

it('permits only explicitly trusted Docker hostnames without TLS', () => {
  for (const host of ['db', 'host.docker.internal', 'supabase_db_atelier-aurelia-studio']) {
    const env = { PLANNING_DATABASE_URL: `postgresql://planner:secret@${host}/db` };
    expect(() => planningDatabaseConfig(env)).toThrow('verify-full');
    expect(planningDatabaseConfig({ ...env, PLANNING_DATABASE_LOCAL_DOCKER: '1' })).toMatchObject({ max: 3 });
    expect(() => planningDatabaseConfig({ ...env, PLANNING_DATABASE_LOCAL_DOCKER: 'true' })).toThrow('verify-full');
  }
  expect(() => planningDatabaseConfig({ PLANNING_DATABASE_URL: 'postgresql://planner:secret@remote/db',
    PLANNING_DATABASE_LOCAL_DOCKER: '1' })).toThrow('verify-full');
});
it('rejects connection overrides in URL query parameters', () => {
  for (const key of ['user', 'password', 'host', 'port', 'database', 'options']) {
    expect(() => planningDatabaseConfig({ PLANNING_DATABASE_URL:
      `postgresql://planner:secret@localhost/db?${key}=postgres` })).toThrow('overrides');
  }
});

it('rejects duplicate TLS parameters rather than validating a different value than pg', () => {
  expect(() => planningDatabaseConfig({ PLANNING_DATABASE_URL:
    'postgresql://planner:secret@remote/db?sslmode=verify-full&sslmode=disable' })).toThrow('overrides');
});
