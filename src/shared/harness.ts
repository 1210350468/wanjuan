/**
 * 本机执行器的识别结果：作者不必自己查命令怎么填，设置页直接扫 PATH、读凭据文件、跑一次 `--version`，
 * 把「装没装、登录没登录、用哪条命令」摆出来。
 *
 * 这里只关心「能不能用」，不读任何凭据内容：凭据文件只判断存在与大小，返回的只是给人看的路径。
 */

export const HARNESS_IDS = ['codex', 'gemini', 'claude', 'agy'] as const
export type HarnessId = typeof HARNESS_IDS[number]

export type HarnessAuthState = 'signed-in' | 'signed-out' | 'unknown'

export interface HarnessCandidate {
  id: HarnessId
  /** 预填进模型配置的命令。 */
  command: string
  /** 预填进模型配置的参数，`{{prompt}}` 表示提示词插入位置。 */
  args: string[]
  installed: boolean
  /** 实际找到的可执行文件；找不到时为空。 */
  resolvedPath?: string
  /** `--version` 的第一行，取不到就留空，不影响「已安装」的判断。 */
  version?: string
  auth: HarnessAuthState
  /** 判定已登录的依据，形如 `~/.codex/auth.json` 或环境变量名。不含任何密钥内容。 */
  credential?: string
  /** 在终端里执行的登录命令。 */
  loginCommand: string
  /** 登录过程要自己回车或授权，终端会停在交互界面里。 */
  interactive: boolean
}

export interface HarnessDetection {
  candidates: HarnessCandidate[]
  platform: NodeJS.Platform
}

export function isHarnessId(value: unknown): value is HarnessId {
  return typeof value === 'string' && (HARNESS_IDS as readonly string[]).includes(value)
}
