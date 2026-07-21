// Background Service Worker - alexai 智能队列管理系统

// 队列状态
const queueState = {
    pending: [],      // 待处理URL
    processing: [],   // 当前处理中的URL
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

const MIN_CONCURRENT_WINDOWS = 2;
const MAX_CONCURRENT_WINDOWS = 5;
const DEFAULT_MIN_CONCURRENT_WINDOWS = 2;
const DEFAULT_MAX_CONCURRENT_WINDOWS = 5;
const EXTRACTION_TIMEOUT_MS = 22000;
const EXTRACTION_POLL_INTERVAL_MS = 700;
const NO_RUFUS_MIN_WAIT_MS = 6000;

const activeTasks = new Map();
const activeTabs = new Map();
let schedulerPromise = null;
let taskSequence = 0;
let desiredWindowCount = 0;
let nextLaunchAt = 0;
let restUntil = 0;
let processedSinceRest = 0;

const DEFAULT_LICENSE_API_URL = 'http://127.0.0.1:8080';
const ALEXA_SCRAPING_FEATURE = 'alexa_scraping';
const LICENSE_REQUEST_TIMEOUT_MS = 15000;

// 随机延迟函数
function randomDelay(min, max) {
    const rawMin = Number.isFinite(Number(min)) ? Number(min) : 0;
    const rawMax = Number.isFinite(Number(max)) ? Number(max) : rawMin;
    const lower = Math.max(0, Math.min(rawMin, rawMax));
    const upper = Math.max(lower, Math.max(rawMin, rawMax));
    return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, Math.round(number)));
}

function getConcurrencyConfig() {
    const minRaw = queueState.config.minConcurrentWindows ?? DEFAULT_MIN_CONCURRENT_WINDOWS;
    const maxRaw = queueState.config.maxConcurrentWindows ?? DEFAULT_MAX_CONCURRENT_WINDOWS;
    const clampedMin = clampNumber(minRaw, MIN_CONCURRENT_WINDOWS, MAX_CONCURRENT_WINDOWS);
    const clampedMax = clampNumber(maxRaw, MIN_CONCURRENT_WINDOWS, MAX_CONCURRENT_WINDOWS);

    return {
        min: Math.min(clampedMin, clampedMax),
        max: Math.max(clampedMin, clampedMax)
    };
}

function refreshDesiredWindowCount() {
    const { min, max } = getConcurrencyConfig();
    const availableWork = queueState.pending.length + activeTasks.size;
    desiredWindowCount = availableWork > 0
        ? Math.min(randomDelay(min, max), availableWork)
        : 0;
    return desiredWindowCount;
}

function getLaunchDelay() {
    return randomDelay(queueState.config.delayMin ?? 2000, queueState.config.delayMax ?? 5000);
}

function scheduleNextLaunch() {
    nextLaunchAt = Date.now() + getLaunchDelay();
}

function getRandomizedRestTime() {
    const baseRestTime = queueState.config.restTime || 60000;
    const variance = baseRestTime * 0.2;
    return Math.round(baseRestTime + (Math.random() * 2 - 1) * variance);
}

function maybeStartBatchRest() {
    const batchSize = queueState.config.batchSize || 25;
    if (batchSize <= 0 || processedSinceRest < batchSize || queueState.pending.length === 0) {
        return 0;
    }

    const restTime = getRandomizedRestTime();
    restUntil = Date.now() + restTime;
    processedSinceRest = 0;
    return restTime;
}

function removeProcessingUrl(url) {
    const index = queueState.processing.indexOf(url);
    if (index >= 0) {
        queueState.processing.splice(index, 1);
    }
}

