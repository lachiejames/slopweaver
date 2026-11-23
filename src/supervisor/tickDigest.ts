/**
 * What `supervisor tick open` prints after the capture: one line per reading the chair acts on, read out of
 * the documents the readings wrote, so the chair never pipes a reading through `jq` to learn what it said.
 *
 * The chair's pass 618 read eleven of these by hand — `jq -r .headline reconcile.json`, `grep REACT
 * gauge.txt`, `head -1 hold.txt` and so on — and each one was a place a missing file read as a quiet fleet.
 * Here a reading that did not complete is a line that SAYS so, with how its child ended; absence never
 * becomes a derived fact.
 *
 * The digest then named only counts, and the chair went on reading the rows behind them by hand: of its 140
 * Bash calls after its first `tick open`, the capacity culprit and boots, the seats the
 * watch report does not call working, the head of the ready list, the dispatchable pull requests, the event
 * tail's alerts, the deep seats and the closed rows were each pulled out with `jq`/`grep` again. The owner's
 * raw-bash ruling was sent with a screenshot of one of those 600-character lines. So each is a list here,
 * capped at eight with the rest counted. Reproduce the tally over a chair's transcript directory
 * with `~/.slopweaver/pages/raw-bash-gate-design/chair2.mts <dir>` run by `node_modules/.bin/tsx` from a
 * checkout.
 *
 * Every accessor reads a parsed document defensively and never throws: a producer that changed its shape
 * yields a line naming the field it could not find, not a crashed open.
 *
 * Pure — documents in, lines out.
 */
import { absentAs } from "#lib/absent.js";

import { CHAIR_LINE_PREFIX } from "../claude/chairBudgetAlert.js";
import { PLAN_LINE_PREFIX } from "../claude/planReadingRender.js";
import { brokenAutomationLines, seatableLines } from "./digestActFirst.js";
import { bootsRefusedLines } from "./digestBootsRefused.js";
import { closeDoneLines, depthLines, eventLines, fleetHealthLines, watchLines } from "./digestFleet.js";
import { heldLines } from "./digestHeld.js";
import { blockedLines, bumpDriveLines, landingLines } from "./digestLanding.js";
import { handRecheckLines, orgHealthLines } from "./digestNotice.js";
import { queueRefusalDigestLines } from "./digestQueueRefusals.js";
import { queueStoppingDigestLines } from "./digestQueueStopping.js";
import {
  arrayField,
  asText,
  capped,
  cappedInline,
  countText,
  type DigestInputs,
  type DigestReading,
  detail,
  field,
  jsonOf,
  named,
  numberField,
  stringField,
  unavailableLine,
} from "./digestRead.js";
import { recipeDigestLines } from "./digestRecipes.js";
import { sidebarLines } from "./digestSidebar.js";
import { turnDispatchSweepLines } from "./digestTurnSweep.js";

export type { DigestInputs, DigestReading };

/** The render's own snapshot ceiling, in minutes — `../briefing/snapshotAge.ts` enforces it; this only warns. */
const SNAPSHOT_CEILING_MINUTES = 90;

/** @returns the reconciliation's headline, intake clause, starving count, and the head of the ready list */
function reconcileLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const read = jsonOf({ inputs, name: "reconcile" });
  if ("line" in read) {
    return [read.line];
  }
  const intake = stringField({ key: "intakeClause", value: read.value });
  const starving = arrayField({ key: "starving", value: read.value }).map((row) =>
    typeof row === "string" ? row : named({ key: "id", value: row }),
  );
  const ready = arrayField({ key: "ready", value: read.value }).map(
    (row) =>
      `ready: ${absentAs({ value: stringField({ key: "priority", value: row }), whenAbsent: "unprioritised" })} ` +
      `${absentAs({ value: stringField({ key: "id", value: row }), whenAbsent: "(no id)" })} — ` +
      detail({ key: "label", value: row, whenAbsent: "(no label)" }),
  );
  return [
    `reconcile: ${headlineOf({ value: read.value })}`,
    ...(intake === undefined ? [] : [`intake: ${intake}`]),
    `starving: ${String(starving.length)} ready item(s) with nobody on them` +
      (starving.length === 0 ? "" : ` — ${cappedInline({ items: starving })}`),
    ...capped({ lines: ready, prefix: "ready" }),
  ];
}

/**
 * The reconciliation's alignment headline, or a line saying the document carried none.
 *
 * @returns the headline text
 */
function headlineOf({ value }: { value: unknown }): string {
  const headline = stringField({ key: "headline", value });
  if (headline === undefined) {
    return "(no headline field)";
  }
  return headline;
}

