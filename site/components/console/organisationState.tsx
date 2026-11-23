"use client";

import { createContext, type ReactElement, type ReactNode, useContext, useMemo } from "react";

import type { PlacementOrganisation } from "../../lib/placementOrganisation";
import { buildWorkspacePlacer, type WorkspacePlacer } from "../../lib/workspacePlacement";

/** Everything the console reads off the organisation, from the one reading the layout made. */
interface OrganisationValue {
  /** What every page places its rows through. */
  readonly placer: WorkspacePlacer;
  /** The team context's name, on the switcher, the page chip, the hidden-row note, the panels and the team mark. */
  readonly teamLabel: string;
}

/** The organisation's values; absent outside the provider, never defaulted. */
const OrganisationContext = createContext<OrganisationValue | undefined>(undefined);

/**
 * Hand the console's pages the organisation. The layout reads it once on the server and passes the plain fields; the
 * placer and the team label are both derived here from that one reading, so a row can never be placed by one
 * organisation while the label names another. The placer is built on the client, so no function crosses that boundary.
 *
 * @param organisation the fields `org show --json` printed that the console reads
 * @returns the provider
 */
export function OrganisationProvider({
  organisation,
  children,
}: {
  organisation: PlacementOrganisation;
  children: ReactNode;
}): ReactElement {
  const value = useMemo(
    (): OrganisationValue => ({
      placer: buildWorkspacePlacer({ organisation }),
      teamLabel: organisation.displayName,
    }),
    [organisation],
  );
  return <OrganisationContext.Provider value={value}>{children}</OrganisationContext.Provider>;
}

/**
 * The provider's values. The console layout refuses to mount a page without an organisation, so a component reaching
 * this outside the provider is wiring that is wrong — it throws rather than reading some other organisation.
 *
 * @param hook the hook asking, named in the throw
 * @returns the values
 */
function useOrganisationValue({ hook }: { hook: string }): OrganisationValue {
  const value = useContext(OrganisationContext);
  if (value === undefined) {
    throw new Error(`${hook}: no OrganisationProvider above this component. The console layout mounts one`);
  }
  return value;
}

/**
 * The organisation's placer.
 *
 * @returns the placer
 */
export function useWorkspacePlacer(): WorkspacePlacer {
  return useOrganisationValue({ hook: "useWorkspacePlacer" }).placer;
}

/**
 * The team context's name: the organisation's display name, as `slopweaver org set` wrote it.
 *
 * @returns the name
 */
export function useTeamLabel(): string {
  return useOrganisationValue({ hook: "useTeamLabel" }).teamLabel;
}
