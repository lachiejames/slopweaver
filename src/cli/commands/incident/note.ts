/**
 * `slopweaver incident note` — an incident investigation's ONE floating note, composed from a form and posted
 * through the very sequence `hand post` runs (`../hand/applyPost.ts`), so it meets every posting rule with the
 * same words: the pinned-supervisor seat, the decision shape, the parked drafts it names, the board row it waits on.
 *
 * What it adds over `hand post` is what an incident needs and a flag cannot carry: verbatim quotes with permalinks
 * above the fold, the root cause, impact, status and stakeholders behind the disclosure row, and the REVISION — a
 * second note for the same channel supersedes the open one, so an update amends the card they already have.
 *
 * `--dry-run` admits against their real home and then records and draws from a throwaway register: the exact note,
 * on screen, with their queue never holding it. That is how a seat that is not the chair proves a form before handing
 * it to the chair, and how the incident proof was screenshotted.
 */
import { readFileSync } from "node:fs";

import type { ReadShot } from "../../../hand/shotStore.js";
import { buildHandStep, type HandStep } from "../../../hand/step.js";
import { handRegisterPath, readHandRows } from "../../../hand/store.js";
import { checkedIncidentForm, type IncidentNoteForm } from "../../../incident/form.js";
import { incidentStepDraft, nextIncidentRevision } from "../../../incident/note.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import { type PagePublished, pagePublishedInStore } from "../../../pages/published.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { applyHandPost, handSeatRefused } from "../hand/applyPost.js";
import { bySession, flag, type HandDeps, productionHandDeps, reportUnparsed, resolvedHomeOf } from "../hand/deps.js";
import { namedRowRefusal } from "../hand/post.js";
import { shotDraftOf } from "../hand/postPicture.js";

import { dryRunCardPost, proofPageRefusal } from "./cardPost.js";
import { INCIDENT_NOTE_USAGE } from "./incidentUsage.js";

/** What `incident note` touches: `hand post`'s seams, and the store its proof page is checked in. */
export type IncidentNoteDeps = HandDeps & {
  /** Whether the store serves the proof page — `pagePublishedInStore` in production. */
  readonly pagePublished: PagePublished;
};

/** Where the verb's arguments start in the full process argv. */
const VERB_ARG_OFFSET = 4;

/** The verb as a refusal names it. */
const COMMAND = "slopweaver incident note";

/** The flags `incident note` parses — `helpTruth.test.ts` holds its usage line to exactly these. */
export const INCIDENT_NOTE_FLAG_SPEC: FlagSpec = {
  boolean: ["dry-run", "quiet", "json", "help"],
  string: ["form", "home", "by-session"],
};

/**
 * The form file, read and checked.
 *
 * @param path the `--form` file
 * @param deps the diagnostic channel
 * @returns the checked form, or `undefined` once the refusal is written
 */
function readForm({ path, deps }: { path: string; deps: HandDeps }): IncidentNoteForm | undefined {
  let value: unknown;
  try {
    value = safeJsonParse({ label: "an incident note form", text: readFileSync(path, "utf8") });
  } catch (error: unknown) {
    deps.writeDiagnostic(`incident note: --form ${path}: ${errorMessage({ error })}`);
    return undefined;
  }
  const form = checkedIncidentForm({ value });
  if (form.isErr()) {
    deps.writeDiagnostic(form.error.message);
    return undefined;
  }
  return form.value;
}

