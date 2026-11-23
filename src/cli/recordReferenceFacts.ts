/**
 * Every record a queue card may name by a bare printed id — a Datadog monitor, a Vanta control, a Vanta risk —
 * with the address its citation chip opens and the title its hover card shows, for `handover list --json`'s
 * `referenceContext.records`.
 *
 * A printed id on a card is a link, never plain text: a Datadog monitor opens in a citation chip like a Slack
 * one, and neither `HRS-29` (a Vanta control) nor `TTX-2` (a Vanta risk) is a Linear issue, so each needs its
 * own address.
 *
 * A page cannot build any of these addresses itself. A monitor's lives on the install's Datadog console host,
 * which only `../datadog/config.ts` derives from a site; a control's carries a provider id nothing in its printed
 * id gives (`../atlas/vanta/controlLinks.ts`). So the CLI resolves each through the code that already owns it and
 * publishes the table, and the console only looks ids up in it.
 *
 * Read best-effort, the way `./linearReferenceFacts.ts` reads: an absent census or atlas is a normal install, and
 * only narrows which ids link.
 */
import { VANTA_RISK_REGISTER_PAGE, vantaPageUrl, vantaTenantRootFromSlug } from "../atlas/vanta/browserPages.js";
import { vantaControlRecords } from "../atlas/vanta/controlLinks.js";
import type { VantaEntity } from "../atlas/vanta/model.js";
import { readVantaKindFile, vantaAtlasPaths } from "../atlas/vanta/store.js";
import { resolveVantaTenantSlug } from "../atlas/vanta/tenantSlug.js";
import { consoleHostFor, resolveSite } from "../datadog/config.js";
import type { CatalogueManifest } from "../datadog/detective/catalogue.js";
import { readCatalogueManifest } from "../datadog/detective/store.js";
import { monitorPageUrl } from "../datadog/shot/targetUrl.js";

/** Which register a printed id belongs to. */
type RecordReferenceKind = "datadog-monitor" | "vanta-control" | "vanta-risk";

/** One record a card may name bare, as `referenceContext.records` publishes it. */
export interface RecordReferenceFact {
  /** The id as a sentence prints it: `50001`, `HRS-29`, `TTX-2`. */
  readonly id: string;
  readonly kind: RecordReferenceKind;
  /** Where the chip goes. */
  readonly url: string;
  /** What the hover card names it — a monitor's name, a control's, a risk's scenario — when one is known. */
  readonly title: string | undefined;
}

/**
 * A printed Vanta id a sentence can name without being ordinary prose: two to six capitals, a dash, digits — the
 * outbound door's own criterion (`CONTROL_ID_SHAPE`, `../outbound/linkify/bareRefs.ts`), which leaves `C-1` and the
 * bare-number controls (`200`) as words because nothing tells them apart from a count.
 */
const PRINTED_ID = /^[A-Z]{2,6}-\d{1,6}$/u;

/**
 * Every monitor a Datadog census mapped, linked on the console host its own site names.
 *
 * @param manifest the census manifest, whose `site` the pass read
 * @returns one fact per monitor; none when the site is not one `../datadog/config.ts` knows a console for
 */
export function monitorRecordFacts({ manifest }: { manifest: CatalogueManifest }): readonly RecordReferenceFact[] {
  const site = resolveSite({ raw: manifest.site });
  if (site.isErr()) {
    return [];
  }
  const consoleHost = consoleHostFor({ site: site.value });
  return manifest.map.monitors.map((monitor) => {
    const monitorId = String(monitor.id);
    return {
      id: monitorId,
      kind: "datadog-monitor",
      title: monitor.name.length > 0 ? monitor.name : undefined,
      url: monitorPageUrl({ consoleHost, monitorId }),
    };
  });
}

/**
 * A risk's scenario as a hover card may show it — never one Vanta marks sensitive.
 *
 * @returns the description, or `undefined`
 */
function riskTitle({ entity }: { entity: VantaEntity }): string | undefined {
  if (entity.sensitivity?.providerMarkedSensitive === true) {
    return undefined;
  }
  const detail = entity.channels["manage-api"]?.detail;
  if (typeof detail !== "object" || detail === null || !("description" in detail)) {
    return undefined;
  }
  const { description } = detail;
  if (typeof description !== "string" || description.length === 0) {
    return undefined;
  }
  return description;
}

/**
 * Every Vanta control and risk with a printed id, linked under the tenant. A control opens its own page; a risk
 * opens the register, the one risk address ever measured (`VANTA_RISK_REGISTER_PAGE`).
 *
 * @param controls the control kind's entities
 * @param risks the risk kind's entities, whose provider id IS the printed `TTX-2`
 * @param tenantSlug the organisation's Vanta slug
 * @returns the facts, controls first
 */
export function vantaRecordFacts({
  controls,
  risks,
  tenantSlug,
}: {
  controls: readonly VantaEntity[];
  risks: readonly VantaEntity[];
  tenantSlug: string;
}): readonly RecordReferenceFact[] {
  const controlFacts = vantaControlRecords({ entities: controls, tenantSlug })
    .filter((control) => PRINTED_ID.test(control.id))
    .map((control): RecordReferenceFact => ({
      id: control.id,
      kind: "vanta-control",
      title: control.name,
      url: control.url,
    }));
  const register = vantaPageUrl({
    page: VANTA_RISK_REGISTER_PAGE,
    tenantRoot: vantaTenantRootFromSlug({ tenantSlug }),
  });
  const riskFacts = risks
    .filter((risk) => PRINTED_ID.test(risk.providerId))
    .map((risk): RecordReferenceFact => ({
      id: risk.providerId,
      kind: "vanta-risk",
      title: riskTitle({ entity: risk }),
      url: register,
    }));
  return [...controlFacts, ...riskFacts];
}

/**
 * One Vanta kind's entities, none when the atlas holds no file for it or it will not read.
 *
 * @returns the entities
 */
function vantaEntities({ home, kind }: { home: string; kind: "control" | "risk" }): readonly VantaEntity[] {
  const file = readVantaKindFile({ kind, paths: vantaAtlasPaths({ home }) });
  if (file.isErr() || file.value === null) {
    return [];
  }
  return file.value.entities;
}

/**
 * Every record this install can cite by a printed id, off its Datadog census and its Vanta atlas.
 *
 * @param home the state home the census and the atlas are read from
 * @param env the environment the Vanta tenant slug may come from
 * @returns the facts — monitors, then controls, then risks; a source that is absent or will not read gives none
 */
export function recordReferenceFacts({
  home,
  env,
}: {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}): readonly RecordReferenceFact[] {
  const manifest = readCatalogueManifest({ home });
  const monitors = manifest.isOk() ? monitorRecordFacts({ manifest: manifest.value }) : [];
  const slug = resolveVantaTenantSlug({ env, flag: null, home });
  if (slug.isErr()) {
    return monitors;
  }
  return [
    ...monitors,
    ...vantaRecordFacts({
      controls: vantaEntities({ home, kind: "control" }),
      risks: vantaEntities({ home, kind: "risk" }),
      tenantSlug: slug.value,
    }),
  ];
}
