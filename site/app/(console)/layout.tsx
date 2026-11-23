import type { ReactElement, ReactNode } from "react";

import { OrganisationRefusal } from "../../components/console/OrganisationRefusal";
import { OrganisationProvider } from "../../components/console/organisationState";
import { Shell } from "../../components/console/Shell";
import { readPlacementOrganisation } from "../../lib/placementOrganisationLive";
import { appearanceBootScript, appearanceStylesheet, DEFAULT_THEME_FAMILY, DEFAULT_THEME_MODE } from "../../lib/theme";
import "../console-tw.css";

export const metadata = {
  title: { default: "Slopweaver", template: "%s · Slopweaver" },
  description: "The work console: what is waiting on you, what is running, and what the fleet did.",
};

/** The organisation is read per document, never frozen into a build: `org set` can rewrite it at any time. */
export const dynamic = "force-dynamic";

/**
 * The console's document shell, a root layout of its own.
 *
 * Two root layouts on purpose rather than one shared `app/layout.tsx`: the docs shell under `/docs` is
 * Nextra's, with its theme provider, its stylesheet and its own idea of `<html>`, and the console is not
 * a docs page. Sharing a root would put the docs theme's stylesheet under every console page. The cost is
 * a full document navigation between the two, which is the rare crossing here.
 *
 * The head carries every family's palettes and the script that puts the stored family and mode on `<html>` before
 * the first paint (`lib/theme.ts`). `<html>` is rendered with the first-visit defaults the script then replaces,
 * which is why it suppresses the hydration warning; the shell's own `data-shell` and `data-sw-surface` are the
 * script's and the preload's alone, never React's.
 *
 * Every page places its rows by the organisation (`lib/workspacePlacement.ts`), so the layout reads it once, here,
 * and refuses the console when it cannot: no row, or no readable one, is a missing prerequisite with one fix,
 * `slopweaver org set`, and never a page placing rows as if it were some other organisation's.
 *
 * @param children the page
 * @returns the document
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }): Promise<ReactElement> {
  const organisation = await readPlacementOrganisation();
  let body: ReactElement;
  if (organisation.isErr()) {
    body = <OrganisationRefusal error={organisation.error} />;
  } else {
    body = (
      <OrganisationProvider organisation={organisation.value}>
        <Shell>{children}</Shell>
      </OrganisationProvider>
    );
  }
  return (
    <html
      lang="en"
      dir="ltr"
      data-sw-family={DEFAULT_THEME_FAMILY}
      data-sw-mode={DEFAULT_THEME_MODE}
      suppressHydrationWarning
    >
      <head>
        <style dangerouslySetInnerHTML={{ __html: appearanceStylesheet() }} />
        <script dangerouslySetInnerHTML={{ __html: appearanceBootScript() }} />
      </head>
      <body style={{ margin: 0 }}>{body}</body>
    </html>
  );
}
