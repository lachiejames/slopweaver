/**
 * `cmux spawn`'s one launch, through the session harness seam (`../../../sessionHarness/launch.ts`): the recording
 * launcher writes the session's ledger row from what the launch DID, and the outcome comes back in cmux's own shapes
 * so `./run.ts` renders, records and reports exactly what it did before the seam.
 *
 * Which act it is — `open` or `resume` — is the run journal's, by the same phase that picks the pickup line's
 * `start` versus `resume` (`../../../cmux/pickupCommand.ts`'s `launchOperationForRun`). The preflight's read picks
 * which act to call; the pickup line is re-read at delivery and carries its own act, which the recorder writes, so a
 * journal that moved while the spawn waited for capacity or booted cannot record one act beside the other's line.
 */
import { resolve } from "node:path";

import { launchOperationForRun } from "../../../cmux/pickupCommand.js";
import type { SpawnPlan } from "../../../cmux/plan.js";
import type { SpawnDeps, SpawnOutcome } from "../../../cmux/spawn.js";
import { codexBrowserDoorFor } from "../../../cmux/spawnDeps.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { slopweaverHome } from "../../../homeDir.js";
import { err, ok } from "../../../lib/result.js";
import { appHarnessAmbientCredential } from "../../../sessionHarness/appCredentialContext.js";
import { appSessionLauncherOver } from "../../../sessionHarness/appLaunch.js";
import { APP_SOCKET_ROOT, socketAppTransport } from "../../../sessionHarness/appSocketTransport.js";
import {
  cmuxSessionLauncherOver,
  launchSpecFromPlan,
  spawnedFromOpened,
  spawnFailureFromLaunch,
} from "../../../sessionHarness/cmuxLaunch.js";
import type { HarnessName } from "../../../sessionHarness/harnessChoice.js";
import { recordingSessionLauncher } from "../../../sessionHarness/recordingHarness.js";
import { sessionLedgerDeps } from "../../../sessionHarness/sessionLedger.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { openAppSessionForSlug } from "../../../sessions/sessionRow.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { currentSpawnPickupCommand } from "./spawnPreflight.js";

/** The state home a spawn records under, absolute: the one it named, else the environment's own. */
function absoluteLedgerHome({ home }: { home: string | undefined }): string {
  if (home === undefined) {
    return resolve(slopweaverHome());
  }
  return resolve(home);
}

/**
 * The app session a resumed run continues, from the ledger: none when the run holds no open app row, so the resume
 * opens a fresh card exactly as before. An unreadable line is skipped like every other ledger reader skips one.
 */
function continuedAppSession({ home, slug }: { home: string | undefined; slug: string }): string | undefined {
  const text = readSessionLogText(home === undefined ? {} : { home });
  return openAppSessionForSlug({ items: foldSessions({ events: parseSessionLog({ text }).events }), slug });
}

/**
 * Open (or resume) the doc's session through the recording cmux launcher.
 *
 * @param deps the spawn effects the verb assembled and closes
 * @param plan the resolved spawn plan
 * @param doc the doc the session is for, whose path the pickup line names
 * @param harness where the session opens: a cmux workspace, or a card in the desktop app
 * @param home the state home the ledger and run journal live under
 * @param runEvents the run journal the preflight read, which picks the act to call before the delivery re-read
 * @returns the spawn outcome in cmux's shapes
 */
export async function launchSpawnThroughSeam({
  deps,
  plan,
  doc,
  harness,
  home,
  runEvents,
}: {
  deps: SpawnDeps;
  plan: SpawnPlan;
  doc: Pick<HandoverDoc, "path" | "slug">;
  harness: HarnessName;
  home: string | undefined;
  runEvents: readonly RunEvent[];
}): Promise<SpawnOutcome> {
  const operation = launchOperationForRun({ runEvents });
  const launcher = recordingSessionLauncher({
    implementation: harness,
    launcher:
      harness === "app"
        ? appSessionLauncherOver({
            continuing: operation === "resume" ? continuedAppSession({ home, slug: plan.slug }) : undefined,
            deps: {
              codexBrowserDoorAt: ({ codexPath }) =>
                codexBrowserDoorFor({ codexPath, launch: "cmux spawn --harness app" }),
              ensureWorktree: deps.ensureWorktree,
              // Judged against what the app's Claude worker presents, never this shell's own environment.
              gateClaudeCredential: async ({ plan: seat }) =>
                deps.gateCredentialStore({
                  ambient: appHarnessAmbientCredential({ inherited: process.env }),
                  plan: seat,
                }),
              resolvePluginDir: deps.resolvePluginDir,
            },
            // Always named, and absolute: the card's close runs in the app's own environment and checkout, so an
            // omitted home there would be the APP's default, not the one this spawn's row was written under.
            ledgerHome: absoluteLedgerHome({ home }),
            transport: socketAppTransport({ root: APP_SOCKET_ROOT }),
          })
        : cmuxSessionLauncherOver({ deps }),
    ledger: sessionLedgerDeps({ home }),
  });
  const launched = await launcher[operation]({
    resolveInitialMessage: () => currentSpawnPickupCommand({ docPath: doc.path, home, slug: doc.slug }),
    spec: launchSpecFromPlan({ ledgerKey: plan.slug, plan, slug: plan.slug }),
  });
  if (launched.isErr()) {
    return err(spawnFailureFromLaunch({ failure: launched.error }));
  }
  return ok(spawnedFromOpened({ opened: launched.value }));
}
