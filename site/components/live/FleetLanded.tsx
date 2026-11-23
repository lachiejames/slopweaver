"use client";

/*
 * The Past view's release history: what landed on main, one row per change, each beside the owner's words that asked
 * for it and the proof it carried. Not prominent by default, something the owner goes
 * looking for; each landed pull request's number, a link, and a direct quote from the owner next to it; the proof expandable
 * beneath — "that problem I spoke about with those exact words is now fixed and here's the proof". So every row is one
 * line until opened, and a change with no words from the owner says so rather than borrowing a rule's.
 */

import type { ReactElement } from "react";

import { ageOf } from "../../lib/ageOf";
import { clauseAfter } from "../../lib/clauseJoin";
import { FLEET_SHOWN } from "../../lib/fleetViews";
import { LANDED_LOOKED_KEY, landedSince, landedSinceLine } from "../../lib/landedLooked";
import { cn } from "../../lib/utils";
import { CitationChip } from "../console/CitationChip";
import { InlineText } from "../console/InlineText";
import { SourceBlock } from "../console/SourceBlock";
import { StaleMark } from "../console/StaleMark";
import { FleetMore } from "./FleetMore";
import { Field, ROW_DETAIL, Row } from "./Row";
import type { LandedProofView, LandedReportView, LandedUnderView, LandedView, LandedWordsView } from "./readLanded";
import { useLastLooked } from "./useLastLooked";

/** The frame a block the page wrote itself draws, matching `../console/SourceBlock.tsx`'s tones. */
const FRAME: Readonly<Record<"owner" | "quiet" | "refused", string>> = {
  owner: "border-l-[3px] border-primary/70 bg-primary/5",
  quiet: "border-l-[3px] border-muted-foreground/30",
  refused: "border-l-[3px] border-warning/70 bg-warning/10",
};

/** The short word after a row's title saying whose words are behind it, so the list reads at a glance. */
const WORDS_MARK: Readonly<Record<LandedWordsView["kind"], string>> = {
  asked: "your words",
  elsewhere: "linked elsewhere",
  "not-joined": "not joined",
  ruling: "your ruling",
  unasked: "unasked",
  unread: "words not shown",
};

/** A source block whose copy is the page's own — a session's record of a ruling, a change joined to no row. */
function PageSource({
  label,
  quote,
  line,
  tone,
}: {
  label: string;
  quote: string | undefined;
  line: string;
  tone: keyof typeof FRAME;
}): ReactElement {
  return (
    <section className={cn("mb-2 grid gap-1 rounded-r-md px-3 py-2", FRAME[tone])}>
      <h4 className="m-0 text-[0.68rem] font-bold tracking-[0.06em] text-muted-foreground uppercase">{label}</h4>
      {quote !== undefined && (
        <blockquote className="m-0 text-[0.9rem] leading-[1.5] whitespace-pre-wrap">{quote}</blockquote>
      )}
      <p className="m-0 text-[0.78rem] text-muted-foreground">{line}</p>
    </section>
  );
}

/** The owner's words behind a change, or what is there instead. */
function WordsBlock({ words }: { words: LandedWordsView }): ReactElement {
  switch (words.kind) {
    case "asked": {
      const { anchor, atIso, cut, where } = words;
      return (
        <SourceBlock
          source={{
            bearsOn: undefined,
            kind: "words",
            quote: { anchor, atIso, cut, where, words: words.words },
            steers: [],
          }}
        />
      );
    }
    case "ruling": {
      const { anchor, atIso, cut, where } = words;
      return (
        <>
          <SourceBlock
            source={{
              bearsOn: undefined,
              kind: "words",
              quote: { anchor, atIso, cut, where, words: words.words },
              steers: [],
            }}
          />
          <PageSource
            label="your ruling on its row, before it landed"
            quote={undefined}
            line={`As the session that heard it recorded it, not in your words: ${words.recorded}`}
            tone="quiet"
          />
        </>
      );
    }
    case "elsewhere": {
      return <SourceBlock source={{ anchor: words.anchor, kind: "elsewhere", steers: [] }} />;
    }
    case "unasked": {
      return <SourceBlock source={{ kind: "none", origin: words.why, steers: [] }} />;
    }
    case "unread": {
      // A read the owner's words come from failed, or kept no quote of them: the mark names which and why, in their place.
      return (
        <section className={cn("mb-2 grid gap-1 rounded-r-md px-3 py-2", FRAME.refused)}>
          <h4 className="m-0 text-[0.68rem] font-bold tracking-[0.06em] text-muted-foreground uppercase">
            words behind it
          </h4>
          <StaleMark facts={[{ subject: "your words behind this change", why: words.why }]} className="self-start" />
        </section>
      );
    }
    case "not-joined": {
      return (
        <PageSource
          label="where this came from"
          quote={undefined}
          line={`Not joined to a board row: ${words.why}.`}
          tone="quiet"
        />
      );
    }
    default: {
      const exhausted: never = words;
      return exhausted;
    }
  }
}

