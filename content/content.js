// Content Script - Amazon商品页 Rufus 信息增强

(function() {
    'use strict';

    const pathname = window.location.pathname;
    const isProductPage = /\/dp\/[A-Z0-9]{10}(?:[/?]|$)/i.test(pathname) ||
                          /\/gp\/product\/[A-Z0-9]{10}(?:[/?]|$)/i.test(pathname);

    if (!isProductPage) {
        return;
    }

    console.log('Amazon Rufus Scraper - Content script loaded');

    function cleanText(value) {
        return String(value || '')
            .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

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
            '#dpx-nice-widget-container [data-dpx-rufus-connect], #dpx-nice-widget-container .small-widget-pill, #dpx-nice-widget-container .ask-pill, [data-rufus-action], [id*="rufus" i], [class*="rufus" i], [aria-label*="rufus" i], button, a, [role="button"], .a-button-text'
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
        const askRufusIndex = lines.findIndex(line => /Ask\s+Rufus/i.test(line));
        if (askRufusIndex >= 0) {
            for (const line of lines.slice(askRufusIndex + 1, askRufusIndex + 24)) {
                add(line);
            }
        }

        return prompts;
    }

    function extractRufusData() {
        const prompts = extractRufusPrompts();
        const title = cleanText(document.querySelector('#productTitle')?.innerText) ||
                      cleanText(document.title.replace(/\s*-\s*Amazon\..*$/i, ''));

        return {
            asin: extractAsin(),
            productTitle: title,
            rufusTitle: prompts.length ? 'Ask Rufus' : '',
            rufusFound: prompts.length > 0 || /Ask\s+Rufus/i.test(document.body?.innerText || ''),
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
        indicator.textContent = 'Amazon Rufus Scraper Ready';

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
