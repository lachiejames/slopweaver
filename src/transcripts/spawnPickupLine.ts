/**
 * The one line `cmux spawn` types into a session it booted, and the one reader that knows it — kept in one module so
 * the generator and the reader cannot drift apart, the shape `./fleetNudge.ts` set.
 *
 * `cmux send` types the line as a keystroke would, and Claude Code wraps a line that long in a `<pasted_content>`
 * paste, so the record reads `promptSource: "typed"` and `origin.kind: "human"`: nothing structural separates it from
 * the owner's own turn, and its text is the only signal. MEASURED on a supervisor chair: its spawn pickup
 * was read as the owner's turn, the console voice was
 * handed it as the owner's words, and it opened by telling the owner they had pasted the handover and kicked it off,
 * which they had not. Reproduce with `slopweaver talk supervisor --json` on a chair whose tail still
 * holds its spawn line, before this reader.
 *
 * The reader matches the WHOLE line: the stable head locates the doc path, the verb and the slug, and the line is then
 * rebuilt with {@link pickupLine} and compared byte for byte, so a sentence of the owner's before or after it, or an older
 * template's wait wording, is never dropped. The two older templates it also rebuilds are the lines earlier seats
 * received ({@link RETIRED_WAIT_RULE} in place of the current wait sentence, and that one after
 * {@link RETIRED_SIDEBAR_SENTENCE}): a chair spawned on one keeps that line in its transcript tail, and reading it as
 * the owner's turn is the same incident again.
 * One complete paste wrapper may surround it. The
 * residue, stated rather than discovered: a person who pastes a generated pickup verbatim into a chat reads as the
 * fleet, because no record field tells the two apart. What that drops is the generated instruction, never words of the owner's.
 *
 * A seat spawned with `cmux spawn --dir` or `--home` is told the SAME lifecycle command with the same flags, so its
 * `handover start` reads the board and the state home its doc was found on. MEASURED: a `--dir` seat was typed a bare
 * `slopweaver handover start <slug>`, which resolved the ambient board, could not find the doc, and failed
 * (`spawnPickupLine.test.ts` composes the located line). The flags are shell-quoted (`#lib/shellCommandLine.js`) and read back with the
 * repo's own lexer (`../admit/shellLexing.ts`), so a path holding a space or an apostrophe survives the round trip;
 * the byte-for-byte rebuild still decides. Residue: a quoted flag value that itself holds the words
 * `, then execute the doc. It is complete;` splits early and reads as a person's turn.
 *
 * Pure: `../cmux/pickupCommand.ts` imports the line it emits from here.
 */
import { shellCommandLine } from "#lib/shellCommandLine.js";

import { shellWords } from "../admit/shellLexing.js";

/**
 * The one sentence every spawned session is told about waiting on something else to finish.
 *
 * Measured: two spawned handover-doc sessions burned a model turn per tick waiting on work they
 * had already started — one ran 51 minutes of "Waiting." turns each executing
 * a bare `true`, and another looped `sleep 115; tail -20
 * <task output>` for 1h17m. Neither cost was necessary: a backgrounded wait's own completion re-invokes the
 * session for free. That fixed the turns and left the SEAT: a backgrounded CI or clock wait keeps a workspace
 * open doing nothing, and `session close-done` cannot tell its shell from real work. Observed: ten open workspaces and two working agents. No session stays open
 * unless it is doing work.
 * So a wait the seat would sit idle through is a park that names its wake, and `handover wake` reseats it.
 *
 * Its OWN pull request's CI is not such a wait. It is a massive bug if a
 * session does ninety-nine percent of the work, gets to the last one percent and says bye; waiting for CI is part
 * of doing work, rebasing is, fixing red CI is, and landing the PR is. MEASURED: told to park on CI, a
 * seat parked itself on its own checks seven times in 25 hours, each reseat two to six hours behind a
 * nine-minute lap (`../handover/ownLandingPark.ts` carries the repro). So the seat waits on its own landing in one
 * bounded background `github checks --wait` and keeps its seat, and `handover park` refuses that wake outright.
 *
 * No backticks: this text is pasted into a live surface, and a backtick reaching a shell is substituted before
 * anything sees it (shell semantics: a backtick outside single quotes runs its contents as a command).
 *
 * The line carries no instruction to publish a cmux sidebar checklist or status lane: the owner reads neither
 * and depends on Queue cards and floating notes, because producing a sidebar checklist and status is a waste
 * of tokens.
 */
