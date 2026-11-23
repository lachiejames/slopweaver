/**
 * `slopweaver incident postmortem` — the ONE Queue card asking whether to send the reply that gets them into a resolved
 * incident's postmortem, composed from a form and posted through the very sequence `hand post` runs
 * (`../hand/applyPost.ts`), so it meets every posting rule with the same words.
 *
 * What it adds over `hand post` is the check a flag cannot carry: the parked reply the card names is read off the
 * draft register and has to be THIS card's ask — held, in their voice, in the incident channel, tagging whoever runs the
 * postmortem, raised by the card's row (`../../../incident/postmortem.ts`'s `askDraftMisplaced`). That channel has to be
 * the referenced incident's own, as the org-health snapshot keeps incident.io's announcement
 * (`../../../incident/postmortemChannel.ts`). And the revision: a second card for the same channel supersedes the open
 * one.
 *
 * `--dry-run` admits against their real home and then records and draws from a throwaway register, exactly as
 * `incident note --dry-run` does (`./cardPost.ts`).
 */
import { readFileSync } from "node:fs";

import { holdSlackDraftLock, readSlackDraftLinesOrError } from "../../../admit/slackDraftStore.js";
import { buildHandStep, type HandStep } from "../../../hand/step.js";
import { handRegisterPath, readHandRows } from "../../../hand/store.js";
import {
  askDraftMisplaced,
  checkedPostmortemCard,
  nextPostmortemRevision,
  postmortemStepDraft,
} from "../../../incident/postmortem.js";
import { postmortemChannelUnbound } from "../../../incident/postmortemChannel.js";
import type { IncidentPostmortemForm } from "../../../incident/postmortemForm.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import { type OrgHealthPort, orgHealthPort } from "../../../orgHealth/port.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import { type PagePublished, pagePublishedInStore } from "../../../pages/published.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { applyHandPost, handSeatRefused } from "../hand/applyPost.js";
import { bySession, flag, type HandDeps, productionHandDeps, reportUnparsed, resolvedHomeOf } from "../hand/deps.js";
import { namedRowRefusal } from "../hand/post.js";

import { dryRunCardPost, proofPageRefusal } from "./cardPost.js";
import { INCIDENT_POSTMORTEM_USAGE } from "./incidentUsage.js";

/** Where the verb's arguments start in the full process argv. */
const VERB_ARG_OFFSET = 4;

/** The verb as its diagnostics open. */
const VERB = "incident postmortem";

/** The verb as a refusal names it. */
const COMMAND = `slopweaver ${VERB}`;

/** The flags `incident postmortem` parses — `helpTruth.test.ts` holds its usage line to exactly these. */
export const INCIDENT_POSTMORTEM_FLAG_SPEC: FlagSpec = {
  boolean: ["dry-run", "quiet", "json", "help"],
  string: ["form", "home", "by-session"],
};

/** The hand seams, plus the store the incident snapshot that binds the reply's channel is read from. */
export interface IncidentPostmortemDeps extends HandDeps {
  readonly orgHealthPort: OrgHealthPort;
  /** Whether the store serves the briefing page — `pagePublishedInStore` in production. */
  readonly pagePublished: PagePublished;
}

/**
 * The form file, read and checked — field by field and as the card it composes.
 *
 * @param path the `--form` file
 * @param consoleBase the console origin the trial card's briefing address is minted on
 * @param deps the diagnostic channel
 * @returns the checked form, or `undefined` once the refusal is written
 */
function readForm({
  path,
  consoleBase,
  deps,
}: {
  path: string;
  consoleBase: string;
  deps: HandDeps;
}): IncidentPostmortemForm | undefined {
  let value: unknown;
  try {
    value = safeJsonParse({ label: "a postmortem card form", text: readFileSync(path, "utf8") });
  } catch (error: unknown) {
    deps.writeDiagnostic(`${VERB}: --form ${path}: ${errorMessage({ error })}`);
    return undefined;
  }
  const form = checkedPostmortemCard({ consoleBase, value });
  if (form.isErr()) {
    deps.writeDiagnostic(form.error.message);
    return undefined;
  }
  return form.value;
}

