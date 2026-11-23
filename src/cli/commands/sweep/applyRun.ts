/**
 * `slopweaver sweep apply` — perform ONE row's act, through the register's OWN verb, and journal it.
 *
 * ## The act is a register verb, not an edit
 *
 * Derive the state, delete the second copy: a row's state is derived from
 * its journal, and **nothing in this repository writes a `status:` line** — so a sweep that edited front
 * matter would have minted the second copy the board spent a release deleting, and the edit would have
 * changed nothing any reader consults. `close` and `settle` are what this verb runs, in process, with their
 * own refusals kept as refusals: a second close, or a settle on a row that is not an ask, comes back as
 * `REGISTER_VERB_REFUSED` and the row is untouched. That is `../../../worktree/pruneApply.ts`'s shape.
 *
 * ## One row at a time, and it is not timidity
 *
 * A wrong verdict applied to one row is a correction; applied to a cohort it is an incident. There is
 * deliberately no `--all`, and adding one later would be the change that quietly removes this property.
 *
 * ## The order of operations
 *
 * The register verb runs FIRST and the sweep ledger row is written after it succeeds, because the ledger's
 * job is to record what the sweep DID. A ledger row for an act the register refused would be the one entry a
 * later reader could not check.
 *
 * That order leaves exactly one window — the verb succeeded and the append did not — and it is why the
 * failure path PRINTS the row rather than only the ledger's error. The act has already landed on the board
 * there, so the unwritten row is the only surviving record of what was taken and on what evidence.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";
import type { FetchPrClosure } from "../../../live/github/prClosure.js";
import { endedQuestionPrecondition } from "../../../review/closureRowState.js";
import type { SweepAct, SweepCandidate, SweepVerdict } from "../../../sweep/classify.js";
import {
  type DeclineAuthorityFlag,
  type DeclineAuthorityInapplicableError,
  type DeclineAuthorityRequiredError,
  SweepErrors,
} from "../../../sweep/errors.js";
import { actId, type SweepJournalRow } from "../../../sweep/journalRow.js";
import { appendSweepRow, sweepLedgerPath } from "../../../sweep/journalStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { runHandoverClose } from "../handover/closeRun.js";
import { runHandoverSettle, settleAskRow } from "../handover/settleRowRun.js";

import { APPLY_USAGE, flag, parseSweepApplyArgs, VERB_ARG_OFFSET } from "./core.js";
import { productionFetchPrClosure } from "./endedRead.js";
import { type RegisterVerbCall, registerVerbArgv } from "./registerVerbCall.js";
import { sweepCandidates } from "./sweepRead.js";

/** Everything `sweep apply` touches outside itself, injected so a test drives the whole verb. */
export interface SweepApplyDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /**
   * Runs one register verb's argv and answers its exit code. `candidate` is the row the act was chosen on, so a
   * `PR_ENDED` settle can be re-judged at the write against the question it was judged on.
   */
  readonly runRegisterVerb: (args: { argv: readonly string[]; candidate: SweepCandidate }) => Promise<number>;
  /** The pull-request closure read `PR_ENDED` is re-derived with, over the home's GitHub token. */
  readonly prClosure: (args: { home: string }) => FetchPrClosure;
  readonly nowIso: () => string;
}

/**
 * A supplied flag value with its surrounding whitespace trimmed, or nothing when it is absent or blank.
 *
 * @param value the raw flag value
 * @returns the trimmed value, or undefined
 */
function supplied({ value }: { value: string | undefined }): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

/** The only verdicts each act may perform: the classifier's own pairing, held again where the act is built. */
const VERDICTS_BY_ACT: Readonly<Record<Exclude<SweepAct, "none">, readonly SweepVerdict[]>> = {
  close: ["SHIPPED"],
  settle: ["ORPHANED", "SUPERSEDED", "PR_ENDED"],
};

