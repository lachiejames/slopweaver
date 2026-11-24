/**
 * How `dev lint` RUNS its plan: the concurrency, the per-gate ceiling, and the witness that concurrency
 * actually happened.
 *
 * Split out of `devLint.ts` along a real seam, not to please the file-size gate: that module decides WHICH
 * gates run (the plan, the lane, the `--only` selection, the verdict) and this one decides HOW they run.
 * The seam is also what keeps the pure half testable — `lintSchedule` and `concurrencyLine` take values and
 * answer values, while `runLintSegments` is the one effectful shell around them.
 *
 * The import edge runs one way at runtime: this module takes only TYPES from `devLint.ts`, so the two are
 * not a runtime cycle.
 *
 * ## Every gate is spawned under a CEILING, because a gate that waits forever is not a gate
 *
 * MEASURED: a `pre-push` lap sat inside `door-coverage` for 1h53m at 0% CPU with no output at
 * all, was killed, and passed on the very next run. Nothing in this repository was waiting — the wait is in
 * the `node` shim every one of these checks is spawned through. Reproduce the whole of it in two commands:
 *
 * ```bash
 * time node --version                    # ~3.4s at ~3% CPU — the shim, not node
 * time PROTO_OFFLINE=1 node --version    # ~0.14s — the same node, no network
 * PROTO_LOG=debug node --version         # names the 3s gap: warpgate::clients::oci
 * ```
 *
 * The shim resolves its WASM plugin from an OCI REGISTRY on every invocation, even though the plugin is
 * already on disk and the version is pinned by `.nvmrc`. MEASURED interleaved, five spawns each way, twice,
 * at load 13: 3,680 / 3,368 ms per spawn with the network and 139 / 136 ms without. That round-trip is
 * unbounded: a connection that establishes and then stalls — this machine routes through a VPN — blocks at
 * 0% CPU, produces no output, and never returns. It was `door-coverage` only because that is the gate the
 * stalled connection landed on; every gate in the plan is spawned exactly the same way.
 *
 * **That cause is NOT fixed here, deliberately.** The shim is on PATH from the operator's own dotfiles, not
 * from anything this repository declares, so removing the round-trip is a change to a machine rather than to
 * a gate, a decision of its own. What this runner owes regardless is that a
 * wait it cannot see the far end of must not be able to stop the lap:
 *
 * **{@link GATE_TIMEOUT_MS} bounds it.** Whatever happens to that particular round-trip, the next unbounded
 * wait will be in some other tool. A gate that has not exited inside the ceiling is killed and REPORTED BY
 * NAME ({@link gateHungLine}) instead of hanging the lap; the verdict is a FAILURE, so the gate fails closed;
 * and the run carries on, so one stuck gate cannot hide the findings of every gate after it.
 *
 * **The kill reaches the pid this runner spawned, and no further.** That is the right target for the wait
 * this closes: the shim `exec`s into node IN PLACE (watch one pid keep its number through
 * `ps -o pid,command` while `proto run node` becomes `node`), so the process that hangs and the process that
 * is killed are the same one, and at that point it has forked nothing. A gate killed AFTER it forked leaves
 * the grandchild running — observed while proving this fires, by dropping the ceiling to 1s and watching a
 * healthy `door-coverage` print its full report into the lap's stdout after the verdict line. That artifact
 * needs a ceiling BELOW a gate's normal runtime to happen at all, which 600s is not; a gate genuinely stuck
 * is stuck silently. Chasing the tree needs `detached: true` for a killable process group, which takes the
 * gates out of the terminal's foreground group and so breaks Ctrl-C on an interactive lap — a worse trade
 * than the artifact, so it was not made. Killing a group needs that flag whichever spawn is used.
 */
import { Worker } from "node:worker_threads";
import pLimit from "p-limit";
import type { LintCheck, LintCheckResult } from "./devLint.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/**
 * The per-gate wall-clock ceiling. A gate past it is killed and reported by name rather than waited on.
 *
 * The number is chosen against the measured plan, not guessed: MEASURED on `main`,
 * one `NODE_OPTIONS=--max-old-space-size=8192 yarn lint` ran the 65-gate full lane in 467.2s,
 * whose slowest single gate was `prettier` at 114.7s — so no gate is within an order of magnitude of ten
 * minutes. The ceiling is per GATE, so the pool width (`./gateCapacity.ts`) does not move it: a gate
 * sharing a runner with others is slower in wall time, and 114.7s has five and a half times the headroom that costs.
 * Re-measure with the same command, whose per-gate `(Ns)` timings {@link lintSummaryLine} prints. Ten
 * minutes is therefore never reached by a gate that is merely starved on a loaded machine, and is reached
 * almost immediately by one that is waiting on something that will never arrive: the wait this closes ran
 * 1h53m.
 */
