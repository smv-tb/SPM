import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { GanttChart } from '../GanttChart'

const mockTasks = [
  { id: '1', name: 'Task 1', code: 'T1', start: '2024-01-01', end: '2024-03-15', progress: 50, milestone: 'M1', tag: '#Mori-Infra', isRequired: false },
  { id: '2', name: 'Task 2', code: 'T2', start: '2024-02-01', end: '2024-04-30', progress: 75, milestone: 'M1', tag: '#Veda-Science', isRequired: true },
  { id: '3', name: 'Task 3', code: 'T3', start: '2024-03-01', end: '2024-05-31', progress: 25, milestone: 'M2', tag: '#Ops-Sales', isRequired: false },
]

describe('GanttChart', () => {
  it('should render task bars for given tasks', () => {
    render(<GanttChart tasks={mockTasks} />)
    expect(screen.getByText('Task 1')).toBeDefined()
    expect(screen.getByText('Task 2')).toBeDefined()
    expect(screen.getByText('Task 3')).toBeDefined()
  })

  it('should render milestone headers', () => {
    render(<GanttChart tasks={mockTasks} />)
    expect(screen.getByText('M1')).toBeDefined()
    expect(screen.getByText('M2')).toBeDefined()
  })

  it('should render legend items', () => {
    render(<GanttChart tasks={mockTasks} />)
    expect(screen.getByText('#Mori-Infra')).toBeDefined()
    expect(screen.getByText('#Veda-Science')).toBeDefined()
    expect(screen.getByText('#Ops-Sales')).toBeDefined()
    expect(screen.getByText('Other')).toBeDefined()
  })

  it('should show empty state when no tasks provided', () => {
    render(<GanttChart tasks={[]} />)
    expect(screen.getByText(/No tasks with dates found/)).toBeDefined()
  })

  it('should render task codes in labels', () => {
    render(<GanttChart tasks={mockTasks} />)
    expect(screen.getByText('T1')).toBeDefined()
    expect(screen.getByText('T2')).toBeDefined()
    expect(screen.getByText('T3')).toBeDefined()
  })

  it('should accept onTaskClick and onTaskUpdate props without errors', () => {
    const handleTaskClick = vi.fn()
    const handleTaskUpdate = vi.fn()
    render(<GanttChart tasks={mockTasks} onTaskClick={handleTaskClick} onTaskUpdate={handleTaskUpdate} />)
    expect(screen.getByText('Task 1')).toBeDefined()
  })

  it('should render SVG with task bars', () => {
    const { container } = render(<GanttChart tasks={mockTasks} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeDefined()
  })

  it('should show progress percentages on bars wider than 40px', () => {
    const wideTasks = [
      { id: '1', name: 'Long Task Name', code: 'T1', start: '2024-01-01', end: '2024-12-31', progress: 60, milestone: 'M1', tag: null, isRequired: false },
    ]
    render(<GanttChart tasks={wideTasks} />)
    expect(screen.getByText('60%')).toBeDefined()
  })

  it('should handle tasks with no tag as "Other"', () => {
    const tasksNoTag = [
      { id: '1', name: 'No Tag Task', code: 'T1', start: '2024-01-01', end: '2024-02-01', progress: 0, milestone: 'M1', tag: null, isRequired: false },
    ]
    render(<GanttChart tasks={tasksNoTag} />)
    expect(screen.getByText('Other')).toBeDefined()
  })

  const dragBar = async (container: HTMLElement, dx: number) => {
    const bar = container.querySelector('rect.cursor-move') as SVGRectElement
    // Each step needs its own act() flush so the mousedown's `dragState` update
    // commits (and the effect attaches the window mousemove/mouseup listeners)
    // before the next event fires — mirrors real drags, where the mouse
    // physically moves well after the button-down render commits.
    await act(async () => {
      fireEvent.mouseDown(bar, { clientX: 100 })
    })
    await act(async () => {
      fireEvent.mouseMove(window, { clientX: 100 + dx })
    })
    await act(async () => {
      fireEvent.mouseUp(window, { clientX: 100 + dx })
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('keeps the dragged bar position after a successful onTaskUpdate', async () => {
    const onTaskUpdate = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<GanttChart tasks={mockTasks} onTaskUpdate={onTaskUpdate} />)

    const barBefore = container.querySelector('rect.cursor-move') as SVGRectElement
    const xBefore = barBefore.getAttribute('x')

    await dragBar(container, 60)

    expect(onTaskUpdate).toHaveBeenCalled()
    const barAfter = container.querySelector('rect.cursor-move') as SVGRectElement
    expect(barAfter.getAttribute('x')).not.toBe(xBefore)
  })

  it('reverts the bar position when onTaskUpdate rejects', async () => {
    const onTaskUpdate = vi.fn().mockRejectedValue(new Error('save failed'))
    const { container } = render(<GanttChart tasks={mockTasks} onTaskUpdate={onTaskUpdate} />)

    const barBefore = container.querySelector('rect.cursor-move') as SVGRectElement
    const xBefore = barBefore.getAttribute('x')

    await dragBar(container, 60)

    expect(onTaskUpdate).toHaveBeenCalled()
    const barAfter = container.querySelector('rect.cursor-move') as SVGRectElement
    expect(barAfter.getAttribute('x')).toBe(xBefore)
  })
})
