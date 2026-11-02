import { z } from 'zod';
import { PlanningEnvelopeV1 } from './planning.ts';

export const DESIGN_MAX_BYTES = 2 * 1024 * 1024;
const BoundedJson = z.unknown().superRefine((value, ctx) => {
  try {
    const json = JSON.stringify(value);
    if (json === undefined || new TextEncoder().encode(json).length > DESIGN_MAX_BYTES) {
      ctx.addIssue({ code: 'custom', message: 'Design exceeds JSON budget' });
    }
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Design must be serializable JSON' });
  }
});
const Id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u);
const Ids = z.array(Id).max(500).refine(ids => new Set(ids).size === ids.length, 'Duplicate references');
const Text = z.string().min(1).max(4000).refine(
  value => !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value),
  'Text must be PostgreSQL-compatible Unicode',
);
const Distance = z.number().min(0).max(14400);
const Size = Distance.positive();
export const DesignColor = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/u);
const ColorRef = z.union([DesignColor, z.strictObject({ palette: Id })]);
export const DesignTypography = z.strictObject({
  fontAssetId: Id, fontSize: z.number().positive().max(1000),
  lineHeight: z.number().positive().max(2000), letterSpacing: z.number().min(-100).max(100),
  align: z.enum(['left', 'center', 'right', 'justify']),
});
const Asset = z.strictObject({ id: Id, kind: z.enum(['font', 'image']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u), sourceIds: Ids });
const Unit = z.number().min(0).max(1);
const Commands = z.array(z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('move'), x: Unit, y: Unit }),
  z.strictObject({ op: z.literal('line'), x: Unit, y: Unit }),
  z.strictObject({ op: z.literal('curve'), x1: Unit, y1: Unit, x2: Unit, y2: Unit, x: Unit, y: Unit }),
  z.strictObject({ op: z.literal('close') }),
])).min(2).max(1000).refine(commands => commands[0]?.op === 'move', 'Path must begin with move');
const Base = {
  id: Id, x: Distance, y: Distance, width: Size, height: Size,
  layer: z.number().int().min(-10000).max(10000), opacity: Unit,
  role: Text, dependsOnElementIds: Ids,
};
function elements<C extends z.ZodType, T extends z.ZodType>(color: C, typography: T) {
  const paint = { fill: color, stroke: color, strokeWidth: z.number().min(0).max(100) };
  return z.array(z.discriminatedUnion('type', [
    z.strictObject({ ...Base, type: z.literal('text'), text: Text, color, typography, padding: Distance }),
    z.strictObject({ ...Base, type: z.literal('image'), assetId: Id, fit: z.enum(['contain', 'cover']), alt: Text }),
    z.strictObject({ ...Base, type: z.literal('shape'), shape: z.enum(['rectangle', 'ellipse']), ...paint }),
    z.strictObject({ ...Base, type: z.literal('path'), commands: Commands, ...paint }),
  ])).min(1).max(500);
}
const Page = z.strictObject({ id: Id, width: Size, height: Size, background: ColorRef,
  elements: elements(ColorRef, Id) });
const Common = { planning: PlanningEnvelopeV1, assets: z.array(Asset).max(500) };
const Request = z.strictObject({ schemaVersion: z.literal('design-request/1'), ...Common,
  typography: z.record(Id, DesignTypography).refine(v => Object.keys(v).length <= 100, 'Too many typography bindings'),
  pages: z.array(Page).min(1).max(200) });
const ResolvedPage = Page.extend({ background: DesignColor,
  elements: elements(DesignColor, DesignTypography),
  order: z.number().int().positive(), name: Text, purpose: Text,
  density: z.enum(['sparse', 'medium', 'dense']), dependsOnPageIds: Ids, sourceIds: Ids,
  assetIds: Ids,
});
const Resolved = z.strictObject({ schemaVersion: z.literal('resolved-design/1'), ...Common,
  units: z.literal('pt'), resolverVersion: z.literal('design-resolver/1'),
  pages: z.array(ResolvedPage).min(1).max(200) });
type RequestData = z.infer<typeof Request>;
type ResolvedData = z.infer<typeof Resolved>;
type Element = RequestData['pages'][number]['elements'][number] | ResolvedData['pages'][number]['elements'][number];

