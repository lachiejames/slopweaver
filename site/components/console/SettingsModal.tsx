"use client";

/**
 * Settings, as a modal over whatever page the owner is on — claude.ai's shape: a large panel centred over the dimmed
 * app, its sections down the left, the open section on the right, a close control in its corner (`lib/settingsModal.ts`
 * carries the rationale). The scrim is light on purpose: the point of a modal is seeing what a theme does to the app
 * behind it.
 *
 * The window's hash is the modal's state (`#settings/<section>`), so a reload, a link or the desktop app's restored tab
 * reopens it where it was. Opening and closing rewrite only the hash, with `replaceState` as every console address
 * write does, so the page under it keeps its query — the context, a card held open — and never reloads. A page's own
 * hash rides inside the modal's (`/workstreams#settings/theme&page=candidates`) and comes back when it closes,
 * through a reload or a restored tab too.
 *
 * Drawn inside the console's root rather than portalled to `<body>`, so the console's own type scale and tokens apply.
 */
import { Dialog as DialogPrimitive } from "radix-ui";
import { type ReactElement, useRef, useState, useSyncExternalStore } from "react";

import { INTEGRATIONS } from "../../lib/integrations";
import {
  pageHashOf,
  SETTINGS_GROUPS,
  SETTINGS_SECTION_LABELS,
  type SettingsSection,
  settingsHash,
  settingsItemOf,
  settingsSectionOf,
  settingsSectionsMatching,
} from "../../lib/settingsModal";
import { cn } from "../../lib/utils";
import { CallSettings } from "../voice/CallSettings";
import { ModelsSettings } from "./ModelsSettings";
import { PresencePresets } from "./PresencePresets";
import { SettingsIntegrations } from "./SettingsIntegrations";
import { ThemePresets } from "./ThemePresets";

/** Whoever reads the hash, told when this file rewrites it — `replaceState` fires no `hashchange`. */
const listeners = new Set<() => void>();

/**
 * Subscribe to the hash: the owner's own edits and links (`hashchange`), back and forward (`popstate`), and this file's
 * writes.
 *
 * @returns the unsubscribe
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}

/**
 * Rewrite the window's hash, keeping its path and query, and tell every reader.
 *
 * @param hash the new hash, with its `#`, or empty to drop it
 */
function writeHash({ hash }: { hash: string }): void {
  // `null`, never the entry's own state: Next's patched `replaceState` reads a state it did not write as its own.
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
  for (const listener of listeners) {
    listener();
  }
}

/** The modal's state and the ways to move it. */
interface SettingsModalState {
  /** The section shown, or `undefined` while the modal is closed. */
  readonly section: SettingsSection | undefined;
  /** The item open inside the section (an integration's id), or `undefined` for the section's own list. */
  readonly item: string | undefined;
  readonly open: (section: SettingsSection) => void;
  /** Open one item inside a section, or the section's list again with no item. */
  readonly openItem: (target: { section: SettingsSection; item?: string }) => void;
  readonly close: () => void;
}

/**
 * The modal's state, read off the window's hash. The server, and the first client render, see it closed, so a page
 * loaded on `#settings/…` opens it once hydrated rather than drawing two different first frames.
 *
 * @returns the section and item shown, and the ways to open and close
 */
export function useSettingsModal(): SettingsModalState {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
  const openItem = ({ section, item }: { section: SettingsSection; item?: string }): void => {
    const pageHash = pageHashOf({ hash: window.location.hash });
    writeHash({ hash: settingsHash(item === undefined ? { pageHash, section } : { item, pageHash, section }) });
  };
  return {
    close: () => {
      writeHash({ hash: pageHashOf({ hash: window.location.hash }) });
    },
    item: settingsItemOf({ hash }),
    open: (section) => {
      openItem({ section });
    },
    openItem,
    section: settingsSectionOf({ hash }),
  };
}

/** A section's row in the modal's left column, drawn as the sidebar draws a page. */
const SECTION_ROW =
  "flex w-full cursor-pointer items-center rounded-lg border-0 bg-transparent px-[0.55rem] py-[0.42rem] text-left text-[0.86rem] text-foreground hover:bg-muted/70 aria-[current=true]:bg-muted";

/** A group's heading in the left column. */
const GROUP_HEAD = "m-0 px-[0.55rem] pt-3 pb-1 text-[0.72rem] font-medium text-muted-foreground";

/**
 * The open section's controls: the integrations, the models, the themes, the presences, or the call.
 *
 * @param item the item open inside the section, read off the hash
 * @param openItem opens one item inside the section, or its list again
 * @returns the section's body
 */
