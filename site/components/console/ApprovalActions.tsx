"use client";

import { Check, MoreVertical, XCircle } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";

/**
 * The archive's approval bar, re-drawn over the queue's own press: Approve, and Deny behind a More menu. The
 * archive's Review/Edit is not here: it opened a box for the owner's own words, and the console's one text input is the
 * call's chat.
 *
 * Each button prints the exact words it records, because nothing is recorded that the owner has not seen. Every
 * press is a click: Slopweaver has no hotkeys.
 *
 * @param approveWords what Approve records, printed on the button
 * @param denyWords what Deny records, printed on the menu item
 * @param disabled while a press is in flight, or once the row has left the register
 * @returns the bar
 */
export function ApprovalActions({
  approveWords,
  denyWords,
  onApprove,
  onDeny,
  disabled,
}: {
  approveWords: string;
  denyWords: string;
  onApprove: () => void;
  onDeny: () => void;
  disabled: boolean;
}): ReactElement {
  return (
    <div
      role="toolbar"
      aria-label="your word on this act"
      className="flex basis-full flex-wrap items-center gap-2 rounded-md border border-solid border-warning/30 bg-warning/5 px-3 py-2"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <span className="size-2 rounded-full bg-warning" aria-hidden="true" />
        Approve?
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="bg-success text-background hover:bg-success/90"
          disabled={disabled}
          onClick={onApprove}
        >
          <Check />
          Approve
          <span className="font-normal">records “{approveWords}”</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="more options"
              title="More"
              disabled={disabled}
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" collisionPadding={8} className="z-[120]">
            <DropdownMenuItem
              variant="destructive"
              disabled={disabled}
              onSelect={() => {
                onDeny();
              }}
            >
              <XCircle />
              Deny: records “{denyWords}”
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}
