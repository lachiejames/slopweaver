/**
 * The effectful edge of `./orgChart.ts`: read the Google directory bronze and the Vanta atlas's `person` and `group`
 * kind files off `$SLOPWEAVER_HOME`, and index them. Local files only — nothing here calls Google or Vanta; those
 * stores are filled by `slopweaver directory` and `slopweaver atlas vanta sync`.
 */
import type { VantaEntity } from "../../atlas/vanta/model.js";
import { readVantaKindFile, vantaAtlasPaths } from "../../atlas/vanta/store.js";
import { readGoogleDirectory } from "../directory/store.js";
import { type OrgChart, orgChartIndex } from "./orgChartIndex.js";

/**
 * One Vanta kind's entities — none when the atlas never stored the kind, and a warning when its file cannot be
 * trusted, so a chip missing its groups is said rather than silent.
 *
 * @returns the entities, and why none were read when the file was refused
 */
function vantaEntities({ home, kind }: { home: string; kind: "person" | "group" }): {
  readonly entities: readonly VantaEntity[];
  readonly warnings: readonly string[];
} {
  const read = readVantaKindFile({ kind, paths: vantaAtlasPaths({ home }) });
  if (read.isErr()) {
    return { entities: [], warnings: read.error.map((reason) => `vanta ${kind} atlas unreadable: ${reason}`) };
  }
  if (read.value === null) {
    return { entities: [], warnings: [] };
  }
  return { entities: read.value.entities, warnings: [] };
}

/**
 * The org chart this install holds.
 *
 * @param home the Slopweaver home
 * @returns the indexed chart, and every warning a store's read raised
 */
export function readOrgChart({ home }: { home: string }): {
  readonly chart: OrgChart;
  readonly warnings: readonly string[];
} {
  const directory = readGoogleDirectory({ home });
  const people = vantaEntities({ home, kind: "person" });
  const groups = vantaEntities({ home, kind: "group" });
  return {
    chart: orgChartIndex({ directory: directory.rows, vantaGroups: groups.entities, vantaPeople: people.entities }),
    warnings: [...directory.warnings, ...people.warnings, ...groups.warnings],
  };
}