/**
 * The `settle --as declined` call a decline routes to, or the refusal naming which of the owner's two values is missing.
 *
 * @param candidate the classified row
 * @param reason the owner's words, trimmed
 * @param anchor where they were given, trimmed
 * @param where the `--home` / `--dir` arguments the verb reads
 * @returns the verb call, or the refusal
 */
function declineCall({
  candidate,
  reason,
  anchor,
  where,
}: {
  candidate: SweepCandidate;
  reason: string | undefined;
  anchor: string | undefined;
  where: readonly string[];
}): Result<RegisterVerbCall, DeclineAuthorityRequiredError> {
  if (reason === undefined || anchor === undefined) {
    const missing: DeclineAuthorityFlag[] = [];
    if (reason === undefined) {
      missing.push("--reason");
    }
    if (anchor === undefined) {
      missing.push("--anchor");
    }
    return err(SweepErrors.declineAuthorityRequired({ missing, slug: candidate.slug, verdict: candidate.verdict }));
  }
  return ok(
    registerVerbArgv({
      rest: [candidate.slug, "--as", "declined", "--witness", anchor, "--reason", reason, ...where],
      verb: "settle",
    }),
  );
}

/**
 * The register verb one candidate's act routes to, with the arguments its verdict justifies.
 *
 * `settle --as declined` is the terminal for a row that can never run or has been replaced: `declined` is the
 * settlement that derives `rejected` rather than `done`, and conflating the two would count work talked away
 * beside work actioned — the distinction `derived-row-state.md` names first.
 *
 * **A decline is the owner's alone** (`../../../handover/rowKind.ts` `declineNeedsAnchor`), so the settle carries
 * THEIR words as `--reason` and the anchor to where they gave them as `--witness`. The candidate's own witness is the
 * classifier's evidence that the row cannot earn its keep — it names a dead dependency or a declaring row, never
 * where they declined — so it stays the sweep ledger's witness and is never passed off as theirs. Without both values
 * this answers an error rather than a call, so no caller can build a decline the real settle plan would refuse,
 * or one that puts words in their mouth.
 *
 * @param candidate the classified row
 * @param home the state home the verb should read
 * @param dir an explicit handovers directory, when the caller named one
 * @param declineReason the owner's words for a decline, as `--reason` supplied them
 * @param declineAnchor where they gave them, as `--anchor` supplied it
 * @returns the verb call, nothing when the verdict carries no act, or the refusal naming the missing authority
 */
export function actCall({
  candidate,
  home,
  dir,
  declineReason,
  declineAnchor,
}: {
  candidate: SweepCandidate;
  home: string;
  dir: string | undefined;
  declineReason: string | undefined;
  declineAnchor: string | undefined;
}): Result<RegisterVerbCall | undefined, DeclineAuthorityRequiredError | DeclineAuthorityInapplicableError> {
  // A verdict with no act is refused as unactable by the caller, whatever flags came with it. So is an act its
  // verdict does not carry: `SweepCandidate` types the two independently, so an OVERTAKEN row built with
  // `act: "settle"` would otherwise reach a real decline.
  if (candidate.act === "none" || !VERDICTS_BY_ACT[candidate.act].includes(candidate.verdict)) {
    return ok(undefined);
  }
  const where: readonly string[] = dir === undefined ? ["--home", home] : ["--home", home, "--dir", dir];
  const reason = supplied({ value: declineReason });
  const anchor = supplied({ value: declineAnchor });
  // GitHub's own record answered the ask, so it settles `answered` on that witness and carries none of the owner's words.
  if (candidate.verdict === "PR_ENDED") {
    if (reason !== undefined || anchor !== undefined) {
      return err(SweepErrors.declineAuthorityInapplicable({ slug: candidate.slug, verdict: candidate.verdict }));
    }
    return ok(
      registerVerbArgv({
        rest: [candidate.slug, "--as", "answered", "--witness", candidate.witness, ...where],
        verb: "settle",
      }),
    );
  }
  if (candidate.act === "settle") {
    return declineCall({ anchor, candidate, reason, where });
  }
  if (reason !== undefined || anchor !== undefined) {
    return err(SweepErrors.declineAuthorityInapplicable({ slug: candidate.slug, verdict: candidate.verdict }));
  }
  return ok(registerVerbArgv({ rest: [candidate.slug, "--summary", candidate.witness, ...where], verb: "close" }));
}

