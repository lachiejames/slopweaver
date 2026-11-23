/**
 * What a routing judgement knows about each integration, derived from its manifest: the capability rows it answers
 * for, and which side of the noun partition its own noun sits on (`src/route/genericCapabilities.ts` and
 * `src/route/sourceNouns.ts` read these, and hold the rows and nouns no integration owns).
 *
 * A module of its own for the reason `./connections.ts` is: the corpus source lists are about ingesting integrations,
 * and most of the integrations here ingest nothing.
 */
import type { SourceCapability } from "../route/profile.js";
import type { IntegrationManifest } from "./manifest.js";

/**
 * The words naming a meeting's own record. A mailbox holds one when Meet or a notetaker mails it, and Drive files
 * one, so a question naming one owes those doors before any "none exists". `note` and `notes` stand bare because the
 * planner matches a contiguous phrase: "the note from yesterday's meeting" never contains `meeting note`, and a read
 * leg planned for release notes costs one empty search.
 *
 * The planner also refuses a term joined to a hyphen — on purpose, so a service named `asset-management` makes
 * nothing required — which leaves "meeting-notes" matching none of the bare words. The `meeting-` compounds are
 * spelled out for that reason; any other compound (`call-notes`) stays outside what the planner sees, and
 * `skills/loop-bot/reference/artifact-asks.md` holds the turn to the doors regardless.
 */
const MEETING_RECORD_WORDS = ["transcript", "transcripts", "recording", "recordings", "note", "notes"] as const;

/** Every meeting-record word, bare and as its `meeting-` compound. */
export const MEETING_ARTIFACT_TERMS: readonly string[] = [
  ...MEETING_RECORD_WORDS,
  ...MEETING_RECORD_WORDS.map((word) => `meeting-${word}`),
];

/** One integration-owned capability row, finished, and the index it claims in the merged table. */
export interface RoutingRowAtOrdinal {
  readonly capability: SourceCapability;
  readonly ordinal: number;
}

/**
 * Every capability row the integrations answer for, in ordinal order, frozen.
 *
 * Takes the manifests rather than reading the registry, so a test can add a fixture integration and watch it appear;
 * production passes `registeredIntegrations()`.
 *
 * @param manifests the integrations to derive from, in any order
 * @returns one finished row per declared routing row, with the meeting-record words on the rows that asked for them
 */
export function integrationRoutingRowsOf({
  manifests,
}: {
  manifests: readonly IntegrationManifest[];
}): readonly RoutingRowAtOrdinal[] {
  const rows = manifests
    .flatMap((manifest) => {
      if (manifest.routing === undefined) {
        return [];
      }
      return manifest.routing;
    })
    .toSorted((left, right) => left.ordinal - right.ordinal)
    .map(({ capability, meetingRecords, ordinal }): RoutingRowAtOrdinal => {
      if (meetingRecords === undefined) {
        return { capability, ordinal };
      }
      return { capability: { ...capability, terms: [...capability.terms, ...MEETING_ARTIFACT_TERMS] }, ordinal };
    });
  Object.freeze(rows);
  return rows;
}

/**
 * The capability table: each integration row at its own index, and the local rows filling every other index in the
 * order they are declared.
 *
 * @param integration the integration-owned rows, each claiming one index
 * @param local the rows no integration owns, in decisive order
 * @returns the merged table, frozen
 * @throws when two rows claim one index or an index lies past the table's end, since either would silently reorder
 * the planner's tie-break
 */
export function mergedRoutingTable({
  integration,
  local,
}: {
  integration: readonly RoutingRowAtOrdinal[];
  local: readonly SourceCapability[];
}): readonly SourceCapability[] {
  const total = integration.length + local.length;
  const byOrdinal = new Map(integration.map((row) => [row.ordinal, row.capability]));
  const outOfRange = integration.filter((row) => row.ordinal < 0 || row.ordinal >= total);
  if (byOrdinal.size !== integration.length || outOfRange.length > 0) {
    throw new Error(
      `routing ordinals must be unique and inside 0..${String(total - 1)}: ${integration.map((row) => `${row.capability.id}=${String(row.ordinal)}`).join(", ")}`,
    );
  }
  const remaining = [...local];
  const merged = Array.from({ length: total }, (_, index) => {
    const claimed = byOrdinal.get(index);
    if (claimed !== undefined) {
      return claimed;
    }
    return remaining.shift()!;
  });
  Object.freeze(merged);
  return merged;
}

/** Which integrations' own nouns read a source, and which do not and why. */
export interface IntegrationNouns {
  readonly notASource: readonly { readonly noun: string; readonly reason: string }[];
  readonly sourceReading: readonly string[];
}

/**
 * The two halves of the noun partition the integrations own, each noun being the manifest's id.
 *
 * @param manifests the integrations to derive from, in any order
 * @returns the source-reading nouns and the not-a-source nouns with their reasons, each sorted by noun
 */
export function integrationNounsOf({ manifests }: { manifests: readonly IntegrationManifest[] }): IntegrationNouns {
  const byId = manifests.toSorted((left, right) => left.id.localeCompare(right.id));
  return {
    notASource: byId.flatMap((manifest) =>
      manifest.noun?.kind === "not-a-source" ? [{ noun: manifest.id, reason: manifest.noun.reason }] : [],
    ),
    sourceReading: byId.filter((manifest) => manifest.noun?.kind === "source-reading").map((manifest) => manifest.id),
  };
}
