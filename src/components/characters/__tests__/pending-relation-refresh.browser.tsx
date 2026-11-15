/* eslint-disable react-refresh/only-export-components */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { PendingFinalizedRelationCandidate } from '../../../shared/finalized-continuity'
import type { ProjectSessionContext } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useCharacterStore } from '../../../stores/character-store'
import { usePendingRelationCandidates } from '../use-pending-relation-candidates'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const session: ProjectSessionContext = { projectId: 'lighthouse', projectPath: 'C:/novels/lighthouse', leaseId: 'lease-1' }
const LIST = 'finalized-character:list-relation-candidates'
const DECIDE = 'finalized-character:decide-relation-candidate'
const card = (authorRelations: string[]) => ({ source: { draftId: 8 }, candidateKey: 'k', value: '恩断义绝', authorRelations }) as unknown as PendingFinalizedRelationCandidate

let root: Root
let host: HTMLDivElement
let authorRelations: string[]
let invoke: ReturnType<typeof vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>>
const latest = {} as { relations: ReturnType<typeof usePendingRelationCandidates> }
const originalStore = useCharacterStore.getState()

function Pending() {
  const relations = usePendingRelationCandidates(session)
  useEffect(() => { latest.relations = relations })
  return null
}

const calls = (channel: string) => invoke.mock.calls.filter(([name]) => name === channel)
const until = (assertion: () => void) => act(async () => { await vi.waitFor(assertion) })

beforeEach(() => {
  authorRelations = ['师徒']
  setActiveProjectSessionContext(session)
  invoke = vi.fn(async (channel: string) => channel === LIST ? [card(authorRelations)] : [])
  Object.defineProperty(window, 'aiNovelAPI', { configurable: true, value: { invoke, on: () => () => {} } })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  setActiveProjectSessionContext(null)
  useCharacterStore.setState(originalStore, true)
})

it('作者在档案里保存关系后，采用带上新的作者设定，第一次就发出去', async () => {
  await act(async () => root.render(<Pending />))
  await until(() => expect(latest.relations?.candidates[0]?.authorRelations).toEqual(['师徒']))

  authorRelations = ['宿敌']
  await act(async () => { useCharacterStore.setState({ rosterRevision: (useCharacterStore.getState().rosterRevision ?? 0) + 1 }) })
  await until(() => expect(latest.relations.candidates[0]?.authorRelations).toEqual(['宿敌']))
  await act(async () => { latest.relations.review('k') })
  await act(async () => { await latest.relations.decide('accept') })

  expect(calls(DECIDE)).toHaveLength(1)
  expect(JSON.stringify(calls(DECIDE)[0])).toContain('"expectedAuthorRelations":["宿敌"]')
})
