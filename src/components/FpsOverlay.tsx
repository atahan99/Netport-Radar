import { useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'netport-fps'

const envEnabled = () => import.meta.env.DEV && import.meta.env.VITE_FPS === '1'

const readStored = () => {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(STORAGE_KEY) === '1'
}

export default function FpsOverlay() {
  const [visible, setVisible] = useState(() => envEnabled() || readStored())
  const [fps, setFps] = useState(0)
  const frames = useRef(0)
  const last = useRef(0)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.shiftKey && (e.key === 'f' || e.key === 'F'))) return // Shift+F; plain F opens Filters
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      setVisible((v) => {
        const next = !v
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
        return next
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!visible) return
    last.current = performance.now()
    frames.current = 0
    let raf = 0
    const tick = (now: number) => {
      frames.current++
      const dt = now - last.current
      if (dt >= 500) {
        setFps(Math.round((frames.current * 1000) / dt))
        frames.current = 0
        last.current = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [visible])

  if (!import.meta.env.DEV || !visible) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed bottom-2 left-1/2 z-[70] -translate-x-1/2 rounded-md border border-zinc-700 bg-black/80 px-2 py-0.5 font-mono text-[10px] text-emerald-400 backdrop-blur-sm"
    >
      {fps} FPS · F toggle
    </div>
  )
}
