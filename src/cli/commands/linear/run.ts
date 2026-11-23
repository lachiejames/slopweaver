/**
 * `slopweaver linear issue` — the effectful shell. Every decision lives in `./core.ts`; this file resolves
 * the home and token, routes the effect through the admit door, and performs the mutation.
 *
 * ## The order is the contract
 *
 *   parse → validate → render → [dry-run stops here] → token → ownership → door → reserve → mutate →
 *   read back → confirm → report
 *
 * Three points in that sequence are load-bearing rather than incidental:
 *
 *  - **The dry run stops before ANY effect.** No token resolution, no door record, no ledger directory, no
 *    network. A preview that leaves a trace is not a preview, and a reservation left behind by one would
 *    make the next real run look like a duplicate.
 *  - **The reservation is taken INSIDE `perform`**, so a door refusal cannot leave a claimed id behind. It
 *    is taken BEFORE the mutation, so a lost response still leaves evidence that we tried.
 *  - **Success is reported only after a read-back.** `issueCreate` can answer `success: true` with a null
 *    issue, so the create's own response is not proof. If the mutation lands but the read-back or the local
 *    confirmation fails, that is reported as UNCONFIRMED — never as failure, because a retry would be a
 *    second ticket, and never as success, because nothing established the issue exists.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { ok, type Result } from "../../../lib/result.js";
import { linearIssueAboveFoldCells } from "../../../outbound/linear/aboveFold.js";
import { linkifyIssueArtifact } from "../../../outbound/linear/bareRefLinks.js";
import { linearMentionRefusals } from "../../../outbound/linear/mentionIndex.js";
import { mentionKeysOfIssue, rewriteIssueMentions } from "../../../outbound/linear/mentionRewrite.js";
import { renderIssueBody } from "../../../outbound/linear/render.js";
import type { LinearIssueArtifact, LinearIssueFields, LinearIssueForm } from "../../../outbound/linear/types.js";
import type { BareRefIssue } from "../../../outbound/linkify/bareRefs.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import { aboveFoldGateRefused } from "../../aboveFoldDoor.js";
import { bareRefGateRefused } from "../../bareRefDoor.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import {
  doorRequestFor,
  dryRunLines,
  issueWriteId,
  type LinearIssueArgs,
  type LinearIssueOutcome,
  outcomeLines,
  parseLinearIssueArgs,
  parseLinearIssueForm,
} from "./core.js";
import { linearVerbErrorLines } from "./errors.js";
import { destinationRefusals, issueRetiredTeamRefusals } from "./issueDestination.js";
import { journalUnasked } from "./issueJournal.js";
import { performWrite, updatePrecheck, type WriteContext } from "./issueWrite.js";
import { unaskedKind, unaskedNoteRefusal, unaskedRefusals } from "./unasked.js";
import { type LinearWriteDeps, productionLinearWriteDeps } from "./writeDeps.js";

/**
 * Where this verb's own arguments start in `process.argv`: after node, the script, the noun and the verb.
 *
 * Four, not two. `run` receives the FULL argv, not a pre-sliced tail — a detail no fixture disagrees with
 * and no unit test notices, because a test constructs the array it expects. The previous PR in this series
 * shipped an argv index error that survived seventy passing tests and was caught only by invoking the real
 * binary, which is why this one was too.
 */
const VERB_ARG_OFFSET = 4;

/** Print each line to stderr and return the code. */
function refuse({ deps, lines, code }: { deps: LinearWriteDeps; lines: readonly string[]; code: number }): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/** The exit code for an outcome. */
function codeFor({ outcome }: { outcome: LinearIssueOutcome }): number {
  // A write that landed is a success even if the response was lost: the read-back proved the issue exists.
  if (outcome.kind === "written" || outcome.kind === "landedAfterError") {
    return EXIT_OK;
  }
  // A duplicate or an unconfirmed write are legitimate non-success STATUSES, not faults: the verb ran
  // correctly and is telling you what it found. Only a real mutation failure is the fault channel.
  return outcome.kind === "failed" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
}

