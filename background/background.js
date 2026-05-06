// Background Service Worker - Amazon Rufus 智能队列管理系统

// 队列状态
const queueState = {
    pending: [],      // 待处理URL
    processing: null, // 当前处理的URL
    completed: [],    // 已完成
    failed: [],       // 失败列表
    data: [],         // 抓取的数据
    isRunning: false,
    isPaused: false,
    config: {},
    stats: {
        total: 0,
        success: 0,
        failed: 0,
        processed: 0
    }
};

// Service Worker 保活定时器
let keepAliveInterval = null;

// 保活机制：防止 Service Worker 被浏览器挂起
function startKeepAlive() {
    if (keepAliveInterval) return;
    // 每20秒向 chrome.storage 发送一次请求，保持 SW 活跃
    keepAliveInterval = setInterval(async () => {
        try {
            await chrome.storage.local.get('keepAlive');
        } catch (error) {
            console.error('Keep alive failed:', error);
        }
    }, 20000); // 20秒比Chrome的30秒超时更短
}

function stopKeepAlive() {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
}

// 重试计数器
const retryCount = new Map();

// 随机延迟函数
function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 防检测：模拟人类行为
async function simulateHumanBehavior(tabId) {
    if (!queueState.config.enableAntiDetection) return;

    try {
        // 随机滚动
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                window.scrollTo({
                    top: Math.random() * 500,
                    behavior: 'smooth'
                });
            }
        });

        // 随机等待
        await new Promise(resolve => setTimeout(resolve, randomDelay(500, 1500)));
    } catch (error) {
        console.error('Human behavior simulation failed:', error);
    }
}

// 从商品URL中提取ASIN
function extractAsinFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const asinFromQuery = urlObj.searchParams.get('asin') ||
                              urlObj.searchParams.get('ASIN');
        if (asinFromQuery && /^[A-Z0-9]{10}$/i.test(asinFromQuery)) {
            return asinFromQuery.toUpperCase();
        }

        const pathMatch = urlObj.pathname.match(/(?:\/dp\/|\/gp\/product\/)([A-Z0-9]{10})(?:[/?]|$)/i);
        return pathMatch ? pathMatch[1].toUpperCase() : '';
    } catch (_) {
        return '';
    }
}

// 等待商品页动态模块完成首轮渲染
async function waitForProductContent(tabId) {
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    const bodyText = document.body?.innerText || '';
                    const hasProductTitle = Boolean(document.querySelector('#productTitle'));
                    const hasRufusText = /Ask\s+Rufus|Rufus/i.test(bodyText);
                    const hasSmidgetRufus = Boolean(document.querySelector(
                        '#dpx-nice-widget-container .small-widget-pill, #dpx-nice-widget-container [data-dpx-rufus-connect]'
                    ));
                    let hasRufusAttrs = false;

                    try {
                        hasRufusAttrs = Boolean(document.querySelector(
                            '[id*="rufus" i], [class*="rufus" i], [aria-label*="rufus" i], [data-csa-c-content-id*="rufus" i], [data-csa-c-slot-id*="rufus" i]'
                        ));
                    } catch (_) {
                        hasRufusAttrs = false;
                    }

                    return {
                        hasProductTitle,
                        hasRufus: hasSmidgetRufus || hasRufusText || hasRufusAttrs
                    };
                }
            });

            const state = results?.[0]?.result;
            if (state?.hasRufus || (attempt >= 5 && state?.hasProductTitle)) {
                return;
            }
        } catch (error) {
            console.error('Waiting for product content failed:', error);
        }

        if (attempt === 3 || attempt === 6) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => window.scrollBy({ top: 350, behavior: 'smooth' })
                });
            } catch (_) {
                // Ignore scroll failures while waiting.
            }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

