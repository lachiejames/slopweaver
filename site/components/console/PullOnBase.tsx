"use client";

/*
 * The pull request page's line saying whether its diff is already on its base branch's current tip. GitHub draws a
 * diff against the branch's merge base, so an open +1/−1 says nothing about the base today: a pull request can draw one
 * while its base branch already holds the same line. The words come from
 * `pullDiffOnBaseNotice` (`../../lib/pullView.ts`), off the `diffOnBase` receipt `github read --files` carries.
 */

import type { ReactElement } from "react";

import { ageOf } from "../../lib/ageOf";
import { type PullDiffOnBaseNotice, type PullView as PullViewData, pullDiffOnBaseNotice } from "../../lib/pullView";
import { cn } from "../../lib/utils";

const ON_BASE_TONE: Record<PullDiffOnBaseNotice["tone"], string> = {
  muted: "text-muted-foreground",
  success: "text-gh-success",
  warning: "text-warning",
};

/**
 * Whether the diff is already on its base's current tip, with the tip and the instant it was checked.
 *
 * @returns the notice line, or nothing for a merged pull request
 */
export function PullOnBase({ view }: { view: PullViewData }): ReactElement | null {
  const notice = pullDiffOnBaseNotice({ view });
  if (notice === undefined) {
    return null;
  }
  return (
    <p className={cn("m-0 flex flex-wrap items-center gap-1.5 text-[0.82rem]", ON_BASE_TONE[notice.tone])}>
      <span>{notice.text}</span>
      {notice.receipt !== undefined && (
        <span className="text-[0.76rem] text-muted-foreground">
          (checked against tip <code>{notice.receipt.shortOid}</code>{" "}
          <time title={notice.receipt.checkedAtIso}>{ageOf({ iso: notice.receipt.checkedAtIso })}</time>)
        </span>
      )}
    </p>
  );
}
