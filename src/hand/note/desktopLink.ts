/*
 * A NOTE'S CONSOLE LINK OPENS IN THE DESKTOP APP — a new tab there (a Queue address in the Queue's one pinned tab,
 * `desktop/src/deepLink.ts`'s `deepLinkTarget`), never the owner's browser, whenever the app is installed.
 *
 * Clicking a floating note deep links into the desktop app, opening the briefing in a new tab there rather than in
 * Chrome. Every note link went through `NSWorkspace.openURL`, which hands an `http://localhost` address to the default
 * browser. The desktop app now claims `slopweaver://open?path=<console path>` (`desktop/src/deepLink.ts`, whose names
 * this restates because neither tree can import the other), and the note opens a console link that way when the
 * app can take it (`OPEN_LINK_JS`), and the address itself only when no desktop app can take it. A foreign app
 * claiming `slopweaver:` never receives a console path.
 */
import { desktopDeepLink } from "../../desktop/deepLink.js";
import { BUNDLE_ID, INSTALLED_BUNDLE } from "../../desktop/installPlan.js";
import { isLoopbackHost } from "../queueLink.js";

/**
 * A URL's port as it is actually dialled: `80` or `443` when the URL leaves it implicit.
 *
 * @param url a parsed http(s) URL
 * @returns the port number as a string
 */
function effectivePort({ url }: { url: URL }): string {
  if (url.port !== "") {
    return url.port;
  }
  if (url.protocol === "https:") {
    return "443";
  }
  return "80";
}

/**
 * Whether a link is on the console: the console's own origin, or — both being this machine — any loopback spelling
 * of its host on the same port, since `localhost`, `127.0.0.1` and `[::1]` reach the one console (`../queueLink.ts`'s
 * `isLoopbackHost`). A Slack permalink, a provider console or a page on another port is not.
 *
 * @param url the link the note would open
 * @param consoleBase the console origin links are minted under (`../consoleLink.ts`'s `consoleBaseFrom`)
 * @returns the parsed link when it is on the console, `undefined` otherwise
 */
function onConsole({ url, consoleBase }: { url: string; consoleBase: string }): URL | undefined {
  if (!URL.canParse(url) || !URL.canParse(consoleBase)) {
    return undefined;
  }
  const target = new URL(url);
  const base = new URL(consoleBase);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return undefined;
  }
  const sameOrigin = target.origin === base.origin;
  const bothLoopback =
    target.protocol === base.protocol &&
    isLoopbackHost({ hostname: target.hostname }) &&
    isLoopbackHost({ hostname: base.hostname }) &&
    effectivePort({ url: target }) === effectivePort({ url: base });
  if (!sameOrigin && !bothLoopback) {
    return undefined;
  }
  return target;
}

/**
 * The console path — pathname, query and hash — a link on the console names, or `undefined` when the link is anywhere
 * else. Separate from {@link desktopLinkFor} so a caller can tell "not the console" from "the console, but a path the
 * app refuses", which that function answers alike.
 *
 * A backslash in the query or fragment is percent-encoded (an http(s) pathname never carries one), which the console
 * reads back identically and the app accepts.
 *
 * @param url the link to read
 * @param consoleBase the console origin links are minted under (`../consoleLink.ts`'s `consoleBaseFrom`)
 * @returns the path with its query and hash, or `undefined` off the console
 */
export function consolePathForUrl({ url, consoleBase }: { url: string; consoleBase: string }): string | undefined {
  const target = onConsole({ consoleBase, url });
  if (target === undefined) {
    return undefined;
  }
  const tail = `${target.search}${target.hash}`.replaceAll("\\", "%5C");
  return `${target.pathname}${tail}`;
}

/**
 * The desktop app's address for a link on the console, or `undefined` when the link is anywhere else or is one the app
 * refuses. What the app still refuses — the overlay's own page, a path it would read as another host — a note never
 * hands it.
 *
 * @param url the link the note would open
 * @param consoleBase the console origin links are minted under
 * @returns `slopweaver://open?path=<path, query and hash>`, or `undefined`
 */
