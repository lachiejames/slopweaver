/**
 * The pure half of a Vanta policy-draft edit: what a substitution is, when it is refused, and the digest an
 * approval is bound to.
 *
 * ## Why an exact substitution rather than a document
 *
 * MEASURED and recorded in the knowledge register: the policy bodies this program stores are a
 * flat pdfjs text dump, not markdown — across every stored document, the PDF's hard-wrapped line breaks
 * survive as continuation lines while its headings and tables do not come through as markdown. Reproduce with
 * `cat ~/.slopweaver/atlas/vanta/artifacts/policy-document/*` + `/body.md | grep -c "^#"`. So a whole
 * document cannot be re-rendered back into Vanta without destroying its structure, and the only faithful
 * change this program can make is a CHANGE LINE: one exact run of text, replaced in place, with every byte
 * around it untouched.
 *
 * That is a constraint on the mechanism, not a limitation of the ambition. It is also what makes the write
 * reviewable: a substitution is small enough to read, to hash, and to reverse.
 *
 * ## Everything here is refusable before a browser is involved
 *
 * A plan is built against a snapshot the verb has already read, so `--dry-run` can tell the operator that a
 * find string occurs twice, or not at all, or would change nothing, without opening anything. The same
 * checks run again inside the editor against the live text, because the draft may have moved between the
 * read and the write — the snapshot is evidence, never authority.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "../../lib/result.js";

/** How many hex characters of the approval digest are printed and compared — as `write vanta deactivate` uses. */
const DIGEST_WIDTH = 16;

/** One Vanta policy draft as it was read, and the page it was read from. */
export interface VantaDraftSnapshot {
  /** The exact editor address the read landed on, query state included. */
  readonly finalUrl: string;
  /** The page title, which names the policy — the cheapest check that the right draft is open. */
  readonly title: string;
  /** The editor's own text, newline-normalised. */
  readonly text: string;
  /** Every button label the page showed, so a submitted draft can be told from an editable one. */
  readonly controls: readonly string[];
  /** How many editable regions the page had. */
  readonly regionCount: number;
  /** The text length of each editable region, largest first — what an ambiguity refusal reports. */
  readonly regionTextLengths: readonly number[];
  readonly observedAtIso: string;
}

/** One exact substitution, resolved against a snapshot and ready to be judged. */
export interface VantaDraftEditPlan {
  /** Versioned so a digest computed under one shape can never be honoured under another. */
  readonly kind: "vanta-policy-draft-substitution-v1";
  readonly url: string;
  readonly find: string;
  readonly replace: string;
  /** The editor text the substitution must produce. Computed here, checked in the browser. */
  readonly expectedText: string;
}

/** Why a draft edit was refused. */
export type VantaDraftError =
  | { readonly code: "FIND_ABSENT"; readonly message: string; readonly find: string }
  | { readonly code: "FIND_AMBIGUOUS"; readonly message: string; readonly find: string; readonly hits: number }
  | { readonly code: "NO_CHANGE"; readonly message: string }
  | { readonly code: "EMPTY_FIND"; readonly message: string }
  | {
      readonly code: "EDITOR_AMBIGUOUS";
      readonly message: string;
      readonly regionCount: number;
      readonly regionTextLengths: readonly number[];
    }
  | { readonly code: "NOT_AN_EDITABLE_DRAFT"; readonly message: string; readonly controls: readonly string[] };

