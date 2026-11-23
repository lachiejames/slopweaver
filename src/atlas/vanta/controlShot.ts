/**
 * Photographing ONE control, and what that photograph is allowed to establish.
 *
 * ## Why a picture of the controls index is not a picture of a control
 *
 * An ISO answer shows its evidence to show its evidence, and `browser-walk` fills the
 * twelve navigation surfaces. Neither the controls INDEX nor its coverage cell says anything about one
 * control: a reader shown the list has been shown that the list exists. So the useful capture is per
 * control, at the control's own address, and that is what this file's pages are.
 *
 * ## The id in a document is not the id in the URL
 *
 * `controlId` carries the control's PROVIDER id and a compliance document carries its `externalId` —
 * `DCH-108` is `0syn0001`, `HRS-52` is `0syn0002`, `CRY-56` is `data-encrypted-gdpr`. A verb that took the
 * id at face value would photograph the wrong control for two of those three and be right by accident for
 * the third, with nothing anywhere saying so. {@link resolveVantaControlIds} is therefore the FIRST thing
 * that happens, against the atlas's own control kind, and an id it cannot place is refused rather than
 * guessed at.
 *
 * ## A deep link is recorded only after it has been LOADED
 *
 * `browserPages.ts` used to refuse a per-control URL as a guess at a route, and the correction is narrower
 * than "the shape is known now": the shape came from Vanta's own client rewriting an address, which is
 * evidence about one control. So a control's `browser-discovered` deep link is written only for a control
 * whose page this verb actually asked for, reached and photographed — never derived for every other control
 * from a template. That is the difference between `browser-discovered` and `unverified`, and it is the whole
 * reason the status vocabulary has both.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { isPageHeld, notHeldBecause } from "../kit/pageWalk.js";

import { type VantaBrowserPage, vantaControlPage, vantaControlSurface } from "./browserPages.js";
import type { VantaPageObservation } from "./browserWalk.js";
import { type VantaControlShotError, VantaControlShotErrors } from "./controlShotErrors.js";
import { vantaEntityId } from "./identity.js";
import type { VantaEntity, VantaKind } from "./model.js";

/** One control this verb was asked for, as the atlas places it. */
export interface ResolvedVantaControl {
  /** What the caller typed, kept so a report can echo it back in their own words. */
  readonly asked: string;
  /** The provider id `controlId` takes — the only id the web client answers to. */
  readonly providerId: string;
  /** The id a compliance document prints, when the atlas holds one. */
  readonly externalId: string | null;
  /** The control's own name, for a report line. */
  readonly name: string | null;
}

/** What one control kind entity has to expose for an id to be resolved against it. */
export interface VantaControlLookupRow {
  readonly providerId: string;
  readonly externalId: string | null;
  readonly name: string | null;
}

/**
 * Read the lookup table one control kind file provides.
 *
 * The detail is `unknown` on a stored entity, so every field is read defensively and a control whose detail
 * is not an object still contributes its `providerId` — which is the only field the URL actually needs.
 *
 * @param entities the control kind's stored entities
 * @returns one row per control, in the order they were stored
 */
export function vantaControlLookup({
  entities,
}: {
  entities: readonly VantaEntity[];
}): readonly VantaControlLookupRow[] {
  return entities.map((entity): VantaControlLookupRow => {
    const detail: unknown = entity.channels["manage-api"]?.detail;
    const record = isRecord(detail) ? detail : {};
    const externalId = record["externalId"];
    const name = record["name"];
    return {
      externalId: typeof externalId === "string" ? externalId : null,
      name: typeof name === "string" ? name : null,
      providerId: entity.providerId,
    };
  });
}

/**
 * The control one lowercased id names, by either of the two ids a control carries.
 *
 * Two passes rather than one predicate, because the ORDER is the rule: a provider id anywhere in the set
 * beats an external id, so a string that is one control's `controlId` and another's `externalId` reaches
 * the control the URL would actually load.
 *
 * @param rows the lookup table to search
 * @param wanted the id, already trimmed and lowercased
 * @returns the row, or `undefined` when neither id matches
 */
