/**
 * One bronze commit folded into per-container, per-kind counts — the shape a `committed` row carries.
 *
 * Pure, and fed the committer's own two lists (what it was offered, what it appended), so the numbers on the
 * Automations page are the write path's numbers rather than a second count of the same thing made somewhere else.
 */
import type { CorpusRecord } from "../corpus/types.js";
import type { SyncKindCount } from "./event.js";

/** One container's share of a commit. */
export interface ContainerTally {
  readonly source: string;
  readonly container: string;
  readonly label: string;
  readonly kinds: Readonly<Record<string, SyncKindCount>>;
}

/**
 * What a person calls a record's container: the channel name the record carries, when it carries one as a string,
 * else the container id itself.
 *
 * @param record any record of the container
 * @returns the label
 */
function labelOf({ record }: { record: CorpusRecord }): string {
  const channel = record.attrs?.["channel"];
  if (typeof channel === "string" && channel.length > 0) {
    return channel;
  }
  return record.container;
}

/** The map key one record tallies under — source and container together, since two sources may share a name. */
function keyOf({ record }: { record: CorpusRecord }): string {
  return `${record.source}\u0000${record.container}`;
}

/**
 * Fold one commit into per-container counts, offered and written, by record kind.
 *
 * A container that was offered records and appended none comes out with every `written` at zero, which is the
 * claim "read, and nothing new here" — distinct from a container that never appears, which was not offered at all.
 *
 * @param offered every record the commit was handed after the sync denylist
 * @param written the subset it appended as new
 * @returns one tally per container offered, in first-seen order
 */
export function tallyCommit({
  offered,
  written,
}: {
  offered: readonly CorpusRecord[];
  written: readonly CorpusRecord[];
}): readonly ContainerTally[] {
  const tallies = new Map<
    string,
    { source: string; container: string; label: string; kinds: Record<string, SyncKindCount> }
  >();
  const bump = ({ record, field }: { record: CorpusRecord; field: "offered" | "written" }): void => {
    const key = keyOf({ record });
    let tally = tallies.get(key);
    if (tally === undefined) {
      tally = { container: record.container, kinds: {}, label: labelOf({ record }), source: record.source };
      tallies.set(key, tally);
    }
    const previous = tally.kinds[record.kind];
    if (previous === undefined) {
      tally.kinds[record.kind] = { offered: field === "offered" ? 1 : 0, written: field === "written" ? 1 : 0 };
      return;
    }
    tally.kinds[record.kind] = { ...previous, [field]: previous[field] + 1 };
  };
  for (const record of offered) {
    bump({ field: "offered", record });
  }
  for (const record of written) {
    bump({ field: "written", record });
  }
  return [...tallies.values()];
}
