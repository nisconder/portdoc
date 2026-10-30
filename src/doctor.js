import { findDockerDesktopCli } from "./collectors/docker.js";
import { runCommand } from "./lib/run-command.js";

// These checks read local state only. In particular, this command does not
// install WSL, launch distributions, start Docker, or change user settings.
export async function doctor(options = {}) {
  const platform = options.platform ?? process.platform;
  const supported = platform === "win32" || options.force === true;
  const platformCheck = {
    id: "platform",
    status: supported ? "ok" : "error",
    code: supported ? "OK" : "PLATFORM_UNSUPPORTED",
    detail: supported ? "Windows host inspection is supported." : "Run portdoc from Windows PowerShell or Command Prompt, outside WSL.",
  };
  if (!supported) {
    return finish([platformCheck, ...["windows", "wsl", "docker"].map((id) => ({
      id,
      status: "warning",
      code: "PLATFORM_UNSUPPORTED",
      detail: "This local Windows check was skipped on the current platform.",
    }))]);
  }

  const timeoutMs = boundedTimeout(options.timeoutMs);
  const runner = options.runner ?? options.runCommand ?? runCommand;
  const run = async (file, args, spawnOptions) => {
    try {
      return await runner(file, args, { timeoutMs, ...(spawnOptions ? { spawnOptions } : {}) });
    } catch {
      // Preserve the machine-readable outcome without echoing command output,
      // paths or exception text that may include private configuration.
      return { exitCode: null, stdout: "", stderr: "", failed: true };
    }
  };
  const [windows, wsl, docker] = await Promise.all([
    checkWindows(run),
    checkWsl(run),
    checkDocker(run, options),
  ]);
  return finish([platformCheck, windows, wsl, docker]);
}

async function checkWindows(run) {
  const result = await run("netstat.exe", ["-ano", "-p", "tcp"]);
  if (successful(result)) {
    return { id: "windows", status: "ok", code: "OK", detail: "Windows TCP listener inspection is available." };
  }
  return {
    id: "windows", status: "error", code: "WINDOWS_QUERY_FAILED",
    detail: result.missing ? "netstat.exe was not found." : result.timedOut ? "Windows TCP listener inspection timed out." : "Windows TCP listener inspection failed.",
    command: "netstat -ano -p tcp",
  };
}

async function checkWsl(run) {
  const result = await run("wsl.exe", ["--list", "--quiet"]);
  const raw = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(/\0/g, "").replace(/\uFEFF/g, "");
  if (result.missing || /WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED|WSL_E_WSL_NOT_INSTALLED|WSL_E_DEFAULT_DISTRO_NOT_FOUND|no installed distributions/i.test(raw)) {
    return { id: "wsl", status: "warning", code: "WSL_NOT_INSTALLED", detail: "WSL or its distributions are not installed. WSL checks are optional.", command: "wsl --status" };
  }
  if (!successful(result)) {
    const code = raw.match(/(?:Wsl\/[A-Za-z0-9_/-]+|E_ACCESSDENIED|WSL_E_[A-Z_]+)/)?.[0];
    return {
      id: "wsl", status: "warning", code: "WSL_QUERY_FAILED",
      detail: result.timedOut ? "WSL distribution inspection timed out." : code ? `WSL distribution inspection failed (${code}).` : "WSL distribution inspection failed.",
      command: "wsl --status",
    };
  }
  const distributions = (result.stdout ?? "").replace(/\0/g, "").replace(/\uFEFF/g, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!distributions.length) {
    return { id: "wsl", status: "warning", code: "WSL_NOT_INSTALLED", detail: "WSL is available, but no distributions are registered.", command: "wsl --status" };
  }
  return { id: "wsl", status: "ok", code: "OK", detail: `${distributions.length} WSL distribution${distributions.length === 1 ? " is" : "s are"} registered. Listener and probe utilities are checked when a port is inspected.` };
}

async function checkDocker(run, options) {
  // An explicit local named pipe prevents a remote DOCKER_HOST or context from
  // turning an environment check into a network request. This flag does not
  // modify the user's saved Docker configuration.
  const localPipes = ["npipe:////./pipe/docker_engine", "npipe:////./pipe/dockerDesktopLinuxEngine"];
  const args = (pipe) => ["--host", pipe, "info", "--format", "{{json .ServerVersion}}"];
  const environment = Object.fromEntries(Object.entries(options.environment ?? options.env ?? process.env)
    .filter(([key]) => !["DOCKER_HOST", "DOCKER_CONTEXT"].includes(key.toUpperCase())));
  const spawnOptions = { env: environment };
  let executable = options.dockerPath ?? "docker";
  let result = await run(executable, args(localPipes[0]), spawnOptions);
  if (result.missing && !options.dockerPath) {
    const fallback = findDockerDesktopCli({
      environment: options.environment ?? options.env,
      existsSync: options.existsSync ?? options.exists,
    });
    if (fallback) {
      executable = fallback;
      result = await run(executable, args(localPipes[0]), spawnOptions);
    }
  }
  if (result.missing) {
    return { id: "docker", status: "warning", code: "DOCKER_MISSING", detail: "Docker CLI was not found. Docker checks are optional.", command: "docker --version" };
  }
  let version = dockerVersion(result);
  if (!version) {
    result = await run(executable, args(localPipes[1]), spawnOptions);
    version = dockerVersion(result);
  }
  if (version) {
    return { id: "docker", status: "ok", code: "OK", detail: `The local Docker Engine is reachable (server ${version}).` };
  }
  return {
    id: "docker", status: "warning", code: "DOCKER_ENGINE_UNAVAILABLE",
    detail: result.timedOut ? "The local Docker Engine health check timed out." : "Docker CLI was found, but the local Docker Engine could not be inspected. Start Docker Desktop if container inspection is needed.",
    command: "docker --host npipe:////./pipe/docker_engine info",
  };
}

function dockerVersion(result) {
  if (!successful(result)) return null;
  let version;
  try { version = JSON.parse(result.stdout ?? ""); } catch {}
  return typeof version === "string" && /^[0-9][0-9A-Za-z._+-]{0,80}$/.test(version) ? version : null;
}

function successful(result) {
  return result.exitCode === 0 && !result.missing && !result.timedOut && !result.failed;
}

function boundedTimeout(value) {
  const requested = Number(value);
  return Number.isFinite(requested) ? Math.max(250, Math.min(30_000, Math.floor(requested))) : 4_000;
}

function finish(checks) {
  return {
    schemaVersion: 1,
    kind: "doctor",
    checkedAt: new Date().toISOString(),
    checks,
    ready: checks.filter((check) => check.id === "platform" || check.id === "windows").every((check) => check.status === "ok"),
  };
}
