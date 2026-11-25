/**
 * Why `cmux spawn` will not boot a Codex seat on its routed home: the home carries no Slopweaver install, so a
 * seat there would open with none of Slopweaver's skills or hooks and nothing would say so. Both are facts about
 * the machine, not a policy a hatch could waive, and each names the one command that repairs it.
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

/** Every reason a Codex seat is refused for want of the Slopweaver plugin. */
export type CodexPluginSeatError = PluginCacheUnreadableError | PluginInstallMissingError;

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
} as const;
