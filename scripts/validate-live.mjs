// Run from Windows: node scripts/validate-live.mjs --out <new-directory> [--entry <CLI-file>] [--distro <name>]
// This harness deliberately uses no production collectors, probes or command runner.
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdir, readdir, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import net from "node:net";
import { release } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flags = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!["--out", "--entry", "--distro"].includes(key) || !process.argv[i + 1] || flags[key]) {
    throw new Error("Usage: node scripts/validate-live.mjs --out <new-directory> [--entry <CLI-file>] [--distro <name>]");
  }
  flags[key] = process.argv[i + 1];
}
if (!flags["--out"]) throw new Error("--out is required; existing evidence will not be overwritten.");
const out = resolve(flags["--out"]);
const entry = resolve(flags["--entry"] ?? join(root, "bin", "portdoc.js"));
const distro = flags["--distro"];
if (![".js", ".mjs", ".cjs", ".exe"].includes(extname(entry).toLowerCase())) throw new Error("--entry must be a JS module or Windows EXE.");
await stat(entry);
try { await mkdir(out, { recursive: true }); } catch (error) { throw new Error(`Cannot create evidence directory: ${error.message}`); }
if ((await readdir(out)).length) throw new Error("--out must be an empty directory.");
const manifest = {
  schemaVersion: 1, kind: "portdoc-live-validation", startedAt: new Date().toISOString(),
  environment: { platform: process.platform, osRelease: release(), node: process.version, arch: process.arch },
  entry, distro: distro ?? null, cases: [],
  limitations: ["A single host run does not establish other Windows/WSL/Docker combinations.", "TCP connects do not identify the application receiving traffic.", "No Docker service is started and no real Docker mapping/exclusion-range scenario is created.", "Checks run sequentially; unrelated processes and DNS results may change between observations."],
};
const save = (name, value) => writeFile(join(out, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
const decode = (buffer) => {
  const utf16 = (buffer[0] === 0xff && buffer[1] === 0xfe) || [...buffer.subarray(1, Math.min(200, buffer.length)).filter((_, i) => i % 2 === 0)].filter(x => x === 0).length > Math.min(10, buffer.length / 8);
  return { encoding: utf16 ? "utf16le" : "utf8", text: buffer.toString(utf16 ? "utf16le" : "utf8").replace(/^\uFEFF/, "") };
};

function launch(file, args) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const child = spawn(file, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [], stderr = [];
  let error, exitCode = null, signal = null, closed = false;
  child.stdout.on("data", chunk => stdout.push(chunk));
  child.stderr.on("data", chunk => stderr.push(chunk));
  const completion = new Promise(resolveDone => {
    child.once("error", value => { error = { code: value.code, message: value.message }; });
    child.once("close", (code, sig) => { exitCode = code; signal = sig; closed = true; resolveDone(); });
  });
  return { child, completion, get closed() { return closed; }, result: () => {
    const rawOut = Buffer.concat(stdout), rawErr = Buffer.concat(stderr);
    const output = decode(rawOut), errors = decode(rawErr);
    return { file, args, pid: child.pid ?? null, startedAt, elapsedMs: Math.round(performance.now() - started), exitCode, signal, error: error ?? null, stdout: output.text, stderr: errors.text, stdoutEncoding: output.encoding, stderrEncoding: errors.encoding, rawOut, rawErr };
  } };
}

async function receipt(label, session, extra = {}) {
  const { rawOut, rawErr, ...result } = session.result();
  await Promise.all([
    writeFile(join(out, `${label}.stdout.bin`), rawOut, { flag: "wx" }),
    writeFile(join(out, `${label}.stderr.bin`), rawErr, { flag: "wx" }),
    writeFile(join(out, `${label}.stdout.txt`), result.stdout, { flag: "wx" }),
    writeFile(join(out, `${label}.stderr.txt`), result.stderr, { flag: "wx" }),
    save(`${label}.process.json`, { ...result, ...extra }),
  ]);
  return { ...result, ...extra, evidence: `${label}.process.json` };
}

async function stopLocal(session) {
  if (session.closed) return;
  const child = session.child;
  // Only this freshly spawned process is targeted; never an inventoried PID.
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32") {
      const killer = launch(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"]);
      await bounded(killer.completion, 750);
      if (!killer.closed) { killer.child.kill("SIGKILL"); killer.child.stdout.destroy(); killer.child.stderr.destroy(); killer.child.unref(); }
    }
    try { child.kill("SIGKILL"); } catch { /* The finite listener lifetime remains a fallback. */ }
  }
  child.stdout.destroy(); child.stderr.destroy(); child.unref();
}

async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise.then(() => true), new Promise(resolveDone => { timer = setTimeout(() => resolveDone(false), ms); })]); }
  finally { clearTimeout(timer); }
}

