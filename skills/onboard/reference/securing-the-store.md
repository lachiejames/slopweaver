# Securing the store: the optional pass after step 9

How step 9b offers the hardening steps once the store exists. Why each step matters, what it removes and what
it leaves are in [hardening the local store](../../../docs/security/local-store-hardening.md); this file is the
procedure only, so do not restate that page — link it.

## When, and how to offer it

Offer it **once**, right after the store is up (step 9's `yarn store:start` and `store push`), because the check
reads the running containers. The lock (the page's § 4) is already on by then — `store:start` applied it. Frame it as Docker is required and stays, and _by the way, if you want it more
secure, here is what to do_. Declining costs nothing in the rest of the flow — go on to step 10.

If they say yes, take the four steps in order, one message each: what to do, the check, then what it removes
and what it leaves, in one sentence each, from the page's table.

## 1 · Ports on loopback

1. Ask them to set Docker Desktop's **Port binding behavior** to local only (`local-only-port-binding`). Do not
   name a menu path — Docker's settings reference names the setting, not where it sits, and a guessed click
   path is a riddle. First run `docker version --format "{{.Server.Platform.Name}}"`: below Docker Desktop 4.88.0, `docker ps`
   can misreport these bindings (the page has the release note), so update before any check below counts. On another runtime (colima, OrbStack), say its own setting applies and go to the check.
   If they set it at step 1 ([environment](environment.md#docker-install-docker-desktop-set-the-binding-first-and-a-floor-rather-than-a-pin)),
   before the store existed, skip to 3: its containers were created under it.
2. Recreate the stack so new containers pick the setting up: `yarn store:stop && yarn store:start` (data volumes
   survive `stop`, and `store:start` relocks the new containers).
3. Run `docker ps --format "{{.Names}}\t{{.Ports}}"` yourself and read every `supabase_*_slopweaver` row:
   - every published port on `127.0.0.1:` or `[::1]:` → loopback, one part of the proof;
   - any `0.0.0.0:` or `[::]:` → **not hardened**: name the row, and loop back to 1 once;
   - a row with no `->` publishes nothing; it needs no binding.
4. Run `docker version --format "{{.Server.Version}}"`. Older than 28.0.0 → **not hardened** even on loopback
   rows (an older engine lets a same-network host reach a localhost-published port; the page has the sources):
   upgrade first. A Linux engine on a firewalld host also needs 28.3.3 or later; Docker Desktop does not.
5. Run `docker network inspect supabase_network_slopweaver --format "{{json .Options}}"`: any key beyond
   `com.docker.network.enable_ipv4` and `…enable_ipv6` → **not hardened** until read against the page. Then
   `docker ps --filter name=_slopweaver --format "{{.Names}}\t{{.Networks}}"`: any row naming a network beside
   `supabase_network_slopweaver` → **not hardened** (another network can route around the binding).
6. **Docker Desktop only:** `docker context inspect --format "{{.Endpoints.docker.Host}}"` must print `unix://`
   and their own `~/.docker/run/docker.sock` — anything else is not shown to be this Mac's Docker Desktop, so
   report **not proven** for all of § 1 (a `DOCKER_HOST` naming the `/var/run/docker.sock` symlink may be the
   same daemon; unset it and read again). Never trust the context's name; only the endpoint. Then check for `/Library/Application Support/com.docker.docker/admin-settings.json`, and
   ask whether Docker Desktop is signed in to an organisation that sets policy. Either one → its daemon options can
   override the user's file, so report **loopback rows, routing not proven**. Neither → read
   `~/.docker/daemon.json`. Any top-level key beyond `builder` and `experimental` → **not hardened** until read
   against the page (`allow-direct-routing` and `iptables` both open a path). Only those two, with 3–5 passing →
   **proven**; say so with the rows, the version, the options and the file's keys. **Any other runtime:** its daemon can take flags this procedure cannot see, so report **loopback
   rows, routing not proven**, and name that runtime's daemon settings as the place to check.

## 2 · The service key

Say first that on a stack that kept the CLI's defaults this key is the same value on every install, so § 1 is
what protects the store from the network. This step keeps the key out of their history and proves `secrets/`
(their provider tokens too) is closed to other users.

1. Run `slopweaver secrets status` and find the `store-service-key` row.
2. **Absent** is not a failure. Say it is needed only to write or read a measurement body held in Storage, and that a copy
   nothing reads is exposure. Set it only if they want that now, with the piped command the page gives, so it
   never crosses the screen. Go on to 4 either way: the directory check protects their provider tokens too.
3. **`loose-mode`** → not hardened until `secrets set` is re-run or the file is `chmod 600`; then re-run
   `secrets status` and report the row. If any provider token's row was ever loose too, say a fixed mode does
   not take back a copy already read: that token is rotated at its provider.
4. **Always, key or no key** — `secrets status` reads the permission bits only, never the owner, the
   directories or a macOS ACL. Run the page's `ls -led` command as written — it falls back to `~/.slopweaver`
   when `$SLOPWEAVER_HOME` is unset, as Slopweaver does, so never drop that fallback — and hold its rows to the
   page's list (§ 2): every row owned by them, `secrets/` exactly `drwx------`, the home with no group or other
   `w` and a `d` row (an `l` is checked at its `realpath`, as the page says) sitting directly in their own home
   folder (the default `~/.slopweaver`) on a volume whose `mount` line has no `noowners` (`df "$HOME"` names
   it), that home folder (the first row) with no group or other `w`, no `+` or
   numbered ACL entry anywhere bar the home folder's all-`deny` macOS default (an `allow` there fails, and its
   ACL is never removed), and, when the key is set, its
   row exactly `-rw-------` (absent, `ls` says `No such file or directory` for that one row only). All of it →
   **proven** that other users cannot open `secrets/` from now on, quoting the rows; never that nobody else
   knows the key. Any miss → **not hardened**, naming which; the page says what fixes each.

## 3 · Docker access

Nothing to run; say it plainly, because this is the part they will not have known. Anything that can drive
Docker can read the whole store, past both steps above, and on Docker Desktop for Mac that is every process
running as them. What they can do is not widen it: no daemon on TCP, no socket mounted into, and no
`--network supabase_network_slopweaver` for, a container they would not trust with the corpus (one on that
network reaches Postgres directly with the default password), no shell as them for a tool they would not give the store. This step is
**advised**, never proven: nothing here finds a daemon already on TCP or a socket already mounted, so say that
one already open is theirs to find in their runtime's settings and their containers.

## 4 · The lock

Nothing to ask. Run `slopweaver store verify` yourself and read its `lock` lines: every one a `✓` →
**proven**, quoting them; any `✗` → **not hardened**, naming it, and `yarn store:start` again re-applies the
lock. Say in one sentence what it leaves, from the page's table.

## Then

One line per step — proven, not hardened, advised (§ 3), or declined — plus FileVault as what covers a lost Mac that is powered
off, which none of the three does (a Mac taken while logged in is past FileVault). Go on to step 10.
