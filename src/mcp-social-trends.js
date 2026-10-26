// 社媒热点 MCP 工具（social-trends）
//
// 给 QQ agent 一个「看热搜 / 看社交媒体」的能力：拿当前各平台的热榜，
// 让它能在群里聊时事、接热点梗，而不是只能聊群里那点事。
//
// 设计：
// - 只读，不登录任何账号，不发送任何内容
// - 复用桥接的 safeFetch（SSRF 防护 + 内网地址拦截 + 大小上限）
// - 热榜来源优先选**结构化 JSON**（今日头条），HTML 平台做文本提取
// - 结果做长度裁剪，避免把 5 万字符灌进上下文

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { safeFetch } from './safe-fetch.js'

const MAX_ITEMS = 20
const MAX_TEXT = 4000

/** 各平台热榜来源。json 类型走结构化解析，html 类型做链接+文本提取。 */
const SOURCES = {
  toutiao: {
    label: '今日头条热榜',
    url: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
    kind: 'json',
  },
  baidu: {
    label: '百度热搜',
    url: 'https://top.baidu.com/board?tab=realtime',
    kind: 'html',
  },
  weibo: {
    label: '微博热搜',
    url: 'https://s.weibo.com/top/summary',
    kind: 'html',
  },
  bilibili: {
    label: 'B站热门',
    url: 'https://www.bilibili.com/v/popular/all',
    kind: 'html',
  },
}

/** 从文本里抓「带链接的标题行」——HTML 热榜页的通用兜底。 */
function extractTitles(text) {
  const out = []
  const seen = new Set()
  // 抓 8~60 字的连续中文/数字/字母片段作为候选标题
  const re = /(?:>|")([\u4e00-\u9fa5A-Za-z0-9][\u4e00-\u9fa5A-Za-z0-9\s，,、！？!?：:.·—\-"'（）()]{7,58})(?:<|")/g
  let m
  while ((m = re.exec(text)) !== null && out.length < MAX_ITEMS) {
    const t = m[1].trim().replace(/\s+/g, ' ')
    if (t.length < 8) continue
    if (seen.has(t)) continue
    // 过滤明显是代码/样式的片段
    if (/[{};=]|function|var |window\.|DOCTYPE|charset|css|px;/.test(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

async function fetchTrends(sourceKey) {
  const src = SOURCES[sourceKey]
  if (!src) throw new Error(`未知来源 ${sourceKey}，可用：${Object.keys(SOURCES).join(', ')}`)

  const raw = await safeFetch(src.url)
  // safeFetch 返回 { url, statusCode, truncated, body }；有 50000 字符上限，
  // JSON 经常被截断（truncated=true），所以不能直接 JSON.parse，
  // 改用正则从原始文本里抠 Title / HotValue。
  const text = typeof raw === 'string' ? raw : (raw.body ?? raw.text ?? JSON.stringify(raw))

  if (src.kind === 'json') {
    const items = []
    const seen = new Set()
    // 匹配 "Title":"xxx" 形式（可能被截断，但前面的条目是完整的）
    const re = /"Title"\s*:\s*"((?:[^"\\]|\\.)*)"/g
    let m
    while ((m = re.exec(text)) !== null && items.length < MAX_ITEMS) {
      let title = m[1]
      try { title = JSON.parse(`"${m[1]}"`) } catch { /* 保留原文 */ }
      title = String(title).trim()
      if (!title || seen.has(title)) continue
      seen.add(title)
      items.push({ rank: items.length + 1, title })
    }
    if (items.length) return { label: src.label, items }
    // 抠不到就走文本兜底
  }

  const titles = extractTitles(text)
  return { label: src.label, items: titles.map((t, i) => ({ rank: i + 1, title: t })) }
}

const server = new Server(
  { name: 'social-trends', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_trends',
      description:
        '查看当前各平台的网络热点/热搜榜（今日头条、百度、微博、B站）。只读，不登录、不发布任何内容。' +
        '适合群里聊时事、接热点梗、找话题时使用。返回按热度排序的标题列表。',
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            enum: ['toutiao', 'baidu', 'weibo', 'bilibili', 'all'],
            description: '要查的平台；all 表示依次查主要平台（较慢）。默认 toutiao（最稳定、结构化）。',
          },
          limit: {
            type: 'number',
            description: `最多返回多少条，默认 15，上限 ${MAX_ITEMS}`,
          },
        },
      },
    },
    {
      name: 'get_social_post',
      description:
        '抓取指定社交/内容平台页面的正文（微博、知乎、B站、小红书等的公开页面）。' +
        '只读，不登录账号，不点赞不评论不发布。适合群友发来链接时读取内容。',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要读取的公开页面 URL（http/https）' },
        },
        required: ['url'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params

  if (name === 'get_trends') {
    const source = String(args.source ?? 'toutiao')
    const limit = Math.min(MAX_ITEMS, Math.max(1, Number(args.limit) || 15))

    const keys = source === 'all' ? ['toutiao', 'baidu', 'weibo'] : [source]
    const results = []
    for (const k of keys) {
      try {
        const r = await fetchTrends(k)
        results.push({ ...r, items: r.items.slice(0, limit) })
      } catch (e) {
        results.push({ label: SOURCES[k]?.label ?? k, error: e.message, items: [] })
      }
    }

    const lines = []
    for (const r of results) {
      lines.push(`【${r.label}】`)
      if (r.error) {
        lines.push(`  (获取失败: ${r.error})`)
        continue
      }
      if (!r.items.length) {
        lines.push('  (没有解析到条目)')
        continue
      }
      for (const it of r.items) {
        const hot = it.hot ? `  热度${it.hot}` : ''
        lines.push(`  ${it.rank}. ${it.title}${hot}`)
      }
    }
    const out = lines.join('\n').slice(0, MAX_TEXT)
    return { content: [{ type: 'text', text: out || '(没有拉到热点)' }] }
  }

  if (name === 'get_social_post') {
    const url = String(args.url ?? '')
    if (!/^https?:\/\//i.test(url)) {
      return { content: [{ type: 'text', text: 'URL 必须是 http/https' }], isError: true }
    }
    try {
      const raw = await safeFetch(url)
      const text = typeof raw === 'string' ? raw : (raw.body ?? raw.text ?? JSON.stringify(raw))
      // 去掉 script/style，压缩空白
      const cleaned = text
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TEXT)
      return { content: [{ type: 'text', text: cleaned || '(页面没有可读文本)' }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `抓取失败: ${e.message}` }], isError: true }
    }
  }

  return { content: [{ type: 'text', text: `未知工具 ${name}` }], isError: true }
})

const transport = new StdioServerTransport()
await server.connect(transport)