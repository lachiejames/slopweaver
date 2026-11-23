/**
 * The effectful shell: read each monitor's source, project it, and hand the projection to its evaluator.
 *
 * Every read here is LOCAL. The monitors are verbs over local ledgers, which is also what makes the lane
 * usable: a pass that opened a network connection would take minutes, so it would run on a cadence measured in
 * hours, and a card that arrives hours after the condition is one the owner has already found themselves.
 *
 * ## `prs-backed-up` takes its document rather than fetching one
 *
 * `github landing` is a multi-minute GitHub read and it is a DOORED provider — rule 3 says the verb owns that
 * traffic, not this module. So the monitor reads a document `github landing --json` already wrote, handed in
 * with `--landing <path>`, and reports `unmeasurable` NAMING THAT COMMAND when there is none. The alternative
 * — fetching inside the monitor — would put a second GitHub reader in the tree and make every pass slow
 * enough that nobody would schedule one.
 *
 * ## A failed read is `unmeasurable`, never `clear`
 *
 * Each leg catches its own failure and answers `unmeasurable` with what stopped it. One unreadable source
 * must not take the pass down: every other monitor is still answerable, and rule 6 says a surface that
 * silently reports nothing is the expensive failure.
 */
import { readFileSync } from "node:fs";

import type { Result } from "#lib/result.js";

import { machineNeverConfigured } from "../admit/profileFirstBoot.js";
import type { ClaudePlanProbesPort } from "../claude/planProbes.js";
import { type CodexFleetCapPort, readCodexFleetCapRecord } from "../codex/fleetCapPort.js";
import type { CodexSignInPort } from "../codex/signInPort.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { safeJsonParse } from "../lib/safeJson.js";
import { readConsoleSyncAppendFailures, readConsoleSyncFailures } from "../live/consoleSyncFailureStore.js";
import type { ListenerStateError } from "../live/listen/supervise/errors.js";
import type { ListenerHeartbeat } from "../live/listen/supervise/heartbeat.js";
import { readListenerHeartbeat } from "../live/listen/supervise/store.js";
import type { OrgHealthPort } from "../orgHealth/port.js";
import type { PagePublished } from "../pages/published.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { listSecretFileNames } from "../secrets/listing.js";
import { CREDENTIALS } from "../secrets/registry.js";
import { readRehearsalRecord } from "../store/backup/rehearsalRecord.js";

import { readAutomationHeldOnYou } from "./automationHeldOnYouSource.js";
import { readChairOffFable } from "./chairOffFableSource.js";
import { readClaudePlanUnusable } from "./claudePlanUnusableSource.js";
import { evaluateCodexFleetCapped } from "./codexFleetCapped.js";
import { readCodexResetFailed } from "./codexResetFailedSource.js";
import { readCodexPlanSignedOut } from "./codexSource.js";
import { evaluateConsoleSyncFailed } from "./consoleSyncFailed.js";
import { evaluateBotOffTheAir, evaluatePrsBackedUp, type LandingSubjectInput } from "./evaluate.js";
import { readFleetUnhealthy } from "./fleetHealthSource.js";
import { readFleetRunsDry } from "./fleetRunsDrySource.js";
import { type FseventsdSeams, readFseventsdBloated } from "./fseventsdBloatedSource.js";
import { HOST_WEEK_RUNS_OUT } from "./hostWeekRunsOutDefinition.js";
import { readHostWeekRunsOut } from "./hostWeekRunsOutSource.js";
import { readMeetingPrepDue } from "./meetingPrepDueSource.js";
import { readOrgHealth } from "./orgHealthSource.js";
import { readProfileUnloaded } from "./profileUnloadedSource.js";
import { readPublicationLeak } from "./publicationLeak.js";
import { MONITOR_STEP_PREFIX } from "./registry.js";
import { readResyncSignedOut } from "./resyncSignedOutSource.js";
import { evaluateSecretAbsent } from "./secretAbsent.js";
import { readSteerAtRisk } from "./steerAtRiskSource.js";
import { stoppedRowReads } from "./stoppedSource.js";
import { evaluateStoreRehearsal } from "./storeRehearsal.js";
import { readTurnSignedOut } from "./turnSignedOutSource.js";
import type { MonitorId, MonitorReading } from "./types.js";

