/**
 * Why `cmux spawn` will not boot a Codex seat on its routed home: the home carries no Slopweaver install, or one
 * that cannot be read, so a seat there would open with none of Slopweaver's skills or hooks and nothing would say
 * so. Each is a fact about the machine, not a policy a hatch could waive, and each names the one command that
 * repairs it.
 */
import { FOREGROUND_SYNC_COMMAND } from "./plan.js";

/** The home's plugin cache exists and cannot be listed, so Codex cannot load an install from it either. */
export interface PluginCacheUnreadableError {
  readonly code: "PLUGIN_CACHE_UNREADABLE";
  readonly message: string;
  readonly codexHome: string;
  readonly cacheRoot: string;
}

/** No marketplace directory in the routed home's plugin cache holds a Slopweaver install stamp. */
export interface PluginInstallMissingError {
  readonly code: "PLUGIN_INSTALL_MISSING";
  readonly message: string;
  readonly codexHome: string;
  /** Where a stamp was looked for, with `*` standing for every marketplace directory. */
  readonly stampPath: string;
}

/**
 * A marketplace directory's install stamp could not be looked up — a directory on its path cannot be searched, or
 * the path does not resolve — and no other marketplace directory holds a readable install.
 */
export interface PluginInstallUnreadableError {
  readonly code: "PLUGIN_INSTALL_UNREADABLE";
  readonly message: string;
  readonly codexHome: string;
  /** The concrete stamp path whose lookup failed. */
  readonly stampPath: string;
  /** The lookup's own error, carrying its errno. */
  readonly why: string;
}

/** Every reason a Codex seat is refused for want of the Slopweaver plugin. */
export type CodexPluginSeatError =
  PluginCacheUnreadableError | PluginInstallMissingError | PluginInstallUnreadableError;

/** Factories for {@link CodexPluginSeatError}, so the spawn and its tests build one message. */
export const CodexPluginSeatErrors = {
  cacheUnreadable: ({
    cacheRoot,
    codexHome,
    why,
  }: {
    cacheRoot: string;
    codexHome: string;
    why: string;
  }): PluginCacheUnreadableError => ({
    cacheRoot,
    code: "PLUGIN_CACHE_UNREADABLE",
    codexHome,
    message:
      `the Codex home ${codexHome} cannot be checked for the Slopweaver plugin (${cacheRoot} could not be listed: ` +
      `${why}), so a seat there would boot without Slopweaver's skills and hooks — make it readable, run ` +
      `\`${FOREGROUND_SYNC_COMMAND}\` from the main checkout, then spawn again`,
  }),
  installMissing: ({ codexHome, stampPath }: { codexHome: string; stampPath: string }): PluginInstallMissingError => ({
    code: "PLUGIN_INSTALL_MISSING",
    codexHome,
    message:
      `the Codex home ${codexHome} has no Slopweaver plugin installed (no ${stampPath}), so a seat there would boot ` +
      `without Slopweaver's skills and hooks — run \`${FOREGROUND_SYNC_COMMAND}\` from the main checkout, then spawn again`,
    stampPath,
  }),
  installUnreadable: ({
    codexHome,
    stampPath,
    why,
  }: {
    codexHome: string;
    stampPath: string;
    why: string;
  }): PluginInstallUnreadableError => ({
    code: "PLUGIN_INSTALL_UNREADABLE",
    codexHome,
    message:
      `the Slopweaver plugin install at ${stampPath} could not be read (${why}), so a seat there would boot ` +
      `without Slopweaver's skills and hooks — make it readable, run \`${FOREGROUND_SYNC_COMMAND}\` from the main ` +
      `checkout, then spawn again`,
    stampPath,
    why,
  }),
} as const;
