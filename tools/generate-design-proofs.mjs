import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { resolveDesign } from '../packages/ai/src/design.ts';
import { romanticReadingDesign, retroTravelDesign } from '../packages/ai/src/fixtures/design.ts';
import { renderPage } from '../packages/renderer/src/index.ts';

const assetRoot = fileURLToPath(new URL('../tests/fixtures/render-assets/', import.meta.url));

/** Fixture-only asset binding. No fixture selection or layout logic enters the renderer. */
export async function generateProofs(directory = fileURLToPath(new URL('../output/ce-03b/', import.meta.url))) {
  await mkdir(directory, { recursive: true });
  const proofs = [];
  for (const [prefix, fixture] of [['reading', romanticReadingDesign], ['travel', retroTravelDesign]]) {
    const assets = {
      [`${prefix}-font`]: await readFile(join(assetRoot, `${prefix}.ttf`)),
      [`${prefix}-art`]: await readFile(join(assetRoot, `${prefix}-art.png`)),
    };
    const request = { ...fixture, assets: fixture.assets.map(asset => ({
      ...asset, sha256: createHash('sha256').update(assets[asset.id]).digest('hex'),
    })) };
    const result = resolveDesign(request);
    if (!result.ok) throw new Error(`Invalid ${prefix} proof fixture: ${JSON.stringify(result.error)}`);
    const pageId = result.design.pages[0].id;
    const proof = await renderPage(result.design, pageId, assets);
    await writeFile(join(directory, `${pageId}.svg`), proof.svg);
    await writeFile(join(directory, `${pageId}.png`), proof.png);
    await writeFile(join(directory, `${pageId}.json`), JSON.stringify({
      fixtureOnly: true, ownerAestheticApproval: 'pending', design: result.design,
      metadata: proof.metadata, findings: proof.findings,
    }, null, 2) + '\n');
    proofs.push({ pageId, findings: proof.findings, png: proof.png });
  }
  await sharp({ create: { width: 1267, height: 882, channels: 4, background: '#d8d6d2' } })
    .composite(proofs.map((proof, i) => ({ input: proof.png, left: i === 0 ? 20 : 635, top: 20 })))
    .png().toFile(join(directory, 'contact-sheet.png'));
  return proofs.map(({ pageId, findings }) => ({ pageId, findings }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const proofs = await generateProofs();
  console.log(JSON.stringify({ directory: resolve('output/ce-03b'), proofs }, null, 2));
  if (proofs.some(proof => proof.findings.length)) process.exitCode = 1;
}