/** What `monitor check` was given to read from, beyond the state home itself. */
export interface MonitorInputs {
  readonly home: string;
  /** The instant to judge at, epoch milliseconds — `--now` replays a past pass exactly. */
  readonly nowMs: number;
  /**
   * The same instant as ISO-8601, as the caller was given it — the recipe calculus judges in ISO, and
   * rebuilding one from {@link MonitorInputs.nowMs} would be a second spelling of the clock to keep in step.
   */
  readonly nowIso: string;
  /** A `github landing --json` document, when the caller piped one in. */
  readonly landingPath: string | undefined;
  /**
   * Where Claude Code keeps transcripts, `~/.claude/projects` in production — `profile-unloaded` reads each running
   * session's boot records there. An input rather than read here, so a pass over a sandbox home never judges the
   * machine's own sessions.
   */
  readonly claudeProjectsDir: string;
  /**
   * The `ps` and `top` reads `fseventsd-bloated` finds fseventsd's footprint with, and its onset capture's reads. An input for the same reason again:
   * a pass in a test never judges the machine it runs on.
   */
  readonly processes: FseventsdSeams;
  /**
   * Where `codex-plan-signed-out`, `claude-plan-unusable`, `fleet-runs-dry` and `host-week-runs-out` read the plan register — `planRegisterPort()` from the verb,
   * a seam in a test. Required, so a pass in a test never reads, or imports into, a store the environment selected.
   */
  readonly registerPort: PlanRegisterPort;
  /**
   * Where `codex-fleet-capped` reads the record the last Codex fleet read filed —
   * `codexFleetCapPort()` from the verb, a seam in a test. Required for the same reason as
   * {@link MonitorInputs.registerPort}.
   */
  readonly fleetCapPort: CodexFleetCapPort;
  /**
   * Where `codex-plan-signed-out` reads each Codex store's sign-in observation — `codexSignInPort()` from the verb,
   * a seam in a test. Required for the same reason.
   */
  readonly signInPort: CodexSignInPort;
  /**
   * Where `claude-plan-unusable` reads each Claude plan's last probe — `claudePlanProbesPort()` from the verb, a seam
   * in a test. Required for the same reason.
   */
  readonly claudeProbesPort: ClaudePlanProbesPort;
  /**
   * Where `org-health` reads the incident snapshot — `orgHealthPort()` from the verb, a seam in a test. Required for
   * the same reason as {@link MonitorInputs.registerPort}.
   */
  readonly orgHealthPort: OrgHealthPort;
  /**
   * Where `meeting-prep-due` asks whether the due meeting's page is published — `pagePublishedInStore` from the verb,
   * a seam in a test. Required for the same reason as {@link MonitorInputs.registerPort}.
   */
  readonly pagePublished: PagePublished;
  /**
   * The one monitor to run, or absent for all of them. A standing recipe row runs one monitor on its own
   * cadence; every other monitor's cards are untouched, because the pass settles per reading.
   */
  readonly only?: MonitorId | undefined;
}

/** The one command a reader is told to run when the landing document is not there. */
const LANDING_RECIPE = "slopweaver github landing --json > <path> && slopweaver monitor check --landing <path>";

/**
 * Project a `github landing --json` document onto the fields `prs-backed-up` turns on.
 *
 * Every row is checked rather than trusted: this document is written by another verb and read here, so a
 * field it stops emitting must surface as `unmeasurable` rather than as a quiet zero.
 *
 * @param document the already-parsed document
 * @returns the projected rows, or the sentence saying why the shape was not understood
 */
export function projectLandingRows({
  document,
}: {
  document: unknown;
}): { readonly rows: readonly LandingSubjectInput[] } | { readonly because: string } {
  if (!isRecord(document)) {
    return { because: "the landing document is not a JSON object" };
  }
  const rows = document["rows"];
  if (!Array.isArray(rows)) {
    return { because: "the landing document has no `rows` array" };
  }
  const projected: LandingSubjectInput[] = [];
  for (const row of rows) {
    const one = projectLandingRow({ row });
    if ("because" in one) {
      return { because: one.because };
    }
    projected.push(one.row);
  }
  return { rows: projected };
}

