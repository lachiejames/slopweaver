/**
 * The slice of `session watch --json-report` that `slopweaver supervisor tick-draft` reads, and the row it rebuilds
 * from it — the producer's side of the watch contract, split from `./tickDraftShapes.ts` when that file crossed the
 * file-size ratchet. The watch report is the one producer whose rows are rebuilt as the producer's own type, so its
 * slice and that rebuild travel together.
 */
import { z } from "zod";
import type { SessionWatchRow } from "../sessions/watchReport.js";
import { isoInstant } from "./tickDraftShapes.js";

/**
 * A string the producer may have left empty, as the absent value its naming rule falls past.
 *
 * @param value the field as the document carried it
 * @returns the value, or `undefined` when it was absent or empty
 */
function present({ value }: { value: string | undefined }): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}

/** One row of `session watch --json-report`. */
const watchRowSlice = z.object({
  attentionKind: z.enum(["notification", "question"]).optional(),
  cwd: z.string().optional(),
  host: z.string().optional(),
  lastActivityAtIso: z.string().optional(),
  lastEventName: z.string().min(1),
  manager: z.boolean().optional(),
  mapped: z.boolean(),
  openedAtIso: z.string().optional(),
  quietMinutes: z.number().int().nonnegative(),
  sessionId: z.string().optional(),
  sessionTitle: z.string().optional(),
  signal: z.enum(["needs-input", "logged-out", "limit-retrying", "working", "idle", "silent"]),
  title: z.string().optional(),
  toolCalls: z.number().int().nonnegative(),
  workspaceId: z.string().min(1),
  workspaceRef: z.string().optional(),
});

/** The slice of `session watch --json-report` the watch facts map. */
export const watchSlice = z.object({
  diagnostics: z.array(z.string().min(1)),
  observedAtIso: isoInstant,
  rows: z.array(watchRowSlice),
  suppressed: z.number().int().nonnegative(),
});

/**
 * One watch row, rebuilt as the producer's own row so its own naming and detail phrases describe it.
 *
 * @param row the parsed row
 * @returns the producer's row type
 */
export function sessionWatchRowOf({ row }: { row: z.output<typeof watchRowSlice> }): SessionWatchRow {
  return {
    attentionKind: row.attentionKind,
    cwd: present({ value: row.cwd }),
    host: present({ value: row.host }),
    lastActivityAtIso: present({ value: row.lastActivityAtIso }),
    lastEventName: row.lastEventName,
    manager: row.manager,
    mapped: row.mapped,
    openedAtIso: present({ value: row.openedAtIso }),
    quietMinutes: row.quietMinutes,
    sessionId: present({ value: row.sessionId }),
    sessionTitle: present({ value: row.sessionTitle }),
    signal: row.signal,
    title: present({ value: row.title }),
    toolCalls: row.toolCalls,
    workspaceId: row.workspaceId,
    workspaceRef: present({ value: row.workspaceRef }),
  };
}
