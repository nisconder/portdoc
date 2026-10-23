import { runCommand } from "../lib/run-command.js";

export function parseWindowsListeners(raw) {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  const items = Array.isArray(parsed) ? parsed : [parsed];

  return items.map((item) => ({
    address: String(item.Address ?? ""),
    port: Number(item.Port),
    pid: Number(item.Pid),
    process: item.ProcessName ? String(item.ProcessName) : null,
    path: item.ProcessPath ? String(item.ProcessPath) : null,
  }));
}

export function parseNetstatListeners(raw, requestedPort) {
  if (!raw) return [];

  return raw
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i))
    .filter(Boolean)
    .map((match) => ({
      address: match[1].replace(/^\[(.*)\]$/, "$1"),
      port: Number(match[2]),
      pid: Number(match[3]),
      process: null,
      path: null,
    }))
    .filter((listener) => listener.port === requestedPort);
}

export async function collectWindows(port, options = {}) {
  if (process.platform !== "win32" && !options.force) {
    return {
      status: "unavailable",
      listeners: [],
      reason: "Windows collection is only available on Windows.",
    };
  }

  const runner = options.runCommand ?? runCommand;
  const result = await runner("netstat.exe", ["-ano", "-p", "tcp"], {
    timeoutMs: options.timeoutMs,
  });

  if (result.missing) {
    return { status: "unavailable", listeners: [], reason: "netstat.exe was not found." };
  }
  if (result.timedOut) {
    return { status: "error", listeners: [], reason: "Windows port query timed out." };
  }
  if (result.exitCode !== 0) {
    return {
      status: "error",
      listeners: [],
      reason: conciseError(result.stderr, "Windows port query failed."),
    };
  }

  const listeners = parseNetstatListeners(result.stdout, port);
  if (!listeners.length) return { status: "ok", listeners };

  const processIds = [...new Set(listeners.map((listener) => listener.pid))];
  const script = [
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
    `$processIds = @(${processIds.join(",")})`,
    "$items = @($processIds | ForEach-Object {",
    "  try {",
    "    $process = Get-Process -Id $_ -ErrorAction Stop",
    "    $processPath = $null",
    "    try { $processPath = $process.Path } catch {}",
    "    [PSCustomObject]@{ Pid = $_; ProcessName = $process.ProcessName; ProcessPath = $processPath }",
    "  }",
    "  catch { [PSCustomObject]@{ Pid = $_; ProcessName = $null; ProcessPath = $null } }",
    "})",
    "ConvertTo-Json -InputObject @($items) -Compress",
  ].join("\n");
  const processResult = await runner(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeoutMs: options.timeoutMs },
  );

  if (processResult.exitCode === 0) {
    try {
      const processes = parseWindowsListeners(processResult.stdout);
      const processById = new Map(processes.map((process) => [process.pid, process]));
      for (const listener of listeners) {
        const process = processById.get(listener.pid);
        if (process) {
          listener.process = process.process;
          listener.path = process.path;
        }
      }
    } catch {
      // PID and endpoint evidence from netstat remains useful without process metadata.
    }
  }

  return { status: "ok", listeners };
}

function conciseError(value, fallback) {
  return value ? value.split(/\r?\n/, 1)[0] : fallback;
}
