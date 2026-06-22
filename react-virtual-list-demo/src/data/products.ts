export type FeedItem = {
  id: number;
  title: string;
  summary: string;
  imageUrl: string;
  imageAlt: string;
  tags: string[];
  status: '热销' | '新品' | '补货中';
  owner: string;
  updatedAt: string;
  price: string;
};

export type ProductListResponse = {
  items: FeedItem[];
  total: number;
  latencyMs: number;
};

export type FetchProductListOptions = {
  count?: number;
  delayMs?: number;
  signal?: AbortSignal;
  shouldFail?: boolean;
};

const productCatalog = [
  {
    title: 'Auraluxe Pro 降噪耳机',
    summary: '40mm 动圈单元，主动降噪，适合通勤、会议和长时间音乐播放。',
    imageUrl:
      'https://images.unsplash.com/photo-1599669454699-248893623440?auto=format&fit=crop&w=160&h=120&q=80',
    imageAlt: '黑色无线头戴式耳机',
    tags: ['音频', '蓝牙 5.3', 'ANC'],
    price: '¥899',
  },
  {
    title: 'Orbit X1 智能运动手表',
    summary: '全天候心率监测、运动模式识别和 7 天续航，适合日常健康管理。',
    imageUrl:
      'https://images.unsplash.com/photo-1632158642496-034a48ce7a03?auto=format&fit=crop&w=160&h=120&q=80',
    imageAlt: '黑色智能手表和手机',
    tags: ['穿戴', '健康', 'GPS'],
    price: '¥1,299',
  },
  {
    title: 'Stride 90 轻量训练鞋',
    summary: '回弹中底和防滑外底，兼顾日常通勤与低强度训练。',
    imageUrl:
      'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=160&h=120&q=80',
    imageAlt: '红色运动鞋',
    tags: ['运动', '轻量', '缓震'],
    price: '¥629',
  },
  {
    title: 'FocusPrime 135mm 镜头',
    summary: '大光圈人像镜头，金属镜身和低色散镜片带来清晰画质。',
    imageUrl:
      'https://images.unsplash.com/photo-1499094025167-4cdcb92aef72?auto=format&fit=crop&w=160&h=120&q=80',
    imageAlt: '黑色相机镜头特写',
    tags: ['摄影', '大光圈', '人像'],
    price: '¥4,899',
  },
  {
    title: 'Studio Beat 便携耳机',
    summary: '折叠结构搭配柔软耳罩，适合移动办公和旅行收纳。',
    imageUrl:
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=160&h=120&q=80',
    imageAlt: '黄色背景上的黑色无线耳机',
    tags: ['音频', '便携', '长续航'],
    price: '¥529',
  },
  {
    title: 'Nord Pack 城市通勤背包',
    summary: '独立电脑仓、防泼水面料和多分区收纳，适合 15 英寸笔记本。',
    imageUrl:
      'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=160&h=120&q=80',
    imageAlt: '城市通勤背包',
    tags: ['背包', '防泼水', '电脑仓'],
    price: '¥399',
  },
  {
    title: 'ClearView 日常太阳镜',
    summary: '轻量镜框和偏光镜片，降低眩光并提供舒适佩戴体验。',
    imageUrl:
      'https://images.unsplash.com/photo-1572635196237-14b3f281503f?auto=format&fit=crop&w=160&h=120&q=80',
    imageAlt: '棕色太阳镜',
    tags: ['配饰', '偏光', '轻量'],
    price: '¥269',
  },
  {
    title: 'WorkMate 14 商务笔记本',
    summary: '高分辨率屏幕、轻薄金属机身和全天候电池，适合移动生产力。',
    imageUrl:
      'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=160&h=120&q=80',
    imageAlt: '银色笔记本电脑',
    tags: ['电脑', '办公', '轻薄'],
    price: '¥6,499',
  },
];

const statuses: FeedItem['status'][] = ['热销', '新品', '补货中'];
const owners = ['数码旗舰店', '城市装备馆', '影像实验室', '运动生活馆'];
const tagPool = ['热卖', '新品', '精选', '专业款', '轻量'];

// 生成稳定的模拟商品列表，便于三种虚拟滚动方案使用同一批数据做对比。
export function createItems(count: number): FeedItem[] {
  return Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    const product = productCatalog[index % productCatalog.length];
    // 同一组商品模板循环使用，通过 round 生成不同编号，模拟更大的数据集。
    const round = Math.floor(index / productCatalog.length) + 1;

    return {
      id,
      title: `${product.title} #${String(round).padStart(3, '0')}`,
      summary: product.summary,
      imageUrl: product.imageUrl,
      imageAlt: product.imageAlt,
      tags: [...product.tags, tagPool[index % tagPool.length]],
      status: statuses[index % statuses.length],
      owner: owners[index % owners.length],
      updatedAt: `${(index % 12) + 1} 分钟前`,
      price: product.price,
    };
  });
}

export function fetchProductList({
  count = 10000,
  delayMs = 650,
  signal,
  shouldFail = false,
}: FetchProductListOptions = {}): Promise<ProductListResponse> {
  const startedAt = performance.now();

  // 用 setTimeout 模拟真实接口延迟，同时支持 AbortController 取消请求。
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Request aborted', 'AbortError'));
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (shouldFail) {
        reject(new Error('模拟接口请求失败，请稍后重试'));
        return;
      }

      resolve({
        items: createItems(count),
        total: count,
        // 把模拟接口耗时返回给页面展示，方便观察 loading 流程。
        latencyMs: Math.round(performance.now() - startedAt),
      });
    }, delayMs);

    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeoutId);
        reject(new DOMException('Request aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export function filterItems(items: FeedItem[], query: string) {
  const keyword = query.trim().toLowerCase();

  if (!keyword) {
    return items;
  }

  // Demo 里前端直接过滤；真实大数据场景建议交给后端或 Web Worker。
  return items.filter((item) => {
    const content = `${item.title} ${item.summary} ${item.tags.join(' ')} ${item.owner} ${item.price}`.toLowerCase();
    return content.includes(keyword);
  });
}
