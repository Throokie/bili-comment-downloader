// ==UserScript==
// @name         B站评论下载助手
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  下载B站视频评论，支持导出Excel和HTML
// @author       throokie
// @match        https://www.bilibili.com/video/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-end
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 样式定义 ====================
    const styles = `
        #bili-comment-helper-panel {
            position: fixed;
            right: 20px;
            top: 100px;
            width: 300px;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 99999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            transition: all 0.3s ease;
        }
        #bili-comment-helper-panel.collapsed {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            cursor: pointer;
        }
        #bili-comment-helper-panel.collapsed .panel-content {
            display: none;
        }
        #bili-comment-helper-panel.collapsed .panel-toggle {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 15px;
            background: linear-gradient(135deg, #00a1d6, #00b5e2);
            color: white;
            border-radius: 8px 8px 0 0;
            font-weight: bold;
        }
        .panel-toggle {
            background: none;
            border: none;
            color: white;
            font-size: 18px;
            cursor: pointer;
            padding: 5px;
        }
        .panel-toggle:hover {
            opacity: 0.8;
        }
        .panel-content {
            padding: 15px;
        }
        .btn {
            width: 100%;
            padding: 10px 15px;
            margin: 5px 0;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
        }
        .btn-primary {
            background: #00a1d6;
            color: white;
        }
        .btn-primary:hover {
            background: #0090c3;
        }
        .btn-secondary {
            background: #f4f4f4;
            color: #333;
        }
        .btn-secondary:hover {
            background: #e8e8e8;
        }
        .btn-success {
            background: #52c41a;
            color: white;
        }
        .btn-success:hover {
            background: #45a517;
        }
        .btn:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .btn-group {
            display: flex;
            gap: 8px;
            margin: 10px 0;
        }
        .btn-group .btn {
            flex: 1;
            margin: 0;
        }
        .input-group {
            display: flex;
            gap: 8px;
            margin: 10px 0;
        }
        .input-group input {
            flex: 1;
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
        }
        .input-group input:focus {
            outline: none;
            border-color: #00a1d6;
        }
        .log-container {
            max-height: 120px;
            overflow-y: auto;
            font-size: 12px;
            margin: 10px 0;
            padding: 8px;
            background: #f9f9f9;
            border: 1px solid #eee;
            border-radius: 4px;
            color: #666;
        }
        .log-item {
            padding: 2px 0;
        }
        .status-bar {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-size: 13px;
            color: #666;
            border-top: 1px solid #eee;
            margin-top: 10px;
        }
        .loading-overlay {
            display: none;
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255, 255, 255, 0.9);
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            z-index: 10;
        }
        .loading-overlay.show {
            display: flex;
        }
        .loading-spinner {
            width: 40px;
            height: 40px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #00a1d6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .divider {
            height: 1px;
            background: #eee;
            margin: 10px 0;
        }
        .section-title {
            font-size: 12px;
            color: #999;
            margin: 10px 0 5px;
        }
    `;

    // 注入样式
    if (typeof GM_addStyle !== 'undefined') {
        GM_addStyle(styles);
    } else {
        const styleEl = document.createElement('style');
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }

    // ==================== 全局变量 ====================
    const commentInfoMap = new Map(); // rpid -> reply
    const commentsListMap = new Map(); // rpid -> []reply's children
    const global_data = {
        mainQuery: {},
        errorReplyCount: 0,
        errorReplyMaxCount: 5,
    };
    const extract_config = {
        downloading: false,
        mainReplyCount: -1,
        mainSubReplyCount: -1,
        mode: 'excel',
        upMid: null,
    };

    // ==================== 工具函数 ====================
    function getInterval(min = 500) {
        return Math.max(min, Math.random() * 2000 + 500);
    }

    function scrollToBottom() {
        window.scrollTo(0, document.body.scrollHeight);
    }

    function scrollToTop() {
        window.scrollTo(0, 0);
    }

    function extractReply(reply) {
        if (!reply) return null;
        const { rpid, mid, member, content, parent, rcount, like, ctime, up_action, reply_control } = reply || {};
        return {
            rpid,
            member,
            memberName: member && member.uname || '',
            comment: content ? content.message : '',
            pictures: content?.pictures || [],
            parent,
            rcount,
            mid,
            like,
            ctime,
            reply_control,
            location: reply_control?.location?.replace?.('IP属地：', '') ?? '',
            upLike: up_action && up_action.like || false
        };
    }

    function noMoreComment() {
        return !!document.querySelector('.reply-end');
    }

    function noMoreCommentPromise() {
        return new Promise((resolve) => {
            let timer = null;
            function check() {
                let node = document.querySelector('.reply-end');
                if (node) {
                    resolve(true);
                    clearTimeout(timer);
                    timer = null;
                } else {
                    timer = setTimeout(() => {
                        check();
                    }, 300);
                }
            }
            check();
        });
    }

    function uniArr(list, uniKey) {
        const map = {};
        const result = [];
        list.forEach(item => {
            if (!map[item[uniKey]]) {
                result.push(item);
                map[item[uniKey]] = true;
            }
        });
        return result;
    }

    function getVideoInfo() {
        const title = document.querySelector('.video-title')?.innerText || '';
        const viewCount = document.querySelector('.view.item')?.innerText || 0;
        const publishTime = document.querySelector('.pubdate-text')?.innerText || '';
        const desc = document.querySelector('.desc-info-text')?.innerText || '';
        const tags = Array.from(document.querySelectorAll('.tag') || []).map(e => e.innerText).filter(e => e);
        const upInfo = {
            avatar: document.querySelector('.up-avatar-wrap .bili-avatar-img')?.src ?? '',
            spaceLink: document.querySelector('.up-name')?.href,
            upname: document.querySelector('.up-name')?.innerText || '-',
            updesc: document.querySelector('.up-description')?.innerText || '-',
            mid: extract_config?.upMid || null,
        };
        return { title, desc, viewCount, publishTime, tags, link: window.location.href, upInfo };
    }

    function getDownloadFileName() {
        const info = getVideoInfo();
        if (info.title) {
            return info.title.replace(/[\\/:*?"<>|]/g, '_');
        }
        return 'Bilibili_Comments';
    }

    // ==================== 日志和状态更新 ====================
    let logs = [];
    let dataCount = 0;
    let isLoading = false;

    function addLog(msg) {
        const time = new Date().toLocaleTimeString();
        logs.push(`[${time}] ${msg}`);
        updateUI();
        console.log(`[B站评论助手] ${msg}`);
    }

    function updateCount() {
        dataCount = commentInfoMap.size;
        updateUI();
    }

    function setLoading(loading) {
        isLoading = loading;
        updateUI();
    }

    function updateUI() {
        const logContainer = document.querySelector('#bili-helper-logs');
        const countEl = document.querySelector('#bili-helper-count');
        const loadingOverlay = document.querySelector('#bili-helper-loading');

        if (logContainer) {
            logContainer.innerHTML = logs.length === 0
                ? '<div style="color: #999;">等待操作...</div>'
                : logs.slice(-10).map(log => `<div class="log-item">${log}</div>`).join('');
            logContainer.scrollTop = logContainer.scrollHeight;
        }
        if (countEl) {
            countEl.textContent = dataCount;
        }
        if (loadingOverlay) {
            loadingOverlay.classList.toggle('show', isLoading);
        }

        // 更新按钮状态
        const exportExcelBtn = document.querySelector('#export-excel-btn');
        const exportHtmlBtn = document.querySelector('#export-html-btn');
        if (exportExcelBtn) exportExcelBtn.disabled = dataCount === 0;
        if (exportHtmlBtn) exportHtmlBtn.disabled = dataCount === 0;
    }

    // ==================== 网络请求拦截 ====================
    function injectNetworkInterceptor() {
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                const paths = ['reply/wbi/main', 'reply/reply'];
                const postMessage = (type, data) => {
                    window.postMessage({ type, data }, '*');
                };

                const originFetch = window.fetch;
                window.fetch = (url, options) => {
                    return originFetch(url, options).then(async (response) => {
                        for (const keyword of paths) {
                            if (url.indexOf(keyword) !== -1) {
                                const responseClone = response.clone();
                                const res = await responseClone.json();
                                const query = {};
                                try {
                                    const urlObj = new URL(url, window.location.origin);
                                    urlObj.searchParams.forEach((v, k) => query[k] = v);
                                } catch(e) {}
                                postMessage('networkRequest', { data: res, query, url });
                            }
                        }
                        return response;
                    });
                };

                const originOpen = XMLHttpRequest.prototype.open;
                XMLHttpRequest.prototype.open = function(_, url) {
                    this.addEventListener('readystatechange', function() {
                        if (this.readyState === 4) {
                            for (const keyword of paths) {
                                if (url.indexOf(keyword) !== -1) {
                                    try {
                                        const query = {};
                                        const urlStr = url.toString();
                                        if (urlStr.includes('?')) {
                                            const params = urlStr.split('?')[1].split('&');
                                            params.forEach(p => {
                                                const [k, v] = p.split('=');
                                                query[k] = decodeURIComponent(v || '');
                                            });
                                        }
                                        const res = typeof this.response === 'string' ? JSON.parse(this.response) : this.response;
                                        postMessage('networkRequest', { data: res, query, url });
                                    } catch(e) {}
                                }
                            }
                        }
                    });
                    originOpen.apply(this, arguments);
                };
            })();
        `;
        (document.head || document.documentElement).appendChild(script);
        console.log('%c B站评论助手 网络拦截注入成功！', 'color: #00a1d6; font-weight: 700;');
    }

    // ==================== 评论数据处理 ====================
    function handleReply(reply) {
        const { rpid } = reply || {};
        if (!rpid) return;
        if (!commentInfoMap.get(rpid)) {
            commentInfoMap.set(rpid, extractReply(reply));
        }
        if (reply?.replies?.length) {
            const list = reply.replies || [];
            const result = [];
            for (const item of list) {
                result.push(extractReply(item));
            }
            commentsListMap.set(rpid, result);
        }
    }

    function handleNestedReply(reply) {
        const { root } = reply;
        if (!root) return;
        const comments = commentsListMap.get(root) || [];
        comments.push(extractReply(reply));
        commentsListMap.set(root, comments);
    }

    function onMainComments(data, apiQuery) {
        const { top_replies, replies, upper } = data;
        if (apiQuery) {
            global_data.mainQuery = apiQuery;
        }
        if (top_replies) {
            top_replies.forEach(reply => handleReply(reply));
        }
        if (replies) {
            replies.forEach(reply => handleReply(reply));
        }
        if (upper && upper.mid) {
            extract_config.upMid = upper.mid;
        }
        updateCount();

        if (extract_config.mainReplyCount !== -1) {
            const size = commentInfoMap.size;
            if (size >= extract_config.mainReplyCount || noMoreComment()) {
                setLoading(false);
                addLog(`主评论爬取完成！共 ${size} 条`);
                extract_config.mainReplyCount = -1;
            }
        }
    }

    function onNestedReply(data, apiQuery) {
        if (!apiQuery || !apiQuery.root) return;
        const { replies } = data;
        if (replies) {
            replies.forEach(reply => handleNestedReply(reply));
        }
        updateCount();
    }

    function handleNetworkRequest(event) {
        const { type, data } = event.data;
        if (type !== 'networkRequest') return;

        const { url, query, data: responseData } = data;

        if (url.indexOf('reply/wbi/main') !== -1) {
            onMainComments(responseData.data, query);
        } else if (url.indexOf('reply/reply') !== -1) {
            onNestedReply(responseData.data, query);
        }
    }

    // ==================== 爬取功能 ====================
    function downloadTopComments(topNum = 100) {
        return new Promise((resolve) => {
            addLog(`开始爬取主评论，目标: ${topNum}条...`);

            const handler = () => {
                const size = commentInfoMap.size;
                updateCount();
                addLog(`当前已爬取: ${size} 条`);

                if (extract_config.mainReplyCount !== -1 && size >= extract_config.mainReplyCount || noMoreComment()) {
                    setLoading(false);
                    addLog(`主评论爬取完成！共 ${size} 条`);
                    extract_config.mainReplyCount = -1;
                    resolve(size);
                } else {
                    setTimeout(() => {
                        scrollToBottom();
                    }, getInterval(1000));
                }
            };

            scrollToTop();
            setTimeout(() => {
                extract_config.mainReplyCount = topNum;
                setLoading(true);
                scrollToBottom();
            }, 100);

            noMoreCommentPromise().then(() => {
                handler();
            });
        });
    }

    function downloadNestedCommentByAPI(root = '') {
        const result = [];
        let totalCount = 0;

        const getReplyList = (page = 1) => {
            return new Promise((resolve, reject) => {
                const { oid = '' } = global_data.mainQuery;
                const url = `https://api.bilibili.com/x/v2/reply/reply?type=1&oid=${oid}&sort=2&ps=20&root=${root}&pn=${page}&web_location=333.788`;
                fetch(url)
                    .then(res => res.json())
                    .then(res => {
                        if (res.code !== 0) {
                            global_data.errorReplyCount++;
                            if (global_data.errorReplyCount >= global_data.errorReplyMaxCount) {
                                addLog('服务器异常，请稍后重试');
                                return reject('服务器异常');
                            }
                            resolve({ list: [], count: 0 });
                        }
                        onNestedReply(res.data, { oid, root });
                        const { page, replies } = res.data;
                        totalCount = totalCount || (page?.count || 0);
                        resolve({ list: replies, count: page?.count || 0 });
                    })
                    .catch(() => resolve({ list: [] }));
            });
        };

        const handler = (pageSize = 1, callback) => {
            getReplyList(pageSize).then((res) => {
                const { list } = res || {};
                result.push(...(list || []));
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
                    }, getInterval());
                }
            });
        };

        return new Promise((resolve) => {
            if (!root) {
                resolve(true);
                return;
            }
            const item = commentInfoMap.get(root);
            if (item && item._child_loaded) {
                resolve(true);
                return;
            }
            handler(1, () => {
                resolve(true);
            });
        });
    }

    async function downloadCommentsWithNestedByPage(topNum = 10) {
        addLog(`开始爬取评论（含回复），目标主评论数: ${topNum}...`);

        if (commentInfoMap.size < topNum) {
            addLog(`当前主评论数量不足，开始获取主评论...`);
            await downloadTopComments(topNum);
        }

        const promiseList = [];
        let index = 0;
        setLoading(true);

        for (const [key, value] of commentInfoMap.entries()) {
            if (index >= topNum) break;
            index++;
            addLog(`正在爬取第 ${index}/${topNum} 条主评论的回复...`);
            promiseList.push(downloadNestedCommentByAPI(key));
        }

        try {
            await Promise.all(promiseList);
        } catch (e) {
            addLog(`爬取过程中出错: ${e}`);
        }

        setLoading(false);
        addLog(`爬取完成！请点击保存按钮导出数据。`);
        updateCount();
    }

    // ==================== 导出功能 ====================
    function replaceReplyPrefix(str) {
        return str?.replace(/回复 [^:]+ :/i, '') || '';
    }

    function exportToExcel(data, fileName) {
        const list = [];
        for (let i = 0; i < data.length; i++) {
            const { children, ...rest } = data[i];
            list.push({
                '一级评论': '是',
                '评论ID': String(rest.rpid),
                '用户': rest.memberName || '',
                '评论内容': rest.comment || '',
                '点赞数': rest.like || 0,
                '回复数': rest.rcount || 0,
                '评论时间': rest.ctime ? new Date(rest.ctime * 1000).toLocaleString() : '-',
                'IP属地': rest.location || ''
            });
            if (children && children.length) {
                for (let j = 0; j < children.length; j++) {
                    list.push({
                        '一级评论': '否',
                        '评论ID': String(children[j].rpid),
                        '用户': children[j].memberName || '',
                        '评论内容': replaceReplyPrefix(children[j].comment),
                        '点赞数': children[j].like || 0,
                        '回复数': children[j].rcount || 0,
                        '评论时间': children[j].ctime ? new Date(children[j].ctime * 1000).toLocaleString() : '-',
                        'IP属地': children[j].location || ''
                    });
                }
            }
        }

        // 使用 SheetJS 导出
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(list);

        // 设置列宽
        ws['!cols'] = [
            { wch: 8 },   // 一级评论
            { wch: 15 },  // 评论ID
            { wch: 20 },  // 用户
            { wch: 50 },  // 评论内容
            { wch: 10 },  // 点赞数
            { wch: 10 },  // 回复数
            { wch: 20 },  // 评论时间
            { wch: 10 }   // IP属地
        ];

        XLSX.utils.book_append_sheet(wb, ws, '评论数据');
        XLSX.writeFile(wb, `${fileName}.xlsx`);
        addLog(`Excel 文件已保存: ${fileName}.xlsx`);
    }

    function exportToHTML(data, videoInfo, fileName) {
        const getTime = new Date().toLocaleString().replace(/\//g, '-');
        const totalMain = data.length;
        let totalNested = 0;
        data.forEach(item => {
            if (item.children) {
                totalNested += item.children.length;
            }
        });

        const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${videoInfo.title || 'B站评论'} - 评论数据</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
        .header { padding: 20px; background: linear-gradient(135deg, #00a1d6, #00b5e2); color: white; border-radius: 8px 8px 0 0; }
        .header h1 { font-size: 20px; margin-bottom: 10px; }
        .video-info { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; padding: 15px; background: #f9f9f9; }
        .video-info div { font-size: 13px; }
        .video-info span { color: #666; }
        .stats { display: flex; gap: 20px; padding: 15px; border-bottom: 1px solid #eee; }
        .stat-item { text-align: center; }
        .stat-item .num { font-size: 24px; font-weight: bold; color: #00a1d6; }
        .stat-item .label { font-size: 12px; color: #666; }
        .comments { padding: 15px; max-height: 70vh; overflow-y: auto; }
        .comment { border: 1px solid #eee; border-radius: 8px; margin-bottom: 10px; overflow: hidden; }
        .comment-main { padding: 15px; }
        .comment-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .comment-user { font-weight: bold; color: #333; }
        .comment-time { font-size: 12px; color: #999; }
        .comment-content { font-size: 14px; line-height: 1.6; color: #333; }
        .comment-stats { display: flex; gap: 15px; margin-top: 8px; font-size: 12px; color: #666; }
        .comment-children { background: #f9f9f9; padding: 10px 15px 10px 40px; }
        .child-comment { padding: 10px 0; border-top: 1px solid #eee; }
        .child-comment:first-child { border-top: none; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${videoInfo.title || 'B站视频评论'}</h1>
            <div><a href="${videoInfo.link}" target="_blank" style="color: white;">查看原视频</a></div>
        </div>
        <div class="video-info">
            <div><span>UP主：</span>${videoInfo.upInfo?.upname || '-'}</div>
            <div><span>发布时间：</span>${videoInfo.publishTime || '-'}</div>
            <div><span>抓取时间：</span>${getTime}</div>
        </div>
        <div class="stats">
            <div class="stat-item">
                <div class="num">${totalMain}</div>
                <div class="label">主评论</div>
            </div>
            <div class="stat-item">
                <div class="num">${totalNested}</div>
                <div class="label">回复</div>
            </div>
            <div class="stat-item">
                <div class="num">${totalMain + totalNested}</div>
                <div class="label">总计</div>
            </div>
        </div>
        <div class="comments">
            ${data.map(comment => `
                <div class="comment">
                    <div class="comment-main">
                        <div class="comment-header">
                            <span class="comment-user">${comment.memberName || '匿名用户'}</span>
                            <span class="comment-time">${comment.ctime ? new Date(comment.ctime * 1000).toLocaleString() : '-'}</span>
                        </div>
                        <div class="comment-content">${(comment.comment || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                        <div class="comment-stats">
                            <span>点赞: ${comment.like || 0}</span>
                            <span>回复: ${comment.rcount || 0}</span>
                            ${comment.location ? `<span>IP属地: ${comment.location}</span>` : ''}
                        </div>
                    </div>
                    ${comment.children && comment.children.length ? `
                        <div class="comment-children">
                            ${comment.children.map(child => `
                                <div class="child-comment">
                                    <div class="comment-header">
                                        <span class="comment-user">${child.memberName || '匿名用户'}</span>
                                        <span class="comment-time">${child.ctime ? new Date(child.ctime * 1000).toLocaleString() : '-'}</span>
                                    </div>
                                    <div class="comment-content">${replaceReplyPrefix(child.comment || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                                    <div class="comment-stats">
                                        <span>点赞: ${child.like || 0}</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
    </div>
</body>
</html>`;

        // 下载 HTML 文件
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileName}.html`;
        a.click();
        URL.revokeObjectURL(url);
        addLog(`HTML 文件已保存: ${fileName}.html`);
    }

    function downloadComments(mode = 'excel') {
        const data = [];
        const entries = commentInfoMap.entries();
        for (const [key, reply] of entries) {
            const children = commentsListMap.get(key);
            data.push({
                ...reply,
                children: uniArr(children || [], 'rpid')
            });
        }

        const fileName = getDownloadFileName();
        addLog(`正在导出 ${data.length} 条评论为 ${mode.toUpperCase()} 格式...`);

        if (mode === 'html') {
            exportToHTML(data, getVideoInfo(), fileName);
        } else {
            exportToExcel(data, fileName);
        }
    }

    // ==================== UI 创建 ====================
    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'bili-comment-helper-panel';
        panel.innerHTML = `
            <div class="panel-header">
                <span>B站评论助手</span>
                <button class="panel-toggle" id="toggle-panel" title="折叠/展开">−</button>
            </div>
            <div class="panel-content">
                <div class="log-container" id="bili-helper-logs">
                    <div style="color: #999;">等待操作...</div>
                </div>

                <div class="divider"></div>
                <div class="section-title">快速爬取</div>
                <div class="btn-group">
                    <button class="btn btn-primary" id="fetch-top-300">爬取前300条</button>
                </div>
                <div class="btn-group">
                    <button class="btn btn-secondary" id="fetch-top-10-nested">爬取前10条(含回复)</button>
                </div>

                <div class="divider"></div>
                <div class="section-title">自定义数量</div>
                <div class="input-group">
                    <input type="number" id="custom-count" value="100" min="1" placeholder="条数">
                </div>
                <div class="btn-group">
                    <button class="btn btn-secondary" id="fetch-custom">爬取评论</button>
                    <button class="btn btn-secondary" id="fetch-custom-nested">含回复</button>
                </div>

                <div class="divider"></div>
                <div class="section-title">数据导出</div>
                <div class="btn-group">
                    <button class="btn btn-success" id="export-excel-btn" disabled>导出 Excel</button>
                    <button class="btn btn-secondary" id="export-html-btn" disabled>导出 HTML</button>
                </div>

                <div class="status-bar">
                    <span>已缓存: <strong id="bili-helper-count">0</strong> 条</span>
                </div>
            </div>
            <div class="loading-overlay" id="bili-helper-loading">
                <div class="loading-spinner"></div>
            </div>
        `;

        document.body.appendChild(panel);

        // 绑定事件
        let isCollapsed = false;
        document.getElementById('toggle-panel').addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            panel.classList.toggle('collapsed', isCollapsed);
            document.getElementById('toggle-panel').textContent = isCollapsed ? '+' : '−';
        });

        document.getElementById('fetch-top-300').addEventListener('click', () => {
            downloadTopComments(300);
        });

        document.getElementById('fetch-top-10-nested').addEventListener('click', () => {
            downloadCommentsWithNestedByPage(10);
        });

        document.getElementById('fetch-custom').addEventListener('click', () => {
            const count = parseInt(document.getElementById('custom-count').value) || 100;
            downloadTopComments(count);
        });

        document.getElementById('fetch-custom-nested').addEventListener('click', () => {
            const count = parseInt(document.getElementById('custom-count').value) || 10;
            downloadCommentsWithNestedByPage(count);
        });

        document.getElementById('export-excel-btn').addEventListener('click', () => {
            downloadComments('excel');
        });

        document.getElementById('export-html-btn').addEventListener('click', () => {
            downloadComments('html');
        });

        updateUI();
    }

    // ==================== 初始化 ====================
    function init() {
        console.log('%c B站评论助手 已加载！', 'color: #00a1d6; font-weight: 700; font-size: 16px;');

        // 注入网络拦截
        injectNetworkInterceptor();

        // 监听网络请求消息
        window.addEventListener('message', handleNetworkRequest);

        // 创建面板
        createPanel();

        addLog('助手已就绪，请点击按钮开始爬取评论');
    }

    // 等待页面加载完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();