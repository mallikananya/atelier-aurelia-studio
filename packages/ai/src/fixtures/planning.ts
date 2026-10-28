// Acceptance data only. Never imported by the production planning service.
export const readingPlan = {
  schemaVersion: 'creative-plan/1',
  brief: { schemaVersion: 'creative-brief/1', id: 'brief-reading', name: 'Les Heures Fleuries',
    productType: 'literary reading journal', customer: 'Reflective literary readers',
    jobToBeDone: 'Remember and connect ideas from books', concept: 'A personal literary herbarium',
    differentiation: 'Varied literary responses with original botanical illustrations',
    visualDirection: 'French romantic engraving and antique typography',
    risks: ['Preserve writing space'], assumptions: ['Owner prefers undated pages'] },
  visualDNA: { mood: ['romantic', 'scholarly'], palette: { paper: '#F5EBDD', ink: '#382B30' },
    typographyDirection: 'Antique serif and restrained italic', illustrationDirection: 'Original botanical engravings',
    geometry: 'Offset columns', whitespace: 'Generous', texture: 'Subtle paper', motifs: ['botanical sprigs'], avoid: ['Repeated floral borders'] },
  manifest: { schemaVersion: 'page-manifest/1', targetPageCount: 3, pages: [
    { id: 'reading-cover', order: 1, name: 'Bookplate', purpose: 'Personal ownership', density: 'sparse', dependsOnPageIds: [], sourceIds: [] },
    { id: 'reading-response', order: 2, name: 'Literary response', purpose: 'Interpret a book', density: 'medium', dependsOnPageIds: [], sourceIds: [] },
    { id: 'reading-connections', order: 3, name: 'Connections', purpose: 'Connect observations', density: 'sparse', dependsOnPageIds: ['reading-response'], sourceIds: [] },
  ] },
  deliverables: { schemaVersion: 'deliverable-plan/1', items: [
    { id: 'reading-print', name: 'Reading journal', format: 'pdf', usage: 'print', pageSize: 'A4', pageIds: ['reading-cover', 'reading-response', 'reading-connections'] },
  ] },
};

export const travelPlan = {
  schemaVersion: 'creative-plan/1',
  brief: { schemaVersion: 'creative-brief/1', id: 'brief-travel', name: 'Departure Club',
    productType: 'travel memory journal', customer: 'Expressive independent travelers',
    jobToBeDone: 'Capture discoveries and unexpected moments', concept: 'A graphic record of movement',
    differentiation: 'Asymmetric travel observations and ephemera compositions',
    visualDirection: 'Bold retro graphics with saturated colors', risks: ['Limit ink coverage'], assumptions: [] },
  visualDNA: { mood: ['kinetic', 'playful'], palette: { paper: '#FFF0CF', red: '#E94B35', blue: '#2455C7' },
    typographyDirection: 'Heavy display and monospaced labels', illustrationDirection: 'Original screenprint travel graphics',
    geometry: 'Asymmetric panels and oversized numerals', whitespace: 'Strong negative space', motifs: ['Route ribbons'], avoid: ['Muted botanical styling'] },
  manifest: { schemaVersion: 'page-manifest/1', targetPageCount: 2, pages: [
    { id: 'travel-route', order: 1, name: 'Route', purpose: 'Record movement', density: 'medium', dependsOnPageIds: [], sourceIds: [] },
    { id: 'travel-detours', order: 2, name: 'Unexpected detours', purpose: 'Reflect on discoveries', density: 'sparse', dependsOnPageIds: ['travel-route'], sourceIds: [] },
  ] },
  deliverables: { schemaVersion: 'deliverable-plan/1', items: [
    { id: 'travel-digital', name: 'Travel memories', format: 'pdf', usage: 'digital', pageSize: 'US Letter', pageIds: ['travel-route', 'travel-detours'] },
  ] },
};

export const planningRequest = {
  idea: 'Create an original journal from this open-ended idea.',
  productId: '82688c3e-3695-41fd-ae34-4ccd20019b85',
  revisionId: '9058c7cc-cdef-46a7-9a6f-ac959332236d', parentRevisionId: null, revisionNumber: 1,
  createdAt: '2026-10-28T00:00:00Z', promptVersion: 'planning-prompt/1',
  generator: { id: 'fake-provider', version: 'fixture/1' }, sources: [],
};