/** The effect phase: token, ownership, door, write. */
async function runLive({
  args,
  artifact,
  deps,
  id,
  fields,
}: {
  args: LinearIssueArgs;
  artifact: LinearIssueArtifact;
  deps: LinearWriteDeps;
  id: string;
  fields: LinearIssueFields;
}): Promise<number> {
  const home = resolveHome({ named: args.home });
  const token = deps.resolveToken({ home });
  if (token === undefined) {
    return refuse({
      code: EXIT_EXPECTED_EMPTY,
      deps,
      lines: [`no Linear token for this home. Set LINEAR_API_KEY, or write ${home}/secrets/linear-token`],
    });
  }
  // BOTH gates run before the door, so a refusal costs no audit record and no reservation. Their order is
  // not significant — every refusal line is collected and reported together, because someone whose form has
  // an unresolvable assignee AND an unseen state should be told both, not sent round twice.
  const destination = await destinationRefusals({
    artifact,
    deps,
    fields,
    fieldsOnly: args.fieldsOnly,
    home,
    moveTeam: args.moveTeam,
    verb: args.verb,
    verified: args.mentionIds,
  });
  const refusals = [...destination.refusals, ...stepUpRefusals({ args, artifact, deps, fields, home })];
  if (refusals.length > 0) {
    return refuse({ code: EXIT_EXPECTED_EMPTY, deps, lines: refusals });
  }
  const ctx: WriteContext = {
    api: deps.makeApi({ home, token }),
    args,
    assigneeId: destination.assigneeId,
    deps,
    // Rendered from the body the mention gate just rewrote, so what is sent is what that gate approved.
    description: renderIssueBody({ artifact: destination.artifact }),
    fields,
    home,
    id,
  };
  return throughTheDoor({ ctx });
}

/**
 * The last phase: the ownership/overwrite check, the door, the write, and the report.
 *
 * Split from {@link runLive} only because the two together run past the line cap; the sequence is unchanged
 * and the boundary is where the cheap local checks end and the irreversible half begins.
 *
 * @param ctx the write context, complete once both destination gates have passed
 * @returns the process exit code
 */
async function throughTheDoor({ ctx }: { ctx: WriteContext }): Promise<number> {
  const { args, deps, fields, home, id } = ctx;
  const precheck = await updatePrecheck({ ctx });
  if (precheck.kind === "refused") {
    return refuse({ code: EXIT_EXPECTED_EMPTY, deps, lines: [precheck.reason] });
  }
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    // The home is passed EXPLICITLY. `request.meta.home` describes the action; it does not choose where the
    // door ledger is written, and omitting this argument writes the audit record to the default home while
    // the issue ledger goes to `--home`. The Slack call sites omit it, so copying them reproduces that bug.
    home,
    ledger: deps.doorLedger,
    perform: () => performWrite({ ctx }),
    request: doorRequestFor({ home, id, teamId: fields.teamId, verb: args.verb }),
  });
  if (!routed.performed) {
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      deps,
      lines: [...notPerformedLines({ command: "slopweaver linear issue", through: routed })],
    });
  }
  for (const line of outcomeLines({ outcome: routed.result, verb: args.verb })) {
    deps.out(line);
  }
  const journalled =
    args.unasked === undefined
      ? undefined
      : await journalUnasked({ before: precheck.before, ctx, note: args.unasked, outcome: routed.result });
  if (journalled !== undefined) {
    return journalled;
  }
  return codeFor({ outcome: routed.result });
}

/**
 * The step-up refusals a write owes before the door: `--unasked`'s rails (`./unasked.ts`) and whether its
 * three accounts will record at all — checked now, because a row refused after the write would leave an
 * unasked act unrecorded.
 *
 * @param args the parsed invocation
 * @param artifact the body, whose `@{key}` mentions notify a person when it is sent
 * @param deps the injectable edges, for the state catalog and the clock
 * @param fields the validated form fields
 * @param home the resolved state home
 * @returns every refusal line, empty when the write is not `--unasked` or may go out unasked
 */
