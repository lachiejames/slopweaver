/**
 * Lazy manifest for the `browser` noun — which of the owner's OWN Chrome profiles every browser leg reads,
 * whether it currently holds a session for an origin, and the pin that makes the first of those mechanical.
 *
 * The whole noun exists because of one ruling (`docs/browser-route.md`): the owner's real work Chrome is
 * the only browser anything here uses, so the four dedicated profiles under `$SLOPWEAVER_HOME` and the four
 * sign-in verbs that filled them are gone (`docs/browser-route/screenshot-reading-and-retirement.md`), and what replaces all of them is a
 * recorded directory name (`docs/browser-route/brief-profile-and-walks.md`).
 * The two journal sub-verbs exist for a measured reason: the guard journalled what it
 * GRANTED (four rows) and nothing about what it DECIDED, so a refusal and a break-glass waiver alike left no
 * trace at all — `src/admit/browserVerdictJournal.ts` carries the measurement.
 *
 * No verb here reaches a provider or writes anything outside the machine, so none is door-routed — `shot`
 * included: it drives the owner's own Chrome, which doctrine rule 3 makes the door rather than a bypass of
 * one. It refuses a platform registered `refuse-every-write` that HAS a door — an arm the register leaves
 * uninhabited today — and photographs everything else, doored or not. A screenshot is still a read — see `../commands/browser/shotCore.ts`
 * for the ruling and what it widened.
 *
 * `image-record` writes no picture at all: it records what a session SAW in one, which is what an outbound
 * attachment is now admitted against (`../../visualEvidence/`). `annotate` is the one that DRAWS onto an existing
 * picture, and it records nothing: its output is looked at and then recorded through `image-record`. Those and the
 * other picture verbs' entries live in `./browserPictures.ts`, split out at the size ratchet.
 */
import { BROWSER_USAGE } from "../commands/browser/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { browserPictureManifest } from "./browserPictures.js";

const loadBrowser = () => import("../commands/browser/profileRun.js").then((m) => m.browserCommand);

const profileMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver browser profile --list",
  parseRejectIsIoFree: true,
  summary:
    "Report, list or record which of your own Chrome profiles every browser leg reads — no repository may " +
    "name one, so the choice lives on the machine",
  usage: BROWSER_USAGE,
} as const;

const cookiesMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver browser cookies --origin https://github.com",
  parseRejectIsIoFree: true,
  summary:
    "Report whether that profile currently holds a session for an origin — the cookie names and when they " +
    "lapse, never a value",
  usage: BROWSER_USAGE,
} as const;

const pinMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver browser pin",
  parseRejectIsIoFree: true,
  summary:
    "Write the shim every Playwright connect page is launched through, so it opens in the recorded profile " +
    "rather than whichever one Chrome was last used in",
  usage: BROWSER_USAGE,
} as const;

const verdictsMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver browser verdicts --blocked",
  parseRejectIsIoFree: true,
  summary:
    "Read back what the browser-door guard decided — every allow, every refusal with the clause that " +
    "failed, and every break-glass waiver with the verdict it overrode",
  usage: BROWSER_USAGE,
} as const;

const breakGlassMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: 'slopweaver browser break-glass --reason "hand-driving the console to reproduce a refusal"',
  parseRejectIsIoFree: true,
  summary:
    "Record a bounded, expiring decision to drive past the browser-door guard — journalled against this " +
    "session, unlike the environment variable it replaces",
  usage: BROWSER_USAGE,
} as const;

const openMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver browser open --url https://us3.datadoghq.com/monitors",
  parseRejectIsIoFree: true,
  summary:
    "Take an interaction session on a page in your own Chrome and hand back its id and first look — the " +
    "page stays exactly as you left it between commands",
  usage: BROWSER_USAGE,
} as const;

const inspectMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver browser inspect --url https://github.com/lachiejames/slopweaver/pulls",
  parseRejectIsIoFree: true,
  summary:
    "Open ONE page on a platform the browser register names, take the look `open` takes, and close its tab " +
    "again, in one call — the console voice's browser, with nothing it can click or type",
  usage: BROWSER_USAGE,
} as const;

const presentMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver browser present --destination datadog",
  parseRejectIsIoFree: true,
  summary:
    "Take the browser to ONE page and leave it open — a named destination resolved on this install (Datadog's own " +
    "site) or an address on the browser register in the owner's own Chrome, or a console page (a published local page, " +
    "or a console address such as the Queue or a Settings section) as a new tab in the Slopweaver desktop app; " +
    "the console voice's way to open a page",
  usage: BROWSER_USAGE,
} as const;

const signInMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver browser sign-in --provider datadog",
  parseRejectIsIoFree: true,
  summary:
    "Look whether the owner's Chrome is signed in to Datadog or GitHub, and on a wall name the one button the fleet " +
    "presses or the step that is the owner's — recorded, so a sign-in card stands on a fresh look",
  usage: BROWSER_USAGE,
} as const;

const readMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver browser read --session <id>",
  parseRejectIsIoFree: true,
  summary:
    "Look at an open session's page — a picture of the viewport, its URL, its title, and a bounded outline of " +
    "its elements with the refs an action aims at; --under <ref> and --find <text> open more of the latest look " +
    "without a new one. Never refused by the read-only rail",
  usage: BROWSER_USAGE,
} as const;

const scrollMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: true,
  dryParseSafe: true,
  effect: "external-write",
  example: "slopweaver browser scroll --session <id> --pages 2",
  parseRejectIsIoFree: true,
  summary:
    "Move an open session's page one screen at a time and photograph each screen, saying where in the " +
    "document it is — the loop for when what you want is below the fold; ends with a fresh read",
  usage: BROWSER_USAGE,
} as const;

const actMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: true,
  dryParseSafe: true,
  effect: "external-write",
  example: "slopweaver browser act --session <id> --do click --target f1e11 --observation <id>",
  parseRejectIsIoFree: true,
  summary:
    "Perform ONE interaction on an open session's page — click, fill, type, select, check, hover, press, " +
    "drag, upload, download, navigate — showing its target in the viewport first and photographing the " +
    "viewport its own result leaves behind",
  usage: BROWSER_USAGE,
} as const;

const aimMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver browser aim --session <id> --target f1e11",
  parseRejectIsIoFree: true,
  summary:
    "Show ONE element on an open session's page and photograph it there, acting on nothing — the target " +
    "scrolled into the viewport, that viewport before the mark and again with the target marked, and what " +
    "the register says this page may be driven to do. `act` takes the same pictures itself; this is for " +
    "looking first, and it grants nothing",
  usage: BROWSER_USAGE,
} as const;

const closeMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver browser close --session <id>",
  parseRejectIsIoFree: true,
  summary: "Close an interaction session's tab and let go of the browser, leaving your Chrome running",
  usage: BROWSER_USAGE,
} as const;

const sessionsMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver browser sessions",
  parseRejectIsIoFree: true,
  summary:
    "List the interaction sessions this install is holding open: who opened each, whether that owner is live, the page, the age, and what the next reap will do",
  usage: BROWSER_USAGE,
} as const;

export const browserManifest: Readonly<Record<string, VerbManifestEntry>> = {
  act: lazy({ load: loadBrowser, meta: actMeta }),
  aim: lazy({ load: loadBrowser, meta: aimMeta }),
  ...browserPictureManifest,
  "break-glass": lazy({ load: loadBrowser, meta: breakGlassMeta }),
  close: lazy({ load: loadBrowser, meta: closeMeta }),
  cookies: lazy({ load: loadBrowser, meta: cookiesMeta }),
  inspect: lazy({ load: loadBrowser, meta: inspectMeta }),
  open: lazy({ load: loadBrowser, meta: openMeta }),
  pin: lazy({ load: loadBrowser, meta: pinMeta }),
  present: lazy({ load: loadBrowser, meta: presentMeta }),
  "sign-in": lazy({ load: loadBrowser, meta: signInMeta }),
  read: lazy({ load: loadBrowser, meta: readMeta }),
  profile: lazy({ load: loadBrowser, meta: profileMeta }),
  scroll: lazy({ load: loadBrowser, meta: scrollMeta }),
  sessions: lazy({ load: loadBrowser, meta: sessionsMeta }),
  verdicts: lazy({ load: loadBrowser, meta: verdictsMeta }),
};
