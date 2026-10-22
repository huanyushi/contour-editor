import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TemplatePanel } from './TemplatePanel'
import { createBlankCanvasState, createCanvasEntry } from '../project/canvasWorkspace'

describe('canvas and template panel limits', () => {
  it('lets users browse previews at ten canvases but blocks blank, duplicate and template creation', async () => {
    const user = userEvent.setup()
    const canvases = Array.from({ length: 10 }, (_, i) =>
      createCanvasEntry(String(i), `作品${i}`, createBlankCanvasState()),
    )
    render(
      <TemplatePanel
        open
        disabled={false}
        onClose={vi.fn()}
        workspace={{ canvases, activeId: '0' }}
        onLoad={vi.fn()}
        onActivate={vi.fn()}
        onCreateBlank={vi.fn()}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '新建空白画布' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '复制画布 作品0' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '切换到画布 作品0' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByText(/最多保存 10 张画布/)).toBeVisible()
    await user.click(screen.getByRole('tab', { name: '示例模板' }))
    await user.click(screen.getByRole('button', { name: '预览钥匙孔围道' }))
    expect(screen.getByRole('button', { name: '以此模板新建画布' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '预览钥匙孔围道' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByRole('img', { name: '钥匙孔围道大预览' })).not.toBeInTheDocument()
  })
})
