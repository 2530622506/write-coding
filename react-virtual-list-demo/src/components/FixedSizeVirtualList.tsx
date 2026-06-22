import type { ReactNode, UIEvent } from "react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"

type FixedSizeVirtualListProps<T> = {
  items: T[]
  itemHeight: number
  height: number
  overscan?: number
  className?: string
  getItemKey: (item: T, index: number) => string | number
  renderItem: (item: T, index: number) => ReactNode
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function FixedSizeVirtualListInner<T>({
  items,
  itemHeight,
  height,
  overscan = 4,
  className,
  getItemKey,
  renderItem,
}: FixedSizeVirtualListProps<T>) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const pendingScrollTopRef = useRef(0)
  const [scrollTop, setScrollTop] = useState(0)

  const totalHeight = items.length * itemHeight
  const visibleCount = Math.ceil(height / itemHeight)
  const startIndex = clamp(
    Math.floor(scrollTop / itemHeight) - overscan,
    0,
    items.length
  )
  const endIndex = clamp(
    startIndex + visibleCount + overscan * 2,
    startIndex,
    items.length
  )
  const offsetY = startIndex * itemHeight

  const visibleItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [items, startIndex, endIndex]
  )

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    pendingScrollTopRef.current = event.currentTarget.scrollTop

    if (animationFrameRef.current !== null) {
      return
    }

    // Scroll events can fire faster than React can commit. Keep one state update per frame.
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null
      const nextScrollTop = pendingScrollTopRef.current

      setScrollTop(currentScrollTop =>
        currentScrollTop === nextScrollTop ? currentScrollTop : nextScrollTop
      )
    })
  }, [])

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  return (
    <div
      ref={viewportRef}
      className={className}
      style={{ height }}
      role="list"
      aria-label="虚拟滚动内容列表"
      tabIndex={0}
      onScroll={handleScroll}
    >
      <div className="virtual-list__spacer" style={{ height: totalHeight }}>
        <div
          className="virtual-list__window"
          style={{ transform: `translateY(${offsetY}px)` }}
        >
          {visibleItems.map((item, offset) => {
            const index = startIndex + offset

            return (
              <div
                className="virtual-list__row"
                key={getItemKey(item, index)}
                style={{ height: itemHeight }}
                role="listitem"
                aria-posinset={index + 1}
                aria-setsize={items.length}
              >
                {renderItem(item, index)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export const FixedSizeVirtualList = memo(
  FixedSizeVirtualListInner
) as typeof FixedSizeVirtualListInner
