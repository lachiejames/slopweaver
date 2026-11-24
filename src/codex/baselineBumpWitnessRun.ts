/**
 * The effectful half of the ratchet-bump check: measure what a pull request loosens against its base, read the
 * bump records in the state home (`./bumpRecordStore.ts`), any manifest the pull request itself commits
 * (`./committedBumpManifests.ts`) and the pass records beside them, resolve every git
 * and ledger fact, and ask the pure halves (`./baselineBumpCoverage.ts`, `./baselineBumpWitness.ts`) whether every
 * loosened row is covered by a witnessed record. Both landing verbs read it immediately before their mutation,
 * and it is the ONLY place a loosening is held to a declaration: CI cannot see the home.
 *
 * ## Uncertainty is a refusal, never "no records"
 *
 * A base commit GitHub did not name, a commit no checkout here holds and `origin` would not supply, a listing
 * git refused, a bump record that will not read or decode, an ancestry question git could not answer, a record
 * that could not be measured against its own base, an unreadable pass record — each becomes `refused` with its
 * reason. The one answer that reads neither the records nor the ledger is a comparison that SUCCEEDED and found
 * nothing loosened, which is every pull request that loosens no ratchet: no record can bear on it, so a damaged
 * store holds only the landings it could change.
 *
 * ## The comparison is run here, in the landing verb's code
 *
 * CI's `baseline-against-main` only reports; this read compares the two commits itself and refuses any loosened
 * row no witnessed record covers. Landing from a checkout of the pull request itself runs its code — the residue
 * every landing gate here shares, closed by landing from a checkout of main.
 *
 * It judges what landing would produce — main's commit merged with the head, as CI judges GitHub's merge
 * commit — never the raw head. Which records count is `./baselineBumpPlacement.ts`'s question; only the eligible
 * ones are asked about the ledger, so a store of inert history costs no ledger read.
 *
 * ## Where the git reads run
 *
 * A full-history checkout of the pull request's repository holding both commits, chosen and if need be fetched
 * into by `./baselineBumpCheckouts.ts`, which asks the candidates lazily and stops at the first that will do. The
 * ledger is then read across every checkout holding the head commit that has a pass record on the branch, exactly
 * as the pairing floor reads it (`./landingGateRun.ts`, `./branchEvidenceRoots.ts`). The ledger takes no
 * landing-base carry; `./baselineBumpFloor.ts` reads the pinned review bases, the landing patch and each
 * manifest's held floor from the full-history checkout, and the witness predicate alone decides what they carry.
 */

import { rowKey } from "../devLint/baselineBump.js";
import type { BaselineComparison } from "../devLint/baselineComparison.js";
import { gitLines } from "../devLint/gitAtCommit.js";
import { stateHomePaths } from "../stateHome.js";
import { type CandidateCheckoutRoots, candidateCheckoutRoots } from "./baselineBumpCheckouts.js";
import { coverageRefusalLines, judgeRecords, recordApplies } from "./baselineBumpCoverage.js";
import { readBaselineBumpCarryEvidence } from "./baselineBumpFloor.js";
import { measureLanding } from "./baselineBumpLanding.js";
import { placeRecords } from "./baselineBumpPlacement.js";
import { type UnwitnessedManifest, unwitnessedManifests } from "./baselineBumpWitness.js";
import { type BumpRecord, readBumpRecords } from "./bumpRecordStore.js";
import { committedBumpManifests, landingBumpRecords } from "./committedBumpManifests.js";
import { reviewBaseRefs } from "./diffCarry.js";
import { commitDiffsNow } from "./diffsNow.js";
import type { PullRequestHead } from "./landingGate.js";
import { noQualifyingCheckoutReason, type QualifyingCheckout, relevantFirstQualifying } from "./landingGateRun.js";
import { type BranchLedger, ledgerForBranch } from "./ledger.js";
import { type LedgerScan, scanPassRecords } from "./ledgerStore.js";
import { unionLedger } from "./ledgerUnion.js";
import type { Supersession } from "./supersession.js";
import type { SupersessionPort } from "./supersessionPort.js";
import { supersessionPort } from "./supersessionStore.js";
import type { CodexArtifactRecord } from "./types.js";

/** What the witness read concluded for one pull request. */
export type BaselineBumpVerdict =
  { readonly kind: "clear" } | { readonly kind: "refused"; readonly details: readonly string[] };

/**
 * A landing verb's seam onto {@link readBaselineBumpWitness}; a test hands it a plain function. `landingBranch`
 * names the branch a native-stack member's WHOLE stack lands on when that is not its own base: GitHub lands every
 * unmerged member below it in the same press, so the read judges against that branch's tip instead.
 * `undefined` judges against the pull request's own base.
 */
export type BaselineBumpWitnessReader = (args: {
  cwd: string;
  home: string;
  head: PullRequestHead;
  landingBranch: string | undefined;
}) => BaselineBumpVerdict | Promise<BaselineBumpVerdict>;