export const WAIT_RULE_INSTRUCTION =
  "Never sleep-poll in the foreground. A short wait inside active work (a test, a push, a Codex pass) runs as a " +
  "bounded background job whose completion resumes you. Your own pull request's CI, a rebase, a red-CI fix and " +
  "landing it are the work, so keep your seat through them: wait with slopweaver github checks --number N --repo " +
  "owner/repo --wait as a background job, or --until merge once it is queued, and never park on your own pull " +
  "request. Only a clock, or another branch's pull request, you would sit idle through closes your seat: " +
  "slopweaver handover park <slug> --wake-at <UTC instant ending in Z>, or --wake-on-checks owner/repo#N, and the " +
  "supervisor reseats you once it is due. A second read of the same log, pid or task within 60s is refused by the " +
  "poll gate.";

/**
 * The wait sentence earlier seats received, which told a seat to park on its own pull request's CI.
 * No seat is told it any more; it is spelled here only so {@link isSpawnPickupLine} still recognises a line already
 * typed into a transcript.
 */
const RETIRED_WAIT_RULE =
  "Never sleep-poll in the foreground. A short wait inside active work (a test, a push, a Codex pass) runs as a " +
  "bounded background job whose completion resumes you. A CI or clock wait you would sit idle through closes " +
  "your seat instead: slopweaver handover park <slug> --wake-on-checks owner/repo#N, or --wake-at " +
  "<UTC instant ending in Z>, and the supervisor reseats you once it is due. A second read of the same log, pid " +
  "or task within 60s is refused by the poll gate.";

/**
 * The sentence the pickup line carried before sidebar publication was removed. No seat
 * is told it any more; it is spelled here only so {@link isSpawnPickupLine} still recognises a line already typed.
 */
const RETIRED_SIDEBAR_SENTENCE =
  "Publish progress as you go: slopweaver cmux todo start|check <id> as each checklist item moves, and " +
  "slopweaver cmux status set needs-attention|review when you park on the owner or finish.";

/**
 * The stable head of {@link pickupLine}: a doc path ending `.md`, the lifecycle verb, and a slug in the shape the run
 * store accepts (`../handover/runStore.ts`'s `SAFE_SLUG`). The path is otherwise anything — relative, holding a space
 * or a line break — because `cmux spawn --dir` types it as given, and greedy, so a path
 * that itself holds this head's words still splits at the real one. The byte-for-byte rebuild, not the head, decides.
 */
const PICKUP_HEAD =
  /^Read ([\s\S]*\.md) end to end, then run: slopweaver handover (start|resume) ([A-Za-z0-9][A-Za-z0-9._-]*)((?: [\s\S]*?)?), then execute the doc\. It is complete; /u;

/**
 * Where a spawned seat's lifecycle verb must look: the docs directory and the state home `cmux spawn` was EXPLICITLY
 * given. An absent member is a flag the spawn was not given, so the seat resolves its default exactly as before.
 */
export interface SpawnPickupLocation {
  readonly dir?: string;
  readonly home?: string;
}

/**
 * The location flags, in their one order, as argv words.
 *
 * @returns `--dir <dir>` then `--home <home>`, each only when present
 */
function locationArgv({ location }: { location: SpawnPickupLocation }): readonly string[] {
  return [
    ...(location.dir === undefined ? [] : ["--dir", location.dir]),
    ...(location.home === undefined ? [] : ["--home", location.home]),
  ];
}

/**
 * The location a generated tail spells, or `undefined` when it is not exactly one the generator writes: nothing,
 * `--dir X`, `--home X`, or both in that order, every value literal.
 */