/**
 * Run `incident postmortem` against injected seams.
 *
 * @param rest the argv tail after `incident postmortem`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runIncidentPostmortem({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: IncidentPostmortemDeps;
}): Promise<number> {
  const parsed = parseFlags({ args: rest, spec: INCIDENT_POSTMORTEM_FLAG_SPEC });
  if (parsed.isErr()) {
    parsed.error.forEach((line) => {
      deps.writeDiagnostic(`${VERB}: ${line}`);
    });
    deps.writeDiagnostic(INCIDENT_POSTMORTEM_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const formPath = flag({ name: "form", values });
  if (values["help"] === true || formPath === undefined) {
    deps.writeDiagnostic(INCIDENT_POSTMORTEM_USAGE);
    return values["help"] === true ? EXIT_OK : EXIT_USAGE;
  }
  const dryRun = values["dry-run"] === true;
  const home = resolvedHomeOf({ values });
  if (!dryRun && handSeatRefused({ command: COMMAND, deps, home })) {
    return EXIT_ERROR;
  }
  const form = readForm({ consoleBase: deps.consoleBase(), deps, path: formPath });
  if (form === undefined) {
    return EXIT_ERROR;
  }
  // The reply is judged held and the card posted under the register's lock, so no writer that takes it — a record,
  // judgement, drop or re-cut — lands in between; a dry run too, so what it admits is what a real run would.
  // A RELEASE does not take this lock, which is stated residue rather than closed: one landing in the
  // gap leaves a card naming a sent reply, and their yes on it is refused by the release's own held-row read.
  const release = holdSlackDraftLock({ home });
  if (release.isErr()) {
    deps.writeDiagnostic(`${VERB}: ${release.error.message}`);
    return EXIT_ERROR;
  }
  try {
    return await postCard({ deps, dryRun, form, home, values });
  } finally {
    release.value();
  }
}

/**
 * Compose the card and post it — to the real register, or a throwaway one on `--dry-run`.
 *
 * @param form the checked form
 * @param home the state home
 * @param values the parsed flags
 * @param dryRun whether the post lands in a throwaway home
 * @param deps the clock, the seams and the diagnostic channel
 * @returns the process exit code
 */
async function postCard({
  form,
  home,
  values,
  dryRun,
  deps,
}: {
  form: IncidentPostmortemForm;
  home: string;
  values: Readonly<Record<string, unknown>>;
  dryRun: boolean;
  deps: IncidentPostmortemDeps;
}): Promise<number> {
  const composed = await composeCard({ deps, form, home, postedBy: bySession({ values }) });
  if (composed === undefined) {
    return EXIT_ERROR;
  }
  const post = {
    deps,
    json: values["json"] === true,
    nowIso: composed.nowIso,
    quiet: values["quiet"] === true,
    read: undefined,
    step: composed.step,
  };
  if (!dryRun) {
    return applyHandPost({
      ...post,
      admitRow: ({ row }) => namedRowRefusal({ home, row }),
      home,
      supersedes: composed.supersedes,
    });
  }
  return dryRunCardPost({ home, post, verb: VERB });
}

/** A card ready to post: the built step, the revision it supersedes, and the instant it was built. */
interface ComposedCard {
  readonly step: HandStep;
  readonly supersedes: string | undefined;
  readonly nowIso: string;
}

/**
 * Whether the parked reply the form names is this card's ask, read off their draft register — writing the refusal when
 * it is not.
 *
 * @param form the checked form
 * @param home the state home whose draft register holds the reply
 * @param deps the diagnostic channel
 * @returns true once the reply is this card's ask
 */