async function closeTabIfOpen(tabId) {
    try {
        await chrome.tabs.remove(tabId);
    } catch (_) {
        // Tab may already be closed.
    }
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

function getPromptCount(data) {
    return [
        data?.rufusPrompts,
        data?.rufusQuestions,
        data?.rufusActions
    ].reduce((count, values) => count + (Array.isArray(values) ? values.length : 0), 0);
}

function hasRufusData(data) {
    return getPromptCount(data) > 0;
}

function hasRufusSignal(data) {
    return Boolean(data?.rufusFound);
}

function hasUsefulProductContext(data) {
    const title = String(data?.productTitle || '').trim();
    const genericTitle = /^(amazon|amazon\.[a-z.]+)$/i.test(title);
    const blockedTitle = /robot check|captcha|sorry/i.test(title);

    return Boolean(
        (title && !genericTitle && !blockedTitle) ||
        data?.brand ||
        data?.rating ||
        data?.reviewCount ||
        data?.priceInsightLabel
    );
}

function hasMinimumExtractedData(data) {
    return hasRufusData(data) || hasRufusSignal(data) || hasUsefulProductContext(data);
}

function isExtractedDataReady(data, elapsedMs) {
    if (!data) return false;
    if (hasRufusData(data)) return true;
    return elapsedMs >= NO_RUFUS_MIN_WAIT_MS &&
        (hasRufusSignal(data) || hasUsefulProductContext(data));
}

async function scrollTab(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => window.scrollBy({ top: 350, behavior: 'smooth' })
        });
    } catch (_) {
        // Ignore scroll failures while the page is still navigating.
    }
}

// 打开后不等待页面 complete；轮询到可用数据后立即返回，由 finally 关闭 tab。
async function extractWhenAvailable(tabId) {
    const startedAt = Date.now();
    let lastData = null;
    let lastError = null;
    let simulatedBehavior = false;
    let firstScrollDone = false;
    let secondScrollDone = false;

    while (Date.now() - startedAt < EXTRACTION_TIMEOUT_MS) {
        if (!queueState.isRunning && !queueState.isPaused) {
            throw new Error('Task stopped');
        }

        const elapsedMs = Date.now() - startedAt;

        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: extractProductRufusData
            });
            const data = results?.[0]?.result;

            if (data) {
                lastData = data;
                if (isExtractedDataReady(data, elapsedMs)) {
                    return data;
                }
            }
        } catch (error) {
            lastError = error;
        }

        if (!simulatedBehavior && elapsedMs >= 1200) {
            simulatedBehavior = true;
            await simulateHumanBehavior(tabId);
        }

        if (!firstScrollDone && elapsedMs >= 3500) {
            firstScrollDone = true;
            await scrollTab(tabId);
        } else if (!secondScrollDone && elapsedMs >= 7000) {
            secondScrollDone = true;
            await scrollTab(tabId);
        }

        await sleep(EXTRACTION_POLL_INTERVAL_MS);
    }

    if (lastData && hasMinimumExtractedData(lastData)) {
        return lastData;
    }

    throw new Error(lastError?.message || 'No valid data found before timeout');
}

// 处理单个URL
async function processUrl(url) {
    const asin = extractAsinFromUrl(url);

    if (!asin) {
        throw new Error('Invalid product URL or ASIN');
    }

    const maxAttempts = queueState.config.enableRetry
        ? (queueState.config.retryLimit || 3) + 1
        : 1;
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let tab = null;

        try {
            if (!queueState.isRunning && !queueState.isPaused) {
                throw new Error('Task stopped');
            }

            tab = await chrome.tabs.create({
                url,
                active: false
            });
            activeTabs.set(tab.id, url);

            const data = await extractWhenAvailable(tab.id);

            if (!hasMinimumExtractedData(data)) {
                throw new Error('No valid data found');
            }

            data.url = url;
            data.asin = data.asin || asin;
            data.scrapedAt = new Date().toISOString();

            retryCount.delete(url);
            return { success: true, data };
        } catch (error) {
            lastError = error;
            console.error('Error processing URL:', url, error);

            const canRetry = queueState.config.enableRetry &&
                attempt < maxAttempts - 1 &&
                (queueState.isRunning || queueState.isPaused);

            if (canRetry) {
                retryCount.set(url, attempt + 1);
                await sleep(randomDelay(5000, 10000));
            }
        } finally {
            if (tab?.id) {
                activeTabs.delete(tab.id);
                await closeTabIfOpen(tab.id);
            }
        }
    }

    retryCount.delete(url);
    return { success: false, error: lastError?.message || 'Failed to extract data', url };
}

