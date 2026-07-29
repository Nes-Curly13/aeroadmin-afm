import { NOW } from "@/lib/data"
import { fmtDateTime } from "@/lib/format"

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: React.ReactNode
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-border bg-card px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-extrabold tracking-tight text-balance sm:text-2xl">{title}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty">{description}</p>
      </div>
      <div className="flex items-center gap-3">
        {actions}
        <p className="font-mono text-[11px] text-muted-foreground">{`Datos al ${fmtDateTime(NOW.toISOString())}`}</p>
      </div>
    </header>
  )
}
