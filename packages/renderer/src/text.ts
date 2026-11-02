import type { Font } from 'fontkit';
import { RenderError, escapeXml, type Element, type Finding } from './index.ts';

type TextElement = Extract<Element, { type: 'text' }>;
/** Greedy bounded wrapping: at most 4,000 code points per contract; no implicit scaling. */
export function renderText(e: TextElement, font: Font, page: { id: string; width: number; height: number }, findings: Finding[]) {
  const t = e.typography;
  if (t.align === 'justify') throw new RenderError('unsupported_typography', `Text ${e.id}: justify is unsupported; choose left, center, or right.`);
  if (/[\u0590-\u08ff\u200e-\u202e\u2066-\u2069]/u.test(e.text)) throw new RenderError('unsupported_typography', `Text ${e.id}: bidirectional scripts require a bidi layout engine.`);
  if ([...e.text].some(c => c !== '\n' && !font.hasGlyphForCodePoint(c.codePointAt(0)!))) throw new RenderError('missing_glyph', `Font ${t.fontAssetId} lacks characters required by text ${e.id}.`);
  const scale = t.fontSize / font.unitsPerEm;
  const available = e.width - 2 * e.padding;
  const layout = (text: string) => font.layout(text);
  const measure = (text: string) => {
    const run = layout(text);
    return run.positions.reduce((sum, p) => sum + p.xAdvance * scale, 0) + Math.max(0, run.glyphs.length - 1) * t.letterSpacing;
  };
  const lines = e.text.split('\n').flatMap(paragraph => {
    const tokens = paragraph.match(/ +|[^ ]+/gu) ?? [''];
    const result: string[] = [];
    let line = '';
    for (const token of tokens) {
      const candidate = line + token;
      if (line && token.trim() && measure(candidate) > available) { result.push(line); line = token; }
      else line = candidate;
    }
    return [...result, line];
  });
  let overflow = lines.length * t.lineHeight > e.height - 2 * e.padding;
  let pageOverflow = false;
  const paths = lines.map((line, index) => {
    const width = measure(line);
    if (width > available) overflow = true;
    const offset = t.align === 'center' ? (available - width) / 2 : t.align === 'right' ? available - width : 0;
    let cursor = e.x + e.padding + offset;
    const baseline = e.y + e.padding + font.ascent * scale + index * t.lineHeight;
    const run = layout(line);
    return run.glyphs.map((glyph, i) => {
      const position = run.positions[i];
      const x = cursor + position.xOffset * scale;
      const y = baseline - position.yOffset * scale;
      cursor += position.xAdvance * scale + t.letterSpacing;
      const box = glyph.bbox;
      const left = x + box.minX * scale, right = x + box.maxX * scale;
      const top = y - box.maxY * scale, bottom = y - box.minY * scale;
      if (left < e.x + e.padding || right > e.x + e.width - e.padding || top < e.y + e.padding || bottom > e.y + e.height - e.padding) overflow = true;
      if (left < 0 || top < 0 || right > page.width || bottom > page.height) pageOverflow = true;
      return `<path d="${glyph.path.toSVG()}" transform="translate(${x} ${y}) scale(${scale} ${-scale})"/>`;
    }).join('');
  }).join('');
  if (overflow) findings.push({ code: 'text_overflow', message: 'Text exceeds its padded box; enlarge the box or revise typography/content. No shrinking or clipping applied.', pageId: page.id, elementId: e.id });
  if (pageOverflow) findings.push({ code: 'page_overflow', message: 'Text ink exceeds page bounds and will be outside the PNG canvas.', pageId: page.id, elementId: e.id });
  return `<g fill="${e.color}" aria-label="${escapeXml(e.text)}">${paths}</g>`;
}