// 处理单个URL
async function processUrl(url) {
    const asin = extractAsinFromUrl(url);

    if (!asin) {
        throw new Error('Invalid product URL or ASIN');
    }

    // 创建新标签页
    const tab = await chrome.tabs.create({
        url: url,
        active: false
    });

    try {
        // 等待页面加载
        await waitForTabLoad(tab.id);

        // 防检测延迟
        const delay = randomDelay(
            queueState.config.delayMin,
            queueState.config.delayMax
        );
        await new Promise(resolve => setTimeout(resolve, delay));

        // 模拟人类行为
        await simulateHumanBehavior(tab.id);

        // 等待商品页动态内容（Ask Rufus 可能异步加载）
        await waitForProductContent(tab.id);

        // 注入content script并获取数据
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractProductRufusData
        });

        if (results && results[0] && results[0].result) {
            const data = results[0].result;

            // 验证数据完整性
            if (!data.asin && !data.productTitle && !data.rufusFound) {
                throw new Error('No valid data found');
            }

            // 添加额外信息
            data.url = url;
            data.asin = data.asin || asin;
            data.scrapedAt = new Date().toISOString();

            return { success: true, data };
        } else {
            throw new Error('Failed to extract data');
        }
    } catch (error) {
        console.error('Error processing URL:', url, error);

        // 重试逻辑
        if (queueState.config.enableRetry) {
            const currentRetry = retryCount.get(url) || 0;
            if (currentRetry < queueState.config.retryLimit) {
                retryCount.set(url, currentRetry + 1);
                await new Promise(resolve => setTimeout(resolve, randomDelay(5000, 10000)));
                return processUrl(url); // 递归重试
            }
        }

        return { success: false, error: error.message, url };
    } finally {
        // 关闭标签页
        try {
            await chrome.tabs.remove(tab.id);
        } catch (e) {
            // Tab might already be closed
        }
        retryCount.delete(url);
    }
}

// 等待标签页加载完成
function waitForTabLoad(tabId) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('Page load timeout'));
        }, 30000); // 30秒超时

        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };

        chrome.tabs.onUpdated.addListener(listener);
    });
}

