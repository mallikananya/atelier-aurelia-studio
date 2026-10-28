import { z } from 'zod';
import { InspirationRef, PageSpec, VisualDNA } from './index.js';

export const PLANNING_MAX_BYTES = 65_536;
export const PLANNING_MAX_INPUT_BYTES = 16_384;
export const PLANNING_MAX_ATTEMPTS = 3;
// PostgreSQL JSONB rejects NUL and unpaired UTF-16 surrogates.
const Text = z.string().trim().min(1).max(2000).refine(
  value => !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value),
  'Text must be PostgreSQL-compatible Unicode',
);
const Id = Text.max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u);
const Ids = z.array(Id).max(200).refine(ids => new Set(ids).size === ids.length, 'Duplicate references');
const Notes = z.array(Text).max(32);
const Source = InspirationRef.extend({ id: Id, source: Text, note: Text.optional(),
  provenance: InspirationRef.shape.provenance.strict() }).strict();
const Sources = z.array(Source).max(20).refine(values => new Set(values.map(s => s.id)).size === values.length, 'Duplicate sources');

export const CreativeBriefV1 = z.strictObject({
  schemaVersion: z.literal('creative-brief/1'), id: Id, name: Text, productType: Text,
  customer: Text, jobToBeDone: Text, concept: Text, differentiation: Text,
  visualDirection: Text, risks: Notes, assumptions: Notes,
});