/**
 * Project ONE landing row, or name the field whose absence stops the whole document being understood.
 *
 * One row's worth of checking sits here rather than in {@link projectLandingRows}'s loop so that the
 * document-level shape check and the row-level field checks are two readable things instead of one nest.
 *
 * @param row one element of the document's `rows` array, entirely unchecked
 * @returns the projected subject input, or the sentence saying what was missing
 */
function projectLandingRow({
  row,
}: {
  row: unknown;
}): { readonly row: LandingSubjectInput } | { readonly because: string } {
  if (!isRecord(row)) {
    return { because: "a landing row is not a JSON object" };
  }
  const repoSlug = row["repoSlug"];
  const number = row["number"];
  const title = row["title"];
  if (typeof repoSlug !== "string" || typeof number !== "number" || typeof title !== "string") {
    return { because: "a landing row is missing repoSlug, number or title" };
  }
  const action = row["action"];
  if (typeof action !== "string") {
    return { because: `landing row ${repoSlug}#${String(number)} has no \`action\`` };
  }
  const queue = row["queue"];
  if (!isRecord(queue) || typeof queue["kind"] !== "string") {
    return { because: `landing row ${repoSlug}#${String(number)} has no \`queue.kind\`` };
  }
  return {
    row: {
      action,
      blockedOn: blockedOnOf({ row }),
      ciRed: ciRedOn({ row }),
      number,
      queueKind: queue["kind"],
      repoSlug,
      title,
    },
  };
}

/**
 * Whether one row's CI is red at all — its `ci-green` test failed, or its `ciFailure` reads `red`.
 *
 * Both, because an advisory-only red PASSES `ci-green` (`../review/landingTests.ts`) so the
 * read can press it, while this monitor still keeps such a row off the owner's screen; reading the test alone would
 * have widened what pages the owner as a side effect of a change about pressing. A missing or malformed `tests` or
 * `ciFailure` answers false — a document from before either field carries none that matter here, and a
 * refusal would blank the whole monitor over an optional fact.
 *
 * @param row the already-checked row record
 * @returns true when a `ci-green` test failed or the row's `ciFailure.kind` is `red`
 */
function ciRedOn({ row }: { row: Readonly<Record<string, unknown>> }): boolean {
  const ciFailure = row["ciFailure"];
  if (isRecord(ciFailure) && ciFailure["kind"] === "red") {
    return true;
  }
  const tests = row["tests"];
  if (!Array.isArray(tests)) {
    return false;
  }
  return tests.some((test) => isRecord(test) && test["id"] === "ci-green" && test["verdict"] === "fail");
}

/**
 * The code owners one row names.
 *
 * A missing or non-array `blockedOn` is EMPTY rather than a refusal, because `github landing` omits the
 * field on a row that is not blocked at all — which is the common case and says nothing about the shape.
 *
 * @param row the already-checked row record
 * @returns every string in its `blockedOn`, in order
 */
function blockedOnOf({ row }: { row: Readonly<Record<string, unknown>> }): readonly string[] {
  const blockedOn = row["blockedOn"];
  if (!Array.isArray(blockedOn)) {
    return [];
  }
  return blockedOn.filter((owner): owner is string => typeof owner === "string");
}

/** Read and evaluate `prs-backed-up` off the handed-in landing document. */
function readPrsBackedUp({ landingPath }: { landingPath: string | undefined }): MonitorReading {
  if (landingPath === undefined) {
    return {
      because: `no landing document was handed in — run \`${LANDING_RECIPE}\``,
      monitorId: "prs-backed-up",
      state: "unmeasurable",
    };
  }
  let text: string;
  try {
    text = readFileSync(landingPath, "utf8");
  } catch (cause) {
    return {
      because: `the landing document at ${landingPath} could not be read: ${errorMessage({ error: cause })}`,
      monitorId: "prs-backed-up",
      state: "unmeasurable",
    };
  }
  let document: unknown;
  try {
    document = safeJsonParse({ label: "a github landing document", text });
  } catch (cause) {
    return {
      because: `the landing document at ${landingPath} is not JSON: ${errorMessage({ error: cause })}`,
      monitorId: "prs-backed-up",
      state: "unmeasurable",
    };
  }
  const projected = projectLandingRows({ document });
  if ("because" in projected) {
    return { because: projected.because, monitorId: "prs-backed-up", state: "unmeasurable" };
  }
  if (projected.rows.length === 0) {
    // An EMPTY document is not evidence that anything cleared, and reading it as `clear` is the one way this
    // lane can take a real card off the owner's screen. The document is handed in, and `github landing` narrows on
    // --repo, --author, --limit and --include-drafts without changing its shape, so a pass handed a tighter
    // capture than the pass that posted would settle every open `mon-prs-` step while the pull requests are
    // still blocked. The failure direction is chosen deliberately: a card that lingers one pass too long is
    // recoverable with `hand done`, and one that vanishes is not. See `unit/monitor/pass.test.ts`.
    return {
      because: `the landing document at ${landingPath} carries no rows, which is not evidence that anything cleared — re-run \`${LANDING_RECIPE}\``,
      monitorId: "prs-backed-up",
      state: "unmeasurable",
    };
  }
  return evaluatePrsBackedUp({ rows: projected.rows });
}

