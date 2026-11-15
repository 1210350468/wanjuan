import { readFileSync } from 'node:fs'

/** 真实模型（DeepSeek V4.1 Flash）的导入推演原文：novelConfig 少了闭合的 `}`。 */
export const unclosedNovelConfig = readFileSync(new URL('./fixtures/import-inference-unclosed-novel-config.txt', import.meta.url), 'utf8')
export const closedNovelConfig = unclosedNovelConfig.replace(',"architectureFiles"', '},"architectureFiles"')
