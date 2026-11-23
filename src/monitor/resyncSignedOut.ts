/**
 * `resync-signed-out` — a scheduled resync stopped at a sign-in page, so the one step is the owner's: sign in there.
 *
 * Sign-ins are one of the main things that still need the owner's hand, so a button is put in front of them. A
 * failed resync whose attempt recorded a sign-in wall (`../live/resync/run.ts`, off
 * `../browser/signInWalls.ts`) becomes ONE card per origin, in the shape of
 * `skills/hand/reference/waiting-on-a-sign-in.md`. The pass opens that origin in the owner's RECORDED work Chrome
 * profile itself as it posts the card (`$SLOPWEAVER_HOME/chrome-pin.sh`, `../browser/profilePin.ts`, run by
 * `./pass.ts`'s opener), so the card says only to sign in in the window that opened: that sign-in, in the already
 * opened browser, is the only thing the owner has to do. Any other failure is not the owner's to clear with a
 * sign-in and raises nothing here — `fleet-unhealthy`'s line says what the fleet is doing about it instead.
 *
 * ## Why a card the owner pressed Done on is HELD, not re-posted
 *
 * A wall neither fails the row's slot nor holds it: the resync gives its attempt back
 * (`../live/resync/outcome.ts#resyncExitCode`), and `automation seat` leaves the row unseated until this card is
 * settled, then seats it on the next pass. So between the owner's Done and that pass the attempt that met the wall is
 * still the newest one, and a monitor that only re-read it would post a fresh card over that Done — the pile of
 * re-raised notes `./fleetHealthDelta.ts` exists to end. So a subject whose card was settled AT OR AFTER the
 * newest wall attempt is held (`delivery: hold`); an attempt that meets the wall AGAIN after that is news, and
 * posts a fresh card. {@link signInAnswered} is that one rule, read by the card and by the seat alike.
 *
 * ## Datadog and GitHub are the fleet's to sign in to
 *
 * The fleet clicks the buttons and does the sign-in for Datadog and GitHub. So a wall on either is HELD rather
 * than carded until a fresh `browser sign-in` look found the step genuinely the owner's — the same judgement every card door makes (`../handover/fleetSignInGate.ts`).
 *
 * Pure: resync states, card history, the pin path, the sign-in looks and the clock in, a reading out.
 */
import { type SignInProvider, signInProviderOfHost } from "../browser/signInPress.js";
import type { SignInProbeRow } from "../browser/signInProbeStore.js";
import { unbackedSignInCard } from "../handover/fleetSignInGate.js";
import { demandWords, type ResyncDemandRecord } from "../live/resync/demand.js";
import type { ResyncState } from "../live/resync/outcome.js";

import type { MonitorReading, MonitorSubject } from "./types.js";

/**
 * How long a subject key may be: the register caps a step id at 60, `mon-signin-` spends 11, and an occurrence
 * suffix (`.12`) spends up to 3 more.
 */
const KEY_MAX = 44;

/** What the hand register holds about one subject's cards, keyed by the subject's key. */
export interface SignInCardHistory {
  /** Whether a card for the key is open now. */
  readonly open: boolean;
  /** When a card for the key was last settled, by the owner's Done or by a pass, or absent when none ever was. */
  readonly lastSettledIso: string | undefined;
}

/** One failing row whose newest attempt stopped at a sign-in page. */
interface WallRow {
  readonly recipeId: string;
  readonly origin: string;
  readonly finishedAtIso: string;
  /** When the row last actually worked, or `null` when it never has — what the card's do-nothing line reads. */
  readonly lastSuccessAtIso: string | null;
  /** The person's mention the attempt walked for, when its atlas is demand-gated. */
  readonly demand: ResyncDemandRecord | undefined;
}

/**
 * The step-id-safe key one origin's card is posted under — its host, folded to `[a-z0-9-]` and fitted.
 *
 * @param origin the sign-in wall's origin, e.g. `https://acme.trelica.app`
 * @returns the key, e.g. `acme-trelica-app`
 */
export function signInSubjectKey({ origin }: { origin: string }): string {
  return signInHostKey({ host: hostOf({ origin }) });
}

/**
 * The key one host's card is posted under — {@link signInSubjectKey} for a caller already holding the host, as the
 * fleet-health line does when it finds the open card a failing row waits on.
 *
 * @param host the sign-in wall's host, e.g. `go.xero.com`
 * @returns the key, e.g. `go-xero-com`
 */
