/**
 * The org-chart lines an identity chip's hover card draws — people's titles, and which Vanta group and
 * which team they are in. Every line names the store it was read from, so a wrong
 * team on a chip is traceable to the directory or to Vanta rather than taken on trust.
 *
 * Pure: a roster entry in, lines out. The facts are the CLI's (`src/corpus/members/orgChart.ts`); this only words them.
 */
import type { OrgFactSource, SlackPersonName } from "./slackPeople";

/** What the hover card calls each store an org-chart fact was read from. */
const SOURCE_LABELS: Readonly<Record<OrgFactSource, string>> = { "google-admin": "Google Admin", vanta: "Vanta" };

/** One org-chart fact: what it is, its value, and the store it was read from. */
export interface OrgLine {
  readonly label: string;
  readonly value: string;
  readonly source: string;
}

/** Vanta's status as words: `ON_LEAVE` reads "On leave". */
function statusWords({ status }: { status: string }): string {
  const words = status.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An org unit path as its units, outermost first: `/Staff/Leaver` reads "Staff › Leaver". */
function unitWords({ path }: { path: string }): string {
  return path
    .split("/")
    .filter((unit) => unit.length > 0)
    .join(" › ");
}

/**
 * The line under a person's name: the directory's title when the org chart holds one, Slack's own otherwise.
 *
 * @returns the title, or nothing when neither says one
 */
export function positionOf({ person }: { person: SlackPersonName }): string | undefined {
  if (person.org?.title !== undefined) {
    return person.org.title.value;
  }
  return person.title;
}

/**
 * Every org-chart line for one person, in the order a reader asks: what they do, which team, where Google files
 * them, then Vanta's groups and status. Slack's own title is a line only when it says something the org chart's
 * does not, since the position line above already draws the org chart's.
 *
 * @returns the lines, none when the CLI joined them to neither store
 */
export function orgLines({ person }: { person: SlackPersonName }): readonly OrgLine[] {
  const org = person.org;
  if (org === undefined) {
    return [];
  }
  const lines: OrgLine[] = [];
  if (org.title !== undefined) {
    lines.push({ label: "Title", source: SOURCE_LABELS[org.title.source], value: org.title.value });
    const slack = person.title;
    if (slack !== undefined && slack.toLowerCase() !== org.title.value.toLowerCase()) {
      lines.push({ label: "On Slack", source: "Slack", value: slack });
    }
  }
  if (org.department !== undefined) {
    lines.push({ label: "Team", source: SOURCE_LABELS["google-admin"], value: org.department });
  }
  const unit = org.orgUnit === undefined ? "" : unitWords({ path: org.orgUnit });
  if (unit.length > 0) {
    lines.push({ label: "Org unit", source: SOURCE_LABELS["google-admin"], value: unit });
  }
  if (org.vantaGroups.length > 0) {
    lines.push({ label: "Groups", source: SOURCE_LABELS.vanta, value: org.vantaGroups.join(" · ") });
  }
  if (org.vantaStatus !== undefined) {
    lines.push({ label: "Status", source: SOURCE_LABELS.vanta, value: statusWords({ status: org.vantaStatus }) });
  }
  return lines;
}