/** The factories every refusal above is built through, so a test constructs one the way the code does. */
export const VantaDraftErrors = {
  editorAmbiguous: ({
    regionCount,
    regionTextLengths,
  }: {
    regionCount: number;
    regionTextLengths: readonly number[];
  }): VantaDraftError => ({
    code: "EDITOR_AMBIGUOUS",
    message:
      `the editor page has ${String(regionCount)} editable regions and no single one is clearly the draft, ` +
      `so which one holds it is a guess. Their text lengths, largest first: ` +
      `${regionTextLengths.slice(0, TOP_REGIONS_REPORTED).map(String).join(", ")}`,
    regionCount,
    regionTextLengths,
  }),
  emptyFind: (): VantaDraftError => ({
    code: "EMPTY_FIND",
    message: "the text to replace is empty, which would match everywhere and mean nothing",
  }),
  findAbsent: ({ find }: { find: string }): VantaDraftError => ({
    code: "FIND_ABSENT",
    message: `the draft does not contain ${JSON.stringify(find)} — read it again, it may have moved`,
    find,
  }),
  findAmbiguous: ({ find, hits }: { find: string; hits: number }): VantaDraftError => ({
    code: "FIND_AMBIGUOUS",
    hits,
    message:
      `the draft contains ${JSON.stringify(find)} ${String(hits)} times, and a substitution that could land ` +
      "in either place is not one anybody approved — extend the text until it is unique",
    find,
  }),
  noChange: (): VantaDraftError => ({
    code: "NO_CHANGE",
    message: "the replacement is identical to the text it replaces, so there is nothing to write",
  }),
  notAnEditableDraft: ({ controls }: { controls: readonly string[] }): VantaDraftError => ({
    code: "NOT_AN_EDITABLE_DRAFT",
    controls,
    message:
      "this page does not show the controls an editable draft shows — a submitted or approved version is " +
      "never edited by this verb",
  }),
} as const;

/** How many region lengths an ambiguity refusal prints. Enough to see the shape, not a page of numbers. */
const TOP_REGIONS_REPORTED = 6;

/**
 * How much bigger the draft's own region must be than the next one down before it is unambiguously the draft.
 *
 * MEASURED against the live editor, which reported editable regions beyond the draft's own on one policy — the
 * rich-text editor marks its own blocks editable, and the Vanta Agent's composer is editable too. So
 * "exactly one region" was never the right test; what actually distinguishes the draft is that it is the
 * container, so its own text contains every other region's. Reproduce with
 * `slopweaver write vanta edit-policy-draft --policy <id> --find x --replace y --dry-run`, which prints the
 * lengths when it refuses.
 */
const DRAFT_REGION_DOMINANCE = 4;

/**
 * Whether no single editable region is clearly the draft.
 *
 * @param lengths every editable region's text length
 * @returns true when the page is too ambiguous to write to
 */
export function editorIsAmbiguous({ lengths }: { lengths: readonly number[] }): boolean {
  const sorted = lengths.toSorted((a, b) => b - a);
  const [largest, second] = sorted;
  if (largest === undefined || largest === 0) {
    return true;
  }
  if (second === undefined) {
    return false;
  }
  return largest < second * DRAFT_REGION_DOMINANCE;
}

/** The control an editable, not-yet-submitted Vanta policy draft always shows. */
export const DRAFT_SAVE_CONTROL = "Save and close";

/**
 * Whether a snapshot is of an editable draft at all.
 *
 * Judged on the page's own controls rather than on the Manage API's `latestVersion.status`, because the
 * status is what the API knew when it was last synced and the control is what is in front of the write.
 *
 * @param snapshot the draft as it was read
 * @returns the snapshot, or why this page is not one to write to
 */
export function checkEditableDraft({
  snapshot,
}: {
  snapshot: VantaDraftSnapshot;
}): Result<VantaDraftSnapshot, VantaDraftError> {
  const ambiguous = editorIsAmbiguous({ lengths: snapshot.regionTextLengths });
  if (ambiguous) {
    return err(
      VantaDraftErrors.editorAmbiguous({
        regionCount: snapshot.regionCount,
        regionTextLengths: snapshot.regionTextLengths,
      }),
    );
  }
  if (!snapshot.controls.includes(DRAFT_SAVE_CONTROL)) {
    return err(VantaDraftErrors.notAnEditableDraft({ controls: snapshot.controls }));
  }
  return ok(snapshot);
}

/**
 * How many times one exact run occurs in a text.
 *
 * Written out rather than done with a regular expression: the find string is arbitrary operator input and
 * `new RegExp(find)` over it is both a correctness bug and an injection of control flow into a match.
 *
 * @param text the text to search
 * @param find the exact run to count
 * @returns the number of non-overlapping occurrences
 */
