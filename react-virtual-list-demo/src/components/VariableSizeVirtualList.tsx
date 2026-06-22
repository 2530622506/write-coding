import type { ReactNode, UIEvent } from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

type VariableSizeVirtualListProps<T> = {
  items: T[];
  estimatedItemHeight: number;
  height: number;
  overscan?: number;
  className?: string;
  getItemKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
};

type MeasuredRowProps<T> = {
  item: T;
  index: number;
  itemKey: string | number;
  totalSize: number;
  top: number;
  renderItem: (item: T, index: number) => ReactNode;
  onSizeChange: (itemKey: string | number, height: number) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// 在 offsets 前缀和里二分查找 scrollTop 落在哪一行，避免从头线性扫描。
function findStartIndex(offsets: number[], scrollTop: number) {
  let low = 0;
  let high = offsets.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);

    if (offsets[mid] <= scrollTop) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return clamp(low, 0, Math.max(offsets.length - 2, 0));
}

// 每一行渲染后用 ResizeObserver 实测高度，并把测量结果回写给父列表。
function MeasuredRow<T>({ item, index, itemKey, totalSize, top, renderItem, onSizeChange }: MeasuredRowProps<T>) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;

    if (!row) {
      return undefined;
    }

    const reportSize = () => {
      onSizeChange(itemKey, row.getBoundingClientRect().height);
    };

    // 首次挂载立即上报一次，避免必须等 ResizeObserver 回调才修正高度。
    reportSize();

    const observer = new ResizeObserver(reportSize);
    observer.observe(row);

    return () => observer.disconnect();
  }, [itemKey, onSizeChange]);

  return (
    <div
      ref={rowRef}
      className="variable-list__row"
      style={{ transform: `translateY(${top}px)` }}
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={totalSize}
    >
      {renderItem(item, index)}
    </div>
  );
}

// 不定高虚拟列表：先用 estimatedItemHeight 估算，再用真实测量高度逐步修正 offsets。
function VariableSizeVirtualListInner<T>({
  items,
  estimatedItemHeight,
  height,
  overscan = 4,
  className,
  getItemKey,
  renderItem,
}: VariableSizeVirtualListProps<T>) {
  const measuredHeightsRef = useRef(new Map<string | number, number>());
  const animationFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [measurementVersion, setMeasurementVersion] = useState(0);

  // offsets[index] 表示第 index 行顶部距离列表顶部的累计高度。
  const offsets = useMemo(() => {
    const nextOffsets = new Array<number>(items.length + 1);
    nextOffsets[0] = 0;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const itemKey = getItemKey(item, index);
      const measuredHeight = measuredHeightsRef.current.get(itemKey);
      // 未测量过的行先使用预估高度，测量完成后再用真实高度替换。
      nextOffsets[index + 1] = nextOffsets[index] + (measuredHeight ?? estimatedItemHeight);
    }

    return nextOffsets;
  }, [estimatedItemHeight, getItemKey, items, measurementVersion]);

  const totalHeight = offsets[items.length] ?? 0;
  const baseStartIndex = findStartIndex(offsets, scrollTop);
  const startIndex = clamp(baseStartIndex - overscan, 0, items.length);
  let baseEndIndex = baseStartIndex;
  const viewportBottom = scrollTop + height;

  // 不定高无法用 visibleCount 直接算终点，需要一直推进到超过视口底部。
  while (baseEndIndex < items.length && offsets[baseEndIndex] < viewportBottom) {
    baseEndIndex += 1;
  }

  const endIndex = clamp(baseEndIndex + overscan, startIndex, items.length);
  const visibleItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [endIndex, items, startIndex],
  );

  const handleSizeChange = useCallback((itemKey: string | number, measuredHeight: number) => {
    if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) {
      return;
    }

    const roundedHeight = Math.ceil(measuredHeight);
    const previousHeight = measuredHeightsRef.current.get(itemKey);

    // 高度没有实际变化时不触发版本更新，避免 ResizeObserver 造成重复渲染。
    if (previousHeight !== undefined && Math.abs(previousHeight - roundedHeight) < 1) {
      return;
    }

    measuredHeightsRef.current.set(itemKey, roundedHeight);
    // Map 写入不会触发 React 更新，用版本号驱动 offsets 重新计算。
    setMeasurementVersion((version) => version + 1);
  }, []);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    pendingScrollTopRef.current = event.currentTarget.scrollTop;

    if (animationFrameRef.current !== null) {
      return;
    }

    // 与定高列表一致，scroll 高频更新通过 rAF 合帧。
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const nextScrollTop = pendingScrollTopRef.current;

      setScrollTop((currentScrollTop) =>
        currentScrollTop === nextScrollTop ? currentScrollTop : nextScrollTop,
      );
    });
  }, []);

  useEffect(() => {
    // 数据源变化后，旧的高度缓存可能不再对应当前行，必须清空重新测量。
    measuredHeightsRef.current.clear();
    pendingScrollTopRef.current = 0;
    setScrollTop(0);
    setMeasurementVersion((version) => version + 1);
  }, [items]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, []);

  return (
    <div
      className={className}
      style={{ height }}
      role="list"
      aria-label="不定高虚拟滚动内容列表"
      tabIndex={0}
      onScroll={handleScroll}
    >
      <div className="variable-list__spacer" style={{ height: totalHeight }}>
        {visibleItems.map((item, offset) => {
          const index = startIndex + offset;
          const itemKey = getItemKey(item, index);

          return (
            <MeasuredRow
              item={item}
              index={index}
              itemKey={itemKey}
              totalSize={items.length}
              key={itemKey}
              top={offsets[index]}
              renderItem={renderItem}
              onSizeChange={handleSizeChange}
            />
          );
        })}
      </div>
    </div>
  );
}

export const VariableSizeVirtualList = memo(VariableSizeVirtualListInner) as typeof VariableSizeVirtualListInner;
