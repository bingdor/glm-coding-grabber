// ==UserScript==
// @name         GLM抢号-v2
// @namespace    05info
// @author       Spanky
// @version      2.2.0
// @description  纯接口抢购 - 无DOM依赖，直接API调用
// @match        https://*.bigmodel.cn/glm-coding*
// @match        https://*.gtimg.com/*
// @match        https://*.captcha.qcloud.com/*
// @require      https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js
// @require      https://cdn.bootcdn.net/ajax/libs/qrcode/1.5.0/qrcode.min.js
// @require      https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/crypto-js.min.js
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_xmlhttpRequest
// @connect      turing.captcha.qcloud.com
// @connect      127.0.0.1:9898
// @connect      127.0.0.1
// @connect      *
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// ==/UserScript==

(function (win) {
    'use strict';

    // ==================== 检测是否在验证码 iframe 内 ====================
    var _host = '';
    try { _host = location.hostname || ''; } catch (e) {}
    var inCaptchaFrame = _host.indexOf('gtimg.com') >= 0 || _host.indexOf('captcha.qcloud.com') >= 0;

    if (inCaptchaFrame) {
        console.log('%c[CaptchaSolver] iframe 模式启动, host=' + _host, 'color:#f0c040');
        initCaptchaSolver();
        return;
    }

    // ==================== 验证码自动解题（iframe 内运行） ====================
    function initCaptchaSolver() {
        var CLICK_OCR_URL = 'http://127.0.0.1:9898/click';
        var TTSHITU_URL = 'https://api.ttshitu.com/predict';
        var TTSHITU_USER = '819062398';
        var TTSHITU_PASS = 'Spanky123';


        function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
        function log(msg) { console.log('%c[CaptchaSolver] ' + msg, 'color:#58a6ff'); }

        function fetchImage(url) {
            return new Promise(function (resolve, reject) {
                if (typeof GM_xmlhttpRequest !== 'undefined') {
                    GM_xmlhttpRequest({
                        method: 'GET', url: url, responseType: 'blob',
                        onload: function (r) {
                            var reader = new FileReader();
                            reader.onload = function () { resolve(reader.result); };
                            reader.readAsDataURL(r.response);
                        },
                        onerror: function () { reject(new Error('下载图片失败')); }
                    });
                } else {
                    fetch(url).then(function (r) { return r.blob(); })
                    .then(function (b) {
                        var reader = new FileReader();
                        reader.onload = function () { resolve(reader.result); };
                        reader.readAsDataURL(b);
                    }).catch(reject);
                }
            });
        }

        function callClickOcr(imgData, text) {
            var base64 = imgData.replace(/^data:image\/\w+;base64,/, '');
            var body = JSON.stringify({ image: base64, remark: text });
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                return new Promise(function (resolve, reject) {
                    GM_xmlhttpRequest({
                        method: 'POST', url: CLICK_OCR_URL,
                        headers: { 'Content-Type': 'application/json' },
                        data: body,
                        onload: function (r) {
                            try { resolve(JSON.parse(r.responseText)); }
                            catch (e) { reject(new Error('响应解析失败')); }
                        },
                        onerror: function () { reject(new Error('ddddocr 连接失败')); }
                    });
                });
            }
            return fetch(CLICK_OCR_URL, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body
            }).then(function (r) { return r.json(); });
        }

        function callTtshitu(imgData, text) {
            var base64 = imgData.replace(/^data:image\/\w+;base64,/, '');
            var body = JSON.stringify({
                username: TTSHITU_USER, password: TTSHITU_PASS,
                image: base64, typeid: 27, remark: text
            });
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                return new Promise(function (resolve, reject) {
                    GM_xmlhttpRequest({
                        method: 'POST', url: TTSHITU_URL,
                        headers: { 'Content-Type': 'application/json' },
                        data: body,
                        onload: function (r) {
                            try { resolve(JSON.parse(r.responseText)); }
                            catch (e) { reject(new Error('图鉴响应解析失败')); }
                        },
                        onerror: function () { reject(new Error('图鉴连接失败')); }
                    });
                });
            }
            return fetch(TTSHITU_URL, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body
            }).then(function (r) { return r.json(); });
        }

        async function ocrRecognize(imgData, text) {
            try {
                var resp = await callClickOcr(imgData, text);
                log('ddddocr: ' + JSON.stringify(resp).substring(0, 150));
                if (resp.success && resp.data && resp.data.result) {
                    return resp.data.result.split('|').map(function (p) {
                        var xy = p.split(',');
                        return { x: parseFloat(xy[0]), y: parseFloat(xy[1]) };
                    });
                }
            } catch (e) { log('ddddocr 失败: ' + e.message); }
            try {
                var resp2 = await callTtshitu(imgData, text);
                if (resp2.code === 0 && resp2.data && resp2.data.result) {
                    return resp2.data.result.split(',').map(function (p) {
                        var xy = p.split('|');
                        return { x: parseInt(xy[0], 10), y: parseInt(xy[1], 10) };
                    });
                }
            } catch (e) { log('图鉴失败: ' + e.message); }
            return [];
        }

        function getImageSize(dataUrl) {
            return new Promise(function (resolve) {
                var img = new Image();
                img.onload = function () { resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
                img.onerror = function () { resolve(null); };
                img.src = dataUrl;
            });
        }

        function simulateClick(el, x, y, imgW, imgH) {
            var rect = el.getBoundingClientRect();
            var scaleX = imgW > 0 ? rect.width / imgW : 1;
            var scaleY = imgH > 0 ? rect.height / imgH : 1;
            var cx = rect.left + x * scaleX;
            var cy = rect.top + y * scaleY;
            var win = el.ownerDocument.defaultView || window;

            var base = { clientX: cx, clientY: cy, bubbles: true, cancelable: true, view: win };
            var pointer = Object.assign({}, base, {
                pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, pressure: 0.5
            });

            try { if (win.PointerEvent) el.dispatchEvent(new win.PointerEvent('pointerdown', pointer)); } catch (e) {}
            el.dispatchEvent(new win.MouseEvent('mousedown', base));
            try { if (win.PointerEvent) el.dispatchEvent(new win.PointerEvent('pointerup', pointer)); } catch (e) {}
            el.dispatchEvent(new win.MouseEvent('mouseup', base));
            el.dispatchEvent(new win.MouseEvent('click', base));
        }

        function isSolved() {
            var el = document.querySelector('.tc-success');
            return el && el.style.visibility !== 'hidden' && el.style.visibility !== '';
        }

        function hasError() {
            var noteEl = document.querySelector('#tcaptcha_note');
            if (!noteEl) return false;
            var noteWrap = noteEl.closest('.tc-note');
            return noteWrap && noteWrap.style.visibility !== 'hidden' && noteWrap.style.visibility !== '';
        }

        var solving = false;
        var lastBgUrl = '';

        async function trySolveOnce() {
            var bgEl = document.querySelector('#slideBg');
            if (!bgEl) return 'wait';

            var bgStyle = bgEl.style.backgroundImage || '';
            var match = bgStyle.match(/url\(["']?([^"')]+)/);
            if (!match) return 'wait';

            if (isSolved()) return 'solved';

            if (hasError()) {
                log('错误提示，刷新');
                var rb = document.querySelector('#reload');
                if (rb) rb.click();
                lastBgUrl = '';
                await sleep(1500);
                return 'retry';
            }

            var bgUrl = match[1];
            if (bgUrl === lastBgUrl) return 'same';
            lastBgUrl = bgUrl;

            var instrEl = document.querySelector('#instructionText');
            if (!instrEl) return 'wait';
            var rawText = instrEl.textContent || '';
            if (rawText.indexOf('错误') >= 0 || rawText.indexOf('重试') >= 0 || rawText.indexOf('失败') >= 0) {
                log('错误文本，刷新');
                var rb2 = document.querySelector('#reload');
                if (rb2) rb2.click();
                lastBgUrl = '';
                await sleep(1500);
                return 'retry';
            }
            var text = rawText.replace(/请依次点击[：:]\s*/, '').replace(/\s+/g, '').trim();
            log('目标字符: ' + text);

            var imgData;
            try { imgData = await fetchImage(bgUrl); }
            catch (e) { log('图片下载失败: ' + e.message); return 'retry'; }

            var imgSize = await getImageSize(imgData);
            var imgW = imgSize ? imgSize.w : 340;
            var imgH = imgSize ? imgSize.h : 195;

            var coords = await ocrRecognize(imgData, text);
            if (!coords || coords.length === 0) { log('OCR 无结果'); return 'retry'; }

            log('坐标: ' + coords.map(function (c) { return c.x + ',' + c.y; }).join(' | ') + ' (' + imgW + 'x' + imgH + ')');

            for (var i = 0; i < coords.length; i++) {
                simulateClick(bgEl, coords[i].x, coords[i].y, imgW, imgH);
                await sleep(150);
            }

            await sleep(300);
            var confirmBtn = document.querySelector('.verify-btn');
            if (confirmBtn) confirmBtn.click();
            return 'clicked';
        }

        async function solveCurrentCaptcha() {
            if (solving) return;
            solving = true;
            for (var i = 0; i < 15; i++) {
                if (isSolved()) { log('验证通过!'); solving = false; return; }
                var result = await trySolveOnce();
                if (result === 'solved') { log('验证通过!'); solving = false; return; }
                if (result === 'same' || result === 'wait') { await sleep(800); continue; }
                if (result === 'clicked') {
                    await sleep(1500);
                    if (isSolved()) { log('验证通过!'); solving = false; return; }
                    if (hasError()) {
                        log('识别错误，刷新重试');
                        var refreshBtn = document.querySelector('#reload');
                        if (refreshBtn) refreshBtn.click();
                        lastBgUrl = '';
                        await sleep(1500);
                    }
                    continue;
                }
                await sleep(800);
            }
            solving = false;
        }

        function checkAndSolve() {
            if (solving || isSolved()) return;
            var bgEl = document.querySelector('#slideBg');
            if (!bgEl) return;
            var bgStyle = bgEl.style.backgroundImage || '';
            if (!bgStyle) return;
            solveCurrentCaptcha();
        }

        log('验证码解题器已启动 (持续监听, GM=' + (typeof GM_xmlhttpRequest !== 'undefined') + ')');
        var observer = new MutationObserver(function () { setTimeout(checkAndSolve, 100); });
        observer.observe(document.body || document.documentElement, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['style']
        });
        setTimeout(checkAndSolve, 1000);
        setInterval(checkAndSolve, 2000);
    }

    // ==================== 产品ID映射（静态默认值，会被 batch-preview 动态更新） ====================
    // productId -> 静态配置（unit/type 用于分类）
    var PRODUCT_STATIC = {
        'product-02434c': { unit: 'month',   type: 'lite', name: 'Lite 月付' },
        'product-1df3e1': { unit: 'month',   type: 'pro',  name: 'Pro 月付'  },
        'product-2fc421': { unit: 'month',   type: 'max',  name: 'Max 月付'  },
        'product-b8ea38': { unit: 'quarter', type: 'lite', name: 'Lite 季付' },
        'product-fef82f': { unit: 'quarter', type: 'pro',  name: 'Pro 季付'  },
        'product-5d3a03': { unit: 'quarter', type: 'max',  name: 'Max 季付'  },
        'product-70a804': { unit: 'year',    type: 'lite', name: 'Lite 年付' },
        'product-5643e6': { unit: 'year',    type: 'pro',  name: 'Pro 年付'  },
        'product-d46f8b': { unit: 'year',    type: 'max',  name: 'Max 年付'  }
    };

    var PRODUCTS = {
        month: {
            lite: { productId: 'product-02434c', name: 'Lite 月付', price: 49,   soldOut: true },
            pro:  { productId: 'product-1df3e1', name: 'Pro 月付',  price: 149,  soldOut: true },
            max:  { productId: 'product-2fc421', name: 'Max 月付',  price: 469,  soldOut: true }
        },
        quarter: {
            lite: { productId: 'product-b8ea38', name: 'Lite 季付', price: 147,  soldOut: true },
            pro:  { productId: 'product-fef82f', name: 'Pro 季付',  price: 447,  soldOut: true },
            max:  { productId: 'product-5d3a03', name: 'Max 季付',  price: 1407, soldOut: true }
        },
        year: {
            lite: { productId: 'product-70a804', name: 'Lite 年付', price: 588,  soldOut: true },
            pro:  { productId: 'product-5643e6', name: 'Pro 年付',  price: 1788, soldOut: true },
            max:  { productId: 'product-d46f8b', name: 'Max 年付',  price: 5628, soldOut: true }
        }
    };

    // 用 batch-preview 响应动态更新 PRODUCTS
    function updateProductsFromBatchPreview(productList) {
        if (!Array.isArray(productList)) return;
        var updated = 0;
        productList.forEach(function (p) {
            var staticInfo = PRODUCT_STATIC[p.productId];
            if (!staticInfo) return;
            var target = PRODUCTS[staticInfo.unit] && PRODUCTS[staticInfo.unit][staticInfo.type];
            if (!target) return;
            target.price = p.originalAmount || target.price;
            target.payAmount = p.payAmount;
            target.soldOut = !!p.soldOut;
            target.renewAmount = p.renewAmount;
            updated++;
        });
        log('产品', '已更新 ' + updated + ' 个产品价格/库存');
    }

    // ==================== 配置 ====================
    var CONFIG = {
        BUY_TIME_DEFAULT: '10:00:00',
        PACKAGE_TYPE_DEFAULT: 'quarter',
        TIER_DEFAULT: 'max',
        INVITATION_CODE: 'HX44VX6Q0S',
        CAPTCHA_APP_ID: '196026326',
        OCR_BACKEND: 'ddddocr',
        DDDDOCR_URL: 'http://127.0.0.1:9898/click',
        TTSHITU_USERNAME: '819062398',
        TTSHITU_PASSWORD: 'Spanky123',
        TTSHITU_TYPEID: 27,
        CAPTCHA_MAX_RETRY: 10,
        RETRY_ON_BUSY: 3,
        RETRY_INTERVAL: 300,
        // 每轮流水线解几个验证码（解一个立即发 preview，不等结果）
        CONCURRENT_ATTEMPTS: 3,
        ENABLE_MANUAL_BIZID: false
    };

    // ==================== 状态 ====================
    var state = {
        running: false,
        timer: null,
        captchaHandling: false,
        userInfo: null,
        customerNumber: null,
        cachedTokens: [],
        lockOrderDone: false,
        lockOrderInProgress: false,
        precacheRunning: false
    };

    // ==================== 服务器时间同步 ====================
    var serverTimeOffset = 0; // ms, positive = server ahead

    async function measureServerOffset() {
        var offsets = [];
        for (var i = 0; i < 5; i++) {
            try {
                var t0 = performance.now();
                var wallBefore = Date.now();
                var resp = await fetch(location.origin + '/', {
                    method: 'HEAD', credentials: 'include', cache: 'no-store'
                });
                var t1 = performance.now();
                var dateStr = resp.headers.get('Date');
                if (!dateStr) continue;
                var serverTs = new Date(dateStr).getTime();
                var rtt = t1 - t0;
                var localMid = wallBefore + rtt / 2;
                offsets.push(serverTs - localMid);
            } catch (e) {
                log('时间同步', '采样失败: ' + e.message);
            }
            if (i < 4) await sleep(300);
        }
        if (offsets.length === 0) return 0;
        offsets.sort(function(a, b) { return a - b; });
        return offsets[Math.floor(offsets.length / 2)];
    }

    async function syncServerTime() {
        var offset = await measureServerOffset();
        serverTimeOffset = offset;
        var direction = offset > 0 ? '服务器快' : '本机快';
        log('时间同步', 'offset=' + offset.toFixed(0) + 'ms (' + direction + Math.abs(offset).toFixed(0) + 'ms)');
        // 面板上永久显示偏移量
        var offsetEl = document.getElementById('v2-time-offset');
        if (offsetEl) {
            offsetEl.textContent = (offset > 0 ? '+' : '') + (offset / 1000).toFixed(2) + 's';
            offsetEl.title = '时钟偏移: ' + direction + Math.abs(offset).toFixed(0) + 'ms';
        }
    }

    function getServerTime() {
        return Date.now() + serverTimeOffset;
    }

    // ==================== 连接预热 ====================
    var preheatTimer = null;

    function startConnectionPreheat() {
        if (preheatTimer) return;
        log('预热', '开始连接预热 (每2s一次 batch-preview)');
        preheatTimer = setInterval(function() {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/biz/pay/batch-preview');
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify({ invitationCode: getQueryString('ic') || CONFIG.INVITATION_CODE }));
        }, 2000);
    }

    function stopConnectionPreheat() {
        if (preheatTimer) {
            clearInterval(preheatTimer);
            preheatTimer = null;
            log('预热', '停止连接预热');
        }
    }

    var TOKEN_MAX_AGE = 180000;

    // ==================== 工具函数 ====================
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function log(tag, msg) {
        var time = new Date().toLocaleTimeString();
        console.log('[' + time + '][' + tag + '] ' + msg);
        updateLog(tag + ': ' + msg);
    }

    function getQueryString(name) {
        var reg = new RegExp('(^|&)' + name + '=([^&]*)(&|$)', 'i');
        var r = window.location.search.substr(1).match(reg);
        return r ? decodeURI(r[2]) : null;
    }

    // ==================== Auth ====================
    // Token 存在 cookie: bigmodel_token_production
    // OrgId / ProjectId 存在 localStorage
    var AUTH_COOKIE_KEY = 'bigmodel_token_production';
    var ORG_LS_KEY = 'Bigmodel-Organization';
    var PROJECT_LS_KEY = 'Bigmodel-Project';

    function getCookie(name) {
        var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : '';
    }

    function getAuthHeaders() {
        var token = getCookie(AUTH_COOKIE_KEY);
        var orgId = localStorage.getItem(ORG_LS_KEY) || '';
        var projectId = localStorage.getItem(PROJECT_LS_KEY) || '';
        var headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = token;
            headers['Bigmodel-Organization'] = orgId;
            headers['Bigmodel-Project'] = projectId;
        }
        return headers;
    }

    // ==================== API 调用 ====================
    function apiRequest(method, url, data) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open(method, '/api' + url);
            var headers = getAuthHeaders();
            for (var key in headers) {
                xhr.setRequestHeader(key, headers[key]);
            }
            xhr.onload = function () {
                try {
                    var resp = JSON.parse(xhr.responseText);
                    resolve(resp);
                } catch (e) {
                    reject(new Error('非JSON响应: HTTP ' + xhr.status));
                }
            };
            xhr.onerror = function () { reject(new Error('网络错误')); };
            if (data) {
                xhr.send(JSON.stringify(data));
            } else {
                xhr.send();
            }
        });
    }

    // 获取用户信息
    function fetchCustomerInfo() {
        return apiRequest('GET', '/biz/customer/getCustomerInfo');
    }

    // 批量预览（获取各产品最新价格和售卖状态）
    function fetchBatchPreview(params) {
        return apiRequest('POST', '/biz/pay/batch-preview', params);
    }

    // 单个产品预览（验证码通过后调用，获取 bizId）
    function fetchPreview(params) {
        return apiRequest('POST', '/biz/pay/preview', params);
    }

    // 查询支付状态
    function fetchPayStatus(bizId) {
        return apiRequest('GET', '/biz/pay/status?key=' + encodeURIComponent(bizId));
    }

    // 锁单（create-sign）
    function tryLockOrder(previewData) {
        return new Promise(function (resolve) {
            if (state.lockOrderInProgress || state.lockOrderDone) {
                resolve({ success: false, code: 'SKIP', msg: state.lockOrderDone ? '已锁单' : '锁单进行中' });
                return;
            }
            state.lockOrderInProgress = true;

            var customerId = state.customerNumber;
            if (!customerId) {
                log('锁单', '无法获取 customerId');
                state.lockOrderInProgress = false;
                resolve({ success: false, code: 'NO_CUSTOMER', msg: '无法获取 customerId' });
                return;
            }

            var invitationCode = getQueryString('ic') || CONFIG.INVITATION_CODE;
            var signUrl = previewData.lastSubscriptionSummary ? '/biz/pay/product/update/sign' : '/biz/pay/create-sign';

            apiRequest('POST', signUrl, {
                payType: 'ALI',
                productId: previewData.productId,
                customerId: customerId,
                bizId: previewData.bizId,
                invitationCode: invitationCode
            }).then(function (resp) {
                state.lockOrderInProgress = false;
                if (resp.code === 200 && resp.data && resp.data.sign) {
                    state.lockOrderDone = true;
                    log('锁单', '成功！bizId=' + previewData.bizId);
                    resolve({ success: true, sign: resp.data.sign, raw: resp });
                } else {
                    log('锁单', '失败: ' + (resp.msg || resp.code));
                    resolve({ success: false, code: resp.code, msg: resp.msg, raw: resp });
                }
            }).catch(function (e) {
                state.lockOrderInProgress = false;
                log('锁单', '异常: ' + e.message);
                resolve({ success: false, code: 'ERR', msg: e.message, raw: null });
            });
        });
    }

    // 展示锁单后的支付二维码
    function showPaymentQRPopup(signUrl, priceData) {
        var amount = priceData.payAmount || priceData.thirdPartyAmount;

        // @require 加载的 QRCode 在油猴沙箱全局，不在 unsafeWindow 上
        var QR = (typeof QRCode !== 'undefined') ? QRCode
            : (typeof win.QRCode !== 'undefined') ? win.QRCode : null;

        if (!QR) {
            log('支付', 'QRCode 库未就绪，回退到官方二维码');
            generatePayQRCode(priceData, { name: '' });
            return;
        }

        QR.toDataURL(signUrl, {
            width: 600, margin: 4, errorCorrectionLevel: 'L'
        }, function (err, qrDataUrl) {
            if (err) {
                log('支付', 'QR生成失败: ' + err.message);
                generatePayQRCode(priceData, { name: '' });
                return;
            }
            var newWin = window.open('', '_blank');
            if (newWin) {
                newWin.document.write(
                    '<html><head><title>支付宝扫码支付</title><style>' +
                    'body{display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;}' +
                    'img{width:min(500px,90vmin);height:min(500px,90vmin);aspect-ratio:1/1;}' +
                    'h2{color:#333;}.price{color:#e6a23c;font-size:28px;font-weight:bold;}' +
                    '.tip{color:#999;font-size:14px;margin-top:12px;}' +
                    '</style></head>' +
                    '<body><div style="text-align:center;">' +
                    '<h2>锁单成功！请用支付宝扫码</h2>' +
                    '<p class="price">&yen;' + amount + '</p>' +
                    '<img src="' + qrDataUrl + '" />' +
                    '<p class="tip">请尽量靠近屏幕扫码</p>' +
                    '</div></body></html>'
                );
            }
            log('支付', '锁单二维码已打开');
        });
    }
    win.showPaymentQRPopup = showPaymentQRPopup;


    // ==================== 验证码识别 ====================
    function fetchImageBase64(url) {
        return new Promise(function (resolve, reject) {
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    responseType: 'blob',
                    onload: function (res) {
                        var reader = new FileReader();
                        reader.onloadend = function () {
                            resolve(String(reader.result).split(',')[1]);
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(res.response);
                    },
                    onerror: reject
                });
            } else {
                fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
                    var reader = new FileReader();
                    reader.onloadend = function () { resolve(String(reader.result).split(',')[1]); };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                }).catch(reject);
            }
        });
    }

    function getImageSize(base64) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
            img.onerror = reject;
            img.src = 'data:image/png;base64,' + base64;
        });
    }

    function ddddocrRecognize(base64, chars) {
        return new Promise(function (resolve, reject) {
            var payload = JSON.stringify({ image: base64, remark: chars });
            var fallback = function (reason) {
                console.warn('[ddddocr] 失败，降级到图鉴: ' + reason);
                ttshituRecognize(base64, chars).then(resolve).catch(reject);
            };
            var handleRes = function (text) {
                try {
                    var obj = JSON.parse(text);
                    if (obj.success && obj.data && obj.data.result) {
                        var points = obj.data.result.split('|').map(function (p) {
                            var xy = p.split(',');
                            return { x: parseFloat(xy[0]), y: parseFloat(xy[1]) };
                        });
                        resolve({ id: obj.data.id || '', points: points });
                    } else {
                        fallback(text);
                    }
                } catch (e) { fallback(e.message); }
            };
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: CONFIG.DDDDOCR_URL,
                    headers: { 'Content-Type': 'application/json' },
                    data: payload,
                    onload: function (res) { handleRes(res.responseText); },
                    onerror: function () {
                        console.warn('[ddddocr] 不可用，降级到图鉴');
                        ttshituRecognize(base64, chars).then(resolve).catch(reject);
                    }
                });
            } else {
                fetch(CONFIG.DDDDOCR_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload
                }).then(function (r) { return r.text(); }).then(handleRes).catch(function () {
                    ttshituRecognize(base64, chars).then(resolve).catch(reject);
                });
            }
        });
    }

    function ttshituRecognize(base64, chars) {
        return new Promise(function (resolve, reject) {
            var payload = JSON.stringify({
                username: CONFIG.TTSHITU_USERNAME,
                password: CONFIG.TTSHITU_PASSWORD,
                typeid: CONFIG.TTSHITU_TYPEID,
                image: base64,
                remark: chars
            });
            var handleRes = function (text) {
                try {
                    var obj = JSON.parse(text);
                    if (obj.success && obj.data && obj.data.result) {
                        var points = obj.data.result.split('|').map(function (p) {
                            var xy = p.split(',');
                            return { x: parseFloat(xy[0]), y: parseFloat(xy[1]) };
                        });
                        resolve({ id: obj.data.id, points: points });
                    } else {
                        reject(new Error('ttshitu fail: ' + text));
                    }
                } catch (e) { reject(e); }
            };
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'http://api.ttshitu.com/predict',
                    headers: { 'Content-Type': 'application/json' },
                    data: payload,
                    onload: function (res) { handleRes(res.responseText); },
                    onerror: reject
                });
            } else {
                fetch('http://api.ttshitu.com/predict', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload
                }).then(function (r) { return r.text(); }).then(handleRes).catch(reject);
            }
        });
    }

    function recognizeCaptcha(base64, chars) {
        if (CONFIG.OCR_BACKEND === 'ddddocr') {
            return ddddocrRecognize(base64, chars);
        }
        return ttshituRecognize(base64, chars);
    }

    // ==================== 腾讯验证码交互 ====================
    // 核心：通过 TencentCaptcha SDK 弹出验证码，用户完成后拿到 ticket+randstr
    // 同时尝试自动识别点选验证码

    // 获取 TencentCaptcha 构造函数（兼容油猴沙箱）
    function getTencentCaptcha() {
        return win.TencentCaptcha || window.TencentCaptcha || null;
    }

    function loadCaptchaScript() {
        return new Promise(function (resolve, reject) {
            if (getTencentCaptcha()) {
                resolve();
                return;
            }
            // 页面可能已经在加载，先等一等
            var waitCount = 0;
            var waitTimer = setInterval(function () {
                waitCount++;
                if (getTencentCaptcha()) {
                    clearInterval(waitTimer);
                    resolve();
                    return;
                }
                if (waitCount > 10) {
                    clearInterval(waitTimer);
                    // 手动加载
                    var script = document.createElement('script');
                    script.src = 'https://turing.captcha.qcloud.com/TCaptcha.js';
                    script.onload = function () {
                        // 等 SDK 初始化
                        setTimeout(function () {
                            if (getTencentCaptcha()) resolve();
                            else reject(new Error('TencentCaptcha SDK 加载后未初始化'));
                        }, 500);
                    };
                    script.onerror = function () { reject(new Error('TCaptcha.js 加载失败')); };
                    document.head.appendChild(script);
                }
            }, 500);
        });
    }

    // 弹出腾讯验证码并获取 ticket（自动识别+点击）
    function getCaptchaTicket() {
        return new Promise(function (resolve, reject) {
            var TC = getTencentCaptcha();
            if (!TC) {
                reject(new Error('验证码SDK未加载'));
                return;
            }

            var done = false;
            var captchaInstance = new TC(CONFIG.CAPTCHA_APP_ID, function (res) {
                done = true;
                clearTimeout(safetyTimer);
                if (res.ret === 0) {
                    resolve({ ticket: res.ticket, randstr: res.randstr });
                } else if (res.ret === 2) {
                    reject(new Error('用户取消验证'));
                } else {
                    reject(new Error('验证失败: ret=' + res.ret));
                }
            }, {
                mode: 'bind',
                type: 'popup',
                enableDarkMode: false,
                timeout: 60000
            });

            captchaInstance.show();

            // 兜底超时：如果 SDK 120 秒内没有回调，主动 reject
            var safetyTimer = setTimeout(function () {
                if (!done) {
                    done = true;
                    reject(new Error('验证码超时(120s)'));
                }
            }, 120000);

            // 延时启动自动识别（等验证码弹窗渲染完成）
            setTimeout(function () {
                if (!done) {
                    autoSolveCaptchaLoop(function () { return done; });
                }
            }, 800);
        });
    }

    // 自动识别验证码循环
    async function autoSolveCaptchaLoop(isDone) {
        for (var attempt = 0; attempt < CONFIG.CAPTCHA_MAX_RETRY; attempt++) {
            if (isDone()) return;

            try {
                log('验证码', '自动识别第 ' + (attempt + 1) + '/' + CONFIG.CAPTCHA_MAX_RETRY + ' 次');
                await autoSolveCaptchaOnce(isDone);

                // 等待结果
                await sleep(300);
                if (isDone()) {
                    log('验证码', '自动识别成功');
                    return;
                }

                // 检查是否有错误提示
                var errorEl = document.querySelector('.tencent-captcha-dy__verify-error-text');
                if (errorEl && isElementTrulyVisible(errorEl)) {
                    log('验证码', '识别错误，刷新重试');
                    var refreshBtn = document.querySelector('.tencent-captcha-dy__footer-icon--refresh img');
                    if (refreshBtn) refreshBtn.click();
                    await sleep(1000);
                    continue;
                }
            } catch (e) {
                log('验证码', '自动识别异常: ' + e.message);
                if (isDone()) return;
                await sleep(500);
            }
        }
        // 所有尝试用尽，不等待手动，直接 destroy 让上层重试
        log('验证码', '自动识别用尽，关闭验证码重新开始');
        try {
            var closeBtn = document.querySelector('.tencent-captcha-dy__close-btn') ||
                document.querySelector('#tcaptcha_transform_dy .close-btn');
            if (closeBtn) closeBtn.click();
        } catch (e) {}
    }

    // 单次自动识别
    async function autoSolveCaptchaOnce(isDone) {
        var bgEl = document.querySelector('.tencent-captcha-dy__verify-bg-img');
        if (!bgEl || !isElementTrulyVisible(bgEl)) {
            throw new Error('验证码未显示');
        }

        var bgImage = bgEl.style.backgroundImage || '';
        if (bgImage.indexOf('url(') === -1) {
            throw new Error('验证码背景图未加载');
        }

        // 提取提示汉字
        var headerEl = document.querySelector('.tencent-captcha-dy__header-text');
        if (!headerEl) throw new Error('未找到提示文字');
        var text = headerEl.textContent || '';
        var allChars = text.match(/[\u4e00-\u9fa5]/g) || [];
        var chars = allChars.filter(function (c) { return '请依次点击'.indexOf(c) < 0; }).join('');
        if (!chars) throw new Error('未提取到汉字');

        // 提取背景图 URL
        var urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
        if (!urlMatch) throw new Error('未提取到背景图URL');
        var bgUrl = urlMatch[1];

        log('验证码', '汉字: ' + chars);

        // 下载+识别
        var t0 = performance.now();
        var base64 = await fetchImageBase64(bgUrl);
        var size = await getImageSize(base64);
        var result = await recognizeCaptcha(base64, chars);
        log('验证码', 'OCR耗时: ' + (performance.now() - t0).toFixed(0) + 'ms');

        if (isDone()) return;

        // 模拟点击
        for (var i = 0; i < result.points.length; i++) {
            if (isDone()) return;
            clickOnCaptchaImage(bgEl, result.points[i], size);
            await sleep(120);
        }

        // 点击确认
        await sleep(100);
        var confirmBtn = document.querySelector('.tencent-captcha-dy__verify-confirm-btn');
        if (confirmBtn && !isDone()) {
            confirmBtn.click();
        }
    }

    // 在验证码图片上模拟点击
    function clickOnCaptchaImage(bgEl, point, imgSize) {
        var rect = bgEl.getBoundingClientRect();
        var scaleX = rect.width / imgSize.w;
        var scaleY = rect.height / imgSize.h;
        var clientX = rect.left + point.x * scaleX;
        var clientY = rect.top + point.y * scaleY;

        var baseOpts = {
            bubbles: true, cancelable: true,
            clientX: clientX, clientY: clientY,
            screenX: clientX, screenY: clientY,
            button: 0, buttons: 1
        };
        var pointerOpts = Object.assign({}, baseOpts, {
            pointerId: 1, pointerType: 'mouse', isPrimary: true,
            width: 1, height: 1, pressure: 0.5
        });

        bgEl.dispatchEvent(new MouseEvent('mouseover', baseOpts));
        bgEl.dispatchEvent(new MouseEvent('mousemove', baseOpts));
        if (window.PointerEvent) {
            bgEl.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
        }
        bgEl.dispatchEvent(new MouseEvent('mousedown', baseOpts));
        if (window.PointerEvent) {
            bgEl.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
        }
        bgEl.dispatchEvent(new MouseEvent('mouseup', baseOpts));
        bgEl.dispatchEvent(new MouseEvent('click', baseOpts));
    }

    function isElementTrulyVisible(el) {
        if (!el) return false;
        var node = el;
        while (node && node.nodeType === 1) {
            var style = window.getComputedStyle(node);
            if (style.display === 'none') return false;
            if (style.visibility === 'hidden') return false;
            if (parseFloat(style.opacity) === 0) return false;
            node = node.parentElement;
        }
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (rect.right <= 0 || rect.bottom <= 0) return false;
        if (rect.left >= window.innerWidth || rect.top >= window.innerHeight) return false;
        return true;
    }

    // ==================== Token 预存管理 ====================
    function addCachedToken(ticket, randstr) {
        state.cachedTokens.push({
            ticket: ticket,
            randstr: randstr,
            timestamp: Date.now()
        });
        updateTokenDisplay();
    }

    function getValidCachedTokens() {
        var now = Date.now();
        return state.cachedTokens.filter(function (t) {
            return (now - t.timestamp) < TOKEN_MAX_AGE && !t.previewSent;
        });
    }

    function clearCachedTokens() {
        state.cachedTokens = [];
        updateTokenDisplay();
        log('预存', '已清空');
    }

    function updateTokenDisplay() {
        var tbody = document.getElementById('v2-token-tbody');
        if (!tbody) return;

        var tokens = state.cachedTokens;
        var html = '';
        tokens.forEach(function (t, i) {
            var short = t.ticket.substring(0, 8);
            var now = Date.now();
            var expired = t.source !== '实时' && (now - t.timestamp) >= TOKEN_MAX_AGE;
            var cls = expired ? ' v2-token-expired' : '';

            // 请求时间：优先用 previewSentTime，否则用 timestamp
            var timeStr = t.previewSentTime
                ? new Date(t.previewSentTime).toLocaleTimeString()
                : new Date(t.timestamp).toLocaleTimeString();

            var sourceTag = t.source === '实时'
                ? '<span class="v2-tag v2-tag-sending">实时</span>'
                : '';

            var previewText = '-';
            if (t.previewResult) {
                if (t.previewResult.success) previewText = '<span class="v2-tag v2-tag-ok">成功</span>';
                else if (t.previewResult.soldOut) previewText = '<span class="v2-tag v2-tag-warn">售罄</span>';
                else previewText = '<span class="v2-tag v2-tag-err">' + (t.previewResult.code || '?') + '</span>';
            } else if (t.previewSent) {
                previewText = '<span class="v2-tag v2-tag-sending">...</span>';
            }

            var lockText = '-';
            if (t.lockResult) {
                if (t.lockResult.success) lockText = '<span class="v2-tag v2-tag-ok">已锁</span>';
                else {
                    var errTag = t.lockResult.raw ? (t.lockResult.raw.code || 'ERR') : '失败';
                    lockText = '<span class="v2-tag v2-tag-err" title="' + (t.lockResult.raw ? (t.lockResult.raw.msg || '') : '') + '">' + errTag + '</span>';
                }
            }

            var hasDetail = t.previewResult || t.lockResult;
            var clickAttr = hasDetail
                ? ' style="cursor:pointer;" onclick="window.__v2ShowDetail(' + i + ')"'
                : '';

            html += '<tr class="' + cls + '"' + clickAttr + '>' +
                '<td>' + (i + 1) + sourceTag + '</td>' +
                '<td title="' + t.ticket + '">' + short + '</td>' +
                '<td>' + timeStr + '</td>' +
                '<td>' + previewText + '</td>' +
                '<td>' + lockText + '</td>' +
                '</tr>';
        });
        if (tokens.length === 0) {
            html = '<tr><td colspan="5" class="v2-token-empty">暂无记录</td></tr>';
        }
        tbody.innerHTML = html;

        var countEl = document.getElementById('v2-token-count');
        if (countEl) {
            var validCount = getValidCachedTokens().length;
            countEl.textContent = validCount + '/' + tokens.length;
        }
        // 自动滚到底部
        if (tbody.scrollHeight > tbody.clientHeight) {
            tbody.scrollTop = tbody.scrollHeight;
        }
    }

    // 点击表格行展示详情
    win.__v2ShowDetail = function (idx) {
        var t = state.cachedTokens[idx];
        if (!t) return;
        var lines = [];
        lines.push('=== Token #' + (idx + 1) + ' ===');
        lines.push('ticket:  ' + t.ticket);
        lines.push('randstr: ' + t.randstr);
        lines.push('预存时间: ' + new Date(t.timestamp).toLocaleTimeString());
        lines.push('');
        if (t.previewResult) {
            lines.push('=== Preview 响应 ===');
            lines.push(JSON.stringify(t.previewResult.raw, null, 2));
        }
        if (t.lockResult) {
            lines.push('');
            lines.push('=== 锁单结果 ===');
            lines.push(t.lockResult.success ? '成功' : '失败: ' + (t.lockResult.msg || t.lockResult.code || '?'));
            if (t.lockResult.raw) {
                lines.push(JSON.stringify(t.lockResult.raw, null, 2));
            }
        }
        var overlay = document.getElementById('v2-detail-overlay');
        var title = document.getElementById('v2-detail-title');
        var body = document.getElementById('v2-detail-body');
        if (overlay && title && body) {
            title.textContent = 'Token #' + (idx + 1);
            body.textContent = lines.join('\n');
            overlay.style.display = 'flex';
        }
    };

    // 定时刷新 token 显示（检查过期状态）
    var tokenDisplayTimer = null;
    function startTokenDisplayRefresh() {
        if (tokenDisplayTimer) clearInterval(tokenDisplayTimer);
        tokenDisplayTimer = setInterval(function () {
            if (state.cachedTokens.length > 0) {
                updateTokenDisplay();
            }
        }, 10000);
    }

    async function precacheOneToken() {
        if (!getTencentCaptcha()) {
            log('预存', '验证码SDK未就绪');
            return false;
        }
        try {
            log('预存', '弹出验证码...');
            var result = await getCaptchaTicket();
            addCachedToken(result.ticket, result.randstr);
            log('预存', '成功！ticket: ' + result.ticket.substring(0, 20) + '...');
            return true;
        } catch (e) {
            log('预存', '失败: ' + e.message);
            return false;
        }
    }

    async function precacheTokens(count) {
        state.precacheRunning = true;
        updatePrecacheBtn(true);
        for (var i = 0; i < count; i++) {
            if (!state.precacheRunning) break;
            var success = await precacheOneToken();
            if (!success) {
                log('预存', '第 ' + (i + 1) + ' 个失败，停止');
                break;
            }
            log('预存', '进度: ' + (i + 1) + '/' + count);
            if (i < count - 1) await sleep(800);
        }
        state.precacheRunning = false;
        updatePrecacheBtn(false);
    }

    function stopPrecache() {
        state.precacheRunning = false;
        updatePrecacheBtn(false);
        log('预存', '已停止');
    }

    function updatePrecacheBtn(running) {
        var btn = document.getElementById('v2-precache-btn');
        if (btn) {
            btn.textContent = running ? '停止' : '预存';
            btn.className = running ? 'v2-btn v2-btn-danger' : 'v2-btn v2-btn-secondary';
        }
    }

    function getTargetPrecacheCount() {
        var el = document.getElementById('v2-precache-count');
        return el ? (parseInt(el.value, 10) || 5) : 5;
    }

    function getManualBizId() {
        var el = document.getElementById('v2-manual-bizid');
        return el ? el.value.trim() : '';
    }

    // ==================== 触发 Vue 原生支付弹窗 ====================
    function triggerVuePayDialog(previewData) {
        try {
            var payRef = win.vueApp && win.vueApp.$refs && win.vueApp.$refs.payComponentRef;
            if (!payRef) {
                log('支付', 'Vue payRef 未找到，仅使用自定义弹窗');
                return;
            }
            payRef.isServerBusy = false;
            payRef.isSoldOut = false;
            payRef.captchaVerified = true;
            setTimeout(function () { payRef.priceData = previewData; }, 100);
            try { payRef.getPayStatusFn(); } catch (e) {}
            log('支付', '已触发 Vue 原生支付弹窗');
        } catch (e) {
            log('支付', '触发 Vue 弹窗失败: ' + e.message);
        }
    }

    // ==================== 截取官方 canvas 二维码 ====================
    async function generatePayQRCode(previewData, productInfo) {
        log('支付', '支付金额: ¥' + previewData.thirdPartyAmount);
        log('支付', 'bizId: ' + previewData.bizId);

        // 触发 Vue 原生支付弹窗，等待官方二维码 canvas 渲染
        triggerVuePayDialog(previewData);

        // 轮询等待 canvas 渲染完成
        var qrCanvas = null;
        for (var i = 0; i < 50; i++) {
            await sleep(200);
            qrCanvas = document.querySelector('.scan-qrcode-box canvas');
            if (qrCanvas && qrCanvas.width > 0 && qrCanvas.height > 0) {
                break;
            }
        }

        if (!qrCanvas || qrCanvas.width === 0 || qrCanvas.height === 0) {
            log('支付', '官方二维码未渲染，请手动查看页面弹窗');
            return;
        }

        var dataUrl = qrCanvas.toDataURL('image/png');
        var amount = previewData.thirdPartyAmount;
        var productName = productInfo.name || '';

        // 新窗口展示官方二维码
        try {
            var newWin = window.open('', '_blank');
            if (newWin) {
                newWin.document.write(
                    '<html><head><title>支付二维码</title></head>' +
                    '<body style="display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;">' +
                    '<div style="text-align:center;">' +
                    '<h2 style="color:#333;">请使用支付宝扫码支付' + (productName ? ' - ' + productName : '') + '</h2>' +
                    '<p style="color:#e6a23c;font-size:24px;font-weight:bold;">¥' + amount + '</p>' +
                    '<img src="' + dataUrl + '" style="width:300px;height:300px;border:1px solid #ddd;" />' +
                    '<p style="color:#999;font-size:14px;">请尽快扫码支付，二维码有效期有限</p>' +
                    '</div></body></html>'
                );
            }
        } catch (e) {
            log('支付', '新窗口打开失败: ' + e.message);
        }

        // 自动下载二维码图片
        try {
            var link = document.createElement('a');
            link.download = 'qrcode_' + productInfo.name + '_' + Date.now() + '.png';
            link.href = dataUrl;
            link.click();
            log('支付', '二维码图片已自动下载');
        } catch (e) {}

        log('支付', '官方二维码已截取并展示');
    }


    // ==================== 支付状态轮询 ====================
    var payPollTimer = null;

    function startPayStatusPolling(bizId) {
        if (payPollTimer) clearInterval(payPollTimer);

        var pollCount = 0;
        var maxPolls = 300; // 5分钟

        payPollTimer = setInterval(async function () {
            pollCount++;
            if (pollCount > maxPolls) {
                clearInterval(payPollTimer);
                log('支付', '轮询超时，请刷新页面查看支付状态');
                return;
            }

            try {
                var resp = await fetchPayStatus(bizId);
                if (resp.data === 'SUCCESS') {
                    clearInterval(payPollTimer);
                    log('支付', '支付成功！');
                    updatePayStatus('支付成功！');
                    state.running = false;
                    updatePanelState('支付成功！', 'success');
                }
            } catch (e) {
                // 静默忽略轮询错误
            }
        }, 1000);
    }

    function updatePayStatus(text) {
        var el = document.getElementById('v2-pay-status');
        if (el) el.textContent = text;
    }

    // ==================== 核心抢购流程 ====================
    // 架构：到点后流水线 — 解验证码 → 立即发 preview（不等结果）→ 解下一个
    // preview 是异步 HTTP，解第 N 个验证码时，前面 N-1 个 preview 已经在飞

    // 单次 preview（ticket 一次性使用，不可重试），检查 state.running 以便随时中止
    async function tryPreviewWithRetry(captchaResult, product) {
        if (!state.running) return null;
        var params = {
            productId: product.productId,
            invitationCode: getQueryString('ic') || CONFIG.INVITATION_CODE,
            ticket: captchaResult.ticket,
            randstr: captchaResult.randstr
        };

        try {
            var resp = await fetchPreview(params);
        } catch (e) {
            log('接口', 'preview 失败: ' + e.message);
            return null;
        }
        if (!state.running) return null;

        if (resp.code === 200) {
            if (resp.data && !resp.data.soldOut) return resp.data;
            log('接口', '已售罄');
            return null;
        }
        log('接口', 'preview: code=' + resp.code + ' ' + (resp.msg || ''));
        return null;
    }

    // 带 UI 记录的 preview（用于预存 token）
    async function tryPreviewWithRetryAndRecord(captchaResult, product, tokenObj) {
        if (!state.running) return null;
        tokenObj.previewSentTime = Date.now();
        var params = {
            productId: product.productId,
            invitationCode: getQueryString('ic') || CONFIG.INVITATION_CODE,
            ticket: captchaResult.ticket,
            randstr: captchaResult.randstr
        };

        try {
            var resp = await fetchPreview(params);
        } catch (e) {
            tokenObj.previewResult = { success: false, code: 'ERR', msg: e.message, raw: null };
            updateTokenDisplay();
            return null;
        }
        if (!state.running) return null;

        if (resp.code === 200) {
            if (resp.data && !resp.data.soldOut) {
                tokenObj.previewResult = { success: true, soldOut: false, code: 200, raw: resp };
                updateTokenDisplay();
                return resp.data;
            }
            tokenObj.previewResult = { success: false, soldOut: true, code: 200, raw: resp };
            updateTokenDisplay();
            return null;
        }
        tokenObj.previewResult = { success: false, code: resp.code, msg: resp.msg, raw: resp };
        updateTokenDisplay();
        return null;
    }

    // 流水线：解验证码 → await preview → 成功立即返回，失败继续下一个
    async function solveAndFirePipeline(product) {
        for (var i = 0; i < CONFIG.CONCURRENT_ATTEMPTS && state.running; i++) {
            try {
                log('线路' + (i + 1), '弹出验证码...');
                var captchaResult = await getCaptchaTicket();
            } catch (e) {
                log('线路' + (i + 1), '验证码失败: ' + e.message);
                continue;
            }
            if (!state.running) break;

            // 加入表格跟踪
            var tokenObj = {
                ticket: captchaResult.ticket,
                randstr: captchaResult.randstr,
                timestamp: Date.now(),
                previewSent: true,
                source: '实时'
            };
            state.cachedTokens.push(tokenObj);
            updateTokenDisplay();

            log('线路' + (i + 1), '验证码通过，请求 preview...');
            var data = await tryPreviewWithRetryAndRecord(captchaResult, product, tokenObj);
            if (data) return { data: data, tokenObj: tokenObj };
        }
        return null;
    }

    async function executePurchase() {
        var packageType = getSelectedPackageType();
        var tier = getSelectedTier();
        var product = PRODUCTS[packageType][tier];

        if (!product) {
            log('错误', '未找到产品: ' + packageType + '/' + tier);
            return false;
        }

        log('抢购', '目标: ' + product.name);
        clickPagePackageTab();

        // Phase 0: 手动 bizId 直通锁单（绕过 preview）
        var manualBizId = getManualBizId();
        if (manualBizId) {
            log('直通', '检测到手动 bizId，跳过 preview，直接锁单');
            var manualPreviewData = {
                productId: product.productId,
                bizId: manualBizId,
                thirdPartyAmount: product.payAmount || product.price
            };
            var manualLockResult = await tryLockOrder(manualPreviewData);
            var manualTokenObj = {
                ticket: '(手动bizId)',
                randstr: '',
                timestamp: Date.now(),
                previewSent: true,
                source: '手动',
                previewResult: { success: true, code: 200, raw: { data: manualPreviewData } }
            };
            if (manualLockResult.success) {
                manualTokenObj.lockResult = { success: true, raw: manualLockResult };
                state.cachedTokens.push(manualTokenObj);
                updateTokenDisplay();
                log('直通', '锁单成功！bizId=' + manualBizId);
                showPaymentQRPopup(manualLockResult.sign, manualPreviewData);
                return true;
            }
            manualTokenObj.lockResult = { success: false, raw: manualLockResult.raw };
            state.cachedTokens.push(manualTokenObj);
            updateTokenDisplay();
            log('直通', '锁单失败: ' + (manualLockResult.msg || manualLockResult.code) + '，继续正常流程');
        }

        // Phase 1: 用预存 token 逐个请求（避免并发触发服务端繁忙）
        var cachedTokens = getValidCachedTokens();
        if (cachedTokens.length > 0) {
            updatePanelState('预存token请求中 (' + cachedTokens.length + '个)...', 'running');
            log('预存', '逐个请求 preview，共 ' + cachedTokens.length + ' 个');

            for (var i = 0; i < cachedTokens.length; i++) {
                if (!state.running) break;
                var token = cachedTokens[i];
                token.previewSent = true;
                if (!token.source) token.source = '预存';
                token.previewSentTime = Date.now();
                updateTokenDisplay();

                var previewData = await tryPreviewWithRetryAndRecord(
                    { ticket: token.ticket, randstr: token.randstr },
                    product,
                    token
                );

                if (previewData) {
                    log('抢购', '预存token命中！¥' + previewData.thirdPartyAmount);

                    var lockResult = await tryLockOrder(previewData);
                    token.lockResult = { success: lockResult.success, raw: lockResult.raw };
                    updateTokenDisplay();

                    if (lockResult.success) {
                        showPaymentQRPopup(lockResult.sign, previewData);
                        return true;
                    }
                    await generatePayQRCode(previewData, product);
                    return true;
                }

                if (i < cachedTokens.length - 1) {
                    await sleep(1800);
                }
            }
            log('抢购', '预存token全部失败，进入普通抢购');
        }

        // Phase 2: 普通抢购
        while (state.running) {
            if (!getTencentCaptcha()) {
                log('抢购', '验证码SDK未就绪');
                break;
            }

            var pipelineResult = await solveAndFirePipeline(product);
            if (pipelineResult) {
                var data = pipelineResult.data;
                var tokenObj = pipelineResult.tokenObj;
                log('抢购', '抢到了！¥' + data.thirdPartyAmount);

                // 先尝试锁单
                var lockResult = await tryLockOrder(data);
                if (tokenObj) {
                    tokenObj.lockResult = { success: lockResult.success, raw: lockResult.raw };
                    updateTokenDisplay();
                }
                if (lockResult.success) {
                    showPaymentQRPopup(lockResult.sign, data);
                    return true;
                }
                // 锁单失败，走官方二维码
                await generatePayQRCode(data, product);
                return true;
            }

            if (!state.running) {
                log('抢购', '已手动停止');
                return false;
            }
            log('抢购', '本轮全部失败，继续...');
            await sleep(300);
        }
        return false;
    }

    // ==================== 定时调度 ====================
    function getBuyTimeStr() {
        var el = document.getElementById('v2-buy-time');
        return (el && el.value) ? el.value : CONFIG.BUY_TIME_DEFAULT;
    }

    function parseBuyTime() {
        var parts = getBuyTimeStr().split(':');
        return {
            h: parseInt(parts[0], 10) || 0,
            m: parseInt(parts[1], 10) || 0,
            s: parseInt(parts[2], 10) || 0
        };
    }

    function getSecondsToBuyTime() {
        var now = new Date(getServerTime());
        var t = parseBuyTime();
        var target = new Date(now);
        target.setHours(t.h, t.m, t.s, 0);
        if (now >= target) return 0;
        return Math.floor((target - now) / 1000);
    }

    function getSelectedPackageType() {
        var radio = document.querySelector('input[name="v2-package"]:checked');
        return radio ? radio.value : CONFIG.PACKAGE_TYPE_DEFAULT;
    }

    function getSelectedTier() {
        var radio = document.querySelector('input[name="v2-tier"]:checked');
        return radio ? radio.value : CONFIG.TIER_DEFAULT;
    }

    // 主循环
    async function mainLoop() {
        if (!state.running) return;

        var secs = getSecondsToBuyTime();

        if (secs > 0) {
            var m = Math.floor(secs / 60);
            var s = secs % 60;
            updatePanelState('等待 ' + getBuyTimeStr() + ' (' + m + ':' + (s < 10 ? '0' : '') + s + ')', 'waiting');

            // 自动预存：倒计时 < 60s 时触发（用 precacheRunning 阻止重复）
            var autoPrecache = document.getElementById('v2-auto-precache')?.checked;
            if (autoPrecache && secs <= 60 && secs > 1 && !state.precacheRunning) {
                var validCount = getValidCachedTokens().length;
                var targetCount = getTargetPrecacheCount();
                if (validCount < targetCount) {
                    log('预存', '自动预存启动 (' + validCount + '/' + targetCount + ')');
                    precacheTokens(targetCount - validCount);
                }
            }

            // 连接预热：倒计时 ≤ 30s 开始
            if (secs <= 30 && secs > 0) {
                startConnectionPreheat();
            }

            // 轮询加速：1s 内切 50ms 精确卡点
            var interval = secs <= 1 ? 50 : 1000;
            state.timer = setTimeout(mainLoop, interval);
            return;
        }

        // 停止正在进行的预存
        state.precacheRunning = false;
        updatePrecacheBtn(false);
        // 停止连接预热
        stopConnectionPreheat();

        // 关闭可能正在显示的验证码弹窗，让 precacheOneToken 的 await 尽快返回
        try {
            var captchaCloseBtn = document.querySelector('.tencent-captcha-dy__close-btn');
            if (captchaCloseBtn) captchaCloseBtn.click();
        } catch (e) {}

        // 等待预存流程收尾（getCaptchaTicket reject → precacheOneToken 返回 → 循环 break）
        await sleep(500);

        // 到点！
        updatePanelState('抢购中...', 'running');

        // 检查验证码SDK是否就绪
        if (!getTencentCaptcha()) {
            log('等待', '验证码SDK未就绪，3秒后重试...');
            updatePanelState('等待SDK加载...', 'waiting');
            state.timer = setTimeout(mainLoop, 3000);
            return;
        }

        try {
            var success = await executePurchase();
            if (success) {
                state.running = false;
                resetStartButton();
                updatePanelState('抢购成功！', 'success');
                return;
            }
        } catch (e) {
            log('错误', e.message);
        }

        if (state.running) {
            updatePanelState('重试中...', 'running');
            state.timer = setTimeout(mainLoop, 1000);
        }
    }

    // ==================== 检测本地OCR服务 ====================
    function checkLocalOcrService() {
        var baseUrl = CONFIG.DDDDOCR_URL.replace(/\/click$/, '/');
        var onError = function () {
            log('OCR', '本地服务未启动，将降级到图鉴云服务');
        };
        var onSuccess = function () {
            log('OCR', '本地识别服务已连接');
        };
        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({
                method: 'GET', url: baseUrl, timeout: 2000,
                onload: onSuccess, onerror: onError, ontimeout: onError
            });
        } else {
            var controller = new AbortController();
            var tid = setTimeout(function () { controller.abort(); }, 2000);
            fetch(baseUrl, { mode: 'no-cors', signal: controller.signal })
                .then(function () { clearTimeout(tid); onSuccess(); })
                .catch(function () { clearTimeout(tid); onError(); });
        }
    }

    // ==================== 控制面板UI ====================
    function createControlPanel() {
        var panel = document.createElement('div');
        panel.id = 'v2-control-panel';

        var savedTime = localStorage.getItem('v2_buy_time') || CONFIG.BUY_TIME_DEFAULT;
        var savedPkg = localStorage.getItem('v2_package') || CONFIG.PACKAGE_TYPE_DEFAULT;
        var savedTier = localStorage.getItem('v2_tier') || CONFIG.TIER_DEFAULT;

        panel.innerHTML =
            '<div class="v2-panel-row">' +
            '<div class="v2-status-dot" id="v2-status-dot"></div>' +
            '<span id="v2-status-text">就绪</span>' +
            '<span id="v2-time-offset" style="color:#67c23a;font-size:10px;margin-left:auto;"></span>' +
            '</div>' +
            '<div class="v2-panel-row">' +
            '<span class="v2-label">套餐</span>' +
            '<div class="v2-radio-group">' +
            '<input type="radio" name="v2-package" id="v2-pkg-month" value="month"' + (savedPkg === 'month' ? ' checked' : '') + '><label for="v2-pkg-month">月</label>' +
            '<input type="radio" name="v2-package" id="v2-pkg-quarter" value="quarter"' + (savedPkg === 'quarter' ? ' checked' : '') + '><label for="v2-pkg-quarter">季</label>' +
            '<input type="radio" name="v2-package" id="v2-pkg-year" value="year"' + (savedPkg === 'year' ? ' checked' : '') + '><label for="v2-pkg-year">年</label>' +
            '</div>' +
            '</div>' +
            '<div class="v2-panel-row">' +
            '<span class="v2-label">档位</span>' +
            '<div class="v2-radio-group">' +
            '<input type="radio" name="v2-tier" id="v2-tier-lite" value="lite"' + (savedTier === 'lite' ? ' checked' : '') + '><label for="v2-tier-lite">Lite</label>' +
            '<input type="radio" name="v2-tier" id="v2-tier-pro" value="pro"' + (savedTier === 'pro' ? ' checked' : '') + '><label for="v2-tier-pro">Pro</label>' +
            '<input type="radio" name="v2-tier" id="v2-tier-max" value="max"' + (savedTier === 'max' ? ' checked' : '') + '><label for="v2-tier-max">Max</label>' +
            '</div>' +
            '</div>' +
            '<div class="v2-panel-row">' +
            '<span class="v2-label">时间</span>' +
            '<input type="time" id="v2-buy-time" step="1" value="' + savedTime + '">' +
            '</div>' +
            '<div class="v2-panel-row">' +
            '<span class="v2-label">并发</span>' +
            '<input type="number" id="v2-concurrency" min="1" max="5" value="' + CONFIG.CONCURRENT_ATTEMPTS + '" class="v2-num-input">' +
            '<span class="v2-hint">个验证码/轮</span>' +
            '</div>' +
            '<div class="v2-panel-row">' +
            '<span class="v2-label">产品</span>' +
            '<span id="v2-product-info" class="v2-product-info"></span>' +
            '<button id="v2-refresh-btn" class="v2-btn-mini">刷新</button>' +
            '</div>' +
            '<div class="v2-separator"></div>' +
            '<div class="v2-panel-row"' + (CONFIG.ENABLE_MANUAL_BIZID ? '' : ' style="display:none;"') + '>' +
            '<span class="v2-label">bizId</span>' +
            '<input type="text" id="v2-manual-bizid" class="v2-bizid-input" placeholder="留空走正常流程">' +
            '<span class="v2-hint">直通锁单</span>' +
            '</div>' +
            '<div class="v2-separator"></div>' +
            '<div class="v2-panel-row v2-precache-row">' +
            '<span class="v2-label">预存</span>' +
            '<input type="number" id="v2-precache-count" min="1" max="10" value="5" class="v2-num-input">' +
            '<span class="v2-hint">个</span>' +
            '<span id="v2-token-count" class="v2-token-count">0/0</span>' +
            '<button id="v2-precache-btn" class="v2-btn v2-btn-secondary">预存</button>' +
            '<button id="v2-clear-tokens-btn" class="v2-btn-mini">清空</button>' +
            '</div>' +
            '<table class="v2-token-table" id="v2-token-table">' +
            '<thead><tr><th>#</th><th>ticket</th><th>时间</th><th>preview</th><th>锁单</th></tr></thead>' +
            '<tbody id="v2-token-tbody"><tr><td colspan="5" class="v2-token-empty">暂无预存</td></tr></tbody>' +
            '</table>' +
            '<div class="v2-panel-row">' +
            '<label class="v2-checkbox-label">' +
            '<input type="checkbox" id="v2-auto-precache" checked />' +
            '自动预存(倒计时&lt;60s)' +
            '</label>' +
            '<label class="v2-checkbox-label">' +
            '<input type="checkbox" id="v2-show-log" />' +
            '日志' +
            '</label>' +
            '</div>' +
            '<div class="v2-separator"></div>' +
            '<div class="v2-panel-row v2-btn-row">' +
            '<button id="v2-start-btn" class="v2-btn v2-btn-primary">开始抢购</button>' +
            '<button id="v2-test-btn" class="v2-btn v2-btn-secondary" style="display:none;">测试验证码</button>' +
            '</div>' +
            '<div class="v2-log-area v2-log-hidden" id="v2-log-area"></div>' +
            '<div class="v2-detail-overlay" id="v2-detail-overlay" style="display:none;">' +
            '<div class="v2-detail-box">' +
            '<div class="v2-detail-header"><span id="v2-detail-title">详情</span><button id="v2-detail-close">&times;</button></div>' +
            '<pre class="v2-detail-body" id="v2-detail-body"></pre>' +
            '</div>' +
            '</div>';

        document.body.appendChild(panel);

        // 绑定事件
        document.getElementById('v2-start-btn').addEventListener('click', function () {
            state.running = !state.running;
            if (state.running) {
                this.textContent = '停止';
                this.className = 'v2-btn v2-btn-danger';
                mainLoop();
            } else {
                this.textContent = '开始抢购';
                this.className = 'v2-btn v2-btn-primary';
                clearTimeout(state.timer);
                updatePanelState('已停止', 'idle');
            }
        });

        // 并发数
        document.getElementById('v2-concurrency').addEventListener('change', function () {
            var val = parseInt(this.value, 10);
            if (val >= 1 && val <= 5) CONFIG.CONCURRENT_ATTEMPTS = val;
        });

        // 预存按钮
        document.getElementById('v2-precache-btn').addEventListener('click', function () {
            if (state.precacheRunning) {
                stopPrecache();
                return;
            }
            var count = getTargetPrecacheCount();
            precacheTokens(count);
        });

        // 清空 token
        document.getElementById('v2-clear-tokens-btn').addEventListener('click', function () {
            stopPrecache();
            clearCachedTokens();
        });

        // 日志 toggle
        document.getElementById('v2-show-log').addEventListener('change', function () {
            var el = document.getElementById('v2-log-area');
            if (this.checked) {
                el.classList.remove('v2-log-hidden');
            } else {
                el.classList.add('v2-log-hidden');
            }
        });

        // 详情弹窗关闭
        document.getElementById('v2-detail-close').addEventListener('click', function () {
            document.getElementById('v2-detail-overlay').style.display = 'none';
        });
        document.getElementById('v2-detail-overlay').addEventListener('click', function (e) {
            if (e.target === this) this.style.display = 'none';
        });

        // 刷新产品数据
        document.getElementById('v2-refresh-btn').addEventListener('click', function () {
            var btn = this;
            btn.disabled = true;
            btn.textContent = '...';
            fetchBatchPreview({
                invitationCode: getQueryString('ic') || CONFIG.INVITATION_CODE
            }).then(function (resp) {
                if (resp.code === 200 && resp.data && resp.data.productList) {
                    updateProductsFromBatchPreview(resp.data.productList);
                    updateProductInfo();
                } else {
                    log('产品', '刷新失败: ' + (resp.msg || resp.code));
                }
            }).catch(function (e) {
                log('产品', '刷新失败: ' + e.message);
            }).finally(function () {
                btn.disabled = false;
                btn.textContent = '刷新';
            });
        });

        document.getElementById('v2-test-btn').addEventListener('click', async function () {
            this.disabled = true;
            this.textContent = '识别中...';
            try {
                log('测试', '弹出验证码...');
                var result = await getCaptchaTicket();
                log('测试', '验证码通过！ticket: ' + result.ticket.substring(0, 30) + '...');
            } catch (e) {
                log('测试', '失败: ' + e.message);
            } finally {
                this.disabled = false;
                this.textContent = '测试验证码';
            }
        });

        // 保存设置
        document.getElementById('v2-buy-time').addEventListener('change', function () {
            localStorage.setItem('v2_buy_time', this.value);
        });
        document.querySelectorAll('input[name="v2-package"]').forEach(function (r) {
            r.addEventListener('change', function () {
                localStorage.setItem('v2_package', this.value);
                updateProductInfo();
                clickPagePackageTab();
                highlightPackageTab();
                // 切换套餐后等待页面卡片更新再高亮
                setTimeout(highlightPackageCard, 500);
            });
        });
        document.querySelectorAll('input[name="v2-tier"]').forEach(function (r) {
            r.addEventListener('change', function () {
                localStorage.setItem('v2_tier', this.value);
                updateProductInfo();
                highlightPackageCard();
            });
        });

        // 拖拽
        makeDraggable(panel);

        // 恢复位置
        var savedPos = localStorage.getItem('v2_panel_pos');
        if (savedPos) {
            try {
                var pos = JSON.parse(savedPos);
                panel.style.left = pos.left + 'px';
                panel.style.top = pos.top + 'px';
                panel.style.right = 'auto';
            } catch (e) {}
        }

        updateProductInfo();
    }

    function updateProductInfo() {
        var pkg = getSelectedPackageType();
        var tier = getSelectedTier();
        var product = PRODUCTS[pkg][tier];
        var el = document.getElementById('v2-product-info');
        if (el && product) {
            var priceText = product.payAmount ? '¥' + product.payAmount : '¥' + product.price;
            var stockText = product.soldOut ? ' [售罄]' : ' [有货]';
            el.textContent = product.productId + ' ' + priceText + stockText;
            el.style.color = product.soldOut ? '#f56c6c' : '#67c23a';
        }
    }

    function updatePanelState(text, statusClass) {
        var dot = document.getElementById('v2-status-dot');
        var textEl = document.getElementById('v2-status-text');
        if (textEl) textEl.textContent = text;
        if (dot) {
            dot.className = 'v2-status-dot';
            if (statusClass) dot.classList.add('v2-' + statusClass);
        }
    }

    function resetStartButton() {
        var btn = document.getElementById('v2-start-btn');
        if (btn) {
            btn.textContent = '开始抢购';
            btn.className = 'v2-btn v2-btn-primary';
        }
    }

    var logLines = [];
    function updateLog(msg) {
        logLines.push(new Date().toLocaleTimeString() + ' ' + msg);
        if (logLines.length > 50) logLines.shift();
        var el = document.getElementById('v2-log-area');
        if (el) {
            el.textContent = logLines.join('\n');
            el.scrollTop = el.scrollHeight;
        }
    }

    function makeDraggable(el) {
        var isDragging = false;
        var startX, startY, elStartX, elStartY;

        el.addEventListener('mousedown', function (e) {
            if (['BUTTON', 'INPUT', 'LABEL', 'TEXTAREA'].indexOf(e.target.tagName) >= 0) return;
            isDragging = true;
            el.classList.add('v2-dragging');
            startX = e.clientX;
            startY = e.clientY;
            var rect = el.getBoundingClientRect();
            elStartX = rect.left;
            elStartY = rect.top;
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            if (!isDragging) return;
            el.style.left = (elStartX + e.clientX - startX) + 'px';
            el.style.top = (elStartY + e.clientY - startY) + 'px';
            el.style.right = 'auto';
        });

        document.addEventListener('mouseup', function () {
            if (isDragging) {
                isDragging = false;
                el.classList.remove('v2-dragging');
                var rect = el.getBoundingClientRect();
                localStorage.setItem('v2_panel_pos', JSON.stringify({ left: rect.left, top: rect.top }));
            }
        });
    }

    // ==================== 样式 ====================
    function injectStyles() {
        var css = '' +
            '#v2-control-panel {' +
            '  position: fixed; top: 50px; right: 10px; z-index: 2000000022;' +
            '  background: rgba(15,15,25,0.92); color: #e0e0e0;' +
            '  padding: 14px 16px; border-radius: 10px;' +
            '  font: 12px/1.6 "SF Mono", Consolas, monospace;' +
            '  user-select: none; cursor: move;' +
            '  box-shadow: 0 4px 20px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08);' +
            '  min-width: 280px; max-width: 380px;' +
            '}' +
            '#v2-control-panel.v2-dragging { opacity: 0.8; }' +
            '.v2-panel-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }' +
            '.v2-label { color: #888; font-size: 11px; width: 32px; flex-shrink: 0; }' +
            '.v2-radio-group { display: flex; gap: 2px; }' +
            '.v2-radio-group input { display: none; }' +
            '.v2-radio-group label {' +
            '  padding: 2px 10px; border-radius: 4px; font-size: 11px; cursor: pointer;' +
            '  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);' +
            '  transition: all 0.15s;' +
            '}' +
            '.v2-radio-group input:checked + label {' +
            '  background: #409eff; border-color: #409eff; color: #fff;' +
            '}' +
            'input[name="v2-package"]:checked + label { background: #e6a23c; border-color: #e6a23c; }' +
            '#v2-buy-time {' +
            '  width: 90px; background: rgba(255,255,255,0.08); color: #e0e0e0;' +
            '  border: 1px solid rgba(255,255,255,0.15); border-radius: 4px;' +
            '  padding: 2px 6px; font: 12px monospace;' +
            '}' +
            '.v2-status-dot {' +
            '  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;' +
            '  background: #909399;' +
            '}' +
            '.v2-status-dot.v2-running { background: #67c23a; animation: v2-pulse 1s infinite; }' +
            '.v2-status-dot.v2-waiting { background: #e6a23c; }' +
            '.v2-status-dot.v2-success { background: #67c23a; }' +
            '.v2-status-dot.v2-idle { background: #909399; }' +
            '@keyframes v2-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }' +
            '.v2-btn-row { margin-top: 8px; }' +
            '.v2-btn {' +
            '  cursor: pointer; color: #fff; border: none; border-radius: 4px;' +
            '  padding: 5px 14px; font: 12px monospace;' +
            '}' +
            '.v2-btn-primary { background: #409eff; }' +
            '.v2-btn-primary:hover { background: #66b1ff; }' +
            '.v2-btn-danger { background: #f56c6c; }' +
            '.v2-btn-danger:hover { background: #f78989; }' +
            '.v2-btn-secondary { background: #67c23a; }' +
            '.v2-btn-secondary:hover { background: #85ce61; }' +
            '.v2-btn:disabled { background: #909399; cursor: not-allowed; }' +
            '.v2-btn-mini {' +
            '  cursor: pointer; background: rgba(255,255,255,0.1); color: #aaa;' +
            '  border: 1px solid rgba(255,255,255,0.15); border-radius: 3px;' +
            '  padding: 1px 6px; font-size: 10px; margin-left: 4px;' +
            '}' +
            '.v2-btn-mini:hover { background: rgba(255,255,255,0.2); color: #fff; }' +
            '.v2-btn-mini:disabled { opacity: 0.5; cursor: not-allowed; }' +
            '.v2-num-input {' +
            '  width: 40px; background: rgba(255,255,255,0.08); color: #e0e0e0;' +
            '  border: 1px solid rgba(255,255,255,0.15); border-radius: 4px;' +
            '  padding: 2px 4px; font: 12px monospace; text-align: center;' +
            '}' +
            '.v2-hint { color: #666; font-size: 10px; }' +
            '.v2-bizid-input {' +
            '  flex: 1; min-width: 0; background: rgba(255,255,255,0.08); color: #e0e0e0;' +
            '  border: 1px solid rgba(255,255,255,0.15); border-radius: 4px;' +
            '  padding: 2px 6px; font: 11px monospace;' +
            '}' +
            '.v2-bizid-input::placeholder { color: #555; }' +
            '.v2-product-info { color: #67c23a; font-size: 11px; }' +
            '.v2-log-area {' +
            '  margin-top: 8px; max-height: 120px; overflow-y: auto;' +
            '  background: rgba(0,0,0,0.3); border-radius: 4px; padding: 6px 8px;' +
            '  font-size: 10px; color: #aaa; white-space: pre-wrap; word-break: break-all;' +
            '}' +
            '.v2-log-area::-webkit-scrollbar { width: 4px; }' +
            '.v2-log-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }' +
            '.v2-log-hidden { display: none; }' +
            '.v2-separator { border-top: 1px solid rgba(255,255,255,0.1); margin: 6px 0; }' +
            '.v2-precache-row { gap: 4px !important; }' +
            '.v2-token-count { font-size: 11px; color: #e6a23c; min-width: 30px; text-align: center; }' +
            '.v2-token-table {' +
            '  width: 100%; border-collapse: collapse; margin: 4px 0;' +
            '  font-size: 10px; color: #ccc;' +
            '  display: block;' +
            '}' +
            '.v2-token-table thead { display: table; width: 100%; table-layout: fixed; }' +
            '.v2-token-table tbody {' +
            '  display: block; max-height: 220px; overflow-y: auto; width: 100%;' +
            '}' +
            '.v2-token-table thead tr, .v2-token-table tbody tr { display: table; width: 100%; table-layout: fixed; }' +
            '.v2-token-table tbody::-webkit-scrollbar { width: 3px; }' +
            '.v2-token-table tbody::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }' +
            '.v2-token-table th {' +
            '  text-align: left; padding: 2px 4px; color: #888; font-weight: normal;' +
            '  border-bottom: 1px solid rgba(255,255,255,0.1);' +
            '}' +
            '.v2-token-table td { padding: 2px 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' +
            '.v2-token-table tr:hover { background: rgba(255,255,255,0.05); }' +
            '.v2-token-expired td { color: #555; text-decoration: line-through; }' +
            '.v2-token-empty { color: #555; font-style: italic; text-align: center; }' +
            '.v2-tag {' +
            '  display: inline-block; padding: 0 4px; border-radius: 2px; font-size: 9px;' +
            '}' +
            '.v2-tag-ok { background: rgba(103,194,58,0.2); color: #67c23a; }' +
            '.v2-tag-warn { background: rgba(230,162,60,0.2); color: #e6a23c; }' +
            '.v2-tag-err { background: rgba(245,108,108,0.2); color: #f56c6c; }' +
            '.v2-tag-sending { background: rgba(64,158,255,0.2); color: #409eff; }' +
            '.v2-checkbox-label {' +
            '  display: flex; align-items: center; gap: 4px; cursor: pointer;' +
            '  font-size: 11px; color: #aaa;' +
            '}' +
            '.v2-checkbox-label input { margin: 0; }' +
            '.v2-detail-overlay {' +
            '  position: fixed; top: 0; left: 0; right: 0; bottom: 0;' +
            '  z-index: 2000000023; display: flex; align-items: center; justify-content: center;' +
            '  background: rgba(0,0,0,0.6);' +
            '}' +
            '.v2-detail-box {' +
            '  background: #1a1a2e; color: #e0e0e0; border-radius: 8px;' +
            '  max-width: 500px; width: 90%; max-height: 60vh; overflow: hidden;' +
            '  box-shadow: 0 4px 20px rgba(0,0,0,0.5);' +
            '}' +
            '.v2-detail-header {' +
            '  display: flex; justify-content: space-between; align-items: center;' +
            '  padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.1);' +
            '  font-size: 13px; font-weight: bold;' +
            '}' +
            '.v2-detail-header button {' +
            '  background: none; border: none; color: #aaa; font-size: 18px; cursor: pointer;' +
            '}' +
            '.v2-detail-body {' +
            '  padding: 12px; overflow-y: auto; max-height: 50vh; margin: 0;' +
            '  font-size: 11px; white-space: pre-wrap; word-break: break-all;' +
            '  color: #bbb; background: none;' +
            '}' +
            /* 套餐卡片高亮 */
            '.package-card-box.auto-buy-selected {' +
            '  border: 3px solid #e6a23c !important;' +
            '  box-shadow: 0 0 12px rgba(230, 162, 60, 0.5) !important;' +
            '}' +
            '.switch-tab-item.auto-buy-pkg-selected {' +
            '  border: 2px solid #e6a23c !important;' +
            '  box-shadow: 0 0 8px rgba(230, 162, 60, 0.5) !important;' +
            '  border-radius: 6px;' +
            '}';

        if (typeof GM_addStyle !== 'undefined') {
            GM_addStyle(css);
        } else {
            var style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
        }
    }

    // ==================== 页面套餐高亮 ====================
    // 点击页面上对应的套餐 tab（月/季/年）
    function clickPagePackageTab() {
        var pkgType = getSelectedPackageType();
        var tabIndex;
        switch (pkgType) {
            case 'month':   tabIndex = 0; break;
            case 'quarter': tabIndex = 1; break;
            case 'year':    tabIndex = 2; break;
            default:        tabIndex = 1;
        }
        var tabItems = document.querySelectorAll('.switch-tab-box .switch-tab-item');
        if (tabItems.length > tabIndex) {
            var targetTab = tabItems[tabIndex];
            if (targetTab && !targetTab.classList.contains('active')) {
                targetTab.click();
            }
        }
    }

    // 高亮页面上当前选择的档位卡片（Lite=0, Pro=1, Max=2）
    function highlightPackageCard() {
        var tier = getSelectedTier();
        var idx;
        switch (tier) {
            case 'lite': idx = 0; break;
            case 'pro':  idx = 1; break;
            case 'max':  idx = 2; break;
            default:     idx = 2;
        }
        var cards = document.querySelectorAll('.package-card-box');
        cards.forEach(function (card, i) {
            if (i === idx) {
                card.classList.add('auto-buy-selected');
            } else {
                card.classList.remove('auto-buy-selected');
            }
        });
    }

    // 高亮页面上当前选择的套餐 tab
    function highlightPackageTab() {
        var pkgType = getSelectedPackageType();
        var tabIndex;
        switch (pkgType) {
            case 'month':   tabIndex = 0; break;
            case 'quarter': tabIndex = 1; break;
            case 'year':    tabIndex = 2; break;
            default:        tabIndex = 1;
        }
        var tabItems = document.querySelectorAll('.switch-tab-box .switch-tab-item');
        tabItems.forEach(function (item, i) {
            if (i === tabIndex) {
                item.classList.add('auto-buy-pkg-selected');
            } else {
                item.classList.remove('auto-buy-pkg-selected');
            }
        });
    }

    // ==================== 激活页面购买按钮 ====================
    // 修改 Vue 组件的产品数据，让页面上所有"已售罄"的按钮变为可点击
    function activatePageButtons() {
        function tryActivate() {
            var claudeBox = document.querySelector('.claude-code-box');
            var vue = claudeBox && claudeBox.__vue__;
            if (!vue || !Array.isArray(vue.allCardDataList) || vue.allCardDataList.length === 0) {
                setTimeout(tryActivate, 300);
                return;
            }
            vue.allCardDataList.forEach(function (item) {
                item.soldOut = false;
                item.canPurchase = true;
                item.disabled = false;
            });
            win.vueApp = vue;
            log('页面', '已激活所有购买按钮（soldOut=false）');

            // 初始化高亮
            highlightPackageCard();
            clickPagePackageTab();
            highlightPackageTab();
            // 点击tab后等待卡片更新再高亮一次
            setTimeout(highlightPackageCard, 600);
        }
        setTimeout(tryActivate, 500);
    }

    // ==================== 邀请码检查 ====================
    function checkAndFixInvitationCode() {
        if (location.pathname !== '/glm-coding') return;
        var currentIc = getQueryString('ic');
        if (currentIc !== CONFIG.INVITATION_CODE) {
            var url = new URL(location.href);
            url.searchParams.set('ic', CONFIG.INVITATION_CODE);
            log('初始化', '邀请码修正: ' + currentIc + ' -> ' + CONFIG.INVITATION_CODE);
            location.replace(url.toString());
        }
    }

    // ==================== 初始化 ====================
    async function init() {
        if (inCaptchaFrame) return;
        checkAndFixInvitationCode();
        injectStyles();
        createControlPanel();

        log('初始化', 'v2 纯接口模式启动');

        // 服务器时间同步
        syncServerTime();

        // 加载验证码SDK（重试3次）
        var sdkLoaded = false;
        for (var sdkRetry = 0; sdkRetry < 3; sdkRetry++) {
            try {
                await loadCaptchaScript();
                log('初始化', '腾讯验证码SDK已加载');
                sdkLoaded = true;
                break;
            } catch (e) {
                log('初始化', '验证码SDK加载失败(第' + (sdkRetry + 1) + '次): ' + e.message);
                if (sdkRetry < 2) await sleep(2000);
            }
        }
        if (!sdkLoaded) {
            log('初始化', '验证码SDK多次加载失败，将在抢购时继续尝试');
        }

        // 并行：获取用户信息 + 产品价格 + 检测OCR
        var initTasks = [];

        // 获取用户信息
        initTasks.push(
            fetchCustomerInfo().then(function (resp) {
                if (resp.code === 200 && resp.data) {
                    state.userInfo = resp.data;
                    state.customerNumber = resp.data.customerNumber;
                    log('初始化', '用户: ' + resp.data.customerName + ' (' + resp.data.customerNumber + ')');
                }
            }).catch(function (e) {
                log('初始化', '获取用户信息失败: ' + e.message);
            })
        );

        // 调用 batch-preview 获取最新产品价格和库存
        initTasks.push(
            fetchBatchPreview({
                invitationCode: getQueryString('ic') || CONFIG.INVITATION_CODE
            }).then(function (resp) {
                if (resp.code === 200 && resp.data && resp.data.productList) {
                    updateProductsFromBatchPreview(resp.data.productList);
                    updateProductInfo();
                } else {
                    log('产品', 'batch-preview 返回异常: ' + (resp.msg || resp.code));
                }
            }).catch(function (e) {
                log('产品', 'batch-preview 失败: ' + e.message);
            })
        );

        await Promise.all(initTasks);

        // 检测本地OCR
        checkLocalOcrService();

        // 激活页面按钮（参考v1：把Vue组件中所有产品的 soldOut/disabled 修改为可购买状态）
        activatePageButtons();

        // 启动 token 显示刷新
        startTokenDisplayRefresh();

        log('初始化', '就绪，点击「开始抢购」启动');
    }

    // ==================== 启动 ====================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    win.win2 = window;
})(unsafeWindow);
