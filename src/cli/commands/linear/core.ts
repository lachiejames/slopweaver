/**
 * The PURE core of `linear issue` — argument parsing, form validation, the dry-run preview, and the
 * deterministic intent id. No I/O, so all of it is unit-testable without a mock.
 *
 * ## The intent id is DERIVED, not generated, and that is the at-most-once fix
 *
 * A freshly generated UUID per invocation does not survive a lost response: invocation A creates the issue
 * and dies before recording it, invocation B generates a different id for the same intent and creates a
 * second ticket. Nothing local can spot the duplicate, because the two runs share no key.
 *
 * So the id is a UUID v4-shaped digest of the INTENT — the destination fields plus the rendered body. The
 * same intent computes the same id in any process, on any day, so the second invocation looks up the id the
 * first one would have used, finds the reservation, and refuses. This mirrors the Slack precedent, which
 * keys its reservation on `identity ⊕ rendered payload` for the same reason; Linear only goes further
 * because it lets the caller CHOOSE the resulting id, so the key and the object's identity can be the same
 * value rather than two things to reconcile.
 *
 * The cost is stated plainly: re-running a genuinely different-but-identical-looking intent is refused as a
 * duplicate. That is the correct direction to be wrong in for an irreversible create: change the form, or
 * remove the ledger record once you have established the earlier attempt did not land.
 */
import { createHash } from "node:crypto";
import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type FidelityReport, fidelityLines } from "../../../outbound/linear/fidelity.js";
import { parseVerifiedMentionIds } from "../../../outbound/linear/mentionIndex.js";
import { renderIssueBody } from "../../../outbound/linear/render.js";
import { linearIssueFormSchema } from "../../../outbound/linear/schema.js";
import type { LinearIssueForm } from "../../../outbound/linear/types.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";
import { parseLinearForm } from "./formParse.js";
import { type IssueStepUpArgs, issueStepUpArgsOf } from "./issueStepUpArgs.js";

// The dry-run preview is rendered in its own module; the issue verb reaches it through this core.
export { dryRunLines } from "./issueDryRun.js";

/** A parsed `linear issue` invocation, the step-up flags (`./issueStepUpArgs.ts`) included. */
export interface LinearIssueArgs extends IssueStepUpArgs {
  readonly verb: "create" | "update";
  readonly formSource: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
  readonly issueId: string | undefined;
  /** Change state/priority/labels WITHOUT sending a description, so prose cannot be overwritten. */
  readonly fieldsOnly: boolean;
  /** The `--mention-id key=<linear-user-id>` pairs the caller verified live — see `./formCreateArgs.ts`. */
  readonly mentionIds: ReadonlyMap<string, string>;
}

/**
 * The flags this verb accepts, as a {@link FlagSpec}.
 *
 * `helpTruth.test.ts` compares the names derived from it below against the manifest usage string in both
 * directions. The names here omit the leading `--`, which is what `parseFlags` expects.
 */
const LINEAR_ISSUE_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json", "fields-only", "move-team", "rewrite-filed", "unasked"],
  string: ["form", "issue-id", "home", "mention-id", "expect-updated-at", "why", "said", "by-session"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const LINEAR_ISSUE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LINEAR_ISSUE_FLAGS }),
  ...booleanFlagsOf({ spec: LINEAR_ISSUE_FLAGS }),
].map((name) => `--${name}`);

/**
 * Linear's required id shape, and the guard on a filesystem path.
 *
 * `--issue-id` is interpolated into a ledger FILENAME, so an unvalidated value is a path-traversal hole:
 * `../../x` escapes `$SLOPWEAVER_HOME/ledgers/linear-issues` entirely. Today that only reaches a read;
 * the moment the reservation is wired it reaches a WRITE outside the state home. Validating the
 * provider-required UUID v4 form closes it at the only place the value enters the program.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Whether a string is a Linear-acceptable issue id.
 *
 * @param id the candidate id
 * @returns true iff it is a well-formed UUID v4
 */
export function isValidIssueId({ id }: { id: string }): boolean {
  return UUID_V4.test(id);
}

/**
 * Every value-level rejection an otherwise well-formed invocation still earns: a missing form, an
 * `--issue-id` that is absent when `update` requires it or malformed when present.
 *
 * Split out of {@link parseLinearIssueArgs} so that function stays under the cognitive-complexity gate as
 * flags are added; it accumulates rather than short-circuits, for the reason `parseFlags` does — someone
 * whose invocation has two problems should be told both.
 *
 * @param formSource the `--form` value, or undefined when it was not given
 * @param issueId the `--issue-id` value, or undefined when it was not given
 * @param verb which of `create`/`update` was invoked
 * @returns one line per rejection, empty when the values are usable
 */
