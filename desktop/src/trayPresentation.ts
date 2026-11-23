/**
 * How the menu bar icon names itself: the text beside it, its tooltip, the identity line at the top of its menu and
 * its Quit item. Pure; `main.ts` draws it.
 *
 * The owner's app keeps today's names. A test instance launched to draw its own icon (`e2eMode.ts`, `--menu-bar`) is
 * named `Slopweaver Test` everywhere it shows, the text beside the icon first: it sits beside the owner's own icon in
 * the same menu bar, and nothing about the glyph says which is which. The bundle, its id and its saved-state directory keep their
 * names — signing and macOS's permission records key on them.
 */

/** The name a test instance's icon carries, beside it and in its menu. */
export const TEST_TRAY_NAME = "Slopweaver Test";

/** The menu bar icon's names, as drawn. */
export interface TrayPresentation {
  /** The text beside the icon. */
  readonly title: string;
  /** The tooltip. */
  readonly tooltip: string;
  /** The disabled first line of the menu, when there is one. */
  readonly identityLine: string | undefined;
  /** The Quit item's label. */
  readonly quitLabel: string;
}

/**
 * Name the menu bar icon.
 *
 * @param buildIdentityLine a dev build's line naming its checkout (`buildIdentity.ts`), `undefined` for the installed app
 * @param buildLabel the build's name, as its Quit item says it
 * @param statusTooltip the tooltip the shell's state gives (`menuView`)
 * @param testInstance whether this is a test instance's own icon
 * @param triageTitle the triage countdown, empty while triage is off
 * @returns the names to draw
 */
export function trayPresentation({
  buildIdentityLine,
  buildLabel,
  statusTooltip,
  testInstance,
  triageTitle,
}: {
  buildIdentityLine: string | undefined;
  buildLabel: string;
  statusTooltip: string;
  testInstance: boolean;
  triageTitle: string;
}): TrayPresentation {
  if (testInstance) {
    return {
      identityLine: `Test instance · ${buildLabel}`,
      quitLabel: `Quit ${TEST_TRAY_NAME}`,
      title: TEST_TRAY_NAME,
      tooltip: `${TEST_TRAY_NAME} · ${statusTooltip}`,
    };
  }
  return {
    identityLine: buildIdentityLine,
    quitLabel: `Quit ${buildLabel}`,
    title: triageTitle,
    tooltip: buildIdentityLine === undefined ? statusTooltip : `${buildLabel} · ${statusTooltip}`,
  };
}
