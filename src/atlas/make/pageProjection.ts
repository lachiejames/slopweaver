/**
 * The scenario table on the Make atlas page: every scenario, what it does, when it runs, whether it is on,
 * who made it, and how its newest run ended.
 *
 * ## There is no owner column, on purpose
 *
 * The ask was "who owns it". Make records no owner on a scenario — only the user who created it, the user who
 * last edited it, and the team it lives in. Labelling that "owner" would assert something Make never said, so
 * the column is headed for what it holds and the table's note says so. A scenario whose creator has left is
 * still somebody's; working out whose is the reader's job, with these three facts to start from.
 *
 * Every stored scenario gets a row. One whose stored detail no longer parses keeps its row and says so in it,
 * rather than vanishing from a list whose whole point is "every".
 */
import type { AtlasPageDetailTable } from "../kit/pageTable.js";
import type { AtlasKindView } from "../kit/read.js";
import {
  type MakeExecutionDetail,
  type MakeScenarioDetail,
  storedExecutionDetail,
  storedScenarioDetail,
  teamDetail,
} from "./details.js";

/** The column headings, in print order. */
const COLUMNS = [
  "scenario",
  "what it does",
  "schedule",
  "state",
  "made by / last edited by (team)",
  "newest run",
] as const;

/** What the table can and cannot claim, printed above it. */
const NOTE =
  "Make records no scenario owner; creator, last editor and team are provenance, not ownership. " +
  '"What it does" is the scenario\'s own description where it has one, then the apps its modules call, in flow order.';

/** Make's execution status codes, as its API documents them. */
const RUN_STATUS: Readonly<Record<number, string>> = { 1: "success", 2: "warning", 3: "error" };

/** One person Make names on a scenario, as a reader would recognise them. */
function personWords({ user }: { user: MakeScenarioDetail["createdByUser"] }): string {
  if (user == null) {
    return "unknown";
  }
  if (user.name != null && user.name !== "") {
    return user.name;
  }
  if (user.email != null && user.email !== "") {
    return user.email;
  }
  return `user #${String(user.id)}`;
}

/** The description, then the apps in flow order — the two things that say what a scenario does. */
function doesWords({ scenario }: { scenario: MakeScenarioDetail }): string {
  const outline = scenario.blueprintOutline;
  const apps =
    outline.appPrefixes.length === 0
      ? "no modules"
      : `${outline.appPrefixes.join(" → ")} (${String(outline.moduleCount)} modules)`;
  const description = scenario.description === null ? "" : scenario.description.trim();
  return description === "" ? apps : `${description} — ${apps}`;
}

/** Make's scheduling block in words. A type this does not know prints as Make named it. */
function scheduleWords({ scheduling }: { scheduling: MakeScenarioDetail["scheduling"] }): string {
  const at = scheduling.time === undefined ? "" : ` at ${scheduling.time}`;
  switch (scheduling.type) {
    case "immediately":
      return "immediately, on each trigger";
    case "indefinitely":
      return scheduling.interval === undefined
        ? "at regular intervals"
        : `every ${String(Math.round(scheduling.interval / 60))} min`;
    case "once":
      return scheduling.date === undefined ? "once" : `once, ${scheduling.date}`;
    case "on-demand":
      return "on demand only";
    case "weekly":
      return `weekly${scheduling.days === undefined ? "" : ` on days ${scheduling.days.join(",")}`}${at}`;
    case "monthly":
      return `monthly${scheduling.days === undefined ? "" : ` on dates ${scheduling.days.join(",")}`}${at}`;
    default:
      return `${scheduling.type}${at}`;
  }
}

/** On or off, then anything that qualifies it. */
function stateWords({ scenario }: { scenario: MakeScenarioDetail }): string {
  const words = [scenario.isActive ? "on" : "off"];
  if (scenario.isPaused) {
    words.push("paused");
  }
  if (scenario.isinvalid) {
    words.push("invalid");
  }
  if (scenario.dlqCount !== undefined && scenario.dlqCount > 0) {
    words.push(`${String(scenario.dlqCount)} incomplete`);
  }
  return words.join(", ");
}

/** The newest kept run, or that none is kept. */
function runWords({ run }: { run: MakeExecutionDetail | undefined }): string {
  if (run === undefined) {
    return "no run among the newest kept";
  }
  const status = RUN_STATUS[run.status];
  if (status === undefined) {
    return `${run.timestamp} · status ${String(run.status)}`;
  }
  return `${run.timestamp} · ${status}`;
}

