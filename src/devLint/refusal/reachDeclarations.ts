/**
 * The reach gates' refusal copy — the part of the declaration table that belongs to the instruments judging
 * what code REACHES: a process it launches, a provider or boundary it calls, a channel it writes down, a
 * root it resolves, a file it appends to, or a model transport it opens.
 *
 * A gate lives here when what it reads is a call that leaves the module: the safe-boundary wrappers, child
 * processes, the scheduler, stdout, the checkout root, headless launches and private browser profiles. A
 * gate that judges the shape of source is in `./sourceShapeDeclarations.ts`, and one that judges a statement
 * the repository makes about itself is in `./claimDeclarations.ts`.
 *
 * Every refusal id of a gate lives in the same leaf — a gate's fresh-violation row and its debt or rebaseline
 * row move together — which `registryComposition.test.ts` holds down. A new row goes here when its gate is a
 * reach one, and this file splits again when it nears the 300-code-line cap.
 */
import type { LintGateDeclaration } from "./types.js";

/**
 * The reach rows, keyed by refusal id. Spread into `./declarations.ts`'s `LINT_GATE_DECLARATIONS`, which
 * stays the one table every consumer reads.
 */
export const REACH_LINT_GATE_DECLARATIONS = {
  "boundary-residue": {
    caught:
      "an external boundary is called without a safe wrapper, so a throw crosses into code that models failure as a typed value",
    correction:
      "route the call through the matching wrapper in the safe-boundary module, then map its typed error into the domain's own union",
    exceptions: ["a call already inside a safe wrapper, which is the layer doing the wrapping"],
    gate: "boundary-residue",
  },
  "claude-email-not-identity": {
    caught:
      "a Claude module asks WHICH ACCOUNT from `accounts.json`'s `email`, which is a hand-typed display cache that a `/login` does not touch and that drifts from the token in the store",
    correction:
      "resolve the account from the organisation the probe named, against the standing enrollment in `identityAssertions.ts`, and render the result through `accountBinding.ts`'s decided cell",
    exceptions: [
      "a presence check against `undefined` or `null`, which asks whether an address is configured rather than which one it is",
      "passing, spreading or rendering the address, and pre-populating `claude auth login --email` with it",
    ],
    gate: "claude-email-not-identity",
  },
  "console-verb-binary": {
    caught:
      "the work console launches a child by a literal command name, or launches the resolved binary without pinning its environment to the same checkout, so which checkout's code answers every tile on it is decided by whatever PATH or PLUGIN_ROOT the long-lived server happened to inherit",
    correction:
      "resolve the binary to an absolute path first — `site/lib/slopweaverBin.ts` walks up from the server's cwd to the checkout that is serving — pass that value as the command, and pass `env: consoleChildEnv({ env, root: <resolved>.root })` in the same call",
    exceptions: [
      "a command reached through a name, which is already a resolved path a reader can follow",
      "a launcher whose first argument is not the command at all, such as `fork`, which takes a module path",
    ],
    gate: "console-verb-binary",
  },
  "linear-sdk-documents": {
    caught:
      "a Linear GraphQL document is written by hand for a root field `@linear/sdk` already ships a generated document for, which is a class made structurally impossible",
    correction:
      "send the SDK's own document for that root field and let `corpus/linear/names.ts` resolve the bare `{ id }` references it returns; where the SDK's selection genuinely cannot serve, mark the literal `linear-sdk-documents-exempt: <the measurement that decided it>` on the line above",
    exceptions: [
      "a selection the SDK's fragment cannot express — a deny-listed field it selects, or a connection with no root to reach it from — carrying its measurement on the line above",
    ],
    gate: "linear-sdk-documents",
  },
  "no-headless": {
    caught:
      "a model would be launched into a session the owner cannot see and interrupt as it runs, which rule 2 forbids",
    correction: "open a visible interactive workspace instead, which is what tier-3 execution is meant to look like",
    exceptions: ["a visible spawn, which is outside the criterion by construction"],
    gate: "no-headless",
  },
  "no-python": {
    caught:
      "a file runs a Python interpreter or tells a reader to, and the owner ruled that such work is typed, tested TypeScript exposed as a slopweaver verb instead",
    correction:
      "write the work as a TypeScript function with a test and reach it through a slopweaver verb, or replace a reproduction command with a jq, grep or verb equivalent you have run and shown to give the same answer",
    exceptions: [
      "prose naming the language, a backticked interpreter name with no arguments, or a command carried as test data rather than handed to a process",
    ],
    gate: "no-python",
  },
  "no-python-debt": {
    caught:
      "a recorded Python instruction no longer fires as often as its debt entry says, or an entry is malformed, so the list describes something that is not there",
    correction:
      "delete or correct the entry, which is how the list stays a measurement; never raise a count to fit a new instruction",
    exceptions: ["an entry that still fires exactly its recorded count, which is the list doing its job"],
    gate: "no-python",
  },
  "no-private-browser-profile": {
    caught:
      "a browser launch or attach names a profile directory or debugging port of its own, which the owner retired in favour of the owner's real Chrome",
    correction: "point the automation at the owner's real browser instead of minting a profile for it",
    exceptions: ["a bare browser-library import, which is the tool rather than the private profile"],
    gate: "no-private-browser-profile",
  },
  "operation-labels": {
    caught: "an operation's label is missing or does not match the vocabulary a reader of the ledger relies on",
    correction: "give the operation the declared label, in the form the register spells",
    exceptions: ["an internal step that is not a labelled operation"],
    gate: "operation-labels",
  },
  "outbound-privacy-closure": {
    caught:
      "an outbound write verb or sanctioned SDK factory has no classification against the outbound privacy check, or a family classified guarded no longer reaches it",
    correction:
      "route the write's final transport through its provider's privacy guard and classify the family guarded in `src/devLint/outboundPrivacyRegistry.ts`; failing that, name it there as residue with its reason, never by dropping a transport root",
    exceptions: [
      "a factory whose client cannot write, classified read-only with its reason",
      "a write surface the check does not judge yet, named as residue with its reason",
    ],
    gate: "outbound-privacy-closure",
  },
  "resilience-residue": {
    caught: "retry, backoff or rate limiting is hand-rolled, and a hand-rolled one is the version nobody measured",
    correction: "take it from the resilience module or the provider SDK's own plugins",
    exceptions: ["a single call with no retry at all, which needs none of it"],
    gate: "resilience-residue",
  },
  "running-checkout-root": {
    caught:
      "a module anchors a repository lookup on its own location outside the gates, so a worktree silently resolves another tree",
    correction: "resolve the checkout from the invocation rather than from the module's own path",
    exceptions: ["a gate in this directory, which is anchored on purpose"],
    gate: "running-checkout-root",
  },
  "scheduler-bypass": {
    caught:
      "a provider client is constructed outside the sanctioned factories, so a call can skip the scheduler that paces every other one",
    correction: "construct it in a sanctioned factory, listing the path AND marking the line with a reason",
    exceptions: ["a line already carrying the factory source marker with a stated reason, in an allowlisted file"],
    gate: "scheduler-bypass",
  },
  "stdout-data-channel": {
    caught:
      "a verb writes to stdout directly, so the one channel a caller pipes carries something a schema never shaped",
    correction: "write through the output helper, which keeps stdout a data channel",
    exceptions: ["a diagnostic on stderr, which is not the data channel"],
    gate: "stdout-data-channel",
  },
  "torn-tail-append": {
    caught:
      "a file is appended to outside the one line append, so a record written after a crash cut the last line short fuses with it into one unparseable line, which wrote one death record twice",
    correction:
      "append through `appendLines` in `src/lib/appendSeparator.ts`, `durable: true` where something is later built on the line, or probe a held descriptor with `descriptorNeedsSeparator`",
    exceptions: [
      "a test seeding a torn or malformed tail on purpose, which this gate never scans",
      "an append that must hold one descriptor across its checks, recorded in the debt list with its own guard",
    ],
    gate: "torn-tail-append",
  },
  "session-harness-lifecycle": {
    caught:
      "a cmux client is constructed, a session is launched with spawnCmuxSession, or its spawned row appended by hand, outside the session harness seam, so a second harness implementation would have to be wired verb by verb and the one recorder that writes every session's ledger row is bypassed",
    correction:
      "open cmux through withCmuxSessionHost (src/sessionHarness/cmuxHost.ts) or productionSpawnDeps (src/sessionHarness/recordedSpawn.ts), launch through a SessionLauncher wrapped in recordingSessionLauncher (src/sessionHarness/recordingHarness.ts) as cmux spawn does in spawnLaunch.ts, and let the recorder write the row",
    exceptions: [
      "a file under src/sessionHarness itself, which is the seam",
      "src/cmux/client.ts naming its own constructors, which is where they are defined",
      "a session-ledger append of any kind but spawned, which this stage leaves to the verbs that close rows",
      "an opener the next stage moves behind the seam, recorded in the debt list with the row that moves it",
    ],
    gate: "session-harness-lifecycle",
  },
  "session-harness-lifecycle-debt": {
    caught:
      "a recorded reach past the session harness seam stopped firing, so the debt list now describes something that is no longer there",
    correction:
      "remove the stale entry from the debt list, which is how that list stays a measurement rather than a memory",
    exceptions: ["an entry that still fires, which is the list doing its job"],
    gate: "session-harness-lifecycle",
  },
  "torn-tail-append-debt": {
    caught:
      "a recorded descriptor append stopped firing, so the debt list now describes something that is no longer there",
    correction:
      "remove the stale entry from the debt list, which is how that list stays a measurement rather than a memory",
    exceptions: ["an entry that still fires, which is the list doing its job"],
    gate: "torn-tail-append",
  },
  "sync-child-timeout": {
    caught:
      "a file holds more synchronous child-process calls with no visible timeout than its debt entry records, and a sync child blocks the event loop, so a prompt nobody can see (a keychain dialog, a credential helper, an ssh passphrase) stalls the seat with nothing able to end it",
    correction:
      "pass a `timeout` in the call's own options literal (or a same-file const literal it names), sized past the slowest legitimate run, and surface the ETIMEDOUT as the call site's named failure; a child unbounded on purpose carries a `sync-child-timeout-exempt: <reason>` comment above its statement",
    exceptions: [
      "a local function, or an inner binding, that only shares a launcher's name, which the gate resolves lexically to its declaration and leaves alone",
      "the asynchronous `spawn`/`execFile`, which leave the event loop free for a watchdog",
      "a foreground child that runs until the owner interrupts it, under the reviewed marker with its reason",
    ],
    gate: "sync-child-timeout",
  },
  "sync-child-timeout-debt": {
    caught:
      "a debt entry no longer describes the tree: its file now has fewer unbounded synchronous child calls than it records, or the entry itself is malformed (a count that is not a positive integer, a path listed twice, the list out of path order)",
    correction:
      "lower that file's count in `src/devLint/syncChildTimeoutDebt.ts`, or delete the entry at zero, keeping one row per path in path order; the list only ever shrinks",
    exceptions: ["an entry whose count still matches, which is the list doing its job"],
    gate: "sync-child-timeout",
  },
  "unexpanded-plugin-root": {
    caught:
      "a command this code PRINTS embeds a brace-form shell variable the harness substitutes only when it reads a `SKILL.md`, so it expands to nothing in the shell of whoever pastes it and the instruction silently does nothing",
    correction:
      "emit the value this process has already resolved — `bundledLauncherPath` in `src/lib/pluginRoot.ts` for the launcher — or take it as a parameter so the caller resolves it",
    exceptions: [
      "a `SKILL.md` or any other markdown, which the harness reads and substitutes, and which this gate never scans",
      "a GitHub Actions expression, whose second brace is not the start of a shell variable name",
    ],
    gate: "unexpanded-plugin-root",
  },
} as const satisfies Readonly<Record<string, LintGateDeclaration>>;