// 在页面中执行的函数（提取商品页 Ask Rufus 数据）
function extractProductRufusData() {
    try {
        function cleanText(value) {
            return String(value || '')
                .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function getAttributeText(element) {
            if (!element?.getAttribute) return '';

            const attrs = [
                'aria-label',
                'title',
                'alt',
                'value',
                'data-dpx-rufus-connect',
                'data-rufus-action',
                'data-action-url',
                'data-csa-c-content-id',
                'data-csa-c-slot-id',
                'data-action',
                'data-feature-name'
            ];

            return attrs
                .map(attr => cleanText(element.getAttribute(attr)))
                .filter(Boolean)
                .join(' ');
        }

        function elementText(element) {
            if (!element) return '';

            const visibleText = cleanText(element.innerText);
            if (visibleText) return visibleText;

            const textContent = cleanText(element.textContent);
            if (textContent) return textContent;

            return cleanText(getAttributeText(element));
        }

        function getAllElements(root) {
            const elements = [];

            function visit(scope) {
                if (!scope?.querySelectorAll) return;

                const scopedElements = Array.from(scope.querySelectorAll('*'));
                for (const element of scopedElements) {
                    elements.push(element);

                    if (element.shadowRoot) {
                        visit(element.shadowRoot);
                    }

                    if (element.tagName === 'IFRAME') {
                        try {
                            if (element.contentDocument) {
                                visit(element.contentDocument);
                            }
                        } catch (_) {
                            // Cross-origin iframes are expected on Amazon pages.
                        }
                    }
                }
            }

            visit(root);
            return elements;
        }

        function parentElement(element) {
            if (element?.parentElement) return element.parentElement;
            const rootNode = element?.getRootNode?.();
            return rootNode?.host || null;
        }

        function attrBlob(element) {
            if (!element) return '';

            return [
                element.id,
                typeof element.className === 'string' ? element.className : '',
                element.getAttribute?.('aria-label'),
                element.getAttribute?.('data-csa-c-content-id'),
                element.getAttribute?.('data-csa-c-slot-id'),
                element.getAttribute?.('data-dpx-rufus-connect'),
                element.getAttribute?.('data-rufus-action'),
                element.getAttribute?.('data-action-url'),
                element.getAttribute?.('data-feature-name'),
                element.getAttribute?.('cel_widget_id')
            ].map(cleanText).filter(Boolean).join(' ');
        }

        function decodeHtmlEntities(value) {
            const textarea = document.createElement('textarea');
            textarea.innerHTML = String(value || '');
            return textarea.value;
        }

        function parseJsonAttribute(value) {
            if (!value) return null;

            try {
                return JSON.parse(decodeHtmlEntities(value));
            } catch (_) {
                return null;
            }
        }

        function readQueryFromRufusAttributes(element) {
            if (!element?.getAttribute) return '';

            const connectPayload = parseJsonAttribute(element.getAttribute('data-dpx-rufus-connect'));
            if (connectPayload?.query) {
                return cleanText(connectPayload.query);
            }

            const actionPayload = parseJsonAttribute(element.getAttribute('data-rufus-action'));
            if (actionPayload?.query) {
                return cleanText(actionPayload.query);
            }

            if (actionPayload?.action?.payload?.query) {
                return cleanText(actionPayload.action.payload.query);
            }

            return '';
        }

        function countPromptLikeTexts(container) {
            return extractPromptTexts(container).length;
        }

        function climbToContainer(element) {
            let current = element;
            let best = element;

            for (let depth = 0; current && depth < 7; depth++) {
                const text = elementText(current);
                const attrs = attrBlob(current);
                const hasRufus = /rufus/i.test(`${text} ${attrs}`);
                const textLengthOk = text.length > 0 && text.length < 1600;

                if (textLengthOk) {
                    best = current;
                }

                if (hasRufus && textLengthOk && countPromptLikeTexts(current) >= 2) {
                    return current;
                }

                current = parentElement(current);
            }

            return best;
        }

        function isPromptText(text) {
            const normalized = cleanText(text);
            if (!normalized) return false;
            if (/^Ask\s+Rufus$/i.test(normalized)) return false;
            if (/Ask\s+Rufus/i.test(normalized)) return false;
            if (normalized.length > 140) return false;

            const questionMarks = (normalized.match(/\?/g) || []).length;
            if (questionMarks > 1) return false;

            const lower = normalized.toLowerCase();
            const knownActions = new Set([
                'ask something else',
                'compare with similar',
                'why you might like this'
            ]);

            if (knownActions.has(lower)) return true;
            if (normalized.endsWith('?')) return true;

            return /^(can|could|does|do|is|are|will|would|should|what|which|why|how|where|when|who)\b/i.test(normalized);
        }

        function extractPromptTexts(container) {
            const prompts = [];
            const seen = new Set();

            function addPrompt(text) {
                const normalized = cleanText(text);
                const key = normalized.toLowerCase();

                if (!isPromptText(normalized) || seen.has(key)) {
                    return;
                }

                seen.add(key);
                prompts.push(normalized);
            }

            if (!container) return prompts;

            const clickableSelector = [
                'button',
                'a',
                '[role="button"]',
                'input[type="button"]',
                'input[type="submit"]',
                '.a-button',
                '.a-button-text',
                '[data-rufus-quick-prompt]',
                '[data-dpx-rufus-connect]',
                '[data-rufus-action]',
                '.small-widget-pill',
                '.rufus-pill',
                '[data-csa-c-type="button"]'
            ].join(',');

            let clickables = [];
            try {
                clickables = Array.from(container.querySelectorAll(clickableSelector));
            } catch (_) {
                clickables = [];
            }

            for (const element of clickables) {
                addPrompt(readQueryFromRufusAttributes(element));
                addPrompt(readQueryFromRufusAttributes(parentElement(element)));
                addPrompt(elementText(element));
                addPrompt(getAttributeText(element));
            }

            if (prompts.length === 0) {
                const descendants = getAllElements(container);
                for (const element of descendants) {
                    const text = elementText(element);
                    const childText = Array.from(element.children || [])
                        .map(child => elementText(child))
                        .filter(Boolean)
                        .join(' ');

                    if (!childText || cleanText(childText) !== text) {
                        addPrompt(text);
                    }
                    addPrompt(getAttributeText(element));
                }
            }

            return prompts;
        }

        function extractSmidgetPrompts() {
            const prompts = [];
            const seen = new Set();
            const container = document.querySelector('#dpx-nice-widget-container');

            if (!container) return { container: null, prompts };

            function addPrompt(text) {
                const normalized = cleanText(text);
                const key = normalized.toLowerCase();

                if (isPromptText(normalized) && !seen.has(key)) {
                    seen.add(key);
                    prompts.push(normalized);
                }
            }

            const nodes = Array.from(container.querySelectorAll(
                '[data-dpx-rufus-connect], .small-widget-pill, .ask-pill, button'
            ));

            for (const node of nodes) {
                addPrompt(readQueryFromRufusAttributes(node));
                addPrompt(readQueryFromRufusAttributes(parentElement(node)));
                addPrompt(elementText(node));
            }

            return { container, prompts };
        }

        function extractPromptsFromBodyText() {
            const lines = (document.body?.innerText || '')
                .split('\n')
                .map(cleanText)
                .filter(Boolean);

            const askRufusIndex = lines.findIndex(line => /Ask\s+Rufus/i.test(line));
            if (askRufusIndex === -1) return [];

            const prompts = [];
            const seen = new Set();
            const nearbyLines = lines.slice(askRufusIndex + 1, askRufusIndex + 24);

            for (const line of nearbyLines) {
                const key = line.toLowerCase();
                if (isPromptText(line) && !seen.has(key)) {
                    seen.add(key);
                    prompts.push(line);
                }
            }

            return prompts;
        }

        function findRufusContainer() {
            const allElements = getAllElements(document);
            const candidates = [];

            for (const element of allElements) {
                const text = elementText(element);
                const attrs = attrBlob(element);
                const combined = `${text} ${attrs}`;

                if (/Ask\s+Rufus|Rufus/i.test(combined)) {
                    const container = climbToContainer(element);
                    const prompts = extractPromptTexts(container);
                    const containerText = elementText(container);
                    let score = 0;

                    if (/Ask\s+Rufus/i.test(containerText)) score += 10;
                    if (/rufus/i.test(attrBlob(container))) score += 8;
                    score += prompts.length * 3;
                    if (containerText.length < 1200) score += 2;

                    candidates.push({ container, prompts, score });
                }
            }

            candidates.sort((a, b) => b.score - a.score);
            return candidates[0] || { container: null, prompts: [], score: 0 };
        }

        function extractAsin() {
            const asinFromInputs = document.querySelector('#ASIN, input[name="ASIN"]')?.value;
            if (asinFromInputs && /^[A-Z0-9]{10}$/i.test(asinFromInputs)) {
                return asinFromInputs.toUpperCase();
            }

            const canonical = document.querySelector('link[rel="canonical"]')?.href || window.location.href;
            const pathMatch = canonical.match(/(?:\/dp\/|\/gp\/product\/)([A-Z0-9]{10})(?:[/?]|$)/i);
            if (pathMatch) return pathMatch[1].toUpperCase();

            const queryAsin = new URL(window.location.href).searchParams.get('asin') ||
                              new URL(window.location.href).searchParams.get('ASIN');
            return queryAsin && /^[A-Z0-9]{10}$/i.test(queryAsin) ? queryAsin.toUpperCase() : '';
        }

        function extractPriceInsight() {
            const labels = [];
            const seen = new Set();
            const containers = Array.from(document.querySelectorAll([
                '#rufus-price-ingress',
                '#rufus-price-ingress-desktop',
                '[id*="rufus-price-ingress" i]',
                '[data-csa-c-content-id="rufus-price-ingress-desktop"]',
                '[data-csa-c-slot-id*="rufus-price-ingress" i]',
                '[data-csa-c-nile-action-id*="price_history" i]'
            ].join(',')));

            function addLabel(text) {
                const normalized = cleanText(text);
                if (!normalized) return;

                const compact = normalized.replace(/\s+/g, ' ').trim();
                const knownPriceInsight = /^(high|low|typical)\s+price$/i.test(compact) ||
                                          /^price\s+(?:is\s+)?(?:high|low|typical)$/i.test(compact);

                if (!knownPriceInsight || seen.has(compact.toLowerCase())) {
                    return;
                }

                seen.add(compact.toLowerCase());
                labels.push(compact);
            }

            for (const container of containers) {
                const labelNodes = Array.from(container.querySelectorAll([
                    '.price-insights-ingress-desktop-text',
                    '[class*="price-insights" i]',
                    '[class*="price-insight" i]'
                ].join(',')));

                for (const node of labelNodes) {
                    addLabel(elementText(node));
                }

                const directText = elementText(container);
                const match = directText.match(/\b(?:High|Low|Typical)\s+price\b/i);
                if (match) {
                    addLabel(match[0]);
                }
            }

            const priceInsightLabel = labels[0] || '';
            return {
                priceInsightLabel,
                highPriceDetected: /^high\s+price$/i.test(priceInsightLabel)
            };
        }

        const data = {
            asin: extractAsin(),
            productTitle: '',
            brand: '',
            rating: '',
            reviewCount: '',
            priceInsightLabel: '',
            highPriceDetected: false,
            rufusTitle: '',
            rufusFound: false,
            rufusPrompts: [],
            rufusQuestions: [],
            rufusActions: [],
            askSomethingElsePresent: false
        };

        const titleSelectors = [
            '#productTitle',
            '#title',
            'h1 span',
            'meta[property="og:title"]'
        ];

        for (const selector of titleSelectors) {
            const element = document.querySelector(selector);
            const text = element?.tagName === 'META'
                ? cleanText(element.getAttribute('content'))
                : elementText(element);

            if (text) {
                data.productTitle = text;
                break;
            }
        }

        if (!data.productTitle) {
            data.productTitle = cleanText(document.title.replace(/\s*-\s*Amazon\..*$/i, ''));
        }

        const brandText = elementText(document.querySelector('#bylineInfo, .po-brand .po-break-word'));
        if (brandText) {
            data.brand = brandText
                .replace(/^Visit the\s+/i, '')
                .replace(/\s+Store$/i, '')
                .replace(/^Brand:\s*/i, '')
                .trim();
        }

        const ratingText = elementText(document.querySelector('#acrPopover, #averageCustomerReviews .a-icon-alt'));
        const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)\s+out\s+of\s+5/i);
        if (ratingMatch) {
            data.rating = ratingMatch[1];
        }

        const reviewText = elementText(document.querySelector('#acrCustomerReviewText'));
        const reviewMatch = reviewText.match(/([\d,]+)\s+ratings?/i);
        if (reviewMatch) {
            data.reviewCount = reviewMatch[1];
        }

        const priceInsight = extractPriceInsight();
        data.priceInsightLabel = priceInsight.priceInsightLabel;
        data.highPriceDetected = priceInsight.highPriceDetected;

        const smidgetRufus = extractSmidgetPrompts();
        const rufus = findRufusContainer();
        const bodyPrompts = extractPromptsFromBodyText();
        const allPrompts = [];
        const promptSeen = new Set();

        for (const prompt of [...smidgetRufus.prompts, ...rufus.prompts, ...bodyPrompts]) {
            const key = prompt.toLowerCase();
            if (!promptSeen.has(key)) {
                promptSeen.add(key);
                allPrompts.push(prompt);
            }
        }

        data.rufusPrompts = allPrompts;
        data.rufusQuestions = allPrompts.filter(prompt => prompt.endsWith('?'));
        data.rufusActions = allPrompts.filter(prompt => !prompt.endsWith('?'));
        data.askSomethingElsePresent = allPrompts.some(prompt => /^Ask something else$/i.test(prompt));
        data.rufusFound = /Ask\s+Rufus/i.test(elementText(smidgetRufus.container)) ||
                          /Ask\s+Rufus/i.test(elementText(rufus.container)) ||
                          allPrompts.length > 0;
        data.rufusTitle = data.rufusFound ? 'Ask Rufus' : '';

        return data;
    } catch (error) {
        console.error('Extract Rufus data error:', error);
        return null;
    }
}

