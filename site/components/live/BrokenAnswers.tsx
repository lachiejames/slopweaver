"use client";

/**
 * The five answers a broken or paused automation owes the owner, at the top of its open card: why, how
 * long, who fixes it and where that stands, what is worse while it is down, and what runs instead. Plain words only —
 * an identifier (the board row, the owner's recorded pause reason, the row's own id) and the record the answers were told
 * from sit in the card's Technical detail fold (`./AutomationCard.tsx`).
 *
 * Every sentence is the verb's (`src/automations/brokenAccount.ts`); this file only says its instants in the owner's clock.
 * The answer to why leads with what went wrong in one plain sentence when the record supports one, then the
 * scheduler's state, and folds the run's whole record under `RawFold` — never quoted above the fold, and never the
 * shortened words the verb extracted from it.
 */
import type { ReactElement, ReactNode } from "react";

import { ageOf } from "../../lib/ageOf";
import { fullMessageOf } from "../../lib/plainReason";
import { clockWords } from "../../lib/runTimeline";
import { cn } from "../../lib/utils";
import { RawFold } from "../console/RawFold";
import { readerZone } from "./AutomationDetail";
import type { BrokenAccount } from "./readAutomationsAccount";
import type { Automation } from "./readAutomationsCard";

/** Who the fix rests on, as the line that leads the answer. */
const FIX_LEAD: Readonly<Record<BrokenAccount["fix"]["by"], { readonly label: string; readonly tone: string }>> = {
  fleet: { label: "Nothing for you to do.", tone: "text-success" },
  unknown: { label: "Nobody is named for it.", tone: "text-warning" },
  you: { label: "This needs you.", tone: "font-semibold text-danger" },
};

/**
 * One question and its answer.
 *
 * @returns the question as a small heading over its answer
 */
export function Answer({ question, children }: { question: string; children: ReactNode }): ReactElement {
  return (
    <div>
      <p className="m-0 text-[0.7rem] font-semibold tracking-[0.03em] text-muted-foreground uppercase">{question}</p>
      <div className="text-[0.8rem]">{children}</div>
    </div>
  );
}

/** How long: when it broke or was paused, when it last worked, and for a sync how fresh its copy is. */
/** The run's whole record under "Full message", or nothing when the account carries none. */
function BrokenFold({ account }: { account: BrokenAccount }): ReactElement | null {
  const raw = fullMessageOf({ account });
  return raw === undefined ? null : <RawFold raw={raw} />;
}

function HowLong({ account, when }: { account: BrokenAccount; when: (args: { iso: string }) => string }): ReactElement {
  const lines: string[] = [];
  if (account.sinceIso !== undefined) {
    lines.push(`Since ${when({ iso: account.sinceIso })}.`);
  }
  if (account.lastWorkedIso !== undefined) {
    lines.push(`It last worked ${when({ iso: account.lastWorkedIso })}.`);
  }
  if (account.freshness?.lastCompleteIso !== undefined) {
    lines.push(`Its last complete sync was ${when({ iso: account.freshness.lastCompleteIso })}.`);
  }
  if (account.freshness?.newestRowsIso !== undefined) {
    lines.push(`The newest rows it stored landed ${when({ iso: account.freshness.newestRowsIso })}.`);
  }
  if (lines.length === 0) {
    lines.push("Nothing on record says when it started.");
  }
  return (
    <>
      {lines.map((line) => (
        <span className="block" key={line}>
          {line}
        </span>
      ))}
    </>
  );
}

/**
 * The five answers, for a broken or paused automation.
 *
 * @param nowIso the page's reading instant, which decides "today"
 * @returns the answers, or nothing for a row that is neither broken nor paused
 */
export function BrokenAnswers({ automation, nowIso }: { automation: Automation; nowIso: string }): ReactElement | null {
  const { account } = automation;
  if (account === undefined) {
    return null;
  }
  const timeZone = readerZone();
  const when = ({ iso }: { iso: string }): string => `${clockWords({ iso, nowIso, timeZone })} (${ageOf({ iso })})`;
  const paused = account.state === "paused";
  const lead = FIX_LEAD[account.fix.by];
  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-md border border-solid p-2",
        paused ? "border-border" : "border-danger/40 bg-danger/5",
      )}
    >
      <Answer question={paused ? "Why is it paused?" : "Why is it broken?"}>
        {account.plainly === undefined ? null : <span className="block font-medium">{account.plainly}</span>}
        <span className="block">{account.why}</span>
        <BrokenFold account={account} />
      </Answer>
      <Answer question={paused ? "How long has it been paused?" : "How long has it been broken?"}>
        <HowLong account={account} when={when} />
      </Answer>
      <Answer question="Who fixes it, and where does that stand?">
        <span className={lead.tone}>{lead.label}</span> {account.fix.words}
        {account.fix.sinceIso === undefined || paused ? null : (
          <span className="block text-muted-foreground">On the board since {when({ iso: account.fix.sinceIso })}.</span>
        )}
      </Answer>
      <Answer question={paused ? "What is missing while it is paused?" : "What is worse while it is broken?"}>
        {account.worse}
      </Answer>
      <Answer question="What is happening instead?">
        <ul className="m-0 pl-4">
          {account.meanwhile.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Answer>
    </section>
  );
}
