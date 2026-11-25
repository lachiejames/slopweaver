/**
 * The text `slopweaver cmux picture` prints: the session's header, its tool calls counted by kind, then the calls in
 * flight and the last ended ones, each named by the vendor's tool name or, lacking one, its kind. An empty list says
 * so in words rather than printing nothing, and counts taken while calls were being dropped say they are a floor.
 */

import { APP_TOOL_KINDS, type AppSessionPicture, type AppToolFact } from "../../../sessionHarness/pictureWire.js";

function callLine({ fact }: { fact: AppToolFact }): string {
  let label: string = fact.toolKind;
  if (fact.name !== undefined) {
    label = `${fact.name} (${fact.toolKind})`;
  }
  let parent = "";
  if (fact.parentToolCallId !== undefined) {
    parent = ` · under ${fact.parentToolCallId}`;
  }
  return `  ${label} · ${fact.status} · started ${fact.startedAtIso} · last seen ${fact.lastObservedAtIso}${parent}`;
}

function listLines({ heading, facts }: { heading: string; facts: readonly AppToolFact[] }): readonly string[] {
  if (facts.length === 0) {
    return [`${heading}: none`];
  }
  return [`${heading}:`, ...facts.map((fact) => callLine({ fact }))];
}

/**
 * The lines one session's picture prints as.
 *
 * @param picture what the app answered for the session
 * @returns the header, the counts, and the in-flight and recent-ended lists, in that order
 */
export function pictureLines({ picture }: { picture: AppSessionPicture }): readonly string[] {
  const { session, facts } = picture;
  const header = `${session.handle} · ${session.vendor} · ${session.state} · ${session.title} · read ${picture.readAtIso}`;
  const buckets = APP_TOOL_KINDS.filter((kind) => facts.countsByKind[kind] > 0);
  if (buckets.length === 0 && facts.droppedActivityEvents === 0) {
    return [header, "tool activity: none observed in this app run"];
  }
  const total = buckets.reduce((sum, kind) => sum + facts.countsByKind[kind], 0);
  let countLine = `tool calls: ${String(total)}`;
  if (buckets.length > 0) {
    countLine = `${countLine} (${buckets.map((kind) => `${kind} ${String(facts.countsByKind[kind])}`).join(", ")})`;
  }
  const lines = [header, countLine];
  if (facts.firstActivityAtIso !== undefined && facts.lastActivityAtIso !== undefined) {
    lines.push(`activity: first ${facts.firstActivityAtIso} · last ${facts.lastActivityAtIso}`);
  }
  if (facts.droppedActivityEvents > 0) {
    lines.push(
      `counts are a floor: ${String(facts.droppedActivityEvents)} new call(s) arrived while the in-flight list was full and were not stored`,
    );
  }
  return [
    ...lines,
    ...listLines({ facts: facts.inFlight, heading: "in flight" }),
    ...listLines({ facts: facts.lastCompleted, heading: "recent ended" }),
  ];
}
