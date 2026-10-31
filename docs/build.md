# Build the Windows standalone executable

On Windows x64, with Node.js 18 or newer available to run the build script:

```powershell
node --test
node scripts/build-exe.mjs
```

No npm dependencies are installed. The script downloads official Node.js
26.12.1, checks the binary against a pinned SHA-256 and the release manifest,
and uses its [SEA virtual filesystem](https://nodejs.org/api/single-executable-applications.html)
to embed the original ESM application. Source and tool versions are pinned;
PE and archive metadata can vary, so builds are not claimed to be byte-identical.

Outputs in `dist/`:

- `portdoc-win-x64.exe`: standalone binary.
- `portdoc-win-x64.zip`: the same binary named `portdoc.exe`, plus project and runtime licenses.
- `SHA256SUMS.txt`: checksums for the EXE and ZIP.
- `build-info.json`: application version, source commit, runtime version, source-module count and runtime checksum.
- `LICENSE-NODE.txt`: Node.js and bundled dependencies' license notices.

The runtime cache is in `.build/`; both build directories are ignored by Git.
The resulting EXE is unsigned. It includes the complete runtime, so it is
larger than the JavaScript package. Downloading the ZIP reduces transfer size.
`sourceCommit` records the checkout's Git HEAD when Git is available, or `null`
when it cannot be read. It does not account for uncommitted changes; build
release assets from a clean tagged checkout. The build uses a temporary
`safe.directory` argument for this repository without changing Git configuration.

After building, the script copies the EXE to a new temporary directory and
runs smoke checks with Node/npm absent from PATH. This verifies version,
no-argument help, both languages, offline demo, invalid arguments and real
diagnostic JSON without source files alongside the binary.

`.github/workflows/ci.yml` runs Windows and Linux tests on Node 20/22/24,
plus a Windows EXE build. Linux CI checks command execution and deterministic
logic; real Windows/WSL/Docker diagnosis still needs environment-specific validation.
The release workflow is manually dispatched against an existing version tag;
its default uploads only an Actions artifact. Setting `upload` to true also
attaches assets to an existing GitHub Release, with write permission confined
to that upload job. For example, create tag `v0.7.1` and its GitHub Release,
then dispatch `release-exe.yml` with `tag=v0.7.1` and `upload=true`.
The workflow verifies package/CLI versions and source commit before uploading.
npm publishing remains a separate maintainer action.

After publication, download the EXE, ZIP, `SHA256SUMS.txt` and `build-info.json`
from that release. Verify both hashes, confirm that `sourceCommit` matches the
tag's resolved commit, and run `node scripts/smoke-exe.mjs <downloaded-exe>`
from the matching source checkout. The ZIP's `portdoc.exe` must match the
standalone EXE hash. For npm, inspect `npm pack`, install its tarball into an
isolated prefix, and check that the installed CLI reports the intended version;
an existing global command or standalone EXE can otherwise hide the package
being tested. Finally verify the registry's published version and tarball.

## Recreate the demo animation

With Python 3, Pillow and a monospace font available:

```powershell
python scripts/render-demo.py
```

The script renders actual `portdoc demo --lang en --no-color` output. Its
on-screen DEMO label makes clear that it is simulated evidence. It creates
`docs/demo.gif` and `docs/demo.png` with an eight-second playback sequence.
