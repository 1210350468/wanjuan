import { app, ipcMain } from 'electron'

import { mainText } from '../i18n'
import { isHarnessId } from '../../src/shared/harness'
import { detectHarnesses, openHarnessLogin, type DetectorDeps, type LoginDeps } from '../services/harness-detector'

export interface HarnessControllerOptions {
  ipc?: Pick<typeof ipcMain, 'handle'>
  detect?: (deps?: DetectorDeps) => ReturnType<typeof detectHarnesses>
  login?: (id: Parameters<typeof openHarnessLogin>[0], deps?: LoginDeps) => ReturnType<typeof openHarnessLogin>
}

function text(zhCNText: string, enUSText: string): string {
  return mainText(app.getLocale(), zhCNText, enUSText)
}

/**
 * 执行器探测与登录。检测只读：看 PATH、看凭据文件在不在、跑一次 `--version`；
 * 登录交给系统终端，主进程不接触任何 token。
 */
export function registerHarnessController({
  ipc = ipcMain,
  detect = detectHarnesses,
  login = openHarnessLogin,
}: HarnessControllerOptions = {}) {
  ipc.handle('harness:detect', async () => {
    try {
      const candidates = await detect()
      return { success: true, detection: { candidates, platform: process.platform } }
    } catch {
      return { success: false, error: text('没能检查本机执行器，请稍后再试', 'Could not check the local harnesses. Try again later.') }
    }
  })

  ipc.handle('harness:login', async (_event, request: unknown) => {
    if (typeof request !== 'object' || request === null || !isHarnessId((request as { id?: unknown }).id)) {
      return { success: false, error: text('登录请求无效', 'The sign-in request is invalid') }
    }
    const { id } = request as { id: Parameters<typeof login>[0] }
    try {
      const { command } = login(id)
      return { success: true, command }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error && error.message
          ? error.message
          : text('没能打开终端，请自己打开终端登录', 'Could not open a terminal. Open one yourself and sign in there.'),
      }
    }
  })
}
