/**
 * WHO is on a pull request — the join no verb does, written once so every page says the same thing.
 *
 * The "CI failing — an agent's fix" group must say who is on each row so the owner never
 * wonders whether they have to step in. Two joins, both on ids GitHub or Claude Code own: a live watcher's
 * Claude session id against `session depth --json`, and the head branch against `session list --json`.
 * Every outcome is a sentence, including the ones that mean "nobody".
 */

/** A watcher as `github watchers --json` prints it. */
export interface SeatWatcher {
  readonly session: string;
  readonly mode: string;
  readonly stale: boolean;
}

/** A seat as `session depth --json` prints it. */
export interface SeatDepthRow {
  readonly sessionId: string;
  readonly workspaceRef: string | undefined;
  readonly title: string | undefined;
  readonly slug: string | undefined;
}

/** An open session as `session list --json` prints it. */
export interface SeatSession {
  readonly key: string;
  readonly branch: string | undefined;
  readonly workspaceRef: string | undefined;
  readonly slug: string | undefined;
}

/** Where a pull request's work stands, as a closed set of sentences. */
export type Seat =
  | {
      readonly kind: "seated";
      readonly who: string;
      readonly slug: string | undefined;
      readonly via: "watch" | "branch";
    }
  | { readonly kind: "paused"; readonly on: readonly string[] }
  | { readonly kind: "stale-history"; readonly on: readonly string[]; readonly throughIso: string | undefined }
  | { readonly kind: "shared"; readonly channel: string; readonly on: readonly string[] }
  | { readonly kind: "unattended"; readonly mode: string }
  | { readonly kind: "unmatched"; readonly session: string }
  | { readonly kind: "nobody" }
  /**
   * A reading the seat is joined from is not in hand. `read` names which, so a page draws that reading's spinner or
   * staleness mark in the seat's place rather than these words.
   */
  | { readonly kind: "unknown"; readonly read: SeatRead; readonly why: string };

/** The three readings a seat is joined from. */
export type SeatRead = "watchers" | "depth" | "sessions";

/** The one next act on a wait that means the Slack history is behind the pull request — `src/review/humanWait.ts`'s word. */
const SYNC_SLACK = "sync-slack";

/** The two fields of a row's `humanWait` the seat reads. */
export interface SeatWait {
  readonly next: string;
  readonly slackThroughIso: string | undefined;
}

/** The name a seat prints: the cmux workspace, else the session title, else the slug, else the id. */
function nameOf({ row }: { row: SeatDepthRow }): string {
  if (row.workspaceRef !== undefined) {
    return row.workspaceRef;
  }
  if (row.title !== undefined) {
    return row.title;
  }
  if (row.slug !== undefined) {
    return row.slug;
  }
  return row.sessionId.slice(0, 8);
}

/**
 * The channel a row's drawn wait leaves it with: `wait-on-channel`, or a Slack sync over a share whose clock is not
 * known — the channel may have it, and "nobody seated" would claim an absence nobody read. A red share leaves it
 * with nobody, so its "name one" is never softened.
 *
 * @param next the act the row's drawn wait names, or `undefined` when it draws none
 * @param share the row's channel share, or `undefined` when it carries none
 * @returns the channel holding the row, or `undefined`
 */
export function sharedChannelOf({
  next,
  share,
}: {
  next: string | undefined;
  share: { readonly channel: string; readonly tone: string } | undefined;
}): string | undefined {
  if (share === undefined) {
    return undefined;
  }
  if (next === "wait-on-channel" || (next === "sync-slack" && share.tone === "unknown")) {
    return share.channel;
  }
  return undefined;
}

/**
 * Who is on one pull request.
 *
 * @param watchers the live watchers of this pull request, or `undefined` when the fold is not readable
 * @param depth the seats, or `undefined` when that reading is not readable
 * @param sessions the open sessions, or `undefined` when that reading is not readable
 * @param headRefName the pull request's head branch
 * @param blockedOn who the verb says is holding it
 * @param wait the row's wait on a human, whose `sync-slack` act turns a pause into a stale-history seat
 * @param sharedIn the channel the row's drawn wait leaves it with ({@link sharedChannelOf}), or `undefined`
 * @returns the seat
 */
