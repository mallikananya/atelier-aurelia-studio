import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb, PDFName, PDFArray, PDFRawStream, decodePDFRawStream,
  type PDFPage, type PDFFont } from 'pdf-lib';

export const PLANNER_VERSION = 'aurelia-weekly-v1';
const WIDTH = 595.28;
const HEIGHT = 841.89;
const MARGIN = 48;
const INK = rgb(0.19, 0.22, 0.21);
const RULE = rgb(0.64, 0.67, 0.64);
const ACCENT = rgb(0.36, 0.43, 0.37);
const sequence = (count: number) => Array.from({ length: count }, (_, i) => i + 1);
export const plannerManifest = [
  { id: 'cover', section: 'cover', title: 'A quieter kind of progress' },
  { id: 'guide', section: 'guide', title: 'Make room for what matters' },
  ...sequence(12).flatMap(n => [
    { id: `month-${n}`, section: 'monthly', title: 'Monthly overview' },
    { id: `habits-${n}`, section: 'habits', title: 'Habit tracking' },
    { id: `reflection-${n}`, section: 'reflection', title: 'Monthly reflection' },
  ]),
  ...sequence(52).flatMap(n => [
    { id: `week-${n}-a`, section: 'weekly', title: 'Weekly planning' },
    { id: `week-${n}-b`, section: 'weekly', title: 'Daily priorities & tasks' },
  ]),
  ...sequence(4).map(n => ({ id: `notes-${n}`, section: 'notes', title: 'Notes & possibilities' })),
] as const;

type Canvas = ReturnType<typeof canvas>;
function canvas(page: PDFPage, serif: PDFFont, sans: PDFFont) {
  const text = (value: string, x: number, top: number, size = 10, display = false) => {
    const font = display ? serif : sans;
    if (x < MARGIN || x + font.widthOfTextAtSize(value, size) > WIDTH - MARGIN + 1) {
      throw new Error('Planner text exceeds printable bounds.');
    }
    page.drawText(value, { x, y: HEIGHT - top - size, size, font, color: INK });
  };
  const line = (x: number, top: number, width: number) => page.drawLine({
    start: { x, y: HEIGHT - top }, end: { x: x + width, y: HEIGHT - top }, thickness: 0.5, color: RULE });
  const box = (x: number, top: number, width: number, height: number) => page.drawRectangle({
    x, y: HEIGHT - top - height, width, height, borderWidth: 0.5, borderColor: RULE });
  const lines = (x: number, top: number, width: number, count: number, gap = 24) => {
    sequence(count).forEach(n => line(x, top + (n - 1) * gap, width));
  };
  return { text, line, box, lines };
}