function askDraftPlaced({ form, home, deps }: { form: IncidentPostmortemForm; home: string; deps: HandDeps }): boolean {
  const lines = readSlackDraftLinesOrError({ home });
  if (lines.isErr()) {
    deps.writeDiagnostic(`${VERB}: ${lines.error.message}`);
    return false;
  }
  const log = parseSlackDraftLog({ lines: lines.value });
  const items = foldSlackDraftLog({ log });
  const misplaced = askDraftMisplaced({
    form,
    item: items.find((item) => item.id === form.askDraft),
    skipped: log.skipped,
  });
  if (misplaced !== undefined) {
    deps.writeDiagnostic(misplaced.message);
    return false;
  }
  return true;
}

/**
 * Whether the briefing is published and the reply's channel is the referenced incident's own — writing the refusal
 * at the first that is not.
 *
 * @returns true once both hold
 */
async function briefingAndRoomHold({
  form,
  home,
  deps,
}: {
  form: IncidentPostmortemForm;
  home: string;
  deps: IncidentPostmortemDeps;
}): Promise<boolean> {
  // The briefing first: a card that cannot open what the room will talk about is refused outright.
  const refusal = await proofPageRefusal({
    home,
    opens: "the card opens it",
    pagePublished: deps.pagePublished,
    slug: form.proof,
    verb: VERB,
    what: "the briefing",
  });
  if (refusal !== undefined) {
    deps.writeDiagnostic(refusal);
    return false;
  }
  // Then the room: the channel the reply goes to has to be the referenced incident's own, by incident.io's announcement.
  const snapshot = await deps.orgHealthPort.readSnapshot({ home });
  if (snapshot.isErr()) {
    deps.writeDiagnostic(`${VERB}: ${snapshot.error.message}`);
    return false;
  }
  const unbound = postmortemChannelUnbound({
    channelId: form.channel.id,
    reference: form.channel.reference,
    snapshot: snapshot.value,
  });
  if (unbound !== undefined) {
    deps.writeDiagnostic(unbound.message);
    return false;
  }
  return true;
}

/**
 * Check the briefing and the reply, number the revision against their register, and build the hand step — writing the
 * refusal and returning `undefined` at the first thing that stops it.
 *
 * @param form the checked form
 * @param home the state home whose registers are read
 * @param postedBy the posting session, as `--by-session` names it
 * @param deps the clock and the diagnostic channel
 * @returns the composed card, or `undefined` once the refusal is written
 */
async function composeCard({
  form,
  home,
  postedBy,
  deps,
}: {
  form: IncidentPostmortemForm;
  home: string;
  postedBy: string;
  deps: IncidentPostmortemDeps;
}): Promise<ComposedCard | undefined> {
  if (!(await briefingAndRoomHold({ deps, form, home })) || !askDraftPlaced({ deps, form, home })) {
    return undefined;
  }
  const held = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
  if (held.isErr()) {
    deps.writeDiagnostic(`${VERB}: ${held.error.message}`);
    return undefined;
  }
  // A skipped line might be this incident's open revision, and a card that cannot see it would open a second one.
  if (held.value.unparsed.length > 0) {
    reportUnparsed({ deps, unparsed: held.value.unparsed, verb: VERB });
    deps.writeDiagnostic(`${VERB}: refused — which revision is open cannot be known while lines are skipped`);
    return undefined;
  }
  const revision = nextPostmortemRevision({ channelId: form.channel.id, rows: held.value.rows });
  if (revision.isErr()) {
    deps.writeDiagnostic(revision.error.message);
    return undefined;
  }
  const nowIso = deps.now();
  const draft = postmortemStepDraft({
    consoleBase: deps.consoleBase(),
    form,
    nowIso,
    postedBy,
    revision: revision.value,
  });
  const built = buildHandStep({ draft });
  if (built.isErr()) {
    deps.writeDiagnostic(`${VERB}: ${built.error.message}`);
    return undefined;
  }
  return { nowIso, step: built.value, supersedes: revision.value.supersedes };
}

/** `slopweaver incident postmortem`. */
export const incidentPostmortemCommand = defineCommand({
  run: (argv) =>
    runIncidentPostmortem({
      deps: { ...productionHandDeps(), orgHealthPort: orgHealthPort(), pagePublished: pagePublishedInStore },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
