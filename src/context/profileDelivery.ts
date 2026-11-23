/**
 * Whether one session's CURRENT context — or one of its subagents' — holds the owner's profile: the one fact every gate that
 * holds a session without it reads, as one marker file per context under `$SLOPWEAVER_HOME/profile/delivered/`.
 *
 * The owner would rather a session do nothing than act misaligned for them, and a lost profile load must recover
 * automatically. MEASURED once: all seven sessions `profile-unloaded` named had their profile hook killed by `scripts/hook.sh`'s envelope at 7s while node booted under
 * load, and each carried on without the profile.
 *
 * ## Why a marker, and why it is removed BEFORE the load
 *
 * The load ledger (`./loadLedger.ts`) is history: it can say a load failed only when something wrote that down, and a
 * hook killed mid-boot writes nothing. A marker inverts that. `hooks/profile-context.sh` removes it with a bash builtin
 * before it resolves a root or starts node, on every `SessionStart` (startup, resume, clear and compact each reset
 * what the context holds), and it is written back only after a block carrying the owner's profile was printed. So a hook
 * killed anywhere in between leaves NO marker, and the session is held until its own next action reloads it
 * (`../admit/profileHeldRunner.ts`, `../cli/commands/claude/seatProfile.ts`). A false "absent" costs one reload; a false
 * "present" is the defect, so nothing writes the marker before the output it vouches for.
 *
 * ## Why the marker is tied to the transcript, too
 *
 * The removal is a step of the `SessionStart` hook, so a hook that never BEGINS removes nothing, and the marker from
 * before a compaction would vouch for the context the compaction replaced. So the marker also
 * records how far into the session's transcript it has been checked, and a reader scans only the bytes past that for
 * a compaction record — Claude Code's `"subtype":"compact_boundary"`, Codex's `"type":"compacted"`, both unescaped, so
 * a quoted copy inside a message never matches. One there means the context it vouched for is gone: not delivered.
 * Each check advances the offset to the last whole line it scanned, so a guarded call reads only what the turn before
 * it appended.
 *
 * A transcript that cannot be read when the profile is delivered is recorded as `unread` rather than refused: refused,
 * the delivery would go unmarked and every reload be held again, a loop with no exit. Such a
 * marker vouches for ONE call, the retry its delivery asked for, and is spent by that read: no compaction past it can
 * be seen, so every later call is held and handed the owner's profile afresh. It stops counting the moment the transcript can
 * be read, so the next reload marks a real offset. A numbered marker whose transcript then fails to read is an error,
 * so the caller holds and its reload writes `unread`.
 *
 * A compaction's OWN `SessionStart` runs before its boundary is appended — MEASURED in a session
 * transcript: the `SessionStart:compact` hooks ran about 40 s before the boundary they answered was
 * stamped. So a marker written there expects one boundary, and the first one past it is that compaction's,
 * provided it lands before the next model turn (`"role":"assistant"`); a turn first means the boundary was already in
 * the file, and the expectation lapses. Repro: `grep -n '"subtype":"compact_boundary"\|SessionStart:compact'` over a
 * compacted transcript, then compare each boundary's `timestamp` with its hooks' `timestamp` minus `durationMs`.
 *
 * ## One marker per CONTEXT, not per session
 *
 * A subagent is a context of its own inside its parent's session: MEASURED once, a main session
 * transcript carried the owner's profile heading 32 times and each of its two subagent transcripts 0. Both hosts mark a
 * subagent's hook payload with `agent_id` and leave it off every main-thread one — Claude Code 2.1.299's hook input
 * schema ("Present only when the hook fires from within a subagent"), and the `pre-tool-use.command.input` schema the
 * vendored Codex binary carries. Repro: `strings ~/.local/share/claude/versions/2.1.299 | grep -o '.\{60\}agent_id:.\{140\}'`.
 * So {@link deliveryContextOf} names a subagent's context apart, and its first guarded call is held and handed the owner's
 * profile rather than passing on its parent's marker. The agent id is HASHED into a fixed-length name, so whatever
 * either host puts there stays inside the grammar and inside a filename's length.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { stateHomePaths } from "../stateHome.js";
import { type ProfileDeliveryError, ProfileDeliveryErrors } from "./profileDeliveryErrors.js";
import { transcriptBytesFrom, transcriptLastWholeLineEnd } from "./transcriptBytes.js";

/** A session id a marker may be named for — the grammar `hooks/lib/seat-pass.sh` and `hooks/profile-context.sh` match. */
const SESSION_ID_GRAMMAR = /^[0-9A-Za-z-]{1,128}$/u;