export function occurrencesOf({ text, find }: { text: string; find: string }): number {
  if (find.length === 0) {
    return 0;
  }
  let count = 0;
  let from = text.indexOf(find);
  while (from !== -1) {
    count += 1;
    from = text.indexOf(find, from + find.length);
  }
  return count;
}

/**
 * Resolve one substitution against a snapshot, refusing anything that is not exactly one change.
 *
 * @param snapshot the draft as it was read
 * @param find the exact run to replace, which must occur exactly once
 * @param replace what to put there
 * @returns the plan, or the typed reason there is none
 */
export function buildVantaDraftEditPlan({
  snapshot,
  find,
  replace,
}: {
  snapshot: VantaDraftSnapshot;
  find: string;
  replace: string;
}): Result<VantaDraftEditPlan, VantaDraftError> {
  if (find.length === 0) {
    return err(VantaDraftErrors.emptyFind());
  }
  if (find === replace) {
    return err(VantaDraftErrors.noChange());
  }
  const hits = occurrencesOf({ find, text: snapshot.text });
  if (hits === 0) {
    return err(VantaDraftErrors.findAbsent({ find }));
  }
  if (hits > 1) {
    return err(VantaDraftErrors.findAmbiguous({ find, hits }));
  }
  return ok({
    expectedText: snapshot.text.replace(find, replace),
    find,
    kind: "vanta-policy-draft-substitution-v1",
    replace,
    url: snapshot.finalUrl,
  });
}

/**
 * The inverse of a plan, built against the text that plan produced.
 *
 * The revert is a SECOND write with its own digest and its own door row, never a rollback the first write
 * carries — an edit whose outcome is unknown must not be inverted blindly, and a plan built from the
 * persisted text is what makes the second act judged on what is actually there.
 *
 * @param snapshot the draft as it was read AFTER the first edit
 * @param plan the edit to undo
 * @returns the inverse plan, or the typed reason there is none
 */
export function invertVantaDraftEditPlan({
  snapshot,
  plan,
}: {
  snapshot: VantaDraftSnapshot;
  plan: VantaDraftEditPlan;
}): Result<VantaDraftEditPlan, VantaDraftError> {
  return buildVantaDraftEditPlan({ find: plan.replace, replace: plan.find, snapshot });
}

/**
 * The digest an approval is bound to: a hash over exactly the substitution that would be made.
 *
 * The page, both strings and the whole resulting text are in it, so an approval cannot be transplanted onto
 * a different policy, a different run of text, or a draft that has moved since. The clock is not, so an
 * approval does not expire while the operator reads the preview.
 *
 * It does NOT authenticate a human — the same process that prints it can compute it. What it buys is that
 * the write is a second deliberate act taken against a substitution that cannot have changed underneath it.
 *
 * @param plan the substitution as it would be made
 * @returns the leading hex characters of the SHA-256 over the canonical plan
 */
export function vantaDraftEditDigest({ plan }: { plan: VantaDraftEditPlan }): string {
  const canonical = JSON.stringify({
    expectedText: plan.expectedText,
    find: plan.find,
    kind: plan.kind,
    replace: plan.replace,
    url: plan.url,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, DIGEST_WIDTH);
}

/**
 * The change as a reader sees it: the one line that moved, with a caret run under what changed.
 *
 * Vanta shows no diff at all — the owner tested the editor personally and its own agent
 * confirmed that only *"Preview as a PDF"* exists — so this is where the diff for a policy change comes
 * from until the source of truth moves somewhere that has one.
 *
 * @param plan the substitution
 * @returns the before line, the after line, and a marker row, ready to print
 */
export function renderVantaDraftDiff({ plan }: { plan: VantaDraftEditPlan }): readonly string[] {
  const at = plan.expectedText.indexOf(plan.replace);
  const lineStart = plan.expectedText.lastIndexOf("\n", at) + 1;
  const lineEndRaw = plan.expectedText.indexOf("\n", at);
  const lineEnd = lineEndRaw === -1 ? plan.expectedText.length : lineEndRaw;
  const after = plan.expectedText.slice(lineStart, lineEnd);
  const before = after.slice(0, at - lineStart) + plan.find + after.slice(at - lineStart + plan.replace.length);
  return [`- ${before}`, `+ ${after}`];
}
