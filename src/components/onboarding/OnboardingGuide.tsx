import { useState } from 'react'
import { BookMarked, BookOpen, Compass, Sparkles, Wand2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { useLocaleStore } from '../../stores/locale-store'
import { navigate } from '../../stores/navigation/navigation-intents'
import { APP_BRAND } from '../../shared/brand'

interface OnboardingGuideProps {
  open: boolean
  onClose: () => void
}

const STEP_KEYS = ['welcome', 'model', 'sources', 'flow'] as const
type StepKey = typeof STEP_KEYS[number]

const ICONS: Record<StepKey, typeof Sparkles> = {
  welcome: Sparkles,
  model: Wand2,
  sources: Compass,
  flow: BookOpen,
}

/** 首次打开时的四步引导：这本书是什么、模型怎么配、去哪找参考、一本书怎么写。 */
export default function OnboardingGuide({ open, onClose }: OnboardingGuideProps) {
  const text = useLocaleStore(s => s.text)
  const [index, setIndex] = useState(0)
  const key = STEP_KEYS[index]
  const Icon = ICONS[key]
  const last = index === STEP_KEYS.length - 1

  const titles: Record<StepKey, [string, string]> = {
    welcome: [`欢迎用${APP_BRAND.zhName}`, `Welcome to ${APP_BRAND.enName}`],
    model: ['先让 AI 就位', 'Connect a model'],
    sources: ['去哪儿找参考', 'Where ideas come from'],
    flow: ['一部作品怎么写完', 'How a book gets written'],
  }

  const bodies: Record<StepKey, [string, string]> = {
    welcome: [
      '万卷是本地优先的长篇创作工作台：作品、设定、草稿都存在你自己的文件夹里。软件不带模型账号，写作能力来自你自己的 API Key 或本机 Ollama。',
      'Wanjuan is a local-first workspace for long-form fiction: books, setup, and drafts live in your own folders. The app ships without model accounts; writing comes from your own API key or a local Ollama.',
    ],
    model: [
      '在「设置 → AI 模型」里填服务地址、模型名与 API Key。支持任何 OpenAI 兼容服务（DeepSeek、硅基流动、智谱、xAI 等）和 Google Gemini；也可以填本机 Ollama 的地址，不花钱。',
      'Open Settings → AI model and fill in the base URL, model name, and API key. Any OpenAI-compatible service works (DeepSeek, SiliconFlow, BigModel, xAI, and more), as does Google Gemini or a local Ollama endpoint.',
    ],
    sources: [
      '「番茄书库」按男频女频的题材翻榜单，带封面、简介、字数与章节节奏；勾选两本以上可以把它们融合成一部新书的设定。「小说拆解与仿写」可以导入 .txt、.md、.epub，拆结构、提文风、反推蓝图。',
      'The Fanqie library browses rankings by genre with covers, synopses, word counts, and chapter rhythm; pick two or more books to fuse their structure into a new setup. Novel breakdown imports .txt, .md, or .epub files to study structure, voice, and blueprints.',
    ],
    flow: [
      '一部作品按设定 → 架构 → 章节蓝图 → 正文 → 审稿修稿 → 定稿的顺序推进，每一步都由你确认。写好的规则可以做成写作 Skill，绑到规划、写稿、审稿或修稿阶段。',
      'A book moves from setup to architecture, chapter blueprints, prose, review and revision, then finalization, with your confirmation at each step. Writing rules can be installed as skills and bound to planning, drafting, review, or revision.',
    ],
  }

  const dismiss = () => {
    setIndex(0)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={value => { if (!value) dismiss() }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon size={18} className="text-[var(--color-accent)]" />
            {text(titles[key][0], titles[key][1])}
          </DialogTitle>
          <DialogDescription>
            {text(`第 ${index + 1} 步，共 ${STEP_KEYS.length} 步`, `Step ${index + 1} of ${STEP_KEYS.length}`)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm leading-7 text-[var(--color-text-secondary)]">{text(bodies[key][0], bodies[key][1])}</p>

          {key === 'sources' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-[var(--color-border)] px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text)]">
                  <BookMarked size={13} aria-hidden />
                  {text('番茄书库', 'Fanqie library')}
                </div>
                <p className="mt-1 text-[0.7rem] leading-5 text-[var(--color-text-muted)]">
                  {text('19 + 18 个题材榜单，可多书融合', '19 + 18 genre rankings, fuse several books')}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text)]">
                  <BookOpen size={13} aria-hidden />
                  {text('拆解与仿写', 'Breakdown & imitation')}
                </div>
                <p className="mt-1 text-[0.7rem] leading-5 text-[var(--color-text-muted)]">
                  {text('导入现成小说，反推结构与蓝图', 'Import a novel, infer structure and blueprints')}
                </p>
              </div>
            </div>
          )}

          {key === 'flow' && (
            <ol className="flex flex-wrap gap-2 text-[0.7rem] text-[var(--color-text-secondary)]">
              {[
                text('设定', 'Setup'),
                text('架构', 'Architecture'),
                text('蓝图', 'Blueprints'),
                text('正文', 'Prose'),
                text('审稿', 'Review'),
                text('定稿', 'Finalize'),
              ].map((label, stepIndex) => (
                <li key={label} className="rounded-full border border-[var(--color-border)] px-2 py-0.5">
                  {stepIndex + 1}. {label}
                </li>
              ))}
            </ol>
          )}

          <div className="flex items-center gap-1" aria-hidden>
            {STEP_KEYS.map((step, stepIndex) => (
              <span
                key={step}
                className="h-1 flex-1 rounded-full"
                style={{ background: stepIndex <= index ? 'var(--color-accent)' : 'var(--color-border)' }}
              />
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="text" size="sm" onClick={dismiss}>{text('跳过引导', 'Skip')}</Button>
          <div className="flex gap-2">
            {index > 0 && (
              <Button type="button" variant="secondary" onClick={() => setIndex(previous => previous - 1)}>
                {text('上一步', 'Back')}
              </Button>
            )}
            {key === 'model' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  navigate({ kind: 'settings', section: 'llm' })
                  dismiss()
                }}
              >
                {text('去配置模型', 'Open settings')}
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                if (last) dismiss()
                else setIndex(previous => previous + 1)
              }}
            >
              {last ? text('开始写', 'Start writing') : text('下一步', 'Next')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
