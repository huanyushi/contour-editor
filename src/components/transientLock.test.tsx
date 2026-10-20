import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { transientLock } from './transientLock'

function Counter({ locked, unavailable = false }: { locked: boolean; unavailable?: boolean }) {
  const [count, setCount] = useState(0)
  return (
    <>
      <button disabled={unavailable} {...transientLock(locked)} onClick={() => setCount(count + 1)}>
        操作
      </button>
      <output>{count}</output>
    </>
  )
}

it('blocks a temporarily locked action without native disabled styling and resumes after unlocking', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<Counter locked={false} />)
  await user.click(screen.getByRole('button', { name: '操作' }))
  expect(screen.getByRole('status')).toHaveTextContent('1')
  rerender(<Counter locked />)
  const button = screen.getByRole('button', { name: '操作' })
  expect(button).not.toHaveAttribute('disabled')
  expect(button).toHaveAttribute('aria-disabled', 'true')
  await user.click(button)
  button.focus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('status')).toHaveTextContent('1')
  rerender(<Counter locked={false} />)
  await user.click(button)
  expect(screen.getByRole('status')).toHaveTextContent('2')
  rerender(<Counter locked={false} unavailable />)
  expect(button).toBeDisabled()
})
