/**
 * The `handover register` argv one relayed turn becomes — pure, so the row `talk relay` hands the board writer is
 * checkable without a board. The workspace is the one the page resolved (`site/lib/relayWorkspace.ts`); a relay the
 * page could not place states none, and the row is drawn on the self view marked placed by default, rather than placed unmarked on a guess.
 *
 * A relay row is born one of two ways (MEASURED: 58 relay rows with no repo sat in RUN NOW that `cmux spawn` could never seat):
 * with a `--repo`, so a seat can take it up, or — their words landing on an `ask:` card — with none, as an answer the
 * ask's own row carries, filed into that row once its run records it (`../handover/relaySettleForWork.ts`).
 */
import { type StatedWorkspace, workspaceRegisterArgv } from "../../../handover/workspace.js";
import type { RelayDraft } from "../../../talk/relayDraft.js";

/**
 * The argv that registers one relay's row, through the same verb a human would run.
 *
 * @param draft the turn's ask, slug and `talk:<turnId>` anchor
 * @param dir the board directory the row is written into
 * @param home the state home the board lives under
 * @param priority the row's priority, as `--priority` reads it
 * @param workspace whose work the relay is, or `undefined` when the page could not say
 * @param lead what the relay read out of their words for a held draft or the card on screen
 *   (`../../../talk/relayChannelSteer.ts`), which the row's summary opens on; `undefined` when there is none
 * @param repo the checkout a seat's worktree is cut from (`./relayRepository.ts`), or `undefined` for a relay born as
 *   an answer to an ask, or one whose checkout did not resolve — `cmux spawn` cannot seat a row without one
 * @returns the whole argv `handover register` takes, its `node slopweaver` head included
 */
export function relayRegisterArgv({
  draft,
  dir,
  home,
  lead,
  priority,
  repo,
  workspace,
}: {
  draft: Pick<RelayDraft, "anchor" | "ask" | "slug">;
  dir: string;
  home: string;
  lead?: string | undefined;
  priority: string;
  repo: string | undefined;
  workspace: StatedWorkspace | undefined;
}): readonly string[] {
  let ask = draft.ask;
  if (lead !== undefined && lead !== "") {
    ask = `${lead}\n\n${draft.ask}`;
  }
  return [
    "node",
    "slopweaver",
    "handover",
    "register",
    "--ask",
    ask,
    "--priority",
    priority,
    "--dispatch",
    "--slug",
    draft.slug,
    "--anchor",
    draft.anchor,
    ...(repo === undefined ? [] : ["--repo", repo]),
    ...workspaceRegisterArgv({ stated: workspace }),
    "--dir",
    dir,
    "--home",
    home,
  ];
}
