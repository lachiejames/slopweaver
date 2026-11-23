/**
 * How the Google Admin atlas grades what it has and has not seen, per kind and per channel.
 *
 * The cell CONSTRUCTORS are `kit/coverage.ts`'s; what is here is the one judgement the kit cannot make —
 * which state each channel earns for each kind on this platform, and what would unblock it.
 *
 * ## A kind Google DESCRIBES is not a kind this atlas has READ
 *
 * The distinction is the whole reason this file exists. `discovery` genuinely SUCCEEDED for every kind:
 * it read Google's own declaration of what a user, a Chrome device or an audit activity is, and that is a
 * complete result for what that channel can ever claim. `admin-api` and `admin-console` are graded only by
 * what a fill or a walk actually read for that kind. Grading all three from one number would make a fully
 * mapped platform read as fully ingested, which is the exact dishonesty
 * `docs/atlas-intent/settled-decisions.md`'s coverage property exists to prevent.
 *
 * So each kind carries three cells. The first is `synced`. The other two are `not-configured` until a fill or a
 * walk reaches the kind — a state that says "this atlas is not the source of record for this yet, and here
 * is the thing that would change that", naming its own remedy in `unblockedBy` — and then whatever that read
 * earned. A later attempt that fails, or a sync that makes none, carries the last success forward rather than
 * erasing it.
 */
