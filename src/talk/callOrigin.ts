/**
 * Which console a call was served from, stamped on its `open` line by the SERVER — and whether that console is the owner's.
 *
 * A seat witnessing its branch's console on `localhost:3001` played a `say` WAV into a Playwright Chromium, and two
 * calls landed in the owner's real `$SLOPWEAVER_HOME/talk/calls/` as the owner's speech and nothing saying where they
 * came from. `talk unread` relayed them to the chair as the owner's words, and the chair marked them the owner's intake.
 *
 * Two halves close it. The transcript and relay verbs REFUSE a write into the live home from a console that is not
 * the owner's (`../cli/commands/talk/consoleOrigin.ts`), and every call a console opens carries this origin, so a call
 * that got through anyway — under the hatch — is visible as not the owner's, and `talk unread` sets it aside rather
 * than handing it to the chair (`./unreadWords.ts`), and a `talk-call:` anchor naming one of its stretches does not
 * resolve to the owner's words (`../handover/hisWordsResolve.ts`) — so a calendar commit or a draft approval never
 * takes it as the owner's yes.
 *
 * The owner's console is the one served from the owner's main checkout — a main worktree git CONFIRMS, which the
 * owner's profile declares — on the console's default port; `mainWorktree` records the first half. The checkout half
 * is the durable identity, since every seat works in a linked worktree and any clone is a main worktree of itself; the
 * port half catches a second server started in the owner's checkout. Both fail closed: a checkout whose git topology
 * cannot be read is not the owner's (an unreadable `.git` would make a linked worktree on :3000 read as the owner's).
 * Neither is supplied by the page: the route derives both.
 *
 * The desktop TEST instance (`slopweaver desktop e2e --call`) speaks into the owner's own console, so the server half
 * alone would read its calls as the owner's. Its window says so instead: the desktop shell hands it an exact marker,
 * the page sends it with every transcript batch, and the transcript verb stamps `instance: "e2e"` beside the
 * server-derived fields. A marked origin is never the owner's, so every reader of the owner's words passes the call
 * over; it may still record into the live home, since that is what the walk proves, but it never lands a card, wakes
 * the chair or relays.
 *
 * Pure: no filesystem, no clock.
 */
import { z } from "zod";

import type { CallEntry } from "./callRecord.js";
import { entriesNotHeld } from "./callWriteIds.js";

/** The longest checkout path an origin may carry. */
const ORIGIN_ROOT_CHARS = 1000;

const port = z.number().int().min(1).max(65_535);

/**
 * An origin as an `open` line carries it. Strict and uncoerced: a present origin that fails this makes its line
 * unparseable rather than reading as absent, since absent is a legacy call trusted as the owner's.
 */
export const callOriginSchema = z
  .object({
    checkoutRoot: z.string().min(1).max(ORIGIN_ROOT_CHARS),
    defaultPort: port,
    // The owner's main checkout: a main worktree git confirms that the owner's profile declares, not merely any main worktree.
    mainWorktree: z.boolean(),
    port,
    // The desktop TEST instance (`slopweaver desktop e2e --call`) placed it: never the owner's words, whatever console
    // served it. Absent on every call the owner's own app places and on every call written before it existed.
    instance: z.literal("e2e").optional(),
  })
  .strict();

/** Where a call was served from. */
export type CallOrigin = z.infer<typeof callOriginSchema>;

/**
 * Whether a call's origin is the owner's console: the owner's declared main checkout, on the console's default port —
 * and not the desktop test instance, whose calls are a walk's own speech even when they reach the owner's console.
 *
 * @param origin where the call was served from
 * @returns whether that is the owner's console
 */
export function isOwnerConsoleOrigin({ origin }: { origin: CallOrigin }): boolean {
  return origin.instance === undefined && servedByOwnerConsole({ origin });
}

/**
 * Whether the SERVER half of an origin is the owner's console — the owner's main checkout on the default port —
 * whatever instance placed the call. Only the transcript verb asks this, to let the desktop test instance record into
 * the live home under its own marker (`../cli/commands/talk/consoleOrigin.ts`); it is never an answer to whose words a
 * call holds.
 *
 * @param origin where the call was served from
 * @returns whether the owner's console served it
 */
export function servedByOwnerConsole({ origin }: { origin: CallOrigin }): boolean {
  return origin.mainWorktree && origin.port === origin.defaultPort;
}

/**
 * Whether a call's words are the owner's to read as theirs: a call with no origin predates the stamp and is trusted,
 * exactly as every call written before the stamp was; a stamped one is the owner's only from the owner's console.
 *
 * @param origin where the call was served from, or `undefined` for a call whose open line carries none
 * @returns whether its owner-side speech may be read as the owner's
 */
export function isOwnerCallOrigin({ origin }: { origin: CallOrigin | undefined }): boolean {
  return origin === undefined || isOwnerConsoleOrigin({ origin });
}

