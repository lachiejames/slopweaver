/**
 * Settings is a modal over whatever page the owner is on, addressed by the window's hash the way claude.ai addresses its own
 * (`#settings/general`): `#settings/<section>` opens it on that section, and no such hash means it is closed.
 *
 * A modal sits on top of anything, with one entry point in the sidebar, so the owner can stay on the main app with
 * the sidebar and get a rough feel for how these different settings change how the app looks; claude.ai's settings
 * over everything else is the shape.
 *
 * A hash rather than a query parameter, because nothing on the server reads it: a page under the modal is the same
 * page with or without it, and no request is made to open one.
 *
 * Pure: strings in, strings out. The modal that reads and writes it is `components/console/SettingsModal.tsx`.
 */

/**
 * The modal's sections, in the order its left column lists them, the first being where a bare `#settings` opens.
 *
 * The modal opens on Integrations with Models beside it, so the owner can view the settings from any other page. The
 * page's whole appearance is the Theme, what fills the orb is its own Presence, apart from the theme, and the call
 * keeps its switches.
 */
export const SETTINGS_SECTIONS = ["integrations", "models", "theme", "presence", "call"] as const;

/** One of {@link SETTINGS_SECTIONS}. */
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Where a bare `#settings` and the sidebar's ⚙ open the modal: Integrations, as the owner ruled. */
export const DEFAULT_SETTINGS_SECTION: SettingsSection = "integrations";

/**
 * Where the sidebar's Settings entry opens the modal: on Models while its dot says no plan is connected, so the dot
 * points at the section that clears it, else on the default section. An unread plans list is not "none connected".
 *
 * @param noPlanConnected true only once the plans list has been read and holds no connected plan
 * @returns the section the entry opens
 */
export function settingsEntrySection({ noPlanConnected }: { noPlanConnected: boolean | undefined }): SettingsSection {
  if (noPlanConnected === true) {
    return "models";
  }
  return DEFAULT_SETTINGS_SECTION;
}

/** Each section's name in the modal's left column. */
export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsSection, string>> = {
  call: "The call",
  integrations: "Integrations",
  models: "Models",
  presence: "Presence",
  theme: "Theme",
};

/**
 * The left column's groups, each a heading over its sections, in order: what Slopweaver connects to, then how the
 * app looks and sounds. Claude's own modal groups its sections the same way.
 */
export const SETTINGS_GROUPS: readonly { readonly label: string; readonly sections: readonly SettingsSection[] }[] = [
  { label: "Connect", sections: ["integrations", "models"] },
  { label: "Preferences", sections: ["theme", "presence", "call"] },
];

/** Words a search for a section finds it by, past its own label. */
const SECTION_KEYWORDS: Readonly<Record<SettingsSection, readonly string[]>> = {
  call: ["voice", "stage", "sound", "badge"],
  integrations: ["connectors", "connect", "tokens", "keys", "credentials", "slack", "github", "linear", "gmail"],
  models: ["plans", "claude", "codex", "usage", "limit"],
  presence: ["orb"],
  theme: ["appearance", "colour", "color", "dark", "light"],
};

/**
 * The sections a "Search settings" query keeps, in the column's order: each whose label or keywords contain every word
 * of it, case-insensitively. An empty query keeps them all.
 *
 * @returns the sections kept
 */
