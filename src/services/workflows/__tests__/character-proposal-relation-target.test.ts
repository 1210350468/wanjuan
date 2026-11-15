import { describe, expect, it } from 'vitest'
import type { CharacterProposalBatch } from '../../../shared/character-proposal'
import { createCharacterProposalChoices } from '../../character-proposal-choices'
import { proposalRelations } from '../character-proposal-preview'

const SHEN = 'shen-id'
const batch: CharacterProposalBatch = { proposalBatchId: 'batch', revision: 1, status: 'pending-approval', source: { kind: 'directory', operationId: 'source' },
  items: [
    { selectionKey: 'lin', sourceId: 'one', fields: { name: '林岚' }, resolution: { status: 'unresolved', candidateIds: [] }, relationships: [{ targetName: '沈砚', relation: '师徒' }] },
    { selectionKey: 'shen', sourceId: 'two', fields: { name: '沈砚' }, resolution: { status: 'resolved', characterId: SHEN }, relationships: [] },
  ] }
const identities = [{ characterId: SHEN, name: '沈砚' }]

describe('关系目标只写了名字时', () => {
  it('批内候选采用到同名的已有角色，两边是同一人：关系能勾选，默认勾上', () => {
    const choices = createCharacterProposalChoices(batch, identities)
    expect(proposalRelations(batch, identities, choices.selections).map(relation => relation.adoptable)).toEqual([true])
    expect(choices.relationships).toEqual([{ sourceSelectionKey: 'lin', targetSelectionKey: 'shen', relation: '师徒' }])
  })

  it('批内候选改成新建，和已有角色是两个同名的人：仍不能勾选', () => {
    const selections = [{ selectionKey: 'lin', action: 'create' as const }, { selectionKey: 'shen', action: 'create' as const }]
    expect(proposalRelations(batch, identities, selections).map(relation => relation.adoptable)).toEqual([false])
  })
})