function placeOneId({
  rows,
  wanted,
}: {
  rows: readonly VantaControlLookupRow[];
  wanted: string;
}): VantaControlLookupRow | undefined {
  const byProviderId = rows.find((candidate) => candidate.providerId.toLowerCase() === wanted);
  if (byProviderId !== undefined) {
    return byProviderId;
  }
  return rows.find((candidate) => candidate.externalId?.toLowerCase() === wanted);
}

/**
 * Place every id the caller asked for against the atlas's own control set.
 *
 * Matches a provider id first and an `externalId` second, both case-insensitively, so `DCH-108` and
 * `0syn0001` both reach the same control and neither has to be the one the caller happened to have.
 *
 * @param asked the ids the caller named, in their own words
 * @param rows the lookup table from {@link vantaControlLookup}
 * @returns one resolved control per id asked for, or every id the atlas cannot place
 */
export function resolveVantaControlIds({
  asked,
  rows,
}: {
  asked: readonly string[];
  rows: readonly VantaControlLookupRow[];
}): Result<readonly ResolvedVantaControl[], VantaControlShotError> {
  if (asked.length === 0) {
    return err(VantaControlShotErrors.noControlAsked());
  }
  if (rows.length === 0) {
    return err(VantaControlShotErrors.atlasHoldsNoControls());
  }
  const resolved: ResolvedVantaControl[] = [];
  const unplaced: string[] = [];
  for (const one of asked) {
    const row = placeOneId({ rows, wanted: one.trim().toLowerCase() });
    if (row === undefined) {
      unplaced.push(one);
      continue;
    }
    resolved.push({ asked: one, externalId: row.externalId, name: row.name, providerId: row.providerId });
  }
  if (unplaced.length > 0) {
    return err(VantaControlShotErrors.notPlaced({ unplaced }));
  }
  // Two ids can name one control — `DCH-108` and `0syn0001` are the same page — and asking for it twice
  // would make the kit's duplicate-picture check withdraw both claims, since the two shots are one file.
  const seen = new Set<string>();
  return ok(resolved.filter((one) => (seen.has(one.providerId) ? false : (seen.add(one.providerId), true))));
}

/**
 * The declared page list for one shot: one page per resolved control.
 *
 * @param controls the resolved controls
 * @returns the pages the walk engine is graded against
 */
export function vantaControlPages({
  controls,
}: {
  controls: readonly ResolvedVantaControl[];
}): readonly VantaBrowserPage[] {
  return controls.map((control) => vantaControlPage({ providerId: control.providerId }));
}

/**
 * One entity carrying what a browser capture proved about it: the address it was reached at, the picture of
 * it, and whatever detail its kind wants.
 *
 * Shared by the two entities one shot writes — the control and its own page — because the difference
 * between them is a kind, a provider id and a detail bag, and everything else is the browser channel's own
 * shape. A copy per kind is where a `deepLinkStatus` or an artifact list quietly diverges.
 *
 * @param kind which kind this entity is
 * @param providerId the entity's own provider id
 * @param detail what this kind records about the capture
 * @param page the observation of the page that was reached
 * @param at this run's ISO timestamp, used when the page has no instant of its own
 * @returns the entity, with only its browser channel populated
 */
function browserCapturedEntity({
  kind,
  providerId,
  detail,
  page,
  at,
}: {
  kind: VantaKind;
  providerId: string;
  detail: unknown;
  page: VantaPageObservation;
  at: string;
}): VantaEntity {
  // A page nobody reached has `observedAt: ""` and `finalUrl: ""` — honestly, because nothing was seen —
  // and a source built from those refuses the whole generation on the schema. See `browserEntities.ts`'s
  // `pageEntity` for the live run that measured it.
  const observed = page.observedAt !== "" && page.finalUrl !== "";
  return {
    channels: {
      browser: {
        channel: "browser",
        detail,
        firstSeenAt: observed ? page.observedAt : at,
        lastSeenAt: observed ? page.observedAt : at,
        source: observed
          ? {
              artifacts: [...page.artifacts],
              channel: "browser",
              deepLink: page.finalUrl,
              deepLinkStatus: "browser-discovered",
              endpoint: page.finalUrl,
              observedAt: page.observedAt,
            }
          : null,
        state: "observed",
      },
      "manage-api": null,
    },
    financialDetail: null,
    id: vantaEntityId({ components: { providerId }, kind }),
    kind,
    providerId,
    sensitivity: null,
  };
}

