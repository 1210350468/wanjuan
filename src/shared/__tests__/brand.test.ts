import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_BRAND } from '../brand'

const visibleBrandSurfaces = [
  'index.html',
  'src/components/panels/agent/AgentHeader.tsx',
  'src/services/agent/context-builder.ts',
  'src/services/agent/tools/open-editor.tool.ts',
  'src/services/agent/tools/start-workflow.tool.ts',
  'src/stores/agent-store.ts',
  'src/services/safe-call-diagnostic.ts',
  'src/i18n/messages/zh-CN.ts',
  'src/i18n/messages/en-US.ts',
]

const legacyNamePattern = new RegExp('\\bVe' + 'la\\b')
const legacyHiddenDirPattern = new RegExp('\\.' + 've' + 'la(?!API)', 'i')
const legacyPrefixPattern = new RegExp('ve' + 'la-', 'i')
const formerNamePattern = /AI ?小说作家|AI Novel Writer/

describe('APP_BRAND', () => {
  it('uses 万卷 / Wanjuan visible product language', () => {
    expect(APP_BRAND.zhName).toBe('万卷')
    expect(APP_BRAND.enName).toBe('Wanjuan')
    expect(APP_BRAND.shortName).toBe('万卷')
    expect(Object.values(APP_BRAND).join(' ')).not.toMatch(legacyNamePattern)
  })

  it('记下上一个公开名字，安装包沿用原有身份', () => {
    const legacyNames = readFileSync(resolve(process.cwd(), 'scripts/product-identity.mjs'), 'utf8')

    expect(APP_BRAND.formerZhName).toBe('书童')
    expect(APP_BRAND.formerEnName).toBe('Pagekin')
    // 安装包的 ProductName 与 appId 由 scripts/product-identity.mjs 维护，改名不动它，老用户升级不掉数据。
    // 三代名字都要认：万卷（现名）、书童（上一代）、AI小说作家（最初）。
    expect(legacyNames).toContain("const LEGACY_PRODUCT_NAME = '书童'")
    expect(legacyNames).toContain("const OLDEST_PRODUCT_NAME = 'AI小说作家'")
    expect(legacyNames).toContain('const PRODUCT_NAMES = [PRODUCT_NAME, LEGACY_PRODUCT_NAME, OLDEST_PRODUCT_NAME]')
  })

  it('does not expose legacy product naming in visible brand surfaces', () => {
    for (const file of visibleBrandSurfaces) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8')

      expect(source, file).not.toMatch(legacyNamePattern)
      expect(source, file).not.toMatch(legacyHiddenDirPattern)
      expect(source, file).not.toMatch(legacyPrefixPattern)
      expect(source, file).not.toMatch(formerNamePattern)
    }
  })
})