async function command(label, file, args, timeoutMs = 20_000) {
  const session = launch(file, args);
  const completed = await bounded(session.completion, timeoutMs);
  if (!completed) { await stopLocal(session); await bounded(session.completion, 300); }
  return receipt(label, session, { timedOut: !completed });
}

function parseJson(result) { try { return JSON.parse(result.stdout); } catch { return null; } }
function check(id, good, expected, actual, restricted = false) {
  return { id, status: good ? "pass" : restricted ? "environment-limited" : "fail", expected, actual };
}
function finishCase(item) {
  const limited = item.checks.some(x => x.status === "environment-limited") || item.scope?.environmentLimitations?.length > 0;
  item.status = item.checks.some(x => x.status === "fail") ? "fail" : limited ? "environment-limited" : item.status ?? "pass";
  return item;
}
async function persistCase(item) { finishCase(item); manifest.cases.push(item); await save(`${item.id}.case.json`, item); }
const okay = value => value.exitCode === 0 && !value.timedOut && !value.error;

async function powershell(label, source) {
  const script = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n$ErrorActionPreference='Stop'\n${source}`;
  return command(label, "powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]);
}

async function windowsListeners(label, port) {
  const result = await powershell(label, `$rows = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq ${port} })\nConvertTo-Json -InputObject @($rows | Select-Object LocalAddress,LocalPort,OwningProcess) -Compress`);
  return { process: result, rows: parseJson(result) };
}

async function connect(address, family, port) {
  const started = performance.now();
  return new Promise(resolveDone => {
    const socket = net.createConnection({ host: address, family, port, autoSelectFamily: false });
    let done = false;
    const finish = (status, reachable, reason) => {
      if (done) return; done = true; socket.destroy();
      resolveDone({ address, family, port, status, reachable, reason: reason ?? null, elapsedMs: Math.round(performance.now() - started) });
    };
    socket.setTimeout(1_500);
    socket.once("connect", () => finish("connected", true));
    socket.once("timeout", () => finish("timeout", false, "ETIMEDOUT"));
    socket.once("error", error => {
      const refusal = ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"].includes(error.code);
      finish(refusal ? "unreachable" : "error", refusal ? false : null, error.code ?? error.message);
    });
  });
}

async function endpoints(label, port) {
  let addresses = [], dnsError = null;
  const started = performance.now();
  let dnsTimer;
  try {
    addresses = await Promise.race([
      lookup("localhost", { all: true, verbatim: true }),
      new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(Object.assign(new Error("Independent DNS lookup exceeded 2 seconds."), { code: "ETIMEDOUT" })), 2_000); }),
    ]);
  } catch (error) { dnsError = { code: error.code, message: error.message }; }
  finally { clearTimeout(dnsTimer); }
  const dns = { addresses, error: dnsError, elapsedMs: Math.round(performance.now() - started) };
  const unique = new Map([...addresses, { address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 }].map(x => [`${x.family}:${x.address}`, x]));
  const sockets = [];
  for (const value of unique.values()) sockets.push(await connect(value.address, value.family, port));
  const result = { port, dns, sockets };
  await save(`${label}.independent-endpoints.json`, result);
  return result;
}

function endpointLimitations(independent) {
  const limits = [];
  if (independent.dns.error) limits.push({ kind: "dns", ...independent.dns.error });
  for (const observed of independent.sockets.filter(value => value.reachable === null)) {
    limits.push({ kind: "socket", address: observed.address, family: observed.family, reason: observed.reason, status: observed.status });
  }
  return limits;
}

function compareMatrix(report, independent, side = "windows") {
  const checks = [];
  const matrix = report?.endpointMatrix?.[side];
  checks.push(check(`${side}-matrix-present`, Boolean(matrix), "endpoint matrix", matrix ?? null));
  if (!matrix) return checks;
  const first = independent.dns.addresses[0];
  if (first) checks.push(check(`${side}-localhost-first-address`, matrix.localhost?.address === first.address && matrix.localhost?.family === first.family, first, matrix.localhost));
  for (const key of ["localhost", "ipv4", "ipv6"]) {
    const address = key === "localhost" ? first?.address : key === "ipv4" ? "127.0.0.1" : "::1";
    const observed = independent.sockets.find(value => value.address === address);
    if (!observed) { checks.push(check(`${side}-${key}-independent-evidence`, false, "DNS and socket evidence", independent.dns, true)); continue; }
    const actual = matrix[key];
    checks.push(check(`${side}-${key}-reachability`, actual?.reachable === observed.reachable, observed, actual ?? null));
    if (observed.reachable === null) checks.push(check(`${side}-${key}-restriction-explicit`, actual?.reachable === null && ["error", "unavailable"].includes(actual?.status), "restriction remains unknown, never a refusal", actual));
    else checks.push(check(`${side}-${key}-probe-status`, actual?.status === "ok", "A completed connection/refusal probe has status ok", actual ?? null));
    if (key !== "localhost") checks.push(check(`${side}-${key}-literal-address`, actual?.address === observed.address && actual?.family === observed.family, { address: observed.address, family: observed.family }, actual ?? null));
  }
  return checks;
}

let cliAllowed = false;
async function cli(label, port, extra = []) {
  if (!cliAllowed) return null;
  const args = [String(port), "--json", "--timeout", "4000", ...(distro ? ["--distro", distro] : []), ...extra];
  const result = await command(label, extname(entry).toLowerCase() === ".exe" ? entry : process.execPath, extname(entry).toLowerCase() === ".exe" ? args : [entry, ...args]);
  const report = parseJson(result);
  if (report) await save(`${label}.report.json`, report);
  return { process: result, report };
}
function cliChecks(result) {
  if (!result) return [];
  const report = result.report;
  const verdict = report?.assessment?.verdict;
  const knownVerdict = ["FREE", "OK", "CONFLICT", "UNKNOWN"].includes(verdict);
  const expectedExit = verdict === "CONFLICT" ? 1 : verdict === "UNKNOWN" ? 2 : knownVerdict ? 0 : null;
  return [check("cli-json-contract", report?.schemaVersion === 3 && report?.kind === "diagnosis" && knownVerdict, "diagnosis schemaVersion 3 JSON with a recognized verdict", report && { schemaVersion: report.schemaVersion, kind: report.kind, verdict }), check("cli-exit-matches-verdict", knownVerdict && !result.process.timedOut && !result.process.error && result.process.exitCode === expectedExit, expectedExit, { exitCode: result.process.exitCode, timedOut: result.process.timedOut, error: result.process.error })];
}

async function windowsCases() {
  const server = net.createServer(socket => socket.end());
  let expiry, port;
  try {
    await new Promise((resolveDone, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveDone); });
    expiry = setTimeout(() => server.close(), 120_000); expiry.unref();
    port = server.address().port;
    const independent = await endpoints("ipv4", port);
    const listeners = await windowsListeners("ipv4-get-net-tcp", port);
    const result = await cli("ipv4-cli", port);
    const owned = listeners.rows?.some(row => row.OwningProcess === process.pid && row.LocalAddress === "127.0.0.1");
    const item = { id: "ipv4-listener", pid: process.pid, port, independent, listenerEvidence: listeners, cli: result, checks: [check("independent-listener-pid", okay(listeners.process) && owned, { pid: process.pid, address: "127.0.0.1", port }, listeners.rows, !okay(listeners.process)), check("independent-ipv4-connect", independent.sockets.find(x => x.address === "127.0.0.1")?.reachable === true, true, independent.sockets.find(x => x.address === "127.0.0.1"), independent.sockets.find(x => x.address === "127.0.0.1")?.reachable === null), ...cliChecks(result)] };
    item.scope = { purpose: "Compare a real Windows IPv4 listener with independent listener and endpoint observations.", environmentLimitations: endpointLimitations(independent) };
    if (result?.report) {
      item.checks.push(check("cli-listener-pid", result.report.sources?.windows?.listeners?.some(row => row.pid === process.pid && row.address === "127.0.0.1" && row.port === port), { pid: process.pid, address: "127.0.0.1", port }, result.report.sources?.windows));
      item.checks.push(...compareMatrix(result.report, independent));
    }
    if (!result) { item.status = "not-covered"; item.reason = "CLI would implicitly start a default WSL distribution; rerun with explicit --distro."; }
    const v6 = independent.sockets.find(x => x.address === "::1");
    item.localhostIpv6MismatchCoverage = { status: independent.dns.addresses[0]?.address === "::1" && v6?.reachable === false ? "covered" : "not-covered", reason: "Requires actual IPv6-first localhost resolution and a usable IPv6 refusal/unreachable result; EACCES is not refusal." };
    if (item.localhostIpv6MismatchCoverage.status !== "covered") manifest.limitations.push("IPv4 listening was observed, but the specific IPv6-first localhost refusal scenario was not reproduced; see ipv4-listener.case.json.");
    await persistCase(item);
  } finally {
    clearTimeout(expiry);
    if (server.listening) await new Promise(resolveDone => server.close(resolveDone));
  }
  if (!port) return;
  const listeners = await windowsListeners("closed-get-net-tcp", port);
  const socket = await connect("127.0.0.1", 4, port);
  await save("closed-independent-connect.json", socket);
  const missingPath = join(out, `does-not-exist-docker-${randomUUID()}.exe`);
  const availability = await powershell("missing-docker-test-path", `ConvertTo-Json -InputObject ([PSCustomObject]@{ pathExists = Test-Path -LiteralPath '${missingPath.replace(/'/g, "''")}'; dockerCommands = @(Get-Command docker -ErrorAction SilentlyContinue | Select-Object Name,Source,CommandType) }) -Depth 5 -Compress`);
  const missing = await command("missing-docker-spawn", missingPath, ["--version"]);
  const closed = okay(listeners.process) && Array.isArray(listeners.rows) && listeners.rows.length === 0 && socket.reachable === false;
  const result = closed ? await cli("missing-docker-cli", port, ["--docker-path", missingPath]) : null;
  const item = { id: "missing-docker-closed-port", port, independent: { listeners, socket, availability, missing }, cli: result, checks: [check("closed-port-independently-confirmed", closed, "No listening row and a failed literal IPv4 connection", { rows: listeners.rows, socket }, !okay(listeners.process) || socket.reachable === null), check("explicit-path-does-not-exist", okay(availability) && parseJson(availability)?.pathExists === false && missing.error?.code === "ENOENT", "Test-Path false and actual spawn ENOENT", { availability: parseJson(availability), spawnError: missing.error }), ...cliChecks(result)] };
  if (result?.report) item.checks.push(check("missing-docker-unavailable", result.report.sources?.docker?.status === "unavailable" && result.report.sources.docker.mappings?.length === 0, "unavailable with no mapping evidence", result.report.sources?.docker), check("incomplete-evidence-never-free", result.report.assessment?.verdict !== "FREE", "verdict other than FREE", result.report.assessment));
  if (!result) { item.status = "not-covered"; item.reason = closed ? "Explicit --distro required to avoid starting default WSL implicitly." : "The closed port could not be independently confirmed; no CLI claim was evaluated."; }
  await persistCase(item);
}