// 在页面中执行的函数（提取商品页 Alexa for Shopping/Rufus 数据）
function extractProductRufusData() {
    try {
        function cleanText(value) {
            return String(value || '')
                .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        const assistantTextPattern = /Ask\s+Rufus|Rufus|Alexa\s+for\s+Shopping|Ask\s+Alexa/i;
        const assistantAttrPattern = /rufus|alexa-shopping/i;

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
                const hasRufus = assistantTextPattern.test(text) || assistantAttrPattern.test(attrs);
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
            if (/^Alexa\s+for\s+Shopping$/i.test(normalized)) return false;
            if (/^Ask\s+Alexa$/i.test(normalized)) return false;
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
                '[id*="alexa-shopping" i]',
                '[class*="alexa-shopping" i]',
                '[aria-label*="Alexa for Shopping" i]',
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

            const askRufusIndex = lines.findIndex(line => assistantTextPattern.test(line));
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

                if (assistantTextPattern.test(combined) || assistantAttrPattern.test(attrs)) {
                    const container = climbToContainer(element);
                    const prompts = extractPromptTexts(container);
                    const containerText = elementText(container);
                    let score = 0;

                    if (assistantTextPattern.test(containerText)) score += 10;
                    if (assistantAttrPattern.test(attrBlob(container))) score += 8;
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
        data.rufusFound = assistantTextPattern.test(elementText(smidgetRufus.container)) ||
                          assistantTextPattern.test(elementText(rufus.container)) ||
                          allPrompts.length > 0;
        data.rufusTitle = data.rufusFound ? 'Alexa for Shopping' : '';

        return data;
    } catch (error) {
        console.error('Extract Alexa for Shopping data error:', error);
        return null;
    }
}

function getProgressPendingCount() {
    return Math.max(0, queueState.stats.total - queueState.stats.success - queueState.stats.failed);
}

function getWindowStatus(prefix = '运行中') {
    const target = desiredWindowCount || refreshDesiredWindowCount();
    return `${prefix}: ${activeTasks.size}/${target} 个窗口，待处理 ${queueState.pending.length}`;
}

function startQueueScheduler() {
    if (!schedulerPromise) {
        schedulerPromise = runQueueScheduler()
            .catch(error => console.error('[scheduler] 调度异常:', error))
            .finally(() => {
                schedulerPromise = null;
            });
    }

    return schedulerPromise;
}

async function runQueueScheduler() {
    console.log('[scheduler] 启动动态并发调度，运行状态:', queueState.isRunning, '暂停状态:', queueState.isPaused);

    if (!desiredWindowCount) {
        refreshDesiredWindowCount();
    }

    while (queueState.isRunning) {
        if (queueState.pending.length === 0 && activeTasks.size === 0) {
            console.log('[scheduler] 所有任务完成');
            await completeTask();
            return;
        }

        if (queueState.isPaused) {
            const status = activeTasks.size > 0
                ? `任务已暂停，等待 ${activeTasks.size} 个窗口完成`
                : '任务已暂停';
            await sendProgressUpdate(status);
            return;
        }

        const now = Date.now();
        if (restUntil > now) {
            await sendProgressUpdate(`批次休息中 (${Math.ceil((restUntil - now) / 1000)}秒)...`);
            await sleep(Math.min(1000, restUntil - now));
            continue;
        }

        if (desiredWindowCount <= 0 && queueState.pending.length > 0) {
            refreshDesiredWindowCount();
        }

        if (queueState.pending.length === 0 || activeTasks.size >= desiredWindowCount) {
            await sleep(250);
            continue;
        }

        if (nextLaunchAt > now) {
            await sleep(Math.min(500, nextLaunchAt - now));
            continue;
        }

        const immediateFill = activeTasks.size === 0 && nextLaunchAt === 0;
        const launchCount = immediateFill
            ? Math.max(1, desiredWindowCount - activeTasks.size)
            : 1;

        for (let index = 0; index < launchCount; index++) {
            if (!queueState.isRunning || queueState.isPaused) break;
            if (queueState.pending.length === 0 || activeTasks.size >= desiredWindowCount) break;

            const url = queueState.pending.shift();
            launchUrlTask(url);
        }

        if (!immediateFill && queueState.pending.length > 0 && activeTasks.size < desiredWindowCount) {
            scheduleNextLaunch();
        }

        await saveProgress();
        await sendProgressUpdate(getWindowStatus());
        await sleep(100);
    }
}

function launchUrlTask(url) {
    const taskId = ++taskSequence;
    queueState.processing.push(url);
    activeTasks.set(taskId, { url });
    console.log('[scheduler] 打开窗口:', url, '当前窗口:', activeTasks.size, '目标窗口:', desiredWindowCount);

    handleUrlTask(taskId, url);
}

async function handleUrlTask(taskId, url) {
    try {
        await sendProgressUpdate(`正在抓取: ${extractAsinFromUrl(url) || url}`);
        const result = await processUrl(url);

        if (!queueState.isRunning && !queueState.isPaused) {
            return;
        }

        if (result.success) {
            queueState.completed.push(url);
            queueState.data.push(result.data);
            queueState.stats.success++;
            console.log('[scheduler] 成功:', url, '累计成功:', queueState.stats.success);
        } else {
            queueState.failed.push({ url, error: result.error });
            queueState.stats.failed++;
            console.log('[scheduler] 失败:', url, '错误:', result.error, '累计失败:', queueState.stats.failed);
        }
    } catch (error) {
        if (queueState.isRunning || queueState.isPaused) {
            console.error('[scheduler] 处理异常:', url, error);
            queueState.failed.push({ url, error: error.message });
            queueState.stats.failed++;
        }
    } finally {
        activeTasks.delete(taskId);
        removeProcessingUrl(url);

        if (!queueState.isRunning && !queueState.isPaused) {
            return;
        }

        queueState.stats.processed++;
        processedSinceRest++;

        refreshDesiredWindowCount();
        const restTime = maybeStartBatchRest();
        if (restTime > 0) {
            console.log('[scheduler] 批次休息，实际:', Math.round(restTime / 1000), '秒');
        } else if (queueState.pending.length > 0) {
            scheduleNextLaunch();
        }

        await saveProgress();
        await sendProgressUpdate(restTime > 0
            ? `批次休息中 (${Math.round(restTime / 1000)}秒)...`
            : getWindowStatus());

        if (queueState.pending.length === 0 && activeTasks.size === 0 && queueState.isRunning) {
            await completeTask();
            return;
        }

        if (queueState.isRunning && !queueState.isPaused) {
            startQueueScheduler();
        }
    }
}

// 完成任务
async function completeTask() {
    console.log('[completeTask] 任务完成，成功:', queueState.stats.success, '失败:', queueState.stats.failed);
    queueState.isRunning = false;
    queueState.isPaused = false;
    desiredWindowCount = 0;
    nextLaunchAt = 0;
    restUntil = 0;
    processedSinceRest = 0;

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
    queueState.processing = [];
    queueState.completed = [];
    queueState.failed = [];
    activeTasks.clear();
    activeTabs.clear();

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
        title: 'Amazon Alexa for Shopping 信息抓取',
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
                processed: queueState.stats.processed,
                pending: getProgressPendingCount(),
                active: activeTasks.size,
                targetWindows: desiredWindowCount
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
    console.log('[startScraping] 启动 Alexa for Shopping 抓取任务，URL数量:', urls.length, '是否新任务:', isNewTask);
    queueState.config = config;
    queueState.isRunning = true;
    queueState.isPaused = false;
    queueState.processing = [];
    activeTasks.clear();
    activeTabs.clear();
    nextLaunchAt = 0;
    restUntil = 0;

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
        processedSinceRest = 0;
        console.log('[startScraping] 初始化新队列');
    } else {
        processedSinceRest = (queueState.stats.processed || 0) % (queueState.config.batchSize || 25);
        console.log('[startScraping] 恢复已有队列，剩余:', queueState.pending.length);
    }

    refreshDesiredWindowCount();

    // 保存初始状态
    await chrome.storage.local.set({
        scraperRunning: true,
        scraperPaused: false
    });

    // 开始处理
    startQueueScheduler();
    await sendProgressUpdate(getWindowStatus('已启动'));
}

// 暂停抓取
async function pauseScraping() {
    queueState.isPaused = true;
    await chrome.storage.local.set({ scraperPaused: true });
    await sendProgressUpdate(activeTasks.size > 0
        ? `任务已暂停，等待 ${activeTasks.size} 个窗口完成`
        : '任务已暂停');
}

// 继续抓取
async function resumeScraping() {
    queueState.isPaused = false;
    await chrome.storage.local.set({ scraperPaused: false });
    refreshDesiredWindowCount();
    startQueueScheduler();
    await sendProgressUpdate(getWindowStatus('已继续'));
}

// 停止抓取
async function stopScraping() {
    console.log('[stopScraping] 停止抓取任务');
    const interruptedUrls = [...queueState.processing];
    queueState.pending = [...interruptedUrls, ...queueState.pending];
    queueState.processing = [];
    queueState.isRunning = false;
    queueState.isPaused = false;
    desiredWindowCount = 0;
    nextLaunchAt = 0;
    restUntil = 0;

    // 停止保活机制
    stopKeepAlive();

    const tabIds = Array.from(activeTabs.keys());
    activeTasks.clear();
    activeTabs.clear();
    await Promise.all(tabIds.map(tabId => closeTabIfOpen(tabId)));

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

function isAmazonSender(sender) {
    try {
        const url = new URL(sender?.url || sender?.tab?.url || '');
        return /^https?:$/.test(url.protocol) && /(?:^|\.)amazon\./i.test(url.hostname);
    } catch (_) {
        return false;
    }
}

function isAllowedAmazonImageUrl(value) {
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        return /^https?:$/.test(url.protocol) &&
            (
                /(?:^|\.)media-amazon\.com$/.test(host) ||
                /(?:^|\.)ssl-images-amazon\.com$/.test(host) ||
                (host.includes('amazon.') && url.pathname.includes('/images/'))
            );
    } catch (_) {
        return false;
    }
}

function sanitizeDownloadFilename(filename) {
    const value = String(filename || '')
        .replace(/\\/g, '/')
        .split('/')
        .map(part => part
            .replace(/[<>:"|?*\x00-\x1F]/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\.+$/g, '')
            .trim()
            .slice(0, 120))
        .filter(Boolean)
        .join('/');

    return value || `amazon-images/amazon-image-${Date.now()}.jpg`;
}

function chromeDownload(options) {
    return new Promise((resolve, reject) => {
        chrome.downloads.download(options, downloadId => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(error.message));
                return;
            }

            resolve(downloadId);
        });
    });
}

