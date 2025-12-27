
import React, { useState } from "react"
import type { PlasmoCSConfig } from "plasmo";
import { writeToHTML, scrollToTop, getHTML, getInterval, scrollToBottom, extractReply, exportToExcel, exportTableToExcel } from '../utils'
import styleText from "data-text:./style.module.css"
import * as style from "./style.module.css"
import { onNestedReply } from "./content";

export const getStyle = () => {
  const style = document.createElement("style")
  style.textContent = styleText
  style.setAttribute('id', 'cm-helper')
  return style
}

export const config: PlasmoCSConfig = {
  matches: [
    "https://www.bilibili.com/video/*"
  ]
}

export const global_data = {
  mainQuery: {},
  errorReplyCount: 0,
  errorReplyMaxCount: 5,
}

export const extract_config = {
  downloading: false,
  onMainChange: null,
  onNestedChange: null,
  // 主评论
  mainReplyCount: -1,
  // 主 + 副评论总数
  mainSubReplyCount: -1,
  // 下载模式
  mode: 'excel',
  upMid: null,
  setLoading: (value) => { },
  setTip: (value) => {},
  addLog: (msg) => { console.log(msg) },
  updateCount: () => {}
}
export const commentInfoMap = new Map() // rpid -> reply
export const commentsListMap = new Map() // rpid -> []reply's children

function getVideoInfo() {
  const title = (document.querySelector('.video-title') as HTMLElement)?.innerText || ''
  const viewCount = (document.querySelector('.view.item') as HTMLElement)?.innerText || 0
  const publishTime = (document.querySelector('.pubdate-text') as HTMLElement)?.innerText || ''
  const desc = (document.querySelector('.desc-info-text') as HTMLElement)?.innerText || ''
  const tags = Array.from(document.querySelectorAll('.tag') || []).map(e => (e as HTMLElement).innerText).filter(e => e)
  const upInfo = {
    // avatar: document.querySelector('.bili-avatar-img')?.getAttribute('data-src'),
    avatar: (document.querySelector('.up-avatar-wrap .bili-avatar-img') as HTMLImageElement)?.src ?? '',
    spaceLink: (document.querySelector('.up-name') as HTMLAnchorElement)?.href,
    upname: (document.querySelector('.up-name') as HTMLElement)?.innerText || '-',
    updesc: (document.querySelector('.up-description') as HTMLElement)?.innerText || '-',
    mid: extract_config?.upMid || null,
  }
  return {
    title,
    desc,
    viewCount,
    publishTime,
    tags,
    link: window.location.href,
    upInfo
  }
}

function getDownloadFileName() {
  const info = getVideoInfo()
  if (info.title) {
    return info.title + '.html'
  }
  return 'Bilibili_Helper.html'
}

function uniArr(list, uniKey) {
  const map = {}
  const result = []

  list.forEach(item => {
    if (map[item[uniKey]]) {
      return
    }
    result.push(item)
    map[item[uniKey]] = true
  })

  return result
}

