/**
 * The CONTROL-CITATION gate, at the bot-CARD door.
 *
 * ## The hole this closes, MEASURED
 *
 * The rule — an item that names a compliance control carries a citation saying WHICH
 * control (`../outbound/assistant/citedAndShown.ts` holds the words) — was enforced in exactly one place:
 * `parseAnswerArm`, which is `turn answer`/`turn resume`. `slopweaver slack post --as bot` reaches the same
 * audience through a different door and ran none of it.
 *
 * MEASURED by a real `slack post --as bot --form - --dry-run`: a card naming FIFTEEN controls
 * (BCD-69, CRY-56, DCH-108, DCH-111, GOV-109, HRS-52, HRS-53, HRS-56, HRS-57, HRS-58, TDA-42, PRI-27,
 * DCH-47, PRI-26, BCD-23) with zero citations and zero screenshots was ACCEPTED — "steps the real send would
 * perform" — with one advisory warning. That is the exact shape the rule rejects. Reproduce with an
 * `{"kind":"update"}` form whose detail names several ids from
 * `jq -r 'select(.kind=="control") | .channels["manage-api"].detail.externalId' "$SLOPWEAVER_HOME"/atlas/vanta/controls.jsonl`.
 *
 * The shared bare-reference resolver linkified all fifteen, so the card was WELL LINKED and still ungrounded
 * by the owner's standard — the link half of the ruling came free from a door both lanes share, and the citation half
 * did not, which is why this exists as its own door rather than as a line in the other one.
 *
 * ## Rule ONE here, and rule TWO beside it
 *
 * `citedAndShown.ts` carries two rules. Only the first is judged in this file. Rule TWO — three or more
 * distinct references with no picture — counts Linear keys and GitHub numbers alongside controls, and
 * MEASURED, a briefing-shaped card naming SECU-101, SUP-102, SOPS-103 and OPS-104 with no image
 * would be refused by it as a gate. It is a QUESTION instead, asked once on a card a
 * session composed and never on a derived or scheduled one: `./cardPictureDoor.ts`, called from the POST
 * path alone, because the edit lane cannot see the pictures a card was posted with. Rule one needs neither
 * scoping: it fires only on ids this install's Vanta atlas actually holds, and a briefing names none of them.
 *
 * ## Why the CITATION-BUDGET collision line is not printed here
 *
 * `answerForm.ts` appends `citationBudgetCollision` to rule one's refusals, because the answer arm HAS a
 * citation budget and this form does not. `updateArtifactSchema` carries **no citation cap at all**
 * (`../outbound/artifact/schema.ts` — `citations: z.array(citationSchema).default([])`), so a card composer
 * who needs a thirteenth citation simply defines one and the rule is met. Printing the collision here would
 * tell them they cannot do a thing they can, which is worse than printing nothing.
 *
 * The answer arm's budget is no longer the flat `CITATIONS_MAX` the first draft of this comment named: it is
 * `../outbound/assistant/citedAndShown.ts`'s `citationsCeiling`, the larger of that floor and the answer's
 * own item count. So the collision it warns about now opens only where the naming is DENSE — a dozen-plus
 * controls inside one paragraph is one item and earns only the floor. That narrowing does not reach this
 * door either way, for the same reason: a card has no budget to collide with.
 *
 * ## Why the bare-reference door is sequenced from here too
 *
 * `linkedCardOrRefusals` runs both reference rules in the one order that is correct, because both read the
 * SAME `BareRefContext`: judging control mentions before linkifying would judge a different set of mentions
 * than the reader meets. Its two call sites — `slack post --as bot` and the edit lane — had a verbatim copy
 * of that sequence each, which is the shape this repository has already watched drift.
 *
 * ## The residue, stated rather than discovered
 *
 * One path reaches a reader without crossing this, and it is named rather than papered over: a `no-fold`
 * artifact, because `NoFoldArtifact` has no `citations` field and
 * `NoFoldInlineRun` makes a citation chip unrepresentable — the form cannot carry the grounding this rule
 * demands, so applying it there would refuse every no-fold message naming a control with nothing a composer
 * could do about it except open the hatch.
 */