/**
 * Run `sweep apply` against injected seams.
 *
 * @param rest the argv tail after `sweep apply`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runSweepApply({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SweepApplyDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(APPLY_USAGE);
    return EXIT_OK;
  }
  const parsed = parseSweepApplyArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(APPLY_USAGE);
    return EXIT_USAGE;
  }
  const slug = parsed.value.positionals[0];
  const values = parsed.value.values;
  const session = flag({ name: "session", values });
  if (slug === undefined || session === undefined) {
    deps.writeDiagnostic("sweep apply: a row slug and --session are both required");
    deps.writeDiagnostic(APPLY_USAGE);
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: flag({ name: "home", values }) });
  const resolved = await resolveAct({ deps, home, slug, values });
  if (resolved.isErr()) {
    return resolved.error;
  }
  const named = flag({ name: "now", values });
  let atIso = deps.nowIso();
  if (named !== undefined) {
    atIso = named;
  }
  return perform({
    atIso,
    call: resolved.value.call,
    candidate: resolved.value.candidate,
    deps,
    json: values["json"] === true,
    ledger: sweepLedgerPath({ home }),
    session,
    why: flag({ name: "why", values }),
  });
}

/**
 * Find the named row among the sweep's candidates and route it to its register verb, printing why when it cannot.
 *
 * @param slug the row the operator named
 * @param home the state home the sweep reads
 * @param values the parsed flags
 * @param deps the injected seams, for the diagnostic channel
 * @returns the candidate and its verb call, or the exit code the refusal already printed for
 */
async function resolveAct({
  slug,
  home,
  values,
  deps,
}: {
  slug: string;
  home: string;
  values: Readonly<Record<string, unknown>>;
  deps: SweepApplyDeps;
}): Promise<Result<{ readonly candidate: SweepCandidate; readonly call: RegisterVerbCall }, number>> {
  const dir = flag({ name: "dir", values });
  const swept = await sweepCandidates({
    dir,
    fetch: deps.prClosure({ home }),
    home,
    writeDiagnostic: deps.writeDiagnostic,
  });
  if (swept.isErr()) {
    deps.writeDiagnostic(`sweep apply: ${swept.error.message}`);
    return err(EXIT_ERROR);
  }
  const candidate = swept.value.find((row) => row.slug === slug);
  if (candidate === undefined) {
    deps.writeDiagnostic(`sweep apply: ${SweepErrors.unknownCandidate({ slug }).message}`);
    return err(EXIT_ERROR);
  }
  const routed = actCall({
    candidate,
    declineAnchor: flag({ name: "anchor", values }),
    declineReason: flag({ name: "reason", values }),
    dir,
    home,
  });
  if (routed.isErr()) {
    deps.writeDiagnostic(`sweep apply: ${routed.error.message}`);
    return err(EXIT_USAGE);
  }
  const call = routed.value;
  if (call === undefined) {
    deps.writeDiagnostic(`sweep apply: ${SweepErrors.unactableVerdict({ slug, verdict: candidate.verdict }).message}`);
    return err(EXIT_ERROR);
  }
  return ok({ call, candidate });
}

/**
 * Run the register verb, then journal what it did.
 *
 * @param candidate the classified row
 * @param call the register verb to run, and the line to record
 * @param session which session is acting
 * @param why anything the witness does not say
 * @param atIso the act's instant
 * @param ledger the sweep ledger path
 * @param json whether to emit the receipt as one object
 * @param deps the injected seams
 * @returns the process exit code
 */
