/**
 * `slopweaver turn freeze` — turn a failed turn's own files into a committable REPLAY FIXTURE.
 *
 * A turn that went wrong has already left everything needed to re-run it: its ask-lifecycle rows, its brief,
 * its dispatch record, its reviewer's record and verdict, and the answer it composed. Nothing read any of
 * that, so every incident was re-litigated from a transcript and remembered rather than tested. This verb
 * freezes the set, redacts it through `../../../live/turn/freeze/redact.ts`'s allowlist, and writes a
 * fixture the replay lane points a real verb at — the lane is described in
 * `.claude/rules/testing.md` § the replay lane.
 *
 * ## It REFUSES rather than emitting a leaky fixture
 *
 * The output is git-tracked, so it is scanned by the public hygiene gate and the private denylist on every
 * push. This verb runs that exact scanner over everything it just wrote, and on any hit deletes the output
 * and exits non-zero. Discovering a leak at `git push` — after the bytes are already in a commit — is the
 * expensive version of the same finding.
 *
 * ## `--through` and `--not-after` are what make it a REPLAY fixture
 *
 * Frozen whole, a dispatch-orphan ask carries the `dispatch-failed` row the pre-fix code wrote,
 * and replaying today's sweep over it only proves the sweep can read a bad event. Frozen
 * `--through dispatched`, it is the state at the moment before the defect fired, and the real verb's
 * behaviour over THAT is the thing under test.
 *
 * `--not-after <iso>` is the same cut for a defect that fired BETWEEN two lifecycle events, where no kind
 * can name the moment before it. Measured on one ask: four lifecycle rows, and
 * the worker died 49 minutes after the third with two reviewer rounds behind it. `--through dispatched`
 * there closes the window before the worker's rounds and cuts off every round the turn actually spent — the exact records the
 * incident is about. The instant is also what a replay judges the fixture by, so a fixture cut at the moment
 * of death has a clock at the moment of death.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { loadDenylist } from "../../../hygiene/scan.js";
import { logger } from "../../../lib/logger.js";
import { installedTreeRoot } from "../../../lib/pluginRoot.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseAskArgument } from "../../../live/ask/askArgument.js";
import {
  FIXTURE_HOME_DIR,
  FIXTURE_MANIFEST_FILE,
  type FixtureManifest,
  type SelectedEvents,
  selectAskEvents,
} from "../../../live/turn/freeze/fixture.js";
import { type FrozenFile, fixtureManifestFor, readStringFieldOfLine } from "../../../live/turn/freeze/manifest.js";
import type { AskFileKey } from "../../../live/turn/freeze/plan.js";
import { type FixtureIdMap, redactFixtureText } from "../../../live/turn/freeze/redact.js";
import { REGISTER_RELATIVE_PATH } from "../../../reflect/registerDoc.js";
import { loadRegister } from "../../../reflect/registerPages.js";
import { createFsReader } from "../../../reflect/substrate.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { freezeSlug, requiredFreezeFlagProblems, str, TURN_FREEZE_FLAG_SPEC } from "./core.js";
import { collectFrozenFiles, scanFrozenFiles } from "./freezeCollect.js";
import { TURN_FREEZE_USAGE } from "./usage.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, freeze, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn freeze`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnFreezeArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_FREEZE_FLAG_SPEC.boolean], string: [...TURN_FREEZE_FLAG_SPEC.string] },
  });
}

/**
 * Run the freeze verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export function runTurnFreeze(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_FREEZE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnFreezeArgs({ rest });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: TURN_FREEZE_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const required = requiredFlags({ values });
  if (required === undefined) {
    return EXIT_USAGE;
  }
  const { identity, incident, out, slug } = required;
  const regresses = declaredClasses({ raw: str({ key: "regresses", values }) });
  if (regresses === undefined) {
    return EXIT_USAGE;
  }
  const notAfter = notAfterInstant({ raw: str({ key: "not-after", values }) });
  if (notAfter === undefined) {
    return EXIT_USAGE;
  }
  return freezeAsk({
    home: resolveHome({ named: str({ key: "home", values }) }),
    identity,
    incident,
    notAfter: notAfter.instant,
    out,
    regresses,
    slug,
    through: str({ key: "through", values }),
  });
}

/**
 * {@link parseRegresses}, with its rejections already printed.
 *
 * Split out so {@link runTurnFreeze} stays one straight line of flag reads — the print-then-fail loop is the
 * same three lines every other flag here would need, and inlining it pushed that function over the
 * cognitive-complexity ceiling.
 *
 * @param raw the flag's comma-separated value, or `undefined` when it was not given
 * @returns the declared class names, or `undefined` once the rejections have been reported
 */
