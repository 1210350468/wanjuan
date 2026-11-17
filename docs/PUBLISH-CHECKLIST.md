# 万卷 Wanjuan — 发布清单

本机没有 `gh`，当前 `origin` 指向上游 `EthanYoQ/Pagekin`。下面的步骤需要在你自己的 GitHub 账号下建仓库并推送；我没有你的凭证，不会代你执行推送。

## 一、推送前检查

1. 确认没有凭据、本机路径、私人小说正文进入仓库：
   - `grep -rn "sk-[A-Za-z0-9]\{20,\}\|api_key\|API_KEY" . --exclude-dir=node_modules --exclude-dir=.git`
   - 检查 `src`、`electron`、`docs` 里没有 `C:\Users\`、`D:\coding` 之类本机路径。
2. 许可文件齐全：`LICENSE`（GPL-3.0）、`NOTICE.md`（上游署名与改动说明）。
3. README 里的下载占位地址 `<你的账号>` 已替换成真实账号名。
4. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全部通过。
5. 界面冒烟：从源码启动一次，走完新手引导、番茄书库分类切换、Skill 超市仓库搜索。

## 二、建仓库并推送

在 GitHub 网页新建一个空仓库，建议名字 `wanjuan`，不要勾选 README / LICENSE / .gitignore（本地已经有）。然后：

```bash
cd D:/coding/ai项目发掘/ai小说
git remote remove origin
git remote add origin https://github.com/<你的账号>/wanjuan.git
git add -A
git commit -m "Rename to Wanjuan and add Fanqie library, skill marketplace, onboarding"
git branch -M main
git push -u origin main
```

`origin` 被移除前请先确认本地提交都完成了；上游 Pagekin 的更新以后需要手动合并。

## 三、构建与上传安装包

```bash
# Windows x64
pnpm run build:win:artifacts

# macOS Apple Silicon
pnpm run build:mac:arm64:artifacts

# macOS Intel
pnpm run build:mac:x64:artifacts
```

产物在 `release/<版本号>/`。检查文件名是 `wanjuan-setup-<版本>.exe` 和 `wanjuan-mac-<架构>-<版本>-installer.dmg`。

Windows 安装包未做代码签名，macOS 安装包只有 ad-hoc 签名；发布说明里要写清楚，避免用户以为下载出错。

## 四、发布 Release

1. 在 GitHub 仓库点 Releases → Draft a new release。
2. Tag 建议 `v2.0.0-wanjuan`，标题 `万卷 Wanjuan v2.0.0`。
3. 说明用 `.release/notes/v2.0.0-wanjuan.md`。
4. 上传上一步的安装包。
5. 发布后把 README 里的 `<你的账号>` 全部替换并提交。

## 五、宣传顺序

1. GitHub Release 发布后，先在仓库 README 与 About 放上线文案（见 `docs/PROMOTION.md`）。
2. 发 V2EX / 技术社区帖，附 60 秒录屏。
3. 发小红书与朋友圈短版，配 5 张截图。
4. 收集反馈后统一记到 GitHub Issues，不在评论区零散处理。

## 六、回滚点

发布前给当前提交打本地标签：

```bash
git tag -a v2.0.0-wanjuan-prepush -m "Before first public push"
```

后续改名或改配置出现问题时，用文件编辑工具恢复到这个提交对应的状态；不要用 Git 重置覆盖工作区。
