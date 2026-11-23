/**
 * How a Canva operation is named, grouped and paged — the judgements the generator applies to the vendor's
 * own description, kept out of the generated table so they are reviewable on their own.
 *
 * ## Every judgement here is the VENDOR'S, and that is the point of the file
 *
 * The sibling atlases derive a taxonomy from path segments because their vendors publish none. Canva
 * publishes one twice over: MEASURED over the pinned description, all 59 operations carry an
 * `operationId` and all 59 carry exactly one tag. So a kind here is that tag kebab-cased and a name is that
 * `operationId` unchanged, and the two functions below are transliterations rather than inferences. The
 * generator asserts both properties on every run — a description that grew an untagged operation fails the
 * run instead of quietly landing under a guessed kind.
 *
 * Every function is total over the pinned description and THROWS on anything it cannot decide, for the
 * reason Nightfall's sibling states: the failure mode of an atlas is not a crash, it is a confident wrong
 * answer about where a platform keeps something.
 */

/**
 * Every kind this atlas files an operation under — the vendor's own tags, kebab-cased, sorted.
 *
 * `brands` is deliberately absent, and its absence is a finding rather than an omission. The description's
 * own `tags` array declares it — with a description, "Allow management of brands" — and MEASURED over the
 * pinned bytes, zero operations carry it. So the vendor advertises a brands area in the document's index
 * and declares no way to reach it, which `gaps.ts` raises as `declared-unused-tag` rather than this file
 * silently minting an empty kind for it.
 */
export const CANVA_OPERATION_KINDS = [
  "analytics",
  "app",
  "asset",
  "autofill",
  "brand-template",
  "comment",
  "connect",
  "design",
  "design-import",
  "export",
  "folder",
  "merge",
  "oauth",
  "oidc",
  "resize",
  "user",
] as const;

/**
 * One kind an operation can be filed under.
 * @internal
 */
export type CanvaOperationKind = (typeof CANVA_OPERATION_KINDS)[number];

/**
 * The atlas kind one operation contributes to, taken from the vendor's own tag.
 *
 * THROWS on a tag no kind declares, so a description that grows a product area fails the generator rather
 * than defaulting an operation into the wrong file.
 *
 * @param tag the description's own single tag for the operation
 * @returns the kind name
 */
export function canvaKindForTag({ tag }: { tag: string }): CanvaOperationKind {
  const kebab = tag.replaceAll("_", "-");
  const kind = CANVA_OPERATION_KINDS.find((candidate) => candidate === kebab);
  if (kind === undefined) {
    throw new Error(`canvaKindForTag: the description declares tag "${tag}", which no kind covers`);
  }
  return kind;
}

/**
 * The kind one OAuth scope belongs to, from the resource its own prefix names.
 *
 * Scopes are atlas content in their own right here, not a field on an operation: MEASURED, the
 * description declares 18 scopes and its operations between them name only 16, so the GRANT surface is
 * strictly wider than the CALL surface. Filing each scope under the kind it governs is what puts that in
 * front of a reader asking about folders rather than in a cross-kind list nobody opens.
 *
 * The four OpenID Connect scopes have no resource prefix at all and go to `user`, which is the kind whose
 * operations they gate — `GET /v1/oidc/userinfo` returns the profile they authorise.
 *
 * @param scope the vendor's own scope string, e.g. `folder:permission:write`
 * @returns the kind it governs
 */
export function canvaKindForScope({ scope }: { scope: string }): CanvaOperationKind {
  // `!`: `String.split` always yields at least one element, so index 0 exists for every input including "".
  const prefix = scope.split(":")[0]!;
  const byPrefix: Readonly<Record<string, CanvaOperationKind>> = {
    asset: "asset",
    brandtemplate: "brand-template",
    collaboration: "connect",
    comment: "comment",
    design: "design",
    email: "user",
    folder: "folder",
    openid: "user",
    profile: "user",
  };
  const kind = byPrefix[prefix];
  if (kind === undefined) {
    throw new Error(`canvaKindForScope: no kind governs scope "${scope}" — add its prefix here`);
  }
  return kind;
}

