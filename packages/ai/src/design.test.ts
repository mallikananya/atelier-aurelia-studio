import { describe, expect, it } from 'vitest';
import { DesignRequestV1, ResolvedDesignV1 } from '../../contracts/src/design.ts';
import { resolveDesign } from './design.ts';
import { romanticReadingDesign, retroTravelDesign } from './fixtures/design.ts';

describe('declarative design resolution', () => {
  it.each([romanticReadingDesign, retroTravelDesign])('resolves a complete plan with stable identities and provenance', fixture => {
    const before = structuredClone(fixture);
    expect(DesignRequestV1.safeParse(fixture).success).toBe(true);
    const result = resolveDesign(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected resolved design');
    expect(ResolvedDesignV1.safeParse(result.design).success).toBe(true);
    expect(result.design.pages.map(p => p.id)).toEqual(fixture.planning.plan.manifest.pages.map(p => p.id));
    expect(result.design.planning).toEqual(DesignRequestV1.parse(fixture).planning);
    expect(result.design.pages[0].background).toBe(fixture.planning.plan.visualDNA.palette.paper);
    expect(result.design.pages[0].elements.map(e => e.layer)).toEqual([0, 0, 1, 2]);
    const heading = result.design.pages[0].elements.find(e => e.type === 'text');
    expect(heading?.type === 'text' && heading.typography.fontSize).toBe(fixture.typography.title.fontSize);
    expect(result.design.pages[0].assetIds).toEqual(fixture.assets.map(a => a.id).sort());
    expect(result.design.pages[1].dependsOnPageIds).toEqual(fixture.planning.plan.manifest.pages[1].dependsOnPageIds);
    expect(fixture).toEqual(before);
    expect(resolveDesign(fixture)).toEqual(result);
  });

  const invalid: [string, (value: any) => void][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
    ['negative geometry', v => { v.pages[0].elements[0].width = -1; }],
    ['non-finite geometry', v => { v.pages[0].width = Infinity; }],
    ['overflow', v => { v.pages[0].elements[0].x = 590; }],
    ['unknown property', v => { v.pages[0].elements[0].css = 'position:fixed'; }],
    ['unknown primitive', v => { v.pages[0].elements[0].type = 'html'; }],
    ['missing palette', v => { v.pages[0].background.palette = 'absent'; }],
    ['invalid palette color', v => { v.planning.plan.visualDNA.palette.paper = 'url(secret)'; }],
    ['missing typography', v => { v.pages[0].elements[0].typography = 'absent'; }],
    ['wrong asset kind', v => { v.assets[0].kind = 'image'; }],
    ['missing image', v => { v.pages[0].elements[2].assetId = 'absent'; }],
    ['unknown source', v => { v.assets[0].sourceIds = ['absent']; }],
    ['duplicate elements', v => { v.pages[0].elements[1].id = v.pages[0].elements[0].id; }],
    ['duplicate pages', v => { v.pages[1].id = v.pages[0].id; }],
    ['missing page', v => { v.pages.pop(); }],
    ['unknown dependency', v => { v.pages[0].elements[0].dependsOnElementIds = ['absent']; }],
    ['cyclic dependency', v => { v.pages[0].elements[0].dependsOnElementIds = [v.pages[0].elements[2].id]; }],
    ['invalid vector coordinate', v => { v.pages[0].elements[1].commands[0].x = 2; }],
    ['invalid vector start', v => { v.pages[0].elements[1].commands.shift(); }],
    ['excessive padding', v => { v.pages[0].elements[0].padding = 100; }],
    ['duplicate assets', v => { v.assets.push(v.assets[0]); }],
    ['empty vector commands', v => { v.pages[0].elements[1].commands = []; }],
    ['NUL text', v => { v.pages[0].elements[0].text = '\0'; }],
    ['unpaired surrogate', v => { v.pages[0].elements[0].text = '\uD800'; }],
    ['existing graph ID collision', v => { v.assets[1].id = v.planning.plan.brief.id; }],
    ['oversized document', v => { v.extra = 'a'.repeat(2 * 1024 * 1024); }],
    ['circular input', v => { v.extra = v; }],
  ];
  it.each(invalid)('rejects %s without partial output', (_, mutate) => {
    const value = structuredClone(romanticReadingDesign);
    mutate(value);
    expect(DesignRequestV1.safeParse(value).success).toBe(false);
    const result = resolveDesign(value);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('design');
  });
  it('supports literal colors and returns independent output objects', () => {
    const value = structuredClone(romanticReadingDesign);
    const input = { ...value, pages: value.pages.map(p => ({ ...p, background: '#ABCDEF' })) };
    const result = resolveDesign(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected resolved design');
    expect(result.design.pages[0].background).toBe('#ABCDEF');
    result.design.pages[0].elements[0].x = 0;
    expect(input.pages[0].elements[0].x).toBe(64);
    const badAssets = { ...result.design, pages: result.design.pages.map(p => ({ ...p, assetIds: [] })) };
    expect(ResolvedDesignV1.safeParse(badAssets).success).toBe(false);
    const badMetadata = { ...result.design, pages: result.design.pages.map(p => ({ ...p, name: 'changed' })) };
    expect(ResolvedDesignV1.safeParse(badMetadata).success).toBe(false);
  });
  it('rejects absent and non-JSON input', () => {
    expect(resolveDesign(undefined).ok).toBe(false);
    expect(resolveDesign(1n).ok).toBe(false);
  });
});
