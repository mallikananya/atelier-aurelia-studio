import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { fixtureSession, literal } from '../fixtures/storage';
import { planningFixtureSQL, provisionPlanningOwner } from '../fixtures/planning';

// Each case has a fresh owner so rate windows never depend on earlier runs.
// Fixtures are retained; this suite never resets or deletes application data.
async function fixture(count = 1) {
  const email = await provisionPlanningOwner();
  const owner = await fixtureSession(email);
  const products = [];
  for (let i = 0; i < count; i++) {
    const result = await owner.rpc('create_product_with_revision', { p_name: 'Planning admission acceptance' });
    if (result.error) throw new Error('Cannot provision planning fixture product');
    products.push(result.data[0] as { product_id: string; revision_id: string });
  }
  return { owner, products };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function reserve(owner: Fixture['owner'], product: Fixture['products'][number], key = randomUUID()) {
  return owner.rpc('reserve_planning_request', {
    p_product_id: product.product_id, p_expected_current_revision_id: product.revision_id, p_request_key: key,
  });
}
function release(id: string) {
  planningFixtureSQL(`set role atelier_planning_writer; select private.release_planning_request(${literal(id)});`);
}

it.each([false, true])('atomically admits one concurrent request per product (duplicate identity=%s)', async duplicate => {
  const { owner, products } = await fixture();
  const key = randomUUID();
  const results = await Promise.all([reserve(owner, products[0], key), reserve(owner, products[0], duplicate ? key : randomUUID())]);
  const admitted = results.filter(result => !result.error);
  expect(admitted).toHaveLength(1);
  expect(results.find(result => result.error)?.error?.code).toBe(duplicate ? '23505' : '53300');
  release(admitted[0].data as string);
  const history = await owner.from('product_revisions').select('id').eq('product_id', products[0].product_id);
  expect(history.data).toHaveLength(1);
});

it('atomically bounds concurrent requests across products for one owner', async () => {
  const { owner, products } = await fixture(3);
  const results = await Promise.all(products.map(product => reserve(owner, product)));
  expect(results.filter(result => !result.error)).toHaveLength(2);
  expect(results.filter(result => result.error).map(result => result.error?.code)).toEqual(['53300']);
  for (const result of results) if (!result.error) release(result.data as string);
});

it('counts released requests toward product and owner rate windows', async () => {
  const { owner, products } = await fixture(3);
  for (const product of products.slice(0, 2)) {
    for (let i = 0; i < 5; i++) {
      const admitted = await reserve(owner, product);
      expect(admitted.error).toBeNull();
      release(admitted.data as string);
    }
    expect((await reserve(owner, product)).error?.code).toBe('53300');
  }
  expect((await reserve(owner, products[2])).error?.code).toBe('53300');
});

it('rejects reservation replay after release, stale revisions, and another owner', async () => {
  const { owner, products } = await fixture();
  const outsider = await fixture();
  const key = randomUUID();
  const admitted = await reserve(owner, products[0], key);
  expect(admitted.error).toBeNull();
  release(admitted.data as string);
  expect((await reserve(owner, products[0], key)).error?.code).toBe('23505');
  expect((await reserve(owner, { ...products[0], revision_id: randomUUID() })).error?.code).toBe('40001');
  expect((await reserve(outsider.owner, products[0])).error).not.toBeNull();
});

it('rejects a reservation that expires while its writer waits for the product lock', async () => {
  const { owner, products: [product] } = await fixture();
  const admitted = await reserve(owner, product);
  expect(admitted.error).toBeNull();
  const reservation = literal(admitted.data as string);
  // Only this newly created fixture reservation is shortened; no historical data changes.
  planningFixtureSQL(`update private.planning_requests set expires_at=clock_timestamp()+interval '3 seconds' where id=${reservation};`);
  const locker = databaseSession();
  const writer = databaseSession();
  try {
    locker.input.write(`begin; select id from public.products where id=${literal(product.product_id)} for update; select 'product_locked';\n`);
    await waitFor(() => locker.output().includes('product_locked'));
    writer.input.end(`set application_name='ce021-expiry-${product.product_id}'; set role atelier_planning_writer;
      select * from private.append_planning_revision(${reservation}, '{}'::jsonb);\n`);
    await waitFor(() => planningFixtureSQL(`select count(*) from pg_stat_activity where application_name='ce021-expiry-${product.product_id}' and wait_event_type='Lock';`) === '1');
    await waitFor(() => planningFixtureSQL(`select expires_at<=clock_timestamp() from private.planning_requests where id=${reservation};`) === 't');
    locker.input.end('commit;\n');
    await locker.done;
    expect(await writer.done).not.toBe(0);
    expect(writer.errors()).toContain('42501');
    const revisions = await owner.from('product_revisions').select('id').eq('product_id', product.product_id);
    expect(revisions.error).toBeNull();
    expect(revisions.data).toHaveLength(1);
    const audit = await owner.from('audit_events').select('id').eq('product_id', product.product_id).eq('action', 'product.revision_created');
    expect(audit.error).toBeNull();
    expect(audit.data).toEqual([]);
  } finally {
    if (!locker.input.writableEnded) locker.input.end('rollback;\n');
    if (!writer.input.writableEnded) writer.input.end();
    locker.kill(); writer.kill();
    await Promise.all([locker.done, writer.done]);
  }
});

function databaseSession() {
  const child = spawn('docker', ['exec', '-i', 'supabase_db_atelier-aurelia-studio',
    'psql', '-U', 'supabase_admin', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
  { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { errors += String(chunk); });
  const done = new Promise<number | null>((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
  return { input: child.stdin, output: () => output, errors: () => errors, done, kill: () => child.kill() };
}
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Planning lock synchronization timed out');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
