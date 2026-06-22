import type { MouseEvent, UIEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedItem } from '../data/products';

type CanvasStats = {
  renderedRows: number;
  drawMs: number;
  scrollTop: number;
  domNodes: number;
  lastAction: string;
};

type HitArea = {
  itemId: number;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type CanvasVirtualListProps = {
  items: FeedItem[];
  itemHeight: number;
  height: number;
  overscan?: number;
};

const statusColorMap: Record<FeedItem['status'], { color: string; background: string }> = {
  热销: { color: '#047857', background: '#dcfce7' },
  新品: { color: '#2563eb', background: '#dbeafe' },
  补货中: { color: '#b45309', background: '#fef3c7' },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// Canvas 没有 CSS border-radius，这里手动画圆角矩形路径。
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

// 绘制标签/状态胶囊，并返回实际宽度，方便后续标签横向排列。
function drawPill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, background: string) {
  ctx.font = '700 12px Inter, system-ui, sans-serif';
  const width = Math.ceil(ctx.measureText(text).width) + 16;

  ctx.fillStyle = background;
  roundedRect(ctx, x, y, width, 22, 11);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, x + 8, y + 15);

  return width;
}

// Canvas 文本不会自动省略，这里用二分查找找到能放进 maxWidth 的最长文本。
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  let left = 0;
  let right = text.length;

  while (left < right) {
    const mid = Math.ceil((left + right) / 2);
    const candidate = `${text.slice(0, mid)}...`;

    if (ctx.measureText(candidate).width <= maxWidth) {
      left = mid;
    } else {
      right = mid - 1;
    }
  }

  return `${text.slice(0, left)}...`;
}