/** A team's name, or its id when no readable team carries it. */
function teamWords({ teamId, teamNames }: { teamId: number; teamNames: ReadonlyMap<number, string> }): string {
  const name = teamNames.get(teamId);
  if (name === undefined) {
    return `team #${String(teamId)}`;
  }
  return name;
}

/** The entities of one kind, empty when the snapshot carries no such kind. */
function entitiesOf({ kinds, kind }: { kinds: readonly AtlasKindView[]; kind: string }): AtlasKindView["entities"] {
  const view = kinds.find((candidate) => candidate.kind === kind);
  if (view === undefined) {
    return [];
  }
  return view.entities;
}

/** Every readable team's name, by id. */
function teamNamesOf({ kinds }: { kinds: readonly AtlasKindView[] }): ReadonlyMap<number, string> {
  const names = new Map<number, string>();
  for (const entity of entitiesOf({ kind: "team", kinds })) {
    const team = teamDetail.safeParse(entity.detail);
    if (team.success) {
      names.set(team.data.id, team.data.name);
    }
  }
  return names;
}

/** Each scenario's newest readable kept run, by scenario id. */
function newestRunsOf({ kinds }: { kinds: readonly AtlasKindView[] }): ReadonlyMap<number, MakeExecutionDetail> {
  const newest = new Map<number, MakeExecutionDetail>();
  for (const entity of entitiesOf({ kind: "execution", kinds })) {
    const run = storedExecutionDetail.safeParse(entity.detail);
    if (!run.success) {
      continue;
    }
    const held = newest.get(run.data.scenarioId);
    if (held === undefined || run.data.timestamp > held.timestamp) {
      newest.set(run.data.scenarioId, run.data);
    }
  }
  return newest;
}

/** One table row, with the key it is ordered by. */
interface SortedRow {
  readonly sortKey: string;
  readonly cells: readonly string[];
}

/** A readable scenario's row. */
function scenarioRow({
  scenario,
  teamNames,
  newestRuns,
}: {
  scenario: MakeScenarioDetail;
  teamNames: ReadonlyMap<number, string>;
  newestRuns: ReadonlyMap<number, MakeExecutionDetail>;
}): SortedRow {
  const team = teamWords({ teamId: scenario.teamId, teamNames });
  const provenance = `${personWords({ user: scenario.createdByUser })} / ${personWords({ user: scenario.updatedByUser })} (${team})`;
  return {
    cells: [
      `${scenario.name} (#${String(scenario.id)})`,
      doesWords({ scenario }),
      scheduleWords({ scheduling: scenario.scheduling }),
      stateWords({ scenario }),
      provenance,
      runWords({ run: newestRuns.get(scenario.id) }),
    ],
    sortKey: `${team}\u0000${scenario.name}`,
  };
}

/** Rows in key order. */
function inKeyOrder({ rows }: { rows: readonly SortedRow[] }): readonly SortedRow[] {
  return rows.toSorted((left, right) => left.sortKey.localeCompare(right.sortKey));
}

/**
 * Build the scenario table from the stored atlas.
 *
 * @param kinds the read view's kinds — scenarios, teams and executions are read from it
 * @returns one table with a row for every stored scenario, ordered by team then scenario name, any unreadable
 *   one last by provider id
 */
export function scenarioTable({ kinds }: { kinds: readonly AtlasKindView[] }): AtlasPageDetailTable {
  const teamNames = teamNamesOf({ kinds });
  const newestRuns = newestRunsOf({ kinds });
  const rows: SortedRow[] = [];
  const unreadable: SortedRow[] = [];
  for (const entity of entitiesOf({ kind: "scenario", kinds })) {
    const parsed = storedScenarioDetail.safeParse(entity.detail);
    if (parsed.success) {
      rows.push(scenarioRow({ newestRuns, scenario: parsed.data, teamNames }));
      continue;
    }
    const why = `stored detail unreadable: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`;
    unreadable.push({ cells: [`#${entity.providerId}`, why, "—", "—", "—", "—"], sortKey: entity.providerId });
  }
  return {
    columns: [...COLUMNS],
    id: "make-scenarios",
    note: NOTE,
    rows: [...inKeyOrder({ rows }), ...inKeyOrder({ rows: unreadable })].map((row) => row.cells),
    title: "Scenarios",
  };
}
