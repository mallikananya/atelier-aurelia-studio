import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { generatePlanningRevision } from '../../apps/studio/src/lib/planning/service';
import { createPlanningPersistence, type PlanningLease } from '../../packages/workflows/src/planning-persistence';
import { readingPlan } from '../../packages/ai/src/fixtures/planning';
import { PlanningEnvelopeV1 } from '../../packages/contracts/src/planning';
import { provisionPlanningOwner, planningFixtureSQL } from '../fixtures/planning';
import { fixtureSession, literal } from '../fixtures/storage';

it('saves an authenticated controlled plan after the original 120-second lease with real renewals', async () => {
  const owner = await fixtureSession(await provisionPlanningOwner());
  const created = await owner.rpc('create_product_with_revision', { p_name: 'CE03C2.1 long-running acceptance' });
  expect(created.error).toBeNull();
  const product = created.data[0];
  const persistence = createPlanningPersistence();
  let lease: PlanningLease | undefined; let renewals = 0;
  const observed = {
    renew: async (value: PlanningLease) => { lease = value; renewals++; return persistence.renew(value); },
    save: persistence.save.bind(persistence), release: persistence.release.bind(persistence), close: persistence.close.bind(persistence),
  };
  const form = new FormData();
  form.set('productId', product.product_id); form.set('expectedRevisionId', product.revision_id);
  form.set('requestId', randomUUID()); form.set('idea', 'A literary reading journal for controlled lease verification');
  try {
    const result = await generatePlanningRevision(owner, form, {
      generator: { id: 'controlled-inference-not-ai', version: 'lease-test/1' }, promptVersion: 'lease-test/1',
      provider: { generate: async (_request, signal) => {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => { clearTimeout(timer); reject(new Error('cancelled')); };
          const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, 125_000);
          signal?.addEventListener('abort', onAbort, { once: true });
        });
        return JSON.stringify(readingPlan);
      } },
    }, observed);
    expect(result.kind).toBe('saved'); expect(renewals).toBeGreaterThanOrEqual(5);
    const history = await owner.from('product_revisions').select('id,content').eq('product_id', product.product_id).order('revision_number');
    expect(history.error).toBeNull(); expect(history.data).toHaveLength(2);
    expect(PlanningEnvelopeV1.safeParse(history.data![1].content).success).toBe(true);
    expect(planningFixtureSQL(`select completed_at>created_at+interval '120 seconds' and completed_at<hard_deadline from private.planning_requests where id=${literal(lease!.reservationId)};`)).toBe('t');
    await expect(persistence.save(lease!, history.data![1].content)).rejects.toMatchObject({ code: '42501' });
    expect((await owner.from('product_revisions').select('id').eq('product_id', product.product_id)).data).toHaveLength(2);
  } finally { await persistence.close(); }
}, 160_000);
