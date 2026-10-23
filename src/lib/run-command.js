import { spawn } from "node:child_process";

export function runCommand(file, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 4_000;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let child;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command: file,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
        missing: false,
        ...result,
      });
    };

    try {
      child = spawn(file, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        ...options.spawnOptions,
      });
    } catch (error) {
      resolve({
        command: file,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
        timedOut: false,
        missing: error?.code === "ENOENT",
      });
      return;
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      finish({
        exitCode: null,
        stderr: stderr || (error instanceof Error ? error.message : String(error)),
        missing: error?.code === "ENOENT",
      });
    });
    child.on("close", (exitCode, signal) => finish({ exitCode, signal }));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    timer.unref?.();
  });
}
