import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../api'
import type { FoodDetail } from '../types'
import { Icon } from './Icon'

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats: string[] }) => BarcodeDetectorLike
  }
}

const cameraSupported = () => typeof window !== 'undefined' && !!window.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia

function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const callback = useRef(onCode)
  callback.current = onCode

  useEffect(() => {
    let stream: MediaStream | undefined
    let timer: number | undefined
    let stopped = false
    const detector = new window.BarcodeDetector!({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] })
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s
        if (!video.current || stopped) return
        video.current.srcObject = s
        void video.current.play()
        const tick = async () => {
          if (stopped || !video.current) return
          try {
            const codes = await detector.detect(video.current)
            if (codes[0]?.rawValue) {
              callback.current(codes[0].rawValue)
              return
            }
          } catch {
            /* frame not ready yet */
          }
          timer = window.setTimeout(tick, 250)
        }
        tick()
      })
      .catch((e: Error) => setError(e.message))
    return () => {
      stopped = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  if (error) return <div className="notice warn">Camera unavailable: {error}</div>
  return (
    <div className="scanner">
      <video ref={video} muted playsInline />
    </div>
  )
}

export function BarcodeLookup({ onFound }: { onFound: (food: FoodDetail) => void }) {
  const [code, setCode] = useState('')
  const [scanning, setScanning] = useState(false)
  const lookup = useMutation({ mutationFn: api.barcode, onSuccess: onFound })
  const submit = (value: string) => {
    const digits = value.replace(/\D/g, '')
    setCode(digits)
    if (digits.length >= 6) lookup.mutate(digits)
  }

  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        Look up a packaged product by its barcode. Products are fetched once from Open Food Facts (only the barcode is
        sent) and then stored locally.
      </p>
      <div className="row">
        <input
          className="input grow"
          inputMode="numeric"
          placeholder="e.g. 3017620422003"
          value={code}
          autoFocus
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit(code)}
          aria-label="Barcode"
        />
        <button className="btn primary" onClick={() => submit(code)} disabled={lookup.isPending}>
          {lookup.isPending ? <span className="spinner" /> : 'Look up'}
        </button>
        {cameraSupported() && (
          <button className="btn" onClick={() => setScanning((s) => !s)}>
            <Icon name="barcode" /> {scanning ? 'Stop' : 'Scan'}
          </button>
        )}
      </div>
      {scanning && (
        <Scanner
          onCode={(c) => {
            setScanning(false)
            submit(c)
          }}
        />
      )}
      {lookup.error && <div className="notice warn">{(lookup.error as Error).message}</div>}
    </div>
  )
}
