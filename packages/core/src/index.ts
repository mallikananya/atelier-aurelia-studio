export const productTransitions = {
  idea: ["concept", "archived"],
  concept: ["building", "archived"],
  building: ["qa", "archived"],
  qa: ["building", "ready_for_review", "archived"],
  ready_for_review: ["building", "approved", "archived"],
  approved: ["etsy_draft", "archived"],
  etsy_draft: ["archived"],
  archived: []
} as const;

export type ProductStatus = keyof typeof productTransitions;

export function canTransition(from: ProductStatus, to: ProductStatus): boolean {
  return (productTransitions[from] as readonly string[]).includes(to);
}

export const forbiddenCapabilityIds = [
  "etsy-live-publication",
  "etsy-arbitrary-payload-submission",
  "generation-hard-coded-theme-template-selection"
] as const;