function issueArgValueErrors({
  formSource,
  issueId,
  verb,
}: {
  formSource: string | undefined;
  issueId: string | undefined;
  verb: "create" | "update";
}): readonly string[] {
  const missingForm =
    formSource === undefined ? ["--form <json|-> is required (use `-` to read the form from stdin)"] : [];
  const missingId =
    verb === "update" && issueId === undefined
      ? [
          "--issue-id <uuid> is required for update: the id slopweaver reserved for an issue it created, or `linear read <key> --json`'s id for any other",
        ]
      : [];
  const malformedId =
    issueId !== undefined && !isValidIssueId({ id: issueId })
      ? [`--issue-id must be a UUID v4; "${issueId}" is not, and it would reach a ledger filename`]
      : [];
  return [...missingForm, ...missingId, ...malformedId];
}

/**
 * Parse `linear issue <create|update> …`.
 *
 * @param argv the verb's arguments, excluding the noun
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseLinearIssueArgs({ argv }: { argv: readonly string[] }): Result<LinearIssueArgs, LinearVerbError> {
  const verb = argv[0];
  if (verb !== "create" && verb !== "update") {
    return err(LinearVerbErrors.usage({ noun: "issue", shape: "<create|update>" }));
  }
  // The SHARED parser, not a hand-rolled `indexOf('--x')` loop. Rolling my own got the unknown-flag rejection
  // right and everything else wrong: `--form=value` was reported as an unknown flag because the scan matched
  // whole tokens, and a value flag given with no value fell through as "absent". `parseFlags` is built on
  // `node:util` `parseArgs` and handles both, which is exactly why the file exists.
  const parsed = parseFlags({ args: argv.slice(1), spec: LINEAR_ISSUE_FLAGS });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const formSource = typeof values["form"] === "string" ? values["form"] : undefined;
  const issueId = typeof values["issue-id"] === "string" ? values["issue-id"] : undefined;
  const mentions = parseVerifiedMentionIds({
    raw: typeof values["mention-id"] === "string" ? values["mention-id"] : undefined,
  });
  const fieldsOnly = values["fields-only"] === true;
  const stepUp = issueStepUpArgsOf({ fieldsOnly, values, verb });
  const errors = [...issueArgValueErrors({ formSource, issueId, verb }), ...mentions.errors, ...stepUp.errors];
  if (errors.length > 0) {
    return err(LinearVerbErrors.argumentsRefused({ reasons: errors }));
  }
  return ok({
    ...stepUp.args,
    dryRun: values["dry-run"] === true,
    fieldsOnly,
    formSource: formSource!,
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    issueId,
    json: values["json"] === true,
    mentionIds: mentions.verified,
    verb,
  });
}

/**
 * Validate a filled form.
 *
 * @param raw the JSON text of the form
 * @returns the typed form, or one line per rejection naming its path
 */
export function parseLinearIssueForm({ raw }: { raw: string }): Result<LinearIssueForm, LinearVerbError> {
  return parseLinearForm({ raw, schema: linearIssueFormSchema });
}

/**
 * The version nibble Linear accepts.
 *
 * MEASURED, not chosen: a well-formed v5 UUID is rejected by the API with `Argument Validation Error - id
 * must be a UUID`, so Linear validates the version field rather than merely the hex layout. The id here is
 * therefore v4-SHAPED but derived rather than random — the layout satisfies the provider while determinism
 * is what the design actually needs. Stated plainly because a reader is entitled to know this value is not
 * random despite advertising itself as v4.
 */
const UUID_VERSION_NIBBLE = "4";

/**
 * The deterministic issue id for an intent, in UUID v4 layout.
 *
 * Formatted as a real UUID rather than a bare digest because `IssueCreateInput.id` is a UUID field and
 * validates as one. The version and variant nibbles are set explicitly so the result is well-formed.
 *
 * Reached in production through {@link issueWriteId}; exported so a test can name the id a create derives.
 *
 * @param form the complete write
 * @returns the UUID this intent always maps to
 * @internal
 */
