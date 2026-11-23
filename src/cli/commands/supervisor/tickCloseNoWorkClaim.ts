/**
 * The close-only no-work-claim gate: `supervisor tick close` refuses a tick whose words claim there is no work
 * while the reconciliation it read holds open rows. The predicate is `../../../supervisor/noWorkClaimGate.ts`;
 * the reading the refusal names is `../../../supervisor/heldWork.ts`.
 *
 * It reads every string in the filled template — the lede, the headline, the folds, the hold rationales and the
 * next sweep's shift words among them. The shift words are the line that carried "No fleet seat live because
 * nothing is seatable" from pass to pass.
 *
 * The same predicate and the same hatch run a second time in the pinned chair's Stop hook
 * (`../handover/hookNoWorkClaim.ts`), because that sentence can be a chat reply, not a tick: this gate alone
 * would not see it.
 */
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchOpen } from "../../../hatch/open.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { heldWorkLine } from "../../../supervisor/heldWork.js";
import { type ClaimText, judgeNoWorkClaim, type NoWorkClaimVerdict } from "../../../supervisor/noWorkClaimGate.js";
import type { TickInput } from "../../../supervisor/tickInput.js";
import type { CloseRead } from "./tickCloseRead.js";

/** The hatch every no-work-claim refusal names. */
const HATCH_ID = "no-work-claim";

/**
 * Whether the `no-work-claim` hatch is open for this invocation.
 *
 * @returns true when the ambient variable is set
 */
export function noWorkClaimHatchOpen(): boolean {
  return hatchOpen({ env: process.env, id: HATCH_ID, nowIso: new Date().toISOString() });
}

/**
 * Every string a close renders or arms, labelled by its path in the tick template. A recursive walk rather than a
 * field list, so a field the template grows later is read without this file learning its name — a hold
 * rationale's claim reading "nothing to seat" is as much a sentence the owner sees as the headline is.
 *
 * @param input the chair's filled template
 * @returns the texts, empty ones dropped, in template order
 */
export function closeTextsOf({ input }: { input: TickInput }): readonly ClaimText[] {
  return stringsUnder({ path: "", value: input });
}

/** Every non-empty string under one value, each labelled by its path from the template's root. */
function stringsUnder({ path, value }: { path: string; value: unknown }): readonly ClaimText[] {
  if (typeof value === "string") {
    return value.length === 0 ? [] : [{ label: path, text: value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, index) => stringsUnder({ path: `${path}[${String(index)}]`, value: item }));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      stringsUnder({ path: path.length === 0 ? key : `${path}.${key}`, value: item }),
    );
  }
  return [];
}

/**
 * Render the refusal: each claim and where it sits, the reading that contradicts it, and what to say instead.
 *
 * @param verdict the refused or unreadable verdict
 * @param subject what said it, opening the sentence: `this tick` at close, `your last reply` in the Stop hook
 * @returns the hatch's four lines, one line per claim, and the way out
 */
export function noWorkClaimRefusalLines({
  verdict,
  subject,
}: {
  verdict: Exclude<NoWorkClaimVerdict, { kind: "clean" }>;
  subject: string;
}): readonly string[] {
  const hatch = hatchFor({ id: HATCH_ID });
  const claims = verdict.claims.map((claim) => `  ${claim.label}: "${claim.words}"`);
  if (verdict.kind === "unreadable") {
    return [
      ...hatchRefusalLines({
        detail: `${subject} says there is no work, and the reconciliation it read cannot back that — ${verdict.why}`,
        hatch,
      }),
      ...claims,
      "Re-open the tick with this checkout so its reconcile reading completes, then say what that reading holds.",
    ];
  }
  return [
    ...hatchRefusalLines({
      detail: `${subject} says there is no work while the reconciliation it read holds ${heldWorkLine({ held: verdict.held })}`,
      hatch,
    }),
    ...claims,
    "Say what the board holds instead — how many rows are open, how many are ready, and what holds the rest — and " +
      "lift a hold the fleet can lift itself (`slopweaver handover set-repo` for a row naming no repo:) before " +
      "calling the fleet idle.",
  ];
}

/**
 * Run the no-work-claim gate, returning the block to print when it refuses.
 *
 * @param read the close's read: the filled template and the reconciliation the open captured
 * @param hatchIsOpen whether the hatch is open, asked only when the gate would refuse
 * @returns the refusal block, or nothing when the tick may be recorded
 */
export function noWorkClaimRefusal({
  read,
  hatchIsOpen,
}: {
  read: Pick<CloseRead, "input" | "reconcile">;
  hatchIsOpen: () => boolean;
}): readonly (readonly string[])[] {
  const verdict = judgeNoWorkClaim({ reconciliation: read.reconcile, texts: closeTextsOf({ input: read.input }) });
  if (verdict.kind === "clean" || hatchIsOpen()) {
    return [];
  }
  return [noWorkClaimRefusalLines({ subject: "this tick", verdict })];
}
