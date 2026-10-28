import net from "node:net";
import { lookup } from "node:dns/promises";

import { runCommand } from "./lib/run-command.js";

const ENDPOINTS = { localhost: "localhost", ipv4: "127.0.0.1", ipv6: "::1" };
const MATRIX_MARKER = "__PORTDOC_ENDPOINTS__";

export async function probeWindows(port, options = {}) {
  if (process.platform !== "win32" && !options.force) {
    return { status: "unavailable", reachable: null, reason: "Not running on Windows." };
  }

  const timeoutMs = options.timeoutMs ?? 1_500;
  const startedAt = performance.now();
  const host = options.host ?? "127.0.0.1";
  let address = host;
  let family = net.isIP(host);
  if (!family) {
    try {
      // Probe only the first OS-resolved address. Automatic family fallback
      // would hide the localhost/IPv6 failure this matrix is meant to expose.
      const addresses = await resolveWithTimeout(host, options.lookup ?? lookup, timeoutMs);
      if (!addresses.length) throw Object.assign(new Error("No address was returned."), { code: "ENOTFOUND" });
      ({ address, family } = addresses[0]);
    } catch (error) {
      return { status: "error", reachable: null, reason: error.code ?? error.message };
    }
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: address, port, family, autoSelectFamily: false });
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ address, family, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)), ...result });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ status: "ok", reachable: true }));
    socket.once("timeout", () => finish({ status: "ok", reachable: false, reason: "ETIMEDOUT" }));
    socket.once("error", (error) => {
      const unsupported = ["EAFNOSUPPORT", "EPROTONOSUPPORT", "EADDRNOTAVAIL"].includes(error.code);
      const refused = ["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET"].includes(error.code);
      finish({ status: unsupported ? "unavailable" : refused ? "ok" : "error", reachable: refused ? false : null, reason: error.code ?? error.message });
    });
  });
}

export async function probeWindowsMatrix(port, options = {}) {
  const entries = await Promise.all(Object.entries(ENDPOINTS).map(async ([key, host]) => [key, await probeWindows(port, { ...options, host })]));
  return Object.fromEntries(entries);
}

export async function probeWsl(port, options = {}) {
  const matrix = await probeWslMatrix(port, options);
  const key = options.host === "localhost" ? "localhost" : options.host === "::1" ? "ipv6" : "ipv4";
  return matrix[key];
}

