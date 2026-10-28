import { describe, expect, it } from 'vitest';
import { CreativePlanV1, PlanningEnvelopeV1, PlanningRequestV1, postgresJsonBytes } from './planning.js';
import { readingPlan, planningRequest } from '../../ai/src/fixtures/planning.js';

const envelope = () => ({ schemaVersion: 'planning-envelope/1',
  productId: planningRequest.productId, revisionId: planningRequest.revisionId,
  parentRevisionId: null, revisionNumber: 1, plan: structuredClone(readingPlan),
  provenance: { schemaVersion: 'planning-provenance/1', idea: planningRequest.idea,
    inputSha256: 'a'.repeat(64), createdAt: planningRequest.createdAt,
    promptVersion: planningRequest.promptVersion, generator: planningRequest.generator, attempts: 1, sources: [] },
});

describe('creative planning contracts', () => {
  it('validates a compact envelope without altering existing domain contracts', () => {
    expect(PlanningEnvelopeV1.safeParse(envelope()).success).toBe(true);
  });
  it.each([
    (p: typeof readingPlan) => ({ ...p, schemaVersion: 'creative-plan/2' }),
    (p: typeof readingPlan) => ({ ...p, brief: { ...p.brief, customer: ' ' } }),
    (p: typeof readingPlan) => ({ ...p, visualDNA: { ...p.visualDNA, palette: {} } }),
    (p: typeof readingPlan) => ({ ...p, manifest: { ...p.manifest, targetPageCount: 7 } }),
    (p: typeof readingPlan) => ({ ...p, manifest: { ...p.manifest, pages: [p.manifest.pages[0], p.manifest.pages[0], p.manifest.pages[2]] } }),
    (p: typeof readingPlan) => ({ ...p, manifest: { ...p.manifest, pages: p.manifest.pages.map(page => ({ ...page, order: 1 })) } }),
    (p: typeof readingPlan) => ({ ...p, manifest: { ...p.manifest, pages: p.manifest.pages.map(page => ({ ...page, dependsOnPageIds: ['missing'] })) } }),
    (p: typeof readingPlan) => ({ ...p, manifest: { ...p.manifest, pages: p.manifest.pages.map(page => ({ ...page, dependsOnPageIds: [page.id] })) } }),
    (p: typeof readingPlan) => ({ ...p, manifest: { ...p.manifest, pages: p.manifest.pages.map((page, i) => ({ ...page, dependsOnPageIds: [p.manifest.pages[(i + 1) % 3].id] })) } }),
    (p: typeof readingPlan) => ({ ...p, deliverables: { ...p.deliverables, items: [{ ...p.deliverables.items[0], pageIds: ['missing'] }] } }),
    (p: typeof readingPlan) => ({ ...p, deliverables: { ...p.deliverables, items: [p.deliverables.items[0], p.deliverables.items[0]] } }),
    (p: typeof readingPlan) => ({ ...p, manifest: { ...p.manifest, pages: p.manifest.pages.map(page => ({ ...page, elements: [] })) } }),
  ])('rejects inconsistent or unsupported plans', change => {
    expect(CreativePlanV1.safeParse(change(readingPlan)).success).toBe(false);
  });
  it('rejects missing provenance references', () => {
    const value = envelope();
    const plan = { ...value.plan, manifest: { ...value.plan.manifest, pages: value.plan.manifest.pages.map(p => ({ ...p, sourceIds: ['unknown'] })) } };
    expect(PlanningEnvelopeV1.safeParse({ ...value, plan }).success).toBe(false);
  });
  it('rejects inconsistent revision lineage', () => {
    expect(PlanningRequestV1.safeParse({ ...planningRequest, revisionNumber: 2 }).success).toBe(false);
    expect(PlanningEnvelopeV1.safeParse({ ...envelope(), parentRevisionId: planningRequest.revisionId }).success).toBe(false);
  });
  it.each(['\u0000', '\ud800'])('rejects PostgreSQL-incompatible strings', text => {
    expect(PlanningRequestV1.safeParse({ ...planningRequest, idea: text }).success).toBe(false);
  });
  it('counts UTF-8 and jsonb separator overhead', () => {
    expect(postgresJsonBytes({ a: ['é', '🌿'], b: 1 })).toBe(Buffer.byteLength('{"a": ["é", "🌿"], "b": 1}', 'utf8'));
  });
  it('rejects envelopes exceeding the entire revision content budget', () => {
    const value = envelope();
    const plan = { ...value.plan, brief: { ...value.plan.brief, assumptions: Array.from({ length: 32 }, () => '🌿'.repeat(500)) } };
    expect(PlanningEnvelopeV1.safeParse({ ...value, plan }).success).toBe(false);
  });
});

describe('planning persistence boundaries', () => {
  it('accepts exactly 64 KiB of jsonb text and rejects one more byte', () => {
    const base = PlanningEnvelopeV1.parse(envelope());
    const value = { ...base, plan: { ...base.plan, brief: { ...base.plan.brief, assumptions: Array.from({ length: 32 }, () => 'x') } } };
    const remaining = 65536 - postgresJsonBytes(value);
    const assumptions = value.plan.brief.assumptions.map((s, i) => s + 'x'.repeat(Math.floor(remaining / 32) + (i < remaining % 32 ? 1 : 0)));
    const exact = { ...value, plan: { ...value.plan, brief: { ...value.plan.brief, assumptions } } };
    expect(postgresJsonBytes(exact)).toBe(65536);
    expect(PlanningEnvelopeV1.safeParse(exact).success).toBe(true);
    const over = { ...exact, plan: { ...exact.plan, brief: { ...exact.plan.brief, assumptions: assumptions.map((s, i) => i === 0 ? s + 'x' : s) } } };
    expect(PlanningEnvelopeV1.safeParse(over).success).toBe(false);
  });
  it('accepts known sources and retained IDs in a subsequent revision', () => {
    const value = envelope();
    const source = { id: 'reference', kind: 'upload', source: 'upload-id', provenance: { capturedAt: planningRequest.createdAt, consentConfirmed: true } };
    const next = { ...value, revisionId: 'ee0e9063-70a7-4891-b901-bf43d90dd181', parentRevisionId: value.revisionId, revisionNumber: 2,
      provenance: { ...value.provenance, sources: [source], retainedPageIds: ['reading-cover'] },
      plan: { ...value.plan, manifest: { ...value.plan.manifest, pages: value.plan.manifest.pages.map(p => ({ ...p, sourceIds: ['reference'] })) } } };
    expect(PlanningEnvelopeV1.safeParse(next).success).toBe(true);
    expect(PlanningEnvelopeV1.safeParse({ ...next, provenance: { ...next.provenance, retainedPageIds: ['missing'] } }).success).toBe(false);
    expect(PlanningEnvelopeV1.safeParse({ ...next, provenance: { ...next.provenance, sources: [source, source] } }).success).toBe(false);
  });
  it.each(['brief', 'manifest', 'deliverables'] as const)('rejects unsupported nested %s versions', field => {
    expect(CreativePlanV1.safeParse({ ...readingPlan, [field]: { ...readingPlan[field], schemaVersion: 'future/99' } }).success).toBe(false);
  });
  it('rejects missing pages, reversed deliverables and repeated references', () => {
    for (const pageIds of [['reading-cover'], ['reading-connections', 'reading-response', 'reading-cover'], ['reading-cover', 'reading-cover']]) {
      expect(CreativePlanV1.safeParse({ ...readingPlan, deliverables: { ...readingPlan.deliverables, items: [{ ...readingPlan.deliverables.items[0], pageIds }] } }).success).toBe(false);
    }
  });
});
