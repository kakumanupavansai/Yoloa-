import { useCallback, useEffect, useRef, useState } from 'react'

// Tiny data hook: const { data, loading, error, reload } = useApi(() => coursesApi.list(), [])
// Only the most recent request may update state, so a slow response for an old id/filter
// (or one arriving after unmount) can never overwrite newer data.
export function useApi(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const latest = useRef(0)
  const run = useCallback(() => {
    const ticket = ++latest.current
    setState((s) => ({ ...s, loading: true, error: null }))
    return fn().then((data) => { if (ticket === latest.current) setState({ data, loading: false, error: null }) })
      .catch((error) => { if (ticket === latest.current) setState({ data: null, loading: false, error }) })
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    run()
    return () => { latest.current += 1 }
  }, [run])
  return { ...state, reload: run }
}

export function useDebounced(value, delay = 250) {
  const [current, setCurrent] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return current
}
