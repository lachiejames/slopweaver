/**
 * Why a publish could not read a file its page loads (`./pageAssets.ts`). Every one refuses the whole publish before
 * the store is opened, and none has a hatch: a page stored without a file it loads shows a broken image for good.
 */

/** The page loads files and the publish was not told where to read them from. */
export interface PageAssetsFromRequiredError {
  readonly code: "PAGE_ASSETS_FROM_REQUIRED";
  readonly message: string;
  readonly references: readonly string[];
}

/** The `--assets-from` directory is missing, a link, or not a directory. */
export interface PageAssetRootUnusableError {
  readonly code: "PAGE_ASSET_ROOT_UNUSABLE";
  readonly message: string;
  readonly root: string;
}

/** A file the page loads is not there. */
export interface PageAssetMissingError {
  readonly code: "PAGE_ASSET_MISSING";
  readonly message: string;
  readonly reference: string;
  readonly relativePath: string;
}

/** A file the page loads is reached through a link, is not a regular file, or names a path no file can sit at. */
export interface PageAssetUnsafeError {
  readonly code: "PAGE_ASSET_UNSAFE";
  readonly message: string;
  readonly relativePath: string;
}

/** A file changed while it was read, so its bytes are not one version of it. */
export interface PageAssetChangedError {
  readonly code: "PAGE_ASSET_CHANGED";
  readonly message: string;
  readonly path: string;
}

/** A file could not be read for another reason. */
export interface PageAssetUnreadableError {
  readonly code: "PAGE_ASSET_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** Every way reading a page's files fails. */
export type PageAssetError =
  | PageAssetChangedError
  | PageAssetMissingError
  | PageAssetRootUnusableError
  | PageAssetsFromRequiredError
  | PageAssetUnreadableError
  | PageAssetUnsafeError;

export const PageAssetErrors = {
  changed: ({ path }: { path: string }): PageAssetChangedError => ({
    code: "PAGE_ASSET_CHANGED",
    message: `${path} changed while it was read; publish again once it is written`,
    path,
  }),
  missing: ({
    reference,
    relativePath,
    where,
  }: {
    reference: string;
    relativePath: string;
    /** Where it was looked for, worded to follow "is not": `under <root>`, `at <path>`, `among the publisher's media`. */
    where: string;
  }): PageAssetMissingError => ({
    code: "PAGE_ASSET_MISSING",
    message: `the page loads ${reference}, and ${relativePath} is not ${where}; nothing was published`,
    reference,
    relativePath,
  }),
  required: ({ references }: { references: readonly string[] }): PageAssetsFromRequiredError => ({
    code: "PAGE_ASSETS_FROM_REQUIRED",
    message:
      `the page loads ${String(references.length)} file(s) beside it (${references.join(", ")}); ` +
      "name the directory they are read from with --assets-from <dir>",
    references,
  }),
  rootUnusable: ({ root, why }: { root: string; why: string }): PageAssetRootUnusableError => ({
    code: "PAGE_ASSET_ROOT_UNUSABLE",
    message: `--assets-from ${root} ${why}`,
    root,
  }),
  unreadable: ({ path, reason }: { path: string; reason: string }): PageAssetUnreadableError => ({
    code: "PAGE_ASSET_UNREADABLE",
    message: `could not read ${path}: ${reason}`,
    path,
  }),
  unsafe: ({ relativePath, why }: { relativePath: string; why: string }): PageAssetUnsafeError => ({
    code: "PAGE_ASSET_UNSAFE",
    message: `the page loads ${relativePath}, which ${why}`,
    relativePath,
  }),
} as const;