/**
 * Run `incident note` against injected seams.
 *
 * @param rest the argv tail after `incident note`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runIncidentNote({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: IncidentNoteDeps;
}): Promise<number> {
  const parsed = parseFlags({
    args: rest,
    spec: INCIDENT_NOTE_FLAG_SPEC,
  });
  if (parsed.isErr()) {
    parsed.error.forEach((line) => {
      deps.writeDiagnostic(`incident note: ${line}`);
    });
    deps.writeDiagnostic(INCIDENT_NOTE_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const formPath = flag({ name: "form", values });
  if (values["help"] === true || formPath === undefined) {
    deps.writeDiagnostic(INCIDENT_NOTE_USAGE);
    return values["help"] === true ? EXIT_OK : EXIT_USAGE;
  }
  const dryRun = values["dry-run"] === true;
  const home = resolvedHomeOf({ values });
  if (!dryRun && handSeatRefused({ command: COMMAND, deps, home })) {
    return EXIT_ERROR;
  }
  const form = readForm({ deps, path: formPath });
  if (form === undefined) {
    return EXIT_ERROR;
  }
  const composed = await composeNote({ deps, form, home, postedBy: bySession({ values }) });
  if (composed === undefined) {
    return EXIT_ERROR;
  }
  const post = {
    deps,
    json: values["json"] === true,
    nowIso: composed.nowIso,
    quiet: values["quiet"] === true,
    read: composed.read,
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
  return dryRunCardPost({ home, post, verb: "incident note" });
}

/** A note ready to post: the built step, its picture, the revision it supersedes, and the instant it was built. */
interface ComposedNote {
  readonly step: HandStep;
  readonly read: ReadShot | undefined;
  readonly supersedes: string | undefined;
  readonly nowIso: string;
}

/**
 * Whether the note's proof page is unusable, writing the refusal when it is. It runs before the register is read: a
 * note that cannot open its receipts is refused outright.
 */
async function noteProofRefused({
  form,
  home,
  deps,
}: {
  form: IncidentNoteForm;
  home: string;
  deps: IncidentNoteDeps;
}): Promise<boolean> {
  const refusal = await proofPageRefusal({
    home,
    opens: "the note opens them",
    pagePublished: deps.pagePublished,
    slug: form.proof,
    verb: "incident note",
    what: "the receipts",
  });
  if (refusal === undefined) {
    return false;
  }
  deps.writeDiagnostic(refusal);
  return true;
}

/**
 * Check the proof, number the revision against the register, read the picture, and build the hand step — writing the refusal and
 * returning `undefined` at the first thing that stops it.
 *
 * @param form the checked form
 * @param home the state home whose register numbers the revision
 * @param postedBy the posting session, as `--by-session` names it
 * @param deps the clock, the store check and the diagnostic channel
 * @returns the composed note, or `undefined` once the refusal is written
 */
async function composeNote({
  form,
  home,
  postedBy,
  deps,
}: {
  form: IncidentNoteForm;
  home: string;
  postedBy: string;
  deps: IncidentNoteDeps;
}): Promise<ComposedNote | undefined> {
  if (await noteProofRefused({ deps, form, home })) {
    return undefined;
  }
  const held = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
  if (held.isErr()) {
    deps.writeDiagnostic(`incident note: ${held.error.message}`);
    return undefined;
  }
  // A skipped line might be this incident's open revision, and a note that cannot see it would open a second one.
  if (held.value.unparsed.length > 0) {
    reportUnparsed({ deps, unparsed: held.value.unparsed, verb: "incident note" });
    deps.writeDiagnostic("incident note: refused — which revision is open cannot be known while lines are skipped");
    return undefined;
  }
  const revision = nextIncidentRevision({ channelId: form.channel.id, rows: held.value.rows });
  if (revision.isErr()) {
    deps.writeDiagnostic(revision.error.message);
    return undefined;
  }
  const picture = shotDraftOf({ shot: form.shot });
  if (picture.isErr()) {
    deps.writeDiagnostic(`incident note: ${picture.error.message}`);
    return undefined;
  }
  const nowIso = deps.now();
  const draft = incidentStepDraft({
    consoleBase: deps.consoleBase(),
    form,
    nowIso,
    postedBy,
    revision: revision.value,
    shot: picture.value?.draft,
  });
  const built = buildHandStep({ draft });
  if (built.isErr()) {
    deps.writeDiagnostic(`incident note: ${built.error.message}`);
    return undefined;
  }
  return { nowIso, read: picture.value?.read, step: built.value, supersedes: revision.value.supersedes };
}

/** `slopweaver incident note`. */
export const incidentNoteCommand = defineCommand({
  run: (argv) =>
    runIncidentNote({
      deps: { ...productionHandDeps(), pagePublished: pagePublishedInStore },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
