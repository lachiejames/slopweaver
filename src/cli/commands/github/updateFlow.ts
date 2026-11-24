/**
 * The `update` sub-command: from raw form text or a partial edit, through the door, to a reported outcome.
 * `--pull`, the read-only mode, dispatches from here to `./updatePull.ts`.
 *
 * Split out of `run.ts` to keep that file under this repo's own line ceiling — `run.ts` calls only
 * `runUpdate`, which is exported for exactly that.
 *
 * The order is the contract, and it changed:
 *
 *   parse → token → address → identity → authorship → recover or take the whole form → merge → stamp →
 *   render + gate → re-append any third-party trailing block → settled-evidence check → replacement preview →
 *   [dry run stops here] → door → RE-READ → re-stamp → PATCH → read back → record
 *
 * The settled-evidence check and the replacement preview are `./updateConsent.ts`: the first refuses a write
 * that drops a screenshot or run link a settled ask of the owner's named this pull request for, on every mode and past
 * `SLOPWEAVER_ALLOW_PR_REPLACE`.
 *
 * The seen day is checked twice on purpose: the preview checks it against the clock before the door, and the
 * write checks it again inside the door after the re-read (`./performWrite.ts`'s `performUpdate`). No byte of the
 * description depends on the day, so a write that changes nothing renders the live bytes and stays `unchanged`.
 *
 * The re-append step is what makes a partial `--edit` survive a bot that has added to the description.
 * `recoverPrForm` splits the live body into the rendered description and an opaque trailing region; the gate
 * judges only the part slopweaver rendered, and the PATCH sends both, so nobody else's content is discarded
 * by an edit that was never about it. A `--form`/`--file` replacement is the deliberate opposite and keeps
 * discarding, behind the diff `./updateConsent.ts` prints.
 *
 * Two things about it are worth stating rather than inferring. The dry run now RESOLVES A TOKEN AND PERFORMS
 * GETS — it never PATCHes, and `create --dry-run` stays fully offline, but update's old promise of touching
 * nothing is gone. It had to be: with ledger ownership deleted there was nothing left for an offline preview
 * to say, while everything worth previewing (does the number resolve, are you the author, does the body parse,
 * what would the replacement discard) needs a read. A preview that cannot see what it is previewing is the
 * silent-failure shape this repository cares most about.
 *
 * And nothing local is mutated before the door: no reservation, no record, no temporary file. The reads are
 * reads.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { throughDoor } from "../../../admit/effects.js";
import type { GithubWriteApi, WrittenPr } from "../../../corpus/github/write.js";
import type { InstallationIdentifiers } from "../../../hygiene/installationIdentifiers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseAuthoringFile } from "../../../outbound/github/authoringFile.js";
import type { DescriptionReviewComment } from "../../../outbound/github/descriptionReviewTypes.js";
import { renderSelfReviewComments, type SelfReviewForm } from "../../../outbound/github/selfReview.js";
import type { PrForm, PrFormDraft } from "../../../outbound/github/types.js";
import { printedAboveFoldRefusals } from "../../aboveFoldDoor.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { aboveFoldVerdictOrReported } from "./aboveFoldGate.js";
import { liveLocusFor, ownerRepoOf, resolveAndAuthorise } from "./addressRun.js";
import { linkifiedPrFormOrReported } from "./bareRefFlow.js";
import { doorRequestFor, type GithubPrArgs } from "./core.js";
import { githubVerbErrorLines } from "./errors.js";
import { performUpdate } from "./performWrite.js";
import type { GithubPrDeps } from "./prDeps.js";
import { parsePrEdit, parsePrForm } from "./prFormParse.js";
import type { RenderedBody } from "./prRenderGate.js";
import { report } from "./runReport.js";
import { postSelfReview, previewSelfReview, resolveSelfReview } from "./selfReviewFlow.js";
import { chooseUpdate, type UpdateDescriptionInput } from "./updateChoice.js";
import { consentStops } from "./updateConsent.js";
import { printUpdateDryRun } from "./updateDryRun.js";
import { gatedPreview } from "./updatePreview.js";
import { runPull } from "./updatePull.js";

/** Everything update decodes before resolving a token. */
interface PreparedUpdate {
  readonly input: UpdateDescriptionInput | undefined;
  readonly selfReview: SelfReviewForm | undefined;
}

