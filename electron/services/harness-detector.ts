import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { localize, resolveLocale } from '../../src/i18n/core'
import { HARNESS_IDS, type HarnessAuthState, type HarnessCandidate, type HarnessId } from '../../src/shared/harness'

/**
 * 本机执行器探测：扫 PATH 找可执行文件，读凭据文件判断登没登录，跑一次 `--version` 把版本摆出来。
 *
 * 只做只读判断：凭据文件只看存在与字节数，绝不读内容，也不把路径拼进日志给外部看。
 * 登录不在主进程里等，交给系统终端开一个窗口，作者自己在里面完成 OAuth。
 */

function text(zhCNText: string, enUSText: string): string {
  const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale
  return localize(resolveLocale(systemLocale), zhCNText, enUSText)
}

export interface HarnessSpec {
  id: HarnessId
  command: string
  /** 预填进模型配置的参数。 */
  args: string[]
  versionArgs: string[]
  /** 相对家目录的凭据文件；任一存在且非空即视为已登录。 */
  credentialFiles: string[]
  /** 凭据类环境变量；任一非空即视为已登录。 */
  credentialEnv: string[]
  /** 终端里要执行的登录命令。 */
  loginCommand: string
  interactive: boolean
}

/** 各家 CLI 的登录方式不一样：codex 有 login 子命令，claude 与 gemini 要在交互界面里授权。 */
export const HARNESS_SPECS: Record<HarnessId, HarnessSpec> = {
  codex: {
    id: 'codex',
    command: 'codex',
    args: ['exec', '{{prompt}}'],
    versionArgs: ['--version'],
    credentialFiles: ['.codex/auth.json'],
    credentialEnv: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
    loginCommand: 'codex login',
    interactive: false,
  },
  gemini: {
    id: 'gemini',
    command: 'gemini',
    args: ['-p', '{{prompt}}'],
    versionArgs: ['--version'],
    credentialFiles: ['.gemini/oauth_creds.json'],
    credentialEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    loginCommand: 'gemini',
    interactive: true,
  },
  claude: {
    id: 'claude',
    command: 'claude',
    args: ['-p', '{{prompt}}'],
    versionArgs: ['--version'],
    credentialFiles: ['.claude/.credentials.json'],
    credentialEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
    loginCommand: 'claude',
    interactive: true,
  },
  agy: {
    id: 'agy',
    command: 'agy',
    args: [],
    versionArgs: ['--version'],
    credentialFiles: [],
    credentialEnv: [],
    loginCommand: 'agy',
    interactive: true,
  },
}

const PATH_SEPARATORS = /[/\\]/

export interface ResolveOptions {
  env?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  homeDir?: string
  exists?: (filePath: string) => boolean
}

/**
 * 该去哪些目录找命令。图形方式启动的应用拿不到 shell 的 PATH（macOS 从 Finder 打开尤其明显），
 * 所以除 PATH 之外还要补上几个约定目录。
 */
