import { describe, expect, it } from 'vitest'

import { closedNovelConfig, unclosedNovelConfig } from './import-inference-syntax.fixture'
import { isRepairableDirectJsonSyntaxFailure, preservesStructuredJsonEvidence } from '../structured-syntax-repair'

describe('preservesStructuredJsonEvidence', () => {
  it('真实模型漏掉 novelConfig 的闭合括号：在中间补上会改变后面字段的归属，判为改了事实', () => {
    expect(isRepairableDirectJsonSyntaxFailure(unclosedNovelConfig)).toBe(true)
    expect(JSON.parse(closedNovelConfig)).toHaveProperty('architectureFiles')
    expect(preservesStructuredJsonEvidence(unclosedNovelConfig, closedNovelConfig)).toBe(false)
  })

  it('只在末尾补闭合括号仍然放行', () => {
    expect(preservesStructuredJsonEvidence(closedNovelConfig.slice(0, -2), closedNovelConfig)).toBe(true)
  })
})
