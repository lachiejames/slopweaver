/**
 * The in-flight claim: what a live run is building RIGHT NOW, derived rather than declared.
 *
 * ## The defect this exists for
 *
 * Measured: four collisions in one night, one cause each time. Two independent pull requests
 * implementing the same connector fix. Three tickets in a private repository each given a minimal fix and then a
 * larger competing one. Two pull requests adding the same entry to the same five-name list. And a doc launched at
 * 04:18 for a scope another session had opened a pull request for at 04:26 — whose verbs were already visible in
 * the door ledger at 04:02.
 *
 * The board shows docs and their probes. The pull-request list shows work that has already surfaced. **A run that
 * is mid-flight in another terminal is invisible until its pull request appears**, and by then the duplicate is
 * written. In the fourth collision the evidence existed and was misread, so "read more carefully" is not the fix.
 *
 * ## The claim is DERIVED, never registered
 *
 * A live run already implies what it is about: its doc's `doneWhen:` probes name files, its `outputs:` name the
 * landing sites its author intends to write, and its journal records the branch it opened on. That is the claim.
 * There is deliberately no registry to maintain — this repo's whole thesis is that hand-maintained state rots, and
 * a claim nobody updates is worse than no claim at all.
 *
 * ### The claim is on the ARTIFACT, never on the doc
 *
 * The unit is the branch and the file paths — never the slug, and never the board entry. A run started under a
 * different filename for the same feature still claims the same files, which is exactly the shape three of the
 * four measured collisions took — two docs for one feature at different paths, two tickets given one fix under
 * different filenames.
 *
 * ## Ownership is re-verified on every check, because nothing is ever acquired
 *
 * There is no acquire step, no held resource and no stored claim: every call recomputes liveness and the writer
 * from the journal on disk. A stale claim cannot exist to be stolen, and no reader can act on an ownership fact
 * it did not just measure.
 *
 * ### Why `outputs:` counts here and deliberately does not in {@link ../handover/probe}
 *
 * `probe.ts` refuses to turn `outputs:` into `path:` probes, for a measured reason: a doc declaring an output that
 * already exists computed `landed` the instant it was written. That reason is about EXISTENCE. A claim asks a
 * different question — "does this doc intend to touch this file?" — and for that an author-named landing site is
 * the most direct evidence there is. Same field, two questions, two answers.
 *
 * ## Liveness is the process AND recent journal progress
 *
 * A claim that outlives its process is the next silent failure, so a run whose recorded session is gone holds
 * nothing. Where no session was ever recorded, journal freshness is the only evidence there is, and it is used
 * alone — with the reason stated, so a reader is never left to infer which of the two answered.
 *
 * ## This is a REPORT, not a gate
 *
 * A prior version of this module also refused a LAUNCH when a claim collided — `fleet up`'s own collision check,
 * run before an agent wrote a line. That refusal is gone along with the headless launcher it protected (see
 * AGENTS.md rule 2): there is no more launch here to refuse. What remains is the claim itself, rendered on
 * `fleet status`'s `claim` row, so a reader opening a second terminal can still see what a run in a first one is
 * already building — the same evidence, now informational rather than enforced.
 *
 * ## What is deliberately out of reach
 *
 * A claim is scoped to one `repo:`; two docs in different repositories are never compared, and a doc that
 * declares no repository can be compared with nothing. Both are reported rather than implied.
 *
 * Pure: the caller supplies the clock and the session probe. No filesystem, no subprocess, no `process`.
 */

import type { HandoverDoc } from "../handover/doc.js";
import type { ParsedLedger } from "../handover/ledger.js";
import { runStateOf } from "../handover/ledger.js";
import type { Probe } from "../handover/probe.js";
import { type RunWriter, writerOf } from "../handover/runOwner.js";
import { type DrivePhase, driveStateOf } from "./runState.js";
import type { Measured } from "./status.js";