/** How many hex characters of the agent id's sha256 name a subagent's context: 128 bits, a fixed length. */
const AGENT_HASH_HEX = 32;

/** The marker's first line, so a file written by anything else reads as no marker. */
const MARKER_VERSION = "profile-delivered v1";

/** The compaction records each host appends to its transcript. */
const BOUNDARY_NEEDLES: readonly Buffer[] = [
  Buffer.from('"subtype":"compact_boundary"', "utf8"),
  Buffer.from('"type":"compacted"', "utf8"),
];

/** A model turn, in either host's transcript. */
const TURN_NEEDLE = Buffer.from('"role":"assistant"', "utf8");

/**
 * How a ledger row's reason opens when the owner's profile was delivered but its marker could not be written — so every retry
 * is held again, which the `profile-unloaded` monitor names apart from a reload in flight.
 */
export const MARKER_UNWRITTEN_REASON = "delivered, but ";

/** The context a hook payload speaks for, and what its marker is checked against. */
export interface DeliveryContext {
  /** The marker's name: the session id on a main thread, the session plus a hash of `agent_id` in a subagent. */
  readonly id: string;
  /** The transcript the host named in `transcript_path`, `undefined` when it named none. */
  readonly transcriptPath: string | undefined;
  /** True for a compaction's `SessionStart`, which runs before that compaction's boundary is appended. */
  readonly awaitsBoundary: boolean;
}

/**
 * The context a hook payload speaks for: its `session_id` on a main thread, and that session's subagent named apart
 * when the payload carries an `agent_id`.
 *
 * @param payload the parsed hook payload
 * @returns the context, or `undefined` when the payload names no session a marker can be keyed on
 */
export function deliveryContextOf({ payload }: { payload: unknown }): DeliveryContext | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const sessionId = payload["session_id"];
  if (typeof sessionId !== "string" || !SESSION_ID_GRAMMAR.test(sessionId)) {
    return undefined;
  }
  const transcript = payload["transcript_path"];
  const transcriptPath = typeof transcript === "string" && transcript.length > 0 ? transcript : undefined;
  const awaitsBoundary = payload["hook_event_name"] === "SessionStart" && payload["source"] === "compact";
  const agentId = payload["agent_id"];
  if (typeof agentId !== "string" || agentId.length === 0) {
    return { awaitsBoundary, id: sessionId, transcriptPath };
  }
  const hash = createHash("sha256").update(agentId, "utf8").digest("hex").slice(0, AGENT_HASH_HEX);
  return { awaitsBoundary, id: `${sessionId}-agent-${hash}`, transcriptPath };
}

/**
 * What a marker records: the transcript it was checked against, how far — or `"unread"` when that transcript could not
 * be read at delivery — and whether a boundary is still due.
 */
interface MarkerState {
  readonly transcript: string | undefined;
  readonly offset: number | "unread";
  readonly awaitsBoundary: boolean;
}

/**
 * Write a marker's text.
 *
 * @param state what it records
 * @returns the file's contents
 */
function markerText({ state }: { state: MarkerState }): string {
  // A host that named no transcript is recorded as an empty line, which `parseMarker` reads back as `undefined`.
  let transcriptLine = "";
  if (state.transcript !== undefined) {
    transcriptLine = state.transcript;
  }
  return [
    MARKER_VERSION,
    String(state.offset),
    state.awaitsBoundary ? "awaits-boundary" : "settled",
    transcriptLine,
    "",
  ].join("\n");
}

/**
 * Read a marker's text back.
 *
 * @param text the file's contents
 * @returns what it records, or `undefined` for anything this module did not write
 */
