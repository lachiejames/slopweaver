# Why planning passes did not converge

Measured over every pass record in `$SLOPWEAVER_HOME/orchestration`. Reproduce before trusting
any number here — the population grows every time anyone runs a pass, and two records appeared mid-measurement
from another session.

**The headline: the planning arm's excess failure was not the model, and not concurrency. It was our own
tripwire aborting correct passes at about 30 seconds, on evidence that was not evidence.**

**No number [below](./codex-plan-convergence/measurement-and-tripwire.md) is a measurement of the current pin
(`gpt-5.6-sol` at `medium`, `src/codex/profiles.ts`).** The population was whatever each record ran on, and
the records do not name it. The MECHANISM the measurement found — a tripwire firing on absence of evidence —
is a property of our code and holds on any model; the rates, command-count distributions and bound
recommendations are observations of whatever pair ran then. Re-measure before quoting one as current: the
reproduction commands are in place throughout.

- [The measurement, and what it covers](./codex-plan-convergence/measurement-and-tripwire.md)
  - [Why the tripwire fired: three independent misreadings](./codex-plan-convergence/measurement-and-tripwire.md#why-the-tripwire-fired-three-independent-misreadings)
  - [What closes it](./codex-plan-convergence/measurement-and-tripwire.md#what-closes-it)
  - [Proof, against passes that actually failed this way](./codex-plan-convergence/measurement-and-tripwire.md#proof-against-passes-that-actually-failed-this-way)
- [The second failure mode: `no-conclusion-in-bound` loses everything](./codex-plan-convergence/lost-conclusion-and-review-defects.md)
  - [What closes it](./codex-plan-convergence/lost-conclusion-and-review-defects.md#what-closes-it)
  - [Proof, from a live pass that failed exactly this way](./codex-plan-convergence/lost-conclusion-and-review-defects.md#proof-from-a-live-pass-that-failed-exactly-this-way)
  - [Two defects in this change that the suite did not catch, and where each came from](./codex-plan-convergence/lost-conclusion-and-review-defects.md#two-defects-in-this-change-that-the-suite-did-not-catch-and-where-each-came-from)
- [Concurrency does not cause the failures — the correlation runs backwards](./codex-plan-convergence/concurrency-bounds-and-open-findings.md)
  - [§4 was right: "never raise the bound" was wrong for planning](./codex-plan-convergence/concurrency-bounds-and-open-findings.md#4-was-right-never-raise-the-bound-was-wrong-for-planning)
  - [Where the review loop stops](./codex-plan-convergence/concurrency-bounds-and-open-findings.md#where-the-review-loop-stops)
  - [Found and not fixed — triaged](./codex-plan-convergence/concurrency-bounds-and-open-findings.md#found-and-not-fixed--triaged)