function downloadComments(title = 'file.html', maxCount = 100000, withChildren = true) {
  let data = []
  const entries = commentInfoMap.entries()
  for (const [key, reply] of entries) {
    if (withChildren) {
      const children = commentsListMap.get(key)
      reply.children = uniArr(children || [], 'rpid')
    }
    data.push(reply)
  }
  data = data.slice(0, maxCount)

  const getTime = new Date().toLocaleString().replace(/\//g, '-')
  console.log('get time: ', getTime)
  console.log('mode = ', extract_config.mode)
  if (extract_config.mode === 'html') {
    const html = getHTML(JSON.stringify(data), JSON.stringify(getVideoInfo()), JSON.stringify(getTime))
    writeToHTML(html, title)
  } else if (extract_config.mode === 'excel') {
    exportTableToExcel(data, title.replace('.html', ''))
  }
}

function noMoreComment() {
  return !!document.querySelector('.reply-end')
}

function noMoreCommentPromise() {
  return new Promise((resolve) => {
    let timer = null
    function check() {
      let node = document.querySelector('.reply-end')
      if (node) {
        resolve(true)
        clearTimeout(timer)
        timer = null
      } else {
        timer = setTimeout(() => {
          check()
        }, 300)
      }
    }

    check()
  })
}

/**
 * 流程：监听接口响应
 * 
 * 当点击按钮，模拟一次触底，试图触发评论接口
 *  - 有更多评论
 *    - 触发分页事件处理，可以执行逻辑判断
 *  - 没有更多：
 *    - 不会再触发逻辑判断，导致下载一直没有反应
 *    - 解决方案
 *      - 发起一个定时器？如果定时器函数被执行，则证明没有触发成功，直接导出数据（这个时间不稳定，网络情况等因素很多）
 *      - watch dom，有这个节点就手动执行一下handler
 */

function downloadTopComments(topNum = 100) {
  return new Promise((resolve) => {
    extract_config.addLog(`开始爬取主评论，目标: ${topNum}条...`)
    console.log(1)
    const handler = () => {
      const size = commentInfoMap.size
      extract_config.updateCount()
      extract_config.addLog(`当前已爬取: ${size} 条`)
      
      if (extract_config.mainReplyCount !== -1 && size >= extract_config.mainReplyCount || noMoreComment()) {
        extract_config.setLoading(false)
        extract_config.addLog(`主评论爬取完成！共 ${size} 条。`)
        // downloadComments(getDownloadFileName(), topNum, false)
        extract_config.onMainChange = null
        extract_config.mainReplyCount = -1
        resolve(size)
      } else {
        setTimeout(() => {
          scrollToBottom()
        }, getInterval(1000))
      }
    }
    scrollToTop()
    setTimeout(() => {
      extract_config.onMainChange = handler
      extract_config.mainReplyCount = topNum
      extract_config.setLoading(true)
      scrollToBottom()
    }, 100)

    noMoreCommentPromise()
      .then(() => {
        handler()
      })
  })
}

function downloadNestedCommentByAPI(root = '') {
  const result = [];
  let totalCount = 0;
  const getReplyList = (page = 1) => {
    return new Promise((resolve, reject) => {
      const { oid = '' } = global_data.mainQuery as { oid?: string };
      const url = `https://api.bilibili.com/x/v2/reply/reply?type=1&oid=${oid}&sort=2&ps=20&root=${root}&pn=${page}&web_location=333.788`
      fetch(url)
        .then(res => res.json())
        .then(res => {
          console.log('call onNestedReply', res);
          if (res.code !== 0) {
            global_data.errorReplyCount++;
            if (global_data.errorReplyCount >= global_data.errorReplyMaxCount) {
              extract_config.setTip('服务器异常，请稍后重试');
              return reject('服务器异常，请稍后重试');
            }
            resolve({ list: [], count: 0 })
          }
          onNestedReply(res.data, {
            oid,
            root,
          })
          console.log('res: ', res);
          const { page, replies } = res.data;
          const { count } = page || { count: 0 }
          totalCount = totalCount || count;
          resolve({
            list: replies,
            count,
          })
        }).catch(() => ({ list: []}));
    })
  }

  const handler = (pageSize = 1, callback) => {
    getReplyList(pageSize)
      .then((res) => {
        const { list } = res as { list?: any[] } || {};
        result.push(...list)
        if (totalCount && result.length >= totalCount) {
          const item = commentInfoMap.get(root);
          if (item) {
            item._child_loaded = true;
            commentInfoMap.set(root, item);
          }
          callback(result);
        } else {
          setTimeout(() => {
            handler(pageSize + 1, callback);
          }, getInterval())
        }
      })
  }
  return new Promise((resolve, reject) => {
    if (!root) {
      resolve(true);
      return;
    }
    const item = commentInfoMap.get(root);
    if (item && item._child_loaded) {
      resolve(true);
      return;
    }
    return handler(1, () => {
      resolve(true);
    })
  })
}

async function downloadCommentsWithNestedByPage(topNum = 10) {
  extract_config.addLog(`开始爬取评论（含回复），目标主评论数: ${topNum}...`)
  
  // 确保先获取主评论
  if (commentInfoMap.size < topNum) {
     extract_config.addLog(`当前主评论数量不足，开始获取主评论...`)
     await downloadTopComments(topNum)
  }

  const promiseList = []
  let maxIndex = topNum;
  let index = 0;
  extract_config.setLoading(true);
  for (const [key, value] of commentInfoMap.entries()) {
    if (index >= maxIndex) {
      break;
    }
    index++;
    extract_config.addLog(`正在爬取第 ${index}/${maxIndex} 条主评论的回复...`)
    promiseList.push(downloadNestedCommentByAPI(key));
  }
  try {
    await Promise.all(promiseList);
  } catch (e) {
    console.log(e);
    extract_config.addLog(`爬取过程中出错: ${e}`)
  }
  extract_config.setLoading(false);
  extract_config.addLog(`爬取完成！请点击保存按钮导出数据。`)
  extract_config.updateCount()
  // downloadComments(getDownloadFileName(), topNum, true)
}
function downloadCommentsWithNested(topNum = 10) {
  extract_config.addLog(`开始爬取评论（含回复），目标主评论数: ${topNum}...`)
  extract_config.mainSubReplyCount = topNum
  let targetIndex = 0
  let maxTargetIndex = topNum
  let allReplyNode = document.querySelectorAll('.reply-item')
  let targetReply = allReplyNode[targetIndex]
  if (!targetReply) {
    console.error(`Not found the target reply by index ${targetIndex}, ${targetReply}`)
    extract_config.addLog(`错误：未找到评论节点`)
    return
  }

  const handleTaskFinish = () => {
    extract_config.onNestedChange = null
    console.log('downloadCommentsWithNested结束')
    extract_config.setLoading(false)
    extract_config.addLog(`爬取完成！请点击保存按钮导出数据。`)
    extract_config.updateCount()
    // downloadComments(getDownloadFileName(), extract_config.mainSubReplyCount, true)
    extract_config.mainSubReplyCount = -1
  }

  const handler = () => {
    setTimeout(() => {
      const list = document.querySelectorAll('.reply-item')
      const target = list[targetIndex]
      const moreBtn = target ? target.querySelector('.view-more-btn') as HTMLElement : null
      const currentPage = target ? target.querySelector('.current-page') as HTMLElement : null
      const nextPage = currentPage?.nextSibling as HTMLElement
      const nextReplyItem = target?.nextElementSibling
      const noMore = noMoreComment() && !nextReplyItem && !nextPage
      if (targetIndex > maxTargetIndex || noMore) {
        handleTaskFinish()
        return
      }

      if (!target) {
        scrollToBottom()
        setTimeout(() => {
          targetIndex++
          handler()
        }, getInterval())
        return
      }

      if (moreBtn) {
        moreBtn.click()
        return
      }

      if (!currentPage || !nextPage || !nextPage?.click) {
        targetIndex++
        handler()
        return
      }

      nextPage.click()
    })
  }

  scrollToTop()
  extract_config.onNestedChange = handler
  extract_config.setLoading(true)
  handler()

  // noMoreCommentPromise()
  //   .then(() => {
  //     handler()
  //   })
}

export function Button({ children, onClick = () => { }, disabled = false }) {
  return <div 
    className={ `${style.button} ${disabled ? style.disabled : ''}` } 
    onClick={ disabled ? undefined : onClick }
    style={ disabled ? { backgroundColor: '#ccc', cursor: 'not-allowed' } : {} }
  >
    { children }
  </div>
}

function DownloadIndexCommentCustom(props = { count: 100 }) {
  const { count } = props
  const onClick = () => {
    console.log('custom get: ', count)
    if (count) {
      downloadTopComments(count)
    }
  }
  return <>
    <Button onClick={ onClick }>运行：自定义获取</Button>
  </>
}

function DownloadIndexCommentNestedCustom(props = { count: 10 }) {
  const { count } = props
  const onClick = async () => {
    console.log('custom get: ', count)
    const list = [];
    if (count) {
      downloadCommentsWithNestedByPage(count);
    }
  }
  return <>
    <Button onClick={ onClick }>运行：自定义获取（含回复）</Button>
  </>
}

export function DownloadTop() {
  const onClick = () => {
    downloadTopComments(300)
  }
  return <Button onClick={ onClick }>运行：爬取热门前300</Button>
}

export function DownloadTopWithNested() {
  const onClick = () => {
    // downloadCommentsWithNested(10)
    downloadCommentsWithNestedByPage(10);
  }
  return <Button onClick={ onClick }>运行：爬取热门前10（含回复）</Button>
}

export function UpInfoButton() {
  const onClick = () => {
    scrollToTop()
    console.log(getVideoInfo())
  }
  return <Button onClick={ onClick }>获取UP</Button>
}

export default function Content() {
  const [count, setCount] = useState(100)
  const [loading, setLoading] = useState(false)
  const [tip, setTip] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [dataCount, setDataCount] = useState(0);

  extract_config.setTip = setTip
  extract_config.setLoading = setLoading
  extract_config.addLog = (msg) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }
  extract_config.updateCount = () => {
    setDataCount(commentInfoMap.size)
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const __count = parseInt(e.target.value)
    setCount(__count || 0)
    e.stopPropagation()
    e.preventDefault()
  }

  const handleExport = (mode: 'excel' | 'html') => {
    extract_config.mode = mode;
    downloadComments(getDownloadFileName(), 100000, true);
    extract_config.addLog(`正在导出为 ${mode} 格式...`)
  }

  return <div className={ `${style.wrapper} ${loading ? style.loading : ''}` }>
    <div style={{ maxHeight: '150px', overflowY: 'auto', fontSize: '12px', marginBottom: '10px', border: '1px solid #eee', padding: '5px', background: '#f9f9f9' }}>
      {logs.length === 0 ? <div style={{color: '#999'}}>调试日志...</div> : logs.map((log, i) => <div key={i}>{log}</div>)}
    </div>
    <div style={{ marginBottom: '10px', fontSize: '12px', fontWeight: 'bold' }}>
      当前已缓存数据: {dataCount} 条
    </div>

    <DownloadTop />
    <DownloadTopWithNested />
    <div>
      <input value={ count } onKeyDown={ (e) => e.stopPropagation() } onChange={ onInputChange } className={ style['input'] } placeholder="条数" />
    </div>
    <DownloadIndexCommentCustom count={ count } />
    <DownloadIndexCommentNestedCustom count={ count } />
    
    <fieldset style={{ marginTop: '10px', border: '1px solid #eee', padding: '5px' }}>
      <legend style={{ fontSize: '12px' }}>数据导出</legend>
      <div style={{ display: 'flex', gap: '5px', flexDirection: 'column' }}>
         <Button onClick={() => handleExport('excel')} disabled={dataCount === 0}>保存 Excel</Button>
         <Button onClick={() => handleExport('html')} disabled={dataCount === 0}>保存 HTML</Button>
      </div>
    </fieldset>

    { loading ? <div className={ style.loadingText }>正在处理...请勿重复操作</div> : null }
    { tip ? <div className={ style.loadingText }>{tip}</div> : null }
  </div>
}


export const getMountPoint = async () => document.querySelector("body")
