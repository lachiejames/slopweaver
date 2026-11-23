"use client";

/**
 * The Automations page body: every automation and every corpus sync, one collapsed card each, the ones that need a
 * look first. Unreadable stores and rejected definition files sit above the cards, because a page that is quietly
 * missing rows is the silent failure it exists to end.
 *
 * Every figure is `slopweaver automation status --json`'s; this file orders and draws. The page takes no words: the
 * console's one text input is the call's chat, and the card the owner last opened is the page's open
 * item, so what the owner says there names it.
 */
import { type ReactElement, useState } from "react";

import { ageOf } from "../../lib/ageOf";
import { breaksSince, LAST_LOOKED_KEY } from "../../lib/automationsLooked";
import { provenNowOf } from "../../lib/pageEmpty";
import { pausedBy } from "../../lib/pausedBy";
import { automationsReadingOf } from "../../lib/sidebarCounts";
import { PageEmpty } from "../console/PageEmpty";
import { PlainWhy } from "../console/RawFold";
import { StaleMark } from "../console/StaleMark";
import { usePageReading } from "../voice/voiceContext";
import { AutomationCard } from "./AutomationCard";
import type { OnAutomationOpen } from "./AutomationDetail";
import { ROW_DETAIL } from "./Row";
import { type AutomationsView, readAutomations } from "./readAutomations";
import type { Automation } from "./readAutomationsCard";
import { SyncRunPanel } from "./SyncRunPanel";
import { STAT, Tile } from "./Tile";
import { useLastLooked } from "./useLastLooked";
import { useLive } from "./useLive";

/** The order a reader wants: what needs a look, then what is moving, then what is fine. */
const HEALTH_ORDER: readonly string[] = [
  "failed",
  "stuck",
  "stopped",
  "waiting",
  "running",
  "paused",
  "not-measured",
  "healthy",
  "off",
];

/**
 * Fifteen seconds: a running sync's checkpoint lands every five, and the verb answers in about three — 2.7s warm,
 * 65 rows with their postings, findings and steers (`time slopweaver automation status --json >/dev/null`).
 */
const POLL_MS = 15_000;

/** A card's rank in {@link HEALTH_ORDER}; an unknown health sorts first, so a new state cannot hide. */
function rankOf({ automation }: { automation: Automation }): number {
  const at = HEALTH_ORDER.indexOf(automation.health);
  return at < 0 ? -1 : at;
}

/** A row's failures since the mark, or `undefined` on a first look, when there is no mark to count from. */
function newBreaksOf({ automation, looked }: { automation: Automation; looked: string | null }): number | undefined {
  if (looked === null) {
    return undefined;
  }
  return breaksSince({ brokeAtIsos: automation.brokeAtIsos, lookedIso: looked });
}

/** A card's failures since the mark for ordering; a first look, with no mark to count from, sorts as none. */
function breaksCounted({ newBreaks }: { newBreaks: number | undefined }): number {
  if (newBreaks === undefined) {
    return 0;
  }
  return newBreaks;
}

/** A card's plain name, or its id where this build names it nothing. */
function nameOf({ automation }: { automation: Automation }): string {
  if (automation.name === undefined) {
    return automation.recipeId;
  }
  return automation.name;
}

/**
 * The automations that broke since the owner last looked, NAMED — a count of failed runs reads as bad only when the owner can see
 * which ones matter, so this counts automations, not runs, and says which.
 */
function SinceLooked({ view, looked }: { view: AutomationsView; looked: string | null }): ReactElement {
  if (looked === null) {
    return (
      <p className={STAT}>
        <strong>n/a</strong>
        <span>broke since you last looked: first look on this browser</span>
      </p>
    );
  }
  const broke = view.automations.filter(
    (automation) => breaksSince({ brokeAtIsos: automation.brokeAtIsos, lookedIso: looked }) > 0,
  );
  const names = broke.map((automation) => nameOf({ automation })).join(", ");
  return (
    <p className={STAT}>
      <strong className={broke.length > 0 ? "text-danger" : ""}>{broke.length}</strong>
      <span>
        broke since you last looked, {ageOf({ iso: looked })}
        {broke.length === 0 ? "" : `: ${names}`}
      </span>
    </p>
  );
}