/**
 * How long a claim survives with no journal progress behind it.
 *
 * Two hours, chosen from the measured turn length rather than from taste: a turn on this machine ran 20–50
 * minutes, so two hours of silence is well past any turn that is still genuinely working.
 *
 * **It applies even to a run whose process is alive**, and that is the deliberate half. The brief asked for the
 * process AND recent journal progress, and the reason to keep the AND is pid reuse: a machine that reboots leaves
 * a journal naming a pid that now belongs to something unrelated, and a claim resting on the process alone would
 * be held forever by a stranger. A gate nobody can get past without an environment variable is the haunting that
 * {@link ../handover/hookGate} spends its whole header avoiding.
 *
 * The cost, stated rather than hidden: a genuinely slow turn that runs longer than this bound loses its claim
 * while it is still working. That is a false negative in the direction this gate exists to prevent, and it is
 * accepted because the bound is what stops the opposite failure — a claim that outlives the run that made it.
 */
export const DEFAULT_CLAIM_STALE_MS = 2 * 60 * 60 * 1000;

/** Whether a claim still stands, always with the sentence saying which evidence decided it. */
export type ClaimLiveness =
  { readonly live: true; readonly why: string } | { readonly live: false; readonly why: string };

/** The paths one doc claims, and everything about the doc that the derivation could not see. */
export interface ClaimedPaths {
  /** Normalised, deduplicated and sorted, so two docs naming one file agree on its spelling. */
  readonly paths: readonly string[];
  /**
   * Every reason this claim under-covers the doc, one sentence each.
   *
   * Never empty-by-omission. A doc whose only probe is a `command:` one claims NOTHING, and a gate that printed
   * "no overlap" for it would be reporting ignorance as safety — which is the silent-failure class this codebase
   * keeps paying for.
   */
  readonly blind: readonly string[];
}

/** One live run's whole claim, with the session holding it. */
export interface RunClaim {
  readonly slug: string;
  /** The repository the claim is scoped to. Two claims in different repositories never collide. */
  readonly repo: string | undefined;
  /** The branch the run actually opened on, preferred over the doc's declared one. */
  readonly branch: string | undefined;
  readonly paths: readonly string[];
  readonly blind: readonly string[];
  readonly liveness: ClaimLiveness;
  /** The session driving it, when the journal names one. */
  readonly writer: RunWriter | undefined;
}

/** The edges a claim's liveness needs, injected so every rule here is testable without live agents. */
export interface LivenessSeams {
  /** The instant every age is computed against. */
  readonly nowMs: number;
  /** How long a claim survives with no journal progress. */
  readonly staleAfterMs: number;
  /**
   * Whether a SESSION is alive, or the reason that could not be established.
   *
   * Keyed on the session rather than on a recorded pid: the pid on a journal line belongs to whichever
   * process wrote it, so asking it made every live claim expire. An UNKNOWN answer keeps the claim standing —
   * see the module header on why ambiguity blocks here.
   */
  readonly sessionLive: (args: { sessionId: string }) => Measured<boolean>;
}

/** A URL is a landing site nothing on this machine can collide with. */
const URL_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Repeated separators, collapsed so `src//fleet` and `src/fleet` are one claim rather than two. */
const REPEATED_SLASH = /\/{2,}/g;

/** A leading `./`, however many times an author wrote it. */
const LEADING_DOT_SLASH = /^(?:\.\/)+/;

/** The path a probe names, or `undefined` for one that names none. */
function targetOf({ probe }: { probe: Probe }): string | undefined {
  if (probe.kind === "present" || probe.kind === "absent") {
    return probe.file;
  }
  return probe.kind === "path" ? probe.path : undefined;
}

/**
 * One path in the single spelling every comparison uses, or `undefined` when it has no usable one.
 *
 * `..` is refused rather than resolved. Resolving it needs a base directory this module deliberately does not
 * have, and guessing one would make a claim point at a file nobody named — so it is reported as a gap instead,
 * which is visible.
 */
function normalisePath({ path }: { path: string }): string | undefined {
  const trimmed = path.trim();
  if (trimmed.length === 0 || URL_PREFIX.test(trimmed)) {
    return undefined;
  }
  const collapsed = trimmed.replaceAll("\\", "/").replace(REPEATED_SLASH, "/").replace(LEADING_DOT_SLASH, "");
  const trailed = collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
  if (trailed.length === 0 || trailed.split("/").includes("..")) {
    return undefined;
  }
  return trailed;
}

