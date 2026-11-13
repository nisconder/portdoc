# 2026-10-31 Windows / WSL 真实验证

本次使用 Windows x64 `10.0.26300`、Node `v24.22.1`、Ubuntu WSL2，内核 `6.18.33.2-microsoft-standard-WSL2`，WSL 网络模式为 NAT。未改防火墙、localhost forwarding、端口排除范围或 Docker 配置。Docker CLI 不在 PATH；工具另能找到 Docker Desktop 安装路径，但两个固定本地 Engine 管道不可用。本次没有启动 Docker。

验证入口是本地构建的 `portdoc-0.7.1.tgz`，使用 `npm install --prefix <隔离目录> <本地tgz> --ignore-scripts --no-audit --no-fund --no-package-lock` 安装，再运行该目录实际 CLI。它是发布候选包，**不是从 npm registry 安装的 0.7.1**。当时 registry 的 `latest` 仍为 0.7.0，本轮不执行 npm 公开发布。

## 复现与证据

```powershell
node scripts/validate-live.mjs --out .build/validation-new --entry .build/verification/npm-installed/node_modules/portdoc/bin/portdoc.js --distro Ubuntu
```

脚本不注入 DNS、采集器或探测结果。IPv4 用真实临时监听；Windows 使用独立 `dns.lookup`、原生 socket 和 `Get-NetTCPConnection`；WSL 使用独立 `ss`、Python socket 和 `/proc` 身份核对。每条命令的参数、退出码、时间及原始输出都保留在运行目录。监听有清理步骤；WSL 另有 90 秒有限寿命兜底，只信号终止带本次随机标记的自建 PID。

[原始 manifest](evidence/2026-10-31/npm-local/manifest.json) 记录运行时间、源码 HEAD、本地未提交状态、安装入口、入口 SHA-256 和命令执行器 SHA-256。运行发生在 0.7.1 发布提交之前，不能仅用该 HEAD 代表整个候选包；[安装内容核验](evidence/2026-10-31/npm-local/installed-content-verification.json)另外逐文件比对了 32 个包文件，全部与工作区发布候选源码一致。包含修复的命令执行器 SHA-256 为 `d4efd0d2a8441e994896ff02d9b99519afb4f5c6196b1b6451abccc97e3e3e09`。

## 实际观察

| 案例 | 独立结果与工具报告 | 结论及边界 |
| --- | --- | --- |
| IPv4 临时监听 | Windows IPv4 socket 成功，Get-NetTCPConnection 与工具给出相同监听 PID/地址；localhost 实际首选 `::1`，独立及工具 IPv6 均为 `EACCES` | IPv4 可达、归属吻合；IPv6 是环境受限的未知，不能当作连接被拒绝。工具保留 `reachable: null` 和 `PARTIAL_PROBES` |
| Ubuntu WSL 临时监听 | `ss`、`/proc` 和工具给出同一 Python PID；WSL 内独立连接及工具 IPv4 探测均成功；Windows 独立连接及工具 IPv4 探测均为 `ECONNREFUSED`，工具的 Windows 监听列表为空 | 已覆盖 WSL 有监听但 Windows IPv4 不可达的变体；工具给出 `UNKNOWN`、`WSL_NOT_REACHABLE_FROM_WINDOWS` 及退出码 2；Windows IPv6 仍为 `EACCES`，不能据此确定转发或防火墙根因 |
| 监听已关闭且 Docker CLI 指定为不存在路径 | Get-NetTCPConnection 无监听，独立 IPv4 为 ECONNREFUSED；Test-Path=false，实际 spawn=ENOENT；工具 Docker 来源为 unavailable | 工具给出 `UNKNOWN`、低置信度及退出码 2，未把不完整证据报为 FREE；不是 Docker Engine 正常时的映射验证 |