export const GATE_TIMEOUT_MS = 600_000;

/**
 * The line a killed gate prints. It names the STAGE, because the failure it replaces named nothing at all:
 * a lap that stops printing after `dev lint: door-coverage` is indistinguishable from a lap still working,
 * and the session that hit this waited 1h53m to find out which.
 *
 * @param name the gate that was killed
 * @param timeoutMs the ceiling it exceeded
 * @returns the refusal line, without its trailing newline
 * @internal — {@link runDevLint} and this module's test.
 */
export function gateHungLine({ name, timeoutMs }: { name: string; timeoutMs: number }): string {
  return (
    `dev lint: ${name} HUNG — no exit after ${secondsLabel({ ms: timeoutMs })}, killed. ` +
    `It is waiting on something that will never arrive, not running slowly; re-run ` +
    `\`slopweaver dev lint --only ${name}\` to see it alone.`
  );
}

/**
 * Wall-clock milliseconds as a one-decimal seconds label — the unit every line in a lap reports in.
 *
 * @returns the label, e.g. `114.7s`
 * @internal — the summary, witness and ceiling lines here and in `devLint.ts`, plus this module's test.
 */
export function secondsLabel({ ms }: { ms: number }): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * One stretch of the plan that runs together: either a single {@link LintCheck.exclusive} gate on its own,
 * or a run of ordinary gates that may overlap up to the machine's pool width (`./gateCapacity.ts`).
 *
 * @internal — {@link lintSchedule}'s return shape, read by {@link runDevLint} and this module's test.
 */
export interface LintSegment {
  readonly exclusive: boolean;
  readonly checks: readonly LintCheck[];
}

/**
 * Order a resolved plan into the stretches that run: every exclusive gate alone FIRST, then ONE pool of the
 * rest, dispatched longest-first by what each gate took last time, then every {@link LintCheck.runsLast} gate
 * alone, in plan order. Pure.
 *
 * **Why exclusive first.** An exclusive gate is a barrier: nothing runs beside it. Left at its plan
 * position, it split the plan in two and the pool DRAINED twice — once before it, with seven slots idling
 * while the slowest gate of the first half finished, and once at the end. Run first, it costs its own
 * runtime and the pool drains once.
 *
 * **Why longest-first.** A pool dispatched in plan order starts a slow gate late whenever the plan lists
 * it late, and that gate then runs on alone at the end. Dispatching the longest gates first is the classic
 * longest-processing-time rule; the measure is each gate's OWN previous elapsed time ({@link
 * readGateSeconds}), recorded by the runner itself, so there is no estimate to keep true. A gate with no
 * record (new, or a cold machine) is dispatched first, because an unknown cost is the one that can sink the
 * tail; with no record at all this is plan order, exactly as before.
 *
 * MEASURED, simulated over the per-gate seconds a real lap printed (217.1s wall, 945.9s of
 * gate time at width 8): plan order with the barrier mid-plan 216.4s; exclusive first, plan order 193.3s;
 * exclusive first, longest-first 151.9s — the floor, its runtime plus the rest over eight slots. Ordered by
 * an EARLIER lap's seconds instead of the same lap's, 151.8s: a stale record orders as well as a fresh one.
 *
 * @param checks the gates this run will spawn, already narrowed by lane and `--only`, in plan order
 * @param priorSeconds each gate's previous elapsed seconds, by name; empty when nothing is recorded
 * @returns the segments in dispatch order; `[]` for an empty selection
 */
export function lintSchedule({
  checks,
  priorSeconds,
}: {
  checks: readonly LintCheck[];
  priorSeconds: ReadonlyMap<string, number>;
}): readonly LintSegment[] {
  // One read per gate, so every gate lands in exactly one of the three lists.
  const exclusive: LintCheck[] = [];
  const pooled: LintCheck[] = [];
  const last: LintCheck[] = [];
  for (const check of checks) {
    if (check.runsLast === true) {
      last.push(check);
    } else {
      (check.exclusive === true ? exclusive : pooled).push(check);
    }
  }
  // `toSorted` is stable, so gates of equal (or equally unknown) cost keep their plan order. A
  // comparison rather than a subtraction: two unknowns are two infinities, whose difference is NaN.
  const longestFirst = pooled.toSorted((a, b) => {
    const left = expectedSeconds({ name: a.name, priorSeconds });
    const right = expectedSeconds({ name: b.name, priorSeconds });
    if (left === right) {
      return 0;
    }
    return right > left ? 1 : -1;
  });
  const segments: LintSegment[] = exclusive.map((check) => ({ checks: [check], exclusive: true }));
  if (longestFirst.length > 0) {
    segments.push({ checks: longestFirst, exclusive: false });
  }
  for (const check of last) {
    segments.push({ checks: [check], exclusive: true });
  }
  return segments;
}

