# Phase 5 — Fix: archive extraction rejected a valid archive

Commit: **`1e54e33`** — `fix(lia): archive extraction rejected every entry of a valid archive`

**Not an installer PASS.** The extraction step is fixed and tested; nothing after it
has been exercised on Windows. See "Still requires QA" below.

---

## 1. The exact entry that triggered the rejection

```
alltalk_tts-f16117e95b540e9bbbd8247b49ca6c6b1350b172/
```

That is the **wrapper directory marker** — the first entry in the GitHub archive,
not a file. Read directly from the archive's first local file header (signature
`0x04034b50`, name length 53, extra 9).

The archive downloaded was the same artifact QA hit: **97,570,803 bytes**, matching
the `bytes=97570803` in the QA log exactly.

## 2. Cause

**It was a false positive. The archive was never hostile.**

Verified against the pinned tree: 732 entries, and

| Check | Count |
|---|---|
| entries containing `..` | 0 |
| absolute paths / leading slash | 0 |
| drive letters | 0 |
| backslashes | 0 |
| symlinks (`mode 120000`) | 0 |

The only unusual names were `.github/...`, which are ordinary dot-directories.

Two separate defects, both landing on that same first entry:

**(a) Separator mismatch — the one that produced the error.**

`appDir()` built the destination by string concatenation with a hardcoded `/`:

```
destDir = C:\Users\lia\AppData\Local\Lia\runtimes\alltalk/app
```

`path.join` then normalised the target to backslashes:

```
target  = C:\Users\lia\AppData\Local\Lia\runtimes\alltalk\app\alltalk_tts-f16117e...\
```

`target.startsWith(destDir)` is **false** — the strings differ at the separator and
nowhere else. Because the mismatch is in the root, it was false for *every* entry;
the first one simply reported first.

Reproduced with `path.win32` rather than assumed, since it is invisible on the
POSIX machine the original tests ran on.

**(b) The wrapper was never stripped.**

The old code assigned `topLevel` *after* computing `relative`:

```js
const relative = parts.slice(topLevel === undefined ? 0 : 1).join('/')
if (topLevel === undefined) topLevel = parts[0]   // too late
```

So on the first entry `relative` kept the wrapper prefix instead of being empty,
and the "nothing to write" short-circuit never fired. Even with the separator
fixed, this entry would have created a stray wrapper directory.

## 3. Previous rule

```js
const target = join(destDir, relative)
if (!target.startsWith(destDir)) reject(...)
```

Wrong twice over: `destDir` was never normalised, and `startsWith` has no separator
boundary — it accepts `C:\runtime-evil\x` for a root of `C:\runtime`.

## 4. New rule

Validation happens **before** resolution, so a traversal attempt stays visible
instead of being silently normalised away.

```
1. empty name                          -> refuse  'empty'
2. normalise separators (Windows only) -> '\\' becomes '/'
3. starts with '//'                    -> refuse  'unc'          (before the '/' case)
4. starts with '/'                     -> refuse  'absolute'
5. matches /^[a-z]:/i                  -> refuse  'drive-letter'
6. any segment === '..'                -> refuse  'parent-traversal'
7. strip the detected wrapper, if any
8. resolve(root, ...segments)
9. target === root || target.startsWith(root + sep)
                                       else refuse 'outside-root'
```

with `root = resolve(destDir)` — the actual Windows fix.

Supporting changes:

- **`appDir()`** now uses `path.join` instead of a concatenated `/`. The same
  mismatch also fed the `exists()` checks, so fixing it at the source matters
  beyond the extractor.
- **Symlinks are refused outright.** yauzl exposes no helper, so it is read from the
  ZIP external attributes (`S_IFLNK`, Unix-made entries only). Filename validation
  cannot protect against a link — the traversal check only ever sees the link's own
  path, never its target. The official archive contains none, so refusing costs
  nothing.
- **Strip-root is detected from the full entry list** before anything is written,
  not guessed from the first entry. It strips only when a single first component
  wraps everything and that component is an ordinary name; an archive with no
  wrapper is extracted as-is rather than losing a real directory.
- **Diagnostics** log the first refused entry only: reason, raw name, normalised
  name, root, computed target. A 732-entry archive would otherwise emit 732
  identical lines and bury the one that matters.

**Defence in depth, worth knowing about:** yauzl itself validates entry names while
decoding (`validateFileName`, active by default) and rejects `..`, absolute paths
and backslashes before this code sees them. The Lia's check is the second layer, and
it is the one that knows the destination root. Both are kept.

## 5. Tests

New:

- `archive-path.test.ts` — **41 tests**. Platform is injected, so Windows semantics
  are exercised on a POSIX machine via `path.win32`. That is the only way to catch a
  separator bug before a user does.
- `voice-runtime-extract.test.ts` — **8 tests**, end-to-end against real ZIP files.

Full suite: **102 files, 910 passed, 1 skipped.** `vue-tsc` back to the 3
pre-existing baseline errors. ESLint clean on every file touched.

Accepts: `repo-sha/file.txt`, `repo-sha/sub/file.py`, `repo-sha/.github/x`, forward
slashes on Windows, POSIX shapes, and a backslash treated as an ordinary filename
character on POSIX (where it is one).

Rejects: `../evil`, `repo/../../evil`, `..\evil`, `C:\evil`, `C:/evil`, `/evil`,
`\\server\share\evil`, `//server/share/evil`, empty, and the prefix-collision case.

One honest limitation: JSZip refuses to *create* entries containing `../` or
absolute paths, so hostile archives are assembled by hand in the test — a stored
ZIP built byte by byte — rather than through a library that would sanitise them.

## 6. Mutations

| # | Mutation | Result |
|---|---|---|
| 1 | Remove the `..` guard | 5 failed |
| 2 | Accept an absolute path | 2 failed |
| 3 | Naive `startsWith` boundary | 3 failed * |
| 4 | Do not resolve the root (normalise after) | 2 failed |
| 5 | Accept an external symlink | 1 failed |

\* **Mutation 3 initially survived, and the reason matters.** With `..` refused, a
resolved entry can no longer leave the root, so the boundary comparison is
unreachable through the entry name alone — the naive form passed all 44 tests. The
comparison was extracted into `isInsideRoot()` and tested directly, which is what
made the mutation visible. A check that cannot be reached by any test can be
silently weakened; naming it and testing it is the fix.

## 7. Still requires QA

The extraction step is fixed and tested, but nothing downstream of it has run on
Windows:

1. **`fetch-source` completes** and the tree lands in `runtimes/alltalk/app` with no
   wrapper directory.
2. **`atsetup.bat -silent`** runs to completion with stdin closed — the load-bearing
   assumption from Phase 5, still unverified.
3. The six `choice /C YN` prompts in its failure branches fail rather than hang.
4. The CUDA PyTorch stack downloads on the RX 580.
5. Health comes up and the runtime reaches `ready`.

If it fails again, the log will now name the entry and the reason instead of only
saying that something escaped.
