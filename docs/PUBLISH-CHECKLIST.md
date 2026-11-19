# 万卷 Wanjuan — 发布清单

仓库 `1210350468/wanjuan`，默认分支 `master`。`gh` 在 `C:\Users\12103\.local\bin\gh.exe`，已登录账号 1210350468。

## 一、推送前检查

1. 确认没有凭据、本机路径、私人小说正文进入仓库：
   - `grep -rn "sk-[A-Za-z0-9]\{20,\}\|api_key\|API_KEY" . --exclude-dir=node_modules --exclude-dir=.git`
   - 检查 `src`、`electron`、`docs` 里没有 `C:\Users\`、`D:\coding` 之类本机路径。
2. 许可文件齐全：`LICENSE`（GPL-3.0）、`NOTICE.md`（上游署名与改动说明）。
3. README 里的下载地址指向本仓库 `releases/latest`，版本号与 `package.json` 一致。
4. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全部通过。
5. 界面冒烟：从源码启动一次，走完新手引导、番茄书库分类切换、Skill 超市仓库搜索。

## 二、提交与推送

```bash
cd D:/coding/ai项目发掘/ai小说
git add -A
git commit -m "<改动摘要>"
git push origin master
```

更新检查与「官方主页」入口指向 `1210350468/wanjuan`（`electron/services/github-release-update-backend.ts`、`src/shared/official-homepage.ts`、`electron-builder.json5`），不读上游 Release。换账号时这三处要一起改，测试里的断言也要同步。

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

Windows 的安装包、blockmap 与 `latest.yml` 必须一起上传：应用内更新读 `latest.yml` 判断版本号和摘要，缺了它更新提示不会出现。

```bash
VERSION=$(node -p "require('./package.json').version")
gh release create "v$VERSION" \
  "release/$VERSION/wanjuan-setup-$VERSION.exe" \
  "release/$VERSION/wanjuan-setup-$VERSION.exe.blockmap" \
  "release/$VERSION/latest.yml" \
  --title "万卷 Wanjuan $VERSION" \
  --notes-file ".release/notes/v$VERSION.md" \
  --latest
```

发布后核对附件与标记：

```bash
gh api repos/1210350468/wanjuan/releases/latest \
  --jq '.tag_name + " " + ([.assets[].name] | join(", "))'
```

`latest.yml` 里的 `sha512` 与 `size` 要与 exe 一致，先在本地算一遍再上传：

```bash
P="release/$VERSION/wanjuan-setup-$VERSION.exe" node -e "const{createHash}=require('crypto'),fs=require('fs');const p=process.env.P;const h=createHash('sha512');fs.createReadStream(p).on('data',d=>h.update(d)).on('end',()=>console.log(h.digest('base64'),fs.statSync(p).size))"
```

macOS 两个架构的 dmg 构建好后一同挂到同一个 Release；macOS 的应用内更新只提示新版本并打开本页，不自动替换程序。

## 五、宣传顺序

1. GitHub Release 发布后，先在仓库 README 与 About 放上线文案（见 `docs/PROMOTION.md`）。
2. 发 V2EX / 技术社区帖，附 60 秒录屏。
3. 发小红书与朋友圈短版，配 5 张截图。
4. 收集反馈后统一记到 GitHub Issues，不在评论区零散处理。

## 六、回滚点

发布前把当前全部历史打包成一份备份，放在仓库外面：

```bash
git bundle create "../wanjuan-history-$(date +%F).bundle" --all
git bundle verify "../wanjuan-history-$(date +%F).bundle"
```

需要回到备份里的某个状态时，从 bundle 克隆出一份对照工作区：

```bash
git clone "../wanjuan-history-2026-11-19.bundle" ../wanjuan-restore
```

代码要恢复时用文件编辑工具写回，不要用 Git 重置覆盖工作区。