/** The standing rule the fleet's last act on it ran under — never drawn as the owner's words on the change. */
function underValue({ under }: { under: LandedUnderView }): string | ReactElement {
  switch (under.kind) {
    case "rule": {
      return `the fleet's last act on it (${under.actKind}) ran under your standing rule ${under.classId}, which its register records as: ${under.words} (${under.anchor})`;
    }
    case "none": {
      return "no act the fleet recorded on this pull request was settled by a standing rule of yours";
    }
    case "unread": {
      return <StaleMark facts={[{ subject: "the autonomy register", why: under.why }]} />;
    }
    default: {
      const exhausted: never = under;
      return exhausted;
    }
  }
}

/** The proof's summary line: a description publishes no grade, so it says so, then how its checks stood. */
function proofHead({ proof }: { proof: Extract<LandedProofView, { kind: "recorded" }> }): string {
  const proven = proof.claims.filter((one) => one.verdict === "proven").length;
  return `proof: no published grade · ${String(proven)} of ${String(proof.claims.length)} checked`;
}

/** The proof the description carried, folded once more beneath the words. */
function ProofBlock({ proof }: { proof: LandedProofView }): ReactElement {
  if (proof.kind === "unrecorded") {
    return (
      <Field
        label="proof"
        value={<StaleMark facts={[{ subject: "the proof this change carried", why: proof.why }]} />}
      />
    );
  }
  return (
    <details className="mt-1 mb-1">
      <summary className="cursor-pointer text-muted-foreground">{proofHead({ proof })}</summary>
      <div className="mt-1">
        <Field label="problem" value={<InlineText text={proof.problem} />} />
        {proof.before !== undefined && (
          <Field label="before" value={<InlineText text={`${proof.before.where}: ${proof.before.evidence}`} />} />
        )}
        {proof.after !== undefined && (
          <Field label="after" value={<InlineText text={`${proof.after.where}: ${proof.after.evidence}`} />} />
        )}
        <ul className={ROW_DETAIL}>
          {proof.claims.map((one, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- a claim has no id, and one may be stated twice
            <li key={`${String(index)}-${one.claim}`}>
              {one.verdict} · <InlineText text={one.claim} />: <InlineText text={one.detail} />
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/** One landed change: its number and title, and the owner's words, the rule and the proof behind the fold. */
function LandedLine({ landing }: { landing: LandedView }): ReactElement {
  let number = landing.sha.slice(0, 10);
  if (landing.number !== undefined) {
    number = `#${String(landing.number)}`;
  }
  const lead = (
    <>
      {number} {landing.title}{" "}
      <span className="text-[0.72rem] text-muted-foreground">· {WORDS_MARK[landing.words.kind]}</span>
    </>
  );
  return (
    <Row lead={lead} tag={ageOf({ iso: landing.mergedIso })}>
      <WordsBlock words={landing.words} />
      <Field label="standing rule" value={underValue({ under: landing.under })} />
      <ProofBlock proof={landing.proof} />
      {landing.url !== undefined && (
        <Field
          label="pull request"
          value={
            <a href={landing.url} rel="noreferrer">
              {number}
            </a>
          }
        />
      )}
      {landing.row !== undefined && (
        <Field
          label="board row"
          value={
            <CitationChip reference={{ kind: "board-row", slug: landing.row.slug }}>{landing.row.slug}</CitationChip>
          }
        />
      )}
    </Row>
  );
}

/**
 * The landed history: how many changes are new since the owner last looked, then one row per change, ten shown.
 *
 * @param report what `fleet landed --json` read
 * @returns the list
 */
export function LandedList({ report }: { report: LandedReportView }): ReactElement {
  const looked = useLastLooked({ key: LANDED_LOOKED_KEY });
  const since = landedSince({ landings: report.landings, limit: report.limit, lookedIso: looked });
  if (report.landings.length === 0) {
    return <p className="sw-tile-note">nothing has landed on {report.ref} in this checkout</p>;
  }
  const shown = report.landings.slice(0, FLEET_SHOWN);
  const folded = report.landings.slice(FLEET_SHOWN);
  return (
    <>
      <p className="m-0 text-[0.8rem] text-muted-foreground">
        {landedSinceLine({ shown: report.landings.length, since })} · {report.ref} at {report.refSha.slice(0, 10)}
      </p>
      {report.ledgerUnread.length > 0 && (
        <StaleMark
          facts={report.ledgerUnread.map((file) => ({
            subject: `the PR-ledger file ${file.file}`,
            why: clauseAfter({
              clause: "a change shown as joined may have a second record nobody could see",
              joint: ":",
              reason: file.why,
            }),
          }))}
          className="self-start"
        />
      )}
      <div>
        {shown.map((landing) => (
          <LandedLine key={landing.sha} landing={landing} />
        ))}
      </div>
      <FleetMore
        label={`and ${String(folded.length)} more`}
        rows={folded}
        render={(landing) => <LandedLine key={landing.sha} landing={landing} />}
      />
    </>
  );
}
