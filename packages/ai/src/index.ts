export const aiRoles = [
  "creative_director",
  "product_architect",
  "art_director",
  "layout_designer",
  "design_critic",
  "repair_agent",
  "listing_art_director",
  "copywriter"
] as const;

export type AIRole = typeof aiRoles[number];
