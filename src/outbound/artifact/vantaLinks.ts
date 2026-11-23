/**
 * Which Vanta address an outbound message may point a reader at — and the one shape it may not.
 *
 * ## The incident this exists to make unrepresentable
 *
 * The policy-acceptance DM in the owner's own bot DM linked to a page that just downloaded a PDF instead of
 * taking the reader to Vanta. The
 * message told the owner to open each link, sign in and press accept. The links were
 * `https://app.vanta.com/c/<tenant>/<workspace>/doc/<Policy%20Name>-<slugId>`, and on an already
 * authenticated work profile that address painted an **entirely blank page** and downloaded
 * `secure-development-policy-bsi.pdf`, 80.8 KB.
 *
 * It was not a typo. That address is what Vanta's Manage API hands back: `GET /v1/policies` returns
 * `latestApprovedVersion.documents[].url` in exactly that shape, and `atlas/vanta/projection.ts` stores it as
 * a `deepLink` marked `provider-provided`. A composer reaching for the most authoritative-looking URL the
 * world model held therefore reached for a **document RENDER endpoint** and called it an accept action. The
 * defect regenerates through ordinary care, which is what makes it a schema's job rather than a reviewer's.
 *
 * ## The two addresses, and what each one actually is
 *
 * MEASURED against the live tenant on the owner's own signed-in profile, both through the
 * browser door. Reproduce either:
 *
 * ```bash
 * slopweaver browser shot --raw --settle 12000 --url "https://app.vanta.com/employee/onboarding" --out /tmp/tasks.png
 * ```
 *
 * - `…/doc/<Name>-<slugId>` — the policy DOCUMENT. It serves the PDF. There is no page and no Accept
 *   control on it at any point, so it can never be the call to action in a message asking somebody to
 *   accept something.
 * - `…/employee/onboarding` — the signed-in person's OWN security tasks, titled *"<First>'s security tasks
 *   for <Org>"*, whose first row is **Accept security policies**. It is the accept surface, it is the same
 *   address for every person because Vanta resolves the reader from their session, and a bare
 *   `https://app.vanta.com/employee/onboarding` redirects onto the tenant's copy of it. That redirect is why
 *   {@link VANTA_SECURITY_TASKS_SHAPE} can be a shape rather than a tenant-bearing constant: the
 *   organisation's own slug is a private identifier this repository does not carry (AGENTS.md, "no
 *   organisation names in what you commit" — a slug resolves at run time from `$SLOPWEAVER_HOME`, per
 *   `atlas/vanta/tenantSlug.ts`).
 *
 * Two neighbouring routes were probed at the same time and are the client's own not-found page, so do not
 * reach for either: `…/employee/documents` (which a bare `/employee/documents` redirects to) and
 * `…/my-security-tasks`.
 *
 * ## Why the refusal lives in the RUN vocabulary
 *
 * Rule 7: shape is enforced by the SCHEMA, never by review. `./runSchema.ts`'s `link` run is the single
 * place every outbound form's clickable URL passes through — the card, the as-me drip, the no-fold DM — so
 * one refinement there covers forms that do not know about each other, including forms nobody has written
 * yet. `./schema.ts`'s `primaryLink` is the one clickable URL that does NOT pass through a run, so it is
 * checked beside it rather than instead of it.
 *
 * The refusal names the replacement, because a block that does not say why is not helpful to a human or an
 * agent. It carries no escape hatch and wants none: there is no reading under which a
 * message asking somebody to press Accept should link the file instead, and a reader who wants the policy
 * TEXT is better served by the tenant's own policy list than by a silent download.
 *
 * ## The schema check alone is not enough, and that is not a detail
 *
 * Every form here runs `./typedRuns.ts`'s conversion as a `.transform`, which turns a bare URL sitting in a
 * plain `text` run into a real `link` run — AFTER the field schemas have had their turn. So an author who
 * pastes the address into a sentence rather than into a `link` gets the same broken link with the field
 * check satisfied. {@link vantaLinkIssuesOfRuns} is the second half, and it is wired at ONE seam rather
 * than at each form: `./typedRuns.ts`'s `rawMarkupIssuesOfRuns` is what every form already calls to refuse
 * unconvertible residue, and it is the only place that sees runs after conversion, so the card, the
 * answer, the drip and the no-fold DM are all covered without four call sites that can drift apart.
 * Both halves are needed — the field check names the offending field precisely, and this one is what makes
 * the claim true.
 *
 * ## What it covers, and what it does NOT — stated rather than discovered
 *
 * **Every FORM-FILLED message is covered**, which is every message `slack post --as bot` can send: that verb
 * is `--form` only, `cli/commands/slack/coreForm.ts` parses each one as `updateArtifactSchema` or
 * `noFoldArtifactSchema`, and a digest is covered transitively because `digestFormSchema` derives its card
 * and validates THAT. The as-me drip shares the run vocabulary, so it is covered too. That is the claim the
 * incident needs, and it is exact.
 *
 * Four things are outside it, each named rather than left to be discovered:
 *
 * - **`renderRecipeResponse`**, which takes an ALREADY-RENDERED `{ color, fallback, blocks }` wrapper and
 *   so fills no form. This is the same class `.claude/rules/area-outbound.md` already names about the PII
 *   pass — a bot payload that reaches Slack without crossing the thing every other payload crosses — and its
 *   closure is the same one: a gate over outbound payload producers, which does not exist yet. A rendered-
 *   payload scan at `../slack/recipeResponse.ts`'s renderer is where it would go.
 *
 * - **A PROVENANCE url.** `./schema.ts`'s `citation`, `./digest.ts`'s `citationUrl`, and
 *   `../assistant/answerForm.ts`'s evidence, premise-check and `answering.permalink` fields all answer
 *   *where did this come from*, and the policy document genuinely IS that source. Refusing one would delete
 *   a true provenance to prevent a call to action nobody made there. Clicking such a chip still downloads
 *   the PDF — known residue, not an oversight.
 * - **`slack post --as me --body`**, the raw escape hatch, which fills no form at all. A raw channel that
 *   silently rewrote what the owner typed would be the worse defect.
 * - **`../briefing/`'s own `link` run.** The briefing is a local HTML page the owner reads, not a message sent to
 *   somebody, so "press Accept" is not a thing it asks of a reader. If a briefing ever tells the owner to accept a
 *   policy, this is the rule it should borrow.
 */