/** The broken and paused automations by name, worst first — the figure is only as alarming as what it names. */
function Named({
  automations,
  label,
  tone,
}: {
  automations: readonly Automation[];
  label: string;
  tone: string;
}): ReactElement {
  return (
    <p className={STAT}>
      <strong className={automations.length > 0 ? tone : ""}>{automations.length}</strong>
      <span>
        {label}
        {automations.length === 0 ? "" : `: ${automations.map((automation) => nameOf({ automation })).join(", ")}`}
      </span>
    </p>
  );
}

/** The headline: what broke since the owner looked, what is broken and paused now, each by name, then the plain counts. */
function Stats({ view, looked }: { view: AutomationsView; looked: string | null }): ReactElement {
  const count = (health: string): number =>
    view.automations.filter((automation) => automation.health === health).length;
  const broken = view.automations.filter((automation) => automation.account?.state === "broken");
  const { byOwner: pausedByOwner, unowned: heldUnowned } = pausedBy({ automations: view.automations });
  if (view.rosterGap !== undefined) {
    return <StaleMark block facts={[{ subject: "the scheduled rows", why: view.rosterGap }]} />;
  }
  return (
    <div className="flex flex-wrap items-center gap-8">
      <SinceLooked looked={looked} view={view} />
      <Named automations={broken} label="broken now" tone="text-danger" />
      <Named automations={pausedByOwner} label="paused by you" tone="text-muted-foreground" />
      {heldUnowned.length > 0 && (
        <Named automations={heldUnowned} label="held, no word of yours names them" tone="text-warning" />
      )}
      <p className={STAT}>
        <strong>{view.automations.length}</strong>
        <span>scheduled</span>
      </p>
      <p className={STAT}>
        <strong>{count("running")}</strong>
        <span>running now</span>
      </p>
      {view.issues.length > 0 && (
        <StaleMark
          facts={view.issues.map((issue) => ({
            observedAtIso: view.observedAtIso,
            subject: "a store this page reads",
            why: issue,
          }))}
        />
      )}
    </div>
  );
}

/**
 * Definition files that are not rows: one plain sentence saying what that costs the owner, with the verb's own records
 * folded beneath it. A store the verb could not read is a staleness mark beside the counts, never a sentence here.
 */
