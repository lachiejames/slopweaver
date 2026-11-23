/**
 * The Fleet Briefing's "Nothing stale" section — everything the owner owns across five surfaces, each row
 * moving on a receipt, waiting on a named person, or asking the owner one word, and every row that is none of
 * those counted as known stale.
 *
 * ## It reports, and it never acts
 *
 * Rule 10: no send, close, settle, enqueue or provider call is anywhere on this path. The inputs are local
 * documents other standing rows already wrote; the output is one {@link BriefingSection}. Answering any of its
 * questions is a separate door, taken later, in a visible session.
 *
 * ## The order of judgement
 *
 * Each document is first judged CURRENT against its producing row's own cadence (`./nothingStaleFreshness.ts`),
 * so a document a row stopped refreshing becomes a named gap rather than a confident old answer. The current
 * ones are classified (`./nothingStaleClassify.ts`), laid out (`./nothingStaleRender.ts`), weighed against
 * {@link NOTHING_STALE_SECTION_MAX_BYTES}, and validated against the briefing's own fixed-id section schema.
 * Over budget, every list is withheld whole and the counts stand — never trimmed — because `supervisor tick
 * close` renders this section on every close, and one long quoted field must not stop the page rendering at
 * all. Only a section over budget even as counts, or one the schema refuses, is refused.
 *
 * Pure: `nowIso` is supplied, and nothing here reads a file.
 */
import { err, ok, type Result } from "#lib/result.js";

import { nothingStaleSectionSchema } from "../outbound/briefing/sectionSchema.js";
import type { BriefingSection } from "../outbound/briefing/types.js";
import { classifyNothingStale } from "./nothingStaleClassify.js";
import { type NothingStaleSectionError, NothingStaleSectionErrors } from "./nothingStaleErrors.js";
import { currentOnly } from "./nothingStaleFreshness.js";
import {
  contentBytes,
  itemsInSectionOrder,
  renderNothingStaleSection,
  sectionTextBytes,
} from "./nothingStaleRender.js";
import type { NothingStaleInputs, NothingStaleProjection } from "./nothingStaleTypes.js";

/**
 * The most text the section may carry, in UTF-8 bytes.
 *
 * Sixty-four kibibytes. MEASURED over the owner's real documents, read-only: the widest landing
 * read on this machine (48 rows — find it with
 * `for f in ~/.slopweaver/readings/github-landing/*.json; do echo "$(jq '.rows|length' "$f") $f"; done | sort -n | tail -1`)
 * beside the live `slopweaver cycle reconcile --json` (9 proposals), `slopweaver sweep board --json` (57
 * findings) and `slopweaver slack owed --json` (45 threads) came to **42,856 bytes** of section text by
 * {@link sectionTextBytes}; the newest landing read (28 rows) came to 39,539. Reproduce by writing those four
 * outputs into a temp home's `live/hygiene/` and `live/slack/owed.json` and rendering with
 * `slopweaver briefing render --home <tmp> --nothing-stale`, or by calling {@link projectNothingStale} over
 * them with `cap: Number.MAX_SAFE_INTEGER` and reading {@link sectionTextBytes} of the result.
 *
 * The cap is half again that widest morning, and a quarter of `PAGE_TEXT_MAX_BYTES` (256 KiB), so this one
 * section can never crowd the rest of the page out on its own. Over it, every list is withheld whole and only
 * the counts render — never a trimmed list.
 *
 * A second measurement under the receipt rule, on the live home: **49,058 bytes** — 104 stale, 7 moving, 4
 * waiting, 11 asking the owner — from
 * `node --input-type=module -e "const p = await import('./dist-cli/cli/commands/briefing/nothingStaleProjection.js'); const r = await import('./dist-cli/briefing/nothingStaleRender.js'); const s = p.gatherNothingStaleSection({ home: process.env.HOME + '/.slopweaver', nowIso: new Date().toISOString() }); console.log(r.sectionTextBytes({ section: s._unsafeUnwrap() }));"`
 * after `slopweaver dev build`. Three quarters of the cap, and the stale count is what the sweep drives down.
 */
export const NOTHING_STALE_SECTION_MAX_BYTES = 64 * 1024;

/**
 * Every document resolved to its current form, or to the gap naming why it is not.
 *
 * @param inputs every document as it was read
 * @param nowIso the instant the section is read at
 * @returns the same inputs, a stale document turned into a gap
 */
function currentInputs({
  inputs,
  nowIso,
}: {
  readonly inputs: NothingStaleInputs;
  readonly nowIso: string;
}): NothingStaleInputs {
  return {
    board: currentOnly({ input: inputs.board, label: "the board findings", nowIso }),
    boardCensus: currentOnly({ input: inputs.boardCensus, label: "the board's verdict count", nowIso }),
    followedThreads: currentOnly({ input: inputs.followedThreads, label: "the followed-thread read", nowIso }),
    linearCycle: currentOnly({ input: inputs.linearCycle, label: "the Linear cycle report", nowIso }),
    pullRequests: currentOnly({ input: inputs.pullRequests, label: "the pull-request landing read", nowIso }),
    runs: inputs.runs,
  };
}

/**
 * Every item past the point the budget runs out, in the order the section lists them.
 *
 * Everything that is not an item's own line — the summary, headlines, gap and bound lines — is charged first,
 * because those are what keeps a partial read from resembling a whole one.
 *
 * @param projection the classification
 * @param bytes the whole section's measured text
 * @param cap the budget
 * @returns the identities that would not have fitted
 */
function overflowIdentities({
  projection,
  bytes,
  cap,
}: {
  readonly projection: NothingStaleProjection;
  readonly bytes: number;
  readonly cap: number;
}): readonly string[] {
  const ordered = itemsInSectionOrder({ projection });
  const itemBytes = ordered.map((item) => contentBytes({ content: item.line }));
  let spent = bytes - itemBytes.reduce((sum, value) => sum + value, 0);
  return ordered.flatMap((item, index) => {
    spent += itemBytes[index]!;
    return spent > cap ? [item.identity] : [];
  });
}

/**
 * Project the "Nothing stale" section from the documents it reads.
 *
 * @param inputs every document, already read, or the gap naming why it could not be
 * @param nowIso the instant the section is read at
 * @param cap the byte budget, defaulting to the measured one; a test passes a small one to reach the refusal
 * @returns the validated section, its lists withheld when over budget, or the refusal naming why it could not
 *   render at all
 */
export function projectNothingStale({
  inputs,
  nowIso,
  cap = NOTHING_STALE_SECTION_MAX_BYTES,
}: {
  readonly inputs: NothingStaleInputs;
  readonly nowIso: string;
  readonly cap?: number;
}): Result<BriefingSection, NothingStaleSectionError> {
  const projection = classifyNothingStale({ inputs: currentInputs({ inputs, nowIso }) });
  const whole = renderNothingStaleSection({ projection });
  const bytes = sectionTextBytes({ section: whole });
  let section = whole;
  if (bytes > cap) {
    section = renderNothingStaleSection({ projection, withheld: { bytes, cap } });
    const countOnly = sectionTextBytes({ section });
    if (countOnly > cap) {
      return err(
        NothingStaleSectionErrors.sectionOverBudget({
          bytes: countOnly,
          cap,
          overflowIdentities: overflowIdentities({ bytes, cap, projection }),
        }),
      );
    }
  }
  const parsed = nothingStaleSectionSchema.safeParse(section);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`);
    return err(NothingStaleSectionErrors.sectionSchemaRefused({ issues }));
  }
  return ok(section);
}
