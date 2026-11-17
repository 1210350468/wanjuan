/**
 * Skill 超市的推荐来源：公开的写作 Skill 仓库。
 * 只列出扫描后确实能装进本应用的仓库；每个仓库里能装哪些 Skill 由扫描结果决定。
 */
export interface WritingSkillSourceRepo {
  id: string
  owner: string
  repo: string
  name: string
  description: string
  /** 中文标签，便于按用途筛选。 */
  tags: string[]
  /** 扫描核对过的说明，例如可安装的数量。 */
  verified: string
}

export const RECOMMENDED_WRITING_SKILL_REPOS: readonly WritingSkillSourceRepo[] = [
  {
    id: 'one-flower',
    owner: 'sleepykino',
    repo: 'One-flower',
    name: '一花 · 文风与去 AI 味',
    description: '19 个单文件写法规则：电影感叙述、海明威冰山、武侠古风、悬念第一人称、show-don\'t-tell、去 AI 味。',
    tags: ['文风', '去 AI 味', '单文件'],
    verified: '19 个全部可安装',
  },
  {
    id: 'mumu-ai-novel',
    owner: 'xiamuceer-j',
    repo: 'MuMuAINovel',
    name: 'MuMuAI 小说技能集',
    description: '小说创作助手的技能目录，含长篇拆文、长篇扫榜与去 AI 味规则。',
    tags: ['拆文', '去 AI 味'],
    verified: '部分技能依赖脚本，列表里会标出不能安装的条目',
  },
  {
    id: 'chinese-webnovel-skills',
    owner: 'tance-mang',
    repo: 'chinese-webnovel-skills',
    name: '中文网文技能包',
    description: '单技能合集：人味改写、人物、连续性、对白、扩写、去 AI 味、题材文风。',
    tags: ['去 AI 味', '人物', '对白'],
    verified: '39 个技能里 22 个可直接安装，其余会在列表里标出原因',
  },
]
