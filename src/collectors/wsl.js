import { runCommand } from "../lib/run-command.js";
import { cleanIdentityText, processIdentity } from "../lib/identity.js";

const DISTRO_MARKER = "__WPD_DISTRO__";

export function parseSsListeners(raw) {
  if (!raw) return [];

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5) return null;

      const [state, , , local, , ...processColumns] = columns;
      const endpoint = parseEndpoint(local);
      if (!endpoint) return null;
      const processText = processColumns.join(" ");
      const processMatch = processText.match(/users:\(\(\"([^\"]+)\",pid=(\d+)/);

      return {
        address: endpoint.address,
        port: endpoint.port,
        state,
        pid: processMatch ? Number(processMatch[2]) : null,
        process: processMatch ? processMatch[1] : null,
      };
    })
    .filter(Boolean);
}

export function parseWslOutput(raw) {
  const lines = raw.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => line.startsWith(DISTRO_MARKER));
  const distro = markerIndex >= 0 ? lines[markerIndex].slice(DISTRO_MARKER.length) || "unknown" : "unknown";
  const listenerLines = lines.filter((_, index) => index !== markerIndex).join("\n").trim();
  return { distro, listeners: parseSsListeners(listenerLines) };
}

export async function collectWsl(port, options = {}) {
  if (process.platform !== "win32" && !options.force) {
    return {
      status: "unavailable",
      distro: options.distro ?? null,
      listeners: [],
      reason: "WSL collection is only available on Windows.",
    };
  }

  const script = [
    `printf '${DISTRO_MARKER}%s\\n' "\${WSL_DISTRO_NAME:-unknown}"`,
    "if ! command -v ss >/dev/null 2>&1; then echo 'iproute2/ss is not installed' >&2; exit 127; fi",
    `ss -H -ltnp 'sport = :${port}' 2>/dev/null || ss -H -ltn 'sport = :${port}'`,
  ].join("; ");
  const args = [];
  if (options.distro) args.push("--distribution", options.distro);
  args.push("--", "sh", "-c", script);

  const result = await (options.runCommand ?? runCommand)("wsl.exe", args, {
    timeoutMs: options.timeoutMs,
  });

  if (result.missing) {
    return { status: "unavailable", distro: options.distro ?? null, listeners: [], reason: "wsl.exe was not found." };
  }
  if (result.timedOut) {
    return { status: "error", distro: options.distro ?? null, listeners: [], reason: "WSL port query timed out." };
  }
  if (result.exitCode === 127) {
    return {
      status: "unavailable",
      distro: options.distro ?? null,
      listeners: [],
      reason: "The selected WSL distribution does not provide the ss command.",
    };
  }
  if (result.exitCode !== 0) {
    return {
      status: "error",
      distro: options.distro ?? null,
      listeners: [],
      reason: conciseWslError(result, "The selected WSL distribution could not be queried."),
    };
  }

  const parsed = parseWslOutput(result.stdout);
  await enrichWslIdentity(parsed.listeners, options);
  return { status: "ok", ...parsed };
}

async function enrichWslIdentity(listeners, options) {
  const processIds = [...new Set(listeners.map((item) => item.pid).filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
  if (!processIds.length) return;
  // The second call reads only PIDs already reported by ss. Do not use root,
  // source environment files, or evaluate anything read from /proc.
  const python = [
    "import json,os,shlex,sys",
    "items=[]",
    "for value in sys.argv[1:]:",
    " p=int(value); row={'pid':p,'commandLine':None,'cwd':None,'path':None}",
    " try:",
    "  with open('/proc/%d/cmdline'%p,'rb') as stream: args=[v.decode('utf-8','replace') for v in stream.read(65536).split(b'\\0') if v]",
    "  row['commandLine']=shlex.join(args)",
    " except OSError: pass",
    " for field in ('cwd','exe'):",
    "  try: row['path' if field=='exe' else field]=os.readlink('/proc/%d/%s'%(p,field))",
    "  except OSError: pass",
    " items.append(row)",
    "print(json.dumps(items,ensure_ascii=False))",
  ].join("\n");
  const script = `if command -v python3 >/dev/null 2>&1; then python3 -c ${shellQuote(python)} ${processIds.join(" ")}; else exit 127; fi`;
  const args = [];
  if (options.distro) args.push("--distribution", options.distro);
  args.push("--", "sh", "-c", script);
  try {
    const result = await (options.runCommand ?? runCommand)("wsl.exe", args, { timeoutMs: options.timeoutMs });
    if (result.exitCode !== 0) return;
    const metadata = JSON.parse(result.stdout);
    if (!Array.isArray(metadata)) return;
    const byPid = new Map(metadata.map((item) => [Number(item.pid), item]));
    for (const listener of listeners) {
      const item = byPid.get(listener.pid);
      if (!item) continue;
      Object.assign(listener, processIdentity(item.commandLine, item.cwd, "linux"));
      listener.path = cleanIdentityText(item.path);
      if (listener.commandLine || listener.cwd || listener.path) listener.identitySource = "proc";
    }
  } catch {
    // Missing Python, permission restrictions and short-lived processes do
    // not invalidate the listener evidence already captured by ss.
  }
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function parseEndpoint(value) {
  const match = value.match(/^(.*):(\d+)$/);
  if (!match) return null;
  return {
    address: match[1].replace(/^\[(.*)\]$/, "$1"),
    port: Number(match[2]),
  };
}

function conciseWslError(result, fallback) {
  const value = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.replace(/\0/g, "");
  const code = value.match(/Wsl\/[A-Za-z0-9_/-]+/)?.[0] ?? value.match(/E_[A-Z_]+/)?.[0];
  if (code) return `WSL query failed (${code}).`;
  const firstLine = value
    .replace(/�/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || fallback;
}
