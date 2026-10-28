const SUPPORTED = new Set(["en", "zh-CN"]);

const dictionaries = {
  en: {
    ownership: "OWNERSHIP",
    reachability: "REACHABILITY",
    endpointMatrix: "ENDPOINT MATRIX",
    endpoint: "Endpoint",
    matrixNote: "localhost: first resolved address, without IPv4/IPv6 fallback.",
    resolvedTo: "localhost resolved to",
    sample: "DEMO · simulated fixture, no system checks",
    projectPath: "Project",
    inferredProject: "Project (inferred from command line)",
    workingDirectory: "Directory",
    commandLine: "Command",
    executable: "Executable",
    composeService: "Compose",
    refused: "REFUSED",
    timedOut: "TIMEOUT",
    nextIpv4: "Try the reachable address shown above; check whether the server should bind IPv4, IPv6, or both.",
    nextLocalhost: "Compare localhost with the working literal address. Browser address selection may differ from this first-address probe.",
    nextCommand: "Read-only verification",
    reasonProbeRefused: "Connection refused.",
    reasonProbeTimeout: "Connection timed out.",
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
    verdictEndpointMismatch: "ADDRESS DIFFERENCE · UNKNOWN",
    summaryFREE: "No Windows listener, WSL listener, or Docker mapping was found.",
    summaryFreeSkipped: "No listener or mapping found. TCP probes were skipped; a successful new bind is not proven.",
    summaryCONFLICT: "Multiple layers report listeners or mappings. Review the possible overlap.",
    summaryUNKNOWN: "Some evidence is missing or reachability differs. Review the results below.",
    summaryWslForwarding: "A WSL listener exists, but the corresponding Windows loopback probes did not connect.",
    summaryEndpointMismatch: "Address-family or localhost resolution results differ. Try the reachable address.",
    confidence: "Confidence {value} · read-only · no settings changed",
    confidenceLow: "low",
    confidenceMedium: "medium",
    confidenceHigh: "high",
    findingWINDOWS_WSL_COLLISION: "Windows and WSL both report listeners. Separate network namespaces or forwarding can be intentional; the accepting process is not proven.",
    findingDOCKER_WSL_COLLISION: "Docker publishes this port and WSL reports a listener. Check whether they belong to the same service before treating this as a conflict.",
    findingWINDOWS_DOCKER_COLLISION: "Docker publishes this port alongside a Windows listener not recognized as Docker forwarding. Check for overlap.",
    findingENDPOINT_FAMILY_MISMATCH: "IPv4 and IPv6 TCP reachability differ. This may be an intentional single-family bind; it does not prove a WSL relay fault.",
    findingLOCALHOST_RESOLUTION_MISMATCH: "The first localhost address fails while a literal address succeeds. Check resolution order and which address family the service binds.",
    findingHIDDEN_OWNER: "The port is reachable, but none of the available collectors identified its owner.",
    findingINCOMPLETE_EVIDENCE: "One or more ownership sources could not be fully inspected.",
    findingWSL_NOT_REACHABLE_FROM_WINDOWS: "WSL is listening, but the corresponding Windows loopback probes did not connect. Review service bindings and forwarding.",
    findingINCOMPLETE_PROBES: "One or more endpoint probes could not run. An unchecked endpoint does not prove that the port is free.",
    findingPARTIAL_PROBES: "An owner was found, but some endpoint probes could not run. Check the matrix for gaps.",
    findingPARTIAL_INSPECTION: "An owner was found, but one or more sources could not be inspected.",
    nextDockerStart: "Start Docker Desktop, wait until its engine is running, then retry.",
    nextDockerInstall: "Install Docker Desktop or pass its CLI location with --docker-path <file>.",
    nextWslAccess: "Run wsl --status in a normal Windows terminal, resolve the WSL access error, then retry.",
    nextInstallSs: "Install iproute2 inside the selected WSL distribution so portdoc can use ss.",
    nextWslCheck: "Check wsl --status and verify that the selected WSL distribution can start.",
    nextWindowsCheck: "Retry from a normal Windows terminal that can run netstat.exe.",
    nextWindowsWsl: "Compare the Windows and WSL projects. If the overlap is unintended, choose one owner or move one service to another port.",
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
    endpointMatrix: "端点探测矩阵",
    endpoint: "端点",
    matrixNote: "localhost 只测试解析后的首选地址，不自动回退到另一地址族。",
    resolvedTo: "localhost 解析地址",
    sample: "演示 · 模拟样例，未检查当前系统",
    projectPath: "项目",
    inferredProject: "项目（由命令行推断）",
    workingDirectory: "目录",
    commandLine: "命令",
    executable: "程序",
    composeService: "Compose",
    refused: "拒绝",
    timedOut: "超时",
    nextIpv4: "先尝试上方可以连接的地址，再确认服务应绑定 IPv4、IPv6 还是两者。",
    nextLocalhost: "对比 localhost 与可达的直接地址。浏览器的地址选择可能与本次首选地址探测不同。",
    nextCommand: "只读验证命令",
    reasonProbeRefused: "连接被拒绝。",
    reasonProbeTimeout: "连接超时。",
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
    verdictCONFLICT: "可能冲突 · CONFLICT",
    verdictUNKNOWN: "需要检查 · UNKNOWN",
    verdictEndpointMismatch: "地址可达性有差异 · UNKNOWN",
    summaryFREE: "Windows、WSL 和 Docker 中均未发现该端口的占用者。",
    summaryFreeSkipped: "未发现监听或映射；TCP 探测已跳过，不能证明新服务可以绑定成功。",
    summaryCONFLICT: "多个网络层报告监听或映射，请核对是否存在非预期重叠。",
    summaryUNKNOWN: "部分证据缺失或可达性有差异，请查看下方已完成的检查。",
    summaryWslForwarding: "WSL 中存在监听进程，但 Windows 对应地址族的回环探测无法连接。",
    summaryEndpointMismatch: "地址族或 localhost 解析结果存在差异，可先尝试可达地址。",
    confidence: "置信度 {value} · 只读检查 · 未修改任何设置",
    confidenceLow: "低",
    confidenceMedium: "中",
    confidenceHigh: "高",
    findingWINDOWS_WSL_COLLISION: "Windows 和 WSL 均报告监听。独立网络空间或转发可能是预期配置，尚不能确定最终接受连接的进程。",
    findingDOCKER_WSL_COLLISION: "Docker 正在发布此端口，WSL 也报告监听。请先核对它们是否属于同一服务。",
    findingWINDOWS_DOCKER_COLLISION: "Docker 发布此端口的同时，Windows 存在未识别为 Docker 转发的监听进程，请核对是否重叠。",
    findingENDPOINT_FAMILY_MISMATCH: "IPv4 与 IPv6 的 TCP 可达性不同。可能只是服务仅绑定其中一个地址族，不能据此确定 WSL 转发故障。",
    findingLOCALHOST_RESOLUTION_MISMATCH: "localhost 首选地址连接失败，但某个直接地址可以连接，请检查解析顺序和服务绑定的地址族。",
    findingHIDDEN_OWNER: "端口可以连接，但现有采集器都没有找到它的实际归属。",
    findingINCOMPLETE_EVIDENCE: "一个或多个端口归属来源未能完成检查。",
    findingWSL_NOT_REACHABLE_FROM_WINDOWS: "WSL 正在监听，但 Windows 对应地址族的回环探测无法连接，请检查服务绑定与转发配置。",
    findingINCOMPLETE_PROBES: "一个或多个端点探测未能执行，未检查的端点不能作为端口空闲的证据。",
    findingPARTIAL_PROBES: "已发现端口归属，但部分端点未能探测，请查看矩阵中的缺失项。",
    findingPARTIAL_INSPECTION: "已经找到端口归属，但仍有一个或多个来源无法检查。",
    nextDockerStart: "启动 Docker Desktop，等待引擎进入运行状态，然后重新检查。",
    nextDockerInstall: "安装 Docker Desktop，或使用 --docker-path <文件> 指定 Docker CLI。",
    nextWslAccess: "在普通 Windows 终端中运行 wsl --status，解决 WSL 访问错误后重试。",
    nextInstallSs: "在所选 WSL 发行版中安装 iproute2，以便 portdoc 使用 ss。",
    nextWslCheck: "运行 wsl --status，并确认所选 WSL 发行版能够正常启动。",
    nextWindowsCheck: "在能够运行 netstat.exe 的普通 Windows 终端中重试。",
    nextWindowsWsl: "核对 Windows 与 WSL 的项目。若重叠并非预期，选择唯一归属或将其中一个服务改到其他端口。",
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
