import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'
import { loadTemplate, selectObject } from '../test/navigation'

describe('mixed contour editing', () => {
  it('rejects collinear arc input then allows recovery through the same form', async () => {
    const user = userEvent.setup()
    await renderApp()
    await loadTemplate(user, '上半圆围道')
    await selectObject(user, '选择路径段 1')
    const original = screen.getByTestId('contour-path').getAttribute('d')
    await user.clear(screen.getByLabelText('经过点虚部 Im'))
    await user.type(screen.getByLabelText('经过点虚部 Im'), '0')
    await user.click(screen.getByRole('button', { name: '应用经过点' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/共线/)
    expect(screen.getByTestId('contour-path')).toHaveAttribute('d', original)
    await user.clear(screen.getByLabelText('经过点虚部 Im'))
    await user.type(screen.getByLabelText('经过点虚部 Im'), '3{Enter}')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('contour-path').getAttribute('d')).not.toBe(original)
    expect(screen.getByLabelText('经过点虚部 Im')).toHaveFocus()
  })

  it('converts an arc into a line and prevents closing the resulting two-line contour', async () => {
    const user = userEvent.setup()
    await renderApp()
    await loadTemplate(user, '上半圆围道')
    await selectObject(user, '选择路径段 1')
    await user.click(screen.getByRole('button', { name: '改为线段' }))
    expect(screen.getByTestId('contour-path')).not.toHaveAttribute('d', /A/)
    expect(screen.getByRole('checkbox', { name: '闭合围道' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: '闭合围道' })).toBeDisabled()
  })
})