/**
 * The provider key an entity is matched on, byte-exactly.
 *
 * The server is left out because this description declares exactly one — a key carrying a constant
 * distinguishes nothing. `surfaceRow.ts`'s header carries the measurement that makes Nightfall's key
 * different.
 *
 * @param method the HTTP method
 * @param path the description's own path template
 * @returns `<METHOD> <path>`
 */
export function canvaProviderId({ method, path }: { method: string; path: string }): string {
  return `${method} ${path}`;
}

/**
 * How an operation pages, read from what it declares rather than from its shape.
 *
 * The vendor names both halves of the cursor pair `continuation`, so the query parameter and the response
 * field are the same word — which is why this asks for both rather than testing one.
 *
 * @param queryParams every query parameter name the description declares for it
 * @param responseFields every top-level response field name the declared success schema carries
 * @returns `continuation` when it declares both halves of the pair, `none` otherwise
 */
export function canvaPagingFor({
  queryParams,
  responseFields,
}: {
  queryParams: readonly string[];
  responseFields: readonly string[];
}): "continuation" | "none" {
  const asksForACursor = queryParams.includes("continuation");
  const returnsACursor = responseFields.includes("continuation");
  if (asksForACursor && returnsACursor) {
    return "continuation";
  }
  return "none";
}

/**
 * The description prose with every markdown link flattened to its own text, collapsed onto one line.
 *
 * Shared by the synopsis and by `eligibility.ts`, because both read the same prose and a second copy of a
 * link regex is a second place for it to drift. Links are flattened rather than dropped: the visible words
 * of `[Canva Enterprise](https://…)` are the requirement a reader needs, and the URL is noise in a field
 * meant to be greppable.
 *
 * @param prose the vendor's own markdown
 * @returns the same words, links flattened and whitespace collapsed
 */
export function canvaFlattenProse({ prose }: { prose: string }): string {
  return prose
    .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/**
 * The description with every one of its MDX blocks removed.
 *
 * The vendor writes `<Warning>`, `<Availability>` and `<Note>` blocks inline in `description`, and they
 * carry their own meaning — `eligibility.ts` reads two of the three. What is left after removing them is
 * the operation's actual prose, which is what a synopsis should be built from.
 *
 * @param description the vendor's own description
 * @returns the description with `<Tag>…</Tag>` blocks removed
 */
function withoutMdxBlocks({ description }: { description: string }): string {
  return description.replaceAll(/<([A-Za-z]+)>[\s\S]*?<\/\1>/g, "\n");
}

/**
 * One line saying what an operation does, derived from the vendor's own description.
 *
 * MEASURED over the pinned bytes and the reason this function exists rather than a field copy:
 * NOT ONE of the 59 operations declares a `summary`, every one declares a `description`, and 25 of those
 * descriptions OPEN with an MDX block — so the obvious rule, "take the first line", answers `<Warning>` for
 * a third of the registry. What it takes instead is the first paragraph left once the blocks are removed.
 *
 * THROWS on a description with no prose outside its blocks, rather than publishing an empty synopsis: a
 * row whose one human-readable field is blank is a row a reader silently mistrusts.
 *
 * @param description the vendor's own description
 * @param name the operation id, quoted in the failure so a bad row names itself
 * @returns the first paragraph, links flattened and whitespace collapsed
 */
export function canvaSynopsisFor({ description, name }: { description: string; name: string }): string {
  const first = withoutMdxBlocks({ description })
    .split(/\n\s*\n/)
    .map((paragraph) => canvaFlattenProse({ prose: paragraph }))
    .find((paragraph) => paragraph.length > 0);
  if (first === undefined) {
    throw new Error(`canvaSynopsisFor: ${name} declares no prose outside its MDX blocks`);
  }
  return first;
}

/**
 * Whether an operation's own description sends the reader to the browser.
 *
 * A literal test on the vendor's own product name rather than a cleverer one, because the point is that
 * this is the vendor's own words: `docs/atlas-intent/02-both-surfaces.md`'s claim that the two surfaces diverge, sourced
 * from the API description itself instead of asserted. `gaps.ts` raises the census as a finding.
 *
 * @param description the vendor's own description
 * @returns whether it names the Canva UI
 */
export function canvaNamesTheUi({ description }: { description: string }): boolean {
  return description.includes("Canva UI");
}
