import '@testing-library/jest-dom'
import { vi, afterEach, beforeEach } from 'vitest'

beforeEach(() => {
  const store: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { Object.keys(store).forEach(k => delete store[k]) },
    get length() { return Object.keys(store).length },
    key: (index: number) => Object.keys(store)[index] ?? null,
  })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})