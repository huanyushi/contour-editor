import { useCallback, useEffect, useRef, useState } from 'react'
import { createInitialState, type ContourState } from '../contour/model'
import { parseProject, serializeProject } from './project'
import { DEFAULT_PROJECT_NAME, normalizeProjectName } from './projectName'

export const DRAFT_KEY = 'complex-contour-editor:draft:v1'
export const DRAFT_NAME_KEY = 'complex-contour-editor:draft-name:v1'
export interface DraftStartup {
  state: ContourState
  name: string
  recovered: boolean
  error: string
}

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

const snapshotKey = (text: string, name: string) => JSON.stringify([text, name])

export function useLocalDraft(
  state: ContourState,
  busy: boolean,
  initial: DraftStartup,
  name = initial.name,
) {
  const serialized = serializeProject(state)
  const initialText = serializeProject(initial.state)
  const key = snapshotKey(serialized, name)
  const initialKey = snapshotKey(initialText, initial.name)
  const latest = useRef({ text: serialized, name })
  const saved = useRef<string | null>(initial.recovered ? initialKey : null)
  const suppressed = useRef<string | null>(null)
  const damagedFallback = useRef<string | null>(
    initial.error && !initial.recovered ? initialText : null,
  )
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [result, setResult] = useState({
    key: initial.recovered ? initialKey : '',
    message: initial.error
      ? initial.recovered
        ? '项目名称无法恢复'
        : '本地草稿无法恢复'
      : initial.recovered
        ? '已恢复本地草稿'
        : '本地草稿待保存',
    error: initial.error,
  })

  const write = useCallback((text: string, name: string) => {
    const key = snapshotKey(text, name)
    if (key === saved.current || key === suppressed.current || text === damagedFallback.current)
      return
    try {
      // Never replace a recoverable draft with data that the file reader rejects.
      parseProject(text)
      saved.current = null
      // A partial write must not attach the previous document's name to new geometry.
      window.localStorage.removeItem(DRAFT_NAME_KEY)
      window.localStorage.setItem(DRAFT_KEY, text)
      suppressed.current = null
      damagedFallback.current = null
      window.localStorage.setItem(DRAFT_NAME_KEY, name)
      saved.current = key
      setResult({ key, message: '本地草稿已保存', error: '' })
    } catch (error) {
      setResult({
        key,
        message: '本地草稿保存失败',
        error: `本地草稿保存失败：${error instanceof Error ? error.message : '存储不可用'}。可使用“保存项目”手动备份。`,
      })
    }
  }, [])

  useEffect(() => {
    latest.current = { text: serialized, name }
    clearTimeout(timer.current)
    if (busy || key === saved.current || key === suppressed.current) return
    timer.current = setTimeout(() => write(serialized, name), 500)
    return () => clearTimeout(timer.current)
  }, [serialized, name, key, busy, write])

  useEffect(() => {
    const flush = () => {
      clearTimeout(timer.current)
      write(latest.current.text, latest.current.name)
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [write])

  const clear = () => {
    clearTimeout(timer.current)
    try {
      saved.current = null
      window.localStorage.removeItem(DRAFT_KEY)
      damagedFallback.current = null
      window.localStorage.removeItem(DRAFT_NAME_KEY)
      suppressed.current = key
      setResult({ key, message: '本地草稿已清除，下次修改后重新保存', error: '' })
    } catch (error) {
      setResult({
        key,
        message: '清除草稿失败',
        error: `无法清除本地草稿：${error instanceof Error ? error.message : '存储不可用'}`,
      })
    }
  }

  const saveNow = (document: ContourState, projectName = name) => {
    clearTimeout(timer.current)
    const text = serializeProject(document)
    latest.current = { text, name: projectName }
    suppressed.current = null
    damagedFallback.current = null
    saved.current = null
    write(text, projectName)
  }

  return {
    saveNow,
    clear,
    error: result.error,
    status: result.error ? result.message : result.key === key ? result.message : '本地草稿待保存',
  }
}
