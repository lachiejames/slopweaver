"use client";

/**
 * The console window's page moving itself when the shell asks, apart from `useDesktopShell.ts` because it needs the
 * Next router, which the voice's modules (and the unit lane that imports them) never load.
 */
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { shellNavigationPathOf } from "../../lib/desktopShell";
import { desktopBridge } from "../voice/useDesktopShell";

/**
 * In the shell's console window, take the shell's requests to go to another console page as this page's own
 * navigation, so a card the voice opens or the Queue from the menu bar never reloads the whole app out from under the
 * page the owner is on. A path that is not exactly a console page is refused, and
 * the shell loads the window whole as it always did; in a browser, the overlay or under an older shell this does
 * nothing.
 */
export function useShellNavigation(): void {
  const router = useRouter();
  useEffect(() => {
    const bridge = desktopBridge();
    if (bridge?.role !== "main" || bridge.onNavigate === undefined) {
      return undefined;
    }
    return bridge.onNavigate((value) => {
      const path = shellNavigationPathOf({ value });
      if (path === undefined) {
        return false;
      }
      router.push(path);
      return true;
    });
  }, [router]);
}