function declaredClasses({ raw }: { raw: string | undefined }): readonly string[] | undefined {
  const parsed = parseRegresses({ raw });
  if (parsed.isOk()) {
    return parsed.value;
  }
  for (const error of parsed.error) {
    logger.error({ msg: error });
  }
  return undefined;
}

/**
 * Read `--regresses` into the register class names it declares, refusing one the register does not carry.
 *
 * A class name is checked because the field exists to JOIN two registers, and a typo would produce a fixture
 * that silently regresses nothing — the `register-bindings` gate would then refuse every later run over a
 * defect committed here. Refusing at the freeze is the cheaper end.
 *
 * It fails OPEN when any page of the register reads with a problem — absent, opening the wrong section,
 * unlisted, or holding a row the parser could not read. Freezing is the time-critical act during an
 * incident — `.claude/rules/testing.md` says to freeze BEFORE anything cleans the record set up — so an
 * unreadable doc must not be what stops it, and checking against the pages that did read would reject a real
 * class whose page is the absent or misread one. The gate is where an unjoinable value is caught for good.
 *
 * An empty value is the same as omitting the flag, rather than its own refusal. `--regresses ""` says the
 * turn regresses no named class, which is what omitting it says, and the field is optional either way — so a
 * second failure message here would buy nothing and would grow this directory's plain-error-shape count.
 *
 * @param raw the flag's comma-separated value, or `undefined` when it was not given
 * @returns the declared class names, or every rejection
 */
function parseRegresses({ raw }: { raw: string | undefined }): Result<readonly string[]> {
  if (raw === undefined) {
    return ok([]);
  }
  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) {
    return ok([]);
  }
  const registerPath = join(installedTreeRoot({ importMetaUrl: import.meta.url }), REGISTER_RELATIVE_PATH);
  const register = loadRegister({ parentPath: registerPath, reader: createFsReader() });
  if (register.unread.length > 0) {
    logger.error({ msg: `--regresses not checked: the register reads with problems on ${register.unread.join(", ")}` });
    return ok(names);
  }
  const unknown = names.filter((name) => !register.doc.classes.some((c) => c.name === name));
  if (unknown.length > 0) {
    return err(unknown.map((name) => `--regresses names \`${name}\`, which ${REGISTER_RELATIVE_PATH} does not carry`));
  }
  return ok(names);
}

/**
 * How this freeze's window was described on the command line, for the summary line to name.
 *
 * @param notAfter the `--not-after` instant, when one was given
 * @param through the `--through` kind, when one was given
 * @returns the cut, in the words the caller used
 */
function cutDescription({ notAfter, through }: { notAfter: string | undefined; through: string | undefined }): string {
  const parts = [through, notAfter].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? "(no cut)" : parts.join(" and ");
}

/**
 * The three flags a freeze cannot run without, with every rejection already printed.
 *
 * One function rather than three checks inline, for the reason {@link declaredClasses} gives: a
 * print-then-fail branch per flag is what pushed {@link runTurnFreeze} over the cognitive-complexity
 * ceiling, and its flag reads are meant to be one straight line each. Every missing or empty flag is named in
 * one pass rather than the first one aborting, because a caller fixing them one at a time pays a run per flag.
 *
 * @param values the parsed flag values
 * @returns the three flags, with `--ask` already split and `--out`'s own directory name, or `undefined` once the
 *   rejections are reported
 */
function requiredFlags({ values }: { values: Readonly<Record<string, string | boolean>> }):
  | {
      readonly identity: { channel: string; messageTs: string };
      readonly incident: string;
      readonly out: string;
      readonly slug: string;
    }
  | undefined {
  const ask = str({ key: "ask", values });
  const out = str({ key: "out", values });
  const incident = str({ key: "incident", values });
  const problems = requiredFreezeFlagProblems({ ask, incident, out });
  if (ask === undefined || out === undefined || incident === undefined || problems.length > 0) {
    logger.error({ msg: problems.join("\n") });
    logger.error({ msg: TURN_FREEZE_USAGE });
    return undefined;
  }
  const identity = parseAskArgument({ ask });
  if (identity === undefined) {
    logger.error({ msg: `--ask must read <channel>/<messageTs>, got ${ask}` });
    return undefined;
  }
  const slug = freezeSlug({ incident, out, slug: str({ key: "slug", values }) });
  if (slug.isErr()) {
    logger.error({ msg: slug.error.join("; ") });
    return undefined;
  }
  return { identity, incident, out, slug: slug.value };
}

