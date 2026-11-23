# An install stays current, or the feedback is about code that no longer exists

Slopweaver is loaded three different ways by three different people, and when this was measured exactly one of
them was current. This page says what each route actually does, what keeps each one current **without anybody
running a command**, and — separately, because it is the honest part — what is only documented rather than
measured.

The owner's requirement, paraphrased: no pin, and every install always up to date without anybody ever needing
to run a command — the owner's own machine included, where sessions must never run stale plugins.

- [The three routes](./install-stays-current/routes-and-fixes.md)
  - [Which route a SPAWNED session takes, and the ruling that set it](./install-stays-current/routes-and-fixes.md#which-route-a-spawned-session-takes-and-the-ruling-that-set-it)
  - [What was actually wrong, measured](./install-stays-current/routes-and-fixes.md#what-was-actually-wrong-measured)
  - [The fix, route by route](./install-stays-current/routes-and-fixes.md#the-fix-route-by-route)
  - [A marketplace install: no version field at all](./install-stays-current/routes-and-fixes.md#a-marketplace-install-no-version-field-at-all)
  - […and no command to pull it](./install-stays-current/routes-and-fixes.md#and-no-command-to-pull-it)
  - [The owner's checkout: fast-forwarded at every session start](./install-stays-current/routes-and-fixes.md#the-owners-checkout-fast-forwarded-at-every-session-start)
  - [The mirror: one syncer at a time, because a slot is shared state](./install-stays-current/routes-and-fixes.md#the-mirror-one-syncer-at-a-time-because-a-slot-is-shared-state)
- [What a RUNNING session sees, and what it does not](./install-stays-current/running-sessions-and-cli.md)
  - [A colleague can actually type `slopweaver`](./install-stays-current/running-sessions-and-cli.md#a-colleague-can-actually-type-slopweaver)
  - [What is not solved](./install-stays-current/running-sessions-and-cli.md#what-is-not-solved)
