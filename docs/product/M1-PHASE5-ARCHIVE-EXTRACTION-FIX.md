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
3. The six `choice /C YN` prompts fail rather than hang. **Partly narrowed since
   this list was written** — see 8.6.
4. The CUDA PyTorch stack downloads on the RX 580.
5. Health comes up and the runtime reaches `ready`.

If it fails again, the log will now name the entry and the reason instead of only
saying that something escaped.

## 8. Follow-up work after this report

Written while waiting on the QA run above. Each item is a separate commit.

### 8.1 A finished extraction was indistinguishable from a hang (`ea4f07f`)

The log carried `extract-start` and `entry-rejected` but no completion signal, so a
97 MB extraction sitting on a slow disk looked identical to a dead process.
`createRuntimeExtract` now takes an `onComplete({ elapsedMs, entries })` callback
that fires after the entry loop, logged as `extract-complete`. It deliberately does
not fire when an entry is rejected, so "complete" still means complete.

### 8.2 The installer timeout was untested (`3726812`)

That timeout is the only thing standing between a stalled `choice /C YN` prompt and
a window that says "Installing" forever, and it had no test at all. The fake child
process could only exit, so the test stub was taught to hang, and the test now
asserts the child is killed with `SIGKILL` rather than merely that one spawn
happened. Removing the `kill` call fails it.

### 8.3 A path the installer cannot use is now refused up front (`85ebe2a`)

`atsetup.bat` aborts outright when its working directory contains a space — line
353 in the silent branch, because Miniconda cannot be installed silently under one.
The runtime lives under `userData`, which on Windows includes the user's name, so
`C:\Users\John Smith\...` is a plausible install path the installer will simply
refuse.

Before this the user downloaded 97 MB, the installer printed a sentence about folder
names and exited, and Lia reported a setup failure with no idea why.
`assessInstallPath()` now rejects a space before the download starts, and warns —
without blocking — on the characters the installer itself only warns about. Inventing
a stricter rule would have refused installs that would have succeeded.

The packaged app uses `productName: 'Lia'`, which has no space, so this only bites on
the username — which is exactly the case nobody would think to test for.

### 8.4 Four facts that were each written down twice

Found by looking for the same mistake in other places rather than waiting for it to
surface on a machine.

| Commit | The duplicated fact | What went wrong |
| --- | --- | --- |
| `0407bdc` | The server address | The bootstrap health-checked a hardcoded `127.0.0.1:7851` while everything else read the config. A user who moved the port got "the voice system did not become ready" for a server that was running. |
| `074eb62` | What makes an install usable | The runtime manager checked three markers plus the launcher; the bootstrap also required the conda environment. An install that wrote the launcher but failed to build the environment was "installed" to one and "not installed" to the other. |
| `6da7bac` | *(the test for the row above)* | The unification was untested. Removing the environment markers from the verify step left all 47 tests passing, because the harness's fake setup always wrote every marker at once. The new test builds the one folder shape that separates them: launcher present, environment absent. |
| `7619b1d` | The start timeout | The bootstrap polled on a literal `180_000` while the manager exported `DEFAULT_START_TIMEOUT_MS` for that same budget. Harmless today; the moment the manager's budget changed, the bootstrap would report a timeout for a runtime still legitimately starting. |

The test harness now derives its fake install layout from the shipped constants
instead of restating them, so it cannot keep faking a layout the product has since
changed and let these tests pass against a fiction.

### 8.5 What this does not change

None of the above touches the extraction fix, the traversal guard, the pin, or the
promise that nothing runs with elevated privileges. The QA list in section 7 stands
unchanged and still has to be run.

### 8.6 The interactive prompts are only reachable on failure

Section 7 lists the six `choice /C YN` prompts as an open risk. Reading
`atsetup.bat` narrows it: every one of the six sits inside an `if errorlevel 1 (`
block — the branch taken when a conda step has already failed.

| Prompt | Line | Guarded by |
| --- | --- | --- |
| retry the Pytorch installation | 425 | `if errorlevel 1 (` at 408 |
| retry the Faiss installation | 455 | `if errorlevel 1 (` at 437 |
| retry the FFmpeg installation | 486 | `if errorlevel 1 (` at 468 |
| retry the Gradio update | 519 | `if errorlevel 1 (` at 502 |
| retry the DeepSpeed download | 548 | `if errorlevel 1 (` at 531 |
| retry the DeepSpeed installation | 579 | `if errorlevel 1 (` at 559 |

So a clean `-silent` run never reaches a prompt. Each is also followed by
`if errorlevel 2 goto End`, and `if errorlevel 2` matches any errorlevel of 2 or
above.

What is **not** verified: what `choice` returns when stdin is ignored and there is
no console, which is how Lia spawns it. The reasoning is that a non-1 errorlevel
takes the `goto End` path and the script exits rather than waiting, but that is
inference from the script's control flow, not an observed result — there is no
Windows console here to run it against. If it does hang, the setup timeout kills the
child and the install fails with a message rather than leaving the window on
"Installing" forever.