export function seatOf({
  watchers,
  depth,
  sessions,
  headRefName,
  blockedOn,
  wait,
  sharedIn,
}: {
  watchers: readonly SeatWatcher[] | undefined;
  depth: readonly SeatDepthRow[] | undefined;
  sessions: readonly SeatSession[] | undefined;
  headRefName: string;
  blockedOn: readonly string[];
  wait: SeatWait | undefined;
  sharedIn: string | undefined;
}): Seat {
  if (watchers === undefined) {
    return { kind: "unknown", read: "watchers", why: "the watchers fold is not readable" };
  }
  const live = watchers.filter((watcher) => !watcher.stale);
  const first = live.at(0);
  if (first !== undefined) {
    if (first.session === "unattended") {
      return { kind: "unattended", mode: first.mode };
    }
    if (depth === undefined) {
      return { kind: "unknown", read: "depth", why: "a session holds a watch but the depth reading is not readable" };
    }
    const seat = depth.find((row) => row.sessionId === first.session);
    if (seat !== undefined) {
      return { kind: "seated", slug: seat.slug, via: "watch", who: nameOf({ row: seat }) };
    }
    return { kind: "unmatched", session: first.session };
  }
  if (sessions === undefined) {
    return { kind: "unknown", read: "sessions", why: "nobody watches it and the session list is not readable" };
  }
  const onBranch = sessions.find((session) => session.branch === headRefName);
  if (onBranch !== undefined) {
    let who = onBranch.key;
    if (onBranch.workspaceRef !== undefined) {
      who = onBranch.workspaceRef;
    }
    return { kind: "seated", slug: onBranch.slug, via: "branch", who };
  }
  // A pull request shared with a channel, nobody named, is a normal state, not a fault. While its clock says the channel has it, a red "nobody seated" beside it contradicts
  // the row; once the clock reads red the wait names a reviewer instead, and the pause is true again. It outranks
  // a stale history: an unknown share still names the channel that has it.
  if (sharedIn !== undefined) {
    return { channel: sharedIn, kind: "shared", on: blockedOn };
  }
  // A red "nobody seated" on a row whose Slack history ends before the pull request's
  // last activity says more than the read knows — whether anyone was asked is exactly what a stale corpus
  // cannot answer. So the seat says what it does not know, in the unknown colour, whether or not the verb
  // could name who holds it.
  if (wait?.next === SYNC_SLACK) {
    return { kind: "stale-history", on: blockedOn, throughIso: wait.slackThroughIso };
  }
  if (blockedOn.length > 0) {
    return { kind: "paused", on: blockedOn };
  }
  return { kind: "nobody" };
}

/** How many of a hold's names the row prints before it counts the rest; a codeowner list runs to fourteen. */
const NAMED_ON = 2;

/**
 * The first names of a hold and a count of the rest, so a fourteen-codeowner hold stays one readable pill.
 *
 * @returns the names, then `+N more` when there are more
 */
function namedOn({ on }: { on: readonly string[] }): string {
  const rest = on.length - NAMED_ON;
  const named = on.slice(0, NAMED_ON).join(", ");
  if (rest > 0) {
    return `${named} +${String(rest)} more`;
  }
  return named;
}

/** An instant as a reader scans it — `YYYY-MM-DD HH:MMZ`, the same shape the verb's own sentence prints. */
function minuteOf({ iso }: { iso: string }): string {
  const utc = new Date(Date.parse(iso)).toISOString();
  return `${utc.slice(0, 10)} ${utc.slice(11, 16)}Z`;
}

/**
 * What a stale-history seat says: since when the Slack history is behind, and that a sync is what settles it —
 * or, with no watermark proving it behind, only that the history does not settle this.
 *
 * @returns the sentence
 */
function staleHistoryLine({ throughIso }: { throughIso: string | undefined }): string {
  if (throughIso === undefined) {
    return "Slack history does not settle this, sync to know";
  }
  return `Slack history stale since ${minuteOf({ iso: throughIso })}, sync to know`;
}

/**
 * The seat as one line, with a long hold shortened to its first names and a count.
 *
 * @returns the sentence
 */
export function seatLine({ seat }: { seat: Seat }): string {
  switch (seat.kind) {
    case "seated": {
      let slug = "";
      if (seat.slug !== undefined && seat.slug !== seat.who) {
        slug = ` · ${seat.slug}`;
      }
      return `${seat.who} is on it (${seat.via})${slug}`;
    }
    case "paused":
      return `PAUSED on ${namedOn({ on: seat.on })}: nobody seated`;
    case "stale-history":
      return staleHistoryLine({ throughIso: seat.throughIso });
    case "shared":
      return `with ${seat.channel}: no reviewer named yet`;
    case "unattended":
      return `an unattended ${seat.mode} watch, no seat`;
    case "unmatched":
      return `watched by ${seat.session.slice(0, 8)}, which no seat matches`;
    case "nobody":
      return "nobody is on this";
    case "unknown":
      return `seat unknown: ${seat.why}`;
    default: {
      const never: never = seat;
      return String(never);
    }
  }
}

/**
 * The seat in full, for a hover: the same sentence, with every name of a hold rather than a count.
 *
 * @returns the sentence
 */
export function seatTitle({ seat }: { seat: Seat }): string {
  if (seat.kind === "paused") {
    return `PAUSED on ${seat.on.join(", ")}: nobody seated`;
  }
  if (seat.kind === "stale-history" && seat.on.length > 0) {
    return `${staleHistoryLine({ throughIso: seat.throughIso })} · held for ${seat.on.join(", ")}`;
  }
  if (seat.kind === "shared") {
    let held = "";
    if (seat.on.length > 0) {
      held = ` · GitHub holds it on ${seat.on.join(", ")}`;
    }
    return `shared with ${seat.channel}, nobody named, and no session is on it${held}`;
  }
  return seatLine({ seat });
}