export function intentId({ form }: { form: LinearIssueForm }): string {
  const body = renderIssueBody({ artifact: form.artifact });
  // The destination is part of the identity: the same body filed against a different team is a different
  // intent, and collapsing them would refuse a legitimate second ticket as a duplicate.
  const material = JSON.stringify({ body, fields: form.fields });
  const hex = createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuid = `${hex.slice(0, 12)}${UUID_VERSION_NIBBLE}${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
  return [uuid.slice(0, 8), uuid.slice(8, 12), uuid.slice(12, 16), uuid.slice(16, 20), uuid.slice(20, 32)].join("-");
}

/**
 * The issue id this write targets: the `--issue-id` the operator named, or — for a create that names none —
 * the id derived from the intent, so a retry of the same create reuses it. `parseLinearIssueArgs` already
 * refuses an update without one, so only a create ever derives.
 *
 * @param args the parsed invocation, whose `issueId` is the operator's own
 * @param form the complete write the derived id is computed from
 * @returns the id the write reserves and sends
 */
export function issueWriteId({ args, form }: { args: LinearIssueArgs; form: LinearIssueForm }): string {
  if (args.issueId === undefined) {
    return intentId({ form });
  }
  return args.issueId;
}

/**
 * What an `update` is, stated because the obvious reading is wrong.
 *
 * Linear's `issueUpdate` is PATCH-shaped: only the fields you supply change. This form is COMPLETE-shaped —
 * it carries a whole body. Those two do not compose into "recover the issue and edit one field", and
 * pretending otherwise is how a teammate's paragraph gets destroyed:
 *
 *  - The stored markdown cannot be turned back into a form. `problem` and `proofOfProblem` are concatenated
 *    with no marker between them, so the boundary is unrecoverable by construction.
 *  - Re-rendering a form you held from before therefore REPLACES whatever is there now, including anything
 *    edited in between.
 *
 * So `update` means exactly one thing: **replace the description from an authoritative form the caller
 * supplies.** The alternative — changing state, priority or labels without touching the body — is a genuinely
 * different operation and is expressed as {@link UpdateScope} `fields-only`, which sends no description at
 * all and therefore cannot overwrite prose.
 */
export type UpdateScope = "replace-body" | "fields-only";

/** Whether an update may proceed, or the named reason it must not. */
export type UpdateSafety = { readonly safe: true } | { readonly safe: false; readonly reason: string };

/**
 * Refuse a body-replacing update when the issue changed since slopweaver last wrote it.
 *
 * `IssueUpdateInput` carries no compare-and-swap precondition, so Linear will accept the overwrite without
 * complaint. This comparison is the only thing standing between a stale form and someone else's work. It is
 * a check, not a lock: a human could still edit between this read and the write, which is why the refusal
 * message says to re-read rather than claiming the write was safe.
 *
 * A `fields-only` update skips the check because it sends no description and cannot clobber prose.
 *
 * @param scope what the update intends to change
 * Compares the DESCRIPTION, not the clock. Linear moves `updatedAt` by itself after a create (measured: 43
 * seconds later, unprompted) because it normalises the stored markdown, so a timestamp check refuses every
 * first update as a phantom conflict. The description digest asks the question that actually matters.
 *
 * @param lastSeenDescriptionHash the digest slopweaver recorded at its last write
 * @param remoteDescriptionHash the digest of a fresh read-back, or `undefined` when no read-back was
 *   performed — a dry run does not touch the network, so the comparison is simply not available
 * @returns safe, or the named refusal
 */
export function updateSafety({
  scope,
  lastSeenDescriptionHash,
  remoteDescriptionHash,
}: {
  scope: UpdateScope;
  lastSeenDescriptionHash: string | undefined;
  remoteDescriptionHash: string | undefined;
}): UpdateSafety {
  if (scope === "fields-only") {
    return { safe: true };
  }
  if (lastSeenDescriptionHash === undefined) {
    return {
      reason:
        "slopweaver has no record of the description it last wrote, so it cannot tell whether anyone has " +
        "edited this issue since. Refusing to replace it. Use --fields-only to change state or priority " +
        "without touching prose.",
      safe: false,
    };
  }
  if (remoteDescriptionHash === undefined) {
    // No read-back, so nothing to compare. The missing-record case above is still decided, which is the one
    // that matters offline; the live path always supplies a remote value.
    return { safe: true };
  }
  if (lastSeenDescriptionHash !== remoteDescriptionHash) {
    return {
      reason:
        "this issue's description has changed since slopweaver last wrote it. Replacing it would discard " +
        "whatever changed, and Linear offers no compare-and-swap to make the write conditional. Re-read it " +
        "and build a form from its current contents, or use --fields-only.",
      safe: false,
    };
  }
  return { safe: true };
}

/**
 * What became of a write. Four arms, and the middle two are why this is a union rather than a boolean.
 *
 * `unconfirmed` is the honest answer to a mutation that returned but could not be verified: reporting it as
 * failure invites a retry that files a second ticket, and reporting it as success claims an issue nobody
 * established exists. `duplicate` is the at-most-once guard firing, which is the verb working, not an error.
 */
export type LinearIssueOutcome =
  | {
      readonly kind: "written";
      readonly identifier: string;
      readonly url: string;
      // What the round-trip did to the body, or `undefined` for a `--fields-only` update, which sends NO
      // body and so has none to verify. Saying "body verified" there would be a claim about bytes that were
      // never transmitted.
      readonly fidelity: FidelityReport | undefined;
    }
  | { readonly kind: "unconfirmed"; readonly id: string }
  | {
      // The mutation errored but the issue EXISTS at the caller-chosen id, proved by read-back. A write that
      // landed is not a failure, and saying so prevents a retry against a ticket that is already there.
      readonly kind: "landedAfterError";
      readonly identifier: string;
      readonly url: string;
      readonly reason: string;
      readonly fidelity: FidelityReport;
    }
  | { readonly kind: "indeterminate"; readonly reason: string }
  | { readonly kind: "duplicate"; readonly reservedIso: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * What a successful write can honestly claim about the state it left behind.
 *
 * A `--fields-only` update sends no description, so there is no round-trip to report; and the fields it DOES
 * send — priority, estimate, state, project, labels — are not returned by the read-back, so nothing here has
 * seen them take effect. That is said plainly rather than dressed up as a verified write.
 *
 * @param fidelity the body comparison, or `undefined` when no body was sent
 * @returns the lines to print
 */
function verificationLines({ fidelity }: { fidelity: FidelityReport | undefined }): readonly string[] {
  if (fidelity === undefined) {
    return [
      "no description was sent (--fields-only), and the fields it did send are not returned by a read-back,",
      "so the change is filed but UNVERIFIED. Check the issue if the field values matter.",
    ];
  }
  return fidelityLines({ report: fidelity });
}

/**
 * The operator-facing report for an outcome.
 *
 * @param outcome what happened
 * @param verb which action was attempted
 * @returns the lines to print
 */
export function outcomeLines({
  outcome,
  verb,
}: {
  outcome: LinearIssueOutcome;
  verb: "create" | "update";
}): readonly string[] {
  // The verb is passed rather than inferred: an update that reports "created" is a small lie, and the first
  // live update printed exactly that. A report that names the wrong action is how someone concludes a
  // second ticket was filed when one was edited.
  const past = verb === "create" ? "created" : "updated";
  switch (outcome.kind) {
    case "written":
      return [`${past} ${outcome.identifier}`, outcome.url, ...verificationLines({ fidelity: outcome.fidelity })];
    case "unconfirmed":
      return [
        `the issue at ${outcome.id} was ${past} but could NOT be read back, so its state is unverified.`,
        `Linear echoes only an id on a write, so there is no identifier or URL to print until a read succeeds.`,
        "Do not re-run this: the mutation may have landed. Check the issue, then reconcile.",
      ];
    case "duplicate":
      return [
        `refused: this exact intent was already reserved at ${outcome.reservedIso}.`,
        "The issue id is derived from the content, so an identical form maps to the identical issue.",
        "Change the form, or delete the ledger record if the earlier attempt definitely did not land.",
      ];
    case "landedAfterError":
      return [
        `${past} ${outcome.identifier}, despite a transport error — the issue was found at the id we chose.`,
        outcome.url,
        `the error was: ${outcome.reason}`,
        ...fidelityLines({ report: outcome.fidelity }),
      ];
    case "indeterminate":
      return [
        `the mutation errored AND the issue could not be read back, so it is unknown whether it landed.`,
        `the error was: ${outcome.reason}`,
        "Do NOT re-run this. Look for the issue in Linear, then reconcile.",
      ];
    case "failed":
      // Reached only when nothing landed — a read-back confirmed the issue is absent, or a guard refused before the
      // wire — so this really is a definite failure.
      return [`the write failed: ${outcome.reason}`];
  }
}

/**
 * The door request for a Linear issue write.
 *
 * `createsWorkItem` is true for a create and false for an update, because it describes what the action does
 * to the world rather than which verb was typed. `artifact` deliberately carries only the id and the
 * destination — the door record is an audit trail, not a copy of the issue body.
 *
 * @param verb which action is being admitted — `createsWorkItem` follows this, not the typed command
 * @param teamId the destination team, recorded so the audit trail says where the write landed
 * @param home the resolved state home
 * @param id the issue id
 * @returns the request to admit
 */
export function doorRequestFor({
  verb,
  teamId,
  home,
  id,
}: {
  verb: "create" | "update";
  teamId: string;
  home: string;
  id: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "linear", verb: `issue ${verb}` },
    artifact: { id, teamId },
    meta: {
      createsWorkItem: verb === "create",
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
