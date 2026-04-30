import { useState, useRef, useEffect } from 'react'
import { Mic, Square, Play, ChevronDown, ChevronUp, Send, Save } from 'lucide-react'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

// Stav aplikace: idle | recording | paused | ended
const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function SegmentCard({ segment, index }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-[#141414] border border-[#262626] rounded-2xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#737373] uppercase tracking-wider">
            Segment {index + 1}
          </span>
          <span className="text-xs text-[#525252]">{segment.duration}</span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[#525252] hover:text-[#a3a3a3] transition-colors"
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* Sumarizace vždy viditelná */}
      <p className="text-sm text-[#d4d4d4] leading-relaxed">{segment.summary}</p>

      {/* Přepis skrytý */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-[#262626]">
          <p className="text-xs text-[#737373] uppercase tracking-wider mb-2">Přepis</p>
          <p className="text-xs text-[#a3a3a3] leading-relaxed font-mono">{segment.transcript}</p>
        </div>
      )}
    </div>
  )
}

function RecordButton({ state, onStart, onPause, onResume }) {
  const isRecording = state === 'recording'
  const isPaused = state === 'paused'

  if (state === 'idle') {
    return (
      <button
        onClick={onStart}
        className="w-28 h-28 rounded-full bg-[#ef4444] hover:bg-[#dc2626] active:scale-95 transition-all flex items-center justify-center shadow-[0_0_40px_rgba(239,68,68,0.3)]"
      >
        <Mic size={44} className="text-white" />
      </button>
    )
  }

  if (isRecording) {
    return (
      <button
        onClick={onPause}
        className="w-28 h-28 rounded-full bg-[#ef4444] hover:bg-[#dc2626] active:scale-95 transition-all flex items-center justify-center shadow-[0_0_60px_rgba(239,68,68,0.5)] animate-pulse"
      >
        <Square size={36} className="text-white fill-white" />
      </button>
    )
  }

  if (isPaused) {
    return (
      <button
        onClick={onResume}
        className="w-28 h-28 rounded-full bg-[#1a1a1a] border-2 border-[#ef4444] hover:bg-[#262626] active:scale-95 transition-all flex items-center justify-center"
      >
        <Play size={40} className="text-[#ef4444] fill-[#ef4444] ml-1" />
      </button>
    )
  }
}

