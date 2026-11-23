/**
 * The build this page's bundle was baked from, named once for every reader of it — the sidebar's update line
 * (`site/components/console/BuildStatus.tsx`) and the Alignment page's steers "waiting for your app to update"
 * (`./steerInApp.ts`). `next.config.mjs` inlines both values at build time from `scripts/docs-site.sh`, so they
 * cannot change under a page.
 */
import type { LoadedBuild } from "./buildStanding";

/** The loaded build; both fields `undefined` when the build carried no identity. */
export const LOADED_BUILD: LoadedBuild = {
  committedIso: process.env.SLOPWEAVER_BUILD_COMMITTED_ISO,
  sha: process.env.SLOPWEAVER_BUILD_SHA,
};