import { hatchOpen } from "../hatch/open.js";
import { err, ok, type Result } from "../lib/result.js";
import { linkifyCard } from "../outbound/artifact/bareRefRuns.js";
import type { UpdateArtifact } from "../outbound/artifact/types.js";
import { uncitedControlIssues } from "../outbound/assistant/citedAndShown.js";
import type { BareRefContext } from "../outbound/linkify/bareRefs.js";
import { bareRefVerdictFor } from "./bareRefDoor.js";

/** What the gate decided about one card's control mentions. */
interface CitedControlsVerdict {
  /** One operator-facing refusal per uncited control mention. Empty when the hatch is open. */
  readonly refusals: readonly string[];
}

/**
 * Check one bot card's control mentions against the owner's rule, and against the journalled hatch.
 *
 * The card's `detail`/`index`/`citations` map onto the answer arm's `body`/`index`/`citations` exactly —
 * both are the same `DetailBlock`/`Citation` vocabulary — so this reuses the answer's own checker rather
 * than restating the rule, which is what stops the two doors drifting into two different rules.
 *
 * `tldr` is not scanned, matching the answer arm, whose `lead` is not scanned either: a control named only
 * in a one-line preview has no item to hang a chip in.
 *
 * @param artifact the card about to be posted or republished, already linkified
 * @param context the same context the bare-reference pass used, so both doors agree what a control is
 * @param env the door's own environment, which the hatch is read from
 * @param nowIso the instant a journalled grant's expiry is judged against
 * @param home the state home the grant journal lives under — passed EXPLICITLY rather than resolved, so a
 *   test reads its own sandbox instead of whatever grants the operator happens to be holding
 * @returns the refusals to print; empty when there is nothing to refuse or the hatch is open
 */
export function citedControlsVerdictFor({
  artifact,
  context,
  env,
  nowIso,
  home,
}: {
  artifact: UpdateArtifact;
  context: BareRefContext;
  env: Readonly<Record<string, string | undefined>>;
  nowIso: string;
  home: string;
}): CitedControlsVerdict {
  if (hatchOpen({ env, home, id: "uncited-controls", nowIso })) {
    return { refusals: [] };
  }
  const parts = {
    body: artifact.detail,
    citations: artifact.citations,
    context,
    index: artifact.index,
  };
  const refusals = uncitedControlIssues(parts).map((issue) => {
    // The shared checker names the answer arm's field, and this form calls it `detail`. Pointing a composer
    // at a field their form does not have is the kind of small lie that costs a whole compose cycle.
    const [first, ...rest] = issue.path;
    const path = first === "body" ? ["detail", ...rest] : issue.path;
    return (
      `${path.join(".")}: ${issue.message} For one deliberate exception, open the journalled hatch ` +
      'with `slopweaver hatch open uncited-controls --reason "<why>"`.'
    );
  });
  return { refusals };
}

/**
 * Linkify one card, then run BOTH reference doors over it — bare references first, control citations second.
 *
 * The pair is one function rather than two call-site blocks because the two doors share the resolver
 * context: `linkifyCard` builds the links from the same `BareRefContext` the control rule decides what a
 * control IS from, and running the citation rule over the UNLINKIFIED card would judge a different set of
 * mentions than the one the reader ends up meeting. Two copies of that ordering drifted within one change
 * once already in this lane (`./commands/slack/lifecycleRunGuards.ts`'s own doc comment says so about the
 * owner-ping half), which is the argument for the sequence living in one place.
 *
 * @param artifact the card about to be posted or republished, straight off the form
 * @param context what this write's references resolve against
 * @param env the door's own environment, holding both overrides
 * @param home the state home the grant journal lives under
 * @param nowIso the instant a journalled grant's expiry is judged against
 * @returns the linkified card, or every refusal from whichever door refused first
 */
export function linkedCardOrRefusals({
  artifact,
  context,
  env,
  home,
  nowIso,
}: {
  artifact: UpdateArtifact;
  context: BareRefContext;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  nowIso: string;
}): Result<UpdateArtifact> {
  const linked = linkifyCard({ artifact, context });
  const bareRefs = bareRefVerdictFor({ env: ({ name }) => env[name], home, issues: linked.issues });
  if (bareRefs.refusals.length > 0) {
    return err(bareRefs.refusals);
  }
  const controls = citedControlsVerdictFor({ artifact: linked.artifact, context, env, home, nowIso });
  return controls.refusals.length > 0 ? err(controls.refusals) : ok(linked.artifact);
}
