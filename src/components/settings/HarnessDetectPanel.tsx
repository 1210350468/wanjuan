import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { displayedErrorMessage } from '../../i18n/app-errors'
import { ipc } from '../../services/ipc-client'
import type { HarnessCandidate, HarnessId } from '../../shared/harness'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'

/** 每个执行器给人看的名字，命令本身放在括号里：作者认的是产品名，要填的是命令。 */
const HARNESS_LABELS: Record<HarnessId, readonly [string, string]> = {
  codex: ['Codex', 'Codex'],
  gemini: ['Gemini CLI', 'Gemini CLI'],
  claude: ['Claude Code', 'Claude Code'],
  agy: ['agy', 'agy'],
}

/** 登录之后要做什么，各家不一样：codex 是浏览器授权，claude 要在交互界面里敲 /login。 */
const LOGIN_STEPS: Record<HarnessId, readonly [string, string]> = {
  codex: ['终端里会给出登录链接，授权完切回应用会自动重新检测。', 'The terminal prints a sign-in link. Once you authorize and come back, the app checks again by itself.'],
  claude: ['在弹出的 Claude Code 里输入 /login 完成授权，然后切回应用。', 'Type /login inside Claude Code, authorize, then switch back to the app.'],
  gemini: ['首次运行会让你选登录方式，按提示用 Google 账号授权，之后切回应用。', 'The first run asks how to sign in; authorize with your Google account, then switch back.'],
  agy: ['按终端里的提示完成登录，之后切回应用。', 'Follow the prompts in the terminal, then switch back.'],
}

export interface HarnessDetectPanelProps {
  /** 选中一个可用的执行器：由表单把命令与参数填进去。 */
  onPick: (candidate: HarnessCandidate) => void
}

/**
 * 本机执行器检测：不用作者自己去查命令叫什么、有没有装、登录没登录。
 * 检测只读，登录交给系统终端，面板这边只负责把状态说清楚。
 */
export function HarnessDetectPanel({ onPick }: HarnessDetectPanelProps) {
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  const [candidates, setCandidates] = useState<HarnessCandidate[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [signingIn, setSigningIn] = useState<HarnessId | null>(null)

  const checkingRef = useRef(false)
  const check = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    setChecking(true)
    setError('')
    setNotice('')
    try {
      const result = await ipc.invoke('harness:detect')
      if (!result.success || !result.detection) {
        setCandidates([])
        setError(displayedErrorMessage(locale, result.error))
        return
      }
      // 能直接用的排前面：已安装 + 已登录 > 已安装未登录 > 没装。
      const rank = (candidate: HarnessCandidate) => (candidate.installed ? (candidate.auth === 'signed-in' ? 0 : 1) : 2)
      setCandidates([...result.detection.candidates].sort((left, right) => rank(left) - rank(right)))
    } catch (cause) {
      setCandidates([])
      setError(displayedErrorMessage(locale, cause instanceof Error ? cause.message : undefined))
    } finally {
      checkingRef.current = false
      setChecking(false)
    }
  }, [locale])

  // 进面板就查一次。放到下一个宏任务里，避免在 effect 里同步 setState 触发级联渲染。
  useEffect(() => {
    const timer = setTimeout(() => { void check() }, 0)
    return () => clearTimeout(timer)
  }, [check])

  // 作者去终端登录完再切回应用时自动重查一次，不用特意回来点按钮。
  useEffect(() => {
    const onFocus = () => { void check() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [check])

  const signIn = async (candidate: HarnessCandidate) => {
    setSigningIn(candidate.id)
    setError('')
    try {
      const result = await ipc.invoke('harness:login', { id: candidate.id })
      if (!result.success) {
        setError(displayedErrorMessage(locale, result.error))
        return
      }
      setNotice(text(
        `已在终端打开 ${result.command ?? candidate.loginCommand}。${LOGIN_STEPS[candidate.id][0]}`,
        `Opened ${result.command ?? candidate.loginCommand} in a terminal. ${LOGIN_STEPS[candidate.id][1]}`,
      ))
    } catch (cause) {
      setError(displayedErrorMessage(locale, cause instanceof Error ? cause.message : undefined))
    } finally {
      setSigningIn(null)
    }
  }

  const authLabel = (candidate: HarnessCandidate): string => {
    if (candidate.auth === 'signed-in') return text('已登录', 'Signed in')
    if (candidate.auth === 'signed-out') return text('没找到登录凭据', 'No sign-in found')
    return text('登录状态未知', 'Sign-in status unknown')
  }

  return (
    <div className="rounded-lg p-3 space-y-2" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-hover)' }} data-harness-detect>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{text('本机执行器', 'Local harnesses')}</span>
        <Button
          type="button"
          variant="text"
          size="sm"
          disabled={checking}
          onClick={() => void check()}
          aria-label={text('重新检测本机执行器', 'Check local harnesses again')}
        >
          <RefreshCw size={12} className={checking ? 'animate-spin' : undefined} aria-hidden="true" />
          {checking ? text('检查中…', 'Checking…') : text('重新检测', 'Check again')}
        </Button>
      </div>

      {candidates === null && !error && (
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{text('正在检查本机装了哪些命令行 agent…', 'Checking which command-line agents are installed…')}</p>
      )}

      {candidates !== null && candidates.length > 0 && (
        <ul className="space-y-1" aria-label={text('检测到的执行器', 'Detected harnesses')}>
          {candidates.map(candidate => (
            <li key={candidate.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-harness-row={candidate.id}>
              <span className="font-medium">{text(...HARNESS_LABELS[candidate.id])}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>{candidate.command}</span>
              {candidate.installed
                ? (
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    {text('已安装', 'Installed')}
                    {candidate.version ? ` · ${candidate.version}` : ''}
                    {' · '}
                    <span style={{ color: candidate.auth === 'signed-in' ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}>
                      {authLabel(candidate)}
                    </span>
                  </span>
                )
                : <span style={{ color: 'var(--color-text-muted)' }}>{text('未安装', 'Not installed')}</span>}
              <span className="ml-auto flex items-center gap-2">
                {candidate.installed && candidate.auth !== 'signed-in' && (
                  <Button
                    type="button"
                    variant="text"
                    size="sm"
                    disabled={signingIn !== null}
                    onClick={() => void signIn(candidate)}
                    aria-label={text(`登录 ${HARNESS_LABELS[candidate.id][0]}`, `Sign in to ${HARNESS_LABELS[candidate.id][1]}`)}
                  >
                    {text('登录', 'Sign in')}
                  </Button>
                )}
                {candidate.installed && (
                  <Button
                    type="button"
                    variant="text"
                    size="sm"
                    onClick={() => onPick(candidate)}
                    aria-label={text(`使用 ${HARNESS_LABELS[candidate.id][0]}`, `Use ${HARNESS_LABELS[candidate.id][1]}`)}
                  >
                    {text('用这个', 'Use this')}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{error}</p>}
      {notice && <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{notice}</p>}
      {candidates !== null && candidates.every(candidate => !candidate.installed) && !error && (
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {text(
            '没找到这些命令。装好之后点「重新检测」；也可以直接手填命令与参数。',
            'None of these commands were found. Install one and choose "Check again", or fill in the command and arguments yourself.',
          )}
        </p>
      )}
    </div>
  )
}