// Canvas 虚拟列表：滚动区只有 canvas 和撑高元素，当前可视行全部由绘制完成。
export function CanvasVirtualList({ items, itemHeight, height, overscan = 4 }: CanvasVirtualListProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const hitAreasRef = useRef<HitArea[]>([]);
  const scrollTopRef = useRef(0);
  const widthRef = useRef(0);
  const [stats, setStats] = useState<CanvasStats>({
    renderedRows: 0,
    drawMs: 0,
    scrollTop: 0,
    domNodes: 0,
    lastAction: '暂无',
  });

  const totalHeight = items.length * itemHeight;

  // 预加载可视区附近图片，图片完成后触发一次重绘，把占位块替换成真实图片。
  const preloadImages = useCallback(
    (startIndex: number, endIndex: number) => {
      for (let index = startIndex; index < endIndex; index += 1) {
        const item = items[index];

        if (!item || imageCacheRef.current.has(item.imageUrl)) {
          continue;
        }

        const image = new Image();
        image.decoding = 'async';
        image.src = item.imageUrl;
        image.onload = () => {
          if (frameRef.current === null) {
            frameRef.current = window.requestAnimationFrame(draw);
          }
        };
        imageCacheRef.current.set(item.imageUrl, image);
      }
    },
    [items],
  );

  const draw = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const scroller = scrollerRef.current;
    const ctx = canvas?.getContext('2d');

    if (!canvas || !scroller || !ctx) {
      return;
    }

    const startedAt = performance.now();
    // 按 DPR 放大实际画布像素，避免高清屏上文字和图片发虚。
    const dpr = window.devicePixelRatio || 1;
    const width = widthRef.current || scroller.clientWidth;
    const scrollTop = scrollTopRef.current;
    const visibleCount = Math.ceil(height / itemHeight);
    // Canvas 定高版本仍然用固定行高公式定位可视范围。
    const startIndex = clamp(Math.floor(scrollTop / itemHeight) - overscan, 0, items.length);
    const endIndex = clamp(startIndex + visibleCount + overscan * 2, startIndex, items.length);
    const nextHitAreas: HitArea[] = [];

    // 容器尺寸变化时同步更新 canvas 像素尺寸和 CSS 尺寸。
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    // setTransform 会把后续绘制坐标重新映射到 CSS 像素空间。
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    preloadImages(startIndex, endIndex + 6);

    // 每一帧只遍历并绘制可视窗口附近的商品行。
    for (let index = startIndex; index < endIndex; index += 1) {
      const item = items[index];
      const rowY = index * itemHeight - scrollTop;

      if (!item || rowY > height || rowY + itemHeight < 0) {
        continue;
      }

      ctx.fillStyle = index % 2 === 0 ? '#ffffff' : '#fbfdff';
      ctx.fillRect(0, rowY, width, itemHeight);
      ctx.strokeStyle = '#d8e0ea';
      ctx.beginPath();
      ctx.moveTo(0, rowY + itemHeight - 0.5);
      ctx.lineTo(width, rowY + itemHeight - 0.5);
      ctx.stroke();

      const image = imageCacheRef.current.get(item.imageUrl);
      roundedRect(ctx, 18, rowY + 22, 64, 48, 8);
      ctx.fillStyle = '#eef2f7';
      ctx.fill();
      if (image?.complete && image.naturalWidth > 0) {
        ctx.save();
        // 通过 clip 实现圆角图片；进一步优化可缓存到离屏 canvas。
        roundedRect(ctx, 18, rowY + 22, 64, 48, 8);
        ctx.clip();
        ctx.drawImage(image, 18, rowY + 22, 64, 48);
        ctx.restore();
      }

      const contentX = 98;
      const actionsWidth = width > 920 ? 202 : 0;
      const metaWidth = width > 920 ? 150 : width > 640 ? 124 : 0;
      const contentWidth = Math.max(120, width - contentX - metaWidth - actionsWidth - 52);
      const statusStyle = statusColorMap[item.status];

      ctx.font = '750 15px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(ellipsize(ctx, item.title, contentWidth - 76), contentX, rowY + 27);
      drawPill(ctx, item.status, Math.min(contentX + ctx.measureText(ellipsize(ctx, item.title, contentWidth - 76)).width + 12, contentX + contentWidth - 62), rowY + 12, statusStyle.color, statusStyle.background);

      ctx.font = '13px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#526174';
      ctx.fillText(ellipsize(ctx, item.summary, contentWidth), contentX, rowY + 49);

      let tagX = contentX;
      item.tags.slice(0, width > 640 ? 4 : 2).forEach((tag) => {
        const tagWidth = drawPill(ctx, tag, tagX, rowY + 58, '#36506f', '#edf3fb');
        tagX += tagWidth + 6;
      });

      if (metaWidth > 0) {
        const metaX = width - actionsWidth - metaWidth - 28;
        ctx.font = '800 15px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#b42318';
        ctx.fillText(item.price, metaX, rowY + 30);
        ctx.font = '700 14px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#1e293b';
        ctx.fillText(ellipsize(ctx, item.owner, metaWidth - 8), metaX, rowY + 50);
        ctx.font = '13px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText(item.updatedAt, metaX, rowY + 69);
      }

      if (actionsWidth > 0) {
        const actions = ['加购', '评价', '收藏', '更多'];
        const actionY = rowY + 24;
        let actionX = width - 18 - 202;
        actions.forEach((label) => {
          roundedRect(ctx, actionX, actionY, 44, 44, 8);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = '#d8e0ea';
          ctx.stroke();
          ctx.font = '700 12px Inter, system-ui, sans-serif';
          ctx.fillStyle = '#1e293b';
          ctx.fillText(label, actionX + 10, actionY + 27);
          // Canvas 按钮只是像素，必须手动记录命中区域才能响应点击。
          nextHitAreas.push({ itemId: item.id, label, x: actionX, y: actionY, width: 44, height: 44 });
          actionX += 50;
        });
      }
    }

    hitAreasRef.current = nextHitAreas;
    const drawMs = performance.now() - startedAt;

    // 统计面板用于观察绘制成本；生产环境可节流，避免 React 状态更新干扰滚动。
    setStats((current) => ({
      ...current,
      renderedRows: endIndex - startIndex,
      drawMs,
      scrollTop,
      domNodes: scroller.querySelectorAll('*').length,
    }));
  }, [height, itemHeight, items, overscan, preloadImages]);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) {
      return;
    }

    // 多次滚动/图片加载/尺寸变化只排队一帧，避免重复绘制。
    frameRef.current = window.requestAnimationFrame(draw);
  }, [draw]);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      scrollTopRef.current = event.currentTarget.scrollTop;
      scheduleDraw();
    },
    [scheduleDraw],
  );

  useEffect(() => {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      // 监听滚动容器宽度变化，重新计算响应式布局和 canvas 尺寸。
      widthRef.current = Math.floor(entry.contentRect.width);
      scheduleDraw();
    });

    widthRef.current = scroller.clientWidth;
    resizeObserver.observe(scroller);
    scheduleDraw();

    return () => {
      resizeObserver.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [scheduleDraw]);

  useEffect(() => {
    // 数据变化时回到顶部，避免新列表仍停留在旧 scrollTop。
    scrollTopRef.current = 0;
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = 0;
    }
    scheduleDraw();
  }, [items, scheduleDraw]);

  const handleClick = useCallback((event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // 将鼠标坐标和上一帧记录的按钮区域做命中检测。
    const hitArea = hitAreasRef.current.find(
      (area) => x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height,
    );

    if (!hitArea) {
      return;
    }

    setStats((current) => ({
      ...current,
      lastAction: `${hitArea.label} #${hitArea.itemId}`,
    }));
  }, []);

  const handleMouseMove = useCallback((event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // Canvas 没有原生 hover 状态，这里根据命中区域手动切换鼠标样式。
    const isHoveringAction = hitAreasRef.current.some(
      (area) => x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height,
    );

    event.currentTarget.style.cursor = isHoveringAction ? 'pointer' : 'default';
  }, []);

  const readableStats = useMemo(
    () => ({
      drawMs: stats.drawMs.toFixed(2),
      scrollTop: Math.round(stats.scrollTop).toLocaleString(),
      domNodes: stats.domNodes.toLocaleString(),
    }),
    [stats],
  );

  return (
    <div className="canvas-demo-grid">
      <div className="canvas-list-shell">
        <div className="canvas-list-header">
          <span>Canvas 绘制商品</span>
          <span>价格 / 店铺</span>
          <span>模拟操作</span>
        </div>
        <div
          ref={scrollerRef}
          className="canvas-list"
          style={{ height }}
          onScroll={handleScroll}
          role="img"
          aria-label={`Canvas 虚拟商品列表，共 ${items.length} 条数据。Canvas 版本主要用于性能对比，完整可访问交互请参考 DOM 版本。`}
        >
          <div className="canvas-list__spacer" style={{ height: totalHeight }}>
            <canvas
              ref={canvasRef}
              className="canvas-list__canvas"
              onClick={handleClick}
              onMouseMove={handleMouseMove}
            />
          </div>
        </div>
      </div>

      <aside className="canvas-stats" aria-label="Canvas 性能指标">
        <div>
          <span>{items.length.toLocaleString()}</span>
          <p>总数据</p>
        </div>
        <div>
          <span>{stats.renderedRows}</span>
          <p>本帧绘制行数</p>
        </div>
        <div>
          <span>{readableStats.drawMs}ms</span>
          <p>最近一次绘制耗时</p>
        </div>
        <div>
          <span>{readableStats.domNodes}</span>
          <p>滚动区 DOM 节点</p>
        </div>
        <div>
          <span>{readableStats.scrollTop}px</span>
          <p>当前 scrollTop</p>
        </div>
        <div>
          <span>{stats.lastAction}</span>
          <p>最近点击</p>
        </div>
      </aside>
    </div>
  );
}
