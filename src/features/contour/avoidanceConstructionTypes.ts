import type { BankCut } from '../../lib/bankClearanceGeometry'
import type {
  DetourGeometry,
  ParallelBanks,
  SourceInterval,
} from '../../lib/connectedAvoidanceGeometry'

export interface ParentConstruction {
  id: string
  mode: 'line' | 'arc' | 'corner' | 'corridor'
  geometry: DetourGeometry
  trims: readonly SourceInterval[]
  occupancy: readonly SourceInterval[]
  primarySourceId: string
  bankPair?: ParallelBanks
}
export interface ClearanceConstruction {
  id: string
  parentAvoidanceId: string
  cuts: readonly BankCut[]
}
export interface ConstructionTable {
  parents: ReadonlyMap<string, ParentConstruction>
  clearances: ReadonlyMap<string, ClearanceConstruction>
}
