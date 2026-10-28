import { describe, expect, it, vi } from 'vitest';
import { planProduct } from './planning.js';
import { PlanningEnvelopeV1, PLANNING_MAX_ATTEMPTS } from '../../contracts/src/planning.js';
import { readingPlan, travelPlan, planningRequest } from './fixtures/planning.js';

const providerFor = (value: unknown) => ({ generate: vi.fn(async () => JSON.stringify(value)) });

describe('planning service', () => {
  it.each([readingPlan, travelPlan])('accepts contrasting plans through the same boundary', async plan => {
    const provider = providerFor(plan);
    const result = await planProduct(provider, planningRequest);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected success');
    expect(PlanningEnvelopeV1.parse(result.envelope).plan).toEqual(plan);
    expect(result.envelope.provenance.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.envelope.provenance.attempts).toBe(1);
    expect(result.envelope.revisionId).toBe(planningRequest.revisionId);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('repairs invalid output with deterministic feedback and a fixed budget', async () => {
    const generate = vi.fn().mockResolvedValueOnce('{').mockResolvedValueOnce(JSON.stringify(travelPlan));
    const result = await planProduct({ generate }, planningRequest);
    expect(result.ok).toBe(true);
    expect(generate.mock.calls[1][0].issues[0].code).toBe('invalid_json');
    expect(generate.mock.calls[1][0].previousOutput).toBe('{');
    expect(generate.mock.calls[1][0].attempt).toBe(2);
  });

  it.each(['{}', '{', 'x'.repeat(65537)])('rejects invalid output after the fixed budget', async output => {
    const generate = vi.fn(async () => output);
    const result = await planProduct({ generate }, planningRequest);
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_output', attempts: PLANNING_MAX_ATTEMPTS } });
    expect(generate).toHaveBeenCalledTimes(PLANNING_MAX_ATTEMPTS);
  });

  it('does not retry or expose provider exceptions', async () => {
    const generate = vi.fn(async () => { throw new Error('secret-token'); });
    const result = await planProduct({ generate }, planningRequest);
    expect(result).toMatchObject({ ok: false, error: { code: 'provider_failure', attempts: 1 } });
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid input before calling the provider', async () => {
    const provider = providerFor(readingPlan);
    expect(await planProduct(provider, { ...planningRequest, idea: ' ' })).toMatchObject({ ok: false, error: { code: 'invalid_input', attempts: 0 } });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('does not accept forged lineage or expanded geometry from the provider', async () => {
    const provider = providerFor({ ...readingPlan, revisionId: planningRequest.revisionId, pages: [{ elements: [] }] });
    expect(await planProduct(provider, planningRequest)).toMatchObject({ ok: false, error: { code: 'invalid_output' } });
  });

  it('keeps request and provider snapshots isolated', async () => {
    const request = structuredClone(planningRequest);
    const provider = { generate: vi.fn(async (input: { idea: string }) => {
      input.idea = 'provider mutation'; return JSON.stringify(readingPlan);
    }) };
    const result = await planProduct(provider, request);
    expect(request).toEqual(planningRequest);
    expect(result.ok && result.envelope.provenance.idea).toBe(planningRequest.idea);
  });
});

describe('planning trust boundaries', () => {
  it('rejects oversized input before generation', async () => {
    const sources = Array.from({ length: 20 }, (_, i) => ({ id: `source-${i}`, kind: 'upload', source: 'x'.repeat(2000),
      provenance: { capturedAt: planningRequest.createdAt, consentConfirmed: true } }));
    const provider = providerFor(readingPlan);
    expect(await planProduct(provider, { ...planningRequest, sources })).toMatchObject({ ok: false, error: { code: 'invalid_input', attempts: 0 } });
    expect(provider.generate).not.toHaveBeenCalled();
  });
  it('returns actionable schema feedback without exposing model-controlled keys', async () => {
    const provider = providerFor({ ...readingPlan, visualDNA: { ...readingPlan.visualDNA, palette: { 'sensitive-marker': '' } } });
    const result = await planProduct(provider, planningRequest);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('sensitive-marker');
  });
  it('preserves requested page identities and reports semantic repair causes', async () => {
    const provider = providerFor(travelPlan);
    const result = await planProduct(provider, { ...planningRequest, retainedPageIds: ['reading-cover'] });
    expect(result).toMatchObject({ ok: false, error: { issues: [{ message: 'Retained page IDs must survive planning' }] } });
  });
  it('rejects non-text output from a misbehaving adapter', async () => {
    const generate = vi.fn().mockResolvedValue({ plan: readingPlan });
    expect(await planProduct({ generate }, planningRequest)).toMatchObject({ ok: false, error: { code: 'invalid_output' } });
  });
  it('binds provenance hashes to the idea and sources', async () => {
    const first = await planProduct(providerFor(readingPlan), planningRequest);
    const second = await planProduct(providerFor(readingPlan), { ...planningRequest, idea: 'A different idea' });
    expect(first.ok && second.ok && first.envelope.provenance.inputSha256 !== second.envelope.provenance.inputSha256).toBe(true);
  });
});