/**
 * The real read as a landing verb's seam, closed over the store's supersession register. Composition roots only.
 *
 * @returns the reader a landing verb's production deps carry
 */
export function productionBaselineBumpWitnessReader(): BaselineBumpWitnessReader {
  const supersessions = supersessionPort();
  return ({ cwd, head, home, landingBranch }) => {
    const subject =
      landingBranch === undefined ? head : { ...head, baseSha: originBranchTip({ branch: landingBranch, cwd }) };
    return readBaselineBumpWitness({ cwd, head: subject, home, supersessions });
  };
}

/**
 * The commit a branch on `origin` points at now, read with `git ls-remote` in the given checkout. IO edge.
 *
 * @param cwd the checkout whose `origin` is asked
 * @param branch the branch name, without `refs/heads/`
 * @returns the full commit, or `undefined` when git refused or the branch does not exist — which the read
 *   then refuses as an unknown base
 */
export function originBranchTip({ cwd, branch }: { cwd: string; branch: string }): string | undefined {
  const listed = gitLines({ args: ["ls-remote", "origin", `refs/heads/${branch}`], root: cwd });
  const sha = listed?.[0]?.split("\t")[0];
  return sha !== undefined && /^[0-9a-f]{40}$/u.test(sha) ? sha : undefined;
}

/** A refusal carrying one reason. */
const refused = ({ detail }: { detail: string }): Extract<BaselineBumpVerdict, { kind: "refused" }> => ({
  details: [detail],
  kind: "refused",
});

/**
 * Read whether every row a pull request loosens is covered by a store bump record with its Codex witness.
 *
 * @param cwd the checkout the landing verb runs in — one candidate among several
 * @param home the state home holding the bump records, the pass records and the profile's declared checkouts
 * @param head the pull request being landed, its base commit included
 * @param supersessions the register of retired passes — required, so a test hands a memory port
 * @returns `clear`, or `refused` with the uncovered rows and why, or the reason nothing could be judged
 */
export async function readBaselineBumpWitness({
  cwd,
  home,
  head,
  supersessions,
}: {
  cwd: string;
  home: string;
  head: PullRequestHead;
  supersessions: SupersessionPort;
}): Promise<BaselineBumpVerdict> {
  const baseSha = head.baseSha;
  if (baseSha === undefined) {
    return refused({ detail: "the pull request's base commit is unknown, so what it loosens cannot be judged" });
  }
  const scan = scanPassRecords({ orchestrationRoot: stateHomePaths({ home }).orchestration });
  if (scan.isErr()) {
    return refused({ detail: `could not read the pass records: ${scan.error.message}` });
  }
  const recordRoots = scan.value.records.map((record): unknown => record.repoRoot);
  const candidates = candidateCheckoutRoots({
    cwd,
    home,
    recordRoots: recordRoots.filter((root): root is string => typeof root === "string" && root.length > 0),
  });
  const measured = measureLanding({ baseSha, candidates, head });
  if (measured.kind === "refused") {
    return measured;
  }
  const { candidate, comparison, root } = measured;
  // Read before the clear below, as main's comparison did: a malformed added manifest refuses even a quiet change.
  const committed = committedBumpManifests({ base: baseSha, candidate, root });
  if (committed.isErr()) {
    return refused({ detail: `could not read the pull request's bump manifests: ${committed.error.message}` });
  }
  if (comparison.loosened.length === 0) {
    return { kind: "clear" };
  }
  const stored = readBumpRecords({ home });
  if (stored.isErr()) {
    return refused({ detail: `could not read the ratchet bump records: ${stored.error.message}` });
  }
  return judgeLanding({
    baseSha,
    candidate,
    candidates,
    comparison,
    head,
    home,
    records: landingBumpRecords({ committed: committed.value, stored: stored.value }),
    root,
    scan: scan.value,
    supersessions,
  });
}

/**
 * Judge a measured landing that loosened something: place the records that apply, ask the ledger about the
 * eligible ones, and refuse every row no witnessed record covers.
 *
 * @param candidate the merge commit landing would produce
 * @param candidates every checkout considered, of any repository, and the verb's own
 * @param comparison what the candidate loosened against the base
 * @param records every bump record the landing read, the home's and the pull request's
 * @param root the checkout holding both commits
 * @param scan the pass records, with how many could not be parsed
 * @returns `clear`, or `refused` with the uncovered rows and why
 */
