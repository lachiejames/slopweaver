/**
 * Which of the desktop shell's methods puts one card in front of the owner, for `open_card` in the voice's window
 * (`../components/voice/DesktopVoiceOverlay.tsx`).
 *
 * The shell opens Alignment cards too, by `presentConsoleCard`. An older shell
 * still offers `presentQueueCard`, which loads a `/queue?open=` address only — so it is handed a Queue card and never
 * an Alignment one, which it refuses in words that say why rather than sending to a page that cannot draw it.
 */
import type { DesktopBridge } from "./desktopShell";

/** What the shell did with the card: put it in front of the owner, or refused, with why in plain words. */
export type ShellCardPresentation = { readonly kind: "opened" } | { readonly kind: "refused"; readonly why: string };

/**
 * Put one card's console address in front of the owner through whichever method this shell has.
 *
 * @param bridge the shell's two card methods, either absent on an older shell
 * @param path the card's console address (`./openCard.ts` `cardPagePath`)
 * @returns opened once the shell took it, else refused with the reason
 */
export async function presentCardOnShell({
  bridge,
  path,
}: {
  bridge: Pick<DesktopBridge, "presentConsoleCard" | "presentQueueCard">;
  path: string;
}): Promise<ShellCardPresentation> {
  if (bridge.presentConsoleCard !== undefined) {
    await bridge.presentConsoleCard({ path });
    return { kind: "opened" };
  }
  if (bridge.presentQueueCard === undefined) {
    return { kind: "refused", why: "this desktop app predates opening cards; restart it after a pull" };
  }
  if (!path.startsWith("/queue?")) {
    return { kind: "refused", why: "this desktop app predates opening Alignment cards; restart it after a pull" };
  }
  await bridge.presentQueueCard({ path });
  return { kind: "opened" };
}