function SectionBody({
  section,
  item,
  openItem,
}: {
  section: SettingsSection;
  item: string | undefined;
  openItem: (target: { item?: string }) => void;
}): ReactElement {
  switch (section) {
    case "integrations":
      return <SettingsIntegrations item={item} openItem={openItem} />;
    case "models":
      return <ModelsSettings />;
    case "theme":
      return <ThemePresets />;
    case "presence":
      return <PresencePresets />;
    case "call":
      return <CallSettings />;
    default: {
      const unreachable: never = section;
      return unreachable;
    }
  }
}

/**
 * The Settings modal, open while the hash names one of its sections. Escape, the scrim and the close control each
 * close it; focus moves into it on opening and back to whatever opened it on closing (Radix's dialog).
 *
 * @returns the modal, or nothing while it is closed
 */
export function SettingsModal(): ReactElement {
  const { section, item, open, openItem, close } = useSettingsModal();
  const panel = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const matching = settingsSectionsMatching({ query });
  const opened = section === "integrations" && INTEGRATIONS.some((integration) => integration.id === item);
  return (
    <DialogPrimitive.Root
      open={section !== undefined}
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
    >
      {/* Over the desktop window's drag strips too: a click on the modal or its scrim is a click, never a drag. */}
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/15 dark:bg-black/30 [-webkit-app-region:no-drag]" />
      <DialogPrimitive.Content
        ref={panel}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // Focus the panel itself, as claude.ai's does, rather than ringing its first section as if tabbed to.
          event.preventDefault();
          panel.current?.focus();
        }}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid h-[min(46rem,calc(100vh-4rem))] w-[min(68rem,calc(100vw-4rem))] -translate-x-1/2 -translate-y-1/2 grid-cols-[13.5rem_minmax(0,1fr)] overflow-hidden rounded-xl sw-glass border border-solid text-foreground outline-none [-webkit-app-region:no-drag] max-[760px]:w-[calc(100vw-1.5rem)] max-[760px]:grid-cols-[minmax(0,1fr)] max-[760px]:grid-rows-[auto_minmax(0,1fr)]",
          // One integration opened takes the whole panel, as Datadog's tile sits over its catalog.
          opened && "w-[min(72rem,calc(100vw-4rem))] grid-cols-[minmax(0,1fr)] max-[760px]:grid-rows-[minmax(0,1fr)]",
        )}
      >
        <nav
          aria-label="settings"
          className={cn(
            "flex flex-col gap-[0.15rem] border-y-0 border-l-0 border-r border-solid border-border p-3 max-[760px]:flex-row max-[760px]:flex-wrap max-[760px]:border-r-0 max-[760px]:border-b",
            // Hidden rather than unmounted, so the dialog keeps the title it is named by.
            opened && "hidden max-[760px]:hidden",
          )}
        >
          <DialogPrimitive.Title className="m-0 px-[0.55rem] pt-1 pb-2 text-[0.78rem] font-medium text-muted-foreground max-[760px]:hidden">
            Settings
          </DialogPrimitive.Title>
          <input
            type="search"
            aria-label="search settings"
            placeholder="Search settings"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            className="sw-glass-control mb-1 rounded-lg border border-solid px-[0.55rem] py-[0.35rem] text-[0.82rem] text-foreground max-[760px]:hidden"
          />
          {SETTINGS_GROUPS.map((group) => {
            const shown = group.sections.filter((each) => matching.includes(each));
            if (shown.length === 0) {
              return null;
            }
            return (
              <fieldset key={group.label} aria-label={group.label} className="contents">
                <p className={`${GROUP_HEAD} max-[760px]:hidden`}>{group.label}</p>
                {shown.map((each) => (
                  <button
                    key={each}
                    type="button"
                    className={SECTION_ROW}
                    aria-current={each === section}
                    data-section={each}
                    onClick={() => {
                      open(each);
                    }}
                  >
                    {SETTINGS_SECTION_LABELS[each]}
                  </button>
                ))}
              </fieldset>
            );
          })}
          {matching.length === 0 && (
            <p className="m-0 px-[0.55rem] py-2 text-[0.8rem] text-muted-foreground">No setting matches that.</p>
          )}
        </nav>
        <div className="relative min-h-0 overflow-y-auto px-8 py-7 max-[760px]:px-4 max-[760px]:py-5">
          <DialogPrimitive.Close
            className="absolute top-4 right-4 cursor-pointer rounded-[6px] border border-solid border-border bg-muted px-2 py-[0.15rem] text-foreground"
            aria-label="close settings"
          >
            ×
          </DialogPrimitive.Close>
          {section === undefined ? null : (
            <SectionBody
              section={section}
              item={item}
              openItem={(target) => {
                openItem({ ...target, section });
              }}
            />
          )}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  );
}
