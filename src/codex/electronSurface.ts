/**
 * An Electron a Codex plan or review pass starts from its shell runs as plain Node, never as an app.
 *
 * Codex's sandbox cannot reach the WindowServer, so any app bundle started inside it aborts in `NSApplication` init
 * (`_RegisterApplication` -> `abort`) and macOS puts an "Electron quit unexpectedly" alert in front of the owner. In
 * one incident a review pass npm-installed `electron@44.4.5` into `/tmp` and ran a probe twice to
 * test `will-frame-navigate` while the owner was on a call: two crash reports seconds apart
 * (`ls ~/Library/Logs/DiagnosticReports | grep 'Electron-'`), and WindowServer made the
 * alert frontmost, which blurred the desktop overlay and folded the owner's Messenger (`desktop/src/overlayWindow.ts`
 * `overlayCommandOnBlur`). Slopweaver.app itself never crashed.
 *
 * `ELECTRON_RUN_AS_NODE=1` makes the Electron binary start Node instead of an app, so it never registers with the
 * WindowServer and has nothing to abort on. It rides Codex's own child-shell policy, `shell_environment_policy.set`,
 * which Codex applies after `inherit` and every exclude, so an ambient value cannot undo it.
 *
 * MEASURED on the vendored codex-cli 0.157.1, under an empty `CODEX_HOME`:
 * `codex sandbox -c 'shell_environment_policy.set.ELECTRON_RUN_AS_NODE="1"' -- /usr/bin/printenv ELECTRON_RUN_AS_NODE`
 * prints `1`, and exits 1 without the `-c`. The same override around the incident's own probe exits 1 with
 * `TypeError: Cannot read properties of undefined (reading 'whenReady')` and writes no crash report: that TypeError
 * IS the safe outcome, never a regression to fix. Outside any sandbox an Electron 44.4.5 in this mode has no
 * `lsappinfo info` row for its own pid, where Slopweaver.app's pid has one. `codex app-server --strict-config` with
 * the override and stdin closed exits 0, and names a bogus sibling key under the same table, so the table is read.
 *
 * **Proved per thread, not assumed.** Codex applies a non-empty `shell_environment_policy.include_only` AFTER `set`,
 * so a home declaring one without this variable would drop it silently. No routed
 * home declares one today, and a future Codex could reorder the two, so before a pass thread starts
 * `./electronProbe.ts` runs `/usr/bin/printenv ELECTRON_RUN_AS_NODE` under `codex sandbox` with the same binary,
 * home, working directory and overrides, and `./electronGuard.ts` refuses the thread unless it printed `1`. A home
 * whose `config.toml` holds `[shell_environment_policy]` `include_only = ["PATH"]` makes that probe exit 1, measured.
 *
 * **What this does not cover.** A browser, `open`, or any app bundle that is not Electron ignores the variable, as
 * does a command that scrubs its own environment. Plan and review prompts carry the instruction for those
 * (`./prompt.ts`). The console voice does not carry it: its launch disables `shell_tool` and `unified_exec`, so it
 * has no shell to start one from (`../talk/planSession.ts`). Visible Codex seats (`../cmux/seatRoute.ts`) do not carry this: the owner watches them, and one may
 * legitimately run the desktop app. The MCP and plugin route to a launched browser is `./browserSurface.ts`.
 */

/**
 * The `-c` overrides that make every Electron a Codex shell starts run as Node, one `key=value` per entry.
 *
 * @returns the overrides in a stable order
 */
export function codexElectronRunAsNodeOverrides(): readonly string[] {
  return ['shell_environment_policy.set.ELECTRON_RUN_AS_NODE="1"'];
}
