/**
 * How the Nightfall atlas grades what it has and has not seen, per kind and per channel.
 *
 * The cell CONSTRUCTORS are `kit/coverage.ts`'s; what is here is the one judgement the kit cannot make —
 * which state each channel earns for each kind on this platform, and what would unblock it.
 *
 * ## A kind the published documents describe is not a kind this atlas has READ
 *
 * The distinction is the whole reason this file exists. `published-api` genuinely SUCCEEDED for every kind:
 * it read the vendor's own declaration of what a violation is, and that is a complete result for what that
 * channel can ever claim. `workflow-api` has not been attempted at all, and neither has `console`. Grading
 * all three from one number would make a fully mapped platform read as fully ingested, which is the exact
 * dishonesty `docs/atlas-intent/settled-decisions.md`'s coverage property exists to prevent.
 *
 * So each kind carries three cells. The first is `synced`, the other two `not-configured` — a state that
 * says "this atlas is not the source of record for this yet, and here is the credential that would change
 * that" — each naming its own remedy in `unblockedBy`.
 */
import { type AtlasCoverageCell, failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";

import {
  NIGHTFALL_ATLAS_PLATFORM,
  type NightfallAtlasChannel,
  type NightfallAtlasKind,
  type NightfallCoverageCell,
  nightfallVisibilityScopeFor,
} from "./model.js";

/** What each channel's evidence is worth, in the kit's own vocabulary. */
const CHANNEL_ROLES = {
  console: "corroborating",
  "published-api": "authoritative",
  "workflow-api": "authoritative",
} as const;

/** What would fill each unfilled channel, stated as the concrete act that does it. */
const CHANNEL_REMEDIES = {
  console:
    "sign in to app.nightfall.ai in the work Chrome profile, then run: slopweaver atlas nightfall walk — the cookie probe reports no session today and nothing here signs in on the owner's behalf",
  "published-api": null,
  "workflow-api":
    "mint a Nightfall API key in the console and store it: slopweaver secrets set nightfall-api-key — every published operation declares bearerAuth and this installation holds no Nightfall credential",
} as const;

/**
 * The scope string a cell carries.
 *
 * The platform name rather than a tenant label, because a tenant identifier is a private identifier this
 * repository may not carry — the same choice `trelica/readAdapter.ts` makes and for the same reason.
 */
const SCOPE = NIGHTFALL_ATLAS_PLATFORM;

/**
 * The coverage cell the compiled channel earns for one kind.
 *
 * `synced` is the honest grade and it is a narrow claim: the vendor's published declaration of this kind was
 * read completely. It says nothing about the organisation's own records, which is what the two cells beside
 * it are for.
 *
 * @param kind the kind this cell grades
 * @param operations how many of the registry's operations belong to it — quoted in the reason so a reader
 * sees the size of what was mapped without opening the generated table
 * @param at this run's ISO timestamp
 * @returns the cell, stamped as a fresh success
 */
export function nightfallPublishedCoverageCell({
  kind,
  operations,
  at,
}: {
  kind: NightfallAtlasKind;
  operations: number;
  at: string;
}): NightfallCoverageCell {
  const cell = succeededCoverageCell({
    artifacts: [],
    at,
    reason:
      operations === 0
        ? `no published operation declares ${kind} — it is declared so a channel that finds one has somewhere to land it`
        : `the vendor's six published documents declare ${operations} operation(s) for ${kind}, and its record shape was read from their own component schemas; this grades the MAP, never this organisation's records`,
    role: CHANNEL_ROLES["published-api"],
    scope: SCOPE,
    state: "synced",
    surface: "published-api",
    visibilityScope: nightfallVisibilityScopeFor({ channel: "published-api" }),
  });
  return toStoredCell({ cell, channel: "published-api" });
}

/**
 * The coverage cell an unattempted live channel earns for one kind.
 *
 * `failedCoverageCell` rather than a hand-built literal, because it is the constructor that carries the
 * prior success forward — the day a walk succeeds and a later one fails, this cell must stop being current
 * without erasing what was seen.
 *
 * @param channel which live channel this grades
 * @param kind the kind this cell grades
 * @param at this run's ISO timestamp, carried for symmetry with the succeeded cell
 * @param previous the cell as it stood before this run, or `null` when this channel was never touched
 * @returns the cell, marked not-configured with its own remedy
 */
export function nightfallUnconfiguredCoverageCell({
  channel,
  kind,
  at,
  previous,
}: {
  channel: "workflow-api" | "console";
  kind: NightfallAtlasKind;
  at: string;
  previous: NightfallCoverageCell | null;
}): NightfallCoverageCell {
  void at;
  void kind;
  const cell = failedCoverageCell({
    previous,
    reason:
      channel === "workflow-api"
        ? "no Nightfall credential is configured on this installation, so no operation has been called"
        : "no signed-in console session exists in the owner's own Chrome, so no page has been opened",
    role: CHANNEL_ROLES[channel],
    scope: SCOPE,
    state: "not-configured",
    surface: channel,
    unblockedBy: CHANNEL_REMEDIES[channel],
    visibilityScope: nightfallVisibilityScopeFor({ channel }),
  });
  return toStoredCell({ cell, channel });
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
  channel: NightfallAtlasChannel;
}): NightfallCoverageCell {
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
    visibilityScope: nightfallVisibilityScopeFor({ channel }),
  };
}