// Reuse the existing page vocabulary, explicitly excluding expanded geometry.
const ManifestPage = PageSpec.omit({ elements: true }).extend({
  id: Id, order: z.number().int().min(1).max(200), name: Text, purpose: Text,
  dependsOnPageIds: Ids, sourceIds: Ids,
}).strict();
export const PageManifestV1 = z.strictObject({
  schemaVersion: z.literal('page-manifest/1'), targetPageCount: z.number().int().min(1).max(200),
  pages: z.array(ManifestPage).min(1).max(200),
}).superRefine((manifest, ctx) => {
  if (manifest.targetPageCount !== manifest.pages.length) ctx.addIssue({ code: 'custom', path: ['targetPageCount'], message: 'Page count mismatch' });
  const ids = new Set(manifest.pages.map(p => p.id));
  if (ids.size !== manifest.pages.length) ctx.addIssue({ code: 'custom', path: ['pages'], message: 'Duplicate page IDs' });
  manifest.pages.forEach((page, index) => {
    if (page.order !== index + 1) ctx.addIssue({ code: 'custom', path: ['pages', index, 'order'], message: 'Pages must be in contiguous order starting at one' });
    if (page.dependsOnPageIds.some(id => !ids.has(id) || id === page.id)) ctx.addIssue({ code: 'custom', path: ['pages', index, 'dependsOnPageIds'], message: 'Invalid page dependency' });
  });
  const edges = new Map(manifest.pages.map(p => [p.id, p.dependsOnPageIds]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((edges.get(id) ?? []).some(cycle)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  if (manifest.pages.some(p => cycle(p.id))) ctx.addIssue({ code: 'custom', path: ['pages'], message: 'Cyclic page dependencies' });
});

export const DeliverablePlanV1 = z.strictObject({
  schemaVersion: z.literal('deliverable-plan/1'), items: z.array(z.strictObject({
    id: Id, name: Text, format: z.enum(['pdf', 'png']), usage: z.enum(['print', 'digital', 'preview']),
    // Descriptive format intent; physical geometry is resolved in a later milestone.
    pageSize: Text, pageIds: Ids.refine(ids => ids.length > 0, 'Pages required'),
  })).min(1).max(20),
}).superRefine((plan, ctx) => {
  if (new Set(plan.items.map(d => d.id)).size !== plan.items.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Duplicate deliverable IDs' });
});

const PlanningVisualDNA = VisualDNA.extend({
  mood: Notes.refine(values => values.length > 0, 'Mood required'),
  palette: z.record(Text.max(100), Text.max(100)).refine(value => Object.keys(value).length > 0 && Object.keys(value).length <= 32, 'Palette requires 1–32 entries'),
  typographyDirection: Text, illustrationDirection: Text, geometry: Text, whitespace: Text,
  texture: Text.optional(), motifs: Notes, avoid: Notes,
}).strict();

export const CreativePlanV1 = z.strictObject({
  schemaVersion: z.literal('creative-plan/1'), brief: CreativeBriefV1,
  visualDNA: PlanningVisualDNA, manifest: PageManifestV1, deliverables: DeliverablePlanV1,
}).superRefine((plan, ctx) => {
  const pageIds = plan.manifest.pages.map(p => p.id);
  const allIds = [plan.brief.id, ...pageIds, ...plan.deliverables.items.map(d => d.id)];
  if (new Set(allIds).size !== allIds.length) ctx.addIssue({ code: 'custom', message: 'Node IDs must be unique' });
  const covered = new Set(plan.deliverables.items.flatMap(d => d.pageIds));
  if (pageIds.some(id => !covered.has(id))) ctx.addIssue({ code: 'custom', path: ['deliverables'], message: 'Every page needs a deliverable' });
  plan.deliverables.items.forEach((item, index) => {
    const positions = item.pageIds.map(id => pageIds.indexOf(id));
    if (positions.some((position, i) => position < 0 || (i > 0 && position <= positions[i - 1]))) {
      ctx.addIssue({ code: 'custom', path: ['deliverables', 'items', index, 'pageIds'], message: 'Deliverable references must follow manifest order' });
    }
  });
});

const Lineage = z.strictObject({ productId: z.uuid(), revisionId: z.uuid(), parentRevisionId: z.uuid().nullable(),
  revisionNumber: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) });
const lineageCheck = (value: z.infer<typeof Lineage>, ctx: z.RefinementCtx) => {
  if ((value.revisionNumber === 1) !== (value.parentRevisionId === null) || value.parentRevisionId === value.revisionId) {
    ctx.addIssue({ code: 'custom', path: ['parentRevisionId'], message: 'Inconsistent revision lineage' });
  }
};
const GenerationMetadata = {
  idea: Text, createdAt: z.iso.datetime(), promptVersion: Text.max(100),
  generator: z.strictObject({ id: Text.max(100), version: Text.max(100) }), sources: Sources,
  retainedPageIds: Ids.default([]),
};
export const PlanningRequestV1 = Lineage.extend(GenerationMetadata).superRefine((value, ctx) => {
  lineageCheck(value, ctx);
  if (postgresJsonBytes(value) > PLANNING_MAX_INPUT_BYTES) ctx.addIssue({ code: 'custom', message: 'Planning input exceeds 16 KiB budget' });
});
export const PlanningProvenanceV1 = z.strictObject({
  schemaVersion: z.literal('planning-provenance/1'), ...GenerationMetadata,
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/u), attempts: z.number().int().min(1).max(PLANNING_MAX_ATTEMPTS),
});

/** JSONB text byte count for validated planning values (only bounded integer numbers).
 * Key order does not affect size; PostgreSQL inserts spaces after commas/colons.
 */
export function postgresJsonBytes(value: unknown): number {
  if (Array.isArray(value)) return 2 + value.reduce((sum, item) => sum + postgresJsonBytes(item), 0) + Math.max(0, value.length - 1) * 2;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    return 2 + entries.reduce((sum, [key, item]) => sum + postgresJsonBytes(key) + 2 + postgresJsonBytes(item), 0) + Math.max(0, entries.length - 1) * 2;
  }
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export const PlanningEnvelopeV1 = Lineage.extend({
  schemaVersion: z.literal('planning-envelope/1'), plan: CreativePlanV1, provenance: PlanningProvenanceV1,
}).superRefine((value, ctx) => {
  lineageCheck(value, ctx);
  const sourceIds = new Set(value.provenance.sources.map(s => s.id));
  value.plan.manifest.pages.forEach((page, index) => {
    if (page.sourceIds.some(id => !sourceIds.has(id))) ctx.addIssue({ code: 'custom', path: ['plan', 'manifest', 'pages', index, 'sourceIds'], message: 'Unknown source reference' });
  });
  const pageIds = new Set(value.plan.manifest.pages.map(p => p.id));
  if (value.provenance.retainedPageIds.some(id => !pageIds.has(id))) ctx.addIssue({ code: 'custom', path: ['plan', 'manifest'], message: 'Retained page IDs must survive planning' });
  if (postgresJsonBytes(value) > PLANNING_MAX_BYTES) ctx.addIssue({ code: 'custom', message: 'Planning envelope exceeds 64 KiB revision content limit' });
});

export type PlanningRequest = z.infer<typeof PlanningRequestV1>;
export type PlanningEnvelope = z.infer<typeof PlanningEnvelopeV1>;