/**
 * A load triple as `1m/5m/15m`, to one decimal.
 *
 * @returns the triple, or a note that the reading carried none
 */
function loadTriple({ load }: { load: unknown }): string {
  const values = ["load1", "load5", "load15"]
    .map((key) => numberField({ key, value: load }))
    .filter((one): one is number => one !== undefined);
  if (values.length !== 3) {
    return "load unreadable";
  }
  return `load ${values.map((one) => one.toFixed(1)).join("/")}`;
}

/** @returns the machine hold, its load against the hold line, and the culprit when one is named */
function capacityLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const read = jsonOf({ inputs, name: "capacity" });
  if ("line" in read) {
    return [read.line];
  }
  const hold = field({ key: "hold", value: read.value }) === true;
  const line = numberField({ key: "loadHold", value: read.value });
  const against = line === undefined ? "" : ` against ${String(line)}`;
  const culprit = field({ key: "culprit", value: read.value });
  const subject = stringField({ key: "subject", value: culprit });
  const culpritText =
    subject === undefined
      ? ""
      : `; culprit ${subject} (${named({ key: "why", value: culprit })}): ${named({ key: "kill", value: culprit })}`;
  const subjects = arrayField({ key: "holdSubjects", value: read.value }).map((one) => asText({ value: one }));
  const subjectsText = subjects.length === 0 ? "" : `; subjects ${cappedInline({ items: subjects })}`;
  const recentBoots = field({ key: "recentBoots", value: read.value });
  const boots = arrayField({ key: "boots", value: recentBoots }).map((boot) => {
    const session = stringField({ key: "sessionId", value: boot });
    return session === undefined ? "(no sessionId)" : `session ${session.slice(0, 8)}`;
  });
  const window = numberField({ key: "windowSeconds", value: recentBoots });
  const bootsText =
    boots.length === 0
      ? ""
      : `; ${String(boots.length)} boot(s) in the last ${window === undefined ? "?" : String(window)}s ` +
        `(${cappedInline({ items: boots })})`;
  return [
    `machine: ${hold ? "HOLD" : "clear"} — ${loadTriple({ load: field({ key: "load", value: read.value }) })}${against}${culpritText}${bootsText}${subjectsText}`,
  ];
}

/**
 * The plan inventory first, then the lines to act on. Every `PLAN` line leads, verbatim and uncapped — one per
 * CONFIGURED plan with each window's own reset, an unreadable or paused plan said rather than dropped, bounded by
 * the plan count. When every plan is unreadable this must not print only "nothing to react to", or the chair
 * spends a plan nobody can see to 100%.
 *
 * The chair's own near-wall line rides beside the REACT NOW ones: in a weekly window's last five hours routing
 * lifts its cap, so the chair can be nearing its wall with no REACT NOW line printed at all. The CHAIR lines are
 * never folded into the overflow count: a dead chair is a dead fleet, and they are bounded already — at most one
 * per window of each plan a chair session spends, so a handful. Only the REACT NOW lines are capped.
 *
 * @returns every PLAN line, every CHAIR line, then the REACT NOW lines capped at eight, verbatim — with a line
 *   saying so when the gauge printed no plan readings, or nothing to react to
 */
function gaugeLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const reading = inputs.readings.get("gauge");
  const missing = unavailableLine({ name: "gauge", reading });
  if (missing !== undefined) {
    return [missing];
  }
  if (reading?.kind !== "text") {
    return ["gauge: captured as JSON, not text"];
  }
  const printed = reading.text.split("\n");
  const lifted = ({ prefix }: { prefix: string }): readonly string[] =>
    printed.filter((one) => one.startsWith(prefix)).map((one) => `gauge: ${one}`);
  const plans = lifted({ prefix: PLAN_LINE_PREFIX });
  const chair = lifted({ prefix: CHAIR_LINE_PREFIX });
  const react = lifted({ prefix: "REACT NOW" });
  const inventory = plans.length === 0 ? ["gauge: the gauge printed no plan readings"] : plans;
  if (chair.length === 0 && react.length === 0) {
    return [...inventory, "gauge: nothing to react to"];
  }
  return [...inventory, ...chair, ...capped({ lines: react, prefix: "gauge" })];
}

/** @returns each blocked turn, and each standing problem */
function turnLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const standing = jsonOf({ inputs, name: "standing" });
  const standingLines =
    "line" in standing
      ? [standing.line]
      : arrayField({ key: "problems", value: standing.value }).map((one) => `standing: ${asText({ value: one })}`);
  return [...blockedLines({ inputs }), ...capped({ lines: standingLines, prefix: "standing" })];
}

