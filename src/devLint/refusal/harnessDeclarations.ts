/**
 * The harness gates' refusal copy — the part of the declaration table that belongs to the instruments
 * judging the repository's own verification machinery: the test tree, the proof-artifact paths, the store
 * schema and its migrations, and the lint plan's registration of its own gates.
 *
 * A gate lives here when what it protects is the machinery that checks the code rather than the code: test
 * homes and assertions, migration and journal consistency, `.gitignore`d proof output, and gate
 * registration. A gate that judges the shape of source is in `./sourceShapeDeclarations.ts`, and one that
 * judges what code reaches is in `./reachDeclarations.ts`.
 *
 * Every refusal id of a gate lives in the same leaf — a gate's fresh-violation row and its debt or rebaseline
 * row move together — which `registryComposition.test.ts` holds down. A new row goes here when its gate is a
 * harness one, and this file splits again when it nears the 300-code-line cap.
 */
import type { LintGateDeclaration } from "./types.js";

/**
 * The harness rows, keyed by refusal id. Spread into `./declarations.ts`'s `LINT_GATE_DECLARATIONS`, which
 * stays the one table every consumer reads.
 */
export const HARNESS_LINT_GATE_DECLARATIONS = {
  "dev-lint-empty-selection": {
    caught:
      "the gates named exist, and the lane you asked for runs none of them — a PASS from a run that spawned nothing is the worst answer available",
    correction: "run the same selection on the full lane, or name a gate this lane actually runs",
    exceptions: ["you meant to check which lane owns a gate, which the skipped list above already answers"],
    gate: "dev lint",
  },
  "dev-lint-seat-step-withheld": {
    caught:
      "withheld one step of the seat lane, because this machine cannot hold it right now — the rest of the lane ran, and the verdict covers only what ran",
    correction:
      "nothing in the source is wrong; re-run the step it names once that clears, with the command the reason gives",
    exceptions: [
      "the lap that holds the machine is your own pull request's, in which case its whole-tree oxlint already covers these files",
    ],
    gate: "dev lint",
  },
  "drizzle-migrations-barrel": {
    caught:
      "a module under src/store/schema/ declares a table or enum the barrel does not export, so drizzle-kit, the grants, the enum labels and the verifier are all blind to it at once",
    correction: "export it from src/store/schema.ts, the one module every reader of the schema goes through",
    exceptions: ["a table that is being retired in the same change and whose module is deleted with it"],
    gate: "drizzle-migrations",
  },
  "drizzle-migrations-drift": {
    caught:
      "drizzle-kit would generate a migration from the schema, so the schema carries a change no committed migration does — a column, an index, a check or a policy, which the CREATE TABLE coverage check cannot see",
    correction: "run `slopweaver store push` and commit the migration it generates beside the schema change",
    exceptions: ["a change drizzle-kit cannot express, applied by the post-migration phase and documented there"],
    gate: "drizzle-migrations",
  },
  "drizzle-migrations-rls": {
    caught:
      "a declared table does not carry exactly the three store policies — owner all, agent select, bot select — or does not enable row level security, so a role's read of it is either denied outright or wider than ruled",
    correction: "spread storeTablePolicies({ botRead, table }) into the table's extras, and nothing else policy-shaped",
    exceptions: [
      "a table whose bot predicate is deliberately narrower, expressed through botRead rather than a fourth policy",
    ],
    gate: "drizzle-migrations",
  },
  "drizzle-migrations-journal": {
    caught: "the journal disagrees with the migrations beside it, so nothing records the order they must be applied in",
    correction: "regenerate the journal from the migrations, or restore the entry a hand edit dropped",
    exceptions: ["a migration deliberately applied out of band, which still has to be journalled afterwards"],
    gate: "drizzle-migrations",
  },
  "drizzle-migrations-safety": {
    caught: "a migration carries a statement that cannot run inside the transaction the migrator wraps it in",
    correction: "move the statement into its own migration, or rewrite it in a form the transaction allows",
    exceptions: ["a statement whose non-transactional form is deliberate and is applied by hand, out of band"],
    gate: "drizzle-migrations",
  },
  "drizzle-migrations": {
    caught: "a schema change has no migration beside it, so the deployed database and the declared schema disagree",
    correction: "generate the migration and commit it with the schema change it belongs to",
    exceptions: ["a schema edit that is purely a comment or a type-level rename"],
    gate: "drizzle-migrations",
  },
  "store-journal-anchor": {
    caught:
      "the committed migration journal is resolved against the operator cwd — invisible in the main checkout, and ENOENT in every worktree and spawned seat, so the store verbs die before they reach a connection",
    correction:
      "omit the cwd argument so the installedTreeRoot default applies, or pass installedTreeRoot({ importMetaUrl: import.meta.url }) explicitly",
    exceptions: [
      "a test that materialises a fixture tree and points a verb at it, which is outside this scan by construction",
      "a verb whose subject genuinely is the operator checkout rather than the journal, which never calls the journal family",
    ],
    gate: "store-journal-anchor",
  },
  "gate-registration": {
    caught:
      "a gate exists in this directory but the lint plan never runs it, and an unrun gate reports nothing forever",
    correction: "register it in the lint plan and add its name to the expected list in the plan's own test",
    exceptions: ["a helper module in this directory that is not a gate and has no entry point"],
    gate: "gate-registration",
  },
  "gate-registration-declaration": {
    caught: "a registered gate has no refusal declaration, so it can still refuse without saying what a fix looks like",
    correction: "add its row to the lint-gate declarations and render its refusal through the shared renderer",
    exceptions: ["a gate that only ever reports facts and never refuses on policy, declared as such"],
    gate: "gate-registration",
  },
  "gate-registration-entry-lifecycle": {
    caught:
      "a gate entry exits by itself instead of through the shared entry wrapper, so it skips the TypeScript client close every gate owes before it exits",
    correction:
      "make the entry one top-level `await runGateEntry({ run })` imported from the gate-entry module, with no direct process exit anywhere in it",
    exceptions: [
      "none in this directory: every gate entry is a process the lint runner spawns, so every one owns that close",
    ],
    gate: "gate-registration",
  },
  "git-in-tests": {
    caught: "a test shells out to git directly, so it depends on a repository state no fixture controls",
    correction: "build the state in a throwaway directory the test owns, or inject the git seam as a plain fake",
    exceptions: ["a test whose subject IS the git seam, exercising it through the repository helper"],
    gate: "git-in-tests",
  },
  "home-safety": {
    caught: "a test writes into the real state home, or reads the home variable in the test tree at module scope",
    correction:
      "pass an explicit home built with a temp directory, and take the real home from the captured-home helper if a lane genuinely needs it",
    exceptions: ["a line carrying the home-safety source marker with a stated reason"],
    gate: "home-safety",
  },
  "no-proof-path": {
    caught:
      "the tree carries proof output — a file under a proof, proofs, screenshots or .proof directory, or a picture or recording named for proof or a screenshot — or the gitignore lost the block that stops one being staged; the owner ruled there is no need for a proof folder in any pull request",
    correction:
      "delete the file from the branch and keep it under the Slopweaver state home or a scratchpad, attaching a picture to the pull request body instead; restore the gitignore block from the proof-path criterion module",
    exceptions: ["TypeScript source in a module directory under src that happens to be named proof"],
    gate: "no-proof-path",
  },
  "testing-discipline": {
    caught:
      "a file in the test tree — a test, or a fake or fixture builder one leans on — uses a mock, a truthiness assertion, a bare property check or a type-of assertion, each of which can pass for any input",
    correction:
      "extract the pure logic and assert its exact value, injecting a plain fake function where a seam is genuinely needed",
    exceptions: ["a weak assertion the testing rule allows deliberately, such as a defined check on an optional field"],
    gate: "testing-discipline",
  },
  "unnamed-failure-assertion": {
    caught:
      "a test case says only that a result failed, so it passes on any refusal — including one its own title says it is not about",
    correction: "assert the failure the case is named for, reading the typed error's code for which one it was",
    exceptions: ["a case that also asserts something else, which is what carries the rest of the claim"],
    gate: "unnamed-failure-assertion",
  },
  "unnamed-failure-assertion-rebaseline": {
    caught: "a rebaseline was asked to record MORE unnamed-failure cases in a file than its debt entry carries",
    correction: "name the failures the new cases are about, then rebaseline; the debt list only ratchets down",
    exceptions: ["a file whose first entry is being added, which widens the list rather than an entry"],
    gate: "unnamed-failure-assertion",
  },
} as const satisfies Readonly<Record<string, LintGateDeclaration>>;