/**
 * The first console that is not the owner's under which ANY line of one stretch was written — the last `open` before
 * that line. Every line, not only the first: a later snapshot of the same id replaces the folded text, so a stretch
 * begun on the owner's console and finished under another's reads as the other's words.
 *
 * @param entries the call's lines, in file order
 * @param segmentId the stretch to check
 * @returns the first foreign origin a line of it sits under, or `undefined` when every line sits under the owner's
 *   console or an unstamped open
 */
export function segmentForeignOrigin({
  entries,
  segmentId,
}: {
  entries: readonly CallEntry[];
  segmentId: string;
}): CallOrigin | undefined {
  let origin: CallOrigin | undefined;
  for (const entry of entries) {
    if (entry.kind === "open") {
      origin = originAfterOpen({ opened: entry.origin, previous: origin });
    }
    if (entry.kind === "segment" && entry.id === segmentId && !isOwnerCallOrigin({ origin })) {
      return origin;
    }
  }
  return undefined;
}

/**
 * Whether a console's write is one to refuse: the console is not the owner's, and the write reaches the owner — it
 * lands in the owner's live home (the user default, not a home the run named for itself), or it types into the owner's
 * pinned supervisor's chat, which `talk relay --deliver-to-supervisor` does over cmux whatever home it writes. A witness run on its own
 * `SLOPWEAVER_HOME` records freely and types into nobody's chat.
 *
 * @param origin the console asking to write
 * @param reachesLiveHome whether the write's bytes would land in the owner's live home, through any symlink on the way
 * @param typesIntoChair whether the write also types into the owner's supervisor's chat
 * @returns whether the write is refused
 */
export function consoleWriteRefused({
  origin,
  reachesLiveHome,
  typesIntoChair,
}: {
  origin: CallOrigin;
  reachesLiveHome: boolean;
  typesIntoChair: boolean;
}): boolean {
  return !isOwnerConsoleOrigin({ origin }) && (reachesLiveHome || typesIntoChair);
}

/**
 * Whether a stamped batch from a console that is not the owner's would put a line under an origin other than its own:
 * a line belongs to the last `open` before it, so every non-open line of the batch must follow an open carrying
 * `origin` — one earlier in the batch, or the call's last one on disk. A segment-only batch for a fresh or legacy call,
 * or for a call the owner's console opened, would otherwise read as the owner's. The owner's own console is never held
 * to this: its lines read as the owner's under any open. It judges the lines an append will WRITE — a retried batch
 * loses the lines the file already holds by write id, its own open among them, so judging the batch as posted would
 * pass a segment that then lands under another console's open. Nor may it revise a segment that began under another
 * origin: a reader keeps the origin a segment began under, so its text would read as the owner's.
 *
 * @param existing the call's lines already on disk
 * @param batch the batch, stamped, before the append drops what the file already holds
 * @param origin the console writing it
 * @returns whether the batch is refused
 */