/** @returns the listener's grade and why, the friction review's state, and close-done's counts */
function healthLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const listen = jsonOf({ inputs, name: "listen" });
  const listenLine =
    "line" in listen
      ? listen.line
      : `listener: ${named({ key: "grade", value: listen.value })} — ${named({ key: "why", value: listen.value })}`;
  const friction = jsonOf({ inputs, name: "friction" });
  const frictionLine =
    "line" in friction
      ? friction.line
      : `friction: ${field({ key: "isStale", value: friction.value }) === true ? "stale" : "fresh"}, ` +
        `${field({ key: "hasGap", value: friction.value }) === true ? "a gap" : "no gap"}`;
  const closeDone = jsonOf({ inputs, name: "close-done" });
  const counts = "line" in closeDone ? undefined : field({ key: "counts", value: closeDone.value });
  const closeLine =
    "line" in closeDone
      ? closeDone.line
      : `close-done: ${["closed", "parked", "driftClosed", "failed", "held", "kept"]
          .map((key) => `${key} ${countText({ key, value: counts })}`)
          .join(", ")}`;
  const outcomes =
    "line" in closeDone ? [] : closeDoneLines({ outcomes: arrayField({ key: "outcomes", value: closeDone.value }) });
  return [listenLine, frictionLine, closeLine, ...outcomes];
}

/** @returns the merge hold's first line */
function holdLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const reading = inputs.readings.get("hold");
  const missing = unavailableLine({ name: "merge hold", reading });
  if (missing !== undefined) {
    return [missing];
  }
  if (reading?.kind !== "text") {
    return ["merge hold: captured as JSON, not text"];
  }
  const [first = "(empty)"] = reading.text.split("\n");
  return [`merge hold: ${first}`];
}

/** @returns the two snapshot halves' ages, warning on each one the render will refuse */
function snapshotLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const age = ({ label, minutes, fix }: { label: string; minutes: number | undefined; fix: string }): string => {
    if (minutes === undefined) {
      return `${label}: none in this seat`;
    }
    const over = minutes > SNAPSHOT_CEILING_MINUTES;
    return `${label}: ${String(Math.round(minutes))} min old${over ? ` — past ${String(SNAPSHOT_CEILING_MINUTES)}, the render refuses it; ${fix}` : ""}`;
  };
  return [
    age({
      fix: "re-read each open page and set openPagesReviewed",
      label: "open pages",
      minutes: inputs.openPagesAgeMinutes,
    }),
    age({ fix: "close refreshes it before rendering", label: "owner's list", minutes: inputs.runAgeMinutes }),
  ];
}

/**
 * Every digest line, in the order a chair acts on them: first the card the owner's Queue leads with, which its chat update to
 * the owner names first (`./digestQueueStopping.ts`, a P0 rule), then BOOTS REFUSED when no new seat can start
 * (`./digestBootsRefused.ts`), then every declared automation the store
 * lacks or holds on an old cadence (`./digestRecipes.ts` — an absent roster once read as "none due"), then the decisions
 * it owes this pass, each with its command (`./digestActFirst.ts` — which automation is broken and whether anything can seat its fix, what `automation
 * freshness` raises, which ready row is actually seatable), then what is misaligned and ready, what the machine allows and
 * alerted, which seats need a look, what is due, who is blocked, what is healthy and closed, then the two
 * snapshot ages the render will judge.
 *
 * @param inputs the readings, the previous pass's holds and the two file ages
 * @returns the lines, each already prefixed with what it reads
 */
export function tickDigestLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const recipes = recipeDigestLines({ inputs });
  return [
    ...queueStoppingDigestLines({ inputs }),
    ...bootsRefusedLines({ inputs }),
    ...recipes.actFirst,
    ...brokenAutomationLines({ inputs }),
    ...sidebarLines({ inputs }),
    ...seatableLines({ inputs }),
    ...heldLines({ inputs }),
    ...reconcileLines({ inputs }),
    ...capacityLines({ inputs }),
    ...eventLines({ inputs }),
    ...turnDispatchSweepLines({ inputs }),
    ...gaugeLines({ inputs }),
    ...watchLines({ inputs }),
    ...depthLines({ inputs }),
    ...recipes.schedule,
    ...turnLines({ inputs }),
    ...healthLines({ inputs }),
    ...handRecheckLines({ inputs }),
    ...queueRefusalDigestLines({ inputs }),
    ...fleetHealthLines({ inputs }),
    ...orgHealthLines({ inputs }),
    ...holdLines({ inputs }),
    ...landingLines({ inputs }),
    ...bumpDriveLines({ inputs }),
    ...snapshotLines({ inputs }),
  ];
}
