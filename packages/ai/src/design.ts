import {
  DesignRequestV1, ResolvedDesignV1, pageAssetIds,
  type DesignRequest, type ResolvedDesign,
} from '../../contracts/src/design.ts';

export type DesignResult = { ok: true; design: ResolvedDesign } | {
  ok: false; error: { code: 'invalid_design'; issues: { path: string; code: string }[] };
};

function resolvePage(page: DesignRequest['pages'][number], request: DesignRequest) {
  const color = (value: string | { palette: string }): string => typeof value === 'string' ? value :
    request.planning.plan.visualDNA.palette[value.palette];
  const elements = page.elements.map(element => {
    if (element.type === 'text') return { ...element, color: color(element.color), typography: request.typography[element.typography] };
    if (element.type === 'image') return element;
    return { ...element, fill: color(element.fill), stroke: color(element.stroke) };
  }).sort((a, b) => a.layer - b.layer); // Stable ties retain authored order.
  return { ...page, background: color(page.background), elements, assetIds: pageAssetIds(elements) };
}

/** Pure provider-independent compiler. No provider, storage, asset fetching or layout heuristics. */
export function resolveDesign(input: unknown): DesignResult {
  const parsed = DesignRequestV1.safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues);
  const request = parsed.data;
  const result = ResolvedDesignV1.safeParse({
    schemaVersion: 'resolved-design/1', units: 'pt', resolverVersion: 'design-resolver/1',
    planning: request.planning, assets: request.assets,
    pages: request.pages.map((page, i) => ({ ...request.planning.plan.manifest.pages[i], ...resolvePage(page, request) })),
  });
  return result.success ? { ok: true, design: result.data } : failure(result.error.issues);
}
function failure(issues: readonly { path: readonly PropertyKey[]; code: string }[]): DesignResult {
  // No raw provider values or custom token names in diagnostics.
  return { ok: false, error: { code: 'invalid_design', issues: issues.slice(0, 20).map(issue => ({
    path: issue.path.map(part => typeof part === 'number' ? part : '[field]').join('.').slice(0, 200), code: issue.code,
  })) } };
}
