# Launch copy — draft, not posted

Use a concrete symptom and link directly to the repository. Check each
community's current self-promotion rules before publishing.

## English

**localhost fails, but 127.0.0.1 works? I built a Windows/WSL TCP inspector.**

I kept switching between netstat, WSL ss and docker ps to understand one port.
portdoc puts the evidence together and compares localhost, IPv4 and IPv6 from
both Windows and WSL, including the address localhost selected.

It also shows process command lines, WSL working directories and Docker Compose
project/service labels. It is read-only, and an address-family difference is
reported as evidence rather than an assumed WSL bug.

There is a standalone Windows EXE, plus npm for people with Windows Node.js.
`portdoc demo` displays a clearly labeled simulated example without scanning.

https://github.com/nisconder/portdoc

I would especially value reports where the matrix disagrees with the behavior
of your app. Browsers can retry another address family; this tool deliberately
shows the first localhost address without fallback.

## 简体中文

**localhost 连不上、127.0.0.1 却正常？我做了个 Windows/WSL TCP 检查工具。**

portdoc 把 Windows、WSL 和 Docker 的端口信息放到同一份报告，分别从两侧
对比 localhost、IPv4 和 IPv6，并显示进程命令、项目目录及 Compose 服务。
它只读运行，明确区分已知证据和推断，不把地址族差异直接认定为 WSL 故障。

现在有无需 Node.js 的 Windows 独立 EXE，也保留 npm 安装。
可以先运行 `portdoc demo --lang zh-CN` 看离线样例。

https://github.com/nisconder/portdoc

欢迎反馈真实使用中某个端点失败、但另外一个可以连接的情况。

## Measure the first release campaign

Record the date, channel, published URL and the repository traffic window.
Review actual human feedback alongside GitHub views and referral sources.
npm downloads, clone counts and stars do not individually identify human users.
The first useful target is 100 qualified repository visitors and several real
diagnostic reports, rather than a promised star conversion rate.