async function downloadAmazonImage(message, sender) {
    if (!isAmazonSender(sender)) {
        throw new Error('Downloads are only accepted from Amazon pages');
    }

    if (!isAllowedAmazonImageUrl(message.imageUrl)) {
        throw new Error('Not an Amazon image URL');
    }

    const filename = sanitizeDownloadFilename(message.filename);
    const downloadId = await chromeDownload({
        url: message.imageUrl,
        filename,
        conflictAction: 'uniquify',
        saveAs: false
    });

    return { success: true, downloadId, filename };
}

function normalizeLicenseApiUrl(value) {
    const url = new URL(String(value || DEFAULT_LICENSE_API_URL).trim());
    const isLocalHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (url.protocol !== 'https:' && !isLocalHttp) {
        throw new Error('正式授权服务必须使用 HTTPS，本机调试可使用 localhost 或 127.0.0.1');
    }

    url.search = '';
    url.hash = '';
    return url.href.replace(/\/+$/, '');
}

function getLicenseActivationEndpoint(apiBaseUrl) {
    const url = new URL(normalizeLicenseApiUrl(apiBaseUrl));
    const normalizedPath = url.pathname.replace(/\/+$/, '');
    if (normalizedPath.endsWith('/v1/licenses/activate')) {
        url.pathname = normalizedPath;
    } else if (normalizedPath.endsWith('/v1/licenses')) {
        url.pathname = `${normalizedPath}/activate`;
    } else {
        url.pathname = `${normalizedPath}/v1/licenses/activate`.replace(/\/+/g, '/');
    }
    url.search = '';
    url.hash = '';
    return url.href;
}

