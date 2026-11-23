/**
 * The tick-open digest's lines for a FIRED monitor pass: the reading's state and every action the pass took, so a
 * lane that went blind, or a card or note that was refused, is a line the chair reads rather than a `refused` action
 * left inside a JSON file. `monitor check` exits zero on a refused action, so the capture alone calls that child
 * complete.
 *
 * Pure — documents in, lines out.
 */
import { arrayField, capped, type DigestInputs, field, jsonOf, named, stringField } from "./digestRead.js";

/**
 * One fired monitor's verdict line, then every refused action, then the actions that worked, capped.
 *
 * @param inputs the tick's readings
 * @param name the reading the pass was captured as, a `monitor check --json` document
 * @param monitorId the monitor whose reading is judged
 * @param label what each line opens with
 * @param firing the word a firing reading reads as
 * @returns the verdict's line, then the actions
 */
export function monitorPassLines({
  inputs,
  name,
  monitorId,
  label,
  firing,
}: {
  inputs: DigestInputs;
  name: string;
  monitorId: string;
  label: string;
  firing: string;
}): readonly string[] {
  const read = jsonOf({ inputs, name });
  if ("line" in read) {
    return [read.line];
  }
  const reading = arrayField({ key: "readings", value: read.value }).find(
    (one) => stringField({ key: "monitorId", value: one }) === monitorId,
  );
  const state = stringField({ key: "state", value: reading });
  let verdict = `${label}: ${String(state)}`;
  if (state === undefined) {
    verdict = `${label}: the pass returned no ${monitorId} reading`;
  } else if (state === "firing") {
    const labels = arrayField({ key: "subjects", value: reading }).map((one) => named({ key: "label", value: one }));
    verdict = `${label}: ${firing} — ${labels.join("; ")}`;
  } else if (state === "unmeasurable") {
    verdict = `${label}: UNMEASURABLE — ${named({ key: "because", value: reading })}`;
  }
  const actions = arrayField({ key: "actions", value: read.value });
  const line = (one: unknown): string =>
    `${label}: ${named({ key: "kind", value: one })} ${named({ key: "stepId", value: one })} — ` +
    named({ key: "detail", value: one });
  // A refusal is never cut: it is the line this digest exists to carry. Only the
  // actions that worked are capped.
  const refused = actions.filter((one) => stringField({ key: "kind", value: one }) === "refused").map(line);
  const worked = actions.filter((one) => stringField({ key: "kind", value: one }) !== "refused").map(line);
  return [verdict, ...refused, ...capped({ lines: worked, prefix: label })];
}

/**
 * The organisation-health lane: how the incident read ended, then what the fired pass judged and did. A read that
 * failed, was killed or found another under way is its unavailable line; the pass's own refusals follow it.
 *
 * After a read that failed or was never captured, the verdict line is always unmeasurable, whatever the pass said or whether it ran at
 * all, naming what it said. The pass judged a snapshot this tick could not refresh, and a read can fail to mark or
 * remove the old one, so nothing on disk need say it is stale.
 *
 * @param inputs the tick's readings, whose `org-health-read` is `org-health read --json` and `org-health` the pass
 * @returns the read's line, the verdict's line, and one line per action
 */
export function orgHealthLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const read = jsonOf({ inputs, name: "org-health-read" });
  const pass = monitorPassLines({
    firing: "FIRING",
    inputs,
    label: ORG_HEALTH_LABEL,
    monitorId: "org-health",
    name: "org-health",
  });
  if (!("line" in read)) {
    const kept = arrayField({ key: "incidents", value: field({ key: "snapshot", value: read.value }) });
    return [`org-health-read: read whole — ${String(kept.length)} incident(s) open or recently resolved`, ...pass];
  }
  const [verdict, ...actions] = pass;
  if (verdict!.startsWith(`${ORG_HEALTH_LABEL}: UNMEASURABLE`)) {
    return [read.line, ...pass];
  }
  return [
    read.line,
    `${ORG_HEALTH_LABEL}: UNMEASURABLE — this tick's incident read did not complete, so the pass's "${verdict!}" is not now's`,
    ...actions,
  ];
}

/**
 * The recheck pass (`../cli/commands/hand/recheck.ts`): which steps it retired because their precondition already
 * held, and which it could not read — each by id with what the read saw, so a card that left the owner's queue is a line the
 * chair can name rather than a count. A still-needed step is the quiet case and only counted.
 *
 * @param inputs the tick's readings, whose `hand-recheck` is `hand recheck --json`
 * @returns the count line, then one line per retired step, then one per unread step
 */
export function handRecheckLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const read = jsonOf({ inputs, name: "hand-recheck" });
  if ("line" in read) {
    return [read.line];
  }
  const lines = ({ key }: { key: string }): readonly string[] =>
    arrayField({ key, value: read.value }).map(
      (one) => `hand recheck: ${key} ${named({ key: "id", value: one })} — ${named({ key: "because", value: one })}`,
    );
  const retired = lines({ key: "retired" });
  const unread = lines({ key: "unread" });
  const unmet = arrayField({ key: "unmet", value: read.value }).length;
  return [
    `hand recheck: ${String(retired.length)} retired, ${String(unmet)} still needed, ${String(unread.length)} unread`,
    ...capped({ lines: retired, prefix: "hand recheck retired" }),
    ...capped({ lines: unread, prefix: "hand recheck unread" }),
  ];
}

/** What every org-health pass line opens with. */
const ORG_HEALTH_LABEL = "org health";