async function wslCase(installed) {
  const item = { id: "wsl-listener-windows-observation", scope: { purpose: "Compare a real WSL listener and Windows/WSL access with independent observations.", environmentLimitations: [] }, checks: [] };
  if (!distro || !installed.includes(distro)) {
    item.status = "not-covered"; item.reason = !distro ? "No --distro supplied; no WSL distribution was started." : "Requested distribution was not confirmed by successful --list --quiet preflight.";
    await persistCase(item); return;
  }
  const args = ["--distribution", distro, "--exec"];
  const tools = await command("wsl-tools", "wsl.exe", [...args, "sh", "-c", "command -v python3 && command -v ss"]);
  item.toolPreflight = tools;
  if (!okay(tools)) { item.status = "not-covered"; item.reason = "Selected distribution could not provide python3 and ss; see raw tool preflight."; await persistCase(item); return; }
  item.environmentSnapshot = await command("wsl-environment", "wsl.exe", [...args, "sh", "-c", "uname -sr; if command -v wslinfo >/dev/null 2>&1; then wslinfo --networking-mode 2>/dev/null || true; else echo '__WSLINFO_UNAVAILABLE__'; fi"]);
  const token = `portdoc-live-${randomUUID()}`;
  const python = `import socket,time,os,json,sys\ns=socket.socket(socket.AF_INET,socket.SOCK_STREAM)\ns.bind(('127.0.0.1',0));s.listen();s.settimeout(0.5)\nprint('PORTDOC_VALIDATION_READY='+json.dumps(dict(pid=os.getpid(),port=s.getsockname()[1],token=sys.argv[1])),flush=True)\nend=time.monotonic()+90\nwhile time.monotonic()<end:\n try:\n  c,a=s.accept();c.close()\n except socket.timeout: pass\ns.close()`;
  const session = launch("wsl.exe", [...args, "python3", "-u", "-c", python, token]);
  let fixture;
  try {
    const deadline = performance.now() + 15_000;
    while (!session.closed && performance.now() < deadline) {
      const line = session.result().stdout.split(/\r?\n/).find(x => x.startsWith("PORTDOC_VALIDATION_READY="));
      if (line) { fixture = JSON.parse(line.slice("PORTDOC_VALIDATION_READY=".length)); break; }
      await new Promise(resolveDone => setTimeout(resolveDone, 50));
    }
    if (!fixture || fixture.token !== token || !Number.isSafeInteger(fixture.pid) || fixture.pid <= 0 || !Number.isInteger(fixture.port) || fixture.port < 1 || fixture.port > 65535) throw new Error("WSL fixture failed to report a valid owned PID and port before its readiness deadline.");
    item.fixture = fixture;
    item.ss = await command("wsl-independent-ss", "wsl.exe", [...args, "ss", "-H", "-ltnp", `sport = :${fixture.port}`]);
    const probe = `import socket,json,errno,sys\npid=${fixture.pid}\nraw=open('/proc/%d/cmdline'%pid,'rb').read().split(b'\\0')\nr=dict(pid=pid,tokenMatches=${JSON.stringify(token)}.encode() in raw)\ntry:\n s=socket.create_connection(('127.0.0.1',${fixture.port}),1.5);s.close();r.update(reachable=True)\nexcept OSError as e: r.update(reachable=None if e.errno in (errno.EACCES,errno.EPERM) else False,reason=errno.errorcode.get(e.errno,str(e)))\nprint(json.dumps(r))`;
    item.wslConnect = await command("wsl-independent-python-connect", "wsl.exe", [...args, "python3", "-c", probe]);
    const local = parseJson(item.wslConnect);
    item.windowsEndpoints = await endpoints("wsl-windows", fixture.port);
    item.scope.environmentLimitations = endpointLimitations(item.windowsEndpoints);
    item.cli = await cli("wsl-cli", fixture.port);
    item.checks.push(check("independent-wsl-listener", okay(item.ss) && item.ss.stdout.includes(`127.0.0.1:${fixture.port}`) && item.ss.stdout.includes(`pid=${fixture.pid},`), { pid: fixture.pid, port: fixture.port, address: "127.0.0.1" }, item.ss.stdout), check("independent-wsl-connect-and-identity", okay(item.wslConnect) && local?.reachable === true && local?.tokenMatches === true, { reachable: true, tokenMatches: true }, local), ...cliChecks(item.cli));
    if (item.cli?.report) {
      const report = item.cli.report;
      item.checks.push(check("cli-wsl-listener-pid", report.sources?.wsl?.status === "ok" && report.sources.wsl.listeners?.some(row => row.pid === fixture.pid && row.port === fixture.port && row.address === "127.0.0.1"), fixture, report.sources?.wsl), check("cli-wsl-ipv4-connect", report.endpointMatrix?.wsl?.ipv4?.reachable === local?.reachable, local, report.endpointMatrix?.wsl?.ipv4));
      item.checks.push(...compareMatrix(report, item.windowsEndpoints));
      const windows = item.windowsEndpoints.sockets.find(x => x.address === "127.0.0.1");
      const reachableWindows = item.windowsEndpoints.sockets.filter(value => value.reachable === true);
      if (reachableWindows.length) {
        item.windowsUnreachableVariant = { covered: false, reason: "Windows reached this port through at least one independently tested address. Normal forwarding can pass comparison; the Windows-unreachable variant was not reproduced.", reachableAddresses: reachableWindows.map(({ address, family }) => ({ address, family })) };
      }
      else if (windows?.reachable !== false) {
        item.windowsUnreachableVariant = { covered: false, reason: "Windows socket policy/error leaves reachability unknown; this is not a refused connection." };
      }
      else {
        const independentOwner = report.sources?.windows?.listeners?.length || report.sources?.docker?.mappings?.length;
        if (!independentOwner) {
          item.windowsUnreachableVariant = { covered: true, reason: "The WSL listener accepted connections locally, while independent Windows IPv4 connection failed without a policy error or another reported owner." };
          item.checks.push(check("cli-wsl-unreachable-finding", report.assessment?.findings?.some(x => x.code === "WSL_NOT_REACHABLE_FROM_WINDOWS") && report.assessment?.verdict === "UNKNOWN", "WSL_NOT_REACHABLE_FROM_WINDOWS and UNKNOWN", report.assessment));
        }
        else { item.windowsUnreachableVariant = { covered: false, reason: "Another Windows listener or Docker mapping prevents isolating a WSL-only unreachable variant." }; }
      }
    }
  } catch (error) { item.checks.push(check("wsl-case-execution", false, "Ready finite-lifetime WSL fixture and completed observations", { message: error.message })); }
  finally {
    if (fixture?.token === token && Number.isSafeInteger(fixture.pid) && fixture.pid > 0) {
      const cleanup = `import os,signal,json,time\np=${fixture.pid}\ntoken=${JSON.stringify(token)}.encode()\ndef owned():\n try: return token in open('/proc/%d/cmdline'%p,'rb').read().split(b'\\0')\n except FileNotFoundError: return False\nwas_owned=owned()\nif was_owned:\n try: os.kill(p,signal.SIGTERM)\n except ProcessLookupError: pass\nfor attempt in range(20):\n if not owned(): break\n time.sleep(0.05)\nprint(json.dumps(dict(pid=p,tokenMatches=was_owned,terminationRequested=was_owned,ownedProcessStillAlive=owned(),alreadyExited=not was_owned)))`;
      item.cleanup = await command("wsl-cleanup-owned-pid", "wsl.exe", [...args, "python3", "-c", cleanup]);
      const cleaned = parseJson(item.cleanup);
      item.checks.push(check("owned-listener-cleanup-confirmed", okay(item.cleanup) && cleaned?.ownedProcessStillAlive === false, "Only token-verified own PID is signaled, then independently confirmed absent", cleaned));
      if (!okay(item.cleanup) || cleaned?.ownedProcessStillAlive !== false) manifest.limitations.push("Remote WSL listener cleanup was not confirmed; its 90-second lifetime is the remaining fallback.");
    }
    if (!(await bounded(session.completion, 2_000))) {
      manifest.limitations.push("WSL launcher required local termination; remote cleanup evidence, not launcher exit, determines whether the Linux PID was removed.");
      await stopLocal(session);
    }
    await bounded(session.completion, 300);
    item.listenerProcess = await receipt("wsl-listener", session, { finiteLifetimeSeconds: 90 });
    if (!session.closed) manifest.limitations.push("WSL launcher did not confirm exit; remote listener has a 90-second lifetime fallback.");
  }
  await persistCase(item);
}

