import { planProduct } from '../../packages/ai/src/planning';
import { planningRequest, readingPlan } from '../../packages/ai/src/fixtures/planning';
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
const holders = new Map<string, string>();
async function reserve(owner: Fixture['owner'], product: Fixture['products'][number], key = randomUUID()) {
  const holder = randomUUID();
  const result = await owner.rpc('reserve_planning_request', {
    p_product_id: product.product_id, p_expected_current_revision_id: product.revision_id, p_request_key: key, p_holder_token: holder,
  });
  if (!result.error) holders.set(result.data as string, holder);
  return result;
}
function release(id: string) {
  planningFixtureSQL(`set role atelier_planning_writer; select private.release_planning_request(${literal(id)},${literal(holders.get(id)!)});`);
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
      select * from private.append_planning_revision(${reservation}, ${literal(holders.get(admitted.data as string)!)}, '{}'::jsonb);\n`);
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

async function envelopeFor(product: Fixture['products'][number]) {
  const result = await planProduct({ generate: async () => JSON.stringify(readingPlan) }, {
    ...planningRequest, productId: product.product_id, parentRevisionId: product.revision_id,
    revisionId: randomUUID(), revisionNumber: 2,
  });
  if (!result.ok) throw new Error('Controlled planning fixture failed validation');
  return result.envelope;
}
function renewSQL(id: string) {
  return `select * from private.renew_planning_request(${literal(id)},${literal(holders.get(id)!)});`;
}
async function assertUnchanged(owner: Fixture['owner'], product: Fixture['products'][number], id: string) {
  expect((await owner.from('product_revisions').select('id').eq('product_id', product.product_id)).data).toHaveLength(1);
  expect((await owner.from('products').select('current_revision_id').eq('id', product.product_id).single()).data?.current_revision_id).toBe(product.revision_id);
  expect((await owner.from('audit_events').select('id').eq('product_id', product.product_id).eq('action', 'product.revision_created')).data).toEqual([]);
  expect(planningFixtureSQL(`select completed_at is null from private.planning_requests where id=${literal(id)};`)).toBe('t');
}

it.each(['product', 'membership'])('rejects renewal after expiry waiting for the %s lock', async resource => {
  const { owner, products: [product] } = await fixture();
  const admitted = await reserve(owner, product); expect(admitted.error).toBeNull();
  const id = admitted.data as string;
  planningFixtureSQL(`update private.planning_requests set expires_at=clock_timestamp()+interval '3 seconds' where id=${literal(id)};`);
  const locker = databaseSession(), renewer = databaseSession();
  try {
    const target = resource === 'product' ? `public.products where id=${literal(product.product_id)}`
      : `public.account_memberships where account_id=(select account_id from public.products where id=${literal(product.product_id)})`;
    locker.input.write(`begin; select 1 from ${target} for update; select 'locked';\n`);
    await waitFor(() => locker.output().includes('locked'));
    renewer.input.end(`set application_name='renew-${id}'; set role atelier_planning_writer; ${renewSQL(id)}\n`);
    await waitFor(() => planningFixtureSQL(`select count(*) from pg_stat_activity where application_name='renew-${id}' and wait_event_type='Lock';`) === '1');
    await waitFor(() => planningFixtureSQL(`select expires_at<=clock_timestamp() from private.planning_requests where id=${literal(id)};`) === 't');
    locker.input.end('commit;\n'); await locker.done;
    expect(await renewer.done).not.toBe(0); expect(renewer.errors()).toContain('42501');
    await assertUnchanged(owner, product, id);
  } finally {
    if (!locker.input.writableEnded) locker.input.end('rollback;\n');
    locker.kill(); renewer.kill(); await Promise.all([locker.done, renewer.done]);
  }
});

it('rolls back revision, pointer, audit and completion when commit is delayed past expiry', async () => {
  const { owner, products: [product] } = await fixture();
  const envelope = await envelopeFor(product);
  const admitted = await reserve(owner, product); expect(admitted.error).toBeNull();
  const id = admitted.data as string;
  planningFixtureSQL(`update private.planning_requests set expires_at=clock_timestamp()+interval '3 seconds' where id=${literal(id)};`);
  const writer = databaseSession();
  try {
    writer.input.write(`begin; set role atelier_planning_writer;
      select * from private.append_planning_revision(${literal(id)},${literal(holders.get(id)!)},${literal(JSON.stringify(envelope))}::jsonb);
      select 'append_returned';\n`);
    await waitFor(() => writer.output().includes('append_returned'));
    await waitFor(() => planningFixtureSQL(`select expires_at<=clock_timestamp() from private.planning_requests where id=${literal(id)};`) === 't');
    writer.input.end('commit;\n');
    expect(await writer.done).not.toBe(0); expect(writer.errors()).toContain('42501');
    await assertUnchanged(owner, product, id);
  } finally { writer.kill(); await writer.done; }
});

it('serializes renewal behind save and rejects renewal of the completed reservation', async () => {
  const { owner, products: [product] } = await fixture();
  const envelope = await envelopeFor(product);
  const admitted = await reserve(owner, product); expect(admitted.error).toBeNull();
  const id = admitted.data as string;
  const writer = databaseSession(), renewer = databaseSession();
  try {
    writer.input.write(`begin; set role atelier_planning_writer;
      select * from private.append_planning_revision(${literal(id)},${literal(holders.get(id)!)},${literal(JSON.stringify(envelope))}::jsonb);
      select 'append_returned';\n`);
    await waitFor(() => writer.output().includes('append_returned'));
    renewer.input.end(`set application_name='save-renew-${id}'; set role atelier_planning_writer; ${renewSQL(id)}\n`);
    await waitFor(() => planningFixtureSQL(`select count(*) from pg_stat_activity where application_name='save-renew-${id}' and wait_event_type='Lock';`) === '1');
    writer.input.end('commit;\n'); expect(await writer.done).toBe(0);
    expect(await renewer.done).not.toBe(0); expect(renewer.errors()).toContain('42501');
    expect((await owner.from('product_revisions').select('id').eq('product_id', product.product_id)).data).toHaveLength(2);
    expect((await owner.from('products').select('current_revision_id').eq('id', product.product_id).single()).data?.current_revision_id).toBe(envelope.revisionId);
  } finally {
    if (!writer.input.writableEnded) writer.input.end('rollback;\n');
    writer.kill(); renewer.kill(); await Promise.all([writer.done, renewer.done]);
  }
});

it.each(['revoked', 'stale'])('rejects renewal when owner/revision becomes %s', async reason => {
  const { owner, products: [product] } = await fixture();
  const admitted = await reserve(owner, product); expect(admitted.error).toBeNull();
  const id = admitted.data as string;
  if (reason === 'revoked') {
    planningFixtureSQL(`update public.account_memberships set role='member' where account_id=(select account_id from public.products where id=${literal(product.product_id)});`);
  } else {
    const envelope = await envelopeFor(product);
    planningFixtureSQL(`set role atelier_planning_writer; select * from private.append_planning_revision(${literal(id)},${literal(holders.get(id)!)},${literal(JSON.stringify(envelope))}::jsonb);`);
    // A separate freshly inserted historical fixture exercises revision fencing without changing immutable identity.
    const actual = randomUUID(), holder = randomUUID();
    planningFixtureSQL(`insert into private.planning_requests(id,owner_id,product_id,expected_revision_id,request_key,holder_token_hash,created_at,expires_at,hard_deadline)
      select ${literal(actual)},owner_id,product_id,expected_revision_id,${literal(randomUUID())},extensions.digest(${literal(holder)},'sha256'),clock_timestamp(),clock_timestamp()+interval '120 seconds',clock_timestamp()+interval '17 minutes'
      from private.planning_requests where id=${literal(id)} returning id;`);
    holders.set(actual, holder);
    const check = databaseSession(); check.input.end(`set role atelier_planning_writer; ${renewSQL(actual)}\n`);
    expect(await check.done).not.toBe(0); expect(check.errors()).toContain('40001');
    return;
  }
  const check = databaseSession(); check.input.end(`set role atelier_planning_writer; ${renewSQL(id)}\n`);
  expect(await check.done).not.toBe(0); expect(check.errors()).toContain('P0002');
});

it('rejects renewal when the immutable hard deadline expires while waiting for a lock', async () => {
  const { owner, products: [product] } = await fixture();
  const admitted = await reserve(owner, product); expect(admitted.error).toBeNull();
  const seed = admitted.data as string; release(seed);
  const id = randomUUID(), holder = randomUUID(); holders.set(id, holder);
  planningFixtureSQL(`insert into private.planning_requests(id,owner_id,product_id,expected_revision_id,request_key,holder_token_hash,created_at,expires_at,hard_deadline)
    select ${literal(id)},owner_id,product_id,expected_revision_id,${literal(randomUUID())},extensions.digest(${literal(holder)},'sha256'),
      statement_timestamp()-interval '17 minutes'+interval '3 seconds',statement_timestamp()+interval '3 seconds',statement_timestamp()+interval '3 seconds'
    from private.planning_requests where id=${literal(seed)};`);
  const locker = databaseSession(), renewer = databaseSession();
  try {
    locker.input.write(`begin; select id from public.products where id=${literal(product.product_id)} for update; select 'locked';\n`);
    await waitFor(() => locker.output().includes('locked'));
    renewer.input.end(`set application_name='deadline-${id}'; set role atelier_planning_writer; ${renewSQL(id)}\n`);
    await waitFor(() => planningFixtureSQL(`select count(*) from pg_stat_activity where application_name='deadline-${id}' and wait_event_type='Lock';`) === '1');
    await waitFor(() => planningFixtureSQL(`select hard_deadline<=clock_timestamp() from private.planning_requests where id=${literal(id)};`) === 't');
    locker.input.end('commit;\n'); await locker.done;
    expect(await renewer.done).not.toBe(0); expect(renewer.errors()).toContain('42501');
    await assertUnchanged(owner, product, id);
  } finally {
    if (!locker.input.writableEnded) locker.input.end('rollback;\n');
    locker.kill(); renewer.kill(); await Promise.all([locker.done, renewer.done]);
  }
});
