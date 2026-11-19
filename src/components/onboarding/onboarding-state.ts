/**
 * 新手引导的「看过没有」标记。只存在渲染进程的 localStorage，不写作品或全局配置，
 * 换机器重新引导一次，也不会因为清空配置就把标记丢掉。
 */
export const ONBOARDING_STORAGE_KEY = 'wanjuan:onboarding:v1'

export type OnboardingStorage = Pick<Storage, 'getItem' | 'setItem'>

export function hasSeenOnboarding(storage: OnboardingStorage = window.localStorage): boolean {
  try {
    return storage.getItem(ONBOARDING_STORAGE_KEY) === 'done'
  } catch {
    // 隐私模式或存储被禁用时按没看过处理，引导最多多出现一次。
    return false
  }
}

export function markOnboardingSeen(storage: OnboardingStorage = window.localStorage): void {
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, 'done')
  } catch {
    // 存不下就算了，下次启动再引导一遍不影响使用。
  }
}
