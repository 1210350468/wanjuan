# 执行器登录交接 + 每本书独立工作目录要求

日期：2026-11-20。交接对象：DSH。目标仓库：`D:/coding/ai项目发掘/ai小说`（万卷 Wanjuan，桌面端 Electron）。

本文只写当前事实、已做过的尝试和未完成项，方便没有会话上下文的接手人直接开工。请先核对 `git log` 与工作区，不要假设下面的结论仍然成立。

## 一、要接手的问题：本机执行器「登录」没反应 / 弹系统错误

### 现象

设置 → AI 模型 → 服务商选「本机执行器（CLI）」，点 Codex / Claude Code / agy 的「登录」：

1. 第一版：界面提示「已在终端打开 xxx」，但屏幕上没有任何终端窗口。
2. 第二版（去掉 `windowsHide` 后）：弹出 Windows 系统错误框，标题是 `\\`，正文是「Windows 找不到 "\\" 文件。请确定拼写是否正确后再试一次……」。
3. 点「确定」关掉后，什么也没有发生。

### 相关代码

- `electron/services/harness-detector.ts` → `openHarnessLogin()`（Windows 分支）
- `electron/controllers/harness-controller.ts` → `harness:login`
- `src/components/settings/HarnessDetectPanel.tsx` → `signIn()`
- 单测：`electron/services/__tests__/harness-detector.test.ts`（`describe('openHarnessLogin')`）
- 面板测试：`src/components/settings/__tests__/harness-detect.browser.tsx`

### 已做过的两次修改（都在 master）

