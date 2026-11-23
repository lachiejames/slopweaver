/**
 * The three `refresh` flags that bound a Notion crawl — `--notion-block-depth`, `--notion-item-calls` and
 * `--notion-item-time` — and the two refusals they carry. Pure; `./core.ts`'s flag parser calls both.
 *
 * A cap flag that was not given means the SHIPPED cap ({@link DEFAULT_NOTION_CAPTURE_CAPS}), by design: the
 * flags exist to lift or tighten a bound, never to be the only thing that sets one.
 */
import {
  DEFAULT_NOTION_CAPTURE_CAPS,
  liftedCapsAreBounded,
  type NotionCaptureCaps,
} from "../../../corpus/notion/caps.js";
import { parseDuration } from "../../../lib/duration.js";
import { parsePositiveInteger } from "../../optionParsers.js";

/**
 * One integer cap: the flag's value, or the shipped cap when the flag was not given. A malformed value pushes
 * its refusal and also reads as the shipped cap, because the run is refused on that error before the caps
 * are crawled under.
 *
 * @param cap which shipped cap the flag bounds
 * @param value the raw flag value, when the flag was given one
 * @param label the flag name, for the refusal
 * @param errors the accumulating error list (mutated)
 * @returns the cap this run crawls under
 */
function integerCap({
  cap,
  value,
  label,
  errors,
}: {
  cap: "itemCallBudget" | "maxBlockDepth";
  value: string | undefined;
  label: string;
  errors: string[];
}): number {
  if (value === undefined) {
    return DEFAULT_NOTION_CAPTURE_CAPS[cap];
  }
  const parsed = parsePositiveInteger({ errors, label, value });
  if (parsed === undefined) {
    return DEFAULT_NOTION_CAPTURE_CAPS[cap];
  }
  return parsed;
}

/**
 * The per-item time cap: `--notion-item-time` as a duration (`30m`, `4h`), or the shipped cap when it was not
 * given — and the shipped cap is NO time bound. A malformed value pushes its refusal and reads as the shipped
 * cap, by {@link integerCap}'s reasoning.
 *
 * @param value the raw flag value, when the flag was given one
 * @param errors the accumulating error list (mutated)
 * @returns the time cap in milliseconds, or `undefined` for the shipped unbounded default
 */
function timeCap({ value, errors }: { value: string | undefined; errors: string[] }): number | undefined {
  if (value === undefined) {
    return DEFAULT_NOTION_CAPTURE_CAPS.itemTimeBudgetMs;
  }
  const parsed = parseDuration({ value });
  if ("error" in parsed) {
    errors.push(`--notion-item-time ${parsed.error}`);
    return DEFAULT_NOTION_CAPTURE_CAPS.itemTimeBudgetMs;
  }
  return parsed.ms;
}

/**
 * Build the Notion capture caps from the three flag values, each falling back to its shipped cap. Pure.
 *
 * @param values the parsed flag values
 * @param errors the accumulating error list, pushed to on a bad value in flag order
 * @returns the caps this run will crawl under
 */
export function parseNotionCaps({
  values,
  errors,
}: {
  values: Readonly<Record<string, string | undefined>>;
  errors: string[];
}): NotionCaptureCaps {
  const depth = integerCap({
    cap: "maxBlockDepth",
    errors,
    label: "--notion-block-depth",
    value: values["notion-block-depth"],
  });
  const calls = integerCap({
    cap: "itemCallBudget",
    errors,
    label: "--notion-item-calls",
    value: values["notion-item-calls"],
  });
  const timeMs = timeCap({ errors, value: values["notion-item-time"] });
  return { itemCallBudget: calls, itemTimeBudgetMs: timeMs, maxBlockDepth: depth };
}

/**
 * The two refusals the Notion cap flags carry. Pure.
 *
 * **A lifted cap with no time bound is refused**, not warned about. A catch-up measured pages
 * that spent the whole 400-request budget and were STILL truncated, one after 23.5 minutes — so raising that
 * budget removes the only thing that ended them and leaves the run with no measured worst case per item at
 * all. A crawl that cannot be bounded cannot be scheduled, which is the property `--if-stale` and the refresh
 * slot exist to protect; `caps.ts` carries the numbers.
 *
 * **A cap flag with no Notion in the selection is refused** for the same reason `--stale-after` needs
 * `--if-stale`: a bare `refresh` means GitHub, so a caller who typed a bound and got a GitHub run has been
 * told nothing, and the expensive run they were shaping never happened.
 *
 * @param notionCaps the caps parsed from the tail
 * @param values the parsed flag values, so an ABSENT flag is distinguishable from one set to its default
 * @param sources the raw `--source` values
 * @returns the refusal lines, empty when the combination is coherent
 */
export function notionCapDiagnostics({
  notionCaps,
  values,
  sources,
}: {
  notionCaps: NotionCaptureCaps;
  values: Readonly<Record<string, string | undefined>>;
  sources: readonly string[];
}): readonly string[] {
  const named = ["notion-block-depth", "notion-item-calls", "notion-item-time"].filter(
    (flag) => values[flag] !== undefined,
  );
  if (named.length === 0) {
    return [];
  }
  const errors: string[] = [];
  if (!sources.includes("notion")) {
    errors.push(
      `--${named[0]!} only means anything with \`--source notion\` — a bare refresh means GitHub, so this run ` +
        "would have ignored the bound you typed",
    );
  }
  if (!liftedCapsAreBounded({ caps: notionCaps })) {
    errors.push(
      "lifting --notion-block-depth or --notion-item-calls needs --notion-item-time alongside it: a page that " +
        "already spent 400 requests and 23.5 minutes without finishing has no measured upper bound once the " +
        "request budget is raised, and a run with no upper bound cannot be scheduled",
    );
  }
  return errors;
}
