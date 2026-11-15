/**
 * 1.4.0 遗留：本机「不再显示」的标记（运行 id 加当时列出的片段与尾段），只用于迁成运行上的「不再恢复」。
 * 存储不可用时当作没有。
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