export function signInHostKey({ host }: { host: string }): string {
  const folded = host
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return folded.slice(0, KEY_MAX).replace(/-+$/, "");
}

/**
 * The host an origin names, or the origin itself when it does not parse — a recorded value is shown, never dropped.
 *
 * @param origin the recorded origin
 * @returns its host
 */
export function hostOf({ origin }: { origin: string }): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * Every row whose NEWEST attempt failed at a sign-in wall. An older wall a later attempt got past is over.
 *
 * @param states every target's remembered state
 * @returns the rows, sorted by recipe id
 */
export function signInWallRows({ states }: { states: readonly ResyncState[] }): readonly WallRow[] {
  const rows: WallRow[] = [];
  for (const state of states) {
    const attempt = state.lastAttempt;
    if (attempt?.outcome !== "failed" || attempt.signInWall === undefined) {
      continue;
    }
    rows.push({
      demand: attempt.demand,
      finishedAtIso: attempt.finishedAtIso,
      lastSuccessAtIso: state.lastSuccessAtIso,
      origin: attempt.signInWall,
      recipeId: state.recipeId,
    });
  }
  return rows.toSorted((a, b) => a.recipeId.localeCompare(b.recipeId));
}

/**
 * Evaluate `resync-signed-out`: one subject per origin a failing resync stopped at, or clear.
 *
 * @param states every target's remembered state
 * @param cards what the hand register holds about each subject key's cards
 * @param pinPath the pin shim the pass opens the origin through, or absent when none is written yet — then no page opens
 * @param blindSpot why part of the resync state could not be read, when so
 * @param probes every `browser sign-in` look, in written order — what decides whether a Datadog or GitHub wall is the owner's
 * @param nowIso the instant the pass judges a look's freshness at
 * @returns the reading
 */
export function evaluateResyncSignedOut({
  states,
  cards,
  pinPath,
  blindSpot,
  probes,
  nowIso,
}: {
  states: readonly ResyncState[];
  cards: ReadonlyMap<string, SignInCardHistory>;
  pinPath: string | undefined;
  blindSpot: string | undefined;
  probes: readonly SignInProbeRow[];
  nowIso: string;
}): MonitorReading {
  const byOrigin = new Map<string, WallRow[]>();
  for (const row of signInWallRows({ states })) {
    const group = byOrigin.get(row.origin);
    if (group === undefined) {
      byOrigin.set(row.origin, [row]);
    } else {
      group.push(row);
    }
  }
  if (byOrigin.size === 0) {
    if (blindSpot !== undefined) {
      return { because: blindSpot, monitorId: "resync-signed-out", state: "unmeasurable" };
    }
    return { monitorId: "resync-signed-out", state: "clear" };
  }
  const subjects = [...byOrigin.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([origin, rows]) => wallSubject({ cards, nowIso, origin, pinPath, probes, rows }));
  return {
    monitorId: "resync-signed-out",
    state: "firing",
    subjects,
    ...(blindSpot === undefined ? {} : { blindSpot }),
  };
}

/**
 * Whether the owner's sign-in card for an origin answers a wall met at an instant: no card for it is open, and one was
 * settled AT OR AFTER the wall. The ONE rule both readers apply — this monitor holds the card on it, and
 * `cli/commands/automation/seatRefusals.ts` seats the row again on it — so "the owner has signed in" cannot mean two
 * different things to the card and to the schedule.
 *
 * @param cards what the hand register holds about each subject key's cards
 * @param origin the sign-in wall's origin
 * @param wallIso when the attempt that met the wall finished
 * @returns true once the owner's card was settled after that wall and none is open
 */
export function signInAnswered({
  cards,
  origin,
  wallIso,
}: {
  cards: ReadonlyMap<string, SignInCardHistory>;
  origin: string;
  wallIso: string;
}): boolean {
  const history = cards.get(signInSubjectKey({ origin }));
  return (
    history !== undefined && !history.open && history.lastSettledIso !== undefined && history.lastSettledIso >= wallIso
  );
}

/**
 * How fresh the stopped rows leave the owner's reads: the OLDEST last success among them, since that is the stalest read
 * doing nothing leaves standing — or `never` when any of them has never synced at all.
 *
 * @param rows the rows one sign-in page stopped, at least one
 * @returns the freshness the card's do-nothing line names
 */