/**
 * One gate's dispatch weight: its recorded seconds, or infinity when none is recorded.
 *
 * @param name the gate
 * @param priorSeconds the previous run's seconds, by gate name
 * @returns the weight longest-first sorts on
 */
function expectedSeconds({ name, priorSeconds }: { name: string; priorSeconds: ReadonlyMap<string, number> }): number {
  const recorded = priorSeconds.get(name);
  if (recorded === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return recorded;
}

/**
 * The line that proves concurrency ACTUALLY happened, rather than the lap merely being faster.
 *
 * This is the witness, and it is arithmetic nothing can fake: the runner already records each gate's own
 * `elapsedMs`, and it knows its own wall time. Under the serial loop this replaced, those two were equal by
 * construction. A quiet machine, a warm cache or a gate that got cheaper all shorten the wall time
 * identically, so a faster lap is NOT evidence — the ratio is.
 *
 * It also makes a future regression visible forever: mark three gates {@link LintCheck.exclusive} and the
 * ratio falls, in the CI log, without anyone re-measuring anything.
 *
 * @param results every gate's outcome, whose `elapsedMs` sum is the serial cost
 * @param wallMs how long the whole lap actually took
 * @param concurrency the pool width this machine ran, which the ratio is read against
 * @returns the witness line, without its trailing newline
 * @internal — {@link runDevLint} and this module's test.
 */
export function concurrencyLine({
  concurrency,
  results,
  wallMs,
}: {
  concurrency: number;
  results: readonly LintCheckResult[];
  wallMs: number;
}): string {
  let gateMs = 0;
  for (const result of results) {
    // A gate with no timing contributes nothing rather than dropping the lap: the only shape that reaches
    // here without one is a result built by hand in a test.
    if (result.elapsedMs !== undefined) {
      gateMs += result.elapsedMs;
    }
  }
  const ratio = wallMs === 0 ? 0 : gateMs / wallMs;
  return (
    `dev lint: ${secondsLabel({ ms: gateMs })} of gate time in ${secondsLabel({ ms: wallMs })} of wall ` +
    `time — ${ratio.toFixed(2)}x, against 1.00x for a serial lap (ceiling ${String(concurrency)}x).`
  );
}

/**
 * Run every segment {@link lintSchedule} orders, overlapping within one and emitting each gate's output as it
 * is settled.
 *
 * Split from {@link runDevLint} for the body cap, and because this is where the whole trade of this runner
 * lives. **A gate is emitted once every gate dispatched BEFORE it has been emitted**, so output starts
 * flowing while the lap is still going rather than landing in one block at the end — which matters, because
 * a six-minute silence would be a worse experience than the streaming it replaces.
 *
 * @param checks the gates to spawn, in plan order
 * @param cwd the repository root every gate is spawned in
 * @param concurrency how many ordinary gates this machine runs at once (`./gateCapacity.ts`)
 * @param priorSeconds each gate's previous elapsed seconds, which orders the pool longest-first
 * @param withhold asked at the moment each gate would spawn: a reason refuses that one gate, which is then
 *   reported withheld and never run; `undefined` lets it run
 * @returns every gate's outcome, in PLAN order regardless of what was dispatched or finished when
 */
export async function runLintSegments({
  checks,
  concurrency,
  cwd,
  priorSeconds,
  withhold,
}: {
  checks: readonly LintCheck[];
  concurrency: number;
  cwd: string;
  priorSeconds: ReadonlyMap<string, number>;
  withhold: (gate: { check: LintCheck }) => string | undefined;
}): Promise<readonly LintCheckResult[]> {
  const settled = new Map<string, LintCheckResult>();
  for (const segment of lintSchedule({ checks, priorSeconds })) {
    const limit = pLimit(segment.exclusive ? 1 : concurrency);
    // Every gate in the segment STARTS here; the loop below then awaits them in dispatch order. Awaiting
    // each in turn is what makes emission incremental rather than one block per segment: a gate that
    // finished early waits for its predecessors and for nothing else. `withhold` is asked inside the
    // limiter, so it reads the machine's state when the gate's slot opens, not when the lane was planned.
    const pending = segment.checks.map((check) =>
      limit((): Promise<GateOutcome> => {
        const reason = withhold({ check });
        if (reason !== undefined) {
          return Promise.resolve(withheldOutcome({ check, reason }));
        }
        return runOneGate({ check, cwd });
      }),
    );
    for (const settling of pending) {
      const outcome = await settling;
      emitGate({ outcome });
      settled.set(outcome.result.name, outcome.result);
    }
  }
  // Plan order for the summary, so two laps' summaries line up gate for gate however their dispatch differed.
  return checks.map((check) => settled.get(check.name)!);
}

/** One finished gate: what to print for it, and what it decided. */
interface GateOutcome {
  readonly result: LintCheckResult;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The outcome of a gate the lane refused to spawn: never `ok`, carrying its reason, and the four-line refusal
 * naming it where its output would have been.
 *
 * @param check the gate withheld
 * @param reason why, as the lane's withhold answered
 * @returns the outcome to emit and settle like any other
 * @internal — {@link runLintSegments} and this module's test.
 */
export function withheldOutcome({ check, reason }: { check: LintCheck; reason: string }): GateOutcome {
  const refusal = lintGateRefusal({
    declaration: lintDeclarationFor({ id: "dev-lint-seat-step-withheld" }),
    detail: `${check.name}: ${reason}`,
  });
  return { result: { name: check.name, ok: false, withheld: reason }, stderr: `${refusal}\n`, stdout: "" };
}

/**
 * One finished gate's whole section as ONE string: its header, its stdout, its stderr, and the hung line when
 * the ceiling killed it. Pure.
 *
 * **One string, written to one stream, is the whole fix for a finding printed outside its own section.** The
 * section used to go out as a header on stdout and the gate's findings on stderr. Those are two pipes, and
 * nothing orders bytes ACROSS two pipes: `process.stdout.write` to a pipe queues whatever the 64 KiB pipe
 * buffer will not take (`./stdoutDataChannel.ts` measures that), while the next gate's stderr finds its own
 * pipe empty and goes straight out. A lap prints thousands of stdout lines (the hygiene report alone fills
 * the buffer), so on the hosted runner a failing gate's stderr overtook its own header and landed a dozen lines
 * early, under whichever earlier gate stdout was still draining — and its own section read empty. A terminal
 * never shows this, because a TTY write is synchronous.
 *
 * So a gate's stderr is replayed onto stdout, after its stdout, inside its own section. Nothing is lost by
 * that: the bytes are the gate's own, verbatim, and the lap's verdict is its exit code, never which stream a
 * line came out of.
 *
 * @param outcome the settled gate
 * @returns the section text, opening with a blank line and the `dev lint: <name>` header
 * @internal — {@link runLintSegments} and this module's test.
 */
export function gateSection({ outcome }: { outcome: GateOutcome }): string {
  const hung =
    outcome.result.hung === true ? `${gateHungLine({ name: outcome.result.name, timeoutMs: GATE_TIMEOUT_MS })}\n` : "";
  return `\ndev lint: ${outcome.result.name}\n${outcome.stdout}${outcome.stderr}${hung}`;
}

/**
 * Print one finished gate: its header, then its own bytes, in full, in ONE write to ONE stream.
 *
 * The contract this holds, now that nothing streams: every gate's stdout and stderr appear whole and
 * untruncated, gates appear in PLAN order rather than completion order, one gate's bytes are never
 * interleaved with another's, and the `dev lint: <name>` header precedes each gate's output — which
 * is what `subprocess/devLint/onlyFlagScope.test.ts` reads as its witness. {@link gateSection} says why one
 * stream is what keeps a finding under its own header.
 *
 * @param outcome the settled gate
 */
function emitGate({ outcome }: { outcome: GateOutcome }): void {
  process.stdout.write(gateSection({ outcome }));
}

/**
 * The message one {@link gateWorker} posts back: the gate's verdict and every byte it printed.
 *
 * Exported because the worker module is the other end of this contract and imports it — the two halves of
 * one wire have to name the same shape, or a field rename passes the typechecker on both sides separately.
 */
export interface GateReport {
  readonly elapsedMs: number;
  readonly hung: boolean;
  readonly ok: boolean;
  readonly stderr: string;
  readonly stdout: string;
}

/**
 * Where {@link runOneGate} loads the worker from — resolved off this module, in the tree this module was
 * itself loaded from.
 *
 * A hard-coded `.ts` sibling exists only in the source tree. MEASURED when the built CLI
 * landed: `slopweaver dev lint --only oxlint` run from `dist-cli/` died with
 * `Cannot find module .../dist-cli/devLint/gateWorker.ts`, because every gate loads through here and the
 * emitted sibling is `.js`.
 *
 * The source specifier stays a bare literal argument, which is the whole reason this is two constants
 * and a picker rather than one expression. `knip` recognises `new URL("./x.ts", import.meta.url)` as a
 * reference and the worker is reachable from nowhere else, so folding the choice INTO that call makes
 * the worker look dead and takes the shared {@link GateReport} contract down with it — measured, the
 * same day: `internal-exports` flagged `GateReport` the moment the literal stopped standing alone.
 */
const GATE_WORKER_SOURCE = new URL("./gateWorker.ts", import.meta.url);

/** The same worker in the emitted tree, where every module is `.js`. */
const GATE_WORKER_BUILT = new URL("./gateWorker.js", import.meta.url);

/** The worker beside THIS module: TypeScript under tsx, emitted JavaScript under the built CLI. */
function gateWorkerUrl(): URL {
  if (import.meta.url.endsWith(".ts")) {
    return GATE_WORKER_SOURCE;
  }
  return GATE_WORKER_BUILT;
}

/**
 * Run one gate under the ceiling, on a WORKER THREAD, capturing its output instead of inheriting the
 * terminal.
 *
 * **Why a worker rather than an async `spawn`, which is what concurrency normally reaches for.** The
 * `no-headless` gate bans importing or calling `spawn`/`exec`/`execFile`/`fork` anywhere in this tree, with
 * no allowlist and no exemption marker, and it caught the async draft of this function. That gate is rule 2
 * and it is not weakened here: its own doc states why the SYNC forms stay legal — "they block the caller, so
 * they cannot outlive the process that started them" — and that is exactly the property this shape keeps. A
 * worker runs ONE `spawnSync` and is joined before the lap returns, so no child outlives `dev lint`, the
 * per-gate ceiling is still `spawnSync`'s own `timeout` + SIGKILL, and nothing here starts a model. The
 * concurrency is threads waiting on blocking calls, which is the thing rule 2 has never been about.
 *
 * Capture is what concurrency costs: with several gates in flight, inherited stdio would interleave their
 * bytes into an unreadable lap, so the output is buffered here and replayed by {@link emitGate}.
 *
 * @param check the gate to run
 * @param cwd the repository root to run it in
 * @returns its outcome and its captured bytes; it never throws, because a failed run is a failed gate
 */
async function runOneGate({ check, cwd }: { check: LintCheck; cwd: string }): Promise<GateOutcome> {
  const startedAt = Date.now();
  const report = await new Promise<GateReport>((resolve) => {
    const worker = new Worker(gateWorkerUrl(), {
      execArgv: process.execArgv,
      workerData: { args: [...check.args], cmd: check.cmd, cwd, env: { ...check.env }, timeoutMs: GATE_TIMEOUT_MS },
    });
    let reported = false;
    worker.on("message", (message: GateReport) => {
      reported = true;
      resolve(message);
    });
    // A worker that never started is a failed gate, not a crashed runner: the lap CONTINUES past it, the
    // same no-short-circuit rule every other failure here follows.
    worker.on("error", (error: Error) => {
      reported = true;
      resolve({ elapsedMs: Date.now() - startedAt, hung: false, ok: false, stderr: `${error.message}\n`, stdout: "" });
    });
    // The backstop for a worker that goes away having posted NOTHING and raised nothing — killed from
    // outside, say. Without it the promise would wait forever, which is the one failure the serial loop
    // could not have: `spawnSync`'s own ceiling always bounded it.
    //
    // MEASURED on CI, and this is why it is guarded rather than a bare `resolve`. A first draft
    // resolved unconditionally here, reasoning that a second `resolve` is a no-op — and the `lint` job went
    // red on a tree that had just passed, because on a contended runner `exit` can be delivered before the
    // gate's own `message`, turning a clean gate into a failed one. The flag makes this arm fire only when
    // nothing was reported, and the deferral gives a message already in flight its turn first.
    worker.on("exit", (code: number) => {
      setImmediate(() => {
        if (reported) {
          return;
        }
        const note = `dev lint: the worker running this gate exited with code ${String(code)} and reported nothing\n`;
        resolve({ elapsedMs: Date.now() - startedAt, hung: false, ok: false, stderr: note, stdout: "" });
      });
    });
  });
  return {
    result: {
      elapsedMs: report.elapsedMs,
      name: check.name,
      ok: report.ok,
      ...(report.hung ? { hung: true as const } : {}),
      // A failed gate's bytes ride to the closing recap (`./lintVerdict.ts`), in the order its section prints them.
      ...(report.ok ? {} : { output: `${report.stdout}${report.stderr}` }),
    },
    stderr: report.stderr,
    stdout: report.stdout,
  };
}
