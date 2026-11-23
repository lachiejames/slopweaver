/**
 * `slopweaver handover shot <slug>` — give an OPEN ask the picture its Queue card shows, with a red box and a short
 * label on each part the owner is meant to read.
 *
 * ## The gap this closes
 *
 * A screenshot on an evidence card does not say which part of it the owner is meant to look at, so a red box around
 * the part in question, with a short label saying what is wrong with it, is what makes the card readable. And an
 * image an ask refers to belongs on its Queue card, never as a `.png` path in the ask's prose.
 *
 * So the picture is attached here, where it is chosen, and never unboxed: `--shot` without a `--box` is refused, the
 * boxes are judged against the PNG's own size before anything is written (`../../../hand/shot.ts`), and the console
 * draws them with the hand register's overlay. A path to a picture in an ask's prose is refused at the recording verbs
 * instead (`../../../handover/cardAlignment.ts`), pointing here.
 *
 * ## Two homes, one per row shape — `handover example`'s, for its reasons
 *
 * - A run parked on the owner: a `question-shot` journal line bound to the open question's exact text, so a re-ask or a
 *   reshape leaves the picture behind rather than lending it to a different question (`openQuestion.ts`).
 * - A registered ask with no run behind it: `shot:` in its front matter, one JSON line.
 *
 * Either way the PNG is stored once by its SHA-256 in the hand-shot store, BEFORE the row names it, so a row never
 * names a picture that is not there. It needs no claim on the run: it moves no phase and touches neither the question,
 * its shape nor its clock, and what it writes is drawn on the card where the owner reads it.
 */
import { checkedShot, type HandShot, parseBoxFlag } from "../../../hand/shot.js";
import { type ReadShot, readHandShot, storeHandShot } from "../../../hand/shotStore.js";
import { sameAskShot } from "../../../handover/askShot.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import { OWNER_WAIT_KIND } from "../../../handover/ownerWait.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { isSafeSlug } from "../../../handover/runStore.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, parseFlags, repeatedFlagValues } from "../../parseFlags.js";
import { writeAskFrontMatter } from "./askFrontMatterWrite.js";
import { flagNamesOf, resolveHandoverDir, stringFlag, VERB_ARG_OFFSET } from "./commandSupport.js";
import { publishedWaitOf } from "./listJsonWait.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";
import { composeRow } from "./rowRun.js";
import { SHOT_USAGE } from "./shotUsage.js";

/** The flags `handover shot` accepts, names without the leading `--`. */
const SHOT_FLAGS: FlagSpec = {
  repeatable: ["box"],
  string: ["shot", "box", "dir", "home"],
};

/** `--`-prefixed, so the help-truth ratchet can compare the usage string against the parser both ways. */
export const HANDOVER_SHOT_FLAG_NAMES: readonly string[] = flagNamesOf({ spec: SHOT_FLAGS });

/**
 * Parse `handover shot`'s flags. Exported so the help-truth ratchet probes the real parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the parser's refusals
 */
export function parseHandoverShotArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: SHOT_FLAGS });
}

/** What recording a picture on one row did. */
type ShotWrite =
  | { readonly kind: "journalled"; readonly path: string }
  | { readonly kind: "written"; readonly path: string }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly problem: string };

/**
 * Re-read a registered ask's file, set its `shot:` line, read the edit back, and write it — all inside the row's one
 * lock (`./boardRowLock.ts`), so no other row edit is written over.
 *
 * @param path the row's file
 * @param slug the row the board composed, so a file another writer replaced is refused
 * @param shot what to record
 * @returns what happened
 */
function writeFrontMatter({ path, slug, shot }: { path: string; slug: string; shot: HandShot }): ShotWrite {
  return writeAskFrontMatter({
    edit: {
      holds: (doc) => sameAskShot({ left: doc.shot, right: shot }),
      remove: [],
      // One flow-mapping line: JSON is YAML, and the nested reader parses exactly this key (`docNested.ts`).
      set: [{ key: "shot", value: JSON.stringify(shot) }],
    },
    path,
    slug,
  });
}

/**
 * Record the picture wherever this row's question lives: the journal for a run parked on the owner, else the front matter.
 *
 * @param model the composed row
 * @param shot what to record
 * @param home the state home whose run journals are written
 * @returns what happened
 */
function recordShot({ model, shot, home }: { model: BoardModel; shot: HandShot; home: string }): ShotWrite {
  if (model.run.kind !== "waiting-on-owner") {
    return writeFrontMatter({ path: model.doc.path, shot, slug: model.doc.slug });
  }
  if (sameAskShot({ left: model.run.shot, right: shot })) {
    return { kind: "unchanged" };
  }
  const appended = applyRowEvent({
    event: { atIso: new Date().toISOString(), kind: "question-shot", question: model.run.question, shot },
    runsDir: stateHomePaths({ home }).runs,
    slug: model.doc.slug,
  });
  if (appended.isErr()) {
    return { kind: "refused", problem: appended.error.message };
  }
  return { kind: "journalled", path: appended.value.path };
}

