/**
 * Telling one of Jam's rendered not-found pages apart from a real one, against the application's own control.
 *
 * ## The failure this closes, and it shipped once in this atlas's own first walk
 *
 * MEASURED: Jam's application answers a route it does not have with its own rendered not-found —
 * "No Jam here :(" — at **HTTP 200**, with no redirect and the same `Jam` document title every real page
 * carries. Most of the routes the first walk seeded were that page, and every one was published as
 * `landed` with a verified screenshot. That is the Notion walk's failure exactly (every page reached and
 * photographed was the same not-found shell), reached by a different road: there the shots
 * were byte-identical and `kit/indistinguishableShots.ts` would have caught them, and here they are not.
 *
 * ## Why the kit's digest check cannot fire here, stated rather than left as a puzzle
 *
 * The not-found page ANIMATES — strawberries fall at random positions — so two renders of it are never the
 * same bytes. MEASURED across one walk: every render of it a different byte length, no two equal. A
 * digest-equality check is exactly right for a static shell and blind to this one.
 *
 * ## The check must be able to FAIL, which one control could not make it
 *
 * The first cut compared the control against ITSELF, which necessarily succeeds. A Codex review named it:
 * that established only that `/404` had been photographed, never that `/404` had rendered a not-found — so
 * if Jam started serving a real page there, a genuine rendered not-found at a different size would be
 * published as reached, on the strength of a boolean that could not be false. That is the class this
 * repository keeps paying for: a check that cannot fail reports clean.
 *
 * So there are TWO controls, addressed independently: `/404`, the route Jam's own bundle declares as its
 * not-found, and an invented route at the bare origin that cannot exist. The band is anchored on the
 * INVENTED one — it cannot become a real page — and the declared one must fall inside it. Two separately
 * addressed routes rendering the same-sized page is evidence; one route compared to itself is not, and if
 * the two ever diverge the walk refuses rather than publishing a grading nothing checked.
 *
 * ## The rule is ONE signal, and the margin plus the control is what makes it falsifiable
 *
 * A page is the not-found when its screenshot is within {@link NOT_FOUND_BAND} of the CONTROL's own byte
 * length — the control MEASURED IN THE SAME RUN, which is the whole reason the rule survives the page
 * animating.
 *
 * MEASURED over these walks, and each property is needed to read the band honestly — the figures are this
 * installation's own, re-read with `slopweaver atlas jam read --kind page --json`, each page's
 * `observations[0].artifacts[0].byteLength`, after `slopweaver atlas jam refresh`:
 *
 * - **Within one run the not-found page is tight.** Every not-found page of a walk sits well inside the
 *   band of that walk's control.
 * - **Across runs the same page moves several percent**, because the strawberries fall in different places.
 *   A band measured once and baked in would have been wrong by more than its own width; a band taken from
 *   the control this run is not.
 * - **The nearest real page is closer than one run suggests.** The same account tab, graded against two
 *   walks' controls, sat at two different distances, the nearer one only just outside the band; the
 *   smallest real page, a nearly empty subscription tab, sits further off below. So the band is a few times
 *   the within-run spread and leaves a thin margin, not a wide one, to the nearest real page.
 * - **Measured against the bare-origin anchor, the margin stays thin.** The declared `/404` corroborates the
 *   anchor well inside the band, and the account tab is the nearest real page, just outside it.
 * - **A later measurement, and the band holds.** A scheduled resync refused with the controls unusable and
 *   told the reader to re-measure the band; the refusal's cause line was lost, so the band was checked. The
 *   next walk put both real pages outside the band and the declared `/404` inside it, so the band did not
 *   cause that refusal — which is why the refusal now names its typed cause on its last line and prescribes
 *   re-measuring only for `band`.
 *
 * The account tab's margin is the number to watch: a run whose control lands within the band of a real
 * page would mis-grade it, and the thing that would show is a page this atlas has always reached —
 * `settings/account` first — suddenly reading as not-found.
 *
 * **One signal is thinner than two, and that is stated rather than dressed up.** A second was looked for in
 * what the seam reports and none survived. The document title is `Jam` on both. The settled address is
 * unchanged on both, which is the whole problem. The response COUNT looked promising — the control saw
 * fewer than any real page — and was rejected because other not-found pages saw counts inside the real
 * pages' range: a signal that overlaps is worse than none, because it makes a single-signal rule look
 * like a corroborated one. What does the work instead is that the control is measured on EVERY run rather
 * than baked in, so a Jam that changes its not-found page moves the band with it or fails loudly.
 *
 * **The check can fail, and the walk proves it fires.** The control is a seeded route graded by exactly this
 * code, so a run whose control is NOT graded not-found has an oracle that has stopped working, and
 * `webSurface.ts` refuses to publish that run's page grading rather than quietly publishing a walk whose
 * detector was inert.
 *
 * ## What it deliberately does NOT do
 *
 * It never reads the page's text. The transport exposes a title, a settled address, a call list and a
 * screenshot and nothing else, on purpose — a walk that could read a page's content would be reading team
 * members' names out of whatever else it rendered. So "does this page say No Jam here" is not a question
 * this code can ask, which is why a picture's SIZE is what is left.
 */

