import { Archive, CheckCircle2, ExternalLink, MessageSquare, MoreHorizontal, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CanvasVirtualList } from './components/CanvasVirtualList';
import { FixedSizeVirtualList } from './components/FixedSizeVirtualList';
import { VariableSizeVirtualList } from './components/VariableSizeVirtualList';
import { fetchProductList, filterItems } from './data/products';
import type { FeedItem } from './data/products';

const statusClassName: Record<FeedItem['status'], string> = {
  补货中: 'status status--pending',
  热销: 'status status--done',
  新品: 'status status--active',
};

const variableExtraTags = ['跨店满减', '次日达', '7 天无理由', '会员折扣', '门店自提', '企业采购'];

function getVariableDetails(item: FeedItem, index: number) {
  const detailCount = (index % 4) + 1;
  const details = [
    `${item.owner} 已完成多轮质检，当前批次支持售后换新和发票服务。`,
    '适合放在不定高虚拟滚动里验证动态测量：文本越长，行高越高，后续 offsets 会跟随实测高度更新。',
    '促销信息会根据用户所在区域和库存状态变化，因此真实业务里每一行高度经常无法提前确定。',
    '这类场景不能只依赖固定行高公式，需要使用预估高度、ResizeObserver 和前缀和来共同维护滚动位置。',
  ];

  return details.slice(0, detailCount);
}

function getVariableTags(item: FeedItem, index: number) {
  return [...item.tags, ...variableExtraTags.slice(0, index % variableExtraTags.length)];
}

