# The local docs site

`yarn docs` renders a Nextra site on this machine and nowhere else — at `http://localhost:3000`, or the next
free port when something already holds it. That is the DEV server, for a seat looking at its own pages; the
console the owner reads is the production build below, [§ The production console](docs-site/runtime.md#the-production-console-built-and-served-rebuilt-when-the-checkout-moves).

```bash
bash scripts/docs-site.sh --serve    # THE CONSOLE: a production build on :3000, rebuilt when the checkout moves
yarn docs                            # serve it in the foreground; installs site/ on first run
bash scripts/docs-site.sh --start    # serve it in the BACKGROUND, or reuse the one already up
bash scripts/docs-site.sh --status   # what this worktree has recorded: pid, port, log
bash scripts/docs-site.sh --stop     # end the recorded server and its whole tree
bash scripts/docs-site.sh --check    # is it wired? (what the handover probe runs)
bash scripts/docs-site.sh --build    # a production build, for proving a page renders
```

- [One server per worktree, recorded — and what reaps the ones that outlive a seat](./docs-site/runtime.md)
  - [The production console: built and served, rebuilt when the checkout moves](./docs-site/runtime.md#the-production-console-built-and-served-rebuilt-when-the-checkout-moves)
  - [Internal, and local-first](./docs-site/runtime.md#internal-and-local-first)
  - [Why `site/` is not a Yarn workspace](./docs-site/runtime.md#why-site-is-not-a-yarn-workspace)
- [Diagrams: hand-authored SVG, and the bar they have to clear](./docs-site/content-and-assets.md)
  - [The page tree IS the progressive disclosure](./docs-site/content-and-assets.md#the-page-tree-is-the-progressive-disclosure)
  - [The verb list is READ, never transcribed](./docs-site/content-and-assets.md#the-verb-list-is-read-never-transcribed)
  - [The mark is THE OWNER'S, traced from the file the owner supplied](./docs-site/content-and-assets.md#the-mark-is-the-owners-traced-from-the-file-the-owner-supplied)
- [Verifying a change to the site](./docs-site/verification.md)
  - [Nothing here wraps, so nothing here warns](./docs-site/verification.md#nothing-here-wraps-so-nothing-here-warns)
