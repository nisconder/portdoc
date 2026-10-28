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
- `build-info.json`: application version, runtime version, source-module count and runtime checksum.
- `LICENSE-NODE.txt`: Node.js and bundled dependencies' license notices.

The runtime cache is in `.build/`; both build directories are ignored by Git.
The resulting EXE is unsigned. It includes the complete runtime, so it is
larger than the JavaScript package. Downloading the ZIP reduces transfer size.

After building, the script copies the EXE to a new temporary directory and
runs smoke checks with Node/npm absent from PATH. This verifies version,
no-argument help, both languages, offline demo, invalid arguments and real
diagnostic JSON without source files alongside the binary.

`.github/workflows/ci.yml` runs Windows tests on Node 20/22/24 and an EXE build.
The release workflow is manually dispatched against an existing version tag;
its default uploads only an Actions artifact. Setting `upload` to true also
attaches assets to an existing GitHub Release, with write permission confined
to that upload job. npm publishing remains a separate maintainer action.

## Recreate the demo animation

With Python 3, Pillow and a monospace font available:

```powershell
python scripts/render-demo.py
```

The script renders actual `portdoc demo --lang en --no-color` output. Its
on-screen DEMO label makes clear that it is simulated evidence. It creates
`docs/demo.gif` and `docs/demo.png` with an eight-second playback sequence.
