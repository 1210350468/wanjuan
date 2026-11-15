import { describe, expect, it } from 'vitest'
import { plotTreeErrorMessage } from '../use-plot-threads'

const zh = (text: string) => text
const en = (_zh: string, text: string) => text
const fromMain = (code: string) => new Error(`Error invoking remote method 'graph-generation:begin': Error: ${code}`)
const fallback: [string, string] = ['剧情树生成失败。', 'Could not generate the plot tree.']

describe('剧情树主进程错误码的作者文案', () => {
  it.each([
    ['NO_EVENT_SOURCES', '请先添加章节蓝图、定稿或叙事线索，再生成剧情树。',
      'Add a chapter blueprint, finalized chapter, or narrative thread before generating a plot tree.'],
    ['SOURCE_LIMIT_EXCEEDED', '旧剧情树没有改动。剧情树最多读 200 章，这部作品的蓝图或定稿超过了。',
      'The previous plot tree is unchanged. A plot tree reads at most 200 chapters, and this book has more blueprints or finalized chapters.'],
    ['SOURCE_INPUT_TOO_LARGE', '旧剧情树没有改动。剧情资料压缩后仍然太长，缩短蓝图或线索后再试。',
      'The previous plot tree is unchanged. The plot sources are still too long after compacting. Shorten the blueprints or threads and try again.'],
  ])('%s 经过 IPC 后说明原因，不退回「生成失败」', (code, zhMessage, enMessage) => {
    expect(plotTreeErrorMessage(fromMain(code), zh, fallback)).toBe(zhMessage)
    expect(plotTreeErrorMessage(fromMain(code), en, fallback)).toBe(enMessage)
  })

  it('没登记的码仍用调用方给的说明', () => {
    expect(plotTreeErrorMessage(fromMain('GENERATION_REQUEST_FAILED'), zh, fallback)).toBe('剧情树生成失败。')
    expect(plotTreeErrorMessage(fromMain('GENERATION_REQUEST_FAILED'), en, fallback)).toBe('Could not generate the plot tree.')
  })
})