/** Print a usage-level refusal with the verb's own help, and hand back the exit code. */
function usageRefused({ problems }: { problems: readonly string[] }): number {
  problems.forEach((problem) => {
    logger.error({ msg: `handover shot: ${problem}` });
  });
  logger.error({ msg: SHOT_USAGE });
  return EXIT_USAGE;
}

/** Print a refusal of fact, and hand back the exit code. */
function refused({ problem }: { problem: string }): number {
  logger.error({ msg: `handover shot: ${problem}` });
  return EXIT_ERROR;
}

/**
 * The picture `--shot` names with its `--box` flags, read and judged whole against the PNG's own size — nothing
 * stored yet, so a refusal leaves no blob.
 *
 * @param path the PNG as typed
 * @param boxes each `--box` value as typed
 * @returns the bytes to store and the checked picture, or the first problem
 */
function pictureOf({
  path,
  boxes,
}: {
  path: string;
  boxes: readonly string[];
}):
  | { readonly kind: "read"; readonly read: ReadShot; readonly shot: HandShot }
  | { readonly kind: "refused"; readonly problem: string } {
  const read = readHandShot({ path });
  if (read.isErr()) {
    return { kind: "refused", problem: read.error.message };
  }
  const parsed: unknown[] = [];
  for (const value of boxes) {
    const box = parseBoxFlag({ value });
    if (box.isErr()) {
      return { kind: "refused", problem: box.error.message };
    }
    parsed.push(box.value);
  }
  const { height, sha256, width } = read.value;
  const shot = checkedShot({ unboxed: "refused", value: { boxes: parsed, height, sha256, width } });
  if (shot.isErr()) {
    return { kind: "refused", problem: shot.error.message };
  }
  // A defined value in is a defined picture out: `checkedShot` answers `undefined` only for an absent one.
  return { kind: "read", read: read.value, shot: shot.value! };
}

/**
 * Give one open ask its boxed picture.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverShot(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: SHOT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverShotArgs({ rest });
  if (parsed.isErr()) {
    return usageRefused({ problems: parsed.error });
  }
  const [slug, ...extra] = parsed.value.positionals;
  if (slug === undefined || extra.length > 0 || !isSafeSlug({ slug })) {
    return usageRefused({ problems: ["name exactly one row's slug — letters, digits, dots, dashes, underscores"] });
  }
  const path = stringFlag({ name: "shot", parsed: parsed.value });
  const boxes = repeatedFlagValues({ name: "box", rest });
  if (path === undefined || boxes.length === 0) {
    return usageRefused({
      problems: [
        "pass the PNG with --shot and at least one --box x,y,width,height=<label> — a picture with no box is " +
          "the unannotated screenshot this verb exists to end",
      ],
    });
  }
  const picture = pictureOf({ boxes, path });
  if (picture.kind === "refused") {
    return refused({ problem: picture.problem });
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) });
  const handoverDir = resolveHandoverDir({ dir: stringFlag({ name: "dir", parsed: parsed.value }), home });
  const row = composeRow({ base: undefined, handoverDir, home, slug });
  if (row.kind === "none") {
    logger.error({ msg: row.line.replace(/^handover row:/u, "handover shot:") });
    return row.exit;
  }
  const published = publishedWaitOf({ model: row.model });
  if (published.wait.kind !== OWNER_WAIT_KIND || published.question === undefined) {
    return refused({
      problem: `${slug} is not an ask open on the owner (${published.wait.kind}) — done cards are left alone`,
    });
  }
  // Stored before the row names it, so a row never points at a picture that is not there. Identical bytes are held
  // once, so a refused write below leaves at most a blob another row may already share.
  const stored = storeHandShot({ home, shot: picture.read });
  if (stored.isErr()) {
    return refused({ problem: stored.error.message });
  }
  return reportWrite({
    home,
    shot: picture.shot,
    slug,
    write: recordShot({ home, model: row.model, shot: picture.shot }),
  });
}

/**
 * Say what recording the picture came to, mirroring a doc write as every row-doc verb does.
 *
 * @param write what `recordShot` did with the picture
 * @returns the process exit code
 */
async function reportWrite({
  home,
  shot,
  slug,
  write,
}: {
  home: string;
  shot: HandShot;
  slug: string;
  write: ReturnType<typeof recordShot>;
}): Promise<number> {
  if (write.kind === "refused") {
    return refused({ problem: write.problem });
  }
  if (write.kind === "unchanged") {
    logger.out({ line: `handover shot: ${slug} already carries exactly this picture — nothing written` });
    return EXIT_OK;
  }
  const labels = shot.boxes.map((box) => `"${box.label}"`).join(", ");
  logger.out({ line: `handover shot: ${slug} now shows its picture boxed at ${labels}` });
  if (write.kind === "journalled") {
    logger.out({ line: `  journal: ${write.path}` });
    return EXIT_OK;
  }
  logger.out({ line: `  doc: ${write.path}` });
  return (await mirrorAfterWrite({ home, path: write.path, verb: "shot" })) ? EXIT_ERROR : EXIT_OK;
}

export const handoverShotCommand = defineCommand({ run: runHandoverShot });
