import { EventEmitter } from 'node:events'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  HARNESS_SPECS,
  classifyAuth,
  detectHarnesses,
  openHarnessLogin,
  probeVersion,
  resolveCommandPath,
  searchDirectories,
} from '../harness-detector'

const noop = () => undefined

describe('resolveCommandPath', () => {
  it('按 PATH 顺序返回第一个命中的可执行文件', () => {
    const first = path.resolve('/opt/one')
    const second = path.resolve('/opt/two')
    const target = path.join(second, 'codex')
    const resolved = resolveCommandPath('codex', {
      platform: 'linux',
      env: { PATH: [first, second].join(path.delimiter) },
      homeDir: path.resolve('/home/writer'),
      exists: candidate => candidate === target,
    })
    expect(resolved).toBe(target)
  })

  it('Windows 按 PATHEXT 补扩展名', () => {
    const directory = path.resolve('C:/tools/bin')
    const target = path.join(directory, 'codex.CMD')
    const resolved = resolveCommandPath('codex', {
      platform: 'win32',
      env: { PATH: directory, PATHEXT: '.EXE;.CMD' },
      homeDir: path.resolve('C:/Users/writer'),
      exists: candidate => candidate === target,
    })
    expect(resolved).toBe(target)
  })

  it('没装就返回 undefined', () => {
    expect(resolveCommandPath('nope', {
      platform: 'linux', env: { PATH: '/usr/bin' }, homeDir: '/home/w', exists: () => false,
    })).toBeUndefined()
  })

  it('带路径分隔符时只判断该文件是否存在', () => {
    const absolute = path.resolve('/opt/custom/agent')
    expect(resolveCommandPath(absolute, { platform: 'linux', exists: () => true })).toBe(absolute)
    expect(resolveCommandPath(absolute, { platform: 'linux', exists: () => false })).toBeUndefined()
  })

  it('找不到命令时不会去猜空目录', () => {
    expect(resolveCommandPath('   ', { exists: () => true })).toBeUndefined()
  })
})

describe('searchDirectories', () => {
  it('PATH 之后补上图形启动时拿不到的目录', () => {
    const directories = searchDirectories({
      platform: 'darwin',
      env: { PATH: ['/usr/bin', '/bin'].join(path.delimiter) },
      homeDir: '/Users/writer',
    })
    expect(directories.slice(0, 2)).toEqual(['/usr/bin', '/bin'])
    expect(directories).toContain('/opt/homebrew/bin')
    expect(directories).toContain(path.join('/Users/writer', '.local', 'bin'))
  })

  it('重复目录只留一个', () => {
    const directories = searchDirectories({
      platform: 'linux',
      env: { PATH: ['/usr/bin', '/usr/bin'].join(path.delimiter) },
      homeDir: '/home/writer',
    })
    expect(directories.filter(entry => entry === '/usr/bin')).toHaveLength(1)
  })
})

describe('classifyAuth', () => {
  it('环境变量有值就算已登录，凭据名只报变量名', () => {
    expect(classifyAuth(HARNESS_SPECS.codex, {
      env: { OPENAI_API_KEY: 'sk-live' }, homeDir: '/home/w', exists: () => false,
    })).toEqual({ auth: 'signed-in', credential: 'OPENAI_API_KEY' })
  })

  it('凭据文件存在且有内容就算已登录，路径显示为 ~ 开头', () => {
    const file = path.join('/home/w', '.codex', 'auth.json')
    expect(classifyAuth(HARNESS_SPECS.codex, {
      env: {}, homeDir: '/home/w', exists: candidate => candidate === file, sizeOf: () => 512,
    })).toEqual({ auth: 'signed-in', credential: '~/.codex/auth.json' })
  })

  it('空占位文件不算登录', () => {
    const file = path.join('/home/w', '.claude', '.credentials.json')
    expect(classifyAuth(HARNESS_SPECS.claude, {
      env: {}, homeDir: '/home/w', exists: candidate => candidate === file, sizeOf: () => 0,
    })).toEqual({ auth: 'signed-out', credential: '~/.claude/.credentials.json' })
  })

  it('什么都没有就是未登录', () => {
    expect(classifyAuth(HARNESS_SPECS.claude, {
      env: {}, homeDir: '/home/w', exists: () => false,
    })).toEqual({ auth: 'signed-out' })
  })

  it('不认识凭据位置的执行器不谎报未登录', () => {
    expect(classifyAuth(HARNESS_SPECS.agy, {
      env: {}, homeDir: '/home/w', exists: () => false,
    })).toEqual({ auth: 'unknown' })
  })
})