// 处理一批URL
async function processBatch() {
    console.log('[processBatch] 开始处理批次，运行状态:', queueState.isRunning, '暂停状态:', queueState.isPaused);

    if (!queueState.isRunning || queueState.isPaused) {
        console.log('[processBatch] 任务未运行或已暂停，退出');
        return;
    }

    if (queueState.pending.length === 0) {
        console.log('[processBatch] 所有任务完成');
        // 所有任务完成
        await completeTask();
        return;
    }

    // 取出一批URL（在基准值基础上 ±20% 随机调整）
    const baseBatchSize = queueState.config.batchSize || 25;
    const batchVariance = Math.round(baseBatchSize * 0.2);
    const actualBatchSize = Math.max(1, baseBatchSize + Math.round((Math.random() * 2 - 1) * batchVariance));
    const batch = queueState.pending.splice(0, Math.min(actualBatchSize, queueState.pending.length));
    console.log('[processBatch] 取出批次:', batch.length, '个URL（基准:', baseBatchSize, '，实际:', actualBatchSize, '），剩余:', queueState.pending.length);

    for (const url of batch) {
        if (!queueState.isRunning || queueState.isPaused) {
            console.log('[processBatch] 检测到暂停或停止信号，将URL放回队列');
            // 如果暂停或停止，将剩余URL放回队列
            queueState.pending.unshift(url);
            return;
        }

        queueState.processing = url;
        console.log('[processBatch] 正在处理:', url);

        // 发送进度更新
        await sendProgressUpdate(`正在抓取: ${extractAsinFromUrl(url) || url}`);

        try {
            // 处理URL
            const result = await processUrl(url);

            if (result.success) {
                queueState.completed.push(url);
                queueState.data.push(result.data);
                queueState.stats.success++;
                console.log('[processBatch] 成功:', url, '累计成功:', queueState.stats.success);
            } else {
                queueState.failed.push({ url, error: result.error });
                queueState.stats.failed++;
                console.log('[processBatch] 失败:', url, '错误:', result.error, '累计失败:', queueState.stats.failed);
            }
        } catch (error) {
            console.error('[processBatch] 处理异常:', url, error);
            queueState.failed.push({ url, error: error.message });
            queueState.stats.failed++;
        }

        queueState.stats.processed++;
        queueState.processing = null;

        // 保存进度
        await saveProgress();

        // 发送更新
        await sendProgressUpdate();
    }

    // 批次间休息
    if (queueState.pending.length > 0 && queueState.isRunning && !queueState.isPaused) {
        // 基于基准值进行 ±20% 的随机调整
        const baseRestTime = queueState.config.restTime || 60000;
        const variance = baseRestTime * 0.2; // 20% 的波动范围
        const restTime = Math.round(baseRestTime + (Math.random() * 2 - 1) * variance);

        console.log('[processBatch] 批次休息中，剩余任务:', queueState.pending.length, '基准:', Math.round(baseRestTime / 1000), '秒，实际:', Math.round(restTime / 1000), '秒');
        await sendProgressUpdate(`批次休息中 (${Math.round(restTime / 1000)}秒)...`);
        await new Promise(resolve => setTimeout(resolve, restTime));

        // 继续处理下一批
        console.log('[processBatch] 休息结束，继续处理下一批');
        await processBatch();
    } else if (queueState.pending.length === 0) {
        await completeTask();
    }
}

