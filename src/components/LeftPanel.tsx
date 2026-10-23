import type { ReactNode } from 'react'
import { PanelLeftClose } from 'lucide-react'

export function LeftPanel({
  id,
  title,
  open,
  onClose,
  className = '',
  children,
  header,
  footer,
}: {
  id: string
  title: string
  open: boolean
  onClose: () => void
  className?: string
  children: ReactNode
  header?: ReactNode
  footer?: ReactNode
}) {
  return (
    <aside
      id={id}
      className={`left-panel side-panel ${className}`}
      aria-label={title}
      hidden={!open}
    >
      <div className="panel-heading">
        <h2>{title}</h2>
        <button aria-label={`收起${title}`} data-tooltip={`收起${title}`} onClick={onClose}>
          <PanelLeftClose className="ui-icon" aria-hidden="true" />
        </button>
      </div>
      {header}
      <div className="panel-scroll" tabIndex={0} aria-label={`${title}内容`}>
        {children}
      </div>
      {footer}
    </aside>
  )
}