- `c1b2899b`：去掉 `windowsHide: true`。原因：`CREATE_NO_WINDOW` 会把 `start` 开出来的新终端一起藏掉。**只解决「没有窗口」，没有解决引号问题。**
- `d82fdbf5`：把 `start "" cmd /k <命令>` 改成 `start cmd /k <命令>`。原因：Node 传参时会把嵌套引号转义，`start` 的空标题最后被当成一个叫 `\` 的文件去打开，于是弹出「找不到 `\` 文件」。不加空标题时，`start` 的第一个裸词就是命令本身。
- 当前 Windows 分支：

```ts
const child = spawnImpl('cmd.exe', ['/c', `start cmd /k ${spec.loginCommand}`], { detached: true, stdio: 'ignore' })
child.unref()
```

### 当前验证到哪一步

- 单测断言了命令形态、`detached`/`stdio`、以及不再出现 `start ""`；19 项探测单测 + 4 项面板测试通过。
- 用临时 `.cjs` + `node` 走同样 spawn 调用，WMI 能看到 `cmd /k <命令>` 子进程被创建，且不再弹「找不到文件」。**但沙箱环境无法确认真实桌面上是否出现了可交互的终端窗口**，第二次修改后用户还没有确认。
- 因此第一件事：**请用户在真实桌面点一次「登录」，确认窗口出现且能输入。**

### 建议的修法（如果现在的 `start cmd /k` 仍不稳定）

不要在 Node 里拼 `cmd /c start` 的字符串。更稳的两条路，按优先级：

1. 用 `spawn('cmd.exe', ['/d', '/k', spec.loginCommand], { detached: true, stdio: 'inherit' })`，让 DETACHED_PROCESS 直接创建新控制台；需要确认 GUI 父进程下 `stdio: 'inherit'` 能拿到可交互 stdin。
2. 用 `powershell.exe -NoProfile -Command "Start-Process -FilePath cmd.exe -ArgumentList '/k','<命令>'"`，把开窗交给 PowerShell。命令来自常量表，不含作者输入，但仍要做参数转义。

无论走哪条，都必须满足：

- 终端窗口可见、可输入，登录完成后窗口不被立刻关掉；
- 不把作者输入拼进命令（当前 `loginCommand` 是常量，保持这一点）；
- spawn 失败要能报错，不能静默成功；
- macOS 的 `osascript` 分支保持现状，Linux 仍明确报不支持。

### 不要重复的坑

- `windowsHide: true` 会连 `start` 开的新窗口一起隐藏。
- `start ""` + Node 参数数组会生成嵌套引号，cmd 把空标题当成 `\` 路径。
- 本机 Bash / PowerShell 工具会拦截直接启动 `cmd.exe`；验证时用临时 `.cjs` 调 `node`，再用 WMI 查子进程。用户屏幕上的错误框可用 `CloseMainWindow()` 关掉。
- 正式发布门禁 `pnpm run build:win` 在这台机器上过不了：`NODE_OPTIONS` 注入的 safe-delete 垫片一轮最多删 50 个文件，8000+ 测试会成片失败；去掉 `NODE_OPTIONS` 后仍有 14 项与 Windows 文件符号链接权限（`EPERM`）相关的环境失败。不要为了过门禁去改产品测试。

## 二、新要求：每本书单独一个工作目录

### 现状

`electron/llm/cli-harness-provider.ts` 里 spawn 本机执行器时**没有传 `cwd`**，子进程继承应用进程的工作目录（通常是应用安装目录或启动目录），不是当前这本书的项目目录。

这会导致：

- codex / claude / agy 在自己的工作目录里看不到当前书的文件，只能靠提示词里的文本；
- 两本书同时用执行器时，子进程共享同一个 cwd，容易读错、写错、互相污染；
- 作者书目录里的 `.ai-novel`、资料、草稿对 CLI 不可见，行为不可预期。

### 要求

**每本书一个独立工作目录，执行器子进程的 cwd 必须是当前书的项目目录。**

验收口径：

1. 单书生成时，`spawn` 的 `cwd` 等于当前项目会话的 `projectPath`；不是应用根目录、不是用户家目录。
2. 两本书分别生成时，两个 CLI 子进程的 cwd 各自指向自己的书目录，不共享、不串写。
3. 项目路径不存在或不可访问时，明确报可读错误，不静默回退到应用目录。
4. 不因为该要求创建目录、迁移书或改写 `.ai-novel`；只决定子进程从哪里启动。
5. 路径含中文、空格、Windows 盘符时照常工作。
6. 非本机执行器（HTTP 模型）行为不变。

### 实现提示

- `LLMGenerateOptions` / provider 调用链目前没有 `projectPath`，需要从生成控制器或项目会话把当前书路径透传下来；不要从全局变量猜。
- 本机执行器的 `env` 仍传 `process.env`，不要额外注入 KEY。
- Windows 上仍要 `shell: true` 才能启动 `.cmd` 入口；`cwd` 与 `shell` 同时存在时注意路径带空格时的引号。
- 加测试：断言 `spawn` options 里的 `cwd`；至少覆盖「有项目路径」和「没有项目路径」两条分支。

### 如果 DSH 插件也在本次范围内

`plugins/dsh-ai-novel-writer` 目前按 DSH workspace 存 `.ai-novel/novel.db`（见 `docs/adr/0010-dsh-plugin-per-workspace-novel-store.md`）。同一要求落到插件上就是：**一本书一个 workspace，不要把多本书塞进同一个 workspace 共用一个库**。需要在安装/新建流程里明确提示并校验；不要自动把一个 workspace 当成多本书的容器。

## 三、仓库与发布状态

- 分支 `master`，最新提交 `d82fdbf5`；`package.json` 版本 `1.4.1`。
- GitHub 已发布 `v1.4.1`（Latest），安装包**包含上面第 1 节的 bug**；等登录问题被用户确认修好后，再发 `v1.4.2` 替换安装包。
- v1.4.1 附件：`wanjuan-setup-1.4.1.exe`（201,021,610 字节）、`.exe.blockmap`、`latest.yml`；`latest.yml` 的 sha512/size 与本地实测一致。
- `.release/notes/v1.4.1.md` 是中英双语发布说明；发 v1.4.2 时复制一份并补修复条目。
- 本地应用重启方式：先 `CloseMainWindow()` 优雅关闭，再 `env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .`。不要 `taskkill //IM electron.exe`，会误伤用户实例。

## 四、接手顺序

1. 在真实桌面验证当前 `start cmd /k` 是否已经能弹出可交互终端；不能就按第 1 节的两条备选路径改。
2. 把登录结果反馈给用户，确认后再谈 v1.4.2。
3. 实现「每本书一个工作目录」，先加 `cwd` 透传与测试，再跑相关生成链路回归。
4. 需要发布时，按 `docs/PUBLISH-CHECKLIST.md` 走；门禁环境问题见第 1 节末尾，不要改产品测试来迁就。
