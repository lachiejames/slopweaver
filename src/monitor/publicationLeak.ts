/**
 * `publication-leak` — something the fleet already published carries what the outbound privacy check refuses.
 *
 * The source is the last `audit publications` report (`../live/publicationAudit/store.ts`): one sanitised finding per
 * object per class, each a class, a door, a link and a coordinate-only id. Each finding is one subject, so each is one
 * floating note and one Queue card, naming the class, the door and the link — never the matched text, which the report
 * does not hold.
 *
 * ## Why the step is the owner's
 *
 * What to do about a published leak is a judgement about the owner's own words in public: edit the text, delete it, or
 * accept it (a pull request that is ABOUT session ids may quote one on purpose). An edit to somebody else's reply is
 * not the fleet's to make at all. So the card asks the owner to look and decide, and the link takes them there.
 *
 * ## A partial run never settles a card
 *
 * A finding missing from a run that did not read its door completely has not been observed gone. So a report with any
 * swept door short of `complete` keeps every open card (`preservesDepartures`), and one with no finding at all on such
 * a run is `unmeasurable`, never `clear`. An uploaded file the audit counted but did not read is the same blind spot
 * whatever state its door reports: a leak in an image is invisible to a text check, so it can never read `clear`.
 * A door this build does not read (`not-swept`) can hold no finding, so it
 * blocks nothing. The arrival register is the memory: an unchanged finding is one card for as long as it stands, and
 * a finding that clears and comes back is a new arrival.
 *
 * Pure but for {@link readPublicationLeak}, the one read `./sources.ts` calls: the evaluator takes the report already
 * read.
 */
import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../hand/step.js";
import { IF_IGNORED_CAP } from "../hand/stepConsequence.js";
import type { Result } from "../lib/result.js";
import {
  type PublicationAuditReport,
  type PublicationAuditStoreError,
  readLatestPublicationAudit,
} from "../live/publicationAudit/store.js";
import type { PublicationFinding } from "../live/publicationAudit/types.js";

import type { MonitorDefinition } from "./registry.js";
import type { MonitorReading, MonitorSubject } from "./types.js";

/** What a subject names in place of an address the audit withheld. */
const WITHHELD_LINK = "the link is withheld, a rule matched the address itself";

/**
 * One finding as a monitor subject: named by class, door and link, keyed by its coordinate-only id. The label also
 * names the fields it sat in, so a hit in a review comment's quoted code (`diff_hunk`: the text is in the repository's
 * history) reads differently from one in somebody's prose (`body`: edit the comment). The id leaves them out, so a
 * finding that moves between fields stays one card.
 *
 * @param finding one sanitised finding
 * @returns the subject
 */
function subjectOf({ finding }: { finding: PublicationFinding }): MonitorSubject {
  const named = ({ where }: { where: string }): MonitorSubject => ({
    id: `${finding.door} ${finding.className} ${where}`,
    key: finding.findingId,
    label: `${finding.className} on ${finding.door}, in ${finding.fields.join(", ")}: ${where}`,
  });
  if (finding.link === null) {
    return named({ where: WITHHELD_LINK });
  }
  return { ...named({ where: finding.link }), page: finding.link };
}

/**
 * Judge the last audit report.
 *
 * @param read the last report, or why there is none
 * @returns firing with one subject per finding, clear for a complete clean run, else unmeasurable
 */
export function evaluatePublicationLeak({
  read,
}: {
  read: Result<PublicationAuditReport, PublicationAuditStoreError>;
}): MonitorReading {
  if (read.isErr()) {
    return { because: read.error.message, monitorId: "publication-leak", state: "unmeasurable" };
  }
  const report = read.value;
  const short = report.coverage.filter((door) => door.state === "partial").map((door) => door.door);
  const unread = report.coverage
    .filter((door) => door.attachmentsNotSwept > 0)
    .map((door) => `${String(door.attachmentsNotSwept)} uploaded file(s) on ${door.door}`);
  const missed: string[] = [];
  if (short.length > 0) {
    missed.push(`${short.join(", ")} completely`);
  }
  if (unread.length > 0) {
    missed.push(unread.join(", "));
  }
  const blindSpot =
    missed.length === 0 ? undefined : `the last audit did not read ${missed.join(", nor ")} (${report.run})`;
  if (report.findings.length === 0) {
    if (blindSpot !== undefined) {
      return { because: blindSpot, monitorId: "publication-leak", state: "unmeasurable" };
    }
    return { monitorId: "publication-leak", state: "clear" };
  }
  const subjects = report.findings.map((finding) => subjectOf({ finding }));
  if (blindSpot === undefined) {
    return { monitorId: "publication-leak", state: "firing", subjects };
  }
  return { blindSpot, monitorId: "publication-leak", preservesDepartures: true, state: "firing", subjects };
}

/**
 * Read the last audit report under one home and judge it.
 *
 * @param home the state home whose `publicationAuditReports` holds `latest.json`
 * @returns the reading; `unmeasurable` naming the store's refusal when there is no report to read
 */
export function readPublicationLeak({ home }: { home: string }): MonitorReading {
  return evaluatePublicationLeak({ read: readLatestPublicationAudit({ home }) });
}

/** What the card says before the class and door. */
const LEAK_WHAT_OPEN = "Edit or delete the published text at the link below — it carries leak class ";

/** `publication-leak`: one floating card per published object carrying one class of leak. */
export const PUBLICATION_LEAK: MonitorDefinition = {
  blurb:
    "Something already published carries what the outbound privacy check refuses — one card per object and class, naming the class, door and link, never the term.",
  context: "work",
  floats: true,
  id: "publication-leak",
  ifIgnored: ({ subject }) =>
    fitLine({
      cap: IF_IGNORED_CAP,
      text: `${subject.label} stays readable by anyone who can open it — once the repository is public, that is everyone`,
    }),
  perSubject: true,
  plainWhat: "Edit or delete a published text the leak audit flagged — its class, door and link are below",
  prefix: "leak",
  resolves:
    "a complete `audit publications` run no longer finds that class on that object — the text was edited or deleted",
  source: "$SLOPWEAVER_HOME/evidence/publication-audit/latest.json (the last `audit publications` report)",
  unblocks: ({ subject }) =>
    fitLine({ cap: UNBLOCKS_CAP, text: `${subject.label} — one leak to clear before the repository goes public` }),
  what: ({ subject }) => {
    const [door, className] = subject.id.split(" ");
    const tail = `${String(className)} on ${String(door)}`;
    return `${LEAK_WHAT_OPEN}${fitLine({ cap: WHAT_CAP - LEAK_WHAT_OPEN.length, text: tail })}`;
  },
};