export function syncedThrough({
  rows,
}: {
  rows: readonly Pick<WallRow, "lastSuccessAtIso">[];
}): NonNullable<MonitorSubject["syncedThrough"]> {
  const successes: string[] = [];
  for (const row of rows) {
    if (row.lastSuccessAtIso === null) {
      return { kind: "never" };
    }
    successes.push(row.lastSuccessAtIso);
  }
  return { iso: successes.toSorted().at(0)!, kind: "at" };
}

/**
 * Why a wall at this origin is the fleet's to press rather than the owner's card — a Datadog or GitHub origin with no fresh
 * look that reached the owner's hands — or `undefined` when the card is the owner's. The ONE rule both readers apply, like
 * {@link signInAnswered}: this monitor holds the card on it, and `automation seat` seats the row on it, so the seated
 * session presses the wall rather than waiting on a card that will never post.
 *
 * @param origin the sign-in wall's origin
 * @param probes every row of the sign-in probe ledger, in written order
 * @param nowIso the instant the pass judges at
 * @returns the provider the fleet presses and the hold's reason, or `undefined`
 */
export function fleetSignInHold({
  origin,
  probes,
  nowIso,
}: {
  origin: string;
  probes: readonly SignInProbeRow[];
  nowIso: string;
}): { readonly provider: SignInProvider; readonly why: string } | undefined {
  const provider = signInProviderOfHost({ host: hostOf({ origin }) });
  if (provider === undefined) {
    return undefined;
  }
  const because = unbackedSignInCard({ nowIso, probes, provider });
  if (because === undefined) {
    return undefined;
  }
  return {
    provider,
    why: `a ${provider} sign-in is the fleet's to press, not your card: ${because}`,
  };
}

/**
 * Who asked, for EVERY subject of an origin, held or not: a fleet-pressed sign-in is still a walk someone wanted
 * Empty for a calendar walk, whose card stays exactly what it was before the gate.
 */
function demandFields({ rows }: { rows: readonly WallRow[] }): Pick<MonitorSubject, "details" | "wantedBy"> {
  const wantedBy = rows.find((row) => row.demand !== undefined)?.demand;
  if (wantedBy === undefined) {
    return {};
  }
  return { details: [`walked because ${demandWords({ record: wantedBy })}: ${wantedBy.url}`], wantedBy };
}

/** One origin's subject: the host the owner signs in to, the rows it stopped, and the page the pass opens for them. */
function wallSubject({
  cards,
  origin,
  pinPath,
  rows,
  probes,
  nowIso,
}: {
  cards: ReadonlyMap<string, SignInCardHistory>;
  origin: string;
  pinPath: string | undefined;
  rows: readonly WallRow[];
  probes: readonly SignInProbeRow[];
  nowIso: string;
}): MonitorSubject {
  const key = signInSubjectKey({ origin });
  const newestWallIso = rows
    .map((row) => row.finishedAtIso)
    .toSorted()
    .at(-1)!;
  const answered = signInAnswered({ cards, origin, wallIso: newestWallIso });
  const recipes = rows.map((row) => row.recipeId).join(", ");
  const fleetHeld = fleetSignInHold({ nowIso, origin, probes });
  const demand = demandFields({ rows });
  if (!answered && fleetHeld !== undefined) {
    return {
      delivery: { kind: "hold", why: fleetHeld.why },
      fleetPresses: fleetHeld.provider,
      id: hostOf({ origin }),
      key,
      label: `${recipes} stopped at ${hostOf({ origin })}'s sign-in page`,
      page: origin,
      syncedThrough: syncedThrough({ rows }),
      ...demand,
    };
  }
  return {
    id: hostOf({ origin }),
    key,
    label: `${recipes} stopped at ${hostOf({ origin })}'s sign-in page`,
    syncedThrough: syncedThrough({ rows }),
    ...demand,
    // Only with a pin to open it through: a page opened any other way may land in the owner's personal Chrome profile.
    ...(pinPath === undefined ? {} : { opens: origin }),
    // Cited on the card whenever no window is opened on it, so the sign-in it names is still one click away.
    page: origin,
    ...(answered
      ? {
          delivery: {
            kind: "hold",
            why: `your card for ${hostOf({ origin })} was settled after the last attempt met its sign-in page — the next attempt says whether it got past`,
          },
        }
      : {}),
  };
}
