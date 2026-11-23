/**
 * How the Canva atlas grades what it has and has not seen, per kind and per channel.
 *
 * The cell CONSTRUCTORS are `kit/coverage.ts`'s; what is here is the one judgement the kit cannot make —
 * which state each channel earns for each kind on this platform, and what would unblock it.
 *
 * ## A kind the published description covers is not a kind this atlas has READ
 *
 * The distinction is the whole reason this file exists. `published-api` genuinely SUCCEEDED for every kind:
 * it read the vendor's own declaration of what can be asked, and that is a complete result for what that
 * channel can ever claim. `connect-api` has not been attempted at all, and neither has `web-app`. Grading
 * all three from one number would make a fully mapped platform read as fully ingested, which is the exact
 * dishonesty `docs/atlas-intent/settled-decisions.md`'s coverage property exists to prevent.
 *
 * ## The two unfilled channels are unfilled for DIFFERENT reasons, and their remedies say so
 *
 * MEASURED, and worth stating in the remedy rather than generically, because the two are not the
 * same shape of blocked. `connect-api` needs an artefact that does not exist — a registered Canva
 * integration and a user's authorisation-code grant — and nothing here can create one. `web-app` needs no
 * new credential at all: `slopweaver browser cookies --origin https://www.canva.com` reports the cookies
 * the owner's own Chrome profile holds for that origin, so the session is already there and what is missing is the walk itself.
 * A remedy naming a sign-in that has already happened would send a reader to do nothing.
 */
import { type AtlasCoverageCell, failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";

import {
  CANVA_ATLAS_PLATFORM,
  type CanvaAtlasChannel,
  type CanvaAtlasKind,
  type CanvaCoverageCell,
  canvaVisibilityScopeFor,
} from "./model.js";

/** What each channel's evidence is worth, in the kit's own vocabulary. */
const CHANNEL_ROLES = {
  "connect-api": "authoritative",
  "published-api": "authoritative",
  "web-app": "corroborating",
} as const;

/** What would fill each unfilled channel, stated as the concrete act that does it. */
const CHANNEL_REMEDIES = {
  "connect-api":
    "register a Canva integration at canva.com/developers, complete its authorisation-code grant as the acting user, and store the result: slopweaver secrets set canva-access-token — 53 of the 59 published operations declare oauthAuthCode and this installation holds no Canva credential of any kind",
  "published-api": null,
  "web-app":
    "build and run the web-app walk — this one is NOT blocked on the owner: `slopweaver browser cookies --origin https://www.canva.com` already reports the cookies the owner's own Chrome profile holds for that origin, so a signed-in session exists and what is missing is the walk itself",
} as const;

/**
 * The scope string a cell carries.
 *
 * The platform name rather than an account label, because an account identifier is a private identifier this
 * repository may not carry — the same choice `trelica/readAdapter.ts` makes and for the same reason.
 */
const SCOPE = CANVA_ATLAS_PLATFORM;

/**
 * The coverage cell the compiled channel earns for one kind.
 *
 * `synced` is the honest grade and it is a narrow claim: the vendor's published declaration of this product
 * area was read completely. It says nothing about anybody's designs, which is what the two cells beside it
 * are for.
 *
 * @param kind the kind this cell grades
 * @param operations how many of the registry's operations belong to it — quoted in the reason so a reader
 * sees the size of what was mapped without opening the generated table
 * @param scopes how many declared OAuth scopes this kind governs, for the same reason
 * @param at this run's ISO timestamp
 * @returns the cell, stamped as a fresh success
 */
export function canvaPublishedCoverageCell({
  kind,
  operations,
  scopes,
  at,
}: {
  kind: CanvaAtlasKind;
  operations: number;
  scopes: number;
  at: string;
}): CanvaCoverageCell {
  const nothingMapped = operations === 0 && scopes === 0;
  const cell = succeededCoverageCell({
    artifacts: [],
    at,
    reason: nothingMapped
      ? `Canva's published description declares no operation and no scope for ${kind} — it is declared so a channel that finds one has somewhere to land it`
      : `Canva's published description declares ${operations} operation(s) and ${scopes} OAuth scope(s) for ${kind}, with each operation's own stability and entitlement read from the vendor's prose; this grades the MAP, never anybody's designs`,
    role: CHANNEL_ROLES["published-api"],
    scope: SCOPE,
    state: "synced",
    surface: "published-api",
    visibilityScope: canvaVisibilityScopeFor({ channel: "published-api" }),
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
 * @param at this run's ISO timestamp, carried for symmetry with the succeeded cell
 * @param previous the cell as it stood before this run, or `null` when this channel was never touched
 * @returns the cell, marked not-configured with its own remedy
 */
export function canvaUnconfiguredCoverageCell({
  channel,
  at,
  previous,
}: {
  channel: "connect-api" | "web-app";
  at: string;
  previous: CanvaCoverageCell | null;
}): CanvaCoverageCell {
  void at;
  const cell = failedCoverageCell({
    previous,
    reason:
      channel === "connect-api"
        ? "no Canva integration or access token is configured on this installation, so no operation has been called"
        : "no walk of canva.com has been run, so no page has been opened — the session exists and the walk does not",
    role: CHANNEL_ROLES[channel],
    scope: SCOPE,
    state: "not-configured",
    surface: channel,
    unblockedBy: CHANNEL_REMEDIES[channel],
    visibilityScope: canvaVisibilityScopeFor({ channel }),
  });
  return toStoredCell({ cell, channel });
}

/**
 * Add this atlas's own `channel` discriminator to a kit-built cell.
 *
 * The kit's cell already carries `surface`, and the two are equal by construction here. They are both kept
 * because they answer different questions: `surface` is what the descriptor declares and what a reader greps
 * across atlases, while `channel` is this atlas's own closed enum, which is what makes an unknown value a
 * parse failure rather than a string nobody notices.
 *
 * @param cell the kit-built cell
 * @param channel which channel produced it
 * @returns the cell as this atlas stores it
 */
function toStoredCell({ cell, channel }: { cell: AtlasCoverageCell; channel: CanvaAtlasChannel }): CanvaCoverageCell {
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
    visibilityScope: canvaVisibilityScopeFor({ channel }),
  };
}