/**
 * The control entity carrying what this shot proved about it.
 *
 * Only ever built for a page that is fully HELD — reached, photographed, and carrying the artifact to prove
 * it. A control whose page did not load has learnt nothing about its own URL, and writing a deep link for
 * it would put the guess back that this whole verb exists to avoid.
 *
 * @param control the resolved control
 * @param page its page's observation
 * @param at this run's ISO timestamp
 * @returns the entity to merge into the control kind's browser channel
 */
export function shotControlEntity({
  control,
  page,
  at,
}: {
  control: ResolvedVantaControl;
  page: VantaPageObservation;
  at: string;
}): VantaEntity {
  return browserCapturedEntity({
    at,
    detail: {
      externalId: control.externalId,
      name: control.name,
      statusCode: page.statusCode,
      title: page.title,
    },
    kind: "control",
    page,
    providerId: control.providerId,
  });
}

/**
 * One control's page as a `browser-page` entity, carrying the picture that proves it.
 *
 * @param page the observation of that page
 * @param at this run's ISO timestamp
 * @returns the entity to merge into the `browser-page` kind
 */
export function shotPageEntity({ page, at }: { page: VantaPageObservation; at: string }): VantaEntity {
  return browserCapturedEntity({
    at,
    detail: {
      attempted: page.attempted,
      captureComplete: page.captureComplete,
      finalUrl: page.finalUrl,
      operationCount: page.calls.length,
      redirected: page.redirected,
      responseAccounting: page.responseAccounting,
      screenshotMissingBecause: page.screenshotMissingBecause,
      statusCode: page.statusCode,
      surface: page.surface,
      title: page.title,
      unreachableBecause: page.unreachableBecause,
    },
    kind: "browser-page",
    page,
    providerId: page.surface,
  });
}

/**
 * Why a page the walk DID return is not held, in the words of whichever check failed.
 *
 * The three cases are ordered rather than coalesced: a page nobody reached says so first, a page reached
 * without a picture says that, and the last line covers a page whose picture was withdrawn — the kit's
 * duplicate-shot or bytes-not-on-disk checks, which leave both reasons null and still refuse to hold it.
 *
 * @param page the observation, already known not to be held
 * @returns the reason, never an empty string
 */
function whyNotHeld({ page }: { page: VantaPageObservation }): string {
  const because = notHeldBecause({ page });
  if (because === null) {
    return "the page was reached and carries no verified screenshot";
  }
  return because;
}

/**
 * Pair each resolved control with the observation of its own page.
 *
 * Paired by SURFACE NAME rather than by position, because the walk engine may return a row for a page it
 * never asked for — a lost session leaves an unattempted row for everything after it — and a positional
 * pairing would attach one control's picture to another control's id.
 *
 * @param controls the resolved controls
 * @param pages every page the walk observed
 * @returns one pair per control whose page is fully held, and the controls that are not
 */
export function pairControlObservations({
  controls,
  pages,
}: {
  controls: readonly ResolvedVantaControl[];
  pages: readonly VantaPageObservation[];
}): {
  readonly held: readonly { control: ResolvedVantaControl; page: VantaPageObservation }[];
  readonly unheld: readonly { control: ResolvedVantaControl; because: string }[];
} {
  const held: { control: ResolvedVantaControl; page: VantaPageObservation }[] = [];
  const unheld: { control: ResolvedVantaControl; because: string }[] = [];
  for (const control of controls) {
    const surface = vantaControlSurface({ providerId: control.providerId });
    const page = pages.find((candidate) => candidate.surface === surface);
    if (page === undefined) {
      unheld.push({ because: "the walk returned no row for this control's page", control });
      continue;
    }
    if (!isPageHeld({ page })) {
      unheld.push({ because: whyNotHeld({ page }), control });
      continue;
    }
    held.push({ control, page });
  }
  return { held, unheld };
}
