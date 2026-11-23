/**
 * WHAT A FREEZE COLLECTS, AND WHAT IT WITHHOLDS — the file half of `./freeze.ts`, split out when that file
 * grew past the size ratchet.
 *
 * The seam is real rather than arithmetic: everything here answers one question — which of an ask's durable
 * files belong in the fixture, and in what redacted form — while `./freeze.ts` keeps the verb's flags, its
 * manifest and its writes. The question matters on its own because `--through` and `--not-after` truncate
 * only the LIFECYCLE LOG, and every other file is a separate document that is simply COPIED.
 * {@link withholdReason} is the rule that keeps those two in step, so a fixture describes one moment rather
 * than two; `../../../live/turn/freeze/window.ts` is where "when was this file written" is answered.
 */
import { existsSync, readFileSync } from "node:fs";

import { scanContent } from "../../../hygiene/scan.js";
import { CHECKPOINT_LOG_FILE } from "../../../live/turn/checkpoint.js";
import { completionLogPath, readTurnCompletionText } from "../../../live/turn/completionStore.js";
import { recordsAWithheldKind, selectCompletionLines } from "../../../live/turn/freeze/fixture.js";
import { type FrozenFile, readStringFieldOfLine } from "../../../live/turn/freeze/manifest.js";
import {
  type AskFileKey,
  freezeDirectorySources,
  freezeSources,
  insideHome,
  relativeToHome,
} from "../../../live/turn/freeze/plan.js";
import {
  type FixtureIdMap,
  HOME_PLACEHOLDER,
  redactFixtureText,
  redactJsonDocument,
  redactJsonLines,
} from "../../../live/turn/freeze/redact.js";
import { checkpointWindow, entriesOf, readStringField, writtenAfter } from "../../../live/turn/freeze/window.js";
import { stateHomePaths } from "../../../stateHome.js";

export type { FrozenFile } from "../../../live/turn/freeze/manifest.js";

/**
 * Add the composed answer to a fixture, under a canonical filename, rewriting every record that points at it.
 *
 * The answer's own FILENAME is worker-chosen prose — the measured one was `answer-corpcare-<ts>.json`, named
 * after the internal mailbox the thread was about — so it is RENAMED rather than redacted in place. The
 * rewrite has to happen in the same breath: a marker naming a file the fixture does not carry is worse than
 * no marker at all.
 *
 * @param answer the answer's absolute path in the live home
 * @param askIdentity the ask being frozen — its timestamp names the canonical file
 * @param denylist the private org-word list
 * @param files the files collected so far, some of which point at the answer
 * @param home the live state home
 * @param ids the working id map, extended in place
 * @returns the files with the answer added and every reference to it rewritten
 */
function withComposedAnswer({
  answer,
  askIdentity,
  denylist,
  files,
  home,
  ids,
}: {
  answer: string;
  askIdentity: AskFileKey;
  denylist: readonly string[];
  files: readonly FrozenFile[];
  home: string;
  ids: FixtureIdMap;
}): readonly FrozenFile[] {
  const redacted = redactJsonDocument({ denylist, home, ids, raw: readFileSync(answer, "utf8") });
  if (redacted === undefined) {
    return files;
  }
  const canonical = `tmp/answer-${askIdentity.messageTs}.json`;
  const named = redactFixtureText({ denylist, home, ids, text: answer });
  const renamed = files.map((file) => ({
    contents: file.contents.split(named).join(`${HOME_PLACEHOLDER}/${canonical}`),
    relativePath: file.relativePath,
  }));
  return [...renamed, { contents: redacted, relativePath: canonical }];
}

/**
 * The composed answer this ask's records name, when it is one a fixture can carry.
 *
 * @param askIdentity the ask being frozen
 * @param home the live state home
 * @returns the answer's absolute path, or `undefined` when no record names one inside the home
 */
function answerPathOf({
  askIdentity,
  home,
  notAfterIso,
  skipped,
}: {
  askIdentity: AskFileKey;
  home: string;
  notAfterIso: string;
  skipped: string[];
}): string | undefined {
  const paths = stateHomePaths({ home });
  const key = `${askIdentity.channel}-${askIdentity.messageTs}`;
  const candidates = [`${paths.live.slack.turnMarkers}/${key}.json`, `${paths.live.slack.reviews}/${key}/record.json`];
  for (const candidate of candidates) {
    if (writtenAfter({ notAfterIso, path: candidate })) {
      continue;
    }
    const named = readStringField({ field: "answerPath", path: candidate });
    if (named === undefined) {
      continue;
    }
    if (!insideHome({ home, path: named }) || !existsSync(named)) {
      // Measured on this exact record set: one review record carries `answerPath: "answer.json"`, a bare
      // relative name, and the answer is unrecoverable from outside the worker's own cwd. A freeze says so
      // rather than inventing a path.
      skipped.push("the composed answer — the record names a path outside the home, or no longer on disk");
      continue;
    }
    return named;
  }
  return undefined;
}