// 完成任务
async function completeTask() {
    console.log('[completeTask] 任务完成，成功:', queueState.stats.success, '失败:', queueState.stats.failed);
    queueState.isRunning = false;
    queueState.isPaused = false;

    // 停止保活机制
    stopKeepAlive();

    // 保存最终数据并清空队列状态（表示任务已完成）
    await chrome.storage.local.set({
        scraperData: queueState.data,
        scraperStats: queueState.stats,
        scraperRunning: false,
        scraperPaused: false,
        // 清空队列状态，这样下次点击"开始"会启动新任务
        scraperQueuePending: [],
        scraperQueueCompleted: [],
        scraperQueueFailed: []
    });

    // 清空内存中的队列状态
    queueState.pending = [];
    queueState.completed = [];
    queueState.failed = [];

    // 发送完成消息
    try {
        await chrome.runtime.sendMessage({
            action: 'taskComplete'
        });
    } catch (error) {
        console.error('Failed to send complete message:', error);
    }

    // 显示通知
    await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Amazon Rufus信息抓取',
        message: `抓取完成！成功: ${queueState.stats.success}, 失败: ${queueState.stats.failed}`
    });
}

// 发送进度更新
async function sendProgressUpdate(status) {
    try {
        await chrome.runtime.sendMessage({
            action: 'updateProgress',
            stats: {
                total: queueState.stats.total,
                success: queueState.stats.success,
                failed: queueState.stats.failed,
                pending: queueState.pending.length
            },
            data: queueState.data,
            status: status
        });
    } catch (error) {
        // Popup可能已关闭
        console.error('Failed to send progress update:', error);
    }
}

