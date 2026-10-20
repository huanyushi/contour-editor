import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import App from './App'
import { AxesLabelForm } from '../features/contour/AxesLabelForm'

it('applies axis label drafts atomically and keeps the rendered labels when TeX is invalid', async () => {
  const user = userEvent.setup()
  render(<App />)
  expect(screen.getByTestId('label-axis-re')).toHaveAttribute('aria-label', '\\mathrm{Re}')
  expect(screen.getByTestId('label-axis-im')).toHaveAttribute('aria-label', '\\mathrm{Im}')
  await user.click(screen.getByRole('button', { name: '视图设置' }))
  await user.clear(screen.getByLabelText('实轴标签'))
  await user.type(screen.getByLabelText('实轴标签'), 'x')
  await user.clear(screen.getByLabelText('虚轴标签'))
  await user.type(screen.getByLabelText('虚轴标签'), 'y')
  expect(screen.getByTestId('label-axis-re')).toHaveAttribute('aria-label', '\\mathrm{Re}')
  await user.click(screen.getByRole('button', { name: '应用轴标签' }))
  expect(screen.getByTestId('label-axis-re')).toHaveAttribute('aria-label', 'x')
  expect(screen.getByTestId('label-axis-im')).toHaveAttribute('aria-label', 'y')
  await user.clear(screen.getByLabelText('实轴标签'))
  await user.paste('\\frac{')
  await user.click(screen.getByRole('button', { name: '应用轴标签' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/公式错误/)
  expect(screen.getByTestId('label-axis-re')).toHaveAttribute('aria-label', 'x')
  expect(screen.getByTestId('label-axis-im')).toHaveAttribute('aria-label', 'y')
  expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
})

it('clears a previous TeX error when a project supplies different valid axis labels', async () => {
  const user = userEvent.setup()
  const { rerender } = render(
    <AxesLabelForm value={{ reLabel: 'x', imLabel: 'y' }} onApply={() => {}} />,
  )
  await user.clear(screen.getByLabelText('实轴标签'))
  await user.paste('\\frac{')
  await user.click(screen.getByRole('button', { name: '应用轴标签' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/公式错误/)
  rerender(<AxesLabelForm value={{ reLabel: 'u', imLabel: 'v' }} onApply={() => {}} />)
  expect(screen.getByLabelText('实轴标签')).toHaveValue('u')
  expect(screen.getByLabelText('虚轴标签')).toHaveValue('v')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