/**
 * Why one durable source is left out of a truncated freeze, or `undefined` when it belongs in it.
 *
 * Three reasons, and all three exist because `--through` and `--not-after` truncate the LIFECYCLE LOG while
 * every other file is simply copied — so a fixture could claim to be the state before a defect fired while
 * carrying the very files that defect wrote. Measured on the `rewrite-after-clean-verdict-loses-the-lease`
 * freeze, which carried a `"kind": "failed"` turn marker and a round-5 `verdict.json` orphaned from the
 * round-7 record that had already been withheld for being too late.
 *
 * The verdict case needs the caller's running flag because the STANDING verdict declares no instant of its
 * own: the record naming it is what dates it, and `../../../live/turn/reviewStore.ts`'s read would classify
 * an orphan `superseded` against whatever record a replay opens. `window.ts` dates `verdict.json` from that
 * record's `spawnedAt` first, so the flag is the fallback for a record withheld on a reason other than its
 * date; an ARCHIVED verdict carries its spawn instant in its own filename and is dated there.
 *
 * @param notAfterIso the last kept event's instant
 * @param reviewRecordWithheld whether this ask's reviewer record has already been left out
 * @param source the candidate file
 * @param withheldKinds the lifecycle kinds the truncation dropped
 * @returns the reason to state in the manifest, or `undefined` to keep the file
 */
function withholdReason({
  notAfterIso,
  reviewRecordWithheld,
  source,
  withheldKinds,
}: {
  notAfterIso: string;
  reviewRecordWithheld: boolean;
  source: { readonly from: string; readonly to: string };
  withheldKinds: readonly string[];
}): string | undefined {
  if (writtenAfter({ notAfterIso, path: source.from })) {
    return `written after the last kept event (${notAfterIso}), outside this freeze's window`;
  }
  const markerKind = readStringField({ field: "kind", path: source.from });
  if (recordsAWithheldKind({ markerKind, withheldKinds })) {
    return `it records a "${String(markerKind)}" event, which is one --through deliberately cut off`;
  }
  if (reviewRecordWithheld && source.to.endsWith("/verdict.json")) {
    return "its own reviewer record was withheld, so nothing here says whose verdict it is";
  }
  return undefined;
}

/**
 * Collect every frozen file for one ask, redacted but not yet written.
 *
 * @param askIdentity the ask being frozen
 * @param denylist the private org-word list
 * @param events the ask's own selected lifecycle lines, in log order
 * @param home the live state home
 * @param ids the working id map, extended in place
 * @param notAfterIso the last kept event's instant — a record written after it belongs to the part of the
 *   incident the truncation deliberately cut off, and carrying it would make the fixture describe two moments
 * @param skipped collects a line per source left out, for the manifest to state rather than hide
 * @param withheldKinds the lifecycle kinds the truncation dropped, so a durable file recording one of them
 *   is dropped with it
 * @returns the fixture's files, in write order
 */
export function collectFrozenFiles({
  askIdentity,
  denylist,
  events,
  home,
  ids,
  notAfterIso,
  skipped,
  withheldKinds,
}: {
  askIdentity: AskFileKey;
  denylist: readonly string[];
  events: readonly string[];
  home: string;
  ids: FixtureIdMap;
  notAfterIso: string;
  skipped: string[];
  withheldKinds: readonly string[];
}): readonly FrozenFile[] {
  const paths = stateHomePaths({ home });
  const key = `${askIdentity.channel}-${askIdentity.messageTs}`;
  const checkpoints = checkpointWindow({ dir: `${paths.live.slack.checkpoints}/${key}`, notAfterIso });
  const files: FrozenFile[] = [
    {
      contents: redactedAskLog({ denylist, events, home, ids }),
      relativePath: relativeToHome({ home, path: paths.live.slack.asksJsonl }),
    },
  ];
  appendCompletionLedger({ askIdentity, denylist, events, files, home, ids, notAfterIso });
  const sources = [
    ...freezeSources({ askIdentity, home }),
    ...freezeDirectorySources({
      askIdentity,
      checkpointEntries: checkpoints.entries,
      detectiveWaves: entriesOf({ dir: `${paths.live.slack.detectives}/${key}` }),
      home,
      reviewEntries: entriesOf({ dir: `${paths.live.slack.reviews}/${key}` }),
    }),
  ];
  // The standing verdict declares no instant of its own, so the record naming it is what dates it.
  let reviewRecordWithheld = false;
  for (const source of sources) {
    if (!existsSync(source.from)) {
      continue;
    }
    const withheld = withholdReason({ notAfterIso, reviewRecordWithheld, source, withheldKinds });
    if (withheld !== undefined) {
      skipped.push(`${source.to} — ${withheld}`);
      reviewRecordWithheld = reviewRecordWithheld || source.to.endsWith("/record.json");
      continue;
    }
    const redacted = redactedSource({ checkpointLogLines: checkpoints.logLines, denylist, home, ids, source });
    if (redacted !== undefined) {
      files.push({ contents: redacted, relativePath: source.to });
    }
  }
  const answer = answerPathOf({ askIdentity, home, notAfterIso, skipped });
  return answer === undefined ? files : withComposedAnswer({ answer, askIdentity, denylist, files, home, ids });
}

