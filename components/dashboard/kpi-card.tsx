import { TrendingDown, TrendingUp } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface KpiCardProps {
  label: string
  value: string
  hint: string
  icon: LucideIcon
  /** variación porcentual vs periodo anterior */
  delta?: number | null
}

export function KpiCard({ label, value, hint, icon: Icon, delta }: KpiCardProps) {
  const up = (delta ?? 0) >= 0
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
          <span className="grid size-7 place-items-center rounded-md bg-secondary text-secondary-foreground">
            <Icon className="size-4" aria-hidden />
          </span>
        </div>
        <p className="tabular font-mono text-2xl font-extrabold leading-none">{value}</p>
        <div className="flex items-center gap-2">
          {delta !== null && delta !== undefined && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                up ? "bg-secondary text-secondary-foreground" : "bg-destructive/10 text-destructive",
              )}
            >
              {up ? <TrendingUp className="size-3" aria-hidden /> : <TrendingDown className="size-3" aria-hidden />}
              {`${up ? "+" : ""}${delta.toFixed(1)}%`}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        </div>
      </CardContent>
    </Card>
  )
}
