import { useLayoutEffect, useRef, useState } from 'react'
import { transientLock } from '../../components/transientLock'
import { DEFAULT_PROJECT_NAME, MAX_PROJECT_NAME_LENGTH, normalizeProjectName } from './projectName'

interface Props {
  name: string
  onChange: (name: string) => void
  busy: boolean
}

export function ProjectName({ name, onChange, busy }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const input = useRef<HTMLInputElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    } else if (restoreFocus.current) {
      button.current?.focus()
      restoreFocus.current = false
    }
  }, [editing])
  const finish = (commit: boolean) => {
    const next = normalizeProjectName(draft) ?? DEFAULT_PROJECT_NAME
    if (commit && next !== name) onChange(next)
    setEditing(false)
  }
  return (
    <div className="project-name">
      {editing ? (
        <input
          className="project-name-input"
          ref={input}
          aria-label="项目名称"
          value={draft}
          maxLength={MAX_PROJECT_NAME_LENGTH}
          inert={busy}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== 'Escape') return
            event.stopPropagation()
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            event.preventDefault()
            restoreFocus.current = true
            finish(event.key === 'Enter')
          }}
        />
      ) : (
        <button
          ref={button}
          aria-label="重命名项目"
          title={name}
          {...transientLock(busy)}
          onClick={() => {
            setDraft(name)
            setEditing(true)
          }}
        >
          {name}
        </button>
      )}
    </div>
  )
}