export function desktopLinkFor({ url, consoleBase }: { url: string; consoleBase: string }): string | undefined {
  const path = consolePathForUrl({ consoleBase, url });
  if (path === undefined) {
    return undefined;
  }
  return desktopDeepLink({ path });
}

/**
 * The desktop app's address for each link a note can open that lives on the console, and `null` for a console link the
 * app refuses, which the note leaves inert while a desktop app is there rather than hand to the owner's browser. Every other link has no entry.
 *
 * @param urls every link the note draws, empty strings included
 * @param consoleBase the console origin
 * @returns a link-to-address map, one entry per distinct console link
 */
export function desktopLinksFor({
  urls,
  consoleBase,
}: {
  urls: readonly string[];
  consoleBase: string;
}): Record<string, string | null> {
  const links: Record<string, string | null> = {};
  for (const url of urls) {
    if (onConsole({ consoleBase, url }) === undefined) {
      continue;
    }
    const deep = desktopLinkFor({ consoleBase, url });
    if (deep === undefined) {
      links[url] = null;
      continue;
    }
    links[url] = deep;
  }
  return links;
}

/**
 * The emitted program's one way to open a link: the desktop app's address for it when the note was given one AND the
 * desktop app can take it, the link itself otherwise. The bundle installed at `/Applications/Slopweaver.app` is asked
 * first, opened directly once its identifier reads `ai.slopweaver.desktop`, as `browser present`'s `open -a` does, so another app
 * holding the scheme, or reusing our identifier elsewhere, never receives a console path. A verified bundle that fails to launch is never a fall back to the browser, as
 * `browser present`'s failed open is an error. With no canonical install, the app LaunchServices
 * hands `slopweaver:` to is used when it is `ai.slopweaver.desktop`, opened with that verified app rather than
 * re-resolved, so a handler changed between the check and the open never receives the link. A console link no desktop app could take as an
 * address (a `null` entry) opens nothing while a desktop app is there, never the
 * browser. Needs `nsstr` and `STEP.desktopLinks`. A
 * checkout constant, so it sits in the program and its build digest.
 */
export const OPEN_LINK_JS = `
function isDesktopApp(handler) {
  if (handler === null || handler === undefined || handler.isNil()) { return false; }
  var bundle = $.NSBundle.bundleWithURL(handler);
  if (bundle === null || bundle === undefined || bundle.isNil()) { return false; }
  return bundle.bundleIdentifier.js === ${JSON.stringify(BUNDLE_ID)};
}
function openInDesktopApp(workspace, deepUrl) {
  var app = $.NSURL.fileURLWithPath(nsstr(${JSON.stringify(INSTALLED_BUNDLE)}));
  if (!isDesktopApp(app)) { app = workspace.URLForApplicationToOpenURL(deepUrl); }
  if (!isDesktopApp(app)) { return false; }
  workspace.openURLsWithApplicationAtURLOptionsConfigurationError(
    $.NSArray.arrayWithObject(deepUrl), app, 0, $.NSDictionary.dictionary, null);
  return true;
}
function desktopAppPresent(workspace) {
  return isDesktopApp($.NSURL.fileURLWithPath(nsstr(${JSON.stringify(INSTALLED_BUNDLE)}))) ||
    isDesktopApp(workspace.URLForApplicationToOpenURL($.NSURL.URLWithString(nsstr("slopweaver://open"))));
}
function openLink(url) {
  var workspace = $.NSWorkspace.sharedWorkspace;
  var known = Object.prototype.hasOwnProperty.call(STEP.desktopLinks, url);
  var deep = known ? STEP.desktopLinks[url] : null;
  if (deep !== null && openInDesktopApp(workspace, $.NSURL.URLWithString(nsstr(deep)))) { return; }
  if (known && desktopAppPresent(workspace)) { return; }
  workspace.openURL($.NSURL.URLWithString(nsstr(url)));
}
`;