export function foreignLineUnopened({
  existing,
  batch,
  origin,
}: {
  existing: readonly CallEntry[];
  batch: readonly CallEntry[];
  origin: CallOrigin;
}): boolean {
  if (isOwnerConsoleOrigin({ origin })) {
    return false;
  }
  const begunElsewhere = segmentsBegunElsewhere({ existing, origin });
  let current = existing.findLast((entry) => entry.kind === "open");
  for (const entry of entriesNotHeld({ entries: batch, held: existing })) {
    if (entry.kind === "open") {
      current = entry;
      continue;
    }
    if (!underOwnOpen({ current, origin }) || (entry.kind === "segment" && begunElsewhere.has(entry.id))) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the open a line would sit under carries `origin`. An unstamped open carries none, so it is never a foreign
 * console's own.
 *
 * @param current the last open before the line, if any
 * @param origin the console writing the line
 * @returns whether the line sits under an open of its own console
 */
function underOwnOpen({ current, origin }: { current: CallEntry | undefined; origin: CallOrigin }): boolean {
  return current?.kind === "open" && current.origin !== undefined && sameOrigin({ a: current.origin, b: origin });
}

/**
 * The ids of the segments on disk that began under an open not carrying `origin` — the owner's, another console's, or an
 * unstamped one.
 *
 * @param existing the call's lines already on disk
 * @param origin the console writing the batch
 * @returns the segment ids it may not revise
 */
function segmentsBegunElsewhere({
  existing,
  origin,
}: {
  existing: readonly CallEntry[];
  origin: CallOrigin;
}): ReadonlySet<string> {
  const begunOwn = new Map<string, boolean>();
  let current: CallEntry | undefined;
  for (const entry of existing) {
    if (entry.kind === "open") {
      current = entry;
    } else if (entry.kind === "segment" && !begunOwn.has(entry.id)) {
      begunOwn.set(entry.id, underOwnOpen({ current, origin }));
    }
  }
  return new Set([...begunOwn].flatMap(([id, own]) => (own ? [] : [id])));
}

/**
 * Whether two origins name the same console and the same instance: the test instance on the owner's console is not the
 * owner's console, so a line it writes never sits under the owner's open, nor the owner's under its.
 *
 * @param a one origin
 * @param b the other
 * @returns whether every field matches
 */
function sameOrigin({ a, b }: { a: CallOrigin; b: CallOrigin }): boolean {
  return originKey({ origin: a }) === originKey({ origin: b });
}

/**
 * One origin as a key two equal origins share: every field, the instance included.
 *
 * @param origin where the call was served from
 * @returns the key
 */
export function originKey({ origin }: { origin: CallOrigin }): string {
  let instance = "";
  if (origin.instance !== undefined) {
    instance = origin.instance;
  }
  return [
    origin.checkoutRoot,
    String(origin.port),
    String(origin.defaultPort),
    String(origin.mainWorktree),
    instance,
  ].join("\n");
}

/**
 * Whether a call was placed by the desktop test instance: it has an `open` line, and every one carries the marker.
 *
 * @param entries the call's lines, in file order
 * @returns whether every open of it is the test instance's
 */
export function callOpenedByTestInstance({ entries }: { entries: readonly CallEntry[] }): boolean {
  const opens = entries.filter((entry) => entry.kind === "open");
  return opens.length > 0 && opens.every((entry) => entry.origin?.instance === "e2e");
}

/**
 * Whether any `open` line of a call carries the desktop test instance's marker. A reader handing words on as the
 * owner's refuses such a call whole, since a later unmarked open does not make an earlier marked session's speech the
 * owner's.
 *
 * @param entries the call's lines, in file order
 * @returns whether the test instance opened it at least once
 */
export function callTouchedByTestInstance({ entries }: { entries: readonly CallEntry[] }): boolean {
  return entries.some((entry) => entry.kind === "open" && entry.origin?.instance === "e2e");
}

/**
 * The origin a call's lines are read under after one more `open`: that open's, unless an earlier one carried the
 * desktop test instance's marker, which stays — a later unmarked open of the owner's console must not launder the rest of a
 * marked call into the owner's words (`talk unread`).
 *
 * @param previous the origin the call's lines were read under before this open
 * @param opened the origin this open line carries
 * @returns the origin to read what follows under
 */
export function originAfterOpen({
  previous,
  opened,
}: {
  previous: CallOrigin | undefined;
  opened: CallOrigin | undefined;
}): CallOrigin | undefined {
  if (previous?.instance === "e2e" && opened?.instance !== "e2e") {
    return previous;
  }
  return opened;
}

/**
 * The desktop test instance's mark a stretch of a call's lines is read under: the one the read frontier already left,
 * else the first marked `open` among the lines. Every segment of a marked call is read under it, so speech begun BEFORE
 * a marked open is no more the owner's than speech after it, a later snapshot of it included. A
 * read that handed words on before the mark reached the file cannot be recalled; the test instance mints its own call
 * ids, so that needs a call id shared with the owner's console.
 *
 * @param before the origin the read frontier left (`./unreadRead.ts` keeps a mark there)
 * @param entries the lines past the frontier, in file order
 * @returns the marked origin, or `undefined` when no open of the call carries the mark
 */
export function markedOrigin({
  before,
  entries,
}: {
  before: CallOrigin | undefined;
  entries: readonly CallEntry[];
}): CallOrigin | undefined {
  if (before?.instance === "e2e") {
    return before;
  }
  const open = entries.find((entry) => entry.kind === "open" && entry.origin?.instance === "e2e");
  if (open?.kind !== "open") {
    return undefined;
  }
  return open.origin;
}

/**
 * Stamp the server's origin on every `open` line of a batch, replacing any the page sent: the page is not trusted to
 * say where it was served from. Every other line is returned as it came.
 *
 * @param entries the batch, parsed
 * @param origin where the server serving it is
 * @returns the batch with each open line stamped
 */
export function stampCallOrigin({
  entries,
  origin,
}: {
  entries: readonly CallEntry[];
  origin: CallOrigin;
}): readonly CallEntry[] {
  return entries.map((entry) => (entry.kind === "open" ? { ...entry, origin } : entry));
}

/**
 * The origin as one phrase, for a report that sets a call aside.
 *
 * @param origin where the call was served from
 * @returns e.g. `a checkout that is not the owner's main checkout at /x on :3001 (the owner's console is :3000)`, led by
 *   `the desktop e2e test instance, through` when the test instance placed the call
 */
export function originPhrase({ origin }: { origin: CallOrigin }): string {
  let checkout = "a checkout that is not the owner's main checkout";
  if (origin.mainWorktree) {
    checkout = "the owner's main checkout";
  }
  let instance = "";
  if (origin.instance === "e2e") {
    instance = "the desktop e2e test instance, through ";
  }
  return `${instance}${checkout} at ${origin.checkoutRoot} on :${String(origin.port)} (the owner's console is :${String(origin.defaultPort)})`;
}