export function parseMarker({ text }: { text: string }): MarkerState | undefined {
  const [version, offset, boundary, transcript, ...rest] = text.split("\n");
  if (version !== MARKER_VERSION || offset === undefined || transcript === undefined) {
    return undefined;
  }
  if (offset !== "unread" && !/^\d+$/u.test(offset)) {
    return undefined;
  }
  if ((boundary !== "awaits-boundary" && boundary !== "settled") || rest.join("") !== "") {
    return undefined;
  }
  if (offset === "unread" && transcript === "") {
    return undefined;
  }
  return {
    awaitsBoundary: boundary === "awaits-boundary",
    offset: offset === "unread" ? "unread" : Number(offset),
    transcript: transcript === "" ? undefined : transcript,
  };
}

/**
 * Judge the transcript bytes appended since a marker was last checked. Only WHOLE lines are judged, so a record the
 * host is still writing is read on the next check rather than skipped.
 *
 * @param bytes the transcript from the marker's offset to its end
 * @param awaitsBoundary whether the marker still expects its own compaction's boundary
 * @returns whether a compaction replaced the context, how many bytes were judged, and whether a boundary is still due
 */
export function judgeTranscriptDelta({ bytes, awaitsBoundary }: { bytes: Buffer; awaitsBoundary: boolean }): {
  compacted: boolean;
  judged: number;
  awaitsBoundary: boolean;
} {
  const judged = bytes.lastIndexOf(0x0a) + 1;
  const region = bytes.subarray(0, judged);
  const found: number[] = [];
  for (const needle of BOUNDARY_NEEDLES) {
    for (let at = region.indexOf(needle); at !== -1; at = region.indexOf(needle, at + needle.length)) {
      found.push(at);
    }
  }
  const boundaries = found.toSorted((a, b) => a - b);
  const firstTurn = region.indexOf(TURN_NEEDLE);
  let pending = awaitsBoundary;
  let unexplained = boundaries.length;
  const first = boundaries[0];
  if (pending && first !== undefined && (firstTurn === -1 || first < firstTurn)) {
    unexplained -= 1;
    pending = false;
  } else if (pending && firstTurn !== -1) {
    pending = false;
  }
  return { awaitsBoundary: pending, compacted: unexplained > 0, judged };
}

/** A marker's file name: a session id, or one with its subagent's hash appended. Never a path separator. */
const CONTEXT_ID_GRAMMAR = /^[0-9A-Za-z-]{1,200}$/u;

/**
 * The marker file one context's delivery is recorded in.
 *
 * @param home the Slopweaver home
 * @param contextId the context's name
 * @returns the path, or why the name is not one {@link deliveryContextOf} could have produced
 */
function profileDeliveryPath({
  home,
  contextId,
}: {
  home: string;
  contextId: string;
}): Result<string, ProfileDeliveryError> {
  if (!CONTEXT_ID_GRAMMAR.test(contextId)) {
    return err(ProfileDeliveryErrors.contextIdInvalid({ contextId }));
  }
  return ok(join(stateHomePaths({ home }).profileDeliveredDir, contextId));
}

/**
 * Whether this context holds the owner's profile: its marker is there, names the transcript the host names now, and no
 * compaction has been appended to that transcript since — advancing the marker past what this check read.
 *
 * @param home the Slopweaver home
 * @param context the context {@link deliveryContextOf} named
 * @returns true when it holds the owner's profile, or why the marker or transcript could not be read — a caller holds on that
 */
export function profileWasDelivered({
  home,
  context,
}: {
  home: string;
  context: DeliveryContext;
}): Result<boolean, ProfileDeliveryError> {
  const located = profileDeliveryPath({ contextId: context.id, home });
  if (located.isErr()) {
    return err(located.error);
  }
  const path = located.value;
  const marker = readMarker({ path });
  if (marker.isErr()) {
    return err(marker.error);
  }
  const state = marker.value;
  if (state === undefined || state.transcript !== context.transcriptPath) {
    return ok(false);
  }
  if (state.transcript === undefined) {
    // The host named no transcript, here or when the marker was written: there is no record to read a compaction in.
    return ok(true);
  }
  if (state.offset === "unread") {
    return ok(spendUnreadMarker({ path, transcript: state.transcript }));
  }
  return judgeSinceMarker({
    awaitsBoundary: state.awaitsBoundary,
    offset: state.offset,
    path,
    transcript: state.transcript,
  });
}

/**
 * A marker's recorded state.
 *
 * @param path the marker file
 * @returns what it records; `undefined` when there is none, or it is not one this module wrote; or why it could not
 *   be read
 */
