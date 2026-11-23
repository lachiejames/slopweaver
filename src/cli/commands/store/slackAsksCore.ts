/**
 * The pure half of `slopweaver store slack-asks`: what its flags mean, and what the ask-lifecycle ledger's
 * stored bytes say about every Slack ask the bot was tagged on — which were answered and which were stranded.
 *
 * The fold is the live one (`../../../live/ask/lifecycle.ts`), so this reads the same ledger the listener,
 * `listen recover` and the dispatch sweep read, and "stranded" is `../../../live/listen/stranded.ts`'s own set.
 * No I/O: `./slackAsksRun.ts` fetches the bytes from the store.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type AskLifecycleState, foldAskLifecycle, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { STRANDED_STATES } from "../../../live/listen/stranded.js";
import { parseFlagTail } from "../../optionParsers.js";

/** Where the ledger sits under the home — the path the store keyed its rows on. */
export const SLACK_ASKS_RELATIVE_PATH = "live/slack/asks.jsonl";

/** `slack-asks`'s flag tail; `helpTruth.test.ts` holds it to the usage line through the parser. */
const SLACK_ASKS_FLAG_SPEC = { boolean: ["json", "stranded"], value: ["home"] } as const satisfies {
  boolean: readonly string[];
  value: readonly string[];
};

/** A parsed `slack-asks`. */
export interface SlackAsksArgs {
  readonly home: string | undefined;
  readonly json: boolean;
  /** Print only the stranded asks; the counts still cover every ask. */
  readonly stranded: boolean;
}

/**
 * Parse `slack-asks`'s flag tail.
 *
 * @param rest the argv after `store slack-asks`
 * @returns the arguments, or the tokeniser's rejections
 */
export function parseSlackAsksArgs({ rest }: { rest: readonly string[] }): Result<SlackAsksArgs> {
  const parsed = parseFlagTail({ rest, spec: SLACK_ASKS_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return ok({ home: values["home"], json: flags.has("json"), stranded: flags.has("stranded") });
}

/** One ask, folded to where it ended. */
export interface SlackAskRow {
  readonly channel: string;
  readonly messageTs: string;
  readonly state: AskLifecycleState;
  /** Worked and ended with no answer — `STRANDED_STATES`. */
  readonly stranded: boolean;
  readonly capturedIso: string;
  /** When its newest event was written. */
  readonly lastEventIso: string;
}

/** What the stored ledger says. */
export interface SlackAsksReport {
  /** Every captured ask, most recently captured first. */
  readonly asks: readonly SlackAskRow[];
  /** How many asks rest in each state, in state-name order. */
  readonly byState: readonly { readonly state: AskLifecycleState; readonly count: number }[];
  /** The 1-indexed ledger lines that would not parse — each a lost fact about a real ask, so named. */
  readonly unreadableLines: readonly number[];
}

/**
 * Fold the ledger's text into one row per ask.
 *
 * @param text the ledger's stored bytes, as UTF-8
 * @returns every ask, the count per state and the lines that would not read
 */
export function slackAsksReport({ text }: { text: string }): SlackAsksReport {
  const parsed = parseAskLifecycleLog({ text });
  const asks = [...foldAskLifecycle({ events: parsed.events }).values()]
    .map((ask): SlackAskRow => ({
      capturedIso: ask.capturedIso,
      channel: ask.channel,
      lastEventIso: ask.lastEvent.tsIso,
      messageTs: ask.messageTs,
      state: ask.state,
      stranded: STRANDED_STATES.has(ask.state),
    }))
    .toSorted((left, right) => right.capturedIso.localeCompare(left.capturedIso));
  const counts = new Map<AskLifecycleState, number>();
  for (const ask of asks) {
    const previous = counts.get(ask.state);
    counts.set(ask.state, previous === undefined ? 1 : previous + 1);
  }
  const byState = [...counts]
    .map(([state, count]) => ({ count, state }))
    .toSorted((left, right) => left.state.localeCompare(right.state));
  return { asks, byState, unreadableLines: parsed.unreadable };
}

/**
 * One ask's line: its key, its state, whether it was stranded, and when it was captured and last moved.
 *
 * @param row the folded ask
 * @returns the tab-separated line
 */
export function slackAskLine({ row }: { row: SlackAskRow }): string {
  return [
    `${row.channel}/${row.messageTs}`,
    row.state,
    row.stranded ? "stranded" : "-",
    row.capturedIso,
    row.lastEventIso,
  ].join("\t");
}

/**
 * The summary: how many asks, how many stranded, the count per state, and any line that would not read.
 *
 * @param report the folded ledger
 * @returns the diagnostic lines
 */
export function slackAsksSummaryLines({ report }: { report: SlackAsksReport }): readonly string[] {
  const stranded = report.asks.filter((ask) => ask.stranded).length;
  const lines = [
    `store slack-asks: ${String(report.asks.length)} ask(s) in the stored ledger, ${String(stranded)} stranded`,
    `  by state: ${report.byState.map((entry) => `${entry.state} ${String(entry.count)}`).join(", ")}`,
  ];
  if (report.unreadableLines.length > 0) {
    lines.push(
      `  ${String(report.unreadableLines.length)} ledger line(s) would not read: ${report.unreadableLines.join(", ")}`,
    );
  }
  return lines;
}