function stepUpRefusals({
  args,
  artifact,
  deps,
  fields,
  home,
}: {
  args: LinearIssueArgs;
  artifact: LinearIssueArtifact;
  deps: LinearWriteDeps;
  fields: LinearIssueFields;
  home: string;
}): readonly string[] {
  if (args.unasked === undefined) {
    return [];
  }
  const note = unaskedNoteRefusal({
    doneIso: deps.nowIso(),
    kind: unaskedKind({ fieldsOnly: args.fieldsOnly, rewriteFiled: args.rewriteFiled !== undefined, verb: args.verb }),
    note: args.unasked,
  });
  return [
    ...unaskedRefusals({
      catalog: deps.stateCatalog({ home, teamId: fields.teamId }),
      fields,
      mentionKeys: args.fieldsOnly ? [] : mentionKeysOfIssue({ artifact }),
    }),
    ...(note === undefined ? [] : [note]),
  ];
}

/**
 * The above-the-fold gate on the issue's own Problem and Solution sections.
 *
 * @param args the parsed invocation, for the dry-run flag and the state home
 * @param artifact the validated issue
 * @param deps the injected environment reader and output sink
 * @returns true when the write must refuse
 */
async function aboveFoldRefused({
  args,
  artifact,
  deps,
}: {
  args: LinearIssueArgs;
  artifact: LinearIssueArtifact;
  deps: LinearWriteDeps;
}): Promise<boolean> {
  return aboveFoldGateRefused({
    surface: "linear",
    // A Linear issue's collapsible holds `aiPrompt`, which is a prompt for a model rather than prose the
    // owner writes, so the voice rules deliberately do not read it.
    belowFoldCells: [],
    cells: linearIssueAboveFoldCells({ artifact }),
    dryRun: args.dryRun,
    env: deps.env,
    home: resolveHome({ named: args.home }),
    ledger: deps.doorLedger,
    out: ({ line }) => {
      deps.out(line);
    },
  });
}

/**
 * Resolve every `#N`/`owner/repo#N`/`SUP-123` in the issue body into a real link, then refuse whatever
 * still can't resolve — the rule that a bare reference never reaches an outbound
 * surface. See `../../bareRefDoor.ts`.
 *
 * @param args the parsed invocation, for the dry-run flag and the state home
 * @param issues the residue `linkifyIssueArtifact` already computed
 * @param deps the injected environment reader and output sink
 * @param home the state home this invocation resolved, whose grant journal decides the hatch
 * @returns true when the write must refuse
 */
function bareRefRefused(gate: {
  args: LinearIssueArgs;
  issues: readonly BareRefIssue[];
  deps: LinearWriteDeps;
  home: string;
}): boolean {
  return bareRefGateRefused({
    dryRun: gate.args.dryRun,
    env: gate.deps.env,
    home: gate.home,
    issues: gate.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    out: ({ line }) => {
      gate.deps.out(line);
    },
  });
}

/**
 * The preview's assignee: `null` for a CLEAR instruction, which looks nobody up, else the unrefreshed
 * resolution's Linear id — `undefined` when the key resolved nowhere — or the roster's typed refusal.
 *
 * @param deps the injectable edges
 * @param home the resolved state home
 * @param person the form's assignee key; null clears the assignee
 * @returns the id the preview prints, or why the store could not answer
 */
async function previewAssigneeIdOf({
  deps,
  home,
  person,
}: {
  deps: LinearWriteDeps;
  home: string;
  person: string | null | undefined;
}): Promise<Result<string | null | undefined, IdentityRosterError>> {
  if (person === null) {
    return ok(null);
  }
  const resolved = await deps.previewAssignee({ home, person });
  return resolved.map((resolution) => resolution.target?.linearId);
}

/**
 * The whole dry run: the preview, then the three gates reporting UNDER what they judged.
 *
 * It stops before every effect — no token, no door record, no ledger entry, no network — and both roster
 * reads are the unrefreshed ones, because the just-in-time derive the live path performs writes silver
 * artifacts and a preview leaves no trace.
 *
 * A `null` assignee is a CLEAR instruction, so there is no key to look up and the preview carries the null
 * straight through — the same shape the live path produces for it.
 *
 * Split out of {@link runLinearIssue} so that function stays under the cognitive-complexity gate; the split
 * is along the line the code already had, since nothing here is reachable from the live path.
 *
 * @param args the parsed invocation
 * @param deps the injectable edges
 * @param form the validated form, before linkifying
 * @param home the resolved state home
 * @param id the issue id this write would use
 * @param linkified the body with its bare references already resolved, plus whatever stayed bare
 * @returns the process exit code
 */