async function perform({
  candidate,
  call,
  session,
  why,
  atIso,
  ledger,
  json,
  deps,
}: {
  candidate: SweepCandidate;
  call: { readonly argv: readonly string[]; readonly line: string };
  session: string;
  why: string | undefined;
  atIso: string;
  ledger: string;
  json: boolean;
  deps: SweepApplyDeps;
}): Promise<number> {
  const exitCode = await deps.runRegisterVerb({ argv: call.argv, candidate });
  if (exitCode !== EXIT_OK) {
    deps.writeDiagnostic(
      `sweep apply: ${SweepErrors.registerVerbRefused({ exitCode, slug: candidate.slug, verbLine: call.line }).message}`,
    );
    return EXIT_ERROR;
  }
  const row: SweepJournalRow = {
    act: candidate.act,
    atIso,
    id: actId({ atIso, slug: candidate.slug }),
    path: candidate.path,
    session,
    slug: candidate.slug,
    verbLine: call.line,
    verdict: candidate.verdict,
    witness: witnessWith({ candidate, why }),
  };
  const journalled = appendSweepRow({ path: ledger, row });
  if (journalled.isErr()) {
    // The one moment the rail fails is the one moment the row's contents matter most: the register verb has
    // already run, so the board row is mutated, and this is the only place the act's id, witness and verb
    // line still exist. Printing the row leaves the operator able to re-record it by hand; discarding it
    // makes the act the sweep took unfindable, which is the property the ledger exists to hold.
    deps.writeDiagnostic(`sweep apply: the register verb ran, but ${journalled.error.message}`);
    deps.writeDiagnostic("sweep apply: the act happened and is NOT in the ledger — this row is the only record:");
    deps.writeDiagnostic(safeJsonStringify({ label: "an unjournalled sweep act", value: row }));
    return EXIT_ERROR;
  }
  if (json) {
    deps.writeOut(safeJsonStringify({ label: "a sweep receipt", value: row }));
    return EXIT_OK;
  }
  deps.writeOut(`sweep apply: ${candidate.slug} ${candidate.verdict} — ${candidate.act}, recorded as ${row.id}`);
  deps.writeOut(`  witness: ${row.witness}`);
  deps.writeOut(`  find it: slopweaver sweep list --slug ${candidate.slug}`);
  return EXIT_OK;
}

/**
 * The witness as the ledger records it, with the caller's reason appended when there is one.
 *
 * @param candidate the classified row
 * @param why anything the computed witness does not already say
 * @returns the recorded witness
 */
function witnessWith({ candidate, why }: { candidate: SweepCandidate; why: string | undefined }): string {
  if (why === undefined) {
    return candidate.witness;
  }
  return `${candidate.witness} — ${why}`;
}

/**
 * The real seams: the output channels, the register verbs and the clock.
 *
 * @returns the production dependencies for {@link runSweepApply}
 */
export function productionSweepApplyDeps(): SweepApplyDeps {
  return {
    nowIso: () => new Date().toISOString(),
    prClosure: productionFetchPrClosure,
    runRegisterVerb: async ({ argv, candidate }) => {
      const verb = argv[3];
      if (verb === "close") {
        return runHandoverClose(argv);
      }
      if (candidate.verdict === "PR_ENDED") {
        if (candidate.question === undefined) {
          logger.error({ msg: `sweep apply: ${candidate.slug} is PR_ENDED with no judged question — left` });
          return EXIT_ERROR;
        }
        // Re-judged over the bytes the settle splices: the question it was judged on, then nobody on the row.
        return settleAskRow({
          argv,
          out: logger.out,
          precondition: endedQuestionPrecondition({ question: candidate.question }),
        });
      }
      return runHandoverSettle(argv);
    },
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver sweep apply`. */
export const sweepApplyCommand = defineCommand({
  run: (argv) => runSweepApply({ deps: productionSweepApplyDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
