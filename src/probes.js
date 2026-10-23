import net from "node:net";

import { runCommand } from "./lib/run-command.js";

export function probeWindows(port, options = {}) {
  if (process.platform !== "win32" && !options.force) {
    return Promise.resolve({ status: "unavailable", reachable: null, reason: "Not running on Windows." });
  }

  const timeoutMs = options.timeoutMs ?? 1_500;
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ latencyMs: Math.max(0, Math.round(performance.now() - startedAt)), ...result });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ status: "ok", reachable: true }));
    socket.once("timeout", () => finish({ status: "ok", reachable: false, reason: "Connection timed out." }));
    socket.once("error", (error) => finish({ status: "ok", reachable: false, reason: error.code ?? error.message }));
  });
}

export async function probeWsl(port, options = {}) {
  if (process.platform !== "win32" && !options.force) {
    return { status: "unavailable", reachable: null, reason: "Not running on Windows." };
  }

  const timeoutSeconds = Math.max(1, Math.ceil((options.timeoutMs ?? 1_500) / 1_000));
  const python = `import socket,sys;s=socket.socket();s.settimeout(${timeoutSeconds});s.connect(('127.0.0.1',${port}));s.close()`;
  const script = [
    `if command -v python3 >/dev/null 2>&1; then python3 -c "${python}"; exit $?; fi`,
    `if command -v nc >/dev/null 2>&1; then nc -z -w ${timeoutSeconds} 127.0.0.1 ${port}; exit $?; fi`,
    "exit 127",
  ].join("; ");
  const args = [];
  if (options.distro) args.push("--distribution", options.distro);
  args.push("--", "sh", "-lc", script);
  const startedAt = performance.now();
  const result = await (options.runCommand ?? runCommand)("wsl.exe", args, {
    timeoutMs: (options.timeoutMs ?? 1_500) + 1_000,
  });
  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));

  if (result.missing) return { status: "unavailable", reachable: null, reason: "wsl.exe was not found." };
  if (result.exitCode === 127) {
    return { status: "unavailable", reachable: null, reason: "WSL needs python3 or nc for reachability probes." };
  }
  if (result.timedOut) return { status: "ok", reachable: false, latencyMs, reason: "Connection timed out." };
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return {
      status: "error",
      reachable: null,
      latencyMs,
      reason: wslProbeError(result),
    };
  }
  return {
    status: "ok",
    reachable: result.exitCode === 0,
    latencyMs,
    ...(result.exitCode === 0 ? {} : { reason: "Connection refused or unreachable." }),
  };
}

function wslProbeError(result) {
  const value = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.replace(/\0/g, "");
  const code = value.match(/Wsl\/[A-Za-z0-9_/-]+/)?.[0] ?? value.match(/E_[A-Z_]+/)?.[0];
  return code ? `WSL probe failed (${code}).` : "WSL could not run the reachability probe.";
}