对应的未经改写工具报告：[IPv4](evidence/2026-10-31/npm-local/ipv4-cli.report.json)、[WSL](evidence/2026-10-31/npm-local/wsl-cli.report.json)、[缺失 Docker](evidence/2026-10-31/npm-local/missing-docker-cli.report.json)。独立 socket/DNS 结果：[Windows 监听](evidence/2026-10-31/npm-local/ipv4.independent-endpoints.json)、[WSL 服务的 Windows 访问](evidence/2026-10-31/npm-local/wsl-windows.independent-endpoints.json)。WSL 的 [ss](evidence/2026-10-31/npm-local/wsl-independent-ss.stdout.txt)、[独立连接](evidence/2026-10-31/npm-local/wsl-independent-python-connect.stdout.txt)、[清理确认](evidence/2026-10-31/npm-local/wsl-cleanup-owned-pid.stdout.txt)另存为原始输出。

原始 manifest 中，WSL 案例的 `windowsUnreachableVariant.covered` 为 `true`；该 IPv4 可达性差异已经观察到。Windows IPv6 探测受 `EACCES` 限制，因此该案例整体仍为 `environment-limited`，整次验证仍为 `incomplete`。

## 测试及未覆盖项

[本机完整测试原始输出](evidence/2026-10-31/npm-local/tests-windows.txt)：120 项，119 通过，1 项 POSIX 进程组专项在 Windows 跳过。网络测试先以独立原生 socket 确认环境，受限时严格核对错误，不再因生产探测自己返回 EACCES 就跳过。命令超时测试将调度检查与真实进程集成分开，保存构造进程 PID，并为忙碌 runner 的 Node 启动留出余量。

本次未证明：Windows IPv6 正常可用时的拒绝/成功行为；WSL 正常转发时 Windows relay 与 WSL 服务的归属判定；真实 Docker 发布重叠；已有 Windows 排除端口的完整案例；其他发行版、WSL 网络模式、权限和系统组合。不能据此宣称所有环境均正确。

## GitHub 分发产物核验

`v0.7.1` 标签指向 `247f3fe43b73eaaf1731517a43b094d8b89ab7c4`。[双系统 CI](https://github.com/nisconder/portdoc/actions/runs/41185076398)的 Windows／Ubuntu Node 20、22、24 六个测试任务及 CI EXE 构建均通过；[正式发布构建](https://github.com/nisconder/portdoc/actions/runs/41185101503)的 build 与 upload 也通过，发布 workflow 独立核对 tag／package／CLI 版本及构建源码提交。

从该 Release 的资产下载 EXE、ZIP、SHA256SUMS 和 build-info 后：[校验摘要](evidence/2026-10-31/release-verification.json)确认两个分发文件的 SHA-256 均匹配，ZIP 内 `portdoc.exe` 与独立 EXE 完全相同，build-info 的版本为 `0.7.1` 且 sourceCommit 等于标签提交。EXE 的 SHA-256 为 `63019c6cc7a2aef031d4c9a541454c581e1883f3e5846368bfea4d27627e6c03`；ZIP 为 `d752e9fe037a514e9d90db9a7391f3b692aa32d08c509a5606335f9bf5e45924`。

[下载版 EXE 冒烟输出](evidence/2026-10-31/release-smoke.txt)确认在隔离目录、PATH 不含 Node/npm 的情况下，版本、中英文帮助、诊断/demo v3、scan、doctor、错误和 JSON 均通过。随后以 `--entry <下载版EXE>` 重跑同一脚本；本机保存的 manifest 入口 SHA-256 与下载版 EXE 相同。三项实际对照没有失败检查：缺失 Docker 案例通过，IPv4 与 WSL 案例均因独立确认的 Windows IPv6 EACCES 保留为 `environment-limited`，整体仍是 `incomplete`，不是全部兼容性验证完成。

下载版 EXE 的完整命令原始字节、解码输出、时序及三份报告均保留在维护者本机的验证归档中，未额外上传到 Release 或仓库。按本次明确选择，Release 只公开 EXE、ZIP、SHA256SUMS、运行时许可证和 build-info 五项标准资产；本地候选 npm tarball 也未作为 GitHub 资产公开。

[npm 官方分发核对](evidence/2026-10-31/npm-local/registry-version-verification.json)还下载了当时的 registry latest `0.7.0` 并验证其 SHA-512 integrity；归档中的命令执行器确实没有本次 cleanup deadline／process-tree 修复。GitHub 0.7.1 发布不能替代 npm 发布；本轮没有修改 npm dist-tag，也没有声称 `npm install portdoc@latest` 会得到 0.7.1。
