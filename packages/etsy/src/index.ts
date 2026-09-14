/** Etsy boundary: draft creation and verification only. */
export interface EtsyDraftPort {
  createDraftFromSealedRelease(releaseId: string, explicitConfirmation: true): Promise<{ listingId: string }>;
  verifyDraft(releaseId: string, listingId: string): Promise<{ matches: boolean; differences: string[] }>;
}

// Intentionally no publish() method.