/** Decode `--file` into a whole-replacement input, carrying its pulled-body digest when it has one. */
function prepareUpdateFromFile({
  fileSource,
  deps,
}: {
  fileSource: string;
  deps: GithubPrDeps;
}): Result<UpdateDescriptionInput, void> {
  const parsed = parseAuthoringFile({ source: deps.readFileSource({ source: fileSource }) });
  if (parsed.isErr()) {
    for (const line of parsed.error) {
      deps.out({ line });
    }
    return err(undefined);
  }
  const { form, pulledBodyHash } = parsed.value;
  return ok({
    form,
    fromFile: true,
    kind: "form",
    ...(pulledBodyHash === undefined ? {} : { pulledBodyHash }),
  });
}

/** Decode an optional description change and walkthrough before any provider read, or the exit code once refused. */
function prepareUpdate({
  args,
  deps,
  home,
}: {
  args: GithubPrArgs;
  deps: GithubPrDeps;
  home: string;
}): Result<PreparedUpdate, number> {
  const selfReview = resolveSelfReview({ args, deps, home });
  if (selfReview.isErr()) {
    return err(selfReview.error);
  }
  if (args.fileSource !== undefined) {
    const fromFile = prepareUpdateFromFile({ deps, fileSource: args.fileSource });
    return fromFile.isOk() ? ok({ input: fromFile.value, selfReview: selfReview.value }) : err(EXIT_USAGE);
  }
  // The one description input given: `checkUpdateInputMode` refuses `--form` and `--edit` together, so at most
  // one of these is set and neither is a fallback for the other.
  const source = [args.formSource, args.editSource].find((given) => given !== undefined);
  if (source === undefined) {
    return ok({ input: undefined, selfReview: selfReview.value });
  }
  const raw = deps.readForm({ source });
  const input =
    args.formSource === undefined
      ? parsePrEdit({ raw }).map((edit): UpdateDescriptionInput => ({ edit, kind: "edit" }))
      : parsePrForm({ raw }).map((form): UpdateDescriptionInput => ({ form, kind: "form" }));
  if (input.isErr()) {
    for (const line of githubVerbErrorLines({ error: input.error })) {
      deps.out({ line });
    }
    return err(EXIT_USAGE);
  }
  return ok({ input: input.value, selfReview: selfReview.value });
}

/** Complete an update whose only requested effect is a self-review round. */
async function runReviewOnlyUpdate({
  api,
  args,
  deps,
  form,
  home,
  live,
}: {
  api: GithubWriteApi;
  args: GithubPrArgs;
  deps: GithubPrDeps;
  form: SelfReviewForm | undefined;
  home: string;
  live: WrittenPr;
}): Promise<number> {
  if (form === undefined) {
    deps.out({ line: "refused: update has no description edit or self-review form" });
    return EXIT_USAGE;
  }
  if (args.dryRun) {
    previewSelfReview({ deps, form, number: live.number });
    deps.out({ line: "dry run: the pull request was READ; no door record and no review was posted." });
    return EXIT_OK;
  }
  const { owner, repo } = ownerRepoOf({ fullName: live.baseRepoFullName });
  return postSelfReview({ api, deps, expectHead: args.expectHead, form, home, number: live.number, owner, repo });
}

/** Apply and send a description change, then post its optional replacement walkthrough. */
async function runDescriptionUpdate({
  api,
  args,
  deps,
  home,
  input,
  live,
  selfReview,
}: {
  api: GithubWriteApi;
  args: GithubPrArgs;
  deps: GithubPrDeps;
  home: string;
  input: UpdateDescriptionInput;
  live: WrittenPr;
  selfReview: SelfReviewForm | undefined;
}): Promise<number> {
  const chosen = chooseUpdate({ home, input, live });
  if ("reason" in chosen) {
    deps.out({ line: `refused: ${chosen.reason}` });
    return EXIT_ERROR;
  }
  for (const notice of chosen.notices) {
    deps.out({ line: notice });
  }
  // Resolve every bare PR number, owner/repo#N and issue key into a real link before anything renders, then refuse
  // whatever still can't resolve — see ./bareRefFlow.ts.
  const draft = linkifiedPrFormOrReported({ deps, form: chosen.draft, home, knownNumber: live.number });
  if (draft === undefined) {
    return EXIT_ERROR;
  }
  const gated = await gatedPreview({ chosen, deps, draft, home, live });
  if (gated === undefined) {
    return EXIT_ERROR;
  }
  const { installationIdentifiers, preview } = gated;
  const exitCode = await sendUpdate({
    api,
    args,
    body: preview.body,
    deps,
    form: preview.form,
    home,
    live,
    rendered: preview.rendered,
    write: {
      comments: renderSelfReviewComments({ form: selfReview }),
      draft,
      installationIdentifiers,
      trailing: chosen.trailing,
    },
    wholesale: chosen.wholesale,
  });
  if (exitCode !== EXIT_OK || selfReview === undefined) {
    return exitCode;
  }
  return runSelfReviewRound({ api, args, deps, form: selfReview, home, live });
}

