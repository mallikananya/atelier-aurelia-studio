import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { generatePlanner, validatePlanner, plannerManifest } from './planner.ts';

describe('undated weekly planner v1', () => {
  it('generates a deterministic, complete A4 PDF', async () => {
    const bytes = await generatePlanner();
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(146);
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 2);
      expect(page.getHeight()).toBeCloseTo(841.89, 2);
    }
    expect(plannerManifest.filter(p => p.section === 'weekly')).toHaveLength(104);
    expect(plannerManifest.filter(p => p.section === 'monthly')).toHaveLength(12);
    expect(plannerManifest.filter(p => p.section === 'habits')).toHaveLength(12);
    expect(plannerManifest.filter(p => p.section === 'reflection')).toHaveLength(12);
    const report = await validatePlanner(bytes);
    expect(report.pageCount).toBe(146);
    expect(report.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(await generatePlanner()).toEqual(bytes);
  });
  it('rejects malformed, truncated, incomplete and wrong-size documents', async () => {
    await expect(validatePlanner(new Uint8Array([1, 2]))).rejects.toThrow();
    const bytes = await generatePlanner();
    await expect(validatePlanner(bytes.slice(0, bytes.length - 30))).rejects.toThrow();
    const doc = await PDFDocument.load(bytes);
    doc.removePage(0);
    await expect(validatePlanner(await doc.save())).rejects.toThrow();
    const missingSection = await PDFDocument.load(bytes);
    const [blank] = await missingSection.copyPages(await PDFDocument.create().then(d => { d.addPage([595.28, 841.89]); return d; }), [0]);
    missingSection.removePage(0); missingSection.insertPage(0, blank);
    await expect(validatePlanner(await missingSection.save())).rejects.toThrow();
    const wrongSize = await PDFDocument.load(bytes);
    wrongSize.getPage(0).setSize(612, 792);
    await expect(validatePlanner(await wrongSize.save())).rejects.toThrow();
  });
});
