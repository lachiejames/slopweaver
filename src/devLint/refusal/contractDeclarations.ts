/**
 * The contract gates' refusal copy — the half of the declaration table that belongs to the instruments
 * asserting one machine still honours a contract another one declared.
 *
 * ## Why this is a leaf, and why along THIS seam
 *
 * A row defined in a leaf and spread into `./declarations.ts` satisfies `undeclaredGates` exactly as a row
 * written there would, because the parity is over the COMPOSED table. What would be drift is a row defined
 * twice, and the spread makes that impossible. `./qualityDeclarations.ts` carries the full argument.
 *
 * The cut is the one `contractRatchets` in `../gateGroups.ts` already draws — the CI offload and trigger
 * contracts, the ambient heap ceiling, hook bounding, the help/flag opt-out, the coverage and door
 * ratchets, derived-card voice, the two escape-hatch gates and the compiler heap contract. Every refusal id
 * of each moves together, which is the property `registryComposition.test.ts` holds down for every leaf.
 * A new contract gate's row goes here, and this file splits again when it nears the 300-code-line cap.
 */
import type { LintGateDeclaration } from "./types.js";

/**
 * The contract-gate rows, keyed by refusal id. Spread into `./declarations.ts`'s
 * `LINT_GATE_DECLARATIONS`, which stays the one table every consumer reads.
 */