function check(value: RequestData | ResolvedData, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const manifest = value.planning.plan.manifest.pages;
  const assets = new Map(value.assets.map(a => [a.id, a]));
  const sources = new Set(value.planning.provenance.sources.map(s => s.id));
  const allElements = value.pages.flatMap<Element>(p => p.elements);
  const elementIds = new Set(allElements.map(e => e.id));
  const nodeIds = [value.planning.plan.brief.id, ...value.planning.plan.deliverables.items.map(d => d.id),
    ...manifest.map(p => p.id), ...value.assets.map(a => a.id), ...allElements.map(e => e.id)];
  if (new Set(nodeIds).size !== nodeIds.length) issue([], 'Design node IDs must be unique');
  if (value.pages.length !== manifest.length) issue(['pages'], 'Every manifest page needs one composition');
  value.assets.forEach((asset, i) => {
    if (asset.sourceIds.some(id => !sources.has(id))) issue(['assets', i, 'sourceIds'], 'Unknown source reference');
  });
  const assetCheck = (id: string, kind: 'font' | 'image', path: (string | number)[]) => {
    if (assets.get(id)?.kind !== kind) issue(path, 'Unknown asset or incorrect asset kind');
  };
  if ('typography' in value) Object.entries(value.typography).forEach(([key, type]) => {
    assetCheck(type.fontAssetId, 'font', ['typography', key, 'fontAssetId']);
  });
  const colorCheck = (color: z.infer<typeof ColorRef>, path: (string | number)[]) => {
    if (typeof color === 'string') return;
    const palette = value.planning.plan.visualDNA.palette;
    if (!Object.hasOwn(palette, color.palette) || !DesignColor.safeParse(palette[color.palette]).success) {
      issue(path, 'Unknown palette reference or unsupported color');
    }
  };
  value.pages.forEach((page, i) => {
    const path = ['pages', i];
    const metadata = manifest[i];
    if (page.id !== metadata?.id) issue([...path, 'id'], 'Composition must follow manifest identity and order');
    colorCheck(page.background, [...path, 'background']);
    page.elements.forEach((element, j) => {
      const ep = [...path, 'elements', j];
      const halfStroke = 'strokeWidth' in element ? element.strokeWidth / 2 : 0;
      if (element.x < halfStroke || element.y < halfStroke ||
        element.x + element.width + halfStroke > page.width || element.y + element.height + halfStroke > page.height) {
        issue(ep, 'Painted geometry exceeds page bounds');
      }
      if (element.dependsOnElementIds.some(id => !elementIds.has(id))) issue(ep, 'Unknown element dependency');
      checkElement(element, ep, issue, colorCheck, assetCheck, value);
    });
    if ('assetIds' in page && metadata) {
      const expected = pageAssetIds(page.elements);
      if (JSON.stringify(page.assetIds) !== JSON.stringify(expected)) issue([...path, 'assetIds'], 'Asset dependencies mismatch');
      for (const key of ['order', 'name', 'purpose', 'density', 'dependsOnPageIds', 'sourceIds'] as const) {
        if (JSON.stringify(page[key]) !== JSON.stringify(metadata[key])) issue([...path, key], 'Manifest metadata mismatch');
      }
    }
  });
  if (hasCycle(allElements)) issue(['pages'], 'Cyclic element dependencies');
}

/** Kahn traversal: linear in nodes + edges, without recursive stack growth. */
function hasCycle(elements: Element[]): boolean {
  const pending = new Map(elements.map(e => [e.id, e.dependsOnElementIds.length]));
  type Consumer = { id: string; next?: Consumer };
  const consumers = new Map<string, Consumer>();
  for (const element of elements) for (const dependency of element.dependsOnElementIds) {
    consumers.set(dependency, { id: element.id, next: consumers.get(dependency) });
  }
  const queue = elements.filter(e => e.dependsOnElementIds.length === 0).map(e => e.id);
  for (let i = 0; i < queue.length; i++) {
    for (let consumer = consumers.get(queue[i]); consumer; consumer = consumer.next) {
      const count = pending.get(consumer.id)! - 1;
      pending.set(consumer.id, count);
      if (count === 0) queue.push(consumer.id);
    }
  }
  return queue.length !== elements.length;
}

function checkElement(element: Element, path: (string | number)[],
  issue: (path: (string | number)[], message: string) => void,
  colorCheck: (color: z.infer<typeof ColorRef>, path: (string | number)[]) => void,
  assetCheck: (id: string, kind: 'font' | 'image', path: (string | number)[]) => void,
  value: RequestData | ResolvedData) {
  if (element.type === 'text') {
    colorCheck(element.color, [...path, 'color']);
    if (element.padding * 2 >= Math.min(element.width, element.height)) issue(path, 'Padding consumes text box');
    if (typeof element.typography === 'string') {
      if (!('typography' in value) || !Object.hasOwn(value.typography, element.typography)) issue(path, 'Unknown typography reference');
    } else assetCheck(element.typography.fontAssetId, 'font', [...path, 'typography']);
  } else if (element.type === 'image') assetCheck(element.assetId, 'image', [...path, 'assetId']);
  else {
    colorCheck(element.fill, [...path, 'fill']);
    colorCheck(element.stroke, [...path, 'stroke']);
  }
}

/** Asset edges are explicit in resolved output; element and page edges retain original IDs. */
export function pageAssetIds(elements: ResolvedData['pages'][number]['elements']): string[] {
  return [...new Set(elements.flatMap(e => e.type === 'image' ? [e.assetId] :
    e.type === 'text' ? [e.typography.fontAssetId] : []))].sort();
}
export const DesignRequestV1 = BoundedJson.pipe(Request.superRefine(check));
export const ResolvedDesignV1 = BoundedJson.pipe(Resolved.superRefine(check));
export type DesignRequest = z.infer<typeof DesignRequestV1>;
export type ResolvedDesign = z.infer<typeof ResolvedDesignV1>;