function readMarker({ path }: { path: string }): Result<MarkerState | undefined, ProfileDeliveryError> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return ok(undefined);
    }
    return err(ProfileDeliveryErrors.markerUnreadable({ cause, path }));
  }
  return ok(parseMarker({ text }));
}

/**
 * Spend a marker written while its transcript could not be read. No compaction past it can be seen, so it vouches for
 * ONE call — the retry the delivery asked for — and that read removes it, so every later call is held and handed the owner's
 * profile afresh rather than trusting a context nothing can check. Readable again, it is no marker at all, and the next
 * reload marks a real offset. Never refused outright: that would hold a context no reload could release.
 *
 * @param path the marker file
 * @param transcript the transcript it could not read
 * @returns whether this call may pass
 */
function spendUnreadMarker({ path, transcript }: { path: string; transcript: string }): boolean {
  try {
    rmSync(path, { force: true });
  } catch {
    return false;
  }
  return transcriptLastWholeLineEnd({ path: transcript }).isErr();
}

/**
 * Judge what the transcript appended since the marker's offset, and advance the marker past it.
 *
 * @param path the marker file
 * @param transcript the transcript the marker was checked against
 * @param offset how far its last check read
 * @param awaitsBoundary whether it still expects its own compaction's boundary
 * @returns true when no compaction replaced the context, or why the transcript could not be read
 */
function judgeSinceMarker({
  path,
  transcript,
  offset,
  awaitsBoundary,
}: {
  path: string;
  transcript: string;
  offset: number;
  awaitsBoundary: boolean;
}): Result<boolean, ProfileDeliveryError> {
  const delta = transcriptBytesFrom({ offset, path: transcript });
  if (delta.isErr()) {
    return err(delta.error);
  }
  if (delta.value === undefined) {
    // Shorter than the offset the marker recorded: not the transcript it was checked against.
    return ok(false);
  }
  const judged = judgeTranscriptDelta({ awaitsBoundary, bytes: delta.value });
  if (judged.compacted) {
    return ok(false);
  }
  if (judged.judged > 0 || judged.awaitsBoundary !== awaitsBoundary) {
    // Best effort: a marker that did not advance only costs the next check a longer read.
    writeMarker({
      path,
      state: { awaitsBoundary: judged.awaitsBoundary, offset: offset + judged.judged, transcript },
    });
  }
  return ok(true);
}

/**
 * Record that this context now holds the owner's profile. Call it only AFTER the block was written out.
 *
 * @param home the Slopweaver home
 * @param context the context the profile was delivered into
 * @returns the marker path, or why it could not be written — a caller treats that as not delivered
 */
export function markProfileDelivered({
  home,
  context,
}: {
  home: string;
  context: DeliveryContext;
}): Result<string, ProfileDeliveryError> {
  const located = profileDeliveryPath({ contextId: context.id, home });
  if (located.isErr()) {
    return err(located.error);
  }
  const path = located.value;
  let offset: number | "unread" = 0;
  if (context.transcriptPath !== undefined) {
    // A transcript that cannot be read is recorded as such, never refused: refusing would leave the delivery it vouches
    // for unmarked, so the context would be held, reloaded and refused again forever.
    const end = transcriptLastWholeLineEnd({ path: context.transcriptPath });
    offset = end.isOk() ? end.value : "unread";
  }
  try {
    mkdirSync(stateHomePaths({ home }).profileDeliveredDir, { mode: 0o700, recursive: true });
  } catch (cause) {
    return err(ProfileDeliveryErrors.markerUnwritable({ cause, path }));
  }
  const written = writeMarker({
    path,
    state: { awaitsBoundary: context.awaitsBoundary, offset, transcript: context.transcriptPath },
  });
  return written.map(() => path);
}

/**
 * Replace a marker atomically, so a concurrent reader never meets half of one.
 *
 * @param path the marker file
 * @param state what it records
 * @returns nothing, or why it could not be written
 */
function writeMarker({ path, state }: { path: string; state: MarkerState }): Result<undefined, ProfileDeliveryError> {
  try {
    writeFileAtomic({ contents: markerText({ state }), fileMode: 0o600, path });
  } catch (cause) {
    return err(ProfileDeliveryErrors.markerUnwritable({ cause, path }));
  }
  return ok(undefined);
}
