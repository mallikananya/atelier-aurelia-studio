// Acceptance examples only; production resolution never selects an aesthetic.
import { readingPlan, travelPlan, planningRequest } from './planning.ts';

function fixture(plan: typeof readingPlan | typeof travelPlan, travel: boolean) {
  const prefix = travel ? 'travel' : 'reading';
  return {
    schemaVersion: 'design-request/1',
    planning: { schemaVersion: 'planning-envelope/1',
      productId: planningRequest.productId, revisionId: planningRequest.revisionId,
      parentRevisionId: null, revisionNumber: 1, plan,
      provenance: { schemaVersion: 'planning-provenance/1',
        idea: planningRequest.idea, createdAt: planningRequest.createdAt,
        promptVersion: planningRequest.promptVersion, generator: planningRequest.generator,
        sources: [], retainedPageIds: [], inputSha256: 'a'.repeat(64), attempts: 1 },
    },
    assets: [
      { id: `${prefix}-font`, kind: 'font', sha256: 'b'.repeat(64), sourceIds: [] },
      { id: `${prefix}-art`, kind: 'image', sha256: 'c'.repeat(64), sourceIds: [] },
    ],
    typography: { title: { fontAssetId: `${prefix}-font`, fontSize: travel ? 36 : 24,
      lineHeight: travel ? 42 : 32, letterSpacing: travel ? 2 : 0, align: travel ? 'left' : 'center' } },
    pages: plan.manifest.pages.map((page, index) => ({
      id: page.id, width: travel ? 612 : 595, height: travel ? 792 : 842,
      background: { palette: 'paper' },
      elements: [
        { id: `${page.id}-heading`, type: 'text', x: travel ? 28 : 64, y: 50, width: 460, height: 90,
          layer: 2, opacity: 1, role: 'heading', dependsOnElementIds: [], text: page.name,
          color: { palette: travel ? 'blue' : 'ink' }, typography: 'title', padding: 8 },
        { id: `${page.id}-ornament`, type: 'path', x: 50, y: 170, width: 440, height: 100,
          layer: 0, opacity: travel ? 1 : 0.4, role: 'decoration', dependsOnElementIds: [],
          fill: { palette: travel ? 'red' : 'ink' }, stroke: { palette: travel ? 'blue' : 'ink' }, strokeWidth: 1,
          commands: [{ op: 'move', x: 0, y: 0 }, { op: 'curve', x1: 0.2, y1: travel ? 0.9 : 0.1,
            x2: 0.7, y2: 0.8, x: 1, y: 1 }, { op: 'line', x: 1, y: 0 }, { op: 'close' }] },
        { id: `${page.id}-art`, type: 'image', x: travel ? 320 : 80, y: 300, width: 160, height: 160,
          layer: 1, opacity: 1, role: 'illustration', dependsOnElementIds: [`${page.id}-heading`],
          assetId: `${prefix}-art`, fit: 'contain', alt: travel ? 'Travel screenprint' : 'Botanical engraving' },
        { id: `${page.id}-panel`, type: 'shape', shape: index === 0 ? 'ellipse' : 'rectangle',
          x: 50, y: 500, width: 480, height: 180, layer: 0, opacity: 1,
          role: 'writing-area', dependsOnElementIds: [], fill: { palette: 'paper' },
          stroke: { palette: travel ? 'blue' : 'ink' }, strokeWidth: 1 },
      ],
    })),
  };
}
export const romanticReadingDesign = fixture(readingPlan, false);
export const retroTravelDesign = fixture(travelPlan, true);