describe('probeVersion', () => {
  it('读得到真实版本号的第一行', async () => {
    const version = await probeVersion(process.execPath, { timeoutMs: 15_000 })
    expect(version).toMatch(/^v?\d+\.\d+/)
  })

  it('命令不存在时返回 undefined 而不是抛错', async () => {
    await expect(probeVersion(path.join(process.cwd(), 'definitely-not-a-real-binary-xyz'))).resolves.toBeUndefined()
  })
})

describe('detectHarnesses', () => {
  it('已安装的带上路径与版本，未安装的不去跑 --version', async () => {
    const resolved = path.resolve('/opt/bin/codex')
    const probe = vi.fn(async (command: string) => (command === 'codex' ? 'codex-cli 0.48.0' : undefined))
    const candidates = await detectHarnesses({
      platform: 'linux',
      env: { PATH: path.dirname(resolved) },
      homeDir: '/home/w',
      exists: candidate => candidate === resolved,
      sizeOf: () => 0,
      probe,
    })
    const codex = candidates.find(candidate => candidate.id === 'codex')!
    expect(codex.installed).toBe(true)
    expect(codex.resolvedPath).toBe(resolved)
    expect(codex.version).toBe('codex-cli 0.48.0')
    expect(codex.auth).toBe('signed-out')
    expect(codex.args).toEqual(['exec', '{{prompt}}'])
    expect(candidates.filter(candidate => !candidate.installed).every(candidate => candidate.version === undefined)).toBe(true)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('四个执行器都会给出一条结果，界面不用自己补默认值', async () => {
    const candidates = await detectHarnesses({
      platform: 'linux', env: {}, homeDir: '/home/w', exists: () => false, probe: async () => undefined,
    })
    expect(candidates.map(candidate => candidate.id)).toEqual(['codex', 'gemini', 'claude', 'agy'])
    expect(candidates.every(candidate => candidate.loginCommand.length > 0)).toBe(true)
  })
})

describe('openHarnessLogin', () => {
  const fakeSpawn = () => {
    const calls: { command: string, args: string[], options?: Record<string, unknown> }[] = []
    const unref = vi.fn()
    const spawnImpl = ((command: string, args: string[], options?: Record<string, unknown>) => {
      calls.push({ command, args, options })
      return { unref } as never
    }) as never
    return { calls, unref, spawnImpl }
  }

  it('Windows 用 cmd /k 打开一个留着结果的终端', () => {
    const { calls, unref, spawnImpl } = fakeSpawn()
    expect(openHarnessLogin('codex', { platform: 'win32', spawnImpl })).toEqual({ command: 'codex login' })
    expect(calls[0]?.command).toBe('cmd.exe')
    expect(calls[0]?.args.join(' ')).toContain('codex login')
    expect(calls[0]?.options).toMatchObject({ detached: true, stdio: 'ignore' })
    // windowsHide 会把 start 开出来的终端一起藏掉，点了登录就像没反应。
    expect(calls[0]?.options?.windowsHide).not.toBe(true)
    expect(unref).toHaveBeenCalled()
  })

  it('macOS 交给 Terminal 执行', () => {
    const { calls, spawnImpl } = fakeSpawn()
    openHarnessLogin('claude', { platform: 'darwin', spawnImpl })
    expect(calls[0]?.command).toBe('osascript')
    expect(calls[0]?.args.join(' ')).toContain('do script "claude"')
  })

  it('其他系统明确说不支持，而不是静默失败', () => {
    expect(() => openHarnessLogin('gemini', { platform: 'linux', spawnImpl: noop as never })).toThrow()
  })
})

// EventEmitter 只是为了给 spawn 类型一个可比较的参照，避免 tsc 把 never 推得过深。
void EventEmitter