// 保存进度
async function saveProgress() {
    try {
        await chrome.storage.local.set({
            scraperData: queueState.data,
            scraperStats: queueState.stats,
            // 保存队列状态以便断点续传
            scraperQueuePending: queueState.pending,
            scraperQueueCompleted: queueState.completed,
            scraperQueueFailed: queueState.failed
        });
    } catch (error) {
        console.error('Failed to save progress:', error);
    }
}

// 从 storage 恢复队列状态
async function restoreQueueState(urls, config) {
    try {
        const result = await chrome.storage.local.get([
            'scraperQueuePending',
            'scraperQueueCompleted',
            'scraperQueueFailed',
            'scraperData',
            'scraperStats'
        ]);

        // 检查是否有未完成的任务
        const hasUnfinishedTask = result.scraperQueuePending &&
                                  result.scraperQueuePending.length > 0;

        if (hasUnfinishedTask) {
            // 恢复之前的队列状态
            queueState.pending = result.scraperQueuePending || [];
            queueState.completed = result.scraperQueueCompleted || [];
            queueState.failed = result.scraperQueueFailed || [];
            queueState.data = result.scraperData || [];
            queueState.stats = result.scraperStats || {
                total: urls.length,
                success: 0,
                failed: 0,
                processed: 0
            };

            // 确保统计数据的 total 与当前 URL 数量一致
            queueState.stats.total = urls.length;

            console.log('已恢复未完成的任务，剩余:', queueState.pending.length);
            return true;
        }
    } catch (error) {
        console.error('Failed to restore queue state:', error);
    }
    return false;
}

