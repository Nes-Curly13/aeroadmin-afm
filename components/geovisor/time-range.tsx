"use client"

import { Pause, Play, RotateCcw } from "lucide-react"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

export interface MonthOption {
  key: string
  label: string
  start: number
  end: number
}

interface TimeRangeProps {
  months: MonthOption[]
  range: [number, number]
  onRangeChange: (r: [number, number]) => void
  playing: boolean
  onPlayingChange: (p: boolean) => void
  eventsPerMonth: number[]
}

export function TimeRange({
  months,
  range,
  onRangeChange,
  playing,
  onPlayingChange,
  eventsPerMonth,
}: TimeRangeProps) {
  const max = months.length - 1
  const maxCount = Math.max(1, ...eventsPerMonth)

  useEffect(() => {
    if (!playing) return
    const width = range[1] - range[0]
    const id = setInterval(() => {
      const nextEnd = range[1] + 1
      if (nextEnd > max) {
        onPlayingChange(false)
        return
      }
      onRangeChange([Math.max(0, nextEnd - width), nextEnd])
    }, 850)
    return () => clearInterval(id)
  }, [playing, range, max, onRangeChange, onPlayingChange])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Ventana temporal
          </span>
          <span className="font-mono text-sm font-semibold">
            {months[range[0]]?.label} — {months[range[1]]?.label}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant={playing ? "default" : "outline"}
            onClick={() => onPlayingChange(!playing)}
            aria-label={playing ? "Pausar animación temporal" : "Reproducir animación temporal"}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => {
              onPlayingChange(false)
              onRangeChange([0, max])
            }}
            aria-label="Restablecer al histórico completo"
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </div>

      {/* Histograma de actividad por mes */}
      <div className="flex h-12 items-end gap-[3px]" aria-hidden>
        {eventsPerMonth.map((count, i) => {
          const inRange = i >= range[0] && i <= range[1]
          return (
            <div
              key={months[i].key}
              className={`flex-1 rounded-t-[2px] transition-colors ${inRange ? "bg-primary" : "bg-muted"}`}
              style={{ height: `${Math.max(6, (count / maxCount) * 100)}%` }}
              title={`${months[i].label}: ${count} aplicaciones`}
            />
          )
        })}
      </div>

      <Slider
        value={range}
        min={0}
        max={max}
        step={1}
        onValueChange={(v) => {
          onPlayingChange(false)
          const arr = Array.isArray(v) ? v : [v, v]
          onRangeChange([arr[0], arr[1] ?? arr[0]] as [number, number])
        }}
        aria-label="Rango de meses"
      />
    </div>
  )
}
