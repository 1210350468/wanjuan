import { describe, expect, it } from 'vitest'
import { plotTreeErrorMessage } from '../use-plot-threads'

const zh = (text: string) => text
const fromMain = (code: string) => new Error(`Error invoking remote method 'graph-generation:begin': Error: ${code}`)
const fallback: [string, string] = ['剧情树生成失败。', 'Could not generate the plot tree.']

describe('剧情树主进程错误码的作者文案', () => {
  it.each([
    ['NO_EVENT_SOURCES', '请先添加章节蓝图、定稿或叙事线索，再生成剧情树。'],
    ['SOURCE_LIMIT_EXCEEDED', '旧剧情树没有改动。剧情树最多读 200 章，这部作品的蓝图或定稿超过了。'],
    ['SOURCE_INPUT_TOO_LARGE', '旧剧情树没有改动。剧情资料压缩后仍然太长，缩短蓝图或线索后再试。'],
  ])('%s 经过 IPC 后说明原因，不退回「生成失败」', (code, message) => {
    expect(plotTreeErrorMessage(fromMain(code), zh, fallback)).toBe(message)
  })

  it('没登记的码仍用调用方给的说明', () => {
    expect(plotTreeErrorMessage(fromMain('GENERATION_REQUEST_FAILED'), zh, fallback)).toBe('剧情树生成失败。')
  })
})
