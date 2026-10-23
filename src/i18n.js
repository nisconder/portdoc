const SUPPORTED = new Set(["en", "zh-CN"]);

const dictionaries = {
  en: {
    ownership: "OWNERSHIP",
    reachability: "REACHABILITY",
    findings: "FINDINGS",
    next: "NEXT",
    windows: "Windows",
    wsl: "WSL",
    docker: "Docker",
    noListener: "No listener",
    noMapping: "No published mapping",
    reachable: "Reachable",
    notReachable: "Not reachable",
    statusOk: "OK",
    statusUnavailable: "Unavailable",
    statusError: "Error",
    statusSkipped: "Skipped",
    processUnavailable: "process details unavailable",
    verdictFREE: "FREE",
    verdictOK: "OK",
    verdictCONFLICT: "CONFLICT",
    verdictUNKNOWN: "UNKNOWN",
    summaryFREE: "No Windows listener, WSL listener, or Docker mapping was found.",
    summaryCONFLICT: "Multiple independent layers claim this port.",
    summaryUNKNOWN: "No owner was found, but the evidence is incomplete or contradictory.",
    summaryWslForwarding: "A WSL listener exists, but Windows localhost forwarding is not working.",
    confidence: "Confidence {value} · read-only · no settings changed",
    confidenceLow: "low",
    confidenceMedium: "medium",
    confidenceHigh: "high",
    findingWINDOWS_WSL_COLLISION: "Windows and WSL both report a TCP listener on this port; Windows localhost traffic may shadow the WSL service.",
    findingDOCKER_WSL_COLLISION: "Docker publishes this host port while WSL also has a native listener on it.",
    findingWINDOWS_DOCKER_COLLISION: "Docker publishes this port, but Windows also reports a listener that does not look like Docker's forwarding process.",
    findingHIDDEN_OWNER: "The port is reachable, but none of the available collectors identified its owner.",
    findingINCOMPLETE_EVIDENCE: "One or more ownership sources could not be fully inspected.",
    findingWSL_NOT_REACHABLE_FROM_WINDOWS: "WSL is listening, but Windows could not connect through 127.0.0.1.",
    findingPARTIAL_INSPECTION: "An owner was found, but one or more sources could not be inspected.",
    nextDockerStart: "Start Docker Desktop, wait until its engine is running, then retry.",
    nextDockerInstall: "Install Docker Desktop or pass its CLI location with --docker-path <file>.",
    nextWslAccess: "Run wsl --status in a normal Windows terminal, resolve the WSL access error, then retry.",
    nextInstallSs: "Install iproute2 inside the selected WSL distribution so portdoc can use ss.",
    nextWslCheck: "Check wsl --status and verify that the selected WSL distribution can start.",
    nextWindowsCheck: "Retry from a normal Windows terminal that can run netstat.exe.",
    nextWindowsWsl: "Choose one owner: stop the Windows listener or move the WSL service to another port.",
    nextDockerWsl: "Change either the Docker host mapping or the native WSL service port.",
    nextWindowsDocker: "Stop or move the Windows listener before publishing this Docker host port.",
    nextWslForwarding: "Confirm the WSL service binds to 0.0.0.0, then review WSL localhost forwarding or mirrored networking.",
    reasonDockerEngine: "Docker Desktop is installed, but its engine is not running or cannot be accessed. Start Docker Desktop and retry.",
    reasonDockerMissing: "Docker CLI was not found in PATH or Docker Desktop's standard install locations.",
    reasonWslAccess: "WSL could not be accessed (E_ACCESSDENIED).",
    reasonProbeDisabled: "Disabled by --no-probe.",
    errorUnknownOption: "Unknown option: {value}",
    errorPortRequired: "Provide exactly one TCP port number.",
    errorInvalidPort: "Invalid TCP port: {value}",
    errorValueRequired: "{option} requires a value.",
    errorTimeout: "--timeout must be an integer from 250 to 30000 milliseconds.",
    errorLanguage: "--lang must be auto, en, or zh-CN.",
    errorHelp: "Run portdoc help for usage.",
    ownerWindows: "Windows owns this port with {count} listener(s).",
    ownerWsl: "WSL owns this port with {count} listener(s).",
    ownerDocker: "Docker publishes this port for {count} container(s)."
  },
  "zh-CN": {
    ownership: "端口归属",
    reachability: "可达性",
    findings: "问题分析",
    next: "下一步",
    windows: "Windows",
    wsl: "WSL",
    docker: "Docker",
    noListener: "未发现监听进程",
    noMapping: "未发现端口映射",
    reachable: "可以连接",
    notReachable: "无法连接",
    statusOk: "正常",
    statusUnavailable: "不可用",
    statusError: "检查失败",
    statusSkipped: "已跳过",
    processUnavailable: "无法读取进程信息",
    verdictFREE: "端口可用 · FREE",
    verdictOK: "状态正常 · OK",
    verdictCONFLICT: "端口冲突 · CONFLICT",
    verdictUNKNOWN: "无法判断 · UNKNOWN",
    summaryFREE: "Windows、WSL 和 Docker 中均未发现该端口的占用者。",
    summaryCONFLICT: "多个相互独立的网络层同时声明了这个端口。",
    summaryUNKNOWN: "没有找到明确的端口归属，且现有证据不完整或相互矛盾。",
    summaryWslForwarding: "WSL 中存在监听进程，但 Windows 的 localhost 转发没有正常工作。",
    confidence: "置信度 {value} · 只读检查 · 未修改任何设置",
    confidenceLow: "低",
    confidenceMedium: "中",
    confidenceHigh: "高",
    findingWINDOWS_WSL_COLLISION: "Windows 和 WSL 都在监听这个 TCP 端口；Windows 的 localhost 流量可能无法到达 WSL 服务。",
    findingDOCKER_WSL_COLLISION: "Docker 正在发布这个主机端口，同时 WSL 中还有一个原生监听进程。",
    findingWINDOWS_DOCKER_COLLISION: "Docker 正在发布这个端口，但 Windows 中还存在一个不像 Docker 转发进程的监听者。",
    findingHIDDEN_OWNER: "端口可以连接，但现有采集器都没有找到它的实际归属。",
    findingINCOMPLETE_EVIDENCE: "一个或多个端口归属来源未能完成检查。",
    findingWSL_NOT_REACHABLE_FROM_WINDOWS: "WSL 正在监听，但 Windows 无法通过 127.0.0.1 连接。",
    findingPARTIAL_INSPECTION: "已经找到端口归属，但仍有一个或多个来源无法检查。",
    nextDockerStart: "启动 Docker Desktop，等待引擎进入运行状态，然后重新检查。",
    nextDockerInstall: "安装 Docker Desktop，或使用 --docker-path <文件> 指定 Docker CLI。",
    nextWslAccess: "在普通 Windows 终端中运行 wsl --status，解决 WSL 访问错误后重试。",
    nextInstallSs: "在所选 WSL 发行版中安装 iproute2，以便 portdoc 使用 ss。",
    nextWslCheck: "运行 wsl --status，并确认所选 WSL 发行版能够正常启动。",
    nextWindowsCheck: "在能够运行 netstat.exe 的普通 Windows 终端中重试。",
    nextWindowsWsl: "选择唯一归属：停止 Windows 监听进程，或将 WSL 服务改到其他端口。",
    nextDockerWsl: "修改 Docker 的主机端口映射，或修改 WSL 原生服务端口。",
    nextWindowsDocker: "发布 Docker 主机端口前，先停止 Windows 监听进程或更换其端口。",
    nextWslForwarding: "确认 WSL 服务绑定到 0.0.0.0，然后检查 localhost 转发或 mirrored networking 设置。",
    reasonDockerEngine: "已找到 Docker Desktop，但引擎未运行或当前进程无法访问。请启动 Docker Desktop 后重试。",
    reasonDockerMissing: "PATH 和 Docker Desktop 标准安装目录中均未找到 Docker CLI。",
    reasonWslAccess: "无法访问 WSL（E_ACCESSDENIED）。",
    reasonProbeDisabled: "已通过 --no-probe 关闭连接探测。",
    errorUnknownOption: "未知选项：{value}",
    errorPortRequired: "请提供且仅提供一个 TCP 端口号。",
    errorInvalidPort: "无效的 TCP 端口：{value}",
    errorValueRequired: "{option} 需要一个参数值。",
    errorTimeout: "--timeout 必须是 250 到 30000 之间的整数毫秒值。",
    errorLanguage: "--lang 必须是 auto、en 或 zh-CN。",
    errorHelp: "运行 portdoc help 查看用法。",
    ownerWindows: "Windows 通过 {count} 个监听项占用该端口。",
    ownerWsl: "WSL 通过 {count} 个监听项占用该端口。",
    ownerDocker: "Docker 正在为 {count} 个容器发布该端口。"
  }
};

export function normalizeLanguage(value) {
  if (!value || value === "auto") return "auto";
  const normalized = String(value).replace("_", "-").toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-cn") || normalized.startsWith("zh-hans")) return "zh-CN";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return null;
}

export function resolveLanguage(explicit, options = {}) {
  const requested = normalizeLanguage(explicit);
  if (requested && requested !== "auto") return requested;

  const environment = options.environment ?? process.env;
  const environmentLanguage = normalizeLanguage(environment.PORTDOC_LANG);
  if (environmentLanguage && environmentLanguage !== "auto") return environmentLanguage;

  const systemLocale = options.systemLocale ?? Intl.DateTimeFormat().resolvedOptions().locale;
  return normalizeLanguage(systemLocale) === "zh-CN" ? "zh-CN" : "en";
}

export function createMessages(language) {
  const locale = SUPPORTED.has(language) ? language : "en";
  const dictionary = dictionaries[locale];
  return {
    language: locale,
    t(key, variables = {}) {
      const template = dictionary[key] ?? dictionaries.en[key] ?? key;
      return template.replace(/\{(\w+)\}/g, (_, name) => String(variables[name] ?? `{${name}}`));
    },
  };
}

export function supportedLanguages() {
  return [...SUPPORTED];
}
