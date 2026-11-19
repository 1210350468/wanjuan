import { app, ipcMain } from 'electron'

import { mainText } from '../i18n'
import {
  FanqieLibraryError,
  loadFanqieRank,
  searchFanqieBooks,
} from '../services/fanqie-library'

export interface FanqieControllerOptions {
  ipc?: Pick<typeof ipcMain, 'handle'>
}

function text(zhCNText: string, enUSText: string): string {
  return mainText(app.getLocale(), zhCNText, enUSText)
}

/** 番茄书库只读公开书籍页与榜单：没有登录、没有正文、没有解密。 */
export function registerFanqieController({ ipc = ipcMain }: FanqieControllerOptions = {}) {
  const failure = (error: unknown) => ({
    success: false,
    error: error instanceof FanqieLibraryError
      ? error.message
      : error instanceof Error ? error.message : text('番茄书库暂时不可用', 'The Fanqie library is unavailable right now'),
  })

  ipc.handle('fanqie:search', async (_event, keyword: unknown) => {
    try {
      if (typeof keyword !== 'string' || keyword.length > 200) {
        throw new FanqieLibraryError('NOT_FOUND', text('请输入书名、关键词或番茄书籍链接', 'Enter a title, keyword, or Fanqie book link'))
      }
      return { success: true, result: await searchFanqieBooks(keyword) }
    } catch (error) {
      return failure(error)
    }
  })

  ipc.handle('fanqie:rank', async (_event, request: unknown) => {
    try {
      if (request !== undefined && (typeof request !== 'object' || request === null)) {
        throw new FanqieLibraryError('NOT_FOUND', text('榜单参数无效', 'The ranking request is invalid'))
      }
      const input = (request ?? {}) as { gender?: unknown; categoryId?: unknown }
      const gender = input.gender === 2 ? 2 : input.gender === 1 ? 1 : undefined
      const categoryId = typeof input.categoryId === 'string' && input.categoryId.length <= 32 ? input.categoryId : undefined
      return { success: true, result: await loadFanqieRank({ gender, categoryId }) }
    } catch (error) {
      return failure(error)
    }
  })
}
