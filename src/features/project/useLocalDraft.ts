import { useCallback, useEffect, useRef, useState } from 'react'
import { createInitialState, type ContourState } from '../contour/model'
import { parseProject, serializeProject } from './project'

export const DRAFT_KEY = 'complex-contour-editor:draft:v1'
export interface DraftStartup {
  state: ContourState
  recovered: boolean
  error: string
}

export function readLocalDraft(): DraftStartup {
  try {
    const text = window.localStorage.getItem(DRAFT_KEY)
    return {
      state: text === null ? createInitialState() : parseProject(text),
      recovered: text !== null,
      error: '',
    }
  } catch (error) {
    return {
      state: createInitialState(),
      recovered: false,
      error: `本地草稿无法恢复：${error instanceof Error ? error.message : '存储不可用'}`,
    }
  }
}

export function useLocalDraft(state: ContourState, busy: boolean, initial: DraftStartup) {
  const serialized = serializeProject(state)
  const initialText = serializeProject(initial.state)
  const latest = useRef(serialized)
  const saved = useRef<string | null>(initial.recovered ? initialText : null)
  const suppressed = useRef<string | null>(initial.error ? initialText : null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [result, setResult] = useState({
    text: initial.recovered ? initialText : '',
    message: initial.error
      ? '本地草稿无法恢复'
      : initial.recovered
        ? '已恢复本地草稿'
        : '本地草稿待保存',
    error: initial.error,
  })

  const write = useCallback((text: string) => {
    if (text === saved.current || text === suppressed.current) return
    try {
      // Never replace a recoverable draft with data that the file reader rejects.
      parseProject(text)
      window.localStorage.setItem(DRAFT_KEY, text)
      saved.current = text
      suppressed.current = null
      setResult({ text, message: '本地草稿已保存', error: '' })
    } catch (error) {
      setResult({
        text,
        message: '本地草稿保存失败',
        error: `本地草稿保存失败：${error instanceof Error ? error.message : '存储不可用'}。可使用“保存项目”手动备份。`,
      })
    }
  }, [])

  useEffect(() => {
    latest.current = serialized
    clearTimeout(timer.current)
    if (busy || serialized === saved.current || serialized === suppressed.current) return
    timer.current = setTimeout(() => write(serialized), 500)
    return () => clearTimeout(timer.current)
  }, [serialized, busy, write])

  useEffect(() => {
    const flush = () => {
      clearTimeout(timer.current)
      write(latest.current)
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [write])

  const clear = () => {
    clearTimeout(timer.current)
    try {
      window.localStorage.removeItem(DRAFT_KEY)
      suppressed.current = serialized
      saved.current = null
      setResult({ text: serialized, message: '本地草稿已清除，下次修改后重新保存', error: '' })
    } catch (error) {
      setResult({
        text: serialized,
        message: '清除草稿失败',
        error: `无法清除本地草稿：${error instanceof Error ? error.message : '存储不可用'}`,
      })
    }
  }

  const saveNow = (document: ContourState) => {
    clearTimeout(timer.current)
    const text = serializeProject(document)
    latest.current = text
    suppressed.current = null
    saved.current = null
    write(text)
  }

  return {
    saveNow,
    clear,
    error: result.error,
    status: result.error
      ? result.message
      : result.text === serialized
        ? result.message
        : '本地草稿待保存',
  }
}
