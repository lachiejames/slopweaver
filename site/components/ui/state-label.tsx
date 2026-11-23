import { Ban, CircleCheck, CircleDot, CircleX, Clock, FileText, GitMerge, type LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The states a work item can be in, one icon and one colour each — the archive's `StateLabel` set. */
type StateLabelStatus = "draft" | "open" | "closed" | "merged" | "inProgress" | "done" | "cancelled";

const STATUS: Record<StateLabelStatus, { icon: LucideIcon; label: string; tone: string }> = {
  cancelled: { icon: Ban, label: "Cancelled", tone: "bg-muted text-muted-foreground" },
  closed: { icon: CircleX, label: "Closed", tone: "bg-danger/15 text-danger" },
  done: { icon: CircleCheck, label: "Done", tone: "bg-success/15 text-success" },
  draft: { icon: FileText, label: "Draft", tone: "bg-muted text-muted-foreground" },
  inProgress: { icon: Clock, label: "In progress", tone: "bg-warning/15 text-warning" },
  merged: { icon: GitMerge, label: "Merged", tone: "bg-primary/15 text-foreground" },
  open: { icon: CircleDot, label: "Open", tone: "bg-success/15 text-success" },
};

/**
 * A work item's state as an icon and a word, coloured by the state.
 *
 * `iconOnly` draws the icon alone, bare, for a row that already says everything else — a pull request line
 * reads its state off the glyph the way GitHub draws one — and keeps the word as its accessible name and
 * title, so nothing a reader could hover or a screen reader could speak is lost.
 *
 * @param children the word, when it should say something other than the state's own label
 * @param iconOnly draw the bare icon, the word carried as its label and title
 * @param icon a glyph that says the state better than the generic one — a pull request's own, say
 * @returns the label
 */
function StateLabel({
  status,
  size = "normal",
  iconOnly = false,
  icon,
  children,
  className,
  title,
}: {
  status: StateLabelStatus;
  size?: "small" | "normal";
  iconOnly?: boolean;
  icon?: LucideIcon;
  children?: ReactNode;
  className?: string;
  title?: string;
}): ReactElement {
  const entry = STATUS[status];
  let Icon: LucideIcon = entry.icon;
  if (icon !== undefined) {
    Icon = icon;
  }
  let word: ReactNode = entry.label;
  if (children !== undefined) {
    word = children;
  }
  const iconSize = size === "small" ? "size-3" : "size-3.5";
  if (iconOnly) {
    let name = entry.label;
    if (title !== undefined) {
      name = title;
    }
    return (
      <span
        data-slot="state-label"
        data-status={status}
        className={cn("inline-grid size-5 shrink-0 place-items-center", entry.tone, "bg-transparent", className)}
        title={name}
      >
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a lucide <svg>, not HTML: role="img" with a label is how a drawing announces itself */}
        <Icon className="size-4" role="img" aria-label={name} />
      </span>
    );
  }
  return (
    <span
      data-slot="state-label"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium",
        size === "small" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
        entry.tone,
        className,
      )}
      title={title}
    >
      <Icon className={iconSize} aria-hidden="true" />
      {word}
    </span>
  );
}

export { StateLabel, type StateLabelStatus };
