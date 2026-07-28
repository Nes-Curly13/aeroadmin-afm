import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface FieldSelectProps extends React.ComponentProps<"select"> {
  label: string
}

/** Select nativo con estilos del tema: liviano y accesible para filtros densos. */
export function FieldSelect({ label, className, id, children, ...props }: FieldSelectProps) {
  const selectId = id ?? `field-${label.toLowerCase().replace(/\s+/g, "-")}`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          className={cn(
            "h-9 w-full appearance-none rounded-md border border-input bg-card pl-2.5 pr-8 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      </div>
    </div>
  )
}