async function judgeLanding({
  baseSha,
  candidate,
  candidates,
  comparison,
  head,
  home,
  records,
  root,
  scan,
  supersessions,
}: {
  baseSha: string;
  candidate: string;
  candidates: CandidateCheckoutRoots;
  comparison: BaselineComparison;
  head: PullRequestHead;
  home: string;
  records: readonly BumpRecord[];
  root: string;
  scan: LedgerScan;
  supersessions: SupersessionPort;
}): Promise<BaselineBumpVerdict> {
  const loosenedKeys = new Set(comparison.loosened.map((row) => rowKey({ row })));
  const placement = placeRecords({
    applicable: records.filter((record) => recordApplies({ loosenedKeys, record })),
    baseSha,
    candidate,
    changedPaths: comparison.changedPaths,
    root,
  });
  if (placement.kind === "refused") {
    return refused({ detail: placement.detail });
  }
  const eligible = placement.records.filter((one) => one.ineligible.length === 0).map((one) => one.record);
  const witnessed = await unwitnessedOf({ baseSha, candidates, eligible, head, home, root, scan, supersessions });
  if (witnessed.kind === "refused") {
    return witnessed;
  }
  const lines = coverageRefusalLines({
    judged: judgeRecords({ placed: placement.records, unwitnessed: witnessed.byPath }),
    loosened: comparison.loosened,
  });
  if (lines.length === 0) {
    return { kind: "clear" };
  }
  return {
    details: [
      `the store bump records do not cover what this pull request loosens against ${baseSha.slice(0, 12)}:`,
      ...lines,
    ],
    kind: "refused",
  };
}

/**
 * The branch ledger of every qualifying checkout, unioned, each counted only when it holds an entry
 * (`alwaysCount: false`), since none of them is the verb's own privileged read.
 *
 * @param qualified the checkouts holding the head commit, each with the fingerprint it resolved
 * @param records every pass record the scan read
 * @param retired the retired passes, read from the supersession register
 * @returns the unioned ledger
 */
function qualifiedLedger({
  head,
  qualified,
  records,
  retired,
}: {
  head: PullRequestHead;
  qualified: readonly QualifyingCheckout[];
  records: readonly CodexArtifactRecord[];
  retired: ReadonlyMap<string, Supersession>;
}): BranchLedger {
  return unionLedger({
    ledgers: qualified.map((checkout) => ({
      alwaysCount: false,
      ledger: ledgerForBranch({
        branch: head.branch,
        diffsNow: commitDiffsNow({
          baseRefs: reviewBaseRefs({ branch: head.branch, records, repoRoot: checkout.root }),
          commit: head.headSha,
          cwd: checkout.root,
        }),
        now: checkout.head,
        records,
        repoRoot: checkout.root,
        supersessions: retired,
      }),
    })),
  });
}

/**
 * Which eligible records have no Codex witness on the pass ledger, read across every checkout holding the head
 * commit that has a pass record on the branch — the only ones whose ledger this fold counts, since it passes
 * `alwaysCount: false` — and across every candidate only when none of those qualifies
 * (`./branchEvidenceRoots.ts`). No eligible record asks nothing, so a change no record covers is refused on its
 * rows rather than on a ledger it never needed.
 *
 * @param eligible the records that may cover a row, each needing its witness
 * @param candidates every checkout considered, of any repository, and the verb's own
 * @param scan the pass records, with how many could not be parsed
 * @returns each unwitnessed record by its path, or the reason the ledger could not be read
 */
async function unwitnessedOf({
  baseSha,
  candidates,
  eligible,
  head,
  home,
  root,
  scan,
  supersessions,
}: {
  baseSha: string;
  candidates: CandidateCheckoutRoots;
  eligible: readonly BumpRecord[];
  head: PullRequestHead;
  home: string;
  root: string;
  scan: LedgerScan;
  supersessions: SupersessionPort;
}): Promise<
  | Extract<BaselineBumpVerdict, { kind: "refused" }>
  | { readonly kind: "judged"; readonly byPath: ReadonlyMap<string, UnwitnessedManifest> }
> {
  if (eligible.length === 0) {
    return { byPath: new Map(), kind: "judged" };
  }
  if (scan.unreadable > 0) {
    return refused({
      detail: `${String(scan.unreadable)} pass record(s) could not be parsed, so a witness or a BROKEN review may be missing`,
    });
  }
  const { records } = scan;
  const retired = await supersessions.read({ home });
  if (retired.isErr()) {
    return refused({ detail: `could not read the supersession register: ${retired.error.message}` });
  }
  const qualified = relevantFirstQualifying({
    considered: candidates.roots,
    fallbackScan: undefined,
    head,
    ownRoot: candidates.ownRoot,
    records,
  });
  if (qualified.length === 0) {
    return refused({ detail: noQualifyingCheckoutReason({ considered: candidates.roots, head }) });
  }
  const ledger = qualifiedLedger({ head, qualified, records, retired: retired.value });
  const evidence = readBaselineBumpCarryEvidence({
    baseSha,
    headSha: head.headSha,
    manifests: eligible,
    records,
    root,
  });
  const unwitnessed = unwitnessedManifests({
    baseSha,
    entries: ledger.entries,
    evidence,
    manifests: eligible,
    records,
  });
  return { byPath: new Map(unwitnessed.map((one) => [one.path, one])), kind: "judged" };
}