/**
 * How far from the control's own byte length a screenshot may fall and still be called the same page.
 *
 * 5%: a few times the observed within-run spread of the not-found page itself, and inside the distance to
 * the nearest real application page on every measurement so far. See this file's header for how each was
 * taken and the command that re-reads it.
 */
export const NOT_FOUND_BAND = 0.05;

/**
 * The minimum this check needs of one page observation.
 *
 * @internal
 */
export interface NotFoundCandidate {
  readonly artifacts: readonly { readonly byteLength: number }[];
  readonly surface: string;
}

/**
 * One control's own screenshot byte length, or `null` when the walk never photographed it.
 *
 * A walk that could not photograph a control has no oracle at all, which is a different failure from a page
 * that looks like one — so it is `null` here and refused by the caller rather than defaulted.
 *
 * @param pages every page the walk observed
 * @param controlSurface the declared surface name of the control to read
 * @returns that control's screenshot size, or `null` when it has none
 */
export function notFoundControlBytes({
  pages,
  controlSurface,
}: {
  pages: readonly NotFoundCandidate[];
  controlSurface: string;
}): number | null {
  const control = pages.find((page) => page.surface === controlSurface);
  const artifact = control?.artifacts[0];
  return artifact === undefined ? null : artifact.byteLength;
}

/**
 * Whether the two controls corroborate each other, and what to say when they do not.
 *
 * The whole point is that this CAN fail. The anchor is the invented route, which cannot become a real page;
 * the declared `/404` must fall inside its band. If Jam starts serving something real at `/404` the two
 * diverge and the walk publishes no page grading at all — see this file's header for the review that found
 * the single-control version could not fail.
 *
 * @param anchorBytes the invented route's screenshot size — the control that cannot be a real page
 * @param declaredBytes the declared not-found route's screenshot size
 * @returns why the two do not corroborate, or `null` when they do
 */
export function notFoundControlsAgree({
  anchorBytes,
  declaredBytes,
}: {
  anchorBytes: number;
  declaredBytes: number;
}): string | null {
  if (Math.abs(declaredBytes - anchorBytes) <= anchorBytes * NOT_FOUND_BAND) {
    return null;
  }
  const drift = ((declaredBytes - anchorBytes) / anchorBytes) * 100;
  return (
    `the two controls do not corroborate each other: the invented route rendered ${String(anchorBytes)} bytes ` +
    `and the declared /404 rendered ${String(declaredBytes)}, ${drift.toFixed(1)}% apart against a band of ` +
    `${String(NOT_FOUND_BAND * 100)}%. Jam is probably serving something real at /404 now, which would make ` +
    "every not-found grading below it a guess"
  );
}

/**
 * Whether one page is the application's own not-found rendered at a route that does not exist.
 *
 * @param page the observation to judge
 * @param controlBytes the control's own screenshot byte length
 * @returns whether its screenshot falls in the control's band
 */
export function jamLooksLikeNotFound({
  page,
  controlBytes,
}: {
  page: NotFoundCandidate;
  controlBytes: number;
}): boolean {
  const artifact = page.artifacts[0];
  if (artifact === undefined) {
    return false;
  }
  return Math.abs(artifact.byteLength - controlBytes) <= controlBytes * NOT_FOUND_BAND;
}