function Problems({ view }: { view: AutomationsView }): ReactElement | null {
  if (view.rejected.length === 0) {
    return null;
  }
  return (
    <details className={ROW_DETAIL}>
      <summary className="cursor-pointer text-danger">
        A definition file is not a row, so the automation it defines has no card below.
      </summary>
      <ul className="m-0 mt-1 pl-4 text-muted-foreground">
        {view.rejected.map((rejected) => (
          <li key={rejected.file}>
            {rejected.file} is not a row: <PlainWhy why={rejected.why} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The cards, worst first, and within one health the most failures since the owner last looked first. */
function Cards({
  view,
  looked,
  onOpen,
}: {
  view: AutomationsView;
  looked: string | null;
  onOpen: OnAutomationOpen;
}): ReactElement {
  const cards = view.automations.map((automation) => ({
    automation,
    newBreaks: newBreaksOf({ automation, looked }),
    rank: rankOf({ automation }),
  }));
  const ordered = cards.toSorted((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return breaksCounted({ newBreaks: b.newBreaks }) - breaksCounted({ newBreaks: a.newBreaks });
  });
  return (
    <div className="flex flex-col gap-2">
      {ordered.map(({ automation, newBreaks }) => (
        <AutomationCard
          automation={automation}
          key={automation.recipeId}
          newBreaks={newBreaks}
          nowIso={view.observedAtIso}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

/** Syncs run by hand, which no scheduled row covers. */
function Unscheduled({ view }: { view: AutomationsView }): ReactElement | null {
  const withRuns = view.unscheduledSyncs.filter((sync) => sync.runs.length > 0);
  if (withRuns.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-[0.85rem] font-semibold">Syncs no scheduled row covers</h3>
      {withRuns.map((sync) => (
        <SyncRunPanel key={sync.source} run={sync.runs[0]} />
      ))}
    </div>
  );
}

/**
 * The page body.
 *
 * @returns the tile holding every card
 */
export function Automations(): ReactElement {
  const state = useLive({ everyMs: POLL_MS, read: readAutomations, slug: "automations" });
  const looked = useLastLooked({ key: LAST_LOOKED_KEY });
  // The open item is the card the owner last opened that is STILL open. Folding a card takes it out, so the page falls back to
  // the open card the owner opened before it, or to none (folding B otherwise left the page naming B while A stayed open). A
  // card a refresh dropped unmounts without a toggle, so only a key the page still draws can be named.
  const [touched, setTouched] = useState<readonly string[]>([]);
  const drawn = new Set(
    state.phase === "ready"
      ? state.value.automations.flatMap((automation) =>
          automation.steering.key === undefined ? [] : [automation.steering.key],
        )
      : [],
  );
  const newest = touched.findLast((key) => drawn.has(key));
  const about = newest === undefined ? "" : newest;
  const onOpen: OnAutomationOpen = ({ about: key, open }) => {
    setTouched((previous) => {
      const others = previous.filter((each) => each !== key);
      return open ? [...others, key] : others;
    });
  };
  // The voice reads the open card, so a steer said or typed in the call carries the card's `recipe:` key. It
  // reads the card's plain answers, never the verb's technical `why`, so the voice says what the page says above its
  // Technical detail fold. A reading kept over a failed read goes with the reason it is not current, so the voice never
  // calls it the state now.
  const openAutomation =
    state.phase === "ready" ? state.value.automations.find((one) => one.steering.key === newest) : undefined;
  usePageReading({
    open: about === "" ? undefined : about,
    openTitle: openAutomation === undefined ? undefined : nameOf({ automation: openAutomation }),
    shows:
      state.phase === "ready"
        ? {
            automations: state.value.automations.map((automation) => ({
              account: automation.account,
              forWhat: automation.forWhat,
              health: automation.health,
              howLong: automation.durationWords,
              howOften: automation.reliabilityWords,
              // Both answers leave unsaid a zero an unread slot ledger may hide, so the voice is told why.
              historyUnread: automation.firingsGap,
              name: nameOf({ automation }),
              now: automation.nowDoing,
              recipeId: automation.recipeId,
            })),
            stale: state.stale?.why,
          }
        : undefined,
  });
  return (
    <>
      <Tile state={state} title="Automations and syncs">
        {(view) => {
          // A measured zero off the LATEST read — every row read, none scheduled — is the designed empty state. A measured
          // zero kept over a failed or refreshing read proves nothing now, so it says so in a plain line under the tile's
          // staleness mark rather than printing zeros.
          const emptied = automationsReadingOf({ view }).phase === "measured" && view.automations.length === 0;
          const none = emptied && provenNowOf({ state });
          let head = <Stats looked={looked} view={view} />;
          if (none) {
            head = (
              <PageEmpty
                title="Scheduled automations will appear here."
                appearsWhen="A card appears when an automation is added to the schedule."
                action={{ kind: "plans" }}
                surface="automations"
              />
            );
          } else if (emptied) {
            head = <p className="sw-tile-note">no automation was scheduled as of the last reading that answered</p>;
          }
          return (
            <>
              {head}
              <Problems view={view} />
              {!emptied && <Cards looked={looked} onOpen={onOpen} view={view} />}
              <Unscheduled view={view} />
            </>
          );
        }}
      </Tile>
    </>
  );
}