/**
 * Read and evaluate `bot-off-the-air` off the listener heartbeat, keeping the raw read beside the reading so
 * `fleet-unhealthy` judges never-armed off the SAME observation (`./fleetHealth.ts` § listenerNeverArmed): a second
 * read could find absent what this one found unreadable, and excuse a real blind spot.
 */
function readBotOffTheAir({ home, nowMs }: { home: string; nowMs: number }): {
  readonly heartbeat: Result<ListenerHeartbeat | undefined, ListenerStateError>;
  readonly reading: MonitorReading;
} {
  const heartbeat = readListenerHeartbeat({ home });
  if (heartbeat.isErr()) {
    return {
      heartbeat,
      reading: {
        because: `the listener heartbeat could not be read: ${heartbeat.error.message}`,
        monitorId: "bot-off-the-air",
        state: "unmeasurable",
      },
    };
  }
  return { heartbeat, reading: evaluateBotOffTheAir({ heartbeat: heartbeat.value, nowMs }) };
}

/**
 * Read and evaluate `secret-absent` off the secrets store's file NAMES — never a value, never a file opened.
 *
 * A store that could not be listed is `unmeasurable`: read as empty, it would say nothing is stored, every group
 * would have no stored member, and the monitor would answer `clear` over a store it never saw.
 */
function readSecretAbsent({ home }: { home: string }): MonitorReading {
  const names = listSecretFileNames({ home });
  if (names.isErr()) {
    return {
      because: `the secrets store could not be listed: ${names.error.message}`,
      monitorId: "secret-absent",
      state: "unmeasurable",
    };
  }
  return evaluateSecretAbsent({ specs: CREDENTIALS, storedNames: new Set(names.value) });
}

/**
 * Memoise one read for a pass: the first caller reads, every later one is handed the same value.
 *
 * @param read the source read, run at most once
 * @returns a thunk answering that one value
 */
function readOnce<T>({ read }: { read: () => T }): () => T {
  let held: { readonly value: T } | undefined;
  return () => {
    if (held !== undefined) {
      return held.value;
    }
    const value = read();
    held = { value };
    return value;
  };
}

/** `console-sync-failed`: the console's failed-refresh ledger and its fallback under this home, judged at this instant. */
function readConsoleSyncFailed({ home, nowIso }: { home: string; nowIso: string }): MonitorReading {
  return evaluateConsoleSyncFailed({
    appendFailures: readConsoleSyncAppendFailures({ home }),
    ledger: readConsoleSyncFailures({ home }),
    nowIso,
  });
}

/** `profile-unloaded`, judged against whether this machine was ever configured: a first boot has no profile to lose. */
function readProfileUnloadedHere({
  home,
  nowMs,
  projectsDir,
}: {
  home: string;
  nowMs: number;
  projectsDir: string;
}): MonitorReading {
  return readProfileUnloaded({ home, neverConfigured: () => machineNeverConfigured({ home }), nowMs, projectsDir });
}

/** One monitor's read, a thunk, so a pass for one monitor reads only that monitor's source. */
interface MonitorRead {
  readonly id: MonitorId;
  readonly read: () => MonitorReading | Promise<MonitorReading>;
}

/**
 * The two plan-health reads, Codex's then Claude's, each over the plan register and its own record of what the last
 * probe found.
 */