import { type AtlasCoverageCell, failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";

import {
  GOOGLE_ADMIN_ATLAS_PLATFORM,
  type GoogleAdminAtlasChannel,
  type GoogleAdminAtlasKind,
  type GoogleAdminCoverageCell,
  googleAdminVisibilityScopeFor,
} from "./model.js";

/** What each channel's evidence is worth, in the kit's own vocabulary. */
const CHANNEL_ROLES = {
  "admin-api": "authoritative",
  "admin-console": "authoritative",
  discovery: "authoritative",
} as const;

/**
 * What would fill each unfilled channel, stated as the concrete act that does it.
 *
 * Both are the owner's own hand and neither is this session's. The API one needs a consent round trip
 * under an account holding an admin role; the console one needs Google's step-up reauthentication, which
 * `descriptor.ts` records as measured rather than assumed.
 */
const CHANNEL_REMEDIES = {
  "admin-api":
    "run `slopweaver atlas google-admin connect` under an account holding a Workspace admin role, then `slopweaver atlas google-admin fill` — the consent requests readonly administrator scopes only, and the five Cloud APIs it reads must also be enabled on the project or every operation answers 403 about the SERVICE rather than about the scope",
  "admin-console":
    "complete Google's step-up reauthentication for admin.google.com once in the work Chrome profile, then run: slopweaver atlas google-admin walk — the profile is signed in and the challenge is the console's own, so nothing here can pass it on the owner's behalf",
  discovery: null,
} as const;

/**
 * The scope string a cell carries.
 *
 * The platform name rather than a customer or domain label, because either would be a private identifier
 * this repository may not carry — the same choice `trelica/readAdapter.ts` makes and for the same reason.
 */
const SCOPE = GOOGLE_ADMIN_ATLAS_PLATFORM;

/**
 * The coverage cell the compiled channel earns for one kind.
 *
 * `synced` is the honest grade and it is a narrow claim: Google's published declaration of this kind was
 * read completely. It says nothing about this Workspace account's own records, which is what the two
 * cells beside it are for.
 *
 * @param kind the kind this cell grades
 * @param operations how many of the registry's operations belong to it — quoted in the reason so a reader
 *   sees the size of what was mapped without opening the generated table
 * @param at this run's ISO timestamp
 * @returns the cell, stamped as a fresh success
 */
export function googleAdminDiscoveryCoverageCell({
  kind,
  operations,
  at,
}: {
  kind: GoogleAdminAtlasKind;
  operations: number;
  at: string;
}): GoogleAdminCoverageCell {
  const cell = succeededCoverageCell({
    artifacts: [],
    at,
    reason:
      operations === 0
        ? `no published method declares ${kind} — it is declared so a channel that finds one has somewhere to land it`
        : `Google's eleven pinned discovery documents declare ${operations} method(s) for ${kind}, and its record shape was read from their own schemas; this grades the MAP, never this Workspace account's records`,
    role: CHANNEL_ROLES.discovery,
    scope: SCOPE,
    state: "synced",
    surface: "discovery",
    visibilityScope: googleAdminVisibilityScopeFor({ channel: "discovery" }),
  });
  return toStoredCell({ cell, channel: "discovery" });
}

/**
 * The coverage cell an unattempted live channel earns for one kind.
 *
 * `failedCoverageCell` rather than a hand-built literal, because it is the constructor that carries the
 * prior success forward — the day a walk succeeds and a later one fails, this cell must stop being current
 * without erasing what was seen.
 *
 * @param channel which live channel this grades
 * @param kind the kind this cell grades — a console walk reads only `page`, so for every other kind the
 *   console cell says so and names no remedy, since no walk can change it
 * @param at this run's ISO timestamp, carried for symmetry with the succeeded cell
 * @param previous the cell as it stood before this run, or `null` when this channel was never touched
 * @returns the cell, marked not-configured with its own remedy, or none where no act could change it
 */
export function googleAdminUnconfiguredCoverageCell({
  channel,
  kind,
  at,
  previous,
}: {
  channel: "admin-api" | "admin-console";
  kind: GoogleAdminAtlasKind;
  at: string;
  previous: GoogleAdminCoverageCell | null;
}): GoogleAdminCoverageCell {
  void at;
  const walkCannotReach = channel === "admin-console" && kind !== "page";
  const cell = failedCoverageCell({
    previous,
    reason: unconfiguredReason({ channel, kind }),
    role: CHANNEL_ROLES[channel],
    scope: SCOPE,
    state: "not-configured",
    surface: channel,
    unblockedBy: walkCannotReach ? null : CHANNEL_REMEDIES[channel],
    visibilityScope: googleAdminVisibilityScopeFor({ channel }),
  });
  return toStoredCell({ cell, channel });
}

/**
 * The `admin-api` cell for a kind a fill RAN over but called no method for.
 *
 * Distinct from {@link googleAdminUnconfiguredCoverageCell}, which is for a sync with no fill at all: here
 * the fill's own plan decided, and its exclusions say why — a scope the grant lacks, or a method whose path
 * or parameters need a record no read has supplied. Quoting them is the whole point, because "no fill ran"
 * would be false and "the grant does not reach it" is only one of the reasons.
 *
 * @param excluded one line per method the fill excluded for this kind, empty when it planned none at all —
 *   which happens only when no published read method the fill calls reaches the kind, so nothing unblocks it
 * @param previous the stored `admin-api` cell for this kind, carried forward
 * @returns the cell, marked not-configured with the fill's own reasons
 */
export function googleAdminUnreachedCoverageCell({
  excluded,
  previous,
}: {
  excluded: readonly string[];
  previous: GoogleAdminCoverageCell | null;
}): GoogleAdminCoverageCell {
  const none = excluded.length === 0;
  const cell = failedCoverageCell({
    previous,
    reason: none
      ? "a fill ran in this sync and planned no Admin API method for this kind — no published read method the fill calls reaches it, so no grant or later fill can fill it"
      : `a fill ran in this sync and called no Admin API method for this kind — it excluded ${String(excluded.length)}: ${excluded.join("; ")}`,
    role: CHANNEL_ROLES["admin-api"],
    scope: SCOPE,
    state: "not-configured",
    surface: "admin-api",
    unblockedBy: none
      ? null
      : "read each exclusion above: scope-not-granted is fixed by `slopweaver atlas google-admin connect` under a grant that carries the scope, and a method that needs a record cannot be called until that record has been read",
    visibilityScope: googleAdminVisibilityScopeFor({ channel: "admin-api" }),
  });
  return toStoredCell({ cell, channel: "admin-api" });
}

/**
 * Why a live channel read nothing for one kind in this sync.
 *
 * A console walk reads only the `page` kind, so for every other kind the console reason says that rather
 * than claiming no walk ran, which is false whenever one ran for `page` in the same sync.
 *
 * @param channel which live channel read nothing
 * @param kind the kind it read nothing for
 * @returns the reason the cell carries
 */
function unconfiguredReason({
  channel,
  kind,
}: {
  channel: "admin-api" | "admin-console";
  kind: GoogleAdminAtlasKind;
}): string {
  if (channel === "admin-api") {
    return "no Admin API fill ran in this sync, so no method was called for this kind";
  }
  if (kind !== "page") {
    return "an Admin console walk reads only the page kind, so nothing in this sync read this kind through the console";
  }
  return "no Admin console walk ran in this sync — the console answers this profile with Google's own step-up reauthentication until it is completed";
}

/**
 * The coverage cell the console channel earns for the `page` kind once a walk has run.
 *
 * `deferred` rather than `synced`, always, and that is the honest grade rather than a modest one. Two
 * things are missing and neither can be fixed by walking harder. The page list is a FLOOR, because Google
 * publishes no route inventory and the denominator came from the console's own links. And no page carries
 * a screenshot, because the route into the owner's Chrome answers with an image to the model and never
 * writes a file (`docs/browser-route/brief-profile-and-walks.md`). A `synced` cell would claim a completeness this channel cannot
 * have on this platform.
 *
 * A walk that opened NO page read nothing, so it is a failed attempt rather than a success: `unreadable`,
 * carrying the stored cell's last success forward. Stamping it a fresh success would erase the last walk
 * that did read the console.
 *
 * @param opened how many pages the walk actually opened and judged loaded
 * @param observed how many distinct routes it saw linked
 * @param at the walk's own ISO timestamp, which is what stamps the cell rather than the publish time
 * @param previous the stored `admin-console` cell for this kind, carried forward when the walk opened nothing
 * @returns the cell, a fresh partial success, or a failure when no page was opened
 */
export function googleAdminWalkedCoverageCell({
  opened,
  observed,
  at,
  previous,
}: {
  opened: number;
  observed: number;
  at: string;
  previous: GoogleAdminCoverageCell | null;
}): GoogleAdminCoverageCell {
  if (opened === 0) {
    const failed = failedCoverageCell({
      previous,
      reason: `a walk ran and opened no console page it could judge loaded, though it saw ${String(observed)} distinct route(s) linked, so it read nothing this time`,
      role: CHANNEL_ROLES["admin-console"],
      scope: SCOPE,
      state: "unreadable",
      surface: "admin-console",
      unblockedBy: CHANNEL_REMEDIES["admin-console"],
      visibilityScope: googleAdminVisibilityScopeFor({ channel: "admin-console" }),
    });
    return toStoredCell({ cell: failed, channel: "admin-console" });
  }
  const cell = succeededCoverageCell({
    artifacts: [],
    at,
    reason: `a walk in the owner's own Chrome opened ${opened} console page(s) and judged each loaded, and saw ${observed} distinct route(s) linked from them. It is \`deferred\` rather than \`synced\` for two reasons neither of which more walking fixes — Google publishes no route inventory, so the denominator is what the console itself linked, and no page carries a screenshot because that route returns an image to the model rather than a file`,
    role: CHANNEL_ROLES["admin-console"],
    scope: SCOPE,
    state: "deferred",
    surface: "admin-console",
    visibilityScope: googleAdminVisibilityScopeFor({ channel: "admin-console" }),
  });
  return toStoredCell({ cell, channel: "admin-console" });
}

/**
 * The coverage cell one kind earns from a live Admin API fill.
 *
 * Three states rather than one, and each says something a reader would otherwise have to work out:
 *
 * - `synced` — every operation reaching this kind answered, none stopped at its page bound, and what came
 *   back was a collection. This is the only state that claims completeness, and it is a narrow claim even
 *   so, bounded by the admin ROLE the grant's account holds.
 * - `deferred` — it was read and the read is knowingly partial. A page bound was hit, or the payload was
 *   an aggregate rather than a collection (`countChromeOsDevices` answers a number, not devices), so what
 *   is stored is real and is not the whole of it.
 * - `unreadable` — Google refused. The commonest reason by far is an API the Cloud project has not
 *   enabled, which is a console act rather than a consent act, so the reason carries the status.
 *
 * @param kind the kind this cell grades, carried for symmetry with its siblings
 * @param operations how many operations reaching this kind answered
 * @param records how many records they stored between them
 * @param truncated whether any of them stopped at its page bound
 * @param aggregate whether any of them answered a scalar rather than a collection
 * @param failures one line per operation Google refused, empty when none did
 * @param at the fill's own ISO timestamp, which is what stamps the cell
 * @param previous the stored `admin-api` cell for this kind, whose last success and artifacts a refusal
 *   carries forward rather than erases, or `null` when no generation has held one
 * @returns the cell
 */
export function googleAdminApiCoverageCell({
  kind,
  operations,
  records,
  truncated,
  aggregate,
  failures,
  at,
  previous,
}: {
  kind: GoogleAdminAtlasKind;
  operations: number;
  records: number;
  truncated: boolean;
  aggregate: boolean;
  failures: readonly string[];
  at: string;
  previous: GoogleAdminCoverageCell | null;
}): GoogleAdminCoverageCell {
  void kind;
  if (failures.length > 0) {
    const cell = failedCoverageCell({
      previous,
      reason: `the Admin API refused ${String(failures.length)} of the operation(s) reaching this kind — ${failures.join("; ")}`,
      role: CHANNEL_ROLES["admin-api"],
      scope: SCOPE,
      state: "unreadable",
      surface: "admin-api",
      unblockedBy:
        "read the status above: a 403 naming a SERVICE means enable that API in the Cloud project, and a 403 naming a scope or a role means the grant or the account cannot reach it",
      visibilityScope: googleAdminVisibilityScopeFor({ channel: "admin-api" }),
    });
    return toStoredCell({ cell, channel: "admin-api" });
  }
  // A list rather than a choice, because both causes can hold at once — `sync.ts` computes them
  // independently — and a reason naming only one would leave the reader to infer the other.
  const partialCauses = [
    ...(truncated ? ["a page bound was reached"] : []),
    ...(aggregate ? ["the payload is an aggregate rather than a collection"] : []),
  ];
  const partial = partialCauses.length > 0;
  const cell = succeededCoverageCell({
    artifacts: [],
    at,
    reason: partial
      ? `${String(operations)} operation(s) were called and stored ${String(records)} record(s), and the read is knowingly partial — ${partialCauses.join(", and ")}`
      : `${String(operations)} operation(s) were called and stored ${String(records)} record(s) to the end of every collection; this claim is bounded by the admin role the granted account holds`,
    role: CHANNEL_ROLES["admin-api"],
    scope: SCOPE,
    state: partial ? "deferred" : "synced",
    surface: "admin-api",
    visibilityScope: googleAdminVisibilityScopeFor({ channel: "admin-api" }),
  });
  return toStoredCell({ cell, channel: "admin-api" });
}

/**
 * Add this atlas's own `channel` discriminator to a kit-built cell.
 *
 * The kit's cell already carries `surface`, and the two are equal by construction here. They are both kept
 * because they answer different questions: `surface` is what the descriptor declares and what a reader
 * greps across atlases, while `channel` is this atlas's own closed enum, which is what makes an unknown
 * value a parse failure rather than a string nobody notices.
 *
 * @param cell the kit-built cell
 * @param channel which channel produced it
 * @returns the cell as this atlas stores it
 */
function toStoredCell({
  cell,
  channel,
}: {
  cell: AtlasCoverageCell;
  channel: GoogleAdminAtlasChannel;
}): GoogleAdminCoverageCell {
  return {
    artifacts: [...cell.artifacts],
    channel,
    lastSuccessAt: cell.lastSuccessAt,
    latestAttemptFailed: cell.latestAttemptFailed,
    reason: cell.reason,
    role: cell.role,
    scope: cell.scope,
    state: cell.state,
    surface: cell.surface,
    unblockedBy: cell.unblockedBy,
    visibilityScope: googleAdminVisibilityScopeFor({ channel }),
  };
}
