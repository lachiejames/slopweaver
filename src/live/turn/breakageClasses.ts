/**
 * WHO WRITES each class of loop breakage — the per-class decision behind retiring the skills' `printf >>`.
 *
 * `loop-breakage.jsonl` was written by an agent mid-turn, which is the one party least able to stop
 * (`../../admit/painPoint.ts`'s diagnosis). Measured over the 521 rows then in the ledger,
 * by the `what` field's leading verb (`grep -oE '"what": ?"(turn review opened|scheduler-tick|session
 * respawn loop --[a-z]+|turn dispatch|listener|turn answer|witness|listen recover)'
 * "$SLOPWEAVER_HOME/ledgers/loop-breakage.jsonl" | sort | uniq -c`): almost every row belongs to a class the
 * CODE already knew had happened. Each such class is declared here with the module that now writes its
 * record, so a session never has to remember to; what is left is the residue only a session's judgement
 * can name, and that goes through `slopweaver turn breakage`, which refuses a row with no cause.
 *
 * Four dispositions, and the difference matters:
 *
 * - `code` — written into THIS ledger by code, at the moment the code learns of it.
 * - `elsewhere` — already journalled by code into another ledger. Writing a loop-breakage row there as well
 *   would record one incident twice in two authoritative places, so it is deliberately not done.
 * - `retired` — the defect that produced the rows is fixed, or the component is gone.
 * - `judgement` — the code cannot see it; a session records it with a cause.
 *
 * Counts are not carried here: they are a dated measurement, and this file states current ownership.
 *
 * ## A judgement class that leaves no row moves OUT of judgement
 *
 * The first full day of loop after this registry landed broke three
 * times and the ledger gained zero rows, every one a `judgement` break no session recorded. So each was moved:
 * a late previous-round verdict is now archived and recorded by `turn review --poll` (`reviewer-late-verdict`);
 * a hook killed mid-call is already censused out of the session transcripts that carry its stderr line
 * (`hook-kill` — not ask-scoped, and a per-call append is the cost `hooks/lib/bounded-run.sh` refuses); and a
 * `turn answer` refusal whose named route the door itself ignored was a defect, fixed in `./threadFreshness.ts`
 * rather than counted. That is the shape for the next one: a judgement class that keeps going unrecorded is a
 * class the code should own, or a defect the code should stop producing.
 */

/** Who writes a breakage class's record. */
type BreakageWriter =
  | { readonly kind: "code"; readonly module: string }
  | {
      readonly kind: "elsewhere";
      readonly module: string;
      readonly record: "ask-lifecycle" | "listener-arms" | "session-transcripts";
    }
  | { readonly kind: "retired"; readonly why: string }
  | { readonly kind: "judgement" };

/** One class of breakage, the rows it covers, and who owns its record. */
export interface BreakageClass {
  /** A stable id for the class. */
  readonly id: string;
  /** How a row of this class reads in the ledger's `what` field, so a reader can tell which class it is. */
  readonly selector: string;
  /** Who writes it. */
  readonly writer: BreakageWriter;
}

/** Every measured class, ending in the one residue class that catches everything no other row names. */
export const BREAKAGE_CLASSES: readonly BreakageClass[] = [
  {
    id: "turn-review-round",
    selector: "`turn review opened round N` — a round past the cap, or one opening on a blank page",
    writer: { kind: "code", module: "src/cli/commands/turn/reviewLedger.ts" },
  },
  {
    id: "reviewer-death",
    selector: "`the reviewer for this ask died before writing a verdict`",
    writer: { kind: "code", module: "src/cli/commands/turn/reviewLedger.ts" },
  },
  {
    id: "reviewer-late-verdict",
    selector: "`turn review --poll found a late verdict from <reviewer>` — a previous round's verdict over this one's",
    writer: { kind: "code", module: "src/cli/commands/turn/reviewLedger.ts" },
  },
  {
    id: "turn-dispatch",
    selector: "`turn dispatch` — a fresh-session pickup that never landed",
    writer: { kind: "elsewhere", module: "src/cli/commands/turn/dispatchFreshRecords.ts", record: "ask-lifecycle" },
  },
  {
    id: "listener-death",
    selector: "`listener` — an arm that died; `listen supervise` journals the death with its log tail",
    writer: { kind: "elsewhere", module: "src/live/listen/supervise/store.ts", record: "listener-arms" },
  },
  {
    id: "hook-kill",
    selector:
      "`<hook>: killed after Ns without finishing` / `without a verdict` — a bounded hook call that decided nothing",
    writer: { kind: "elsewhere", module: "src/transcripts/hookDuration.ts", record: "session-transcripts" },
  },
  {
    id: "scheduler-tick",
    selector: "`scheduler-tick` — the recipe scheduler's dispatch",
    writer: { kind: "retired", why: "the recipe scheduler is retired; automations are seated per pass" },
  },
  {
    id: "session-respawn",
    selector: "`session respawn loop --successor` / `--confirm` — a stale or missing successor record",
    writer: {
      kind: "retired",
      why: "every boot now replaces the record and --confirm passes only while the confirmed arm is live",
    },
  },
  {
    id: "turn-answer",
    selector: "`turn answer` — an answer refused at send time",
    writer: { kind: "judgement" },
  },
  {
    id: "witness",
    selector: "`witness` — a witness line judged or dispatched wrongly",
    writer: { kind: "judgement" },
  },
  {
    id: "residue",
    selector: "anything no other class names",
    writer: { kind: "judgement" },
  },
];

/** What one writer means for a session about to record a row, in the words `turn breakage --classes` prints. */
function writerLine({ writer }: { writer: BreakageWriter }): string {
  switch (writer.kind) {
    case "code": {
      return `code writes it (${writer.module}) — do not record it by hand`;
    }
    case "elsewhere": {
      return `journalled in the ${writer.record} record (${writer.module}) — do not record it here`;
    }
    case "retired": {
      return `retired: ${writer.why}`;
    }
    case "judgement": {
      return "yours to record, with `turn breakage --cause`";
    }
    default: {
      const unreachable: never = writer;
      return unreachable;
    }
  }
}

/**
 * Render the class table `slopweaver turn breakage --classes` prints, so a session asks the verb which rows
 * are its own to write rather than reading this file. Pure.
 *
 * @param classes the classes to render, in order
 * @returns one block per class: its id and selector, then who writes it
 */
export function breakageClassLines({ classes }: { classes: readonly BreakageClass[] }): readonly string[] {
  return classes.flatMap((entry) => [`${entry.id} — ${entry.selector}`, `  ${writerLine({ writer: entry.writer })}`]);
}