/** Add one raw path to the claim, or say why it could not be added. */
function absorb({
  raw,
  origin,
  paths,
  blind,
}: {
  raw: string;
  origin: string;
  paths: Set<string>;
  blind: string[];
}): void {
  const normalised = normalisePath({ path: raw });
  if (normalised === undefined) {
    blind.push(`${origin} names \`${raw}\`, which is not a path this machine can compare`);
    return;
  }
  paths.add(normalised);
}

/**
 * The file set one doc claims, from its `doneWhen:` targets and its declared `outputs:`.
 *
 * @param doc the orchestration doc
 * @returns the normalised paths plus a sentence per part of the doc the derivation could not see
 */
export function claimedPaths({ doc }: { doc: HandoverDoc }): ClaimedPaths {
  const paths = new Set<string>();
  const blind: string[] = [];
  doc.doneWhen.forEach((probe, index) => {
    const raw = targetOf({ probe });
    if (raw === undefined) {
      blind.push(`doneWhen[${String(index)}] is a \`command:\` probe, so it names no path to claim`);
      return;
    }
    absorb({ blind, origin: `doneWhen[${String(index)}]`, paths, raw });
  });
  doc.outputs.forEach((output, index) => {
    absorb({ blind, origin: `outputs[${String(index)}]`, paths, raw: output });
  });
  if (paths.size === 0) {
    blind.push("this doc claims no path at all, so an overlap with it cannot be computed");
  }
  return { blind, paths: [...paths].toSorted((a, b) => a.localeCompare(b)) };
}

/** An age in whole minutes, for a sentence a reader acts on. */
function minutesOf({ ms }: { ms: number }): string {
  return String(Math.round(ms / 60_000));
}

/**
 * Whether a run's claim still stands.
 *
 * The order is the point, and every branch names the evidence that decided it: a closed run holds nothing, an
 * ended drive holds nothing, a session PROVEN gone holds nothing, and a journal that has not moved within the
 * drive's own bound holds nothing. Only then is a claim live.
 *
 * A liveness that could not be established does NOT expire the claim — it falls through to the journal's own
 * freshness. Expiring on "could not look" would hand a live run's files to a second agent.
 *
 * @param phase the run's derived phase, with "never started" kept apart from "closed"
 * @param ended whether a `drive-ended` is still in force
 * @param sessionId the session the journal recorded as driving this run, when it recorded one
 * @param lastEventIso when the journal last moved
 * @param ambiguous whether the journal carried lines nothing could decode
 * @param seams the clock, the staleness bound and the session probe
 * @returns whether the claim stands, and the sentence saying why
 */
export function claimLiveness({
  phase,
  ended,
  sessionId,
  lastEventIso,
  ambiguous,
  seams,
}: {
  phase: DrivePhase;
  ended: boolean;
  sessionId: string | undefined;
  lastEventIso: string | undefined;
  ambiguous: boolean;
  seams: LivenessSeams;
}): ClaimLiveness {
  if (phase === "no-run") {
    return { live: false, why: "no run has ever started for this doc" };
  }
  if (phase === "closed") {
    return { live: false, why: "the run is closed" };
  }
  if (ended) {
    return { live: false, why: "the drive has ended, so no agent is building this" };
  }
  if (sessionId !== undefined) {
    const live = seams.sessionLive({ sessionId });
    // An UNKNOWN liveness does NOT expire the claim: it falls through to the journal's own freshness, which
    // can still say the run has stopped moving. Expiring on "could not look" would hand a live run's files
    // to a second agent on the strength of an unreadable registry.
    if (live.known && !live.value) {
      return { live: false, why: `session ${sessionId} is not running, so the claim expired with it` };
    }
  }
  return freshness({ ambiguous, lastEventIso, phase, seams, sessionId });
}