async function runDryRun({
  args,
  deps,
  form,
  home,
  id,
  linkified,
}: {
  args: LinearIssueArgs;
  deps: LinearWriteDeps;
  form: LinearIssueForm;
  home: string;
  id: string;
  linkified: { readonly artifact: LinearIssueArtifact; readonly issues: readonly BareRefIssue[] };
}): Promise<number> {
  const previewAssigneeId = await previewAssigneeIdOf({ deps, home, person: form.fields.assignee });
  const keys = args.fieldsOnly ? [] : mentionKeysOfIssue({ artifact: linkified.artifact });
  const previewed = await deps.previewMentions({ home, keys, verified: args.mentionIds });
  // A store that cannot say who a key names has no preview to print: the live run would refuse on it too.
  if (previewAssigneeId.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [previewAssigneeId.error.message] });
  }
  if (previewed.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [previewed.error.message] });
  }
  const mentions = previewed.value;
  // `--unasked`'s rails are judged in the preview too, so a session learns a closure is refused before it
  // ever reaches for the live write.
  const previewRefusals = [
    ...issueRetiredTeamRefusals({ deps, home, moveTeam: args.moveTeam, teamId: form.fields.teamId, verb: args.verb }),
    ...linearMentionRefusals({ keys, resolution: mentions }),
    ...stepUpRefusals({ args, artifact: linkified.artifact, deps, fields: form.fields, home }),
  ];
  const lines = [
    ...dryRunLines({
      assigneeId: previewAssigneeId.value,
      fieldsOnly: args.fieldsOnly,
      form: { ...form, artifact: rewriteIssueMentions({ artifact: linkified.artifact, resolution: mentions }) },
      id,
      mentions: keys,
      moveTeam: args.moveTeam,
    }),
    ...(args.unasked === undefined ? [] : ["unasked:   journalled to the autonomy ledger after the write"]),
    ...previewRefusals,
  ];
  for (const line of lines) {
    deps.out(line);
  }
  const refused = previewRefusals.length > 0;
  const aboveFold = await aboveFoldRefused({ args, artifact: linkified.artifact, deps });
  const bareRefs = bareRefRefused({ args, deps, home, issues: linkified.issues });
  return aboveFold || bareRefs || refused ? EXIT_ERROR : EXIT_OK;
}

/**
 * Run `linear issue <create|update>`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runLinearIssue({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: LinearWriteDeps;
}): Promise<number> {
  // `linear move-issues` calls this body in-process, past `main.ts`'s own gate, so it asks here as well.
  const gated = refuseRunnerOnStandingRuling({ noun: "linear", rest: argv.slice(VERB_ARG_OFFSET), verb: "issue" });
  if (gated !== undefined) {
    return gated;
  }
  // Both halves refuse in one union, so the form is read only once the arguments stand, and either prints alike.
  const parsed = parseLinearIssueArgs({ argv: argv.slice(VERB_ARG_OFFSET) }).andThen((args) =>
    parseLinearIssueForm({ raw: deps.readForm({ source: args.formSource }) }).map((form) => ({ args, form })),
  );
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: parsed.error }) });
  }
  const { args, form } = parsed.value;
  const id = issueWriteId({ args, form });
  // Resolve every #N/owner/repo#N/SUP-123 into a real markdown link before anything renders — see
  // ../../bareRefDoor.ts.
  const home = resolveHome({ named: args.home });
  const linkified = linkifyIssueArtifact({ artifact: form.artifact, context: deps.bareRefContext({ home }) });
  if (args.dryRun) {
    return runDryRun({ args, deps, form: form, home, id, linkified });
  }
  if (await aboveFoldRefused({ args, artifact: linkified.artifact, deps })) {
    return EXIT_ERROR;
  }
  if (bareRefRefused({ args, deps, home, issues: linkified.issues })) {
    return EXIT_ERROR;
  }
  return runLive({ args, artifact: linkified.artifact, deps, fields: form.fields, id });
}

/** `slopweaver linear issue` — compose a Linear issue from a typed form and file it. */
export const linearIssueCommand = defineCommand({
  run: (argv: readonly string[]) => runLinearIssue({ argv, deps: productionLinearWriteDeps() }),
});