function getDefaultAlexaLicenseState(apiBaseUrl = DEFAULT_LICENSE_API_URL) {
    return {
        apiBaseUrl: normalizeLicenseApiUrl(apiBaseUrl),
        verified: false,
        plan: 'free',
        features: [],
        expiresAt: '',
        lastVerifiedAt: '',
        maskedKey: '',
        statusMessage: '尚未授权'
    };
}

function normalizeLicenseFeatures(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .map(feature => String(feature || '').trim())
        .filter(Boolean))];
}

function normalizeLicenseExpiry(value) {
    if (value === null || value === undefined || value === '') return '';

    let date;
    if (typeof value === 'number' || /^\d+$/.test(String(value))) {
        const timestamp = Number(value);
        date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
    } else {
        date = new Date(value);
    }

    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function maskLicenseKey(licenseKey) {
    const value = String(licenseKey || '').trim();
    if (!value) return '';
    return `••••${value.slice(-4)}`;
}

function createDeviceId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function getAlexaDeviceId() {
    const stored = await chrome.storage.local.get('alexaDeviceId');
    if (stored.alexaDeviceId) return String(stored.alexaDeviceId);

    const deviceId = createDeviceId();
    await chrome.storage.local.set({ alexaDeviceId: deviceId });
    return deviceId;
}

async function getStoredAlexaLicenseState() {
    const stored = await chrome.storage.local.get('alexaLicenseState');
    const saved = stored.alexaLicenseState || {};
    let apiBaseUrl = DEFAULT_LICENSE_API_URL;
    try {
        apiBaseUrl = normalizeLicenseApiUrl(saved.apiBaseUrl || DEFAULT_LICENSE_API_URL);
    } catch (_) {
        // Fall back to the local development endpoint when legacy data is invalid.
    }

    const features = normalizeLicenseFeatures(saved.features);
    const expiresAt = normalizeLicenseExpiry(saved.expiresAt);
    const expired = Boolean(expiresAt) && Date.parse(expiresAt) <= Date.now();
    const verified = saved.verified === true && !expired && features.includes(ALEXA_SCRAPING_FEATURE);

    return {
        ...getDefaultAlexaLicenseState(apiBaseUrl),
        verified,
        plan: verified ? String(saved.plan || 'pro') : 'free',
        features: verified ? features : [],
        expiresAt,
        lastVerifiedAt: String(saved.lastVerifiedAt || ''),
        maskedKey: String(saved.maskedKey || ''),
        statusMessage: expired ? '授权已过期，请续期后重新激活' : String(saved.statusMessage || '尚未授权')
    };
}

async function saveInvalidAlexaLicenseState(apiBaseUrl, statusMessage, maskedKey = '') {
    const license = {
        ...getDefaultAlexaLicenseState(apiBaseUrl),
        maskedKey,
        statusMessage: String(statusMessage || '授权不可用')
    };
    await chrome.storage.local.set({ alexaLicenseState: license });
    return license;
}

function getLicenseResponseData(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.success === false || (payload.code !== undefined && Number(payload.code) !== 0)) {
        return null;
    }
    return payload.data && typeof payload.data === 'object' ? payload.data : payload;
}