/** The second half of {@link claimLiveness}: what the journal's own age says once the process has been asked. */
function freshness({
  phase,
  sessionId,
  lastEventIso,
  ambiguous,
  seams,
}: {
  phase: DrivePhase;
  sessionId: string | undefined;
  lastEventIso: string | undefined;
  ambiguous: boolean;
  seams: LivenessSeams;
}): ClaimLiveness {
  const at = lastEventIso === undefined ? Number.NaN : Date.parse(lastEventIso);
  if (!Number.isFinite(at)) {
    // The run is open and the journal cannot say when it last moved. The claim STANDS — see the module header on
    // why ambiguity blocks here — and the reason is printed so nobody mistakes it for a measurement.
    return { live: true, why: "the run is open, but its journal carries no readable timestamp to age it against" };
  }
  const ageMs = seams.nowMs - at;
  if (ageMs > seams.staleAfterMs) {
    return {
      live: false,
      why:
        `the journal has not moved for ${minutesOf({ ms: ageMs })}m, past the ` +
        `${minutesOf({ ms: seams.staleAfterMs })}m a drive runs for`,
    };
  }
  const held = phase === "waiting-on-owner" ? "waiting on the owner" : "open";
  const evidence =
    sessionId === undefined
      ? "no session was recorded, so this rests on journal freshness alone"
      : `session ${sessionId} was not proven gone`;
  const doubt = ambiguous ? "; its journal has lines this build cannot decode, so it may have moved further" : "";
  return { live: true, why: `${held}, last moved ${minutesOf({ ms: ageMs })}m ago — ${evidence}${doubt}` };
}

/**
 * One doc's claim, folding its journal, its drive and its declared paths together.
 *
 * Takes the journal rather than reading it, so a caller that has already read one — the pane measures every
 * workstream's journal anyway — does not read it a second time and risk describing two different moments.
 *
 * @param doc the orchestration doc
 * @param journal its parsed run journal, or `undefined` when it could not be read at all
 * @param seams the clock, the staleness bound and the process probe
 * @returns the claim, live or expired, always with the reason
 */
export function runClaimFor({
  doc,
  journal,
  seams,
}: {
  doc: HandoverDoc;
  journal: ParsedLedger | undefined;
  seams: LivenessSeams;
}): RunClaim {
  const claimed = claimedPaths({ doc });
  if (journal === undefined) {
    return {
      blind: [...claimed.blind, "its run journal could not be read, so this claim is held on the doc alone"],
      branch: doc.branch,
      liveness: { live: true, why: "its run journal could not be read, so nothing proved the claim expired" },
      paths: claimed.paths,
      repo: doc.repo,
      slug: doc.slug,
      // No journal, so nothing names a writer. Left undefined rather than guessed at: a refusal that cannot say
      // WHO holds a run is still a useful refusal, and an invented holder is not.
      writer: undefined,
    };
  }
  const run = runStateOf({ events: journal.events });
  const { branch = doc.branch } = run;
  const drive = driveStateOf({ events: journal.events });
  const ambiguous = journal.unreadable.length > 0;
  return {
    blind: ambiguous
      ? [
          ...claimed.blind,
          `its journal has ${String(journal.unreadable.length)} line(s) this build cannot decode ` +
            `(line ${journal.unreadable.join(", ")}) — an unknown kind hides whatever it recorded`,
        ]
      : claimed.blind,
    branch,
    liveness: claimLiveness({
      ambiguous,
      ended: drive.ended,
      lastEventIso: run.lastIso,
      phase: journal.events.length === 0 ? "no-run" : run.phase,
      seams,
      sessionId: drive.sessionId,
    }),
    paths: claimed.paths,
    repo: doc.repo,
    slug: doc.slug,
    writer: writerOf({ events: journal.events }),
  };
}

/**
 * One claim as the pane and the session brief print it.
 *
 * The gaps are printed alongside the paths, never instead of them: a claim covering three files out of a doc that
 * also runs a `command:` probe is a partial claim, and a line that showed only the three would read as complete.
 *
 * @param claim the claim to render
 * @returns one line, always stating both what is claimed and what was not seen
 */
export function renderClaim({ claim }: { claim: RunClaim }): string {
  const paths = claim.paths.length === 0 ? "nothing" : claim.paths.join(", ");
  const gaps = claim.blind.length === 0 ? "" : ` · ${String(claim.blind.length)} gap(s): ${claim.blind.join("; ")}`;
  return `${claim.liveness.live ? "LIVE" : "expired"} — ${claim.liveness.why}\n              claims ${paths}${gaps}`;
}