function locationOfTail({ tail }: { tail: string }): SpawnPickupLocation | undefined {
  if (tail === "") {
    return {};
  }
  const lexed = shellWords({ text: tail });
  if (lexed.unterminated || lexed.splitsWord || lexed.words.some((word) => word.dynamic)) {
    return undefined;
  }
  const words = lexed.words.map((word) => word.text);
  let location: { dir?: string; home?: string } = {};
  let index = 0;
  if (words[index] === "--dir" && words[index + 1] !== undefined) {
    location = { dir: words[index + 1]! };
    index += 2;
  }
  if (words[index] === "--home" && words[index + 1] !== undefined) {
    location = { ...location, home: words[index + 1]! };
    index += 2;
  }
  if (index !== words.length) {
    return undefined;
  }
  return location;
}

/**
 * One complete paste wrapper as Claude Code writes it round a long typed line: an optional id on the opening tag,
 * repeated (or not) on the closing one, and one structural newline inside each edge.
 */
const PASTE_WRAPPER = /^<pasted_content(?: id="([^"]*)")?>\n?([\s\S]*?)\n?<\/pasted_content(?: id="([^"]*)")?>$/u;

/**
 * The exact line to send to a freshly booted session, wrapped as a self-executing instruction rather than a bare CLI
 * line — a bare `slopweaver handover start <slug>` is exactly what three spawned sessions saw in 24h (measured), ran, read "0 probe(s) to satisfy" as "nothing specified", and asked the owner what the task was, even though
 * the doc on disk was complete every time. {@link WAIT_RULE_INSTRUCTION} rides here, because this is the one line
 * every spawned session receives.
 *
 * @param docPath the doc's absolute path, named so a freshly booted session is told to READ it
 * @param verb `start` for a doc with no resumable run, `resume` for one with
 * @param slug the doc's slug, for the lifecycle verb
 * @param location the `--dir` and `--home` the spawn was explicitly given, carried onto the lifecycle verb
 * @returns the exact line; with an empty location, the line every earlier seat received
 */
export function pickupLine({
  docPath,
  verb,
  slug,
  location,
}: {
  docPath: string;
  verb: "start" | "resume";
  slug: string;
  location: SpawnPickupLocation;
}): string {
  const lifecycle = shellCommandLine({
    command: ["slopweaver", "handover", verb, slug, ...locationArgv({ location })],
  });
  return (
    `Read ${docPath} end to end, then run: ${lifecycle}, then execute the doc. ` +
    `It is complete; do not re-plan or ask what it covers. ${WAIT_RULE_INSTRUCTION}`
  );
}

/**
 * The line inside one complete paste wrapper, or the text itself when it carries none. A closing id that differs
 * from the opening one is no wrapper Claude Code wrote, so the text is returned whole and will not match.
 */
function unwrappedBody({ text }: { text: string }): string {
  const match = PASTE_WRAPPER.exec(text);
  if (match === null) {
    return text;
  }
  const [, openId, body, closeId] = match;
  if (closeId !== undefined && closeId !== openId) {
    return text;
  }
  return body!;
}

/**
 * Whether a turn's text is exactly the line `cmux spawn` typed, bare or inside one paste wrapper, rather than a
 * person's words.
 *
 * @param text the turn's text with its edge White_Space already trimmed
 * @returns true only for the current template or one of the two it replaced, whole
 */
export function isSpawnPickupLine({ text }: { text: string }): boolean {
  const body = unwrappedBody({ text });
  const head = PICKUP_HEAD.exec(body);
  if (head === null) {
    return false;
  }
  const [, docPath, verb, slug, tail] = head;
  const location = locationOfTail({ tail: tail!.trimStart() });
  if (location === undefined) {
    return false;
  }
  const current = pickupLine({
    docPath: docPath!,
    location,
    slug: slug!,
    verb: verb === "start" ? "start" : "resume",
  });
  const lead = current.slice(0, -WAIT_RULE_INSTRUCTION.length);
  const templates = [current, `${lead}${RETIRED_WAIT_RULE}`, `${lead}${RETIRED_SIDEBAR_SENTENCE} ${RETIRED_WAIT_RULE}`];
  return templates.includes(body);
}