function App() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const currentPath = window.location.pathname;
  const isCanvasRoute = currentPath === '/canvas';
  const isVariableRoute = currentPath === '/variable';
  const filteredItems = useMemo(() => filterItems(items, query), [items, query]);

  const loadProducts = useCallback((signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage('');

    fetchProductList({ count: 10000, delayMs: 650, signal })
      .then((response) => {
        setItems(response.items);
        setLatencyMs(response.latencyMs);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : '模拟接口请求失败');
      })
      .finally(() => {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadProducts(controller.signal);

    return () => controller.abort();
  }, [loadProducts]);

  return (
    <main className="app-shell">
      <section className="toolbar" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">
            {isCanvasRoute ? 'Canvas rendering' : isVariableRoute ? 'Variable-size virtualization' : 'Fixed-size virtualization'}
          </p>
          <h1 id="page-title">
            {isCanvasRoute ? 'Canvas 商品虚拟滚动列表' : isVariableRoute ? 'React 不定高虚拟滚动列表' : 'React 定高虚拟滚动列表'}
          </h1>
          <p className="subtitle">
            {isCanvasRoute
              ? '10,000 条商品数据绘制到一个 canvas，用于和 DOM 虚拟列表做性能对比。'
              : isVariableRoute
                ? '每一行高度由内容决定，使用预估高度、实测高度缓存和前缀和维护滚动位置。'
              : '10,000 条商品数据，只渲染可视窗口附近的节点。'}
          </p>
          <nav className="route-tabs" aria-label="示例切换">
            <a className={!isCanvasRoute && !isVariableRoute ? 'route-tabs__item route-tabs__item--active' : 'route-tabs__item'} href="/">
              定高 DOM
            </a>
            <a className={isVariableRoute ? 'route-tabs__item route-tabs__item--active' : 'route-tabs__item'} href="/variable">
              不定高 DOM
            </a>
            <a className={isCanvasRoute ? 'route-tabs__item route-tabs__item--active' : 'route-tabs__item'} href="/canvas">
              Canvas 版本
            </a>
          </nav>
        </div>
        <div className="search-box">
          <Search aria-hidden="true" size={18} />
          <label className="sr-only" htmlFor="list-search">
            搜索列表内容
          </label>
          <input
            id="list-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索商品、标签或店铺"
            disabled={isLoading || Boolean(errorMessage)}
          />
        </div>
      </section>

      <section className="metrics" aria-label="列表统计">
        <div>
          <span>{isLoading ? '加载中' : filteredItems.length.toLocaleString()}</span>
          <p>当前结果</p>
        </div>
        <div>
          <span>{latencyMs === null ? '--' : `${latencyMs}ms`}</span>
          <p>模拟接口耗时</p>
        </div>
        <div>
          <span>{isCanvasRoute ? '1' : isVariableRoute ? '实测' : '23+'}</span>
          <p>{isCanvasRoute ? '核心绘制节点' : isVariableRoute ? '动态行高' : '可见 DOM 行'}</p>
        </div>
      </section>

      {isLoading ? (
        <section className="feedback-panel" aria-live="polite" aria-label="商品数据加载中">
          <div className="loading-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h2>正在请求模拟商品接口</h2>
          <p>模拟网络延迟后返回 10,000 条商品数据。</p>
        </section>
      ) : errorMessage ? (
        <section className="feedback-panel feedback-panel--error" role="alert">
          <h2>商品数据加载失败</h2>
          <p>{errorMessage}</p>
          <button type="button" onClick={() => loadProducts()}>
            重新请求
          </button>
        </section>
      ) : isCanvasRoute ? (
        <CanvasVirtualList items={filteredItems} itemHeight={92} height={560} overscan={8} />
      ) : isVariableRoute ? (
        <section className="list-panel" aria-label="不定高虚拟列表演示">
          <div className="variable-list-header">
            <span>商品详情</span>
            <span>价格 / 店铺</span>
            <span>操作</span>
          </div>

          <VariableSizeVirtualList
            className="variable-list"
            items={filteredItems}
            estimatedItemHeight={148}
            height={560}
            overscan={6}
            getItemKey={(item) => item.id}
            renderItem={(item, index) => (
              <article className="variable-feed-row">
                <img src={item.imageUrl} alt={item.imageAlt} width="72" height="58" loading="lazy" />
                <div className="feed-main">
                  <div className="feed-title-line">
                    <h2>{item.title}</h2>
                    <span className={statusClassName[item.status]}>{item.status}</span>
                  </div>
                  <p className="variable-summary">{item.summary}</p>
                  <div className="variable-details">
                    {getVariableDetails(item, index).map((detail) => (
                      <p key={detail}>{detail}</p>
                    ))}
                  </div>
                  <div className="tags" aria-label={`${item.title} 的标签`}>
                    {getVariableTags(item, index).map((tag, tagIndex) => (
                      <span key={`${item.id}-${tag}-${tagIndex}`}>{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="feed-meta variable-feed-meta">
                  <span className="price">{item.price}</span>
                  <strong>{item.owner}</strong>
                  <span>{item.updatedAt}</span>
                </div>
                <div className="actions variable-actions" aria-label={`${item.title} 的操作`}>
                  <button type="button" aria-label={`加入 ${item.title} 到购物车`}>
                    <CheckCircle2 size={16} aria-hidden="true" />
                  </button>
                  <button type="button" aria-label={`查看 ${item.title} 的评价`}>
                    <MessageSquare size={16} aria-hidden="true" />
                  </button>
                  <button type="button" aria-label={`收藏 ${item.title}`}>
                    <Archive size={16} aria-hidden="true" />
                  </button>
                </div>
              </article>
            )}
          />
        </section>
      ) : (
        <section className="list-panel" aria-label="虚拟列表演示">
          <div className="list-header">
            <span>商品</span>
            <span>状态</span>
            <span>负责人</span>
            <span>操作</span>
          </div>

          <FixedSizeVirtualList
            className="virtual-list"
            items={filteredItems}
            itemHeight={92}
            height={560}
            overscan={8}
            getItemKey={(item) => item.id}
            renderItem={(item) => (
              <article className="feed-row">
                <img src={item.imageUrl} alt={item.imageAlt} width="64" height="48" loading="lazy" />
                <div className="feed-main">
                  <div className="feed-title-line">
                    <h2>{item.title}</h2>
                    <span className={statusClassName[item.status]}>{item.status}</span>
                  </div>
                  <p>{item.summary}</p>
                  <div className="tags" aria-label={`${item.title} 的标签`}>
                    {item.tags.map((tag, tagIndex) => (
                      <span key={`${item.id}-${tag}-${tagIndex}`}>{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="feed-meta">
                  <span className="price">{item.price}</span>
                  <strong>{item.owner}</strong>
                  <span>{item.updatedAt}</span>
                </div>
                <div className="actions" aria-label={`${item.title} 的操作`}>
                  <button type="button" aria-label={`加入 ${item.title} 到购物车`}>
                    <CheckCircle2 size={16} aria-hidden="true" />
                  </button>
                  <button type="button" aria-label={`查看 ${item.title} 的评价`}>
                    <MessageSquare size={16} aria-hidden="true" />
                  </button>
                  <button type="button" aria-label={`收藏 ${item.title}`}>
                    <Archive size={16} aria-hidden="true" />
                  </button>
                  <button type="button" aria-label={`打开 ${item.title} 的更多操作`}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                </div>
              </article>
            )}
          />
        </section>
      )}

      <a className="doc-link" href="/docs/virtual-list-implementation.md" target="_blank" rel="noreferrer">
        <ExternalLink size={16} aria-hidden="true" />
        查看实现思路文档
      </a>
    </main>
  );
}

export default App;
