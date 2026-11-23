/** Which row's panel is open, addressed by `?open=<key>` so a row's panel has one URL on every page that draws it. */
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { closedBySwitch, keptSnapshot, rowForOpen } from "../../lib/queueOpen";
import type { QueueRow } from "../../lib/queueRows";
import { heldForOpen, type WithheldQueueRow } from "../../lib/queueWithholding";
import { panelHref } from "../../lib/workContext";
import { useWorkContext } from "./workContextState";

/** Which row's panel is open, and the two ways to change it. */
export interface OpenedRow {
  /** The key `?open=` names, or `null` when no panel is open. */
  readonly opened: string | null;
  /** The row the current reading holds under that key. */
  readonly live: QueueRow | undefined;
  /** The row as it was last seen, kept so a panel does not vanish when an act removes it. */
  readonly snapshot: QueueRow | undefined;
  /**
   * The card a gate refused under that key, when no drawn row answers to it: the panel says it is held and draws
   * nothing of it, and {@link snapshot} is dropped, so a card refused on a refresh cannot stay open from before.
   */
  readonly withheld: WithheldQueueRow | undefined;
  readonly open: (row: QueueRow) => void;
  readonly close: () => void;
}

/**
 * Open or close a panel by rewriting this page's own address, with no request to the server.
 *
 * It was `router.replace`, a client navigation that fetches the page's flight data once the router's cached
 * copy is five minutes old. After a landing rebuilds the console, a tab loaded before the rebuild gets that
 * data back under a new build id, and Next turns the click into a hard navigation
 * (`next/dist/client/components/router-reducer/fetch-server-response.js`). During a live call
 * `site/lib/consoleHold.ts` holds that navigation until the call ends, so the click did nothing, measured on the owner's screen. A panel is drawn from rows the page already holds, so
 * nothing needs fetching. Next's patched `replaceState` syncs `useSearchParams` from the new address. The state
 * is `null`, not the entry's own, for the reason `preference.ts` gives: a state carrying `__NA` skips that sync.
 *
 * @param open the row key to open, or `null` to close
 */
function replacePanel({ open }: { open: string | null }): void {
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", panelHref({ open, pathname, search }));
}

/**
 * The open panel, addressed by `?open=<key>` so a row's panel has one URL on every page that draws it.
 *
 * @param rows the rows the page draws — a panel opens only on what is in front of the owner
 * @param every every row every register holds, so a kept snapshot is checked against where its row is NOW
 * @param withheld every card a gate refused, in both work contexts, so a link to one opens its held note
 * @returns the opened key, its live row and snapshot, and open/close
 */
export function useOpenedRow({
  rows,
  every,
  withheld,
}: {
  rows: readonly QueueRow[];
  every: readonly QueueRow[];
  withheld: readonly WithheldQueueRow[];
}): OpenedRow {
  const params = useSearchParams();
  const { context, shows } = useWorkContext();
  const [snapshot, setSnapshot] = useState<QueueRow | undefined>(undefined);
  // A switch of the selector closes a panel whose row the new context does not show, in the render the switch
  // lands in — before the panel's deep-link path can switch back to the row's workspace.
  const [seenContext, setSeenContext] = useState(context);
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);
  const asked = params.get("open");
  if (seenContext !== context) {
    setSeenContext(context);
    setDismissed(closedBySwitch({ every, open: asked, shows }));
  }
  if (dismissed !== undefined && asked === null) {
    setDismissed(undefined);
  }
  const opened = asked === dismissed ? null : asked;
  useEffect(() => {
    if (dismissed !== undefined && asked === dismissed) {
      replacePanel({ open: null });
    }
  }, [asked, dismissed]);
  // `setSnapshot` is stable, but React Compiler infers it as a dependency once `live` comes from an imported
  // function, and skips the component (`preserve-manual-memoization`) unless both lists name it.
  const open = useCallback(
    (row: QueueRow): void => {
      setSnapshot(row);
      setDismissed(undefined);
      replacePanel({ open: row.key });
    },
    [setSnapshot, setDismissed],
  );
  const close = useCallback((): void => {
    setSnapshot(undefined);
    replacePanel({ open: null });
  }, [setSnapshot]);
  const live = opened === null ? undefined : rowForOpen({ open: opened, rows });
  // A row opened by a deep link was never clicked, so nothing snapshotted it: each live sighting does, in
  // render, the way React stores information from a previous render — otherwise a press whose verb removes
  // the row mid-flight would swap the panel out from under its own outcome and the reader would never see it.
  if (live !== undefined && snapshot !== live) {
    setSnapshot(live);
  }
  const held = heldForOpen({ every, live, open: opened, withheld });
  if (held !== undefined) {
    return { close, live: undefined, open, opened, snapshot: undefined, withheld: held };
  }
  // A snapshot outlives its row only for a press's own outcome; never a switch of the selector, nor a refresh
  // that moved its row to the other workspace.
  return {
    close,
    live,
    open,
    opened,
    snapshot: keptSnapshot({ every, open: opened, shows, snapshot }),
    withheld: undefined,
  };
}
