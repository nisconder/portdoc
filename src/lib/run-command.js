import { spawn } from "node:child_process";
import { join } from "node:path";

// Cleanup must not turn a collector timeout into another unbounded wait.
const CLEANUP_TIMEOUT_MS = 250;

export function runCommand(file, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 4_000;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let child;
    let timer;
    let cleanupTimer;
    let treeKiller;
    let treeKillPending = false;
    let closedResult;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      resolve({
        command: file,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
        missing: false,
        ...result,
      });
    };

    const finishWhenClosed = () => {
      if (closedResult && !treeKillPending) finish(closedResult);
    };

    const killDirectly = (processToKill) => {
      if (!processToKill || processToKill.exitCode !== null || processToKill.signalCode !== null) return;
      try { processToKill.kill("SIGKILL"); } catch { /* Best effort; the deadline still applies. */ }
    };

    try {
      child = spawn(file, args, {
        ...options.spawnOptions,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        // A private POSIX group lets us stop descendants even after the root exits.
        detached: process.platform !== "win32",
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
      if (timedOut) return;
      finish({
        exitCode: null,
        stderr: stderr || (error instanceof Error ? error.message : String(error)),
        missing: error?.code === "ENOENT",
      });
    });
    child.on("close", (exitCode, signal) => {
      closedResult = { exitCode, signal };
      finishWhenClosed();
    });

    timer = setTimeout(() => {
      timedOut = true;
      cleanupTimer = setTimeout(() => {
        // Descendants may have escaped the tree or retained inherited pipes.
        // Close our pipes and stop waiting on child handles so the CLI can exit.
        killDirectly(treeKiller);
        treeKiller?.unref();
        killDirectly(child);
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish({ exitCode: child.exitCode, signal: child.signalCode });
      }, CLEANUP_TIMEOUT_MS);

      if (process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGKILL"); } catch { killDirectly(child); }
      } else if (child.pid && child.exitCode === null && child.signalCode === null) {
        // Keep the root alive until taskkill has located its descendants.
        treeKillPending = true;
        try {
          treeKiller = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
            ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          treeKiller.once("error", () => {
            treeKillPending = false;
            killDirectly(child);
            finishWhenClosed();
          });
          treeKiller.once("close", (code) => {
            treeKillPending = false;
            if (code !== 0) killDirectly(child);
            finishWhenClosed();
          });
        } catch {
          treeKillPending = false;
          killDirectly(child);
        }
      }
    }, timeoutMs);
    timer.unref?.();
  });
}