export function searchDirectories({ env = process.env, platform = process.platform, homeDir = os.homedir() }: ResolveOptions = {}): string[] {
  const fromPath = (env.PATH ?? env.Path ?? '').split(path.delimiter).map(entry => entry.trim()).filter(Boolean)
  const fallback = platform === 'win32'
    ? [path.join(homeDir, 'AppData', 'Roaming', 'npm'), path.join(homeDir, '.local', 'bin')]
    : platform === 'darwin'
      ? [path.join(homeDir, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
      : [path.join(homeDir, '.local', 'bin'), '/usr/local/bin', '/usr/bin', '/bin']
  // PATH 里的顺序代表作者自己的偏好，补的目录排在后面，不抢 PATH 的结果。
  return [...new Set([...fromPath, ...fallback])]
}

/** 在 PATH（含补的目录）里找可执行文件；Windows 按 PATHEXT 依次试扩展名。 */
export function resolveCommandPath(command: string, options: ResolveOptions = {}): string | undefined {
  const { env = process.env, platform = process.platform, exists = fs.existsSync } = options
  const trimmed = command.trim()
  if (!trimmed) return undefined
  if (PATH_SEPARATORS.test(trimmed)) return exists(trimmed) ? trimmed : undefined
  const extensions = platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map(ext => ext.trim()).filter(Boolean)
    : ['']
  for (const directory of searchDirectories(options)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${trimmed}${extension}`)
      if (exists(candidate)) return candidate
    }
  }
  return undefined
}

export interface AuthOptions {
  env?: Record<string, string | undefined>
  homeDir?: string
  exists?: (filePath: string) => boolean
  sizeOf?: (filePath: string) => number
}

/** 只看凭据是否就位：环境变量非空，或凭据文件存在且不是空占位。 */
export function classifyAuth(spec: HarnessSpec, options: AuthOptions = {}): { auth: HarnessAuthState, credential?: string } {
  const { env = process.env, homeDir = os.homedir(), exists = fs.existsSync, sizeOf = sizeOfFile } = options
  for (const key of spec.credentialEnv) {
    if (env[key]?.trim()) return { auth: 'signed-in', credential: key }
  }
  if (spec.credentialFiles.length === 0) return { auth: 'unknown' }
  for (const relative of spec.credentialFiles) {
    const file = path.join(homeDir, relative)
    if (!exists(file)) continue
    if (sizeOf(file) <= 2) return { auth: 'signed-out', credential: displayPath(relative) }
    return { auth: 'signed-in', credential: displayPath(relative) }
  }
  return { auth: 'signed-out' }
}

function sizeOfFile(filePath: string): number {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}

function displayPath(relative: string): string {
  return `~/${relative.split(path.sep).join('/')}`
}

/** `codex --version` 之类，取第一行并截断；跑不起来就当版本未知，不影响安装判断。 */
export async function probeVersion(
  command: string,
  { timeoutMs = 4000, spawnImpl = spawn }: { timeoutMs?: number, spawnImpl?: typeof spawn } = {},
): Promise<string | undefined> {
  return new Promise(resolve => {
    let settled = false
    const finish = (value?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawnImpl(command, ['--version'], {
        shell: process.platform === 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      resolve(undefined)
      return
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* 已经退出就不用管 */ }
      finish(undefined)
    }, timeoutMs)
    let output = ''
    child.stdout?.on('data', chunk => { if (output.length < 2048) output += String(chunk) })
    child.stderr?.on('data', chunk => { if (output.length < 2048) output += String(chunk) })
    child.on('error', () => finish(undefined))
    // 非零退出码多半是「命令不存在」或用法不对，这时输出里是报错而不是版本号。
    child.on('close', code => {
      if (code !== 0) { finish(undefined); return }
      const firstLine = output.split(/\r?\n/).map(line => line.trim()).find(line => line.length > 0)
      finish(firstLine ? firstLine.slice(0, 80) : undefined)
    })
  })
}

export interface DetectorDeps extends ResolveOptions, AuthOptions {
  probe?: (command: string) => Promise<string | undefined>
}

/** 一次把所有执行器问一遍；没装的不会去跑 `--version`，避免反复触发安装提示。 */
export async function detectHarnesses(deps: DetectorDeps = {}): Promise<HarnessCandidate[]> {
  const probe = deps.probe ?? probeVersion
  return Promise.all(HARNESS_IDS.map(async id => {
    const spec = HARNESS_SPECS[id]
    const resolvedPath = resolveCommandPath(spec.command, deps)
    const { auth, credential } = classifyAuth(spec, deps)
    const version = resolvedPath ? await probe(spec.command) : undefined
    return {
      id,
      command: spec.command,
      args: [...spec.args],
      installed: Boolean(resolvedPath),
      resolvedPath,
      version,
      auth,
      credential,
      loginCommand: spec.loginCommand,
      interactive: spec.interactive,
    }
  }))
}

export interface LoginDeps {
  platform?: NodeJS.Platform
  spawnImpl?: typeof spawn
}

/**
 * 在系统终端里打开登录流程。OAuth 要浏览器回调、claude 要自己敲 `/login`，
 * 与其在应用里伪装一个终端，不如把作者熟悉的那个终端打开。
 */
export function openHarnessLogin(id: HarnessId, { platform = process.platform, spawnImpl = spawn }: LoginDeps = {}): { command: string } {
  const spec = HARNESS_SPECS[id]
  if (!spec) throw new Error(text('不认识这个执行器', 'Unknown harness'))
  if (platform === 'win32') {
    // 登录命令都来自上面的常量表，不含作者输入；`cmd /k` 让窗口在登录后留着，方便看结果。
    const child = spawnImpl('cmd.exe', ['/c', `start "" cmd /k ${spec.loginCommand}`], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    return { command: spec.loginCommand }
  }
  if (platform === 'darwin') {
    const child = spawnImpl('osascript', [
      '-e', `tell application "Terminal" to do script "${spec.loginCommand}"`,
      '-e', 'tell application "Terminal" to activate',
    ], { detached: true, stdio: 'ignore' })
    child.unref()
    return { command: spec.loginCommand }
  }
  throw new Error(text('在这个系统上请自己打开终端执行', `Open a terminal yourself on this platform and run`))
}
