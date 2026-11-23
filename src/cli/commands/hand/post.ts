/**
 * `slopweaver hand post` — record ONE step only the owner's hands can take, and put it in front of them.
 *
 * Posting and SHOWING are one act on purpose. A register the owner has to go and read is the fourth board — the owner has
 * built three and abandoned all of them, and what the owner reads is what ARRIVES. So the note goes up unless the
 * caller says `--quiet`, and a machine that cannot draw one still records the step and says where it is.
 *
 * Every rule lives in `../../../hand/step.ts` (what the register re-checks on read) and `../../../hand/posting.ts`
 * (the posting form), and the monitor lane calls the same two — so a writer that is not this CLI cannot skip one.
 * The one rule about WHO posts is this verb's alone, `../../../hand/seatPost.ts`: only the pinned supervisor does.
 * Everything after the step is built — admission, append, re-cut, raise, receipt — is `./applyPost.ts`, which
 * `incident note` posts through as well.
 */
import { githubToken } from "../../../config.js";
import { type HandStepError, HandStepErrors } from "../../../hand/errors.js";
import { onPostmortemRow } from "../../../hand/proofAddress.js";
import { buildHandStep, type HandStep } from "../../../hand/step.js";
import { isTerminalDocStatus } from "../../../handover/doc.js";
import { READ_OWNER_WORDS_FLAG } from "../../../handover/laterOwnerWords.js";
import { rowOwnerWordsBeforeReaskRefusal } from "../../../handover/ownerWordsBeforeReaskRead.js";
import { readDerivedRowState } from "../../../handover/rowState.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR } from "../../exitCodes.js";

import { handAdmissionExit, handSeatRefused, recordHandStep } from "./applyPost.js";
import { VERB_ARG_OFFSET } from "./core.js";
import { flag, type HandDeps, productionHandDeps, resolvedHomeOf } from "./deps.js";
import { handPostDraft, handPostInputs } from "./postInputs.js";
import { lookedAtUrl, lookPicture, unmergedCheckInExit } from "./postLook.js";
import { shotDraftOf } from "./postPicture.js";
import { readRowPullRequests } from "./rowPullRequestsRead.js";

/**
 * A named row checked against the board it will be read from: on it, readable whole, and not already finished.
 *
 * At POSTING, because a row evidence can never read is a card that can never leave — a typo in `--row` would
 * otherwise sit on the owner's queue for good. Asked under the register lock, and only by a write
 * that opens a new card: an exact retry, or the settling a cut-short re-cut owes, opens none and so is not refused
 * by a row that went missing or finished since the first attempt. The board read is the home's own
 * `handovers/`, the one the reconcile reads; a board kept under `handover --dir` is not one a card can name.
 *
 * @param row the slug `--row` named
 * @param home the state home
 * @returns nothing when the row may be named, or why not
 */
export function namedRowRefusal({ row, home }: { row: string; home: string }): string | undefined {
  const paths = stateHomePaths({ home });
  const read = readDerivedRowState({ handoverDir: paths.handovers, runsDir: paths.runs, slug: row });
  if (read.isErr()) {
    return `--row ${row}: ${read.error.message} under ${paths.handovers} — a card naming it could never leave on evidence`;
  }
  if (isTerminalDocStatus(read.value.status)) {
    return `--row ${row}: that row is already ${read.value.status}, so there is nothing left for this step to unblock`;
  }
  return undefined;
}

/**
 * The refusal for a step on a `postmortem-` row, which only `incident postmortem` posts: its card names a parked reply
 * that verb reads against the form — held, as the owner, in the incident's own channel, tagging the facilitator, raised by
 * the row — and nothing here can, so a card posted from here could put a reply to the wrong room behind the owner's yes.
 * A hold, with no override: the verb that checks it is the way through.
 *
 * @param step the built step
 * @returns the refusal, or `undefined` when the step names no postmortem row
 */
