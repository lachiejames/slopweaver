/**
 * The CLOSED set of Notion settings tabs this atlas photographs — an id and the names the client renders it
 * under, never a selector.
 *
 * ## Why a caller picks an id rather than naming a control
 *
 * This is `visualEvidence/evidenceTarget.ts`'s shape, applied to a modal far more dangerous than a Datadog
 * graph: Notion's settings modal reaches member removal, workspace deletion and a billing upgrade. A caller
 * allowed to say "click the control named X" inside it is one typo from an irreversible act against the
 * workspace, and no blocklist of dangerous names can be complete — `browser/vantaPolicyVersionSnippet.ts`
 * paid for that finding twice. So what a caller may pick is which tab in THIS list to open, and the names
 * each tab is known by live here in source.
 *
 * The structural half of the same property is in `browser/notionSettingsSnippet.ts`: the tab arm's candidate
 * set is the `role="tab"` nodes the settings click brought into existence, so a destructive control — a
 * BUTTON on a panel, never a tab in the rail — is not something a name could select even if one arrived.
 *
 * ## Every name here is MEASURED, and the command that re-measures it is the verb itself
 *
 * MEASURED on the owner's own workspace, by `slopweaver atlas notion settings`, which reported
 * seventeen tabs in exactly this order with `Preferences` marked selected. That verb is the only source for
 * this list: Notion's help pages describe settings as something you reach from the sidebar and document no
 * URL scheme and no tab list at all. A tab Notion renames simply stops matching and is reported as absent —
 * a fact the next session can act on — rather than being matched loosely to whatever is nearest.
 *
 * ## The seventeenth tab is deliberately absent, and that is configuration rather than hygiene
 *
 * The first entry in the Account group is labelled with the SIGNED-IN PERSON'S OWN NAME. It is a real tab
 * and this atlas can photograph it, but its label is per-install state, so writing it into this list would
 * bake one machine's account into shipped source — the "tools in the codebase, state outside it" line, not
 * a leak. It is carried as a standing gap instead: `settings-tab-undeclared-per-install`, filed by
 * `settingsGaps.ts`'s `accountTabGap` on every settings walk.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { NotionAtlasErrors, notionAtlasErrorLines } from "./errors.js";

/**
 * Which group of the settings rail a tab sits in, exactly as the modal titles them.
 *
 * @internal — a field type of {@link NotionSettingsTab}.
 */
export type NotionSettingsGroup = "account" | "workspace" | "features" | "billing";

/** One tab of the settings modal, as this atlas addresses it. */
export interface NotionSettingsTab {
  /** The `--tab` spelling, and the surface name its entity and coverage cell are reported under. */
  readonly id: string;
  /** Every accessible name the client is known to render this tab under. */
  readonly names: readonly string[];
  readonly group: NotionSettingsGroup;
  readonly description: string;
}

/**
 * Every tab this build can open, in the order the rail renders them.
 *
 * The list is the atlas's own claim about what the settings modal contains, so a tab Notion adds is a gap
 * this atlas does not know it has until someone re-runs the probe and adds it here. That is the same
 * closed-inventory property every atlas in this repository holds, and `browserGaps.ts` files a standing,
 * never-closing gap saying exactly that.
 */
export const NOTION_SETTINGS_TABS: readonly NotionSettingsTab[] = [
  {
    description: "the signed-in account's own preferences — theme, high contrast, input options, language and time",
    group: "account",
    id: "preferences",
    names: ["Preferences"],
  },
  {
    description: "the account's notification settings, for this workspace and for email",
    group: "account",
    id: "notifications",
    names: ["Notifications"],
  },
  {
    description: "the account's connected mail and calendar accounts",
    group: "account",
    id: "mail-and-calendar",
    names: ["Mail & Calendar"],
  },
  {
    description: "the workspace's own name, icon, domain, export and delete controls",
    group: "workspace",
    id: "general",
    names: ["General"],
  },
  {
    description: "the workspace's member, guest and group roster, and how people may join",
    group: "workspace",
    id: "members",
    names: ["Members"],
  },
  {
    description: "the workspace's usage analytics",
    group: "workspace",
    id: "analytics",
    names: ["Analytics"],
  },
  {
    description: "the workspace's import routes from other tools",
    group: "workspace",
    id: "import",
    names: ["Import"],
  },
  {
    description: "whether Notion AI is on for the workspace, and which models it may use",
    group: "features",
    id: "notion-ai",
    names: ["Notion AI"],
  },
  {
    description: "the workspace's connected third-party apps, as distinct from the account's own",
    group: "features",
    id: "connections",
    names: ["Connections"],
  },
  {
    description: "the workspace's Notion MCP server and what it exposes",
    group: "features",
    id: "notion-mcp",
    names: ["Notion MCP"],
  },
  {
    description: "which pages the workspace has marked verified, and who may verify one",
    group: "features",
    id: "verified-pages",
    names: ["Verified pages"],
  },
  {
    description: "which pages the workspace has published to the public web",
    group: "features",
    id: "public-pages",
    names: ["Public pages"],
  },
  {
    description: "the workspace's custom emoji",
    group: "features",
    id: "emoji",
    names: ["Emoji"],
  },
  {
    description: "the workspace's own integrations, API tokens and developer settings",
    group: "features",
    id: "developer",
    names: ["Developer"],
  },
  {
    description: "the workspace's Notion credit balance and how it was spent",
    group: "billing",
    id: "notion-credits",
    names: ["Notion credits"],
  },
  {
    description: "the plans this workspace could move to — a read of what is offered, never a purchase",
    group: "billing",
    id: "explore-plans",
    names: ["Explore plans"],
  },
];

/** Every tab id, spelled the way `--tab` takes it. */
export const NOTION_SETTINGS_TAB_IDS: readonly string[] = NOTION_SETTINGS_TABS.map((tab) => tab.id);

/**
 * Resolve a `--tab` value against the closed set.
 *
 * @param id the raw flag value
 * @returns the tab, or the refusal naming every id that exists
 */
export function notionSettingsTab({ id }: { id: string }): Result<NotionSettingsTab> {
  const found = NOTION_SETTINGS_TABS.find((tab) => tab.id === id);
  if (found === undefined) {
    return err(notionAtlasErrorLines({ error: NotionAtlasErrors.tabUnknown({ id, known: NOTION_SETTINGS_TAB_IDS }) }));
  }
  return ok(found);
}