/**
 * Append the ask's own lines out of the turn-completion ledger, redacted, when it has any inside the window.
 *
 * Rewritten, never copied: the ledger holds every turn on the machine. `selectCompletionLines` says why a
 * fixture needs it at all — it is the only record of the cards a non-answered turn left standing, and why the
 * THREAD widens it to the answered turns a correction may supersede.
 *
 * The thread is DERIVED from this ask's own lifecycle lines rather than taken as a flag, because every one of
 * them already carries `threadTs` while `AskFileKey` deliberately does not: its own doc says `threadTs` has
 * never been part of a filename, so requiring it there would make every freeze demand a field it does not
 * use. An ask whose lines name no thread simply keeps the ask-only behaviour.
 *
 * @param askIdentity the ask being frozen
 * @param denylist the private org-word list
 * @param events the ask's own selected lifecycle lines — read here only for the thread they name
 * @param files the fixture's files so far, appended to
 * @param home the live state home
 * @param ids the working id map, extended in place
 * @param notAfterIso the instant this freeze's window closes at
 */
function appendCompletionLedger({
  askIdentity,
  denylist,
  events,
  files,
  home,
  ids,
  notAfterIso,
}: {
  askIdentity: AskFileKey;
  denylist: readonly string[];
  events: readonly string[];
  files: FrozenFile[];
  home: string;
  ids: FixtureIdMap;
  notAfterIso: string;
}): void {
  const threadTs = events
    .map((line) => readStringFieldOfLine({ field: "threadTs", line }))
    .find((value) => value !== undefined);
  const lines = selectCompletionLines({
    channel: askIdentity.channel,
    messageTs: askIdentity.messageTs,
    notAfterIso,
    text: readTurnCompletionText({ home }),
    threadTs,
  });
  if (lines.length === 0) {
    return;
  }
  files.push({
    contents: redactJsonLines({ denylist, home, ids, raw: lines.join("\n") }),
    relativePath: relativeToHome({ home, path: completionLogPath({ home }) }),
  });
}

/**
 * The ask's own lifecycle lines, redacted and re-collapsed to one line each.
 *
 * @param denylist the private org-word list
 * @param events the ask's selected lines, in log order
 * @param home the live state home
 * @param ids the working id map, extended in place
 * @returns the redacted log text
 */
function redactedAskLog({
  denylist,
  events,
  home,
  ids,
}: {
  denylist: readonly string[];
  events: readonly string[];
  home: string;
  ids: FixtureIdMap;
}): string {
  const askLines = events.map((line) => {
    const redacted = redactJsonDocument({ denylist, home, ids, raw: line });
    // One line, not two: the log is line-delimited, so the pretty-printed form has to be collapsed back.
    return redacted === undefined ? line : JSON.stringify(JSON.parse(redacted));
  });
  return `${askLines.join("\n")}\n`;
}

/**
 * One source file's frozen contents — read, windowed if it is the checkpoint log, and redacted.
 *
 * A `.jsonl` source is line-delimited, so it goes through the redaction one line at a time: the whole file
 * will never parse as one document, and handing it to {@link redactJsonDocument} would silently drop it. The
 * checkpoint log is additionally TRIMMED to its own window rather than read off disk, because a draft's
 * bytes declare no instant and the log is the only thing that can date one.
 *
 * @param checkpointLogLines the checkpoint log's already-windowed lines
 * @param denylist the private org-word list
 * @param home the live state home
 * @param ids the working id map, extended in place
 * @param source the file being frozen
 * @returns the redacted contents, or `undefined` when the document will not parse
 */
function redactedSource({
  checkpointLogLines,
  denylist,
  home,
  ids,
  source,
}: {
  checkpointLogLines: readonly string[];
  denylist: readonly string[];
  home: string;
  ids: FixtureIdMap;
  source: { readonly from: string };
}): string | undefined {
  const raw = source.from.endsWith(`/${CHECKPOINT_LOG_FILE}`)
    ? `${checkpointLogLines.join("\n")}\n`
    : readFileSync(source.from, "utf8");
  if (source.from.endsWith(".jsonl")) {
    return redactJsonLines({ denylist, home, ids, raw });
  }
  return redactJsonDocument({ denylist, home, ids, raw });
}

/**
 * Scan everything a freeze is about to commit, through the same gate CI runs.
 *
 * @param files the frozen files, fixture-relative
 * @returns every hit, in file order — empty means the fixture is safe to write
 */
export function scanFrozenFiles({
  files,
  denylist,
}: {
  files: readonly FrozenFile[];
  denylist: readonly string[];
}): readonly string[] {
  return files.flatMap((file) =>
    scanContent({ content: file.contents, denylist, path: file.relativePath }).map(
      (hit) => `${hit.path}:${String(hit.line)}: [${hit.label}] ${hit.excerpt}`,
    ),
  );
}
