/**
 * The draft an `update` will send: a partial edit merged into the recovered description, or the whole form as
 * supplied — with the third-party bytes to re-append after it.
 *
 * The two paths are deliberately different. `--edit` NEEDS a prior form to merge into, so it goes through
 * recovery and refuses when neither the cache nor the live body yields one. `--form`/`--file` needs nothing
 * recovered — that is the point of it — so it skips recovery and works on any pull request, house-format or
 * not. Split out of `./updateFlow.ts`, which calls only `chooseUpdate`.
 */
import type { WrittenPr } from "../../../corpus/github/write.js";
import { applyEdit } from "../../../outbound/github/merge.js";
import { readPrRecord } from "../../../outbound/github/prLedger.js";
import { recoverPrForm } from "../../../outbound/github/recovery.js";
import type { PrFormDraft, PrFormEdit } from "../../../outbound/github/types.js";
import { prFormWriteSchema } from "../../../outbound/github/writeSchema.js";
import { liveLocusFor, liveTargetFor } from "./addressRun.js";
import { formTargetMismatch } from "./updateCore.js";
import { wholeFormInputRefusal } from "./wholeFormRefusal.js";

/**
 * One decoded description replacement or partial edit.
 *
 * `pulledBodyHash` is set only for a form that came from `--file` and was itself produced by an earlier
 * `--pull` — it is undefined for `--form` and for a `--file` that was authored from scratch (nothing pulled,
 * nothing to have drifted from). `fromFile` distinguishes those two undefined cases from each other and from
 * plain `--form`, so a `--file` missing its digest (an authored-from-scratch file, or one that had its
 * `pulled-body-hash` line stripped) can be told apart and advised about, without nagging every `--form` call
 * that never had this property to begin with.
 */
export type UpdateDescriptionInput =
  | { readonly kind: "edit"; readonly edit: PrFormEdit }
  | {
      readonly kind: "form";
      readonly form: PrFormDraft;
      readonly pulledBodyHash?: string | undefined;
      readonly fromFile?: true | undefined;
    };

/**
 * The description the write will send: the draft, and the third-party bytes to re-append after it.
 *
 * `trailing` is empty on every path but a partial `--edit` over a description something else has appended to
 * — a bot's release notes, a human's footer. It is carried here rather than recovered again at the write,
 * because the form and the block it was split from have to come from the SAME read of the body.
 */
export type ChosenUpdate = {
  readonly draft: PrFormDraft;
  readonly wholesale: boolean;
  readonly trailing: string;
  /** Advisories to print before the preview, empty when there are none. */
  readonly notices: readonly string[];
};

/**
 * The draft a decoded description change resolves to against the live pull request.
 *
 * @param input the decoded `--edit`, `--form` or `--file`
 * @param live the pull request as read before the door
 * @param home the state home, whose description ledger an `--edit` recovers from first
 * @returns the chosen update, or the reason it is refused
 */
export function chooseUpdate({
  input,
  live,
  home,
}: {
  input: UpdateDescriptionInput;
  live: WrittenPr;
  home: string;
}): ChosenUpdate | { reason: string } {
  if (input.kind === "form") {
    return chooseWholeFormInput({ input, live });
  }
  return chooseEditInput({ edit: input.edit, home, live });
}

/**
 * A `--form`/`--file` whole-replacement input, checked against the live pull request and advised on.
 *
 * The digest check guards a gap `updateFreshnessFor` (in `performUpdate`) does NOT cover: that check re-reads
 * right before the PATCH, within this one invocation, but a `--pull`ed file can be edited over a much longer
 * span, in a SEPARATE invocation entirely. It is scoped to input that actually carries a pulled digest — a
 * `--form` or a from-scratch `--file` has nothing to have drifted from.
 */
function chooseWholeFormInput({
  input,
  live,
}: {
  input: Extract<UpdateDescriptionInput, { kind: "form" }>;
  live: WrittenPr;
}): ChosenUpdate | { reason: string } {
  const refused = wholeFormInputRefusal({ input, live });
  if (refused !== undefined) {
    return { reason: refused };
  }
  const chosen = wholeFormFor({ form: input.form, live });
  if ("reason" in chosen) {
    return chosen;
  }
  // A `--file` carrying no digest is either a from-scratch file (nothing to protect) or one that WAS pulled
  // and lost its `pulled-body-hash` line — those look identical here, so this can only advise, not refuse:
  // refusing would break the legitimate from-scratch case. Silence would be the worse failure — the whole
  // point of `--pull` is this check, and it fires with no visible sign that it did not run.
  if (input.fromFile !== true || input.pulledBodyHash !== undefined) {
    return chosen;
  }
  const noDigestNotice =
    "note: this file carries no pulled-body-hash, so the live description was NOT checked for drift before " +
    "sending — if you meant to edit an existing description, `--pull` it first";
  return { ...chosen, notices: [...chosen.notices, noDigestNotice] };
}

/** A partial `--edit`, merged into the description recovered for the live pull request. */
function chooseEditInput({
  edit,
  live,
  home,
}: {
  edit: PrFormEdit;
  live: WrittenPr;
  home: string;
}): ChosenUpdate | { reason: string } {
  const recovered = recoverPrForm({
    live: { draft: live.draft, target: liveTargetFor({ pr: live }), title: live.title },
    liveBody: live.body,
    number: live.number,
    record: readPrRecord({ home, locus: liveLocusFor({ pr: live }) }),
  });
  if (recovered.kind === "refused") {
    return { reason: recovered.reason };
  }
  const merged = applyEdit({ edit, form: recovered.form });
  const revalidated = prFormWriteSchema.safeParse(merged);
  if (!revalidated.success) {
    return { reason: `the merged form is not valid: ${revalidated.error.issues.map((i) => i.message).join("; ")}` };
  }
  return {
    draft: revalidated.data,
    notices: [],
    trailing: recovered.trailing,
    wholesale: false,
  };
}

/**
 * A complete form, checked against the pull request it is being sent to.
 *
 * The LIVE shell wins here as it does on the edit path, and `draft` in particular was a false-success bug. A
 * form carries `draft` because CREATE needs it, but a REST PATCH cannot change draft state — so a form saying
 * `draft: false` against a live draft was recorded as false and reported `updated` while GitHub still had it
 * drafted: a change the caller asked for, was told had happened, and that never did. `PrFormEdit` omits `draft`
 * entirely to avoid exactly this, so the whole-form path has to reach the same answer rather than reopening it.
 * The disagreement is STATED rather than silently dropped.
 */
function wholeFormFor({ form, live }: { form: PrFormDraft; live: WrittenPr }): ChosenUpdate | { reason: string } {
  const mismatch = formTargetMismatch({ form, live });
  if (mismatch !== undefined) {
    return { reason: mismatch };
  }
  const draftIgnored =
    form.draft === live.draft
      ? undefined
      : `note: draft state is not changeable through this API, so #${String(live.number)} stays ` +
        `${live.draft ? "a draft" : "ready for review"} and the form's draft field was ignored`;
  return {
    draft: { ...form, draft: live.draft, target: liveTargetFor({ pr: live }) },
    notices: draftIgnored === undefined ? [] : [draftIgnored],
    // A whole-form replacement is exactly the act of discarding whatever is there, third-party block
    // included — `./updateConsent.ts` shows those bytes in its diff and `SLOPWEAVER_ALLOW_PR_REPLACE`
    // consents to losing them. Preserving a trailing region here would make the diff a lie.
    trailing: "",
    wholesale: true,
  };
}
