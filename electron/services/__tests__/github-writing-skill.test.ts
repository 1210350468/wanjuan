import { describe, expect, it } from 'vitest'
import { GitHubSkillError, parseGitHubRepositoryInput } from '../github-writing-skill'

describe('parseGitHubRepositoryInput', () => {
  it('接受 owner/repo', () => {
    expect(parseGitHubRepositoryInput('zenstory-ai/oh-story-claudecode')).toEqual({
      owner: 'zenstory-ai',
      repo: 'oh-story-claudecode',
    })
    expect(parseGitHubRepositoryInput('  acme/story-skill.git  ')).toEqual({ owner: 'acme', repo: 'story-skill' })
  })

  it('接受仓库页链接与子目录链接', () => {
    expect(parseGitHubRepositoryInput('https://github.com/acme/story-skill')).toEqual({ owner: 'acme', repo: 'story-skill' })
    expect(parseGitHubRepositoryInput('https://github.com/acme/story-skill/tree/main/skills')).toEqual({
      owner: 'acme',
      repo: 'story-skill',
      ref: 'main',
      pathPrefix: 'skills',
    })
    expect(parseGitHubRepositoryInput('https://github.com/acme/story-skill/tree/v2/skills/mine')).toEqual({
      owner: 'acme',
      repo: 'story-skill',
      ref: 'v2',
      pathPrefix: 'skills/mine',
    })
  })

  it('拒绝其他站点与缺少仓库名', () => {
    for (const input of [
      '',
      'acme',
      'acme/..',
      'https://gitlab.com/acme/story-skill',
      'https://raw.githubusercontent.com/acme/story-skill/main/SKILL.md',
      'http://github.com/acme/story-skill',
      'https://github.com/acme',
    ]) {
      expect(() => parseGitHubRepositoryInput(input), input).toThrow(GitHubSkillError)
    }
  })

  it('把带 .. 的子目录按 URL 规范化后再取子目录', () => {
    expect(parseGitHubRepositoryInput('https://github.com/acme/story-skill/tree/main/skills/../../etc')).toEqual({
      owner: 'acme',
      repo: 'story-skill',
      ref: 'etc',
    })
    // 规范化后连分支一起消失，缺少分支名直接拒绝。
    expect(() => parseGitHubRepositoryInput('https://github.com/acme/story-skill/tree/main/..')).toThrow(GitHubSkillError)
  })
})
