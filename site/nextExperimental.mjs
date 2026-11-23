/**
 * The site's `experimental` Next settings, in a module of their own so a test reads them without loading
 * `nextra`: the root unit lane collects `site/__tests__/unit/**` but never installs the site's own dependencies.
 *
 * `next build` typechecks by running the project's own `tsc` rather than loading TypeScript's JS API in process.
 * That is Next 16.3's default, written out because the site is on TypeScript 7.1, whose JS API is not the one
 * Next's in-process checker was built against. If the default ever flipped, the build would still pass but would
 * load the wrong API, so `site/__tests__/unit/nextConfig.test.ts` pins this setting.
 */
export const experimental = { useTypeScriptCli: true };