export const CONTRACT_LINT_GATE_DECLARATIONS = {
  "ambient-heap-ceiling": {
    caught:
      "an AMBIENT heap ceiling is set through `NODE_OPTIONS`, which every Node process under it inherits, so it cannot name which process needed the headroom and it silently covers the next one that starts needing some",
    correction:
      "do not raise a ceiling to make a red go away. Measure the process — `slopweaver dev profile --gate <name> --cpu` — and fix what the measurement names. If you have measured it and genuinely cannot solve the memory problem, explain to the OWNER why there is a memory problem you cannot solve, which is what is asked of you, rather than putting the variable back",
    exceptions: [
      "a ceiling on the argv of the ONE process that needs it — `node --max-old-space-size=8192 …/tsc`, or `devLint.ts` spawning its gate with the flag on the CHILD's argv — which is outside this criterion by construction, since the gate never reads an argv",
    ],
    gate: "ambient-heap-ceiling",
  },
  "ci-offload-contract": {
    caught:
      "a lap the local lane deliberately skips is no longer run by CI either, so the offloaded work runs nowhere, or a job in ci.yml stands outside the required `build` check and could go red while it stays green, or a `jobs` key is not a plain job id so the gate cannot tell which job it names, or an UNAGGREGATED_JOBS entry names a job the file no longer has or one `build.needs` also lists",
    correction:
      "restore the CI job that runs it, or stop skipping it locally; put a new job behind `build` by registering its command in OFFLOADED_COMMANDS, or name it in UNAGGREGATED_JOBS with the reason it is not behind `build`; spell every job id as a plain string that starts with a letter or `_` and holds only letters, digits, `-` and `_`; delete an UNAGGREGATED_JOBS entry whose job is gone, and never list one job in both `build.needs` and UNAGGREGATED_JOBS",
    exceptions: [
      "a check that was deliberately retired in both places at once",
      "a job that is a required context of its own, or that deliberately only reports, which belongs in UNAGGREGATED_JOBS with a reason",
    ],
    gate: "ci-offload-contract",
  },
  "ci-trigger-contract": {
    caught:
      "a CI job can fire on an event that could not change its verdict, so a landing pays for a byte-identical re-run",
    correction: "narrow the job's trigger list to the events whose payload it actually reads",
    exceptions: ["a job that genuinely reads the pull-request body, which an edit does change"],
    gate: "ci-trigger-contract",
  },
  "coverage-ratchet": {
    caught:
      "measured coverage dropped below the committed floor, so the change is less covered than the tree it landed on",
    correction: "cover the new code, or delete what is untested; the floor only ratchets up",
    exceptions: ["a file legitimately excluded, which belongs in the exclusion list with a reason"],
    gate: "coverage-ratchet",
  },
  "coverage-ratchet-rebaseline": {
    caught:
      "a rebaseline was asked to record coverage FALLING, which would move the bar rather than measure against it",
    correction: "raise coverage until it clears the committed floor, then rebaseline; the floor only ratchets up",
    exceptions: ["a deliberate, reviewed floor change whose reason is in the same pull request"],
    gate: "coverage-ratchet",
  },
  "coverage-ratchet-unfloored": {
    caught:
      "a directory large enough to carry its own coverage floor has none, so all of its coverage could be lost before this gate reddened",
    correction:
      "run the unit lane and then the coverage rebaseline, and commit the floor it writes for the directory; it sits one point under the measurement and only ever rises",
    exceptions: ["a coverage run over a partial lane, which measures a different tree and should not set the floor"],
    gate: "coverage-ratchet",
  },
  "coverage-ratchet-floor": {
    caught:
      "a committed coverage floor is LOWER than the one at the base commit, so the bar moved rather than the code",
    correction:
      "restore the floor and raise coverage instead; a lowered floor is the one edit this gate exists to catch",
    exceptions: ["a deliberate, reviewed floor change whose reason is in the same pull request"],
    gate: "coverage-ratchet",
  },
  "derived-card-fixture": {
    caught:
      "caught a declared bot form kind whose canonical fixture no longer parses, or derives no prose at all, so that branch of the derivation contributed nothing to the scan that is supposed to cover every branch of every kind",
    correction:
      "fix the fixture in src/outbound/artifact/botFormKinds.ts until it parses and provokes every sentence its own derivation composes — a separator, a count sentence, a closing clause",
    exceptions: [
      "a kind being retired in the same change, whose registry entry goes with its fixture",
      "a form whose schema genuinely changed, where the fixture is updated to the new shape rather than trimmed to fit",
    ],
    gate: "derived-card-voice",
  },
  "derived-card-voice": {
    caught:
      "caught prose this repository COMPOSES onto a bot card, rather than prose a caller wrote, matching the operator's own above-the-fold voice rules: text no form schema can see, because it does not exist until after every schema has passed",
    correction:
      "change the separator, clause or sentence in the derivation itself, so no caller can ever be handed a card carrying it",
    exceptions: [
      "a run the operator declared quoted, which is somebody else's words by declaration and is skipped before the rules run",
      "a below-the-fold match, which warns and never refuses by the owner's rule",
    ],
    gate: "derived-card-voice",
  },
  "escape-hatch-door": {
    caught:
      "a door refusal is built by hand — from the finding list, or from the bare `decision.status` verdict alone — so it does not print the finding or the override token it carries",
    correction: "render it with doorRefusalLines({ command, decision }) from src/admit/doorRefusal.ts",
    exceptions: ["findings mapped into a RECORD rather than text, which is a journal row or a JSON document"],
    gate: "escape-hatch",
  },
  "escape-hatch-lane": {
    caught: "a hatch row's lane disagrees with the ruling that outbound hatches are journalled and nothing else is",
    correction: "set the row's lane to match what it actually is, or move the hatch off the outbound surface",
    exceptions: ["a row whose surface genuinely changed, whose lane is corrected in the same edit"],
    gate: "escape-hatch",
  },
  "escape-hatch-lint-shape": {
    caught: "a lint gate writes its own refusal summary instead of the one shape every gate ends in",
    correction:
      "render it with lintGateRefusal (src/devLint/refusal/render.ts), or mark the line above a FACT or a correction body `devlint: not-a-refusal -- <why>`",
    exceptions: ["a per-finding diagnostic, a correction body, or a fact the gate could not get past"],
    gate: "escape-hatch",
  },
  "escape-hatch-reader": {
    caught: "a hatch row names a reader module that is not there, or one that never mentions the row's own key",
    correction: "point the row at the module that really reads it, or add the read to the module it names",
    exceptions: ["a reader renamed in the same edit, whose row moves with it"],
    gate: "escape-hatch",
  },
  "escape-hatch": {
    caught: "an escape hatch or a door override token is used with no row declaring it",
    correction: "declare the row in the hatch register, with its command and its legitimate exceptions",
    exceptions: ["findings mapped into a RECORD rather than text, which is a journal row or a JSON document"],
    gate: "escape-hatch",
  },
  "hatch-release": {
    caught:
      "an escape-hatch environment read sits in a parameter default, so the variable is inert whenever a caller passes that argument",
    correction: "read the variable in the function body, or resolve it at the call site and pass the resolved value",
    exceptions: ["a default that is not an escape-hatch read at all"],
    gate: "hatch-release",
  },
  "help-flag-opt-out-prune": {
    caught: "a prune was asked to drop verbs that are NEW offenders rather than stale entries, which would hide them",
    correction: "guard each new offender first — export its flag names and list them in its usage — then prune",
    exceptions: ["an entry that genuinely no longer offends, which is what prune is for"],
    gate: "help-flag-opt-out",
  },
  "help-flag-opt-out": {
    caught:
      "a verb opts out of the help and flag ratchet while its flag set is readable, which is how a shipped flag stays invisible",
    correction:
      "export the flag spec's names, list every one in the verb's usage, and move it to the guarded list with a probe per flag",
    exceptions: ["a verb that parses no flags of its own and only dispatches to verbs that do"],
    gate: "help-flag-opt-out",
  },
  "hook-bounded": {
    caught:
      "a registered hook can run without the envelope — it bypasses the one entry point, declares no timeout, declares one too short for the ladder, or passes the entry point a different timeout from the one it declares",
    correction: "register the command through the one hook entry point, passing it the same timeout the entry declares",
    exceptions: ["a hook surface that the harness invokes with no timeout contract of its own, which nothing here has"],
    gate: "hook-bounded",
  },
  "heap-ceiling-ratchet": {
    caught:
      "a heap ceiling this repository spends — a package script's `--max-old-space-size`, a lint gate's argv ceiling, or `HEAP_BUDGET_MIB` — disagrees with `.baselines/heap-ceilings.json`, or rises against the base commit with no appended raise record anchoring the owner's word, which the owner's rules forbid a session to do on its own",
    correction:
      "do not raise a ceiling to make a red go away: measure the process and fix what the measurement names. A LOWERED ceiling needs only its pin updated to match. A raise the owner has actually ruled on is appended to `raises` as `{ key, fromMiB, toMiB, anchor, approvedIso, recordedIso }` in the same change; one not yet ruled on goes to the owner as a question with the measurement",
    exceptions: [
      "a ceiling the owner approved, recorded as an appended raise row naming the anchor of the owner's word",
      "a ceiling LOWERED, or a new one at or under 4,096 MiB, which needs only its pin",
    ],
    gate: "heap-ceiling-ratchet",
  },
  "tsc-heap-contract": {
    caught:
      "a package script runs the TypeScript compiler without the bound the pinned version needs — on TypeScript 6 its own `--max-old-space-size`, else it runs at V8's own default, which `yarn build` measurably died at; on 7.1 the compiler owner, since a V8 flag bounds nothing a native compiler spends and the compiler ignores SIGTERM",
    correction:
      "on TypeScript 6 spell `node --max-old-space-size=<MiB> node_modules/typescript/bin/tsc …`; on 7.1 spell `bash scripts/tsc-owner.sh --timeout-seconds <s> --grace-seconds <≤5> --rss-ceiling-mib <MiB> -- <compiler> …`, the path relative to the manifest — and record the measurement that chose each number beside it",
    exceptions: [
      "a script that does not run the compiler at all, which this gate never selects",
      "a compiler call reached through a shell script or a JS wrapper, which a package-script gate cannot see",
    ],
    gate: "tsc-heap-contract",
  },
  "typescript-pin": {
    caught:
      "a tracked manifest or lockfile names a TypeScript other than the one pinned version — a range, an alias, the `@typescript/typescript6` compatibility package, an older compiler resolved for a dependant, a manifest or lockfile outside the three that pin it, a tracked copy of the compiler itself, or another package manager's lockfile — so a second compiler can install beside the pinned one",
    correction:
      "pin `typescript` to exactly `TYPESCRIPT_PIN` (`src/devLint/typescriptPin.ts`) in each of the three manifests and reinstall so every lockfile resolves only that version; a new TypeScript-bearing project is added to `TYPESCRIPT_PIN_MANIFESTS` and `TYPESCRIPT_PIN_LOCKFILES` in the same change",
    exceptions: [
      "Yarn's own builtin `compat/typescript` patch of the pinned version, which this gate accepts",
      "a dependant's peer range naming an older TypeScript, which installs nothing and which this gate never reads",
    ],
    gate: "typescript-pin",
  },
} as const satisfies Readonly<Record<string, LintGateDeclaration>>;
