import type { ReactElement, ReactNode } from "react";

import { AppearanceSync } from "../../../components/console/AppearanceSync";
import { OrganisationRefusal } from "../../../components/console/OrganisationRefusal";
import { OrganisationProvider } from "../../../components/console/organisationState";
import { readPlacementOrganisation } from "../../../lib/placementOrganisationLive";
import {
  appearanceBootScript,
  appearanceStylesheet,
  DEFAULT_THEME_FAMILY,
  DEFAULT_THEME_MODE,
} from "../../../lib/theme";
import "../../console-tw.css";

export const metadata = {
  title: "voice · Slopweaver",
};

/** The organisation is read per document, never frozen into a build, as the console's layout reads it. */
export const dynamic = "force-dynamic";

/**
 * The voice over the owner's whole desktop, a root layout of its own: the desktop shell (`desktop/`) loads this page in a
 * transparent window above every other one, so the document paints nothing but what the voice draws — the
 * console's page background would cover the owner's desktop. What it does draw is opaque, the messenger included: the
 * desktop shows around the orb and its panels, never through them. It carries the console's theme and stylesheet so
 * the orb and the stage look exactly as they do in the console, and no sidebar, because the console window has that.
 * A theme or mode picked there reaches this window live through `AppearanceSync`, the same listener the console mounts.
 * The voice reads the Queue's rows, placed by the organisation, so this reads it once and refuses as the console does.
 *
 * @param children the page
 * @returns the document
 */
export default async function OverlayLayout({ children }: { children: ReactNode }): Promise<ReactElement> {
  const organisation = await readPlacementOrganisation();
  let body: ReactElement;
  if (organisation.isErr()) {
    body = <OrganisationRefusal error={organisation.error} />;
  } else {
    body = <OrganisationProvider organisation={organisation.value}>{children}</OrganisationProvider>;
  }
  return (
    <html
      lang="en"
      dir="ltr"
      data-sw-family={DEFAULT_THEME_FAMILY}
      data-sw-mode={DEFAULT_THEME_MODE}
      style={{ background: "transparent" }}
      suppressHydrationWarning
    >
      <head>
        <style dangerouslySetInnerHTML={{ __html: appearanceStylesheet() }} />
        <script dangerouslySetInnerHTML={{ __html: appearanceBootScript() }} />
      </head>
      <body style={{ background: "transparent", margin: 0 }}>
        {body}
        <AppearanceSync />
      </body>
    </html>
  );
}
