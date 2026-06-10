// Content Script - Amazon商品页 Alexa for Shopping 信息增强

(function() {
    'use strict';

    const pathname = window.location.pathname;
    const isProductPage = /\/dp\/[A-Z0-9]{10}(?:[/?]|$)/i.test(pathname) ||
                          /\/gp\/product\/[A-Z0-9]{10}(?:[/?]|$)/i.test(pathname);

    if (!isProductPage) {
        return;
    }

    console.log('alexai - Content script loaded');

    function cleanText(value) {
        return String(value || '')
            .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    const assistantTextPattern = /Ask\s+Rufus|Rufus|Alexa\s+for\s+Shopping|Ask\s+Alexa/i;

    function extractAsin() {
        const inputAsin = document.querySelector('#ASIN, input[name="ASIN"]')?.value;
        if (inputAsin && /^[A-Z0-9]{10}$/i.test(inputAsin)) {
            return inputAsin.toUpperCase();
        }

        const canonical = document.querySelector('link[rel="canonical"]')?.href || window.location.href;
        const match = canonical.match(/(?:\/dp\/|\/gp\/product\/)([A-Z0-9]{10})(?:[/?]|$)/i);
        return match ? match[1].toUpperCase() : '';
    }

    function isPromptText(text) {
        const normalized = cleanText(text);
        if (!normalized || normalized.length > 140) return false;
        if (/^Ask\s+Rufus$/i.test(normalized)) return false;
        if (/Ask\s+Rufus/i.test(normalized)) return false;
        if (/^Alexa\s+for\s+Shopping$/i.test(normalized)) return false;
        if (/^Ask\s+Alexa$/i.test(normalized)) return false;
        if ((normalized.match(/\?/g) || []).length > 1) return false;

        const lower = normalized.toLowerCase();
        return normalized.endsWith('?') ||
               lower === 'ask something else' ||
               lower === 'compare with similar' ||
               lower === 'why you might like this';
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

    function extractRufusPrompts() {
        const candidates = Array.from(document.querySelectorAll(
            '#dpx-nice-widget-container [data-dpx-rufus-connect], #dpx-nice-widget-container .small-widget-pill, #dpx-nice-widget-container .ask-pill, [data-rufus-action], [id*="rufus" i], [class*="rufus" i], [aria-label*="rufus" i], [id*="alexa-shopping" i], [class*="alexa-shopping" i], [aria-label*="Alexa for Shopping" i], button, a, [role="button"], .a-button-text'
        ));
        const prompts = [];
        const seen = new Set();

        function add(text) {
            const normalized = cleanText(text);
            const key = normalized.toLowerCase();
            if (isPromptText(normalized) && !seen.has(key)) {
                seen.add(key);
                prompts.push(normalized);
            }
        }

        for (const element of candidates) {
            add(readQueryFromRufusAttributes(element));
            add(readQueryFromRufusAttributes(element.parentElement));
            add(element.innerText || element.textContent);
            add(element.getAttribute?.('aria-label'));
            add(element.getAttribute?.('title'));
        }

        const lines = (document.body?.innerText || '')
            .split('\n')
            .map(cleanText)
            .filter(Boolean);
        const askRufusIndex = lines.findIndex(line => assistantTextPattern.test(line));
        if (askRufusIndex >= 0) {
            for (const line of lines.slice(askRufusIndex + 1, askRufusIndex + 24)) {
                add(line);
            }
        }

        return prompts;
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
            const knownPriceInsight = /^(high|low|typical)\s+price$/i.test(normalized) ||
                                      /^price\s+(?:is\s+)?(?:high|low|typical)$/i.test(normalized);

            if (!knownPriceInsight || seen.has(normalized.toLowerCase())) {
                return;
            }

            seen.add(normalized.toLowerCase());
            labels.push(normalized);
        }

        for (const container of containers) {
            const labelNodes = Array.from(container.querySelectorAll([
                '.price-insights-ingress-desktop-text',
                '[class*="price-insights" i]',
                '[class*="price-insight" i]'
            ].join(',')));

            for (const node of labelNodes) {
                addLabel(node.innerText || node.textContent);
            }

            const directText = cleanText(container.innerText || container.textContent);
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

    function extractRufusData() {
        const prompts = extractRufusPrompts();
        const priceInsight = extractPriceInsight();
        const title = cleanText(document.querySelector('#productTitle')?.innerText) ||
                      cleanText(document.title.replace(/\s*-\s*Amazon\..*$/i, ''));

        return {
            asin: extractAsin(),
            productTitle: title,
            priceInsightLabel: priceInsight.priceInsightLabel,
            highPriceDetected: priceInsight.highPriceDetected,
            rufusTitle: prompts.length ? 'Alexa for Shopping' : '',
            rufusFound: prompts.length > 0 || assistantTextPattern.test(document.body?.innerText || ''),
            rufusPrompts: prompts,
            rufusQuestions: prompts.filter(prompt => prompt.endsWith('?')),
            rufusActions: prompts.filter(prompt => !prompt.endsWith('?')),
            askSomethingElsePresent: prompts.some(prompt => /^Ask something else$/i.test(prompt))
        };
    }

    function addScrapingIndicator() {
        if (document.getElementById('amazon-rufus-scraper-indicator')) return;

        const indicator = document.createElement('div');
        indicator.id = 'amazon-rufus-scraper-indicator';
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: linear-gradient(135deg, #2563eb, #10b981);
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 999999;
            opacity: 0.9;
            transition: opacity 0.3s;
        `;
        indicator.textContent = 'alexai Ready';

        document.body.appendChild(indicator);

        indicator.addEventListener('mouseenter', () => {
            indicator.style.opacity = '1';
        });
        indicator.addEventListener('mouseleave', () => {
            indicator.style.opacity = '0.9';
        });
    }

    function observePageChanges() {
        const observer = new MutationObserver(() => {
            window.amazonRufusLastData = extractRufusData();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function enhancePage() {
        addScrapingIndicator();
        observePageChanges();
        window.amazonRufusLastData = extractRufusData();
    }

    window.amazonRufusExtractData = extractRufusData;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', enhancePage);
    } else {
        enhancePage();
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'extractRufusData' || message.action === 'extractData') {
            sendResponse({ success: true, data: extractRufusData() });
            return true;
        }
    });
})();
