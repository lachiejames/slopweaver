/** A hand step card's fields, as the Queue card body (`./QueueCardBody.tsx`) draws them. */

import { Fragment, type ReactElement, type ReactNode } from "react";

import { type CitationReference, citedSource } from "../../lib/citationDisplay";
import type { StepCard, StepRow } from "../../lib/queueCard";
import { CitationChip } from "./CitationChip";
import { CopyBlock } from "./CopyBlock";
import { HandChecklist } from "./HandChecklist";
import { InlineText } from "./InlineText";
import { FIELDS, Options, PagesList, StakesRows } from "./QueueCardBodyFields";

/**
 * One step row's value: the place the step sends the owner (`go to`) always drawn as its citation chip, whatever its
 * scheme — the card's call to action — a place on this machine the step
 * opens drawn the same way, and anything else as the step wrote it, whose addresses {@link InlineText} chips.
 *
 * @param row the row
 * @param known the pull-request URLs the row publishes
 * @returns the value
 */
function StepValue({ row, known }: { row: StepRow; known: readonly string[] }): ReactElement {
  const local = (row.label === "open" || row.label === "cites") && !row.value.startsWith("https://");
  const address = row.label === "go to" || local;
  if (address) {
    const reference: CitationReference = { kind: "address", url: row.value };
    // Named by the place the address resolves to — a board row's slug, a page's — never its whole local URL.
    return <CitationChip reference={reference}>{citedSource({ reference }).place}</CitationChip>;
  }
  return <InlineText text={row.value} known={known} />;
}

/**
 * A hand step's PASTE and STEPS rows: its literal as one copy block, and its checklist as numbered, tickable lines,
 * each command a copy block of its own. Folded, both sit above the disclosure — they are what the owner does.
 *
 * @param card the step card
 * @param known the pull-request URLs the row publishes
 * @returns the rows, empty when the step carries neither
 */
export function StepScriptRows({ card, known }: { card: StepCard; known: readonly string[] }): ReactElement {
  return (
    <>
      {card.copy !== undefined && (
        <>
          <dt>paste</dt>
          <dd>
            <CopyBlock text={card.copy} />
          </dd>
        </>
      )}
      {card.checklist !== undefined && (
        <>
          <dt>steps</dt>
          <dd>
            <HandChecklist subject={card.subject} lines={card.checklist} known={known} />
          </dd>
        </>
      )}
    </>
  );
}

/**
 * A hand step's card: its own fields under their labels, what to paste, and — when it opens a shaped ask — that
 * ask's summary, problem, options, lean and stakes. Nothing else: a field the record left off is no row, and no line
 * here is written by the page, so the card carries none of the generic boilerplate that was about 95% of the
 * briefing it replaced.
 *
 * @param card the step card
 * @param preview a draft the step names, drawn above the options it is the subject of
 * @param links where the row can be checked, when the panel supplies them
 * @param known the pull-request URLs the row publishes
 * @param folded whether the paste and the checklist are drawn above the fold instead
 * @returns the fields
 */
export function StepFields({
  card,
  preview,
  links,
  known,
  folded,
}: {
  card: StepCard;
  preview: ReactNode;
  links: ReactNode;
  known: readonly string[];
  folded: boolean;
}): ReactElement {
  const decision = card.decision;
  // The machinery the owner does not read to act — the settling command, the cites, a `where` the chip answers — sits
  // behind one disclosure under the fields (`../../lib/stepRowFold.ts`).
  const behind = card.rows.filter((row) => row.behind === true);
  return (
    <>
      <dl className={FIELDS}>
        <StepRowList rows={card.rows.filter((row) => row.behind !== true)} known={known} />
        <StepFieldsTail card={card} preview={preview} links={links} known={known} folded={folded} decision={decision} />
      </dl>
      {behind.length > 0 && (
        <details data-step-behind="" className="group">
          <summary className="cursor-pointer text-[0.82rem] text-muted-foreground group-open:mb-[0.8rem]">
            how it settles
          </summary>
          <dl className={FIELDS}>
            <StepRowList rows={behind} known={known} />
          </dl>
        </details>
      )}
    </>
  );
}

/**
 * A run of step rows as `<dt>`/`<dd>` pairs.
 *
 * @param rows the rows, in drawn order
 * @param known the pull-request URLs the row publishes
 * @returns the pairs
 */
function StepRowList({ rows, known }: { rows: readonly StepRow[]; known: readonly string[] }): ReactElement {
  return (
    <>
      {rows.map((row, index) => (
        <Fragment key={`${row.label}-${String(index)}`}>
          <dt>{row.label}</dt>
          <dd>
            <StepValue row={row} known={known} />
          </dd>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Everything a step card draws under its own rows: the paste and the script when unfolded, its links or pages, and
 * the shaped ask it opens — summary, problem, stakes, draft, options and lean.
 *
 * @param card the step card
 * @param preview a draft the step names
 * @param links where the row can be checked, when the panel supplies them
 * @param known the pull-request URLs the row publishes
 * @param folded whether the paste and the checklist are drawn above the fold instead
 * @param decision the shaped ask the step opens, when it opens one
 * @returns the pairs
 */
function StepFieldsTail({
  card,
  preview,
  links,
  known,
  folded,
  decision,
}: {
  card: StepCard;
  preview: ReactNode;
  links: ReactNode;
  known: readonly string[];
  folded: boolean;
  decision: StepCard["decision"];
}): ReactElement {
  return (
    <>
      {!folded && <StepScriptRows card={card} known={known} />}
      {links !== undefined && (
        <>
          <dt>links</dt>
          <dd>{links}</dd>
        </>
      )}
      {links === undefined && card.pages.length > 0 && (
        <>
          <dt>pages</dt>
          <dd>
            <PagesList pages={card.pages} />
          </dd>
        </>
      )}
      {decision?.summary !== undefined && (
        <>
          <dt>ask</dt>
          <dd>
            <InlineText text={decision.summary} known={known} />
          </dd>
        </>
      )}
      {decision !== undefined && (
        <>
          <dt>problem</dt>
          <dd>
            <InlineText text={decision.problem} known={known} />
          </dd>
        </>
      )}
      {decision?.stakes !== undefined && <StakesRows stakes={decision.stakes} known={known} />}
      {preview !== undefined && (
        <>
          <dt>draft</dt>
          <dd>{preview}</dd>
        </>
      )}
      {decision !== undefined && (
        <>
          <dt>options</dt>
          <dd>
            <Options options={decision.options} known={known} />
          </dd>
          <dt>lean</dt>
          <dd>
            <InlineText text={decision.lean} known={known} />
          </dd>
        </>
      )}
    </>
  );
}
