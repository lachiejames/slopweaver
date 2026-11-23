/**
 * Where a register placed by the address it carries belongs, never by a board row it joins (`./registerPlacement.ts`
 * places the rest): a held reply, a parked post and a pull request.
 */
import type { ParkedDraft } from "../components/live/readSlackDrafts";
import type { HeldDraft } from "../components/live/readThread";
import {
  placementOf,
  slackRegisterEvidence,
  type WorkspacePlacement,
  type WorkspacePlacer,
} from "./workspacePlacement";
import { repositoryOf } from "./workspacePlacementAddress";

/**
 * Where a held reply belongs: it answers a thread in the installation's Slack workspace, the organisation's.
 *
 * @param placer the organisation's address readers, which read the reply's permalink
 * @returns the placement
 */
export function draftPlacement({
  draft,
  placer,
}: {
  draft: Pick<HeldDraft, "permalink">;
  placer: WorkspacePlacer;
}): WorkspacePlacement {
  const evidence = [slackRegisterEvidence({ register: "the held-reply register" })];
  if (draft.permalink !== undefined) {
    evidence.push(...placer.addressEvidence({ values: [draft.permalink] }));
  }
  return placementOf({ evidence, why: "unreachable: the register is the evidence" });
}

/**
 * Where a parked post belongs: it goes to people in the installation's Slack workspace, the organisation's.
 *
 * @returns the placement
 */
export function postPlacement({ post }: { post: Pick<ParkedDraft, "channel"> }): WorkspacePlacement {
  return placementOf({
    evidence: [slackRegisterEvidence({ register: `the drafts register, ${post.channel}` })],
    why: "unreachable: the register is the evidence",
  });
}

/**
 * Where a pull request belongs: the repository it is in, read off BOTH structured addresses a row carries — its
 * `repoSlug` and its GitHub `url`. The verb derives both from one pull request, so they agree and place it once;
 * a row whose two disagree is a conflict the default rule places and marks, never whichever field was read, and a
 * finding when they name two repositories that are not two workspaces'. Either one that does not read as a
 * repository at all is a finding, never skipped so the other places it alone.
 *
 * @param row the landing row or census pull request, by its repository and its link
 * @param placer the organisation's address readers
 * @returns the placement
 */
export function prPlacement({
  placer,
  row,
}: {
  placer: WorkspacePlacer;
  row: { readonly repoSlug: string; readonly url: string };
}): WorkspacePlacement {
  const unread = [
    { field: "repoSlug", value: row.repoSlug },
    { field: "url", value: row.url },
  ].filter(({ value }) => repositoryOf({ value }) === undefined);
  if (unread.length > 0) {
    const named = unread.map(({ field, value }) => `${field} ${JSON.stringify(value)}`).join(" and ");
    return { kind: "unplaced", why: `its ${named} would not read as a GitHub repository (NOT MEASURED)` };
  }
  const seen = new Set<string>();
  const evidence = placer.addressEvidence({ values: [row.repoSlug, row.url] }).filter((one) => {
    const key = `${one.source}:${one.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const placement = placementOf({ evidence, why: `${row.repoSlug} is not a repository of the organisation` });
  const slug = repositoryOf({ value: row.repoSlug });
  const linked = repositoryOf({ value: row.url });
  // Two repositories are two pull requests, whichever of them the organisation owns: the census joins a row by its
  // repoSlug, so placing it by the other would count it where its row is not drawn.
  if (slug !== linked && placement.kind !== "conflict") {
    return { kind: "unplaced", why: `its repoSlug ${slug} and url ${linked} name two different repositories` };
  }
  return placement;
}
