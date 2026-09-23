"use client"

/**
 * SidebarBoxes — "dynamic boxes" del sidebar del geovisor.
 *
 * 2026-09-20 — handoff §3.4/§3.9. Las listas **Parcelas** y **Fumigaciones**
 * coexisten en la barra lateral, se pueden prender/apagar y reordenar por
 * drag. El orden + visibilidad se persisten en `localStorage`.
 *
 * Por qué `@dnd-kit` (aprobado por el usuario): es accesible (sensores de
 * puntero + teclado), mide y transforma sin reflow manual, y no depende de
 * la API nativa de drag (inconsistente entre browsers para listas).
 *
 * El componente es genérico: recibe definiciones `{ id, title, badge,
 * content }` y se encarga del orden/visibilidad/persistencia. El geovisor
 * inyecta las listas reales.
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Eye, EyeOff, GripVertical, X } from "lucide-react"
import { useEffect, useId, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface SidebarBox {
  id: string
  title: string
  badge?: ReactNode
  content: ReactNode
}

interface PersistedState {
  order?: string[]
  hidden?: string[]
}

function loadState(storageKey: string, allIds: string[]): PersistedState {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as PersistedState
    const order = Array.isArray(parsed.order)
      ? [
          ...parsed.order.filter((id) => allIds.includes(id)),
          ...allIds.filter((id) => !parsed.order!.includes(id)),
        ]
      : undefined
    const hidden = Array.isArray(parsed.hidden)
      ? parsed.hidden.filter((id) => allIds.includes(id))
      : undefined
    return { order, hidden }
  } catch {
    return {}
  }
}

export function SidebarBoxes({
  boxes,
  storageKey,
}: {
  boxes: SidebarBox[]
  storageKey: string
}) {
  const allIds = boxes.map((b) => b.id)
  // `useId` es estable entre SSR y cliente; evita el mismatch de
  // `DndDescribedBy-*` que @dnd-kit genera con un contador de módulo.
  const dndContextId = useId()
  const [order, setOrder] = useState<string[]>(allIds)
  const [hidden, setHidden] = useState<string[]>([])

  // Hidratar desde localStorage (solo cliente; evita mismatch de SSR).
  useEffect(() => {
    const { order: persistedOrder, hidden: persistedHidden } = loadState(
      storageKey,
      allIds
    )
    if (persistedOrder) setOrder(persistedOrder)
    if (persistedHidden) setHidden(persistedHidden)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  // Persistir order + hidden en cada cambio.
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ order, hidden }))
    } catch {
      /* localStorage lleno o deshabilitado: no rompemos la UI */
    }
  }, [order, hidden, storageKey])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrder((ids) => {
      const from = ids.indexOf(String(active.id))
      const to = ids.indexOf(String(over.id))
      if (from < 0 || to < 0) return ids
      return arrayMove(ids, from, to)
    })
  }

  const visibleIds = order.filter((id) => !hidden.includes(id))

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="geovisor-sidebar-boxes">
      {/* Chips de visibilidad (prenden/apagan cajas) */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        {allIds.map((id) => {
          const box = boxes.find((b) => b.id === id)
          if (!box) return null
          const isHidden = hidden.includes(id)
          return (
            <button
              key={id}
              type="button"
              onClick={() =>
                setHidden((h) =>
                  isHidden ? h.filter((x) => x !== id) : [...h, id]
                )
              }
              aria-pressed={!isHidden}
              data-testid={`sidebar-toggle-${id}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                isHidden
                  ? "border-border text-muted-foreground hover:bg-muted"
                  : "border-primary/40 bg-primary/10 text-primary"
              )}
            >
              {isHidden ? (
                <EyeOff className="size-3" aria-hidden />
              ) : (
                <Eye className="size-3" aria-hidden />
              )}
              {box.title}
            </button>
          )
        })}
      </div>

      <DndContext
        id={dndContextId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {visibleIds.map((id) => {
              const box = boxes.find((b) => b.id === id)
              if (!box) return null
              return (
                <SortableBox
                  key={id}
                  id={id}
                  title={box.title}
                  badge={box.badge}
                  onHide={() => setHidden((h) => (h.includes(id) ? h : [...h, id]))}
                >
                  {box.content}
                </SortableBox>
              )
            })}
            {visibleIds.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">
                Todas las listas están ocultas. Prendé alguna con los chips de
                arriba.
              </p>
            ) : null}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableBox({
  id,
  title,
  badge,
  onHide,
  children,
}: {
  id: string
  title: string
  badge?: ReactNode
  onHide: () => void
  children: ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`sidebar-box-${id}`}
      className={cn(
        "flex min-h-0 flex-1 flex-col border-b border-border last:border-b-0",
        isDragging && "relative z-10 bg-card opacity-90 shadow-md"
      )}
    >
      <div className="flex items-center gap-1.5 px-3 py-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Mover ${title}`}
          data-testid={`sidebar-drag-${id}`}
          className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <h3 className="text-sm font-bold tracking-tight">{title}</h3>
        {badge ? <span className="ml-1">{badge}</span> : null}
        <button
          type="button"
          onClick={onHide}
          aria-label={`Ocultar ${title}`}
          data-testid={`sidebar-hide-${id}`}
          className="ml-auto flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  )
}
