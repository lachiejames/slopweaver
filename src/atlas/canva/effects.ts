/**
 * What issuing each Canva operation would DO, judged one operation at a time.
 *
 * ## Why this is a table of judgements rather than a rule over methods
 *
 * This atlas holds no Canva credential and calls nothing, so an effect is not a fetch plan — it is the
 * answer to "what can this platform be made to do", which is the half of a surface map a method column
 * cannot give a reader. And the method genuinely does not decide it here. MEASURED over the
 * pinned description: of 21 POSTs, two READ — `getDesignAnalyticsPageViews` takes its filter in a body
 * because the filter is a list of page indices, and `introspectToken` asks what an existing token is. A
 * rule that read effect off the verb would file both as writes, and would be wrong about exactly the
 * operations a reader most needs to trust it on.
 *
 * The sibling reasoning is Nightfall's `dispositions.ts`, and the sharper version of it is the Datadog
 * atlas's finding that a `POST .../snapshots` created one while a `GET` beside it spent credit. A verb
 * decides nothing on its own, so every POST is named here and the generator refuses one that is not.
 *
 * ## `side-effecting` is not a softer `mutating`
 *
 * It is the class that changes no stored content and still makes Canva ACT — render an export, mint or
 * revoke a credential. Folding it into `mutating` would say the export family edits a design, which is
 * false; folding it into `read` would say minting an OAuth token is an observation, which is worse. Three
 * members is what the platform actually has.
 */
import type { CanvaEffect } from "./surfaceRow.js";

/**
 * What the effect rule decided for one operation, and why.
 * @internal
 */
export interface CanvaEffectVerdict {
  readonly effect: CanvaEffect;
  /** Why it is not a plain `read`. `null` only when it is one. */
  readonly effectBecause: string | null;
}

/** The methods that change the account. Read from the description's own verb, never inferred from a path. */
const MUTATING_METHODS = new Set(["PUT", "PATCH", "DELETE"]);

/**
 * Every POST this atlas has judged one by one, by the vendor's own `operationId`.
 *
 * All 21 are named. A POST missing from this table throws rather than defaulting, so a description that
 * grows one cannot land under a verdict nobody made.
 */
const POST_VERDICTS: Readonly<Record<string, CanvaEffect>> = {
  CreateAssetUploadJob: "mutating",
  createComment: "mutating",
  createDesign: "mutating",
  createDesignAutofillJob: "mutating",
  createDesignExportJob: "side-effecting",
  createDesignImportJob: "mutating",
  createDesignMergeJob: "mutating",
  createDesignResizeJob: "mutating",
  createFolder: "mutating",
  createPrintPartnerDesign: "mutating",
  createPrintPartnerDesignExportJob: "side-effecting",
  createReply: "mutating",
  createThread: "mutating",
  createUrlAssetUploadJob: "mutating",
  createUrlImportJob: "mutating",
  exchangeAccessToken: "side-effecting",
  getDesignAnalyticsPageViews: "read",
  introspectToken: "read",
  moveFolderItem: "mutating",
  publishBrandTemplate: "mutating",
  revokeTokens: "side-effecting",
};

/** What to say about each effect, so a row explains itself without a reader opening this file. */
const EFFECT_PROSE: Readonly<Record<Exclude<CanvaEffect, "read">, string>> = {
  mutating: "it creates, edits, moves or deletes something in the user's Canva account, and this atlas only ever reads",
  "side-effecting":
    "it changes no stored content and still makes Canva ACT — rendering an export, or minting or revoking a credential — which is billed or security-relevant work rather than an observation of existing state",
};

/**
 * Decide what issuing one operation would do.
 *
 * @param method the description's own HTTP method
 * @param name the vendor's own `operationId`, which is what a POST verdict is keyed on
 * @returns the effect and the reason it is not a plain read
 */
export function canvaEffectFor({ method, name }: { method: string; name: string }): CanvaEffectVerdict {
  if (method === "POST") {
    const effect = POST_VERDICTS[name];
    if (effect === undefined) {
      throw new Error(`canvaEffectFor: no verdict for POST ${name} — judge it in effects.ts`);
    }
    return { effect, effectBecause: effect === "read" ? null : EFFECT_PROSE[effect] };
  }
  if (MUTATING_METHODS.has(method)) {
    return { effect: "mutating", effectBecause: EFFECT_PROSE.mutating };
  }
  return { effect: "read", effectBecause: null };
}

/**
 * Every POST the table names, so the generator can assert it judged all of them and no more.
 *
 * @returns the vendor's own operation ids, sorted
 */
export function canvaJudgedPosts(): readonly string[] {
  return Object.keys(POST_VERDICTS).toSorted();
}