export async function probeWslMatrix(port, options = {}) {
  if (process.platform !== "win32" && !options.force) return unavailableMatrix("Not running on Windows.");
  const timeoutMs = options.timeoutMs ?? 1_500;
  const timeoutSeconds = timeoutMs / 1_000;
  const python = [
    "import socket,json,time,errno,concurrent.futures",
    `port=${Number(port)}`,
    `timeout=${timeoutSeconds}`,
    "def probe(host):",
    "    start=time.monotonic()",
    "    try:",
    "        family,kind,proto,canon,address=socket.getaddrinfo(host,port,socket.AF_UNSPEC,socket.SOCK_STREAM)[0]",
    "    except OSError as error:",
    "        return dict(status='error',reachable=None,reason=str(error))",
    "    result=dict(address=address[0],family=6 if family==socket.AF_INET6 else 4)",
    "    try:",
    "        with socket.socket(family,kind,proto) as connection:",
    "            connection.settimeout(timeout)",
    "            connection.connect(address)",
    "        result.update(status='ok',reachable=True)",
    "    except OSError as error:",
    "        unsupported=error.errno in (errno.EAFNOSUPPORT,errno.EPROTONOSUPPORT,errno.EADDRNOTAVAIL)",
    "        reason='ETIMEDOUT' if isinstance(error,TimeoutError) else errno.errorcode.get(error.errno,str(error))",
    "        refused=reason in ('ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','ECONNRESET')",
    "        result.update(status='unavailable' if unsupported else 'ok' if refused else 'error',reachable=False if refused else None,reason=reason)",
    "    result['latencyMs']=max(0,round((time.monotonic()-start)*1000))",
    "    return result",
    "hosts={'localhost':'localhost','ipv4':'127.0.0.1','ipv6':'::1'}",
    "with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:",
    "    results=dict(zip(hosts,executor.map(probe,hosts.values())))",
    `print('${MATRIX_MARKER}'+json.dumps(results,separators=(',',':')))`,
  ].join("\n");
  const script = [
    `if command -v python3 >/dev/null 2>&1; then python3 -c ${shellQuote(python)}; exit $?; fi`,
    // nc can test literal addresses, but cannot reliably expose the first
    // localhost resolution or promise no fallback across implementations.
    "if command -v nc >/dev/null 2>&1; then",
    `  e4=$(nc -4 -z -w ${Math.max(1, Math.ceil(timeoutSeconds))} 127.0.0.1 ${Number(port)} 2>&1); v4=$?`,
    `  e6=$(nc -6 -z -w ${Math.max(1, Math.ceil(timeoutSeconds))} ::1 ${Number(port)} 2>&1); v6=$?`,
    "  if [ \"$v4\" -eq 0 ]; then r4=true; elif [ \"$v4\" -eq 1 ]; then r4=false; else r4=null; fi",
    "  if [ \"$v6\" -eq 0 ]; then r6=true; elif [ \"$v6\" -eq 1 ]; then r6=false; else r6=null; fi",
    "  case \"$e4\" in *'invalid option'*|*'illegal option'*|*'unrecognized option'*|*'usage:'*|*'not supported'*|*'Permission denied'*|*'Operation not permitted'*) r4=null;; esac",
    "  case \"$e6\" in *'invalid option'*|*'illegal option'*|*'unrecognized option'*|*'usage:'*|*'not supported'*|*'Permission denied'*|*'Operation not permitted'*) r6=null;; esac",
    `  printf '${MATRIX_MARKER}{"localhost":{"status":"unavailable","reachable":null,"reason":"WSL needs python3 to resolve localhost without address fallback."},"ipv4":{"status":"ok","reachable":%s,"address":"127.0.0.1","family":4},"ipv6":{"status":"ok","reachable":%s,"address":"::1","family":6}}\\n' "$r4" "$r6"`,
    "  exit 0",
    "fi",
    "exit 127",
  ].join("\n");
  const args = [];
  if (options.distro) args.push("--distribution", options.distro);
  args.push("--", "sh", "-lc", script);
  const result = await (options.runCommand ?? runCommand)("wsl.exe", args, { timeoutMs: Math.ceil(timeoutSeconds) * 2_000 + 1_500 });

  if (result.missing) return unavailableMatrix("wsl.exe was not found.");
  if (result.exitCode === 127) return unavailableMatrix("WSL needs python3 or nc for reachability probes.");
  // A killed WSL invocation is missing infrastructure evidence, not proof that
  // any particular endpoint timed out or refused a connection.
  if (result.timedOut) return unavailableMatrix("WSL endpoint probe timed out before returning results.", "error");
  if (result.exitCode !== 0) return unavailableMatrix(wslProbeError(result), "error");
  try {
    const payload = result.stdout.split(/\r?\n/).find((line) => line.startsWith(MATRIX_MARKER));
    const matrix = JSON.parse(payload?.slice(MATRIX_MARKER.length) ?? "");
    for (const key of Object.keys(ENDPOINTS)) {
      const probe = matrix[key];
      if (!probe || !["ok", "unavailable", "error"].includes(probe.status) || ![true, false, null].includes(probe.reachable)) throw new Error("Invalid endpoint result.");
      if (probe.status === "ok" && probe.reachable === null) {
        probe.status = "error";
        probe.reason = "WSL netcat could not probe this address family.";
      }
      if (probe.reachable === false && !probe.reason) probe.reason = "Connection refused or unreachable.";
    }
    return matrix;
  } catch {
    return unavailableMatrix("WSL returned unreadable endpoint probe data.", "error");
  }
}

function unavailableMatrix(reason, status = "unavailable") {
  return Object.fromEntries(Object.keys(ENDPOINTS).map((key) => [key, { status, reachable: null, reason }]));
}

async function resolveWithTimeout(host, resolver, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      resolver(host, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("Name resolution timed out."), { code: "ETIMEDOUT" })), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function wslProbeError(result) {
  const value = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.replace(/\0/g, "");
  const code = value.match(/Wsl\/[A-Za-z0-9_/-]+/)?.[0] ?? value.match(/E_[A-Z_]+/)?.[0];
  return code ? `WSL probe failed (${code}).` : "WSL could not run the reachability probe.";
}