async function activateAlexaLicense(licenseKey, apiBaseUrl) {
    const normalizedKey = String(licenseKey || '').trim();
    if (!normalizedKey) {
        throw new Error('请输入授权码');
    }

    const normalizedApiBaseUrl = normalizeLicenseApiUrl(apiBaseUrl);
    const endpoint = getLicenseActivationEndpoint(normalizedApiBaseUrl);
    const deviceId = await getAlexaDeviceId();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LICENSE_REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                licenseKey: normalizedKey,
                deviceId,
                extensionVersion: chrome.runtime.getManifest().version
            }),
            cache: 'no-store',
            signal: controller.signal
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch (_) {
            // The status-specific error below is more useful than a JSON parse error.
        }

        if (response.status === 401 || response.status === 403) {
            throw new Error('授权码无效、已过期或已被停用');
        }
        if (!response.ok) {
            throw new Error(payload?.message || payload?.error || `授权服务请求失败（HTTP ${response.status}）`);
        }

        const licenseData = getLicenseResponseData(payload);
        if (!licenseData) {
            throw new Error(payload?.message || payload?.error || '授权服务拒绝了该授权码');
        }

        const features = normalizeLicenseFeatures(licenseData.features);
        if (!features.includes(ALEXA_SCRAPING_FEATURE)) {
            throw new Error('当前授权不包含 Alexa / Rufus 抓取权限');
        }

        const deniedStatuses = new Set(['revoked', 'inactive', 'expired', 'disabled']);
        if (deniedStatuses.has(String(licenseData.status || '').toLowerCase())) {
            throw new Error('授权码无效、已过期或已被停用');
        }

        const expiresAt = normalizeLicenseExpiry(licenseData.expiresAt);
        if (licenseData.expiresAt && !expiresAt) {
            throw new Error('授权服务返回了无效的到期时间');
        }
        if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
            throw new Error('授权已过期，请续期后重新激活');
        }
        if (licenseData.deviceId && String(licenseData.deviceId) !== deviceId) {
            throw new Error('授权服务返回的设备信息不匹配');
        }

        const license = {
            apiBaseUrl: normalizedApiBaseUrl,
            verified: true,
            plan: String(licenseData.plan || 'pro'),
            features,
            expiresAt,
            lastVerifiedAt: new Date().toISOString(),
            maskedKey: maskLicenseKey(normalizedKey),
            statusMessage: '高级版已授权'
        };
        await chrome.storage.local.set({
            alexaLicenseCredential: { licenseKey: normalizedKey },
            alexaLicenseState: license
        });
        return license;
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error('授权服务响应超时');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function verifyStoredAlexaLicense() {
    const stored = await chrome.storage.local.get(['alexaLicenseCredential', 'alexaLicenseState']);
    const licenseKey = String(stored.alexaLicenseCredential?.licenseKey || '').trim();
    const apiBaseUrl = stored.alexaLicenseState?.apiBaseUrl || DEFAULT_LICENSE_API_URL;
    const maskedKey = String(stored.alexaLicenseState?.maskedKey || maskLicenseKey(licenseKey));
    if (!licenseKey) {
        await saveInvalidAlexaLicenseState(apiBaseUrl, 'Alexa / Rufus 抓取需要有效授权码');
        throw new Error('Alexa / Rufus 抓取需要有效授权码');
    }

    try {
        return await activateAlexaLicense(licenseKey, apiBaseUrl);
    } catch (error) {
        await saveInvalidAlexaLicenseState(apiBaseUrl, error.message, maskedKey);
        throw error;
    }
}