export default function App() {
  const [appState, setAppState] = useState('idle') // idle | recording | paused | ended
  const [segments, setSegments] = useState([])
  const [timer, setTimer] = useState(0)
  const [sessionTimer, setSessionTimer] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [sessionSummary, setSessionSummary] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [keepAwakeStatus, setKeepAwakeStatus] = useState(null) // 'screen' | 'nosleep' | 'audio' | null

  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const timerRef = useRef(null)
  const sessionTimerRef = useRef(null)
  const segmentStartRef = useRef(0)
  const audioCtxRef = useRef(null)
  const silentNodeRef = useRef(null)
  const wakeLockRef = useRef(null)
  const noSleepRef = useRef(null)
  const noSleepLoadPromiseRef = useRef(null)

  const ensureNoSleepLoaded = async () => {
    if (window.NoSleep) return window.NoSleep
    if (!noSleepLoadPromiseRef.current) {
      noSleepLoadPromiseRef.current = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-nosleep="1"]')
        if (existing) {
          existing.addEventListener('load', () => resolve(window.NoSleep))
          existing.addEventListener('error', reject)
          return
        }

        const script = document.createElement('script')
        script.src = '/nosleep.min.js'
        script.async = true
        script.dataset.nosleep = '1'
        script.onload = () => resolve(window.NoSleep)
        script.onerror = reject
        document.head.appendChild(script)
      })
    }
    return noSleepLoadPromiseRef.current
  }

  const requestWakeLock = async () => {
    // Pozn.: iOS/Safari běžně zastaví nahrávání, pokud se zařízení zamkne.
    // Cíl je proto hlavně *zabránit* zamčení obrazovky.

    // 1) Preferuj Screen Wake Lock API (Chrome/Android, některé Safari verze)
    if (navigator.wakeLock?.request) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null
          setKeepAwakeStatus(null)
        })
        setKeepAwakeStatus('screen')
        return
      } catch {
        // Ignoruj a zkus fallback
      }
    }

    // 2) Fallback: NoSleep.js (video trick) — často funguje tam, kde audio nepomůže
    try {
      const NoSleep = await ensureNoSleepLoaded()
      if (NoSleep) {
        if (!noSleepRef.current) noSleepRef.current = new NoSleep()
        await noSleepRef.current.enable()
        setKeepAwakeStatus('nosleep')
        return
      }
    } catch {
      // Ignoruj a zkus další fallback
    }

    // 3) Fallback: tichý audio loop (některým iOS verzím pomáhá, některým ne)
    if (audioCtxRef.current) {
      setKeepAwakeStatus('audio')
      return
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(ctx.destination)
    source.start()
    audioCtxRef.current = ctx
    silentNodeRef.current = source
    setKeepAwakeStatus('audio')
  }

  const releaseWakeLock = async () => {
    try {
      await wakeLockRef.current?.release()
    } catch {
      // ignore
    }
    wakeLockRef.current = null
    try {
      noSleepRef.current?.disable()
    } catch {
      // ignore
    }
    silentNodeRef.current?.stop()
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    silentNodeRef.current = null
    setKeepAwakeStatus(null)
  }

  // Timer pro aktuální segment
  useEffect(() => {
    if (appState === 'recording') {
      timerRef.current = setInterval(() => setTimer(t => t + 1), 1000)
      sessionTimerRef.current = setInterval(() => setSessionTimer(t => t + 1), 1000)
    } else {
      clearInterval(timerRef.current)
      if (appState !== 'paused') clearInterval(sessionTimerRef.current)
    }
    return () => {
      clearInterval(timerRef.current)
      clearInterval(sessionTimerRef.current)
    }
  }, [appState])

  // Když se tab vrátí do popředí, wake lock je často potřeba získat znovu.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && appState === 'recording') {
        void requestWakeLock()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [appState])

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    mediaRecorderRef.current = mediaRecorder
    audioChunksRef.current = []

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data)
    }

    mediaRecorder.start(1000)
    setTimer(0)
    setAppState('recording')
    await requestWakeLock()

    // Vytvoř session při prvním startu
    if (!sessionId) {
      const res = await fetch(`${BACKEND_URL}/sessions`, { method: 'POST' })
      const data = await res.json()
      setSessionId(data.session_id)
    }
  }

  const pauseAndProcess = async () => {
    if (!mediaRecorderRef.current) return
    setAppState('paused')

    await releaseWakeLock()
    await new Promise((resolve) => {
      mediaRecorderRef.current.onstop = resolve
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop())
    })

    const duration = timer
    setTimer(0)
    setIsProcessing(true)

    // Odešli audio na backend
    const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
    const formData = new FormData()
    formData.append('audio', blob, 'segment.webm')
    formData.append('session_id', sessionId)

    try {
      const res = await fetch(`${BACKEND_URL}/segments`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      setSegments(prev => [...prev, {
        transcript: data.transcript,
        summary: data.summary,
        duration: formatTime(duration),
      }])
    } catch (err) {
      // Fallback pro vývoj bez backendu
      setSegments(prev => [...prev, {
        transcript: '[Backend nedostupný — simulovaný přepis]',
        summary: 'Toto je simulovaná sumarizace segmentu pro účely vývoje frontendu.',
        duration: formatTime(duration),
      }])
    }

    setIsProcessing(false)
  }

  const endSession = async () => {
    if (appState === 'recording') await pauseAndProcess()
    setAppState('ended')

    try {
      const res = await fetch(`${BACKEND_URL}/sessions/${sessionId}/summary`)
      const data = await res.json()
      setSessionSummary(data.summary)
    } catch {
      setSessionSummary('Celková sumarizace session bude dostupná po připojení backendu.')
    }
  }

  const requestMidSessionSummary = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/sessions/${sessionId}/summary`)
      const data = await res.json()
      setSessionSummary(data.summary)
    } catch {
      setSessionSummary('Sumarizace dosavadního průběhu...')
    }
  }

  const saveSession = () => {
    const lines = []
    lines.push(`# Diktafon — ${new Date().toLocaleString('cs-CZ')}`)
    lines.push(`Délka: ${formatTime(sessionTimer)} · ${segments.length} segment${segments.length !== 1 ? 'ů' : ''}`)
    lines.push('')
    if (sessionSummary) {
      lines.push('## Celkové shrnutí')
      lines.push(sessionSummary)
      lines.push('')
    }
    segments.forEach((seg, i) => {
      lines.push(`## Segment ${i + 1} (${seg.duration})`)
      lines.push('**Shrnutí:** ' + seg.summary)
      lines.push('')
      lines.push('**Přepis:** ' + seg.transcript)
      lines.push('')
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `diktafon-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sendSession = async () => {
    const lines = []
    if (sessionSummary) {
      lines.push('SHRNUTÍ:\n' + sessionSummary)
      lines.push('')
    }
    segments.forEach((seg, i) => {
      lines.push(`Segment ${i + 1} (${seg.duration}): ${seg.summary}`)
    })
    const text = lines.join('\n')
    // Na iOS použij nativní share sheet
    if (navigator.share) {
      await navigator.share({ text })
      return
    }
    // Fallback — clipboard
    try {
      await navigator.clipboard.writeText(text)
      alert('Zkopírováno do schránky!')
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      alert('Zkopírováno do schránky!')
    }
  }

  const resetSession = () => {
    setAppState('idle')
    setSegments([])
    setTimer(0)
    setSessionTimer(0)
    setSessionSummary(null)
    setSessionId(null)
  }

  return (
    <div className="min-h-dvh bg-[#0a0a0a] flex flex-col items-center">
    <div className="w-full max-w-md px-4 pb-8 flex flex-col">
      {/* Header */}
      <div className="pt-12 pb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Diktafon</h1>
        {appState !== 'idle' && (
          <p className="text-sm text-[#737373] mt-1">
            Session: {formatTime(sessionTimer)} · {segments.length} segment{segments.length !== 1 ? 'ů' : ''}
          </p>
        )}
      </div>

      {/* Recording area */}
      {appState !== 'ended' && (
        <div className="flex flex-col items-center gap-8 py-8">
          {/* Status */}
          <div className="h-6 flex items-center">
            {appState === 'recording' && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#ef4444] animate-pulse" />
                <span className="text-sm text-[#ef4444] font-medium">Nahrávám · {formatTime(timer)}</span>
                {keepAwakeStatus && (
                  <span className="text-xs text-[#525252]">
                    {keepAwakeStatus === 'screen'
                      ? 'Nezamykám obrazovku'
                      : keepAwakeStatus === 'nosleep'
                        ? 'Anti-lock (video)'
                        : 'Anti-lock (audio)'}
                  </span>
                )}
              </div>
            )}
            {appState === 'paused' && (
              <span className="text-sm text-[#737373]">Pozastaveno · pokračuj nebo ukonči session</span>
            )}
            {isProcessing && (
              <span className="text-sm text-[#a3a3a3]">Zpracovávám...</span>
            )}
          </div>

          {/* Hlavní tlačítko */}
          <RecordButton
            state={isProcessing ? 'paused' : appState}
            onStart={startRecording}
            onPause={pauseAndProcess}
            onResume={startRecording}
          />

          {/* Akce */}
          {(appState === 'recording' || appState === 'paused') && (
            <div className="flex gap-3">
              {segments.length > 0 && appState === 'paused' && (
                <button
                  onClick={requestMidSessionSummary}
                  className="px-4 py-2 text-sm rounded-xl bg-[#1a1a1a] border border-[#262626] text-[#a3a3a3] hover:text-white hover:border-[#404040] transition-all"
                >
                  Shrnutí dosud
                </button>
              )}
              <button
                onClick={endSession}
                className="px-4 py-2 text-sm rounded-xl bg-[#1a1a1a] border border-[#262626] text-[#a3a3a3] hover:text-white hover:border-[#404040] transition-all"
              >
                Ukončit session
              </button>
            </div>
          )}
        </div>
      )}

      {/* Session skončila */}
      {appState === 'ended' && (
        <div className="py-6 space-y-4">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#141414] border border-[#262626]">
              <div className="w-2 h-2 rounded-full bg-[#22c55e]" />
              <span className="text-sm text-[#a3a3a3]">Session ukončena · {formatTime(sessionTimer)}</span>
            </div>
          </div>

          {sessionSummary && (
            <div className="bg-[#141414] border border-[#262626] rounded-2xl p-4 space-y-2">
              <p className="text-xs font-medium text-[#737373] uppercase tracking-wider">Celkové shrnutí</p>
              <p className="text-sm text-[#d4d4d4] leading-relaxed">{sessionSummary}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={saveSession} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#141414] border border-[#262626] text-sm text-[#a3a3a3] hover:text-white hover:border-[#404040] transition-all">
              <Save size={16} /> Uložit
            </button>
            <button onClick={sendSession} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#141414] border border-[#262626] text-sm text-[#a3a3a3] hover:text-white hover:border-[#404040] transition-all">
              <Send size={16} /> Odeslat
            </button>
          </div>

          <button
            onClick={resetSession}
            className="w-full py-3 rounded-xl bg-[#1a1a1a] text-sm text-[#525252] hover:text-[#737373] transition-colors"
          >
            Nová session
          </button>
        </div>
      )}

      {/* Průběžná sumarizace */}
      {sessionSummary && appState !== 'ended' && (
        <div className="mb-4 bg-[#0f1a0f] border border-[#1a3a1a] rounded-2xl p-4">
          <p className="text-xs font-medium text-[#4ade80] uppercase tracking-wider mb-2">Shrnutí dosud</p>
          <p className="text-sm text-[#d4d4d4] leading-relaxed">{sessionSummary}</p>
        </div>
      )}

      {/* Segmenty */}
      {segments.length > 0 && (
        <div className="space-y-3">
          {segments.map((seg, i) => (
            <SegmentCard key={i} segment={seg} index={i} />
          ))}
        </div>
      )}
    </div>
    </div>
  )
}
