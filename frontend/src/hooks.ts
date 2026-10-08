import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export function useDebounced<T>(value: T, ms = 150): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable (private mode) - preference just won't persist */
  }
}

export type ThemePref = 'system' | 'light' | 'dark'

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [theme, setTheme] = useState<ThemePref>(() => (readStorage('theme') as ThemePref) || 'system')
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    writeStorage('theme', theme === 'system' ? null : theme)
  }, [theme])
  return [theme, setTheme]
}

/** Resolved CSS custom properties, so SVG charts follow the active theme. */
export function useCssVars(names: string[]): Record<string, string> {
  const read = () => {
    const style = getComputedStyle(document.documentElement)
    return Object.fromEntries(names.map((n) => [n, style.getPropertyValue(n).trim()]))
  }
  const [vars, setVars] = useState(read)
  useEffect(() => {
    const update = () => setVars(read())
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', update)
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      media.removeEventListener('change', update)
      observer.disconnect()
    }
  }, [])
  return vars
}

export const useProfile = () => useQuery({ queryKey: ['profile'], queryFn: api.profile })

export const useStatus = () =>
  useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: (q) => (q.state.data?.importing || q.state.data?.datasets.some((d) => d.status !== 'done' && d.status !== 'error') ? 1500 : false),
  })
