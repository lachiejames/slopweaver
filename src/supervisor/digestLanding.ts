/**
 * The tick digest's lists of what the tick can ACT on: the landing read's dispatchable pull requests and every
 * press and registration it made, and each turn waiting on the owner. Each count the digest prints is
 * followed by the rows it counts, so the chair never reads them out of `tick-<n>/` with `jq`.
 *
 * Split from `tickDigest.ts` to keep it under the file-size cap. Pure.
 */
import { absentAs } from "#lib/absent.js";

import {
  arrayField,
  capped,
  type DigestInputs,
  detail,
  field,
  jsonOf,
  named,
  numberField,
  stringField,
} from "./digestRead.js";
import { BUMP_DRIVE_READING_PREFIX, LANDING_DRAFTS_READING, LANDING_READING } from "./scratch/tickCapture.js";

/** A pull request as the landing read names it: `#<number> <repo>`. */
function pullRequest({ row }: { row: unknown }): string {
  const number = numberField({ key: "number", value: row });
  return `#${number === undefined ? "?" : String(number)} ${absentAs({ value: stringField({ key: "repoSlug", value: row }), whenAbsent: "(no repo)" })}`;
}

/**
 * One dispatchable row: its own `facts` line, which names the failing check, the approvers and the code owners
 * (`../cli/commands/github/landingFacts.ts`). A reading recorded before that field existed carries none, so it
 * still prints the act and its one sentence rather than nothing.
 */
function dispatchableLine({ row, prefix }: { row: unknown; prefix: string }): string {
  const facts = stringField({ key: "facts", value: row });
  if (facts !== undefined) {
    return `${prefix}: ${facts}`;
  }
  return (
    `${prefix}: ${pullRequest({ row })} ` +
    `${absentAs({ value: stringField({ key: "action", value: row }), whenAbsent: "(no action)" })} — ` +
    detail({ key: "actionDetail", value: row, whenAbsent: "(no detail)" })
  );
}

/**
 * Whether each landing read — the press read, then the drafts read — was due, and when it was, each pull request
 * it found dispatchable and each press and registration it made, a failed one with its reason.
 *
 * @returns per read, the summary line and the rows behind each of its counts, each list capped
 */
export function landingLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  return [LANDING_READING, LANDING_DRAFTS_READING].flatMap((name) => oneLandingLines({ inputs, name }));
}

/** One landing read's lines, each prefixed with the reading's own name so the two never read as one. */
function oneLandingLines({ inputs, name }: { inputs: DigestInputs; name: string }): readonly string[] {
  if (!inputs.readings.has(name)) {
    return [];
  }
  const read = jsonOf({ inputs, name });
  if ("line" in read) {
    return [read.line];
  }
  if (field({ key: "kind", value: read.value }) === "skipped") {
    return [`${name}: not due — next ${named({ key: "nextDueAtIso", value: read.value })}`];
  }
  const acts = [
    ...arrayField({ key: "presses", value: read.value }),
    ...arrayField({ key: "registrations", value: read.value }),
  ];
  const withOutcome = ({ outcome }: { outcome: string }): readonly unknown[] =>
    acts.filter((one) => field({ key: "outcome", value: one }) === outcome);
  const dispatchable = arrayField({ key: "dispatchable", value: read.value });
  const actLines = ["pressed", "registered", "failed"].flatMap((outcome) =>
    withOutcome({ outcome }).map((row) => {
      const reason =
        outcome === "failed" ? ` — ${detail({ key: "detail", value: row, whenAbsent: "(no detail)" })}` : "";
      return `${name} ${outcome}: ${pullRequest({ row })}${reason}`;
    }),
  );
  return [
    `${name}: read — ${String(dispatchable.length)} dispatchable, ` +
      `${String(withOutcome({ outcome: "pressed" }).length)} pressed, ` +
      `${String(withOutcome({ outcome: "registered" }).length)} registered, ` +
      `${String(withOutcome({ outcome: "failed" }).length)} failed`,
    ...capped({
      lines: dispatchable.map((row) => dispatchableLine({ prefix: name, row })),
      prefix: name,
    }),
    ...capped({ lines: actLines, prefix: `${name} acts` }),
  ];
}

/** The outcomes a `github bump-drive --json` document counts, in the order its line prints them. */
const BUMP_OUTCOMES = ["acted", "skipped", "failed"] as const;

/**
 * Each bump drive the tick took itself, beside the landing line: one count line per repository, then each failed
 * bump with its reason — a failed act is the one a later tick has to see. No line when the tick drove nothing.
 *
 * @returns one summary line per bump-drive reading, in capture order, then its failures, capped
 */
export function bumpDriveLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const names = [...inputs.readings.keys()].filter((name) => name.startsWith(BUMP_DRIVE_READING_PREFIX));
  return names.flatMap((name) => {
    const read = jsonOf({ inputs, name });
    if ("line" in read) {
      return [read.line];
    }
    const [first] = arrayField({ key: "repos", value: read.value });
    const repo = typeof first === "string" ? first : name;
    const outcomes = arrayField({ key: "outcomes", value: read.value });
    const counted = BUMP_OUTCOMES.map((outcome) => {
      const count = outcomes.filter((one) => field({ key: "outcome", value: one }) === outcome).length;
      return `${String(count)} ${outcome}`;
    });
    const failed = outcomes
      .filter((one) => field({ key: "outcome", value: one }) === "failed")
      .map(
        (one) =>
          `bump-drive failed: ${pullRequest({ row: one })} — ${detail({ key: "detail", value: one, whenAbsent: "(no detail)" })}`,
      );
    return [
      `bump-drive ${repo}: ${String(outcomes.length)} bump(s) — ${counted.join(", ")}`,
      ...capped({ lines: failed, prefix: "bump-drive failed" }),
    ];
  });
}

/**
 * How many turns wait on the owner, and what each one needs.
 *
 * @returns the count line, then one capped line per blocked turn
 */
export function blockedLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const blocked = jsonOf({ inputs, name: "blocked" });
  if ("line" in blocked) {
    return [blocked.line];
  }
  const rows: readonly unknown[] = Array.isArray(blocked.value) ? blocked.value : [];
  return [
    `blocked turns: ${String(rows.length)}`,
    ...capped({
      lines: rows.map(
        (row) =>
          `blocked: ${named({ key: "need", value: row })} — ${detail({ key: "what", value: row, whenAbsent: "(no what)" })}`,
      ),
      prefix: "blocked",
    }),
  ];
}