/**
 * Read `--not-after`, with its rejection already printed.
 *
 * Wrapped rather than inlined for the same reason {@link declaredClasses} is: a print-then-fail branch
 * inside {@link runTurnFreeze} pushes that function over the cognitive-complexity ceiling, and the flag
 * reads there are meant to be one straight line each.
 *
 * @param raw the flag's value, or `undefined` when it was not given
 * @returns the instant to use — `undefined` INSIDE the wrapper when the flag was absent, and the wrapper
 *   itself `undefined` once a rejection has been reported
 */
function notAfterInstant({ raw }: { raw: string | undefined }): { readonly instant: string | undefined } | undefined {
  if (raw === undefined) {
    return { instant: undefined };
  }
  if (Number.isNaN(Date.parse(raw))) {
    logger.error({ msg: `--not-after must read as an ISO instant, got ${raw}` });
    return undefined;
  }
  return { instant: raw };
}

/**
 * Read the record set, redact it, and describe it — everything a freeze does before it decides whether the
 * result may be written at all.
 *
 * Split from {@link freezeAsk} so the WRITE decision reads as three lines (scan, refuse, write) rather than
 * being buried under the redaction that produced the thing being scanned.
 *
 * @param denylist the private org-word list
 * @param home the live state home to read the record set from
 * @param identity the ask's channel and addressing timestamp, as they appear on disk
 * @param incident what went wrong, in the freezer's own words
 * @param ids the working id map, extended in place
 * @param notAfter the instant the record set's window closes at, or `undefined` to derive it from the log
 * @param selected the ask's own lifecycle lines, already truncated by `--through` and `--not-after`
 * @param slug the fixture's own name
 * @param through the last lifecycle kind kept, for the manifest to state
 * @returns the fixture's redacted files and its manifest, neither yet written
 */
function buildFixture({
  denylist,
  home,
  identity,
  incident,
  ids,
  notAfter,
  regresses,
  selected,
  slug,
  through,
}: {
  denylist: readonly string[];
  home: string;
  identity: AskFileKey;
  incident: string;
  ids: FixtureIdMap;
  notAfter: string | undefined;
  regresses: readonly string[];
  selected: SelectedEvents;
  slug: string;
  through: string | undefined;
}): { readonly files: readonly FrozenFile[]; readonly manifest: FixtureManifest } {
  const lastKept = selected.kept[selected.kept.length - 1]!;
  const replayNowIso = replayClock({ lastKept, notAfter });
  const skipped: string[] = [];
  const collected = collectFrozenFiles({
    askIdentity: identity,
    denylist,
    events: selected.kept,
    home,
    ids,
    notAfterIso: replayNowIso,
    skipped,
    withheldKinds: selected.withheldKinds,
  });
  // The FILENAMES carry the ask key too — `<channel>-<messageTs>.json` — so they are redacted through the
  // same map, as a final pass once every id in the set has been minted. Doing it here rather than per file
  // is what makes a fixture's paths agree with its contents: every store recomputes a path from the channel
  // it just read, and a raw filename beside a synthetic `channel` field would be a fixture nothing can open.
  const files = collected.map((file) => ({
    contents: file.contents,
    relativePath: redactFixtureText({ denylist, home, ids, text: file.relativePath }),
  }));
  const manifest = fixtureManifestFor({
    denylist,
    files,
    home,
    ids,
    incident,
    lastKept,
    regresses,
    replayNowIso,
    selected,
    skipped,
    slug,
    through,
  });
  return { files, manifest };
}

/**
 * The instant a replay judges this fixture at, and the instant its record set is windowed by.
 *
 * Three sources, most authoritative first, each absent case named by an `if` rather than coalesced — a
 * `??` chain here would hide which of the three actually answered. `--not-after` WINS when it was given: it
 * is the stated moment the defect fired, and the last kept event's own instant is only ever a stand-in for
 * that. `core.ts`'s usage text says when the stand-in is wrong. The wall clock is the last resort, for a
 * log line that declares no `tsIso` at all.
 *
 * @param lastKept the last lifecycle line the freeze kept
 * @param notAfter the `--not-after` instant, when one was given
 * @returns the instant to freeze at
 */