async function activateAlexaLicenseFromMessage(licenseKey, apiBaseUrl) {
    try {
        return await activateAlexaLicense(licenseKey, apiBaseUrl);
    } catch (error) {
        const stored = await chrome.storage.local.get(['alexaLicenseCredential', 'alexaLicenseState']);
        const savedKey = String(stored.alexaLicenseCredential?.licenseKey || '').trim();
        const attemptedKey = String(licenseKey || '').trim();
        if (savedKey && savedKey === attemptedKey) {
            const savedApiBaseUrl = stored.alexaLicenseState?.apiBaseUrl || apiBaseUrl || DEFAULT_LICENSE_API_URL;
            await saveInvalidAlexaLicenseState(savedApiBaseUrl, error.message, maskLicenseKey(savedKey));
        }
        throw error;
    }
}

async function updateAlexaLicenseApiUrl(apiBaseUrl) {
    const normalizedApiBaseUrl = normalizeLicenseApiUrl(apiBaseUrl);
    const previous = await getStoredAlexaLicenseState();
    return saveInvalidAlexaLicenseState(
        normalizedApiBaseUrl,
        '授权服务地址已更新，请重新激活',
        previous.maskedKey
    );
}

async function clearAlexaLicense() {
    const previous = await getStoredAlexaLicenseState();
    const license = getDefaultAlexaLicenseState(previous.apiBaseUrl);
    license.statusMessage = '授权已移除';
    await chrome.storage.local.remove(['alexaLicenseCredential']);
    await chrome.storage.local.set({ alexaLicenseState: license });
    return license;
}

// 消息监听
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'start':
            verifyStoredAlexaLicense()
                .then(() => startScraping(message.urls, message.config, message.isNewTask))
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'pause':
            pauseScraping()
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            break;

        case 'resume':
            verifyStoredAlexaLicense()
                .then(() => resumeScraping())
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

        case 'downloadAmazonImage':
            downloadAmazonImage(message, sender)
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'activateAlexaLicense':
            activateAlexaLicenseFromMessage(message.licenseKey, message.apiBaseUrl)
                .then(license => sendResponse({ success: true, license }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'getAlexaLicenseStatus':
            getStoredAlexaLicenseState()
                .then(license => sendResponse({ success: true, license }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'updateAlexaLicenseApiUrl':
            updateAlexaLicenseApiUrl(message.apiBaseUrl)
                .then(license => sendResponse({ success: true, license }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'clearAlexaLicense':
            clearAlexaLicense()
                .then(license => sendResponse({ success: true, license }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

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
    console.log('alexai extension installed');
});
