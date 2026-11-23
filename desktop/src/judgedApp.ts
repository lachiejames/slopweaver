/**
 * Whether a launch's browser-door judgment was made against THIS run of the app. The spawning CLI pings the app for the
 * Codex binary its sessions run, reads the browser door through that binary, then asks for the launch naming the
 * instance that answered. Each request is its own connection to a per-user socket, so another run of the app (a
 * reinstall, a relaunch) can hold the socket by the launch, running a binary nobody judged. Pure, so the rule is
 * testable without Electron.
 *
 * The stated residue: a binary replaced in place under the SAME running app is not caught. That takes write access to
 * the installed bundle, which already runs whatever it likes, and a cmux seat's door has the same gap over PATH.
 */

/**
 * The refusal for a launch whose door was judged against another run of the app, or none.
 *
 * @param judged the instance the launch says its browser door was judged against
 * @param serving this run of the app's own instance id
 * @returns the line refusing the launch, or `undefined` when the judgment was made against this run
 */
export function judgedAppRefusal({ judged, serving }: { judged: string; serving: string }): string | undefined {
  if (judged === serving) {
    return undefined;
  }
  return (
    `the browser door was judged against app instance ${judged}, but this is ${serving}, ` +
    "which may run another Codex binary, so the launch is refused; spawn again"
  );
}
