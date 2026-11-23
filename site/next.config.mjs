import nextra from "nextra";

import { experimental } from "./nextExperimental.mjs";

// Local-only docs. There is no deploy target and there is not meant to be one: the site is read on the
// machine that renders it (owner ruling 290-15 — docs are internal, a public Pages site was never wanted).
//
// The docs live under `/docs`; the root is the console (owner turn 291-69: the live UI most prominent, the
// docs embedded). `contentDirBasePath` is what moves every `content/` page there, and the docs layout reads
// its page map with the same prefix.
const withNextra = nextra({
  contentDirBasePath: "/docs",
  defaultShowCopyCode: true,
});

/**
 * The build slot a production console is built into and served from, named by `scripts/docs-site.sh`.
 *
 * Two slots rather than `.next` because a rebuild runs WHILE the old server is still answering :3000: a
 * build over the tree `next start` is reading deletes the chunks its open pages still ask for. The refresh
 * builds into the idle slot, then restarts onto it, so the console is down for a restart rather than a
 * build. Unset — `yarn dev`, `--build`, CI — it is Next's own `.next`, exactly as before.
 */
const servedSlot = process.env.SLOPWEAVER_SITE_DIST_DIR;
const slotConfig = {};
if (servedSlot !== undefined && servedSlot !== "") {
  slotConfig.distDir = servedSlot;
}

/**
 * The build this bundle is baked from, which the sidebar's build status compares with what the console serves
 * now (`site/lib/buildStanding.ts`). `scripts/docs-site.sh` exports the commit it is building and its commit
 * time; nothing here asks git, so a production bundle's sha is exactly the one its run record names. Both or
 * neither: a malformed pair is dropped whole, and the page says its build carries no identity.
 */
const buildSha = process.env.SLOPWEAVER_BUILD_SHA;
const buildCommittedIso = process.env.SLOPWEAVER_BUILD_COMMITTED_ISO;
const buildEnv = {};
if (
  buildSha !== undefined &&
  /^[0-9a-f]{40}$/.test(buildSha) &&
  buildCommittedIso !== undefined &&
  !Number.isNaN(Date.parse(buildCommittedIso))
) {
  buildEnv.SLOPWEAVER_BUILD_SHA = buildSha;
  buildEnv.SLOPWEAVER_BUILD_COMMITTED_ISO = buildCommittedIso;
}

/** The docs groups that once sat at the root, so a link written before the move still lands. */
const MOVED_DOCS = ["phases", "model", "trust", "build", "showcase"];

export default withNextra({
  ...slotConfig,
  env: buildEnv,
  reactStrictMode: true,
  // Off because this console is READ from screenshots. The dev overlay's floating badge pins itself to the
  // bottom-left corner, which is where the sidebar's own footer sentence ends — so every shot of every page
  // came back with "…each run one verb and say what it did" half covered by a glyph that never ships. It
  // tells an agent driving `slopweaver browser shot` nothing, and it made a real sentence unreadable.
  devIndicators: false,
  // `next build` typechecks through the project's own `tsc` CLI; why, and the test pinning it, sit in the module.
  experimental,
  // This repo has a lockfile of its own and `site/` has another; without this Next picks the outer one as
  // its root and warns on every build. The site’s root is the site.
  outputFileTracingRoot: import.meta.dirname,
  async redirects() {
    return [
      // The root is the Queue. Query strings ride along.
      { destination: "/queue", permanent: false, source: "/" },
      // An act is the Alignment page's since 4 Oct 2026 (`lib/alignment.ts`), so a floating note or Slack link minted
      // before the split, opening one on the Queue, lands on that page with its query kept.
      {
        destination: "/alignment",
        has: [{ key: "open", type: "query", value: "act:.+" }],
        permanent: false,
        source: "/queue",
      },
      // The Setup page went into the Settings modal (owner, 6 Nov 2026 call: "get rid of the setup page"), so a link
      // or a restored desktop tab still on it opens the Queue with Settings on Models.
      { destination: "/queue#settings/models", permanent: false, source: "/setup" },
      // The fleet page renamed when scheduled asks became automations (owner, 5 Oct 2026).
      { destination: "/docs/fleet/automations", permanent: false, source: "/docs/fleet/scheduled-asks" },
      // The docs groups, each moved whole under /docs. Listed one by one rather than as a catch-all so
      // `/api/*` and the console's own routes are never swallowed.
      ...MOVED_DOCS.map((group) => ({ destination: `/docs/${group}`, permanent: false, source: `/${group}` })),
      ...MOVED_DOCS.map((group) => ({
        destination: `/docs/${group}/:path*`,
        permanent: false,
        source: `/${group}/:path*`,
      })),
    ];
  },
});
