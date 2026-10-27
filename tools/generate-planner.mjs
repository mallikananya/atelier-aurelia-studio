import { mkdir, writeFile } from 'node:fs/promises';
import { generatePlanner, validatePlanner } from '../packages/workflows/dist/workflows/src/planner.js';

const bytes = await generatePlanner();
const report = await validatePlanner(bytes);
await mkdir('output/pdf', { recursive: true });
await writeFile('output/pdf/atelier-aurelia-undated-weekly.pdf', bytes);
console.info(JSON.stringify({ ...report, file: 'output/pdf/atelier-aurelia-undated-weekly.pdf' }));
