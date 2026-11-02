import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { resolveDesign } from '../../ai/src/design.ts';
import { romanticReadingDesign } from '../../ai/src/fixtures/design.ts';
import { renderPage } from './index.ts';

async function fixture() {
  const font = readFileSync(new URL('../../../tests/fixtures/render-assets/reading.ttf', import.meta.url));
  const image = await sharp({ create: { width: 8, height: 4, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const assets = { 'reading-font': font, 'reading-art': image };
  const request = structuredClone(romanticReadingDesign);
  request.assets = request.assets.map(a => ({ ...a, sha256: createHash('sha256').update(assets[a.id as keyof typeof assets]).digest('hex') }));
  const result = resolveDesign(request);
  if (!result.ok) throw new Error('Fixture failed');
  return { design: result.design, pageId: result.design.pages[0].id, assets };
}
describe('local proof renderer', () => {
  it('renders deterministic SVG and PNG retaining metadata and stable layers', async () => {
    const {design,pageId,assets} = await fixture();
    const a = await renderPage(design,pageId,assets);
    const b = await renderPage(design,pageId,assets);
    expect(a).toEqual(b);
    expect(a.findings).toEqual([]);
    expect(a.svg).toContain('planning-provenance/1');
    expect(a.svg.indexOf(`<g id="${pageId}-ornament"`)).toBeLessThan(a.svg.indexOf(`<g id="${pageId}-heading"`));
    expect((await sharp(a.png).metadata()).width).toBe(595);
    expect(design.pages[0].elements[0].id).toBe(`${pageId}-ornament`);
  });
  it('reports text overflow without shrinking or clipping', async () => {
    const {design,pageId,assets} = await fixture();
    const page = design.pages[0];
    const text = page.elements.find(e => e.type === 'text')!;
    text.height = 20; text.text = 'A very long paragraph '.repeat(20);
    const result = await renderPage(design,pageId,assets);
    expect(result.findings.some(f => f.code === 'text_overflow' && f.elementId === text.id)).toBe(true);
    expect(result.svg).not.toContain('clipPath');
  });
  it('rejects invalid inputs, absent pages, missing bytes and hash mismatch', async () => {
    const {design,pageId,assets} = await fixture();
    await expect(renderPage({},pageId,assets)).rejects.toThrow('invalid_design');
    await expect(renderPage(design,'absent',assets)).rejects.toThrow('unknown_page');
    await expect(renderPage(design,pageId,{})).rejects.toThrow('missing_asset');
    await expect(renderPage(design,pageId,{...assets,'reading-art': Buffer.from('bad')})).rejects.toThrow('asset_hash_mismatch');
  });
});

describe('supported primitives and bounded failures', () => {
  it('renders rectangle, line vectors, cover images, right-aligned and multiline text', async () => {
    const {design,pageId,assets} = await fixture();
    const page = design.pages[0];
    for (const e of page.elements) {
      if (e.type === 'shape') e.shape = 'rectangle';
      if (e.type === 'image') e.fit = 'cover';
      if (e.type === 'text') { e.typography.align = 'right'; e.text = 'One\nTwo'; }
    }
    const result = await renderPage(design,pageId,assets);
    expect(result.svg).toContain('slice');
    expect(result.svg).toContain('aria-label="One\nTwo"');
    expect(result.svg).toContain('<rect x="50"');
  });
  it('reports unbreakable words, negative tracking ink and page overflow', async () => {
    const {design,pageId,assets} = await fixture();
    const e = design.pages[0].elements.find(e => e.type === 'text')!;
    e.typography.align = 'left'; e.typography.letterSpacing = -10;
    e.text = 'M'.repeat(300); e.width = 50; e.height = 30;
    const result = await renderPage(design,pageId,assets);
    expect(result.findings.map(f => f.code)).toContain('text_overflow');
    expect(result.findings.map(f => f.code)).toContain('page_overflow');
  });
  it('explicitly rejects justify, bidi and missing glyphs', async () => {
    const {design,pageId,assets} = await fixture();
    const e = design.pages[0].elements.find(e => e.type === 'text')!;
    e.typography.align = 'justify';
    await expect(renderPage(design,pageId,assets)).rejects.toThrow('unsupported_typography');
    e.typography.align = 'left'; e.text = 'שלום';
    await expect(renderPage(design,pageId,assets)).rejects.toThrow('unsupported_typography');
    e.text = '🦄';
    await expect(renderPage(design,pageId,assets)).rejects.toThrow('missing_glyph');
  });
  it('rejects corrupt fonts and images even with matching hashes', async () => {
    const {design,pageId,assets} = await fixture();
    for (const id of ['reading-font','reading-art'] as const) {
      const input = structuredClone(design);
      const bad = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
      input.assets.find(a => a.id === id)!.sha256 = createHash('sha256').update(bad).digest('hex');
      await expect(renderPage(input,pageId,{...assets,[id]:bad})).rejects.toThrow('unsupported_asset');
    }
  });
  it('rejects unsupported image formats and excessive budgets', async () => {
    const {design,pageId,assets} = await fixture();
    const gif = await sharp(assets['reading-art']).gif().toBuffer();
    design.assets.find(a => a.id === 'reading-art')!.sha256 = createHash('sha256').update(gif).digest('hex');
    await expect(renderPage(design,pageId,{...assets,'reading-art':gif})).rejects.toThrow('unsupported_asset');
    await expect(renderPage(design,pageId,{...assets,'reading-art':Buffer.alloc(21*1024*1024)})).rejects.toThrow('asset_budget');
    design.pages[0].width = 10000; design.pages[0].height = 10000;
    await expect(renderPage(design,pageId,assets)).rejects.toThrow('page_budget');
  });
});

describe('authored whitespace and image crop', () => {
  it('preserves repeated and leading spaces as glyph advances', async () => {
    const {design,pageId,assets} = await fixture();
    const e = design.pages[0].elements.find(e => e.type === 'text')!;
    e.text = ' A  B'; e.typography.align = 'left';
    const result = await renderPage(design,pageId,assets);
    const textGroup = result.svg.slice(result.svg.indexOf('aria-label=" A  B"'));
    expect(textGroup.match(/transform="translate/g)).toHaveLength(5);
    e.text = ' A B';
    const single = await renderPage(design,pageId,assets);
    expect(result.png.equals(single.png)).toBe(false);
  });
  it('cover fills its placement and does not paint adjacent pixels', async () => {
    const {design,pageId,assets} = await fixture();
    const e = design.pages[0].elements.find(e => e.type === 'image')!;
    e.fit = 'cover';
    const {png} = await renderPage(design,pageId,assets);
    const {data, info} = await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const pixel = (x: number,y: number) => [...data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3)];
    expect(pixel(e.x+1,e.y+1)).toEqual([255,0,0]);
    expect(pixel(e.x+e.width-1,e.y+e.height-1)).toEqual([255,0,0]);
    expect(pixel(e.x-1,e.y+80)).not.toEqual([255,0,0]);
    expect(pixel(e.x+e.width,e.y+80)).not.toEqual([255,0,0]);
  });
});

describe('paint stacking', () => {
  it('paints higher layers last and preserves authored order for equal layers', async () => {
    const {design,pageId,assets} = await fixture();
    const page = design.pages[0];
    const panel = page.elements.find(e => e.type === 'shape')!;
    const low = {...panel,id:'lower-paint',shape:'rectangle' as const,x:50,y:500,width:200,height:100,strokeWidth:0,fill:'#FF0000',layer:5};
    const high = {...low,id:'higher-paint',fill:'#0000FF',layer:6};
    // Deliberately reverse layer order in the authored array.
    page.elements = [...page.elements, high, low];
    const layered = await renderPage(design,pageId,assets);
    expect(layered.svg.indexOf('<g id="lower-paint"')).toBeLessThan(layered.svg.indexOf('<g id="higher-paint"'));
    const centerPixel = async (png: Buffer) => [...await sharp(png).extract({left:100,top:550,width:1,height:1}).removeAlpha().raw().toBuffer()];
    expect(await centerPixel(layered.png)).toEqual([0,0,255]);
    // Tied layers must retain the authored order: low follows high.
    page.elements = page.elements.map(e => e.id === 'higher-paint' ? {...e,layer:5} : e);
    const tied = await renderPage(design,pageId,assets);
    expect(tied.svg.indexOf('<g id="higher-paint"')).toBeLessThan(tied.svg.indexOf('<g id="lower-paint"'));
    expect(await centerPixel(tied.png)).toEqual([255,0,0]);
  });
});
