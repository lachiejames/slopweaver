/**
 * The per-control web address, and the externalId → URL table an outbound door needs to hyperlink a control
 * id it finds in composed text.
 *
 * ## Why this cannot be one template string
 *
 * A control is PRINTED as its `externalId` — `DCH-108` — and ADDRESSED by its `providerId` — `0syn0001`.
 * Nothing relates the two, so a URL cannot be derived from the text a reader sees at any price; the atlas is
 * the only lookup that yields one. That single fact is why `../../outbound/linkify/bareRefs.ts` takes
 * control links as DATA rather than building them, and why its candidacy gate is this table rather than a
 * prefix allowlist.
 *
 * ## Where the shape came from, since the provider never supplied it
 *
 * Vanta's Manage API returns no link for a control at all — `./projection.ts` passes `deepLink: null`, so a
 * control carries `deepLinkStatus: "unavailable"` until something LOADS its page. The shape was established
 * from Vanta's own web client instead: asking for the controls page while signed in redirects to a URL
 * carrying the control as a QUERY PARAMETER rather than a path segment. MEASURED by
 * `slopweaver atlas vanta walk`; reproduce the witness with
 * `grep -o '"finalUrl":"[^"]*controls[^"]*"' "$SLOPWEAVER_HOME"/atlas/vanta/browser-pages.jsonl`.
 *
 * This module used to add that the `unavailable` status "is still true after a browser walk because the walk
 * fills the browser kinds rather than the control kind". That is no longer true of every control:
 * `atlas vanta shot --control <id>` visits one control's own page and, when it reaches and photographs it,
 * writes a `browser-discovered` deep link onto that control. It stays true of every control nothing has
 * visited, and this table
 * is deliberately unaffected either way — it is keyed on the printed id and needs a URL for EVERY control,
 * including the ones nothing has visited, which is exactly why it derives one rather than reading
 * `source.deepLink`.
 *
 * The `&status=` the client appends is a list filter, deliberately omitted here: it narrows which controls
 * the page shows, and a citation that lands on a filtered view under-reports the same way `./browserPages.ts`
 * documents for the walk itself.
 *
 * ## What it does NOT hold, stated rather than discovered
 *
 * A control whose `externalId` the atlas has never seen is absent from this table, so a door consulting it
 * leaves that id as ordinary prose with nothing to refuse. That is the honest limit of an evidence-gated
 * lookup, not an oversight — see the bare-reference module's own third-kind section.
 */
import type { ComplianceControlRef } from "../../outbound/linkify/bareRefs.js";

import { vantaControlPage, vantaPageUrl, vantaTenantRootFromSlug } from "./browserPages.js";
import type { VantaEntity } from "./model.js";

/** The one shape this reads out of a control entity's manage-api detail — its printed id and its name. */
interface ControlDetailLike {
  readonly externalId?: unknown;
  readonly name?: unknown;
}

/** Whether a channel detail carries a control name a reader can be shown. */
function controlName({ detail }: { detail: unknown }): string | undefined {
  if (typeof detail !== "object" || detail === null) {
    return undefined;
  }
  const name = (detail as ControlDetailLike).name;
  if (typeof name !== "string" || name.length === 0) {
    return undefined;
  }
  return name;
}

/** Whether a channel detail carries the printed id this table is keyed on. */
function printedId({ detail }: { detail: unknown }): string | undefined {
  if (typeof detail !== "object" || detail === null) {
    return undefined;
  }
  const external = (detail as ControlDetailLike).externalId;
  return typeof external === "string" && external.length > 0 ? external : undefined;
}

/**
 * The web address of one control, as Vanta's own client spells it.
 *
 * Built from {@link ../browserPages.js#vantaControlPage} rather than spelling the path and the query
 * parameter again here, because `atlas vanta shot` NAVIGATES to that same declared page and grades where
 * the browser settled against the query it asked for. Two spellings of one address is how a citation and
 * the capture that proves it drift apart while both keep passing their own tests.
 *
 * @param tenantSlug the organisation's own Vanta slug
 * @param providerId the control's provider id — NOT the externalId a reader sees
 * @returns the absolute URL
 *
 * @internal
 */
export function vantaControlUrl({ tenantSlug, providerId }: { tenantSlug: string; providerId: string }): string {
  return vantaPageUrl({
    page: vantaControlPage({ providerId }),
    tenantRoot: vantaTenantRootFromSlug({ tenantSlug }),
  });
}

/**
 * The id a reader is shown for one control: its printed `externalId`, or its `providerId` when Vanta assigned
 * it none. Vanta's own schema marks `externalId` nullable, and a control with no printed id is still a control
 * a report has to name — by the only id it has.
 *
 * @param control the control's printed id (`DCH-108`, or `null` when Vanta assigned it none) and the id Vanta
 *   addresses it by (`0syn0001`)
 * @returns the id to print
 */
export function controlLabel({
  control,
}: {
  control: { readonly externalId: string | null; readonly providerId: string };
}): string {
  const printed = control.externalId;
  if (printed === null) {
    return control.providerId;
  }
  return printed;
}

/**
 * Every control the atlas holds, keyed by the id a reader sees, with the URL that id links to.
 *
 * Entities with no printed id are dropped rather than given a placeholder: an entry whose key nothing in
 * composed text could ever match is dead weight in a lookup, and a fabricated key would make an unrelated
 * token a candidate.
 *
 * @param entities the control kind's entities, as read from the atlas
 * @param tenantSlug the organisation's own Vanta slug, or null when it could not be resolved — a null yields
 *   entries whose `url` is null, so an id is still RECOGNISED and refused by name rather than passing as prose
 * @returns one reference per control carrying a printed id, in the order the entities were read
 */
export function vantaControlRefs({
  entities,
  tenantSlug,
}: {
  entities: readonly VantaEntity[];
  tenantSlug: string | null;
}): readonly ComplianceControlRef[] {
  const refs: ComplianceControlRef[] = [];
  for (const entity of entities) {
    const id = printedId({ detail: entity.channels["manage-api"]?.detail });
    if (id === undefined) {
      continue;
    }
    refs.push({
      id,
      url: tenantSlug === null ? null : vantaControlUrl({ providerId: entity.providerId, tenantSlug }),
    });
  }
  return refs;
}

/** One control a card can cite by its printed id: where it lives and what it is called. */
export interface VantaControlRecord {
  readonly id: string;
  readonly url: string;
  readonly name: string | undefined;
}

/**
 * Every control the atlas holds with a printed id, with its address and its name — what a console card's chip
 * links and shows on hover when a sentence names `HRS-29` bare: a control id on a card is always a hyperlink. The same address
 * {@link vantaControlRefs} gives the outbound door, plus the name that door has no use for.
 *
 * @param entities the control kind's entities, as read from the atlas
 * @param tenantSlug the organisation's own Vanta slug — a caller with none has no address to cite
 * @returns one record per control carrying a printed id, in the order the entities were read
 */
export function vantaControlRecords({
  entities,
  tenantSlug,
}: {
  entities: readonly VantaEntity[];
  tenantSlug: string;
}): readonly VantaControlRecord[] {
  return entities.flatMap((entity) => {
    const detail = entity.channels["manage-api"]?.detail;
    const id = printedId({ detail });
    if (id === undefined) {
      return [];
    }
    return [{ id, name: controlName({ detail }), url: vantaControlUrl({ providerId: entity.providerId, tenantSlug }) }];
  });
}
