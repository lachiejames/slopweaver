// Yarn 4 constraints — machine-enforced package.json invariants (run via `yarn constraints`).
// This repo pins EVERY dependency to an exact version (no ^/~ ranges) and always declares packageManager.
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Yarn resolves this file itself, so the shape of `constraints`'s one argument is Yarn's to choose. The
 * annotation is what `checkJs` reads — without it this file is `any` inside a tree that is otherwise
 * type-checked whole (291-68).
 *
 * @type {import("@yarnpkg/types").Yarn.Config}
 */
module.exports = {
  async constraints({ Yarn }) {
    for (const workspace of Yarn.workspaces()) {
      workspace.set("packageManager", "yarn@4.18.1");
    }
    for (const dep of Yarn.dependencies()) {
      // A `portal:`/`workspace:`/`patch:` protocol range is intentional; only version ranges must be exact.
      if (dep.range.includes(":")) {
        continue;
      }
      if (dep.range.startsWith("^") || dep.range.startsWith("~")) {
        dep.update(dep.range.slice(1));
        continue;
      }
      if (!EXACT_VERSION.test(dep.range)) {
        dep.error(`${dep.ident} must use an exact pinned version, got ${dep.range}`);
      }
    }
  },
};
