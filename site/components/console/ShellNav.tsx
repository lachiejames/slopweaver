/** The sidebar's rows, and the click in flight that draws one as under way until its page arrives. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactElement, type ReactNode, useCallback, useEffect, useState } from "react";

import { isPlainClick, navStallAction, pathOfHref } from "../../lib/navStall";
import { settingsEntrySection } from "../../lib/settingsModal";
import { isCountedEntry, type SidebarEntryOf } from "../../lib/sidebarCounts";
import { navHref } from "../../lib/workContext";
import { useVoice } from "../voice/voiceContext";
import { useSettingsModal } from "./SettingsModal";
import { EntryBadge, NoPlanDot, useNoPlanConnected } from "./ShellBadges";
import { InsideControl } from "./StaleMark";
import { useWorkContext } from "./workContextState";

/** A sidebar click whose page has not arrived yet: where it is going, and when it was made. */
interface PendingNav {
  readonly href: string;
  readonly atMs: number;
  /** Set once the stall allowance ran out during a voice call, which a document load would end. */
  readonly heldByCall: boolean;
}

/**
 * A sidebar click drawn as under way in the frame it lands, and loaded as a document if its page never arrives
 * (`site/lib/navStall.ts`).
 *
 * The click handler's state update is urgent, so React paints it before it renders the navigation's transition —
 * which is why this is local state rather than `useLinkStatus`, whose pending phase is skipped for a prefetched route
 * that still took 575 ms to draw. A click is pending only while the address is still the one it was made on, so a
 * page that arrived, or a back button to where the click was made, draws nothing.
 *
 * @returns the click in flight, if any, and the handler a link calls with its address
 */
