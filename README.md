# portdoc

**localhost fails, but 127.0.0.1 works? See the difference across Windows and WSL.**

Compare IPv4, IPv6 and localhost TCP connections. See the listening process,
its project path, and Docker Compose service in the same report.

[简体中文](README.zh-CN.md) · [Download Windows EXE](https://github.com/nisconder/portdoc/releases/latest) · [npm](https://www.npmjs.com/package/portdoc)

![portdoc showing an IPv4-only listener, localhost resolving to IPv6, and its project directory](https://raw.githubusercontent.com/nisconder/portdoc/main/docs/demo.gif)

*An explicitly labeled, reproducible sample. Run `portdoc demo` to see the same
report without inspecting your machine.*

```powershell
portdoc 5173
```

Windows · WSL2 · Docker Desktop · TCP · read-only

## Install on Windows

### Standalone EXE — no Node.js needed

1. Download [portdoc-win-x64.zip](https://github.com/nisconder/portdoc/releases/latest/download/portdoc-win-x64.zip).
2. Extract the ZIP and open Windows PowerShell or CMD in that folder.
3. Run:

```powershell
.\portdoc.exe
.\portdoc.exe demo
.\portdoc.exe 5173
```

The EXE is unsigned and bundles the Node runtime. The release includes
`SHA256SUMS.txt`; `Get-FileHash .\portdoc.exe -Algorithm SHA256` matches the
`portdoc-win-x64.exe` checksum (the ZIP contains the same file under a short name).
Add its folder to PATH if you want to use `portdoc` from anywhere.

### npm — if Node.js is already installed on Windows

In **Windows PowerShell or CMD**, with Node.js 18 or newer:

```powershell
npm install --global portdoc@latest
portdoc --version
portdoc
portdoc 5173
```

`portdoc` alone displays the complete help screen. `npm i portdoc` is a
project-local install and does not put the command on your global PATH.
Run the Windows application from Windows; installing it inside WSL is not supported.

Try it once without a global install:

```powershell
npx --yes portdoc@latest 5173
```

If an npm mirror has not synchronized the release, use the official Registry
for this command only:

```powershell
npm install --global portdoc@latest --registry=https://registry.npmjs.org/
```

## What you learn

| Question | Evidence |
| --- | --- |
| Does localhost behave differently? | Windows and WSL each test `localhost`, `127.0.0.1`, and `::1` |
| Which address did localhost select? | First resolved address and address family; no fallback |
| Which project is listening? | Windows PID, executable and command line; WSL `/proc` command line and cwd |
| Which container publishes it? | Docker host/container ports, image, Compose project, service and path |
| What can I try next? | Findings, reachable literal address and a copyable verification command |

Windows project paths are inferred only from absolute script arguments and
labeled as inferred. Windows cwd is unavailable. WSL `/proc` details require
permission to read the listener's process and Python 3; basic `ss` evidence
still works without them. Docker Compose information depends on its labels.

WSL and Docker are optional, but an inaccessible source is incomplete evidence.
The report shows which checks succeeded and lowers confidence rather than
calling an uninspected port free. No elevation is requested by the application.

## Examples

```powershell
portdoc                         # Full help
portdoc demo                    # Offline simulated example
portdoc 8080 --distro Ubuntu     # Select a WSL distribution
portdoc 5173 --lang zh-CN        # Simplified Chinese
portdoc 5173 --lang en           # English
portdoc 5432 --no-probe          # Ownership only; no TCP connections
portdoc 5173 --json              # Language-neutral report, schemaVersion 2
portdoc 5173 --timeout 10000     # Allow slower collectors ten seconds
```

Any TCP port from `1` to `65535` is valid; `5173` is an example, not a default.
`--docker-path <file>` selects a Docker CLI explicitly. Docker Desktop's
standard Windows install locations are searched when Docker is absent from PATH.
Use `--no-color` or `NO_COLOR=1` for plain output. `PORTDOC_LANG=zh-CN` sets
the language preference; otherwise the interface follows the system locale.

## Understand the result

| Verdict | Exit | Meaning |
| --- | ---: | --- |
| `FREE` | 0 | All collectors completed, no owner and no reachable endpoint were found |
| `OK` | 0 | An owner was found and no actionable issue was observed |
| `CONFLICT` | 1 | Potential cross-layer overlap; review whether listeners belong to the same service |
| `UNKNOWN` | 2 | Incomplete evidence, or localhost fails while another address works |

An IPv4-only server can be intentional. The matrix shows the difference;
it does not prove a broken WSL relay. The `localhost` probe uses the first
resolved address without automatic fallback. Browsers and other applications
may select a different address or retry another family.

TCP success proves reachability, not which application accepted the connection.
Cross-layer listeners can be expected forwarding or independent namespaces.
portdoc does not claim to identify the final receiver, send HTTP payloads,
kill processes, change networking, or upload reports.

Common credential-like arguments are redacted before display and JSON output.
Command lines and local paths can still contain private information; review
reports before sharing them.

The JSON contract is [schema/report.schema.json](schema/report.schema.json)
(v2). Legacy `probes.windows` / `probes.wsl` remain aliases of the IPv4 results;
new clients should use `endpointMatrix`. The frozen
[v1 schema](schema/report-v1.schema.json) documents 0.5.x reports.

## Development

No npm runtime or development dependencies:

```powershell
node --test
node --check bin/portdoc.js
node scripts/build-exe.mjs
```

The EXE build downloads an official, pinned Node runtime and verifies its
SHA-256 before embedding the original modules using Node SEA. See
[build instructions](docs/build.md). Windows CI tests Node 20, 22 and 24.

In a checkout, `portdoc.cmd` forwards command-line arguments and shows help
when called alone. Double-click `portdoc-launcher.cmd` for a port prompt.

Not yet included: full-port scanning, HTTP service fingerprinting, network
mode detection, Windows reserved port ranges, automated fixes, UDP, Podman
and WSL Containers (`wslc`).

## License

[MIT](LICENSE). The standalone ZIP also includes the bundled Node runtime's license.

