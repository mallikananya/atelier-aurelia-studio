import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Local CLI module is exercised directly by Vitest.
import { generateProofs } from '../../tools/generate-design-proofs.mjs';

describe('local proof workflow', () => {
  it('writes both existing fixtures and a side-by-side artifact reproducibly', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aurelia-proof-'));
    try {
      const first = await generateProofs(directory);
      expect(first.map((p: { pageId: string }) => p.pageId)).toEqual(['reading-cover', 'travel-route']);
      expect(first.every((p: { findings: unknown[] }) => p.findings.length === 0)).toBe(true);
      const png = await readFile(join(directory, 'contact-sheet.png'));
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      await generateProofs(directory);
      expect(await readFile(join(directory, 'contact-sheet.png'))).toEqual(png);
      const reading = JSON.parse(await readFile(join(directory, 'reading-cover.json'), 'utf8'));
      expect(reading.design.planning.provenance.generator.id).toBe('fake-provider');
      expect(reading.design.pages[0].elements.map((e: {id: string}) => e.id)).toContain('reading-cover-art');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