/** The host every Vanta web address hangs off. */
const VANTA_WEB_HOST = "app.vanta.com";

/** The path segment that marks a Vanta policy-document render — the address that serves a PDF and paints nothing. */
const VANTA_DOCUMENT_SEGMENT = "doc";

/**
 * The address that presents the Accept action, written as a SHAPE.
 *
 * `<tenant>` is a literal placeholder rather than a hole to fill: the bare
 * `https://app.vanta.com/employee/onboarding` redirects a signed-in reader onto their own tenant's copy, so
 * a message may simply link the bare form and never name the organisation at all.
 */
const VANTA_SECURITY_TASKS_SHAPE = "https://app.vanta.com/c/<tenant>/employee/onboarding";

/** The bare address a message should carry — Vanta redirects the signed-in reader onto their own tenant's copy. */
export const VANTA_SECURITY_TASKS_URL = "https://app.vanta.com/employee/onboarding";

/**
 * Whether a URL is a Vanta policy-document render — the address that downloads a PDF instead of opening a page.
 *
 * Judged on the host and on a `doc` path SEGMENT, never on a substring: a tenant, a page or a query value
 * that merely contains the letters `doc` is not this, and `…/documents` is a different route that this must
 * not claim. A URL that does not parse is not this either — the schema's own `z.url()` is what refuses that.
 *
 * @param url the address a link run or primary link carries
 * @returns whether it is a Vanta policy-document render
 */
export function isVantaPolicyDocumentUrl({ url }: { url: string }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.host !== VANTA_WEB_HOST) {
    return false;
  }
  return parsed.pathname.split("/").includes(VANTA_DOCUMENT_SEGMENT);
}

/** The refused address, written as a shape, so a refusal shows the author what it matched on. */
const VANTA_DOCUMENT_SHAPE = "https://app.vanta.com/c/<tenant>/…/doc/<Policy Name>-<slugId>";

/**
 * What a refused Vanta policy-document link says — what caught it, why, and the address to use instead.
 *
 * @returns the refusal, as one line the form reports against the offending field
 */
export function vantaPolicyDocumentRefusal(): string {
  return (
    `a Vanta policy-document URL (${VANTA_DOCUMENT_SHAPE}) is the PDF, not a page: it downloads the file ` +
    "and renders nothing, so it can never be the link in a message asking somebody to press Accept. Link " +
    `${VANTA_SECURITY_TASKS_URL} instead — the reader's own security tasks, whose first row is Accept ` +
    "security policies, reached without naming any tenant"
  );
}

/** One refusal, with the JSON path a form author needs to find it — the shape `./typedRuns.ts` already uses. */
export interface VantaLinkIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * The refusals one CONVERTED run sequence carries — every link run pointing at a policy document.
 *
 * Takes the run shape structurally rather than one form's union, because the three vocabularies
 * (`inlineRunSchema`, `dripInlineRunSchema`, and the no-fold form's own list) are spelled as three separate
 * lists and a fourth would otherwise need remembering here. Every run carries a `type`; only a link carries
 * a `url`, so a run without one is skipped.
 *
 * @param runs the converted run sequence
 * @param path the JSON path of the sequence, for the issue
 * @returns one issue per refused link run
 */
export function vantaLinkIssuesOfRuns({
  runs,
  path,
}: {
  runs: readonly { readonly type: string; readonly url?: string | undefined }[];
  path: readonly (string | number)[];
}): readonly VantaLinkIssue[] {
  return runs
    .filter((run) => run.url !== undefined && isVantaPolicyDocumentUrl({ url: run.url }))
    .map((): VantaLinkIssue => ({ message: vantaPolicyDocumentRefusal(), path }));
}