function cover(c: Canvas) {
  c.text('ATELIER AURELIA', MARGIN, 88, 12);
  c.line(MARGIN, 155, 56);
  c.text('A quieter kind of progress', MARGIN, 252, 31, true);
  c.text('THE UNDATED WEEKLY PLANNER', MARGIN, 312, 11);
  c.text('Twelve months. Fifty-two weeks. Space to begin again.', MARGIN, 350, 11);
  c.text('THIS PLANNER BELONGS TO', MARGIN, 585, 9);
  c.line(MARGIN, 638, 300);
  c.text('Plan with intention. Leave room for life.', MARGIN, 705, 13, true);
}
function guide(c: Canvas) {
  const sections = [
    ['01 / Begin anywhere', 'Write in your own dates. Start in any month; skip or restart without guilt.'],
    ['02 / Look ahead', 'Pages 3-38: twelve monthly sets for plans, habits and reflection.'],
    ['03 / Shape your week', 'Pages 39-142: fifty-two two-page weeks, Monday through Sunday.'],
    ['04 / Choose what matters', 'Give each day one priority, then a short, realistic task list.'],
    ['05 / Notice your progress', 'Track up to six habits. Cross out dates that do not occur in your month.'],
    ['06 / Make it yours', 'Pages 143-146: notes. Duplicate pages in your PDF annotation app as needed.'],
  ];
  sections.forEach(([title, body], i) => {
    c.text(title, MARGIN, 165 + i * 75, 16, true);
    c.text(body, MARGIN, 195 + i * 75, 10);
  });
  c.text('PRINT & DIGITAL USE', MARGIN, 650, 10);
  c.text('A4 portrait (210 x 297 mm). Print at actual size / 100%, without borderless mode.', MARGIN, 679, 9);
  c.text('Use single-sided sheets or a binder. For other paper sizes, choose Fit to page.', MARGIN, 701, 9);
  c.text('For handwriting in a PDF app; this edition has no fillable fields or hyperlinks.', MARGIN, 723, 9);
}
function monthly(c: Canvas) {
  c.text('MONTH / YEAR', MARGIN, 150, 9); c.line(135, 170, 230);
  const width = (WIDTH - 2 * MARGIN) / 7;
  ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].forEach((day, i) => c.text(day, MARGIN + i * width + 7, 200, 9));
  sequence(6).forEach(row => sequence(7).forEach(col => c.box(MARGIN + (col - 1) * width, 225 + (row - 1) * 64, width, 64)));
  c.text('THREE THINGS THAT MATTER', MARGIN, 636, 10);
  c.lines(MARGIN, 679, 237, 3);
  c.text('DATES TO REMEMBER', 310, 636, 10); c.lines(310, 679, 237, 3);
}
function habits(c: Canvas) {
  c.text('MONTH / YEAR', MARGIN, 150, 9); c.line(135, 170, 230);
  c.text('Small actions, repeated gently. Mark each day you show up.', MARGIN, 192, 12, true);
  sequence(6).forEach(n => {
    const top = 235 + (n - 1) * 72;
    c.text(`0${n} / HABIT`, MARGIN, top, 9); c.line(120, top + 14, 427);
    sequence(31).forEach(day => {
      const x = MARGIN + (day - 1) * 16;
      c.text(String(day), x + 2, top + 25, 6.5); c.box(x, top + 38, 16, 17);
    });
  });
  c.text('WHAT HELPED ME STAY CONSISTENT?', MARGIN, 692, 9); c.lines(MARGIN, 729, 499, 2);
}
function reflection(c: Canvas) {
  c.text('MONTH / YEAR', MARGIN, 150, 9); c.line(135, 170, 230);
  ['What worked well?', 'What felt difficult, and what did I learn?', 'What can I simplify or let go of?', 'One intention for the month ahead'].forEach((label, i) => {
    c.text(label, MARGIN, 212 + i * 135, 16, true); c.lines(MARGIN, 260 + i * 135, 499, 3);
  });
}
function weekly(c: Canvas, second: boolean) {
  c.text('WEEK OF', MARGIN, 145, 9); c.line(106, 163, 208);
  const days = second ? ['THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] : ['MONDAY', 'TUESDAY', 'WEDNESDAY'];
  days.forEach((day, i) => {
    const top = 195 + i * 139;
    c.text(day, MARGIN, top, 10); c.text('DATE', 443, top, 8); c.line(474, top + 13, 73);
    c.text('Priority', MARGIN, top + 29, 10, true); c.line(100, top + 43, 447);
    sequence(3).forEach(n => { c.box(MARGIN, top + 58 + (n - 1) * 22, 8, 8); c.line(68, top + 67 + (n - 1) * 22, 479); });
  });
  if (!second) {
    c.text('THIS WEEK, I WANT TO MAKE ROOM FOR', MARGIN, 634, 9); c.lines(MARGIN, 672, 499, 2);
    c.text('A SMALL WIN TO REMEMBER', MARGIN, 713, 9); c.line(MARGIN, 751, 499);
  }
}

/** Fixed editorial content: no network, clock, random IDs, user text or executable PDF content. */
export async function generatePlanner(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('A quieter kind of progress | Atelier Aurelia');
  doc.setAuthor('Atelier Aurelia'); doc.setProducer(PLANNER_VERSION); doc.setCreator('Atelier Aurelia Studio');
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z')); doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  plannerManifest.forEach((entry, index) => {
    const page = doc.addPage([WIDTH, HEIGHT]); const c = canvas(page, serif, sans);
    if (entry.section !== 'cover') {
      c.text('ATELIER AURELIA / UNDATED COLLECTION', MARGIN, 43, 8);
      c.text(entry.title, MARGIN, 80, 28, true);
      page.drawLine({ start: { x: MARGIN, y: HEIGHT - 127 }, end: { x: WIDTH - MARGIN, y: HEIGHT - 127 }, color: ACCENT, thickness: 0.8 });
    }
    switch (entry.section) {
      case 'cover': cover(c); break;
      case 'guide': guide(c); break;
      case 'monthly': monthly(c); break;
      case 'habits': habits(c); break;
      case 'reflection': reflection(c); break;
      case 'weekly': weekly(c, entry.id.endsWith('-b')); break;
      case 'notes': c.lines(MARGIN, 191, 499, 24); break;
    }
    c.text(entry.id.replaceAll('-', ' / '), MARGIN, 790, 8);
    c.text(String(index + 1).padStart(3, '0'), 528, 790, 8);
  });
  return doc.save({ useObjectStreams: false });
}

/** Parse every page and its real content streams before allowing storage publication. */
export async function validatePlanner(bytes: Uint8Array) {
  if (bytes.length > 10_000_000 || !Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from('%PDF-')) ||
    !Buffer.from(bytes.subarray(-20)).toString().trimEnd().endsWith('%%EOF')) throw new Error('Invalid planner PDF envelope.');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  if (doc.isEncrypted || doc.getPageCount() !== plannerManifest.length) throw new Error('Invalid planner page count.');
  doc.getPages().forEach((page, i) => {
    if (Math.abs(page.getWidth() - WIDTH) > 0.01 || Math.abs(page.getHeight() - HEIGHT) > 0.01) throw new Error('Invalid planner dimensions.');
    const streams = page.node.lookup(PDFName.of('Contents'), PDFArray);
    const content = streams.asArray().map(ref => {
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) throw new Error('Invalid planner content stream.');
      return Buffer.from(decodePDFRawStream(stream).decode()).toString();
    }).join('\n');
    const titleHex = Buffer.from(plannerManifest[i].title).toString('hex').toUpperCase();
    if (!content.includes(`<${titleHex}>`)) throw new Error('Missing planner section.');
  });
  return { version: PLANNER_VERSION, pageCount: doc.getPageCount(), sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length };
}
