/**
 * 1.4.0 在运行侧页点「不再显示」时，按作品记在这台电脑上的内容标记（运行 id 加当时列出的片段与尾段）。
 * 现在「不再恢复」记在运行上；这里只剩读出旧标记、迁完后删掉。存储不可用时当作没有。
 */
const key = (projectId: string) => `pagekin:run-recovery-hidden:${projectId}`

export function readHiddenRecovery(projectId: string): ReadonlySet<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key(projectId)) ?? '[]')
    return new Set(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

export function forgetHiddenRecovery(projectId: string): void {
  try { localStorage.removeItem(key(projectId)) } catch { /* 删不掉下次再迁，迁过的运行再记一次结果相同。 */ }
}
