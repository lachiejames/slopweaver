/**
 * The corpus hygiene GATE's entry point — the same scan `slopweaver audit hygiene` runs, rendered for a lint
 * plan rather than for an operator (see {@link ./corpusScan.renderCorpusHygieneGate}).
 *
 * It reads `$SLOPWEAVER_HOME`, so it is the one check in the plan whose subject is not the repository. That
 * is deliberate and it is the only lane available: the private denylist and the corpus both live off-repo,
 * so CI structurally cannot run this against anything — there it finds no bronze, says so in one line, and
 * exits 0 (`docs/security/hygiene-gate.md` § "Where the private denylist actually applies").
 *
 * A bronze ROOT the owner's protect list covers is not checked, so it fails the gate with the refusal's own lines. A
 * covered source or file under it is skipped and named NOT CHECKED on every run, and passes: the owner's ruling, not
 * this gate, put it out of reach. An unreadable protect list and a leak still fail.
 *
 * This file existing IS the invocation, exactly like `./scan.entry.ts`, so there is no guard.
 */
import { slopweaverHome } from "../config.js";
import { stateHomePaths } from "../stateHome.js";
import { renderCorpusHygieneGate } from "./corpusGate.js";
import { scanCorpusHygiene } from "./corpusScan.js";

const home = slopweaverHome();
const scanned = scanCorpusHygiene({ home, source: undefined });
if (scanned.isErr()) {
  for (const line of scanned.error) {
    process.stdout.write(`${line}\n`);
  }
  process.exit(1);
}
const result = scanned.value;
for (const line of renderCorpusHygieneGate({ bronze: stateHomePaths({ home }).corpus.bronze, result })) {
  process.stdout.write(`${line}\n`);
}
process.exit(result.leaks.length === 0 && result.unreadable.length === 0 ? 0 : 1);