function planHealthReads({ inputs }: { inputs: MonitorInputs }): readonly MonitorRead[] {
  const { claudeProbesPort, home, registerPort, signInPort } = inputs;
  return [
    {
      id: "codex-plan-signed-out",
      read: () => readCodexPlanSignedOut({ home, port: registerPort, signInPort }),
    },
    {
      id: "claude-plan-unusable",
      read: () => readClaudePlanUnusable({ home, port: registerPort, probesPort: claudeProbesPort }),
    },
  ];
}

/**
 * Run every monitor once, in the registry's order — or only the one named.
 *
 * Each read is a thunk, so a pass for one monitor reads only that monitor's source.
 *
 * @param inputs the home, the instant, any document handed in, and the one monitor to run
 * @returns one reading per monitor run
 */
export async function readAllMonitors({ inputs }: { inputs: MonitorInputs }): Promise<readonly MonitorReading[]> {
  const { claudeProjectsDir, home, nowMs, nowIso, landingPath, only, processes, registerPort } = inputs;
  const { fleetCapPort, orgHealthPort, pagePublished } = inputs;
  // The listener is read once a pass, by whichever of `fleet-unhealthy` and `bot-off-the-air` asks first.
  const listener = readOnce({ read: () => readBotOffTheAir({ home, nowMs }) });
  // Likewise the sign-in walls, by `resync-signed-out` and by `fleet-unhealthy`'s line for each row it stopped.
  const signIn = readOnce({ read: () => readResyncSignedOut({ home }) });
  const reads: readonly MonitorRead[] = [
    { id: "automation-held-on-you", read: () => readAutomationHeldOnYou({ home }) },
    ...stoppedRowReads({ home, nowIso }),
    ...planHealthReads({ inputs }),
    { id: "secret-absent", read: () => readSecretAbsent({ home }) },
    { id: "turn-signed-out", read: () => readTurnSignedOut({ home }) },
    { id: "resync-signed-out", read: signIn },
    { id: "publication-leak", read: () => readPublicationLeak({ home }) },
    {
      id: "codex-fleet-capped",
      read: async () =>
        evaluateCodexFleetCapped({ nowIso, read: await readCodexFleetCapRecord({ home, port: fleetCapPort }) }),
    },
    { id: "codex-reset-failed", read: () => readCodexResetFailed({ home, nowIso }) },
    { id: "prs-backed-up", read: () => readPrsBackedUp({ landingPath }) },
    { id: "bot-off-the-air", read: () => listener().reading },
    { id: "chair-off-fable", read: () => readChairOffFable({ home }) },
    { id: "fseventsd-bloated", read: () => readFseventsdBloated({ home, nowMs, processes }) },
    { id: "store-rehearsal-failed", read: () => evaluateStoreRehearsal({ record: readRehearsalRecord({ home }) }) },
    {
      id: "fleet-runs-dry",
      read: () => readFleetRunsDry({ home, nowIso, port: registerPort }),
    },
    {
      id: "host-week-runs-out",
      read: () =>
        readHostWeekRunsOut({
          home,
          nowIso,
          port: registerPort,
          stepPrefix: `${MONITOR_STEP_PREFIX}${HOST_WEEK_RUNS_OUT.prefix}-`,
        }),
    },
    { id: "fleet-unhealthy", read: () => readFleetUnhealthy({ home, listener: listener(), nowIso, signIn: signIn() }) },
    { id: "console-sync-failed", read: () => readConsoleSyncFailed({ home, nowIso }) },
    { id: "org-health", read: () => readOrgHealth({ home, nowMs, port: orgHealthPort }) },
    { id: "profile-unloaded", read: () => readProfileUnloadedHere({ home, nowMs, projectsDir: claudeProjectsDir }) },
    { id: "steer-at-risk", read: () => readSteerAtRisk({ home, nowIso }) },
    // After fleet health, org health, an unloaded profile and a steer at risk: each draws in front of the notes
    // already up, and a meeting starting within the hour is the note the owner needs on top, a level above them all.
    { id: "meeting-prep-due", read: () => readMeetingPrepDue({ home, nowMs, pagePublished }) },
  ];
  // One read at a time, in the registry's order, so `bot` and `signIn` are each read by whichever asks first.
  const readings: MonitorReading[] = [];
  for (const entry of reads.filter((candidate) => only === undefined || candidate.id === only)) {
    readings.push(await entry.read());
  }
  return readings;
}
