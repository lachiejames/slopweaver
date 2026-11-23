/**
 * The owner's list on the `slopweaver briefing render` page: the organisation it is placed against, and the one read of
 * the session-start document every list-shaped view comes from. Split from `./briefingRenderProjections.ts` and
 * `./renderRun.ts` for their size caps once the organisation became a read of its own.
 */
import { YOUR_LIST_MAX_ROWS } from "../../../briefing/caps.js";
import { briefingErrorLines } from "../../../briefing/errors.js";
import { openPrReactNow } from "../../../briefing/openPrCards.js";
import { judgeSnapshotAge, type StaleSnapshot, YOUR_LIST_LABEL } from "../../../briefing/snapshotAge.js";
import { projectYourList } from "../../../briefing/yourList.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { Organisation } from "../../../organisation/core.js";
import { gatherProjections } from "./briefingRenderProjections.js";
import type { BriefingRenderDeps, GatheredProjections, ProjectedRun } from "./briefingRenderTypes.js";
import type { BriefingRenderArgs } from "./core.js";
import { type BriefingCommandError, BriefingCommandErrors, briefingCommandErrorLines } from "./errors.js";

/**
 * How many rows of the owner's list this run renders, saying the substitution out loud rather than coalescing it.
 *
 * A destructured default rather than `args.top ?? YOUR_LIST_MAX_ROWS`: the cap is what `--top` OVERRIDES,
 * and the invocation string the projection stamps quotes the number either way, so a reader of the page can
 * always see which one it was.
 */
function topRows({ top = YOUR_LIST_MAX_ROWS }: { top: number | undefined }): number {
  return top;
}

/**
 * The organisation the owner's list is placed against, read once and only when the run renders the list at all: the list
 * names checkouts by directory, and the organisation's repositories are what a directory resolves against.
 *
 * @param home the state home the store selection is read under
 * @returns the organisation, `undefined` when the run renders no list, or the read's refusal
 */
export async function organisationForList({
  args,
  deps,
  home,
}: {
  args: BriefingRenderArgs;
  deps: BriefingRenderDeps;
  home: string;
}): Promise<Result<Organisation | undefined>> {
  if (args.yourListSource === undefined) {
    return ok(undefined);
  }
  return deps.readOrganisation({ home });
}

/**
 * Read the session-start document ONCE, and project everything the page takes from it.
 *
 * One read rather than three, because there is one run: the owner's list, every open pull request's card and the
 * page's own `last refreshed` instant are three views of the same document, and reading it per view would
 * let one page state a freshness instant that belongs to a different run than its rows.
 *
 * @param args the parsed invocation
 * @param deps everything the verb touches outside itself
 * @param nowIso this render's own instant, which the document's age is measured against
 * @param organisation the organisation the edge read, whose repositories name a row's checkout — absent only when
 *   the run renders no list
 * @returns the projections the run asked for, or the refusal
 */
export function projectRun({
  args,
  deps,
  nowIso,
  organisation,
}: {
  args: BriefingRenderArgs;
  deps: BriefingRenderDeps;
  nowIso: string;
  organisation: Organisation | undefined;
}): Result<ProjectedRun, BriefingCommandError> {
  if (args.yourListSource === undefined) {
    return ok({ heldBack: [], openPrs: undefined, stale: undefined, yourList: undefined });
  }
  if (organisation === undefined) {
    return err(
      BriefingCommandErrors.upstreamRefused({
        reasons: ["the owner's list was asked for, but no organisation was read to name each row's repository"],
      }),
    );
  }
  const raw = deps.readYourList({ source: args.yourListSource });
  if (raw.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: raw.error }));
  }
  let document: unknown;
  try {
    document = JSON.parse(raw.value);
  } catch (error: unknown) {
    return err(BriefingCommandErrors.documentNotJson({ cause: error, document: "--your-list" }));
  }
  const top = topRows({ top: args.top });
  const invocation = `slopweaver session-start --json, top ${String(top)}`;
  const list = projectYourList({ document, invocation, organisation, top });
  if (list.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: briefingErrorLines({ error: list.error }) }));
  }
  // Judged off the document's OWN instant rather than the file's, so `--your-list -` is checked exactly as
  // a path is. It is the same instant the list's section states its age from, which is the property worth
  // keeping: the page cannot claim one age while the door judged another.
  const stale = judgeSnapshotAge({
    flag: "--your-list",
    label: YOUR_LIST_LABEL,
    nowIso,
    source: args.yourListSource,
    takenIso: list.value.readIso,
  });
  return withOpenPrs({ document, openPrs: args.openPrs, stale, yourList: list.value });
}

/**
 * Project the run, gather the documents it reads, and date both snapshot halves against this render's clock.
 *
 * Split from `./renderRun.ts`'s entry point for the line cap. Each refusal comes back as the lines it prints, since
 * all three exit the same way.
 *
 * @param organisation the organisation the owner's list is placed against, absent when the run renders no list
 * @param readyIso this render's own instant, which both snapshot halves are judged against
 * @returns the gathered projections, the projected run and every stale half, or the refusal's lines
 */
export async function projectAndDate({
  args,
  deps,
  home,
  organisation,
  readyIso,
}: {
  args: BriefingRenderArgs;
  deps: BriefingRenderDeps;
  home: string;
  organisation: Organisation | undefined;
  readyIso: string;
}): Promise<Result<{ gathered: GatheredProjections; projected: ProjectedRun; stale: readonly StaleSnapshot[] }>> {
  const projected = projectRun({ args, deps, nowIso: readyIso, organisation });
  if (projected.isErr()) {
    return err(briefingCommandErrorLines({ error: projected.error }));
  }
  const gathered = await gatherProjections({ args, deps, home, readyIso });
  if (gathered.isErr()) {
    return err(briefingCommandErrorLines({ error: gathered.error }));
  }
  const stale = [projected.value.stale, gathered.value.openArtifacts.stale].filter(
    (one): one is StaleSnapshot => one !== undefined,
  );
  const refused = deps.snapshotAgeRefusal({ home, nowIso: readyIso, stale });
  if (refused.length > 0) {
    return err(refused);
  }
  return ok({ gathered: gathered.value, projected: projected.value, stale });
}

/**
 * The projected run, with every open pull request's card off the same document when the run asked for them.
 *
 * @param document the session-start document the owner's list was read from
 * @param openPrs whether the run asked for the open pull requests' cards
 * @param stale the list's snapshot age, when it is past the ceiling
 * @param yourList the owner's projected list
 * @returns the projected run, or the cards' refusal
 */
function withOpenPrs({
  document,
  openPrs,
  stale,
  yourList,
}: {
  document: unknown;
  openPrs: boolean;
  stale: StaleSnapshot | undefined;
  yourList: NonNullable<ProjectedRun["yourList"]>;
}): Result<ProjectedRun, BriefingCommandError> {
  if (!openPrs) {
    return ok({ heldBack: [], openPrs: undefined, stale, yourList });
  }
  const cards = openPrReactNow({ document });
  if (cards.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: briefingErrorLines({ error: cards.error }) }));
  }
  return ok({ heldBack: cards.value.heldBack, openPrs: cards.value.groupings, stale, yourList });
}