export function settingsSectionsMatching({ query }: { query: string }): readonly SettingsSection[] {
  const words = query
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  return SETTINGS_SECTIONS.filter((section) => {
    const haystack = [SETTINGS_SECTION_LABELS[section], ...SECTION_KEYWORDS[section]].join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** The hash's first segment, which is what makes it the modal's. */
const SETTINGS_SEGMENT = "settings";

/** What joins the page's own hash onto the modal's, so a reload or a restored tab can still give it back. */
const PAGE_HASH_JOIN = "&page=";

/**
 * A hash cut at its first {@link PAGE_HASH_JOIN}: the modal's part before it, and the page's whole hash after it, so a
 * page hash that itself carries `&page=` comes back whole.
 *
 * @returns the modal's part, and the page's part, empty when there is none
 */
function atPageHash({ hash }: { hash: string }): { modal: string; page: string } {
  const at = hash.indexOf(PAGE_HASH_JOIN);
  if (at === -1) {
    return { modal: hash, page: "" };
  }
  return { modal: hash.slice(0, at), page: hash.slice(at + PAGE_HASH_JOIN.length) };
}

/**
 * Whether a string is one of {@link SETTINGS_SECTIONS}.
 *
 * @returns true for a section the modal draws
 */
function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section === value);
}

/**
 * The section a hash opens the modal on, or `undefined` when the hash is not the modal's — which is the modal closed.
 *
 * `#settings` alone opens the first section, as claude.ai's bare `#settings` opens General. A section this console
 * does not draw opens the first one too: the address still says Settings, and a closed modal would ignore that.
 *
 * @param hash the window's `location.hash`, with or without its leading `#`
 * @returns the section to show, or `undefined` for a closed modal
 */
export function settingsSectionOf({ hash }: { hash: string }): SettingsSection | undefined {
  const { modal } = atPageHash({ hash: hash.replace(/^#/u, "") });
  const segments = modal.split("/");
  // `.at`, typed `string | undefined`: a bare `#settings` has no second segment.
  const second = segments.at(1);
  if (segments.at(0) !== SETTINGS_SEGMENT) {
    return undefined;
  }
  if (second !== undefined && isSettingsSection(second)) {
    return second;
  }
  return DEFAULT_SETTINGS_SECTION;
}

/**
 * The one item a section has open, the hash's third segment (`#settings/integrations/datadog` opens Datadog's page
 * inside Integrations), or `undefined` for the section's own list. Only a section the hash itself names carries one:
 * a section it fell back to (`#settings/nope/datadog`) opens on its list.
 *
 * @param hash the window's `location.hash`, with or without its leading `#`
 * @returns the item's id, or `undefined`
 */
export function settingsItemOf({ hash }: { hash: string }): string | undefined {
  const { modal } = atPageHash({ hash: hash.replace(/^#/u, "") });
  const segments = modal.split("/");
  const second = segments.at(1);
  if (segments.at(0) !== SETTINGS_SEGMENT || second === undefined || !isSettingsSection(second)) {
    return undefined;
  }
  // The whole tail, so an item `settingsHash` wrote with a `/` in it reads back whole.
  const item = segments.slice(2).join("/");
  if (item === "") {
    return undefined;
  }
  return item;
}

/**
 * The hash that opens the modal on one section, and on one item inside it when given
 * (`#settings/integrations/datadog`), carrying the page's own hash after it (`#settings/theme&page=candidates`) when
 * the page under it has one.
 *
 * An item is an id out of `INTEGRATIONS` (`./integrations.ts`), lowercase words and hyphens, so it is written
 * unescaped. An id carrying `&page=` would not read back whole, since that is the page hash's delimiter; nothing
 * mints one, and the modal opens an item only when the registry has that id.
 *
 * @param pageHash the page's own hash, with or without its `#`, or empty when it has none
 * @param item the item to open inside the section, by id
 * @returns the hash, with its leading `#`
 */
export function settingsHash({
  section,
  pageHash,
  item,
}: {
  section: SettingsSection;
  pageHash: string;
  item?: string;
}): string {
  const page = pageHash.replace(/^#/u, "");
  const opened = item === undefined ? "" : `/${item}`;
  const modal = `#${SETTINGS_SEGMENT}/${section}${opened}`;
  if (page === "") {
    return modal;
  }
  return `${modal}${PAGE_HASH_JOIN}${page}`;
}

/**
 * The page's own hash, wherever it sits. A page can keep its own address in the hash (`/workstreams#candidates`,
 * `/automations#<recipe-id>`), and opening Settings takes the hash over. So the page's hash rides inside the modal's
 * address, and this reads it back from either: the page's hash itself while Settings is closed, or the part after
 * `&page=` while it is open. It is in the address rather than in memory, so a reload, a restored desktop tab or a
 * Back from the docs still gives it back.
 *
 * @param hash the window's `location.hash`
 * @returns the page's own hash with its `#`, or empty when the page has none
 */
export function pageHashOf({ hash }: { hash: string }): string {
  if (settingsSectionOf({ hash }) === undefined) {
    return hash;
  }
  const { page } = atPageHash({ hash });
  if (page === "") {
    return "";
  }
  return `#${page}`;
}