function replayClock({ lastKept, notAfter }: { lastKept: string; notAfter: string | undefined }): string {
  if (notAfter !== undefined) {
    return notAfter;
  }
  const declared = readStringFieldOfLine({ field: "tsIso", line: lastKept });
  if (declared !== undefined) {
    return declared;
  }
  return new Date().toISOString();
}

/**
 * Freeze one ask: read, redact, scan, write.
 *
 * @param home the live state home to read the record set from
 * @param identity the ask's channel and addressing timestamp, as they appear on disk
 * @param incident what went wrong, in the freezer's own words
 * @param notAfter the instant the record set's window closes at, or `undefined` to derive it from the log
 * @param out the directory to write the fixture into
 * @param slug the fixture's own name
 * @param through the last lifecycle kind to keep, or `undefined` to keep the whole log
 * @returns the process exit code
 */
function freezeAsk({
  home,
  identity,
  incident,
  notAfter,
  out,
  regresses,
  slug,
  through,
}: {
  home: string;
  identity: { channel: string; messageTs: string };
  incident: string;
  notAfter: string | undefined;
  out: string;
  regresses: readonly string[];
  slug: string;
  through: string | undefined;
}): number {
  const paths = stateHomePaths({ home });
  if (!existsSync(paths.live.slack.asksJsonl)) {
    logger.error({ msg: `no ask log at ${paths.live.slack.asksJsonl} — is --home right?` });
    return EXIT_ERROR;
  }
  const selected = selectAskEvents({
    channel: identity.channel,
    messageTs: identity.messageTs,
    notAfter,
    text: readFileSync(paths.live.slack.asksJsonl, "utf8"),
    through,
  });
  if (selected.kept.length === 0) {
    logger.error({ msg: `no lifecycle events for ${identity.channel}/${identity.messageTs} in ${home}` });
    return EXIT_ERROR;
  }
  const denylist = loadDenylist({ home });
  const ids: FixtureIdMap = new Map();
  const built = buildFixture({ denylist, home, identity, incident, ids, notAfter, regresses, selected, slug, through });
  const manifestFile: FrozenFile = {
    contents: `${JSON.stringify(built.manifest, null, 2)}\n`,
    relativePath: FIXTURE_MANIFEST_FILE,
  };
  const hits = scanFrozenFiles({ denylist, files: [...built.files, manifestFile] });
  if (hits.length > 0) {
    logger.error({ msg: `turn freeze: REFUSING — ${String(hits.length)} leak-class hit(s) survived redaction:` });
    for (const hit of hits) {
      logger.error({ msg: `  ${hit}` });
    }
    return EXIT_ERROR;
  }
  writeFixture({ files: built.files, manifestFile, out });
  logger.out({
    line:
      `froze ${identity.channel}/${identity.messageTs} → ${out} — ${String(built.files.length)} file(s), ` +
      `${String(ids.size)} synthetic id(s), ${String(built.manifest.reviewRounds)} review round(s), ` +
      `${String(selected.withheldKinds.length)} event(s) withheld after ` +
      `${cutDescription({ notAfter, through })}, replay clock ${built.manifest.replayNowIso}`,
  });
  return EXIT_OK;
}

/**
 * Write the whole fixture, replacing any prior generation of it.
 *
 * Replaced rather than merged: a re-freeze that left an orphan file behind would leave the manifest lying
 * about what the fixture holds, and the manifest is the only thing a replay reads before trusting it.
 *
 * @param files the frozen home files, fixture-relative
 * @param manifestFile the manifest, already rendered
 * @param out the fixture directory
 */
function writeFixture({
  files,
  manifestFile,
  out,
}: {
  files: readonly FrozenFile[];
  manifestFile: FrozenFile;
  out: string;
}): void {
  rmSync(out, { force: true, recursive: true });
  for (const file of files) {
    const target = join(out, FIXTURE_HOME_DIR, file.relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.contents, "utf8");
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, manifestFile.relativePath), manifestFile.contents, "utf8");
}

export const turnFreezeCommand = defineCommand({ run: runTurnFreeze });
