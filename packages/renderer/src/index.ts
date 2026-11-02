import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { create, type Font } from 'fontkit';
import { ResolvedDesignV1, type ResolvedDesign } from '../../contracts/src/design.ts';
import { renderText } from './text.ts';

export type Finding = { code: string; message: string; pageId: string; elementId?: string };
export type Element = ResolvedDesign['pages'][number]['elements'][number];
export class RenderError extends Error {
  public code: string;
  constructor(code: string, message: string) { super(`${code}: ${message}`); this.name = 'RenderError'; this.code = code; }
}
export const escapeXml = (value: string) => value.replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function loadAssets(design: ResolvedDesign, ids: string[], assets: Record<string, Uint8Array>) {
  const fonts = new Map<string, Font>();
  const images = new Map<string, string>();
  for (const id of ids) {
    const record = design.assets.find(a => a.id === id)!;
    const bytes = Object.hasOwn(assets, id) ? assets[id] : undefined;
    if (!bytes) throw new RenderError('missing_asset', `Supply local bytes for ${record.kind} ${id}.`);
    if (bytes.byteLength > 20 * 1024 * 1024) throw new RenderError('asset_budget', `Asset ${id} exceeds 20 MiB.`);
    if (hash(bytes) !== record.sha256) throw new RenderError('asset_hash_mismatch', `Asset ${id} differs from its declared SHA-256; provide matching bytes.`);
    try {
      if (record.kind === 'font') {
        const font = create(Buffer.from(bytes));
        if (!('layout' in font) || 'COLR' in font || 'sbix' in font) throw new Error('Use a single outline font, not a collection or color font.');
        fonts.set(id, font);
      } else {
        const pipeline = sharp(bytes, { limitInputPixels: 20_000_000, animated: true });
        const info = await pipeline.metadata();
        if (!['png', 'jpeg', 'webp'].includes(info.format ?? '') || (info.pages ?? 1) > 1) throw new Error('Use a static PNG, JPEG or WebP.');
        const png = await pipeline.rotate().png().toBuffer();
        images.set(id, `data:image/png;base64,${png.toString('base64')}`);
      }
    } catch {
      throw new RenderError('unsupported_asset', `Cannot decode ${record.kind} ${id}. Use a single outline TTF/OTF/WOFF font or static PNG/JPEG/WebP image.`);
    }
  }
  return { fonts, images };
}

function geometry(element: Exclude<Element, { type: 'text' }>, images: Map<string, string>) {
  const e = element;
  if (e.type === 'image') return `<image x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" preserveAspectRatio="xMidYMid ${e.fit === 'cover' ? 'slice' : 'meet'}" href="${images.get(e.assetId)}"><title>${escapeXml(e.alt)}</title></image>`;
  const paint = `fill="${e.fill}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"`;
  if (e.type === 'shape') return e.shape === 'rectangle'
    ? `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" ${paint}/>`
    : `<ellipse cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}" ${paint}/>`;
  const x = (v: number) => e.x + v * e.width;
  const y = (v: number) => e.y + v * e.height;
  const commands = e.commands.map(c => {
    switch (c.op) {
      case 'move': return `M${x(c.x)} ${y(c.y)}`;
      case 'line': return `L${x(c.x)} ${y(c.y)}`;
      case 'curve': return `C${x(c.x1)} ${y(c.y1)} ${x(c.x2)} ${y(c.y2)} ${x(c.x)} ${y(c.y)}`;
      case 'close': return 'Z';
    }
  }).join(' ');
  return `<path d="${commands}" ${paint}/>`;
}

/** Pure local single-page proof. No network, filesystem, persistence, or aesthetic selection. */
export async function renderPage(input: unknown, pageId: string, assets: Record<string, Uint8Array>) {
  const parsed = ResolvedDesignV1.safeParse(input);
  if (!parsed.success) throw new RenderError('invalid_design', 'Provide a valid resolved-design/1 contract.');
  const design = parsed.data;
  const page = design.pages.find(p => p.id === pageId);
  if (!page) throw new RenderError('unknown_page', `Page ${pageId} is absent from the design.`);
  if (Math.ceil(page.width) * Math.ceil(page.height) > 20_000_000) throw new RenderError('page_budget', 'Single-page proof exceeds 20 million pixels at 72 dpi.');
  const characters = page.elements.reduce((sum, e) => sum + (e.type === 'text' ? e.text.length : 0), 0);
  if (characters > 20_000) throw new RenderError('text_budget', 'Single-page proof exceeds 20,000 text characters. Split content before rendering.');
  const { fonts, images } = await loadAssets(design, page.assetIds, assets);
  const findings: Finding[] = [];
  const metadata = { rendererVersion: 'local-proof/1', schemaVersion: design.schemaVersion, resolverVersion: design.resolverVersion,
    productId: design.planning.productId, revisionId: design.planning.revisionId,
    provenance: design.planning.provenance, page: { ...page, elements: page.elements.map(e => ({ id: e.id, dependsOnElementIds: e.dependsOnElementIds })) },
    assets: design.assets.filter(a => page.assetIds.includes(a.id)), inputSha256: hash(Buffer.from(JSON.stringify(design))) };
  const nodes = [...page.elements].sort((a,b) => a.layer - b.layer).map(e => {
    const body = e.type === 'text' ? renderText(e, fonts.get(e.typography.fontAssetId)!, page, findings) : geometry(e, images);
    return `<g id="${e.id}" opacity="${e.opacity}" data-layer="${e.layer}">${body}</g>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}"><metadata>${escapeXml(JSON.stringify(metadata))}</metadata><rect width="${page.width}" height="${page.height}" fill="${page.background}"/>${nodes.join('')}</svg>`;
  const png = await sharp(Buffer.from(svg), { density: 72, limitInputPixels: 20_000_000 }).png().toBuffer();
  return { svg, png, findings, metadata };
}
