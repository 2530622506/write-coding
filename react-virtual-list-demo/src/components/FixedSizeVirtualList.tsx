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

// 定高虚拟列表：每一行高度固定，可以直接用 scrollTop / itemHeight 推导可视区索引。
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

  // 用一个撑高元素模拟完整列表高度，让浏览器原生滚动条保持真实比例。
  const totalHeight = items.length * itemHeight
  const visibleCount = Math.ceil(height / itemHeight)
  // overscan 会额外渲染可视区上下的缓冲行，降低快速滚动时看到空白的概率。
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
  // 可见窗口整体下移到 startIndex 对应的位置，避免为前面的数据创建 DOM。
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

    // scroll 触发频率可能高于 React 提交频率，这里用 rAF 保证每帧最多更新一次 state。
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
        // 组件卸载时取消未执行的滚动帧，避免卸载后继续 setState。
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