try {
  if (process.platform !== "win32") throw new Error("Live validation must run on Windows; this harness does not establish Windows evidence on other platforms.");
  const gitScope = ["-c", `safe.directory=${root.replaceAll("\\", "/")}`];
  manifest.git = await command("git-revision", "git", [...gitScope, "rev-parse", "HEAD"]);
  manifest.gitStatus = await command("git-status", "git", [...gitScope, "status", "--porcelain"]);
  manifest.provenance = { entrySha256: await sha256(entry), commandRunnerPath: join(root, "src", "lib", "run-command.js"), commandRunnerSha256: await sha256(join(root, "src", "lib", "run-command.js")), uncommittedChanges: okay(manifest.gitStatus) ? Boolean(manifest.gitStatus.stdout.trim()) : null };
  manifest.version = await command("entry-version", extname(entry).toLowerCase() === ".exe" ? entry : process.execPath, extname(entry).toLowerCase() === ".exe" ? ["--version"] : [entry, "--version"]);
  manifest.wslPreflight = {
    status: await command("wsl-status", "wsl.exe", ["--status"], 8_000),
    verbose: await command("wsl-list-verbose", "wsl.exe", ["--list", "--verbose"], 8_000),
    quiet: await command("wsl-list-quiet", "wsl.exe", ["--list", "--quiet"], 8_000),
  };
  const quiet = manifest.wslPreflight.quiet;
  const installed = okay(quiet) ? quiet.stdout.replace(/\0/g, "").split(/\r?\n/).map(x => x.trim()).filter(Boolean) : [];
  manifest.wslPreflight.confirmedDistributions = installed;
  cliAllowed = Boolean(distro && installed.includes(distro)) || Boolean(!distro && (quiet.error?.code === "ENOENT" || (okay(quiet) && installed.length === 0)));
  if (!cliAllowed) manifest.limitations.push("Full CLI cases were withheld because their implicit default-WSL startup was not authorized by --distro or WSL preflight could not establish a safe target.");
  await windowsCases();
  await wslCase(installed);
} catch (error) {
  manifest.fatalError = { message: error.message, code: error.code ?? null };
} finally {
  manifest.finishedAt = new Date().toISOString();
  manifest.status = manifest.fatalError || manifest.cases.some(x => x.status === "fail") ? "fail" : manifest.cases.some(x => ["environment-limited", "not-covered"].includes(x.status)) ? "incomplete" : "pass";
  await save("manifest.json", manifest);
  console.log(JSON.stringify({ status: manifest.status, manifest: join(out, "manifest.json"), cases: manifest.cases.map(x => ({ id: x.id, status: x.status, reason: x.reason })) }, null, 2));
  process.exitCode = manifest.status === "fail" ? 1 : manifest.status === "incomplete" ? 2 : 0;
}
