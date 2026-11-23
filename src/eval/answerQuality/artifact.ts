/**
 * The redacted per-case artifact — the self-test's own output made readable by a reviewer who may not see the
 * goldens it ran over.
 *
 * ## Why this file exists
 *
 * A pull request that merges at silver owes gold, and this one's debt was the ten-golden run's per-case output
 * read by a reviewer. The block was real: the ten goldens carry sensitive context and live at
 * `$SLOPWEAVER_HOME/eval/answer-quality-cases.json`, outside git, so the local sample at
 * `$SLOPWEAVER_HOME/eval/answer-quality-sample.md` cannot be committed and a reviewer had only a
 * `69 passed, 0 failed` counter to take on trust. The redaction shape is obvious in a
 * line if it is obvious at all: **synthetic labels and numbers only — never an expectation label, an
 * attribution source, a certainty phrase, or any golden text.**
 *
 * ## Every string published here is generated HERE, and that is the whole redaction
 *
 * {@link RedactedOutcome} is the only thing {@link renderPerCaseArtifact} can read, and each of its fields is
 * either a closed union the compiler owns, a number, or a label this file MINTED. Nothing filters prose,
 * because nothing publishable ever holds any: a scan over rendered bytes has no pattern for "this English
 * sentence is a caveat mined from a sensitive thread", so a denylist design would have published the leak that
 * actually existed.
 *
 * **An id the OPERATOR authored is never published either, and a shape guard is why that has to be so.** A
 * guard over `caseId` and a degradation target's `expectationId` — lowercase, hyphen-joined, length-capped —
 * cannot separate an id naming a case from an id naming the case's sensitive CONTENT:
 * `no-second-scan-was-ordered` passes every one of those checks. Ids get named after what they test, so that
 * is an ordinary authoring habit rather than a stretch. This file therefore mints `case-1`, `case-2` and a
 * per-case `e1`, `e2` in first-appearance order — the same thing `slopweaver turn freeze` does to every
 * provider id it keeps — and {@link buildPerCaseArtifact} returns the mapping SEPARATELY so the verb can
 * print it to the operator's terminal while the committed file carries only the synthetics.
 *
 * Expectation labels are scoped to their case on purpose: the real case file reuses `v1` and `k1` across all
 * ten goldens, so one global numbering would collide on ids that mean different things per case.
 *
 * ## The provenance is a content ADDRESS, and the artifact says what CI cannot prove
 *
 * A run over the real cases file cannot be reproduced in CI, because that file is not in git. So the artifact
 * carries the sha256 and byte length of the input it was built from, never the input and never its absolute
 * path — a reviewer can tell whether it still describes the file the operator holds, and a re-run over a
 * changed file announces itself. That is detection, not prevention, and the rendered artifact says so in its
 * own words rather than leaving a reader to assume a gate is watching.
 */

import type { DegradationKind } from "./degrade.js";
import type { QualityBand } from "./score.js";
import type { MetricName, PropertyFamily, RedactedMetric } from "./selftest.js";

/** The five families, in the order the self-test runs them, so a rendered column order is not a guess. */
export const PROPERTY_FAMILIES: readonly PropertyFamily[] = [
  "verbatim-golden-scores-top",
  "paraphrase-is-measurably-a-paraphrase",
  "paraphrase-scores-top",
  "anchors-are-droppable",
  "degrades-down",
];

/**
 * The half of a self-test outcome this file is allowed to read.
 *
 * Deliberately narrower than `PropertyOutcome`, which also carries `property` and `detail` — prose that may
 * quote the golden. A `PropertyOutcome` satisfies this structurally, so the verb passes its run straight in
 * while the body here cannot reach either prose field even by accident.
 */
export interface PublishableFacts {
  readonly caseId: string;
  readonly state: "pass" | "fail" | "skip";
  readonly redacted: {
    readonly family: PropertyFamily;
    readonly target?: { readonly kind: DegradationKind; readonly expectationId: string } | undefined;
    readonly band?: QualityBand | undefined;
    readonly metrics: readonly RedactedMetric[];
  };
}

/**
 * One property's outcome, holding only closed-union members, numbers and labels minted in this file.
 *
 * @internal — the element type of {@link PerCaseArtifact.outcomes}; nothing outside this file names it.
 */
export interface RedactedOutcome {
  readonly caseLabel: string;
  readonly state: "pass" | "fail" | "skip";
  readonly family: PropertyFamily;
  readonly kind: DegradationKind | undefined;
  readonly targetLabel: string | undefined;
  readonly band: QualityBand | undefined;
  readonly metrics: readonly RedactedMetric[];
}