export function postmortemRowRefusal({ step }: { step: HandStep }): HandStepError | undefined {
  if (!onPostmortemRow({ step })) {
    return undefined;
  }
  return HandStepErrors.invalidField({
    field: "row",
    why:
      `${String(step.row)} is a postmortem row, whose card only \`slopweaver incident postmortem --form <file>\` posts — ` +
      "it checks the parked reply against the form and this verb cannot. There is no override",
  });
}

/**
 * The call anchors the seat named in `--read-owner-words`, trimmed, empties dropped; none when it named nothing.
 *
 * @param values every parsed flag
 * @returns the named references
 */
export function readOwnerWordsOfPost({ values }: { values: Readonly<Record<string, unknown>> }): readonly string[] {
  const raw = flag({ name: READ_OWNER_WORDS_FLAG, values });
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * The owner-words check as the register's row admission, judged under its lock: the refusal joined into the one
 * reason the admission carries, or `undefined` when the row may be named.
 *
 * @param acknowledged the call anchors the seat named in `--read-owner-words`
 * @param home the state home
 * @param row the slug the step names
 * @returns why the card may not open, or `undefined`
 */
export function ownerWordsAdmission({
  acknowledged,
  home,
  row,
}: {
  acknowledged: readonly string[];
  home: string;
  row: string;
}): string | undefined {
  const lines = rowOwnerWordsBeforeReaskRefusal({
    acknowledged,
    command: "slopweaver hand post",
    home,
    runsDir: stateHomePaths({ home }).runs,
    slug: row,
  });
  return lines === undefined ? undefined : lines.join("\n");
}

/**
 * The row admission `recordHandStep` asks under the register lock: the named-row refusal, then the owner-words check
 * asked again, since the look can hold a browser open for seconds and words the owner says meanwhile must refuse the
 * card too. A word appended after this read is the residue a lock on one register cannot close, since the call file
 * is written under its own.
 */
function rowAdmissionOf({
  acknowledged,
  home,
}: {
  acknowledged: readonly string[];
  home: string;
}): (admitted: { row: string }) => string | undefined {
  return ({ row }) => {
    const named = namedRowRefusal({ home, row });
    if (named !== undefined) {
      return named;
    }
    return ownerWordsAdmission({ acknowledged, home, row });
  };
}

/**
 * The exit for a step naming a row whose run waits on the owner over a held question the owner has since spoken over
 * unread (`../../../handover/ownerWordsBeforeReask.ts`), or `undefined` when it may go on.
 */
function ownerWordsExit({
  acknowledged,
  deps,
  home,
  step,
}: {
  acknowledged: readonly string[];
  deps: HandDeps;
  home: string;
  step: HandStep;
}): number | undefined {
  if (step.row === undefined) {
    return undefined;
  }
  const lines = rowOwnerWordsBeforeReaskRefusal({
    acknowledged,
    command: "slopweaver hand post",
    home,
    runsDir: stateHomePaths({ home }).runs,
    slug: step.row,
  });
  if (lines === undefined) {
    return undefined;
  }
  for (const line of lines) {
    deps.writeDiagnostic(line);
  }
  return EXIT_ERROR;
}

/**
 * The exit for a built step refused before its page is looked at — a postmortem row, the admission, the owner's
 * unread words over the row's held question, then a check-in on a row that has not shipped — or `undefined` when it
 * may go on to the look.
 */
function refusedBeforeLook({
  acknowledged,
  deps,
  home,
  step,
}: {
  acknowledged: readonly string[];
  deps: HandDeps;
  home: string;
  step: HandStep;
}): number | undefined {
  const composedElsewhere = postmortemRowRefusal({ step });
  if (composedElsewhere !== undefined) {
    deps.writeDiagnostic(`hand post: ${composedElsewhere.message}`);
    return EXIT_ERROR;
  }
  const admitted = handAdmissionExit({ deps, home, step });
  if (admitted !== undefined) {
    return admitted;
  }
  const unread = ownerWordsExit({ acknowledged, deps, home, step });
  if (unread !== undefined) {
    return unread;
  }
  // What the note SHOWS, judged after every rule on its words, so a step refused for those never reaches GitHub or
  // the owner's browser: a check-in on a row that has not shipped, then a link whose page shows nothing.
  return unmergedCheckInExit({ deps, env: process.env, step });
}

/**
 * Run `hand post` against injected seams.
 *
 * @param rest the argv tail after `hand post`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runHandPost({ rest, deps }: { rest: readonly string[]; deps: HandDeps }): Promise<number> {
  const inputs = handPostInputs({ deps, rest });
  if (inputs.isErr()) {
    return inputs.error;
  }
  const { fields, shot, url, values } = inputs.value;
  const home = resolvedHomeOf({ values });
  if (handSeatRefused({ command: "slopweaver hand post", deps, home })) {
    return EXIT_ERROR;
  }
  const picture = shotDraftOf({ shot });
  if (picture.isErr()) {
    deps.writeDiagnostic(`hand post: ${picture.error.message}`);
    return EXIT_ERROR;
  }
  const nowIso = deps.now();
  const built = buildHandStep({ draft: handPostDraft({ fields, nowIso, shot: picture.value?.draft, url, values }) });
  if (built.isErr()) {
    deps.writeDiagnostic(`hand post: ${built.error.message}`);
    return EXIT_ERROR;
  }
  const acknowledged = readOwnerWordsOfPost({ values });
  const refused = refusedBeforeLook({ acknowledged, deps, home, step: built.value });
  if (refused !== undefined) {
    return refused;
  }
  const looked = await lookedAtUrl({ deps, env: process.env, home, step: built.value });
  if ("exit" in looked) {
    return looked.exit;
  }
  let step = built.value;
  let read = picture.value?.read;
  // A step posted with its own `--shot` keeps it; otherwise the card carries the page as the look saw it.
  const seen = picture.value === undefined ? lookPicture({ home, id: step.id, taken: looked.picture }) : undefined;
  if (seen !== undefined) {
    const pictured = buildHandStep({ draft: handPostDraft({ fields, nowIso, shot: seen.shot, url, values }) });
    if (pictured.isErr()) {
      deps.writeDiagnostic(`hand post: ${pictured.error.message}`);
      return EXIT_ERROR;
    }
    step = pictured.value;
    read = seen.read;
  }
  return recordHandStep({
    admitRow: rowAdmissionOf({ acknowledged, home }),
    deps,
    home,
    json: values["json"] === true,
    nowIso,
    quiet: values["quiet"] === true,
    read,
    step,
    supersedes: flag({ name: "supersedes", values }),
  });
}

/**
 * The `--row` a `--check-in` names, when the argv carries both — the one post whose row's pull requests are read.
 *
 * @param rest the argv tail after `hand post`
 * @returns the slug, or `undefined` when the post is no check-in naming a row
 */
export function checkInRowOf({ rest }: { rest: readonly string[] }): string | undefined {
  const at = rest.indexOf("--row");
  const row = at === -1 ? undefined : rest[at + 1];
  if (!rest.includes("--check-in") || row === undefined || row.startsWith("--")) {
    return undefined;
  }
  return row;
}

/** `slopweaver hand post`. */
export const handPostCommand = defineCommand({
  run: async (argv) => {
    const rest = argv.slice(VERB_ARG_OFFSET);
    const deps = productionHandDeps();
    const row = checkInRowOf({ rest });
    if (row === undefined) {
      return runHandPost({ deps, rest });
    }
    // The verb reads a row's pull requests through a synchronous seam, so the one GitHub read it needs is taken
    // here and handed in.
    const home = resolvedHomeOf({ values: { home: flagAfter({ name: "--home", rest }) } });
    const answer = await readRowPullRequests({
      graphql: githubReadGraphql({ token: githubToken({ home }) }),
      home,
      row,
    });
    return runHandPost({ deps: { ...deps, rowPullRequests: () => answer }, rest });
  },
});

/** The value after a flag in an argv tail, or `undefined` when the flag is absent or has none. */
function flagAfter({ name, rest }: { name: string; rest: readonly string[] }): string | undefined {
  const at = rest.indexOf(name);
  const value = at === -1 ? undefined : rest[at + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}
