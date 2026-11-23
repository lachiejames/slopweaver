import { configDefaults, defineConfig } from "vitest/config";
import { AMBIENT_HOME_SETUP, baseVitestConfig, TEMP_ROOT_SETUP, TYPESCRIPT_LIFECYCLE_SETUP } from "./base.js";

/**
 * Every integration suite that replays a recorded provider cassette, QUARANTINED by name because no recorded
 * provider cassette is committed. Measured from the recordings' own `_recordingName`s (Polly names a recording
 * directory for its `describe`) against the files that declare those describes.
 */
const QUARANTINED_CASSETTE_SUITES: readonly string[] = [
  "src/__tests__/integration/calendar.test.ts",
  "src/__tests__/integration/calendarWrite.test.ts",
  "src/__tests__/integration/cloudflare.test.ts",
  "src/__tests__/integration/datadog.test.ts",
  "src/__tests__/integration/github.test.ts",
  "src/__tests__/integration/githubWrite.test.ts",
  "src/__tests__/integration/gmail.test.ts",
  "src/__tests__/integration/linear.test.ts",
  "src/__tests__/integration/linearAttach.test.ts",
  "src/__tests__/integration/linearCommentWrite.test.ts",
  "src/__tests__/integration/linearDocumentWrite.test.ts",
  "src/__tests__/integration/linearFollowupCassette.test.ts",
  "src/__tests__/integration/linearInitiativeWrite.test.ts",
  "src/__tests__/integration/linearProjectUpdateWrite.test.ts",
  "src/__tests__/integration/linearProjectWrite.test.ts",
  "src/__tests__/integration/linearWrite.test.ts",
  "src/__tests__/integration/notion.test.ts",
  "src/__tests__/integration/slack.test.ts",
  "src/__tests__/integration/slackAssistantStreamWrite.test.ts",
  "src/__tests__/integration/slackAssistantWrite.test.ts",
  "src/__tests__/integration/slackCanvasWrite.test.ts",
  "src/__tests__/integration/slackChannelJoin.test.ts",
  "src/__tests__/integration/slackConversationWrite.test.ts",
  "src/__tests__/integration/slackPaging.test.ts",
  "src/__tests__/integration/slackPoll.test.ts",
  "src/__tests__/integration/slackPriorAskTopLevel.test.ts",
  "src/__tests__/integration/slackReadThread.test.ts",
  "src/__tests__/integration/slackWrite.test.ts",
  "src/__tests__/integration/turnInlineCompletion.test.ts",
  "src/__tests__/integration/vanta.test.ts",
];

/**
 * The INTEGRATION lane — `src/__tests__/integration/**` only. Its suites drive real provider calls (REST and
 * GraphQL) through a Polly.js cassette: `@pollyjs/adapter-fetch` wraps this process's own global `fetch` in
 * place — no child process, no gateway — recording each call to a HAR (`POLLY_MODE=record`, hits the real
 * provider) or replaying it deterministically + offline (`POLLY_MODE=replay`, the default when unset; a value
 * that is not `record`, `replay` or `passthrough` fails the run at load, never falls back to replay). Run:
 *
 *   yarn test:integration                       # replay (default) — free, offline, deterministic
 *   yarn test:integration:coverage               # the same replay run, measured (report-only, no gate)
 *
 * Replay FAILS a suite whose HAR is missing (`recordIfMissing: false` plus the `nock` socket guard in
 * `setup-polly.ts`), so a suite with no committed recording sits in {@link QUARANTINED_CASSETTE_SUITES} and
 * the lane runs the suites that need no recorded provider traffic. The quarantine holds in EVERY mode, record
 * included: re-recording a suite against a tenant starts by deleting its line there, then
 * `POLLY_MODE=record yarn vitest run --config config/vitest/integration.ts <suite>`, and commits the new HAR
 * with the line still gone ([re-recording](../../docs/integration-coverage.md#re-recording-a-cassette)).
 *
 * This lane's coverage is REPORTED, never gated, and it is not blended into the unit number — the evidence
 * for that split is in [docs/integration-coverage.md](../../docs/integration-coverage.md).
 *
 * Tier is selected by DIRECTORY, not a filename suffix. Polly's adapter is a PROCESS-GLOBAL patch, so a
 * single worker owns one Polly at a time (see setup-polly); `pool: forks` + `fileParallelism: false` keeps
 * that invariant without cross-worker collisions.
 */
export default defineConfig({
  test: {
    ...baseVitestConfig.test,
    // A SEPARATE report directory, and the first requirement rather than polish: the floor ratchet reads
    // `coverage/coverage-summary.json`, so a `--coverage` run of this lane pointed at the shared default
    // would overwrite the unit lane's report in place and hand the unit floor an integration number.
    coverage: { ...baseVitestConfig.test?.coverage, reportsDirectory: "coverage-integration" },
    // Spread over Vitest's own defaults: a bare `exclude` REPLACES them, which would collect `node_modules`.
    exclude: [...configDefaults.exclude, ...QUARANTINED_CASSETTE_SUITES],
    fileParallelism: false,
    hookTimeout: 60_000,
    include: ["src/__tests__/integration/**/*.test.ts"],
    pool: "forks",
    sequence: { ...baseVitestConfig.test?.sequence, concurrent: false },
    setupFiles: [TEMP_ROOT_SETUP, AMBIENT_HOME_SETUP, "./src/__tests__/setup-polly.ts", TYPESCRIPT_LIFECYCLE_SETUP],
    testTimeout: 60_000,
  },
});