/**
 * One minted label and the operator-authored id it stands for.
 *
 * The verb prints these; the artifact never carries them. An expectation's `published` is scoped by its case
 * (`case-1/e2`), because the same source id means different things under different cases.
 *
 * @internal — the element type of {@link ArtifactBuild.mappings}; nothing outside this file names it.
 */
export interface LabelMapping {
  readonly of: "case" | "expectation";
  readonly published: string;
  readonly source: string;
}

/** Where the artifact's numbers came from, as a content address rather than as a path. */
export interface ArtifactProvenance {
  readonly casesSha256: string;
  readonly casesBytes: number;
  readonly caseCount: number;
}

/** The whole artifact: what ran, over what, and how each case's properties came out. */
export interface PerCaseArtifact {
  readonly provenance: ArtifactProvenance;
  readonly outcomes: readonly RedactedOutcome[];
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

/** The publishable artifact, plus the label mapping that stays out of it. */
export interface ArtifactBuild {
  readonly artifact: PerCaseArtifact;
  readonly mappings: readonly LabelMapping[];
}

/** A first-appearance-ordered label minter: same source id in, same label out. */
function minter({ prefix }: { prefix: string }): {
  label: ({ source }: { source: string }) => string;
  minted: () => readonly { readonly published: string; readonly source: string }[];
} {
  const seen = new Map<string, string>();
  return {
    label: ({ source }) => {
      const existing = seen.get(source);
      if (existing !== undefined) {
        return existing;
      }
      const fresh = `${prefix}${String(seen.size + 1)}`;
      seen.set(source, fresh);
      return fresh;
    },
    minted: () => [...seen].map(([source, published]) => ({ published, source })),
  };
}

/**
 * Project a self-test run into a publishable artifact, minting every label it prints.
 *
 * It cannot fail, and that is the design rather than an omission: no id the operator authored is published at
 * all, so there is nothing for it to refuse and no judgement for a caller to get wrong. A `Result` here would
 * have to carry a shape guard over authored ids, and a shape guard cannot tell an id naming a case from an id
 * naming the case's sensitive content.
 *
 * @param outcomes the whole self-test run, in case order
 * @param provenance the content address of the case file the run read
 * @returns the artifact, and the mapping from each minted label back to the id it stands for
 */
export function buildPerCaseArtifact({
  outcomes,
  provenance,
}: {
  outcomes: readonly PublishableFacts[];
  provenance: ArtifactProvenance;
}): ArtifactBuild {
  const cases = minter({ prefix: "case-" });
  const expectations = new Map<string, ReturnType<typeof minter>>();
  const mappings: LabelMapping[] = [];
  const redacted = outcomes.map((outcome): RedactedOutcome => {
    const caseLabel = cases.label({ source: outcome.caseId });
    const { target } = outcome.redacted;
    if (target === undefined) {
      return {
        band: outcome.redacted.band,
        caseLabel,
        family: outcome.redacted.family,
        kind: undefined,
        metrics: outcome.redacted.metrics,
        state: outcome.state,
        targetLabel: undefined,
      };
    }
    let scoped = expectations.get(caseLabel);
    if (scoped === undefined) {
      scoped = minter({ prefix: "e" });
      expectations.set(caseLabel, scoped);
    }
    return {
      band: outcome.redacted.band,
      caseLabel,
      family: outcome.redacted.family,
      kind: target.kind,
      metrics: outcome.redacted.metrics,
      state: outcome.state,
      targetLabel: scoped.label({ source: target.expectationId }),
    };
  });
  for (const { published, source } of cases.minted()) {
    mappings.push({ of: "case", published, source });
  }
  for (const [caseLabel, scoped] of expectations) {
    for (const { published, source } of scoped.minted()) {
      mappings.push({ of: "expectation", published: `${caseLabel}/${published}`, source });
    }
  }
  return {
    artifact: {
      failed: redacted.filter((outcome) => outcome.state === "fail").length,
      outcomes: redacted,
      passed: redacted.filter((outcome) => outcome.state === "pass").length,
      provenance,
      skipped: redacted.filter((outcome) => outcome.state === "skip").length,
    },
    mappings,
  };
}

/**
 * The first of several metrics the property actually reported.
 *
 * The two score-bearing columns mean different things per family — a graded mean for most, a token overlap for
 * the paraphrase property — and a row renders whichever one is there. Written as a find over a preference
 * order rather than as a `??` chain, which `.claude/rules/typescript-patterns.md` bans outright.
 */
function firstMetric({
  metrics,
  names,
}: {
  metrics: readonly RedactedMetric[];
  names: readonly MetricName[];
}): number | undefined {
  for (const name of names) {
    const found = metrics.find((entry) => entry.name === name);
    if (found !== undefined) {
      return found.value;
    }
  }
  return undefined;
}

/** A number rendered to three places, or an em dash when the property reports none. */
function cell({ value }: { value: number | undefined }): string {
  if (value === undefined) {
    return "—";
  }
  return value.toFixed(3);
}

/** The property column for one outcome — the family, plus which expectation a degradation targeted. */
function propertyCell({ outcome }: { outcome: RedactedOutcome }): string {
  const { kind, targetLabel } = outcome;
  if (kind === undefined || targetLabel === undefined) {
    return outcome.family;
  }
  return `${outcome.family} · ${kind} · ${targetLabel}`;
}

/** The band column, or an em dash for a property that grades nothing. */
function bandCell({ outcome }: { outcome: RedactedOutcome }): string {
  const { band } = outcome;
  if (band === undefined) {
    return "—";
  }
  return band.toUpperCase();
}

/** One markdown table row per outcome. */
function outcomeRow({ outcome }: { outcome: RedactedOutcome }): string {
  const { metrics } = outcome;
  const score = firstMetric({ metrics, names: ["score", "token-overlap"] });
  const against = firstMetric({ metrics, names: ["golden-score", "overlap-bound"] });
  const cells = [
    outcome.caseLabel,
    propertyCell({ outcome }),
    outcome.state.toUpperCase(),
    bandCell({ outcome }),
    cell({ value: score }),
    cell({ value: against }),
  ];
  return `| ${cells.join(" | ")} |`;
}

/**
 * Render the artifact as the markdown a reviewer reads.
 *
 * @param artifact the projected run
 * @returns the lines, provenance first, then one table row per property per case
 */
export function renderPerCaseArtifact({ artifact }: { artifact: PerCaseArtifact }): readonly string[] {
  const { provenance: p } = artifact;
  return [
    "# answer-quality — the per-case self-test output, redacted",
    "",
    "This is the evidence behind the scorer's gold claim: the ordering properties that prove",
    "the scorer does not reward token overlap, shown per case rather than summarised into a counter. Every",
    "string in the table below is either a closed union this repository declares or a label",
    "`src/eval/answerQuality/artifact.ts` minted itself, so no golden text, expectation label, attribution",
    "source, invented-certainty phrase — or even an id the case file authored — can reach it.",
    "",
    "`case-1` and a case's `e1` are assigned in first-appearance order, and the verb prints what each one",
    "stands for when it writes this file. That mapping is the operator's to read and is deliberately not here:",
    "an id is usually named after what it tests, so publishing one leaks the thing this artifact redacts.",
    "",
    "## Provenance",
    "",
    `- input: the operator's own case file, sha256 \`${p.casesSha256}\`, ${String(p.casesBytes)} bytes`,
    `- cases: ${String(p.caseCount)}`,
    `- outcomes: **${String(artifact.passed)} passed, ${String(artifact.failed)} failed, ${String(artifact.skipped)} skipped**`,
    "",
    "**Nothing in CI can re-derive this table**, because its input is not in git — that is the partition, not an",
    "oversight. The sha256 is the whole mitigation: it makes a stale artifact detectable rather than impossible.",
    "Re-cut it, and compare the digest to the file you hold, with:",
    "",
    "```bash",
    "slopweaver dev answer-quality --cases $SLOPWEAVER_HOME/eval/answer-quality-cases.json \\",
    "  --selftest --artifact eval/answer-quality-per-case.artifact.md",
    "```",
    "",
    "## How to read a row",
    "",
    "`score` is the graded mean and `against` is what it had to beat — the golden's own score for a",
    "`degrades-down` row, the overlap bound for the paraphrase row. A `degrades-down` row passes only when its",
    "score is STRICTLY below the golden's, and a `certainty-invented` one additionally only when its band is",
    "capped at DEGRADED or worse. Those two columns are therefore the claim itself, not decoration: read down",
    "them and the ordering is either there or it is not.",
    "",
    "| case | property | state | band | score | against |",
    "| --- | --- | --- | --- | --- | --- |",
    ...artifact.outcomes.map((outcome) => outcomeRow({ outcome })),
    "",
  ];
}
