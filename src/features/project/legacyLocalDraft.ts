import { createInitialState, type ContourState } from '../contour/model'
import { parseProject } from './project'
import { DEFAULT_PROJECT_NAME, normalizeProjectName } from './projectName'

export const DRAFT_KEY = 'complex-contour-editor:draft:v1'
export const DRAFT_NAME_KEY = 'complex-contour-editor:draft-name:v1'
export interface DraftStartup {
  state: ContourState
  name: string
  recovered: boolean
  error: string
}

/** Read-only compatibility with drafts written before the IndexedDB workspace. */
export function readLocalDraft(): DraftStartup {
  try {
    const text = window.localStorage.getItem(DRAFT_KEY)
    const state = text === null ? createInitialState() : parseProject(text)
    let name = DEFAULT_PROJECT_NAME
    let metadataError = ''
    if (text !== null) {
      try {
        name = normalizeProjectName(window.localStorage.getItem(DRAFT_NAME_KEY) ?? '') ?? name
      } catch (error) {
        metadataError = `项目名称无法恢复：${error instanceof Error ? error.message : '存储不可用'}`
      }
    }
    return {
      state,
      name,
      recovered: text !== null,
      error: metadataError,
    }
  } catch (error) {
    return {
      state: createInitialState(),
      name: DEFAULT_PROJECT_NAME,
      recovered: false,
      error: `本地草稿无法恢复：${error instanceof Error ? error.message : '存储不可用'}`,
    }
  }
}