/** The optional self-review that follows a description change that already succeeded. */
async function runSelfReviewRound({
  api,
  args,
  deps,
  form,
  home,
  live,
}: {
  api: GithubWriteApi;
  args: GithubPrArgs;
  deps: GithubPrDeps;
  form: SelfReviewForm;
  home: string;
  live: WrittenPr;
}): Promise<number> {
  if (args.dryRun) {
    previewSelfReview({ deps, form, number: live.number });
    return EXIT_OK;
  }
  const { owner, repo } = ownerRepoOf({ fullName: live.baseRepoFullName });
  return postSelfReview({ api, deps, expectHead: args.expectHead, form, home, number: live.number, owner, repo });
}

/**
 * The update sub-command.
 *
 * @param args the parsed CLI arguments
 * @param deps the injectable edges
 * @param home the state home
 * @returns the process exit code
 */
export async function runUpdate({
  args,
  deps,
  home,
}: {
  args: GithubPrArgs;
  deps: GithubPrDeps;
  home: string;
}): Promise<number> {
  if (args.pull) {
    return runPull({ args, deps, home });
  }
  const prepared = prepareUpdate({ args, deps, home });
  if (!prepared.isOk()) {
    return prepared.error;
  }
  const token = deps.token({ home });
  if (token === undefined) {
    deps.out({ line: "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)" });
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });
  const { input, selfReview } = prepared.value;
  const admitted = await resolveAndAuthorise({
    address: args.address!,
    api,
    deps,
    expectHead: args.expectHead,
    home,
    selfReviewRequested: selfReview !== undefined,
  });
  if ("reason" in admitted) {
    deps.out({ line: `refused: ${admitted.reason}` });
    return EXIT_ERROR;
  }
  if (input === undefined) {
    return runReviewOnlyUpdate({ api, args, deps, form: selfReview, home, live: admitted.live });
  }
  return runDescriptionUpdate({ api, args, deps, home, input, live: admitted.live, selfReview });
}

/** What the door re-stamps and sends once it has re-read the description. */
interface UpdateWrite {
  /** The walkthrough posted after the PATCH, exactly as GitHub receives it; `[]` when none is. */
  readonly comments: readonly DescriptionReviewComment[];
  readonly draft: PrFormDraft;
  readonly installationIdentifiers: InstallationIdentifiers | undefined;
  readonly trailing: string;
}

/**
 * The consent steps, the dry-run stop, and the write. The consent steps — settled evidence, then a wholesale
 * replacement's diff and key — are `./updateConsent.ts`.
 *
 * The above-the-fold verdict is read first, and only a corrupt profile stops there: its findings are judged
 * after the replacement preview, on both paths.
 */
async function sendUpdate({
  api,
  args,
  deps,
  home,
  live,
  form,
  body,
  rendered,
  write,
  wholesale,
}: {
  api: GithubWriteApi;
  args: GithubPrArgs;
  deps: GithubPrDeps;
  home: string;
  live: WrittenPr;
  /** The form as previewed, stamped against the body read before the door. */
  form: PrForm;
  body: string;
  rendered: RenderedBody;
  write: UpdateWrite;
  wholesale: boolean;
}): Promise<number> {
  const aboveFold = await aboveFoldVerdictOrReported({
    env: deps.env,
    form,
    home,
    ledger: deps.doorLedger,
    out: deps.out,
    refuseFindings: false,
  });
  if (aboveFold === undefined) {
    return EXIT_ERROR;
  }
  const locus = liveLocusFor({ pr: live });
  if (consentStops({ args, body, deps, form, home, live, wholesale })) {
    return EXIT_ERROR;
  }
  if (args.dryRun) {
    return printUpdateDryRun({ aboveFold, body, deps, form, live, locus, rendered });
  }
  if (await printedAboveFoldRefusals({ home, ledger: deps.doorLedger, out: deps.out, verdict: aboveFold })) {
    return EXIT_ERROR;
  }
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => performUpdate({ api, deps, home, locus, previewed: live, ...write }),
    request: doorRequestFor({ home, locus, verb: "update" }),
  });
  return report({ deps, routed });
}