// 启动抓取
async function startScraping(urls, config, isNewTask = false) {
    console.log('[startScraping] 启动Rufus抓取任务，URL数量:', urls.length, '是否新任务:', isNewTask);
    queueState.config = config;
    queueState.isRunning = true;
    queueState.isPaused = false;

    // 启动保活机制，防止 Service Worker 被挂起
    startKeepAlive();

    // 如果是新任务，清空旧的队列状态
    if (isNewTask) {
        await chrome.storage.local.set({
            scraperQueuePending: [],
            scraperQueueCompleted: [],
            scraperQueueFailed: []
        });
        console.log('[startScraping] 新任务，已清空旧队列状态');
    }

    // 尝试恢复之前的队列状态
    const restored = await restoreQueueState(urls, config);

    if (!restored) {
        // 没有未完成的任务，初始化新队列
        queueState.pending = [...urls];
        queueState.completed = [];
        queueState.failed = [];
        queueState.data = [];
        queueState.stats = {
            total: urls.length,
            success: 0,
            failed: 0,
            processed: 0
        };
        console.log('[startScraping] 初始化新队列');
    } else {
        console.log('[startScraping] 恢复已有队列，剩余:', queueState.pending.length);
    }

    // 保存初始状态
    await chrome.storage.local.set({
        scraperRunning: true,
        scraperPaused: false
    });

    // 开始处理
    await processBatch();
}

// 暂停抓取
async function pauseScraping() {
    queueState.isPaused = true;
    await chrome.storage.local.set({ scraperPaused: true });
}

// 继续抓取
async function resumeScraping() {
    queueState.isPaused = false;
    await chrome.storage.local.set({ scraperPaused: false });
    await processBatch();
}

// 停止抓取
async function stopScraping() {
    console.log('[stopScraping] 停止抓取任务');
    queueState.isRunning = false;
    queueState.isPaused = false;

    // 停止保活机制
    stopKeepAlive();

    // 保存队列状态以便下次继续
    await chrome.storage.local.set({
        scraperRunning: false,
        scraperPaused: false,
        scraperQueuePending: queueState.pending,
        scraperQueueCompleted: queueState.completed,
        scraperQueueFailed: queueState.failed,
        scraperData: queueState.data,
        scraperStats: queueState.stats
    });
}

// 消息监听
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'start':
            startScraping(message.urls, message.config, message.isNewTask)
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'pause':
            pauseScraping()
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            break;

        case 'resume':
            resumeScraping()
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'stop':
            stopScraping()
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            break;

        case 'getStatus':
            sendResponse({
                status: queueState.isRunning ? 'running' : 'idle',
                paused: queueState.isPaused
            });
            break;

        default:
            sendResponse({ success: false, error: 'Unknown action' });
    }

    return true;
});

// 启动时检查是否有未完成的任务
chrome.runtime.onStartup.addListener(async () => {
    try {
        const result = await chrome.storage.local.get(['scraperRunning', 'scraperPaused']);

        if (result.scraperRunning && !result.scraperPaused) {
            // 如果有未完成的任务，可以选择自动恢复
            // await resumeFromStorage();
        }
    } catch (error) {
        console.error('Startup check failed:', error);
    }
});

// 安装时初始化
chrome.runtime.onInstalled.addListener(() => {
    console.log('Amazon Rufus Scraper extension installed');
});
