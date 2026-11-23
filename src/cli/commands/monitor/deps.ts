/**
 * The seams every `monitor` verb runs through, declared once so three modules cannot drift on what "now"
 * means or where the config lives.
 *
 * **No command launcher of its own, deliberately.** The floating note `monitor check --fire` raises for a
 * floating monitor, and the push lane `--push` runs, both go through {@link MonitorDeps.hand} — whose
 * production value is `productionHandDeps()` — so the ONE `execFileSync` behind both macOS surfaces stays in
 * `../hand/deps.ts` where `src/admit/coverage.ts` sanctions it. A second copy would be a second seam carrying
 * the same bound, and the drift between them would be invisible.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { openInWorkChrome } from "../../../browser/openInWorkChrome.js";
import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { type ClaudePlanProbesPort, claudePlanProbesPort } from "../../../claude/planProbes.js";
import { type CodexFleetCapPort, codexFleetCapPort } from "../../../codex/fleetCapPort.js";
import { type CodexSignInPort, codexSignInPort } from "../../../codex/signInPort.js";
import { WITNESS_CAP } from "../../../hand/step.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { type Result } from "../../../lib/result.js";
import { type FseventsdSeams, productionFseventsdSeams } from "../../../monitor/fseventsdBloatedSource.js";
import { type OrgHealthPort, orgHealthPort } from "../../../orgHealth/port.js";
import { type PagePublished, pagePublishedInStore } from "../../../pages/published.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import { claudeProjectsDir } from "../../../transcripts/source.js";
import { flag, type HandDeps, productionHandDeps } from "../hand/deps.js";

/** Everything a `monitor` verb touches outside itself. */
export interface MonitorDeps {
  /** Where Claude Code keeps transcripts — a seam so a test never judges the machine's own sessions. */
  readonly claudeProjectsDir: string;
  /**
   * The hand register's own seams — its clock, its platform and its macOS launcher — for the note a floating
   * monitor raises and for the push lane. A test passes a plain function recording each launch.
   */
  readonly hand: HandDeps;
  readonly now: () => string;
  /**
   * Opens a newly posted card's page in the owner's work Chrome before its note is raised (`../../../browser/openInWorkChrome.ts`).
   * A test passes a plain function recording each page, so no test launches Chrome.
   */
  readonly openPage: (options: { home: string; url: string }) => Promise<Result<string, string>>;
  /** `process.platform`, so a test drives the not-macOS arm without pretending to be another machine. */
  readonly platform: string;
  /** The `ps` and `top` reads `fseventsd-bloated` measures by, and its onset capture — a seam so a test never judges this machine's fseventsd. */
  readonly processes: FseventsdSeams;
  /** Where a pass reads the plan register — a seam so a test never reads, or imports into, a real store. */
  readonly registerPort: PlanRegisterPort;
  /** Where a pass reads the Codex fleet's filed record — a seam so a test never reads a real store. */
  readonly fleetCapPort: CodexFleetCapPort;
  /** Where a pass reads the Codex sign-in observations — a seam for the same reason. */
  readonly signInPort: CodexSignInPort;
  /** Where a pass reads each Claude plan's last probe — a seam for the same reason. */
  readonly claudeProbesPort: ClaudePlanProbesPort;
  /** Where `org-health` reads the incident snapshot — a seam so a test never reads, or imports into, a real store. */
  readonly orgHealthPort: OrgHealthPort;
  /** Where `meeting-prep-due` asks whether a page is published — a seam so a test never reads a real store. */
  readonly pagePublished: PagePublished;
  /** cmux's own config file, where the hook path is discovered from. */
  readonly cmuxConfigPath: string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real seams: the machine clock, this platform, cmux's config, the hand register's own, and the two
 * output channels.
 *
 * @returns the production dependencies for every `monitor` verb
 */
export function productionMonitorDeps(): MonitorDeps {
  const profiles = recordedProfilePort();
  return {
    claudeProbesPort: claudePlanProbesPort(),
    claudeProjectsDir: claudeProjectsDir(),
    cmuxConfigPath: join(homedir(), ".config", "cmux", "cmux.json"),
    fleetCapPort: codexFleetCapPort(),
    hand: productionHandDeps(),
    now: () => new Date().toISOString(),
    openPage: ({ home, url }) => openInWorkChrome({ home, profiles, url }),
    orgHealthPort: orgHealthPort(),
    pagePublished: pagePublishedInStore,
    platform: process.platform,
    processes: productionFseventsdSeams({ home: slopweaverHome() }),
    registerPort: planRegisterPort(),
    signInPort: codexSignInPort(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * The seams for a pass another verb runs IN-PROCESS: the same as `deps`, except the pass's report goes to the
 * diagnostic channel, because the host verb owns stdout. MEASURED: `session close-done --json` parked a
 * steered seat, its in-process `steer-at-risk` pass printed `steer-at-risk  FIRING over 1` on stdout ahead of the
 * JSON document, and `supervisor tick open` read the whole reading as text. A top-level `monitor check` keeps
 * stdout; only the three fire functions that embed a pass wrap their seams with this.
 *
 * @param deps the seams the host verb was handed
 * @returns the same seams with the report on stderr
 */
export function hostedPassDeps({ deps }: { deps: MonitorDeps }): MonitorDeps {
  return { ...deps, writeOut: deps.writeDiagnostic };
}

/**
 * The session running this pass, defaulting to a name that says it was not supplied.
 *
 * A blank value takes the default too: the hand register refuses an empty `postedBy`, so `--by-session ''`
 * would refuse every card this pass posts, recipe-stopped's included, on every pass. A
 * value past the register's cap is cut to it for the same reason: it is provenance, never proof, and a shortened
 * name costs less than a card that never posts.
 *
 * @param values the parsed flag map
 * @returns what goes in every row's `postedBy`
 */
export function bySession({ values }: { values: Readonly<Record<string, unknown>> }): string {
  const named = flag({ name: "by-session", values });
  const trimmed = named?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return "unnamed-session";
  }
  return trimmed.slice(0, WITNESS_CAP);
}
