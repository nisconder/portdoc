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
| Ubuntu WSL 临时监听 | `ss`、`/proc` 和工具给出同一 Python PID；WSL 内 IPv4 连接成功，Windows IPv4 也成功；工具观察到 Windows `wslrelay` | 真实正常转发对照吻合，没有把 relay 与 WSL 服务误报为独立冲突；Windows 不可达变体未复现，Windows IPv6 仍受限 |
| 监听已关闭且 Docker CLI 指定为不存在路径 | Get-NetTCPConnection 无监听，独立 IPv4 为 ECONNREFUSED；Test-Path=false，实际 spawn=ENOENT；工具 Docker 来源为 unavailable | 工具给出 `UNKNOWN`、低置信度及退出码 2，未把不完整证据报为 FREE；不是 Docker Engine 正常时的映射验证 |

对应的未经改写工具报告：[IPv4](evidence/2026-10-31/npm-local/ipv4-cli.report.json)、[WSL](evidence/2026-10-31/npm-local/wsl-cli.report.json)、[缺失 Docker](evidence/2026-10-31/npm-local/missing-docker-cli.report.json)。独立 socket/DNS 结果：[Windows 监听](evidence/2026-10-31/npm-local/ipv4.independent-endpoints.json)、[WSL 服务的 Windows 访问](evidence/2026-10-31/npm-local/wsl-windows.independent-endpoints.json)。WSL 的 [ss](evidence/2026-10-31/npm-local/wsl-independent-ss.stdout.txt)、[独立连接](evidence/2026-10-31/npm-local/wsl-independent-python-connect.stdout.txt)、[清理确认](evidence/2026-10-31/npm-local/wsl-cleanup-owned-pid.stdout.txt)另存为原始输出。

## 测试及未覆盖项

[本机完整测试原始输出](evidence/2026-10-31/npm-local/tests-windows.txt)：120 项，119 通过，1 项 POSIX 进程组专项在 Windows 跳过。网络测试先以独立原生 socket 确认环境，受限时严格核对错误，不再因生产探测自己返回 EACCES 就跳过。命令超时测试将调度检查与真实进程集成分开，保存构造进程 PID，并为忙碌 runner 的 Node 启动留出余量。

本次未证明：Windows IPv6 正常可用时的拒绝/成功行为；Windows 无法访问 WSL 的变体；真实 Docker 发布重叠；已有 Windows 排除端口的完整案例；其他发行版、WSL 网络模式、权限和系统组合。不能据此宣称所有环境均正确。

GitHub Release 产物的下载、校验和复测记录将在发布核验完成后补充；本地候选包通过不等于远端分发产物已核验。
