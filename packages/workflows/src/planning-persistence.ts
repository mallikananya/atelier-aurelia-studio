import pg from 'pg';
import type { PoolConfig } from 'pg';
import { PlanningEnvelopeV1 } from '../../contracts/src/planning.ts';

export interface PlanningRevisionRow {
  product_id: string;
  revision_id: string;
  revision_number: number;
}
export interface PlanningPersistence {
  save(reservationId: string, envelope: unknown): Promise<PlanningRevisionRow[]>;
  release(reservationId: string): Promise<void>;
  close(): Promise<void>;
}
export class PlanningPersistenceValidationError extends Error {
  readonly code = '22023';
  constructor() { super('Invalid planning persistence input'); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reservationIdentity(value: string): void {
  if (!uuid.test(value)) throw new PlanningPersistenceValidationError();
}

export function planningDatabaseConfig(env: NodeJS.ProcessEnv): PoolConfig {
  const connectionString = env.PLANNING_DATABASE_URL;
  if (!connectionString) throw new Error('PLANNING_DATABASE_URL is required');
  let url: URL;
  let username: string;
  try {
    url = new URL(connectionString);
    username = decodeURIComponent(url.username);
  } catch { throw new Error('A PostgreSQL planning URL is required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('A PostgreSQL planning URL is required');
  if (!username || ['postgres', 'supabase_admin', 'service_role'].includes(username.split('.')[0])) {
    throw new Error('A dedicated least-privilege planning login is required');
  }
  const tlsParameters = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'];
  for (const key of url.searchParams.keys()) {
    if (!tlsParameters.includes(key) || url.searchParams.getAll(key).length !== 1) {
      throw new Error('Planning connection query overrides are not permitted');
    }
  }
  // Operators may opt in only when these names resolve inside their trusted Docker network.
  const docker = env.PLANNING_DATABASE_LOCAL_DOCKER === '1'
    && ['db', 'host.docker.internal', 'supabase_db_atelier-aurelia-studio'].includes(url.hostname);
  const local = docker || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && url.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('Remote planning connections require sslmode=verify-full');
  }
  return { connectionString, max: 3, connectionTimeoutMillis: 10_000, statement_timeout: 30_000,
    idleTimeoutMillis: 10_000, application_name: 'atelier-planning-writer' };
}
export function createPlanningPersistence(env: NodeJS.ProcessEnv = process.env): PlanningPersistence {
  const pool = new pg.Pool(planningDatabaseConfig(env));
  pool.on('error', () => console.error(JSON.stringify({ event: 'planning.database.connection_failed' })));
  return new PostgresPlanningPersistence(pool);
}

/** Trusted server boundary: never expose this credential or adapter to client code. */
export class PostgresPlanningPersistence implements PlanningPersistence {
  constructor(private readonly pool: pg.Pool) {}
  private async query<T>(sql: string, values: unknown[]): Promise<T[]> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('begin');
      await client.query('set local role atelier_planning_writer');
      const result = await client.query(sql, values);
      await client.query('commit');
      return result.rows as T[];
    } catch (error) {
      try { await client.query('rollback'); } catch { broken = true; }
      throw error;
    } finally {
      if (broken) client.release(true);
      else client.release();
    }
  }
  async save(reservationId: string, envelope: unknown): Promise<PlanningRevisionRow[]> {
    reservationIdentity(reservationId);
    // Parse immediately before SQL and serialize the validated snapshot, not the caller's object.
    const validated = PlanningEnvelopeV1.safeParse(envelope);
    if (!validated.success) throw new PlanningPersistenceValidationError();
    return this.query('select * from private.append_planning_revision($1::uuid,$2::jsonb)',
      [reservationId, JSON.stringify(validated.data)]);
  }
  async release(reservationId: string): Promise<void> {
    reservationIdentity(reservationId);
    await this.query('select private.release_planning_request($1::uuid)', [reservationId]);
  }
  close(): Promise<void> { return this.pool.end(); }
}
