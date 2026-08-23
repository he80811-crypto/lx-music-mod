import { httpFetch } from '../../request'
import CryptoJS from 'crypto-js'

const parseDuration = (duration) => {
  if (!duration) return '0:00'
  if (typeof duration === 'number') {
    const m = Math.floor(duration / 60)
    const s = Math.floor(duration % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }
  // String format like "MM:SS" from Bilibili API
  return duration
}

// https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/misc/sign/wbi.md
const mixinKeyEncTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
]

let wbiKeysPromise = null

const getMixinKey = (orig) => mixinKeyEncTab.map(n => orig[n]).join('').slice(0, 32)

const getWbiKeys = () => {
  if (!wbiKeysPromise) {
    wbiKeysPromise = httpFetch(
      'https://api.bilibili.com/x/web-interface/nav',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://www.bilibili.com/',
        },
      },
    ).promise.then(({ body }) => {
      const imgUrl = body?.data?.wbi_img?.img_url
      const subUrl = body?.data?.wbi_img?.sub_url
      if (!imgUrl || !subUrl) throw new Error(body?.message || '获取 WBI keys 失败')
      return {
        imgKey: imgUrl.split('/').pop().split('.')[0],
        subKey: subUrl.split('/').pop().split('.')[0],
      }
    })
  }
  return wbiKeysPromise
}

const encWbi = (params, { imgKey, subKey }) => {
  const mixinKey = getMixinKey(imgKey + subKey)
  const wts = Math.round(Date.now() / 1000)
  params.wts = wts
  const query = Object.keys(params).sort().map(key => {
    const value = params[key].toString().replace(/[!'()*]/g, '')
    return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
  }).join('&')
  return { w_rid: CryptoJS.MD5(query + mixinKey).toString(), wts }
}

export default {
  limit: 20,
  total: 0,
  page: 0,
  allPage: 1,

  async musicSearch(str, page, limit) {
    const { imgKey, subKey } = await getWbiKeys()
    const params = {
      search_type: 'video',
      keyword: str,
      page,
      pagesize: limit,
    }
    const { w_rid, wts } = encWbi(params, { imgKey, subKey })
    params.w_rid = w_rid
    params.wts = wts
    const query = Object.keys(params).sort().map(key => {
      const value = params[key].toString().replace(/[!'()*]/g, '')
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    }).join('&')
    const searchRequest = httpFetch(
      `https://api.bilibili.com/x/web-interface/wbi/search/type?${query}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://www.bilibili.com/',
        },
      },
    )
    return searchRequest.promise.then(({ body }) => body)
  },
  handleResult(rawData) {
    if (!rawData?.result) return []
    const list = []
    for (const item of rawData.result) {
      if (!item.bvid) continue

      list.push({
        name: item.title.replace(/<[^>]*>/g, ''),
        singer: item.author || 'Bilibili',
        source: 'bili',
        songmid: item.bvid,
        albumId: item.aid?.toString() || '',
        interval: parseDuration(item.duration),
        albumName: 'Bilibili',
        img: item.pic ? `https:${item.pic}` : null,
        lrc: null,
        otherSource: null,
        types: [{ type: '128k', size: '' }],
        _types: { '128k': { size: '' } },
        typeUrl: {},
      })
    }
    return list
  },
  search(str, page = 1, limit, retryNum = 0) {
    if (retryNum > 3) return Promise.reject(new Error('try max num'))
    if (limit == null) limit = this.limit

    return this.musicSearch(str, page, limit).then(result => {
      if (!result || result.code !== 0) {
        if (result?.code === -412) {
          wbiKeysPromise = null
          return this.search(str, page, limit, retryNum + 1)
        }
        return Promise.reject(new Error(result?.message || '搜索失败'))
      }

      const data = result.data || {}
      let list = this.handleResult(data)

      this.total = data.numResults ?? list.length
      this.page = page
      this.allPage = Math.ceil(this.total / limit)

      return {
        list,
        allPage: this.allPage,
        limit,
        total: this.total,
        source: 'bili',
      }
    })
  },
}