export function usePendingNav(): { readonly pending: PendingNav | undefined; readonly start: (href: string) => void } {
  const pathname = usePathname();
  const voice = useVoice();
  const [pending, setPending] = useState<PendingNav | undefined>(undefined);
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    // The address moved: whatever was pending has landed or been overtaken. Reset during render, React's own pattern
    // for state that follows a value, so no frame draws the arrived page with its click still pending.
    setSeenPath(pathname);
    setPending(undefined);
  }
  const callLive = voice?.callActive === true;
  // `callLive` is a dependency so a click held for a call is checked again the moment the call ends, and loads then.
  // It reads only a call in THIS document, and a console page runs none (the desktop overlay
  // does), so the hold stays idle here; it guards the shape, not a call this window can lose.
  useEffect(() => {
    if (pending === undefined) {
      return;
    }
    const check = (): void => {
      const action = navStallAction({ callLive, clickedAtMs: pending.atMs, nowMs: Date.now() });
      if (action.kind === "wait") {
        timer = setTimeout(check, action.inMs);
        return;
      }
      if (action.kind === "held-by-call") {
        if (!pending.heldByCall) {
          setPending({ ...pending, heldByCall: true });
        }
        return;
      }
      window.location.assign(pending.href);
    };
    let timer = setTimeout(check, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [pending, callLive]);
  const start = useCallback(
    (href: string): void => {
      if (pathOfHref({ href }) === pathname) {
        return;
      }
      setPending({ atMs: Date.now(), heldByCall: false, href });
    },
    [pathname],
  );
  return { pending, start };
}

/** A sidebar entry's row: a page's link, or the control that opens Settings over the page. */
const NAV_ROW =
  "group/nav flex w-full cursor-pointer items-center gap-[0.55rem] rounded-lg border-0 bg-transparent px-[0.55rem] py-[0.42rem] text-left text-[0.86rem] text-foreground hover:bg-muted/70 hover:no-underline aria-[current=page]:bg-muted aria-busy:bg-muted aria-expanded:bg-muted group-data-[sidebar=icons]/console:relative group-data-[sidebar=icons]/console:justify-center group-data-[sidebar=icons]/console:px-0 group-data-[sidebar=icons]/console:py-2";

/** A sidebar entry's glyph, in the accent while its page is the one shown or its modal is open. */
const NAV_GLYPH =
  "w-4 text-center text-[0.8rem] text-muted-foreground group-aria-[current=page]/nav:text-primary group-aria-busy/nav:animate-pulse group-aria-busy/nav:text-primary group-aria-expanded/nav:text-primary group-data-[sidebar=icons]/console:w-auto group-data-[sidebar=icons]/console:text-base";

/** A sidebar entry's words, which the icon rail hides. */
const NAV_LABEL = "group-data-[sidebar=icons]/console:hidden";

/**
 * The sidebar's Settings entry: it opens Settings as a modal over the page the owner is on, rather than going anywhere
 * (`SettingsModal.tsx`), on Integrations — or on Models while its dot says no plan is connected, so the dot leads
 * to the section that clears it.
 *
 * @returns the entry
 */
function SettingsEntry({ glyph, label, title }: { glyph: string; label: string; title: string }): ReactElement {
  const settings = useSettingsModal();
  const noPlanConnected = useNoPlanConnected();
  const shown = settings.section !== undefined;
  return (
    <li>
      <button
        type="button"
        className={NAV_ROW}
        aria-haspopup="dialog"
        aria-expanded={shown}
        title={title}
        onClick={() => {
          settings.open(settingsEntrySection({ noPlanConnected }));
        }}
      >
        <span className={NAV_GLYPH} aria-hidden="true">
          {glyph}
        </span>
        <span className={NAV_LABEL}>{label}</span>
        <NoPlanDot noPlanConnected={noPlanConnected} />
      </button>
    </li>
  );
}

/** One entry in the sidebar. */
function NavItem({
  href,
  glyph,
  label,
  badge,
  plainTitle,
  pending,
  onNavigate,
}: {
  href: string;
  glyph: string;
  label: string;
  badge: ReactNode;
  /** The row's hover, which says why when the entry carries no number. */
  plainTitle: string;
  /** The sidebar click in flight, if any, so the entry it is for draws as under way. */
  pending: PendingNav | undefined;
  onNavigate: (href: string) => void;
}): ReactElement {
  const pathname = usePathname();
  const { context } = useWorkContext();
  const current = pathname === href;
  const address = navHref({ context, href });
  const going = pending !== undefined && pathOfHref({ href: pending.href }) === href;
  let title = plainTitle;
  if (going && pending.heldByCall) {
    title = `${label}: still loading; it loads when the voice call ends, since a reload now would end it`;
  }
  return (
    <li>
      <Link
        href={address}
        aria-current={current ? "page" : undefined}
        aria-busy={going ? true : undefined}
        data-nav-pending={going ? "" : undefined}
        title={title}
        onClick={(event) => {
          if (isPlainClick(event)) {
            onNavigate(address);
          }
        }}
        className={NAV_ROW}
      >
        <span className={NAV_GLYPH} aria-hidden="true">
          {glyph}
        </span>
        <span className={NAV_LABEL}>{label}</span>
        {/* The row is one link, so a count's warning mark draws as a labelled image, never a button inside it. */}
        <InsideControl value={true}>{badge}</InsideControl>
      </Link>
    </li>
  );
}

/**
 * One {@link SIDEBAR_ENTRIES} entry drawn: its badge as decided, and for one decided to carry none, its reason in the
 * row's hover. The badge sits inside the row, so the whole line is one click, the sidebar item
 * as a whole being one item.
 *
 * @returns the row
 */
export function SidebarRow({
  entry,
  pending,
  onNavigate,
}: {
  entry: SidebarEntryOf;
  pending: PendingNav | undefined;
  onNavigate: (href: string) => void;
}): ReactElement {
  let badge: ReactNode = null;
  let title: string = entry.label;
  if (isCountedEntry(entry)) {
    badge = <EntryBadge entry={entry} />;
  } else {
    title = `${entry.label}, ${entry.badge.why}`;
  }
  if (entry.href === null) {
    return <SettingsEntry glyph={entry.glyph} label={entry.label} title={title} />;
  }
  return (
    <NavItem
      href={entry.href}
      glyph={entry.glyph}
      label={entry.label}
      badge={badge}
      plainTitle={title}
      pending={pending}
      onNavigate={onNavigate}
    />
  );
}

/**
 * The bar across the top of the window while a sidebar click is under way — the first thing that moves on a click.
 *
 * @returns the bar, or nothing when no click is in flight
 */
export function NavProgress({ pending }: { pending: PendingNav | undefined }): ReactElement | null {
  if (pending === undefined) {
    return null;
  }
  // Decorative: the sidebar item it is for carries `aria-busy`, which is what a screen reader is told.
  return (
    <div
      data-nav-progress=""
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-50 h-[3px] animate-pulse bg-primary"
    />
  );
}
