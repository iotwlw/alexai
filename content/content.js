// Content Script - Amazon商品页 Alexa for Shopping 信息增强

(function() {
    'use strict';

    const pathname = window.location.pathname;
    const isProductPage = /\/dp\/[A-Z0-9]{10}(?:[/?]|$)/i.test(pathname) ||
                          /\/gp\/product\/[A-Z0-9]{10}(?:[/?]|$)/i.test(pathname);
    const isSearchPage = /^\/s(?:\/|$)/i.test(pathname);

    if (!isProductPage && !isSearchPage) {
        return;
    }

    console.log('alexai - Content script loaded');

    const imageDownloadButtons = new WeakMap();
    const thumbnailDownloadButtons = new WeakMap();
    const videoDownloadButtons = new WeakMap();
    const videoDownloadButtonGroups = new Map();
    const activeVideoDownloads = new Map();
    let imageDownloadObserver = null;
    let imageDownloadScanTimer = null;
    let imageDownloadSettingsSaveQueue = Promise.resolve();
    const DEFAULT_IMAGE_DOWNLOAD_SETTINGS = {
        detectionEnabled: true,
        displayMode: 'hover',
        qualityMode: 'high'
    };
    let imageDownloadSettings = { ...DEFAULT_IMAGE_DOWNLOAD_SETTINGS };
    let syncPageDownloadSettings = null;

    function cleanText(value) {
        return String(value || '')
            .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    const assistantTextPattern = /Ask\s+Rufus|Rufus|Alexa\s+for\s+Shopping|Ask\s+Alexa/i;

    function normalizeImageDownloadSettings(settings = {}) {
        const requestedDisplayMode = settings.displayMode === 'hidden'
            ? 'hover'
            : settings.displayMode;
        const displayMode = ['visible', 'hover'].includes(requestedDisplayMode)
            ? requestedDisplayMode
            : DEFAULT_IMAGE_DOWNLOAD_SETTINGS.displayMode;
        const qualityMode = ['high', 'both'].includes(settings.qualityMode)
            ? settings.qualityMode
            : DEFAULT_IMAGE_DOWNLOAD_SETTINGS.qualityMode;

        return {
            detectionEnabled: settings.detectionEnabled !== false,
            displayMode,
            qualityMode
        };
    }

    function applyImageDownloadSettings() {
        const root = document.documentElement;
        root.classList.toggle('alexai-image-downloads-disabled', !imageDownloadSettings.detectionEnabled);
        root.classList.toggle('alexai-image-downloads-visible', imageDownloadSettings.displayMode === 'visible');
        root.classList.toggle('alexai-image-downloads-hover', imageDownloadSettings.displayMode === 'hover');
        root.classList.toggle('alexai-image-downloads-high-only', imageDownloadSettings.qualityMode === 'high');
        root.classList.toggle('alexai-image-downloads-both', imageDownloadSettings.qualityMode === 'both');
        syncPageDownloadSettings?.();
    }

    async function loadImageDownloadSettings() {
        try {
            const result = await chrome.storage.local.get('imageDownloadSettings');
            imageDownloadSettings = normalizeImageDownloadSettings(result.imageDownloadSettings);
        } catch (error) {
            console.warn('alexai image download settings load failed:', error);
            imageDownloadSettings = { ...DEFAULT_IMAGE_DOWNLOAD_SETTINGS };
        }

        applyImageDownloadSettings();
        return imageDownloadSettings;
    }

    function isImageDownloadDetectionEnabled() {
        return imageDownloadSettings.detectionEnabled;
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

    function injectImageDownloadStyles() {
        if (document.getElementById('alexai-image-download-styles')) return;

        const style = document.createElement('style');
        style.id = 'alexai-image-download-styles';
        style.textContent = `
            .alexai-image-download-host {
                position: relative !important;
                overflow: visible !important;
            }

            .alexai-image-download-button {
                position: absolute;
                top: 6px;
                z-index: 999998;
                width: 30px;
                height: 30px;
                border: 1px solid rgba(255, 255, 255, 0.75);
                border-radius: 6px;
                background: rgba(17, 24, 39, 0.86);
                color: #fff;
                font-size: 11px;
                font-weight: 700;
                line-height: 1;
                cursor: pointer;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                opacity: 0.95;
                pointer-events: auto;
                transform: translateY(0);
                transition: background-color 0.14s ease, opacity 0.14s ease, transform 0.14s ease;
            }

            .alexai-image-downloads-disabled .alexai-image-download-button,
            .alexai-image-downloads-disabled #alexai-video-download-panel {
                display: none !important;
            }

            .alexai-image-downloads-hover .alexai-image-download-host > .alexai-image-download-button:not(.alexai-download-video-large) {
                opacity: 0;
                pointer-events: none;
                transform: translateY(2px);
            }

            .alexai-image-downloads-hover .alexai-image-download-host:hover > .alexai-image-download-button:not(.alexai-download-video-large),
            .alexai-image-downloads-hover .alexai-image-download-host:focus-within > .alexai-image-download-button:not(.alexai-download-video-large) {
                opacity: 0.96;
                pointer-events: auto;
                transform: translateY(0);
            }

            .alexai-image-downloads-high-only .alexai-download-thumbnail {
                display: none !important;
            }

            .alexai-image-download-button.alexai-download-large {
                top: 0;
                right: auto;
                left: calc(100% + 4px);
            }

            .alexai-image-download-button.alexai-download-thumbnail {
                top: 34px;
                right: auto;
                left: calc(100% + 4px);
            }

            .alexai-image-download-host.alexai-image-download-host-edge-inside .alexai-image-download-button.alexai-download-large {
                right: 6px;
                left: auto;
            }

            .alexai-image-download-host.alexai-image-download-host-edge-inside .alexai-image-download-button.alexai-download-thumbnail {
                right: 6px;
                left: auto;
            }

            .alexai-image-download-host.alexai-image-download-host-out-of-view .alexai-download-large,
            .alexai-image-download-host.alexai-image-download-host-out-of-view .alexai-download-thumbnail {
                display: none !important;
            }

            .alexai-image-download-button.alexai-download-video {
                top: auto;
                right: 6px;
                bottom: 6px;
                left: auto;
                width: 40px;
                height: 24px;
                border-color: rgba(255, 255, 255, 0.9);
                background: rgba(17, 24, 39, 0.92);
            }

            .alexai-image-download-button.alexai-download-video.alexai-download-video-large {
                width: 88px;
                height: 38px;
                border-radius: 6px;
                font-size: 13px;
                letter-spacing: 0;
                background: rgba(17, 24, 39, 0.94);
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.34);
            }

            .alexai-image-download-host.alexai-video-host-has-controls .alexai-download-video {
                right: 46px;
            }

            .alexai-image-download-host.alexai-video-host-has-controls .alexai-download-video-large {
                right: 52px;
            }

            .alexai-image-download-button:focus-visible {
                opacity: 1;
                pointer-events: auto;
                background: #111827;
                outline: 2px solid #fbbf24;
                outline-offset: 1px;
            }

            #alexai-image-download-toast {
                position: fixed;
                right: 18px;
                bottom: 72px;
                z-index: 999999;
                max-width: 280px;
                padding: 10px 12px;
                border-radius: 8px;
                background: rgba(17, 24, 39, 0.94);
                color: #fff;
                font-size: 12px;
                font-weight: 600;
                line-height: 1.35;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
                opacity: 0;
                transform: translateY(8px);
                transition: opacity 0.18s ease, transform 0.18s ease;
                pointer-events: none;
            }

            #alexai-image-download-toast.is-visible {
                opacity: 1;
                transform: translateY(0);
            }

            #alexai-video-download-panel {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                align-items: center;
                margin: 8px 0 12px;
            }

            #alexai-video-download-panel .alexai-video-panel-button {
                border: 1px solid #d5d9d9;
                border-radius: 6px;
                background: #fff;
                color: #0f1111;
                font-size: 12px;
                font-weight: 700;
                line-height: 1;
                padding: 6px 8px;
                cursor: pointer;
            }

            #alexai-video-download-panel .alexai-video-panel-button:focus-visible {
                background: #f7fafa;
                border-color: #007185;
                outline: 2px solid #fbbf24;
                outline-offset: 1px;
            }

        `;
        document.documentElement.appendChild(style);
    }

    function normalizeMediaUrl(value) {
        const text = decodeHtmlEntities(value || '')
            .replace(/\\\//g, '/')
            .replace(/\\u0026/g, '&')
            .replace(/\\u002F/gi, '/')
            .replace(/&amp;/g, '&')
            .trim();

        if (!text || /^data:|^blob:/i.test(text)) {
            return '';
        }

        try {
            return new URL(text, window.location.href).href;
        } catch (_) {
            return '';
        }
    }

    function normalizeImageUrl(value) {
        return normalizeMediaUrl(value);
    }

    function isLikelyAmazonImageUrl(value) {
        try {
            const url = new URL(value);
            const host = url.hostname.toLowerCase();
            return /(?:^|\.)media-amazon\.com$/.test(host) ||
                   /(?:^|\.)ssl-images-amazon\.com$/.test(host) ||
                   (host.includes('amazon.') && url.pathname.includes('/images/'));
        } catch (_) {
            return false;
        }
    }

    function isLikelyAmazonVideoUrl(value) {
        try {
            const url = new URL(value);
            const host = url.hostname.toLowerCase();
            const pathname = url.pathname.toLowerCase();
            return /^https?:$/.test(url.protocol) &&
                /(?:^|\.)media-amazon\.com$/.test(host) &&
                /\.(?:m3u8|mp4|webm)(?:$|[?#])/i.test(pathname + url.search + url.hash) &&
                !/videopreview|gandalf_preview|preview\.m3u8/i.test(pathname);
        } catch (_) {
            return false;
        }
    }

    function addImageCandidate(candidates, seen, value, width = 0, height = 0, source = '') {
        const url = normalizeImageUrl(value);
        if (!url || !isLikelyAmazonImageUrl(url) || seen.has(url)) {
            return;
        }

        seen.add(url);
        candidates.push({
            url,
            width: Number(width) || 0,
            height: Number(height) || 0,
            source
        });
    }

    function parseDynamicImageCandidates(img, candidates, seen) {
        const payload = parseJsonAttribute(img.getAttribute('data-a-dynamic-image'));
        if (!payload || typeof payload !== 'object') return;

        Object.entries(payload)
            .sort((a, b) => {
                const areaA = Array.isArray(a[1]) ? Number(a[1][0] || 0) * Number(a[1][1] || 0) : 0;
                const areaB = Array.isArray(b[1]) ? Number(b[1][0] || 0) * Number(b[1][1] || 0) : 0;
                return areaB - areaA;
            })
            .forEach(([url, size]) => {
                const width = Array.isArray(size) ? size[0] : 0;
                const height = Array.isArray(size) ? size[1] : 0;
                addImageCandidate(candidates, seen, url, width, height, 'dynamic');
            });
    }

    function parseSrcsetCandidates(srcset, candidates, seen) {
        if (!srcset) return;

        srcset.split(/,\s*(?=(?:https?:)?\/\/)/i).forEach(entry => {
            const parts = entry.trim().split(/\s+/);
            const descriptor = parts[1] || '';
            const width = descriptor.endsWith('w') ? parseInt(descriptor, 10) : 0;
            addImageCandidate(candidates, seen, parts[0], width, 0, 'srcset');
        });
    }

    function replaceAmazonImagePath(url, pathname) {
        const next = new URL(url);
        next.pathname = pathname;
        next.search = '';
        next.hash = '';
        return next.href;
    }

    function getHighResolutionVariants(value) {
        const url = normalizeImageUrl(value);
        if (!url || !isLikelyAmazonImageUrl(url)) return [];

        try {
            const parsed = new URL(url);
            const path = parsed.pathname;
            const cleanPath = path.replace(/\._[^/]*_\.(jpe?g|jpg|png|webp)$/i, '.$1');
            const extMatch = cleanPath.match(/\.(jpe?g|jpg|png|webp)$/i);
            const variants = [];

            if (extMatch) {
                const ext = extMatch[1];
                const stem = cleanPath.slice(0, -ext.length - 1);
                [
                    `${stem}.${ext}`,
                    `${stem}._SL2000_.${ext}`,
                    `${stem}._SL1500_.${ext}`,
                    `${stem}._AC_SL1500_.${ext}`,
                    `${stem}._SX1500_.${ext}`
                ].forEach(candidatePath => variants.push(replaceAmazonImagePath(url, candidatePath)));
            }

            variants.push(url);
            return variants;
        } catch (_) {
            return [url];
        }
    }

    function getImageCandidates(img) {
        const rawCandidates = [];
        const rawSeen = new Set();

        parseDynamicImageCandidates(img, rawCandidates, rawSeen);
        parseSrcsetCandidates(img.getAttribute('srcset'), rawCandidates, rawSeen);

        [
            img.getAttribute('data-old-hires'),
            img.getAttribute('data-a-hires'),
            img.getAttribute('data-src'),
            img.currentSrc,
            img.src
        ].forEach(value => addImageCandidate(rawCandidates, rawSeen, value, 0, 0, 'attribute'));

        const expanded = [];
        const expandedSeen = new Set();

        rawCandidates.forEach(candidate => {
            getHighResolutionVariants(candidate.url).forEach(url => {
                addImageCandidate(expanded, expandedSeen, url, candidate.width, candidate.height, candidate.source);
            });
        });

        return expanded;
    }

    function candidatePriority(candidate) {
        let priority = 0;
        const area = Number(candidate.width || 0) * Number(candidate.height || 0);
        priority += Math.min(area, 4000000);

        try {
            const path = new URL(candidate.url).pathname;
            if (/\/images\/[A-Z]\/[^.]+\.(jpe?g|jpg|png|webp)$/i.test(path)) {
                priority += 6000000;
            }

            if (/\._(?:AC_)?SL(?:1500|2000)_\./i.test(path) || /\._SX1500_\./i.test(path)) {
                priority += 5000000;
            }
        } catch (_) {
            // Ignore URL scoring failures.
        }

        return priority;
    }

    function probeImageCandidate(candidate) {
        return new Promise(resolve => {
            const image = new Image();
            const timeout = setTimeout(() => {
                image.onload = null;
                image.onerror = null;
                resolve({ ...candidate, ok: false, naturalWidth: 0, naturalHeight: 0 });
            }, 2600);

            image.onload = () => {
                clearTimeout(timeout);
                resolve({
                    ...candidate,
                    ok: true,
                    naturalWidth: image.naturalWidth || 0,
                    naturalHeight: image.naturalHeight || 0
                });
            };

            image.onerror = () => {
                clearTimeout(timeout);
                resolve({ ...candidate, ok: false, naturalWidth: 0, naturalHeight: 0 });
            };

            image.decoding = 'async';
            image.src = candidate.url;
        });
    }

    async function resolveBestImageCandidate(candidates) {
        const ranked = [...candidates]
            .sort((a, b) => candidatePriority(b) - candidatePriority(a))
            .slice(0, 16);

        if (ranked.length === 0) {
            throw new Error('No Amazon image URL found');
        }

        const probed = await Promise.all(ranked.map(probeImageCandidate));
        const loaded = probed
            .filter(candidate => candidate.ok && candidate.naturalWidth > 0 && candidate.naturalHeight > 0)
            .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));

        return loaded[0] || ranked[0];
    }

    function getImageExtension(url) {
        try {
            const match = new URL(url).pathname.match(/\.(jpe?g|jpg|png|webp)$/i);
            return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
        } catch (_) {
            return 'jpg';
        }
    }

    function getImageKey(url) {
        try {
            const file = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
            const key = file
                .replace(/\._[^.]+_\.(jpe?g|jpg|png|webp)$/i, '')
                .replace(/\.__[^.]+__+\.(jpe?g|jpg|png|webp)$/i, '')
                .replace(/\.(jpe?g|jpg|png|webp)$/i, '')
                .split('.')[0];

            return sanitizeFilenamePart(key, '').slice(0, 40);
        } catch (_) {
            return '';
        }
    }

    function getVideoAssetKey(url) {
        try {
            const pathname = decodeURIComponent(new URL(url).pathname);
            const mediaContainer = pathname.match(/\/([0-9a-f]{8}-[0-9a-f-]{24,}\.(?:mp4|webm))(?:\/|$)/i);
            if (mediaContainer) {
                return sanitizeFilenamePart(mediaContainer[1].replace(/\.(?:mp4|webm)$/i, ''), '').slice(0, 80);
            }

            const mediaFile = pathname
                .split('/')
                .filter(Boolean)
                .reverse()
                .find(part => /\.(?:m3u8|mp4|webm)$/i.test(part));

            if (mediaFile) {
                return sanitizeFilenamePart(mediaFile.replace(/\.(?:m3u8|mp4|webm)$/i, ''), '').slice(0, 80);
            }
        } catch (_) {
            return '';
        }

        return '';
    }

    function sanitizeFilenamePart(value, fallback = 'amazon-image') {
        const text = cleanText(value)
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
            .replace(/\.+$/g, '')
            .trim();

        return (text || fallback).slice(0, 120).trim() || fallback;
    }

    function getSearchImageContext(img) {
        const item = img.closest('.s-result-item[data-asin], [data-component-type="s-search-result"]');
        const asin = item?.getAttribute('data-asin') || '';
        const title = cleanText(
            item?.querySelector('h2 span, h2 a span, .a-size-medium.a-color-base.a-text-normal')?.textContent ||
            img.getAttribute('alt') ||
            ''
        );

        return { asin, title, source: 'search' };
    }

    function getProductImageContext(img) {
        const title = cleanText(document.querySelector('#productTitle')?.innerText) ||
                      cleanText(img.getAttribute('alt')) ||
                      cleanText(document.title.replace(/\s*-\s*Amazon\..*$/i, ''));

        return {
            asin: extractAsin(),
            title,
            source: 'detail'
        };
    }

    function buildImageFilename(img, candidate, context, variant = '') {
        const asin = sanitizeFilenamePart(context.asin || 'amazon', 'amazon');
        const title = sanitizeFilenamePart(context.title || img.getAttribute('alt') || 'image', 'image').slice(0, 80);
        const imageKey = getImageKey(candidate.url);
        const extension = getImageExtension(candidate.url);
        const variantSuffix = variant ? `_${variant}` : '';
        const stem = imageKey ? `${asin}_${title}_${imageKey}${variantSuffix}` : `${asin}_${title}${variantSuffix}`;
        return `amazon-images/${stem}.${extension}`;
    }

    function setButtonState(button, state) {
        if (!button) return;
        button.textContent = state === 'loading' ? '...' : (button.dataset.label || 'DL');
        button.disabled = state === 'loading';
    }

    function setImageButtonsState(img, state) {
        setButtonState(imageDownloadButtons.get(img), state);
        setButtonState(thumbnailDownloadButtons.get(img), state);
    }

    function showImageDownloadToast(message, type = 'info') {
        let toast = document.getElementById('alexai-image-download-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'alexai-image-download-toast';
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.style.background = type === 'error'
            ? 'rgba(185, 28, 28, 0.94)'
            : 'rgba(17, 24, 39, 0.94)';
        toast.classList.add('is-visible');

        clearTimeout(showImageDownloadToast.timer);
        showImageDownloadToast.timer = setTimeout(() => {
            toast.classList.remove('is-visible');
        }, 2400);
    }

    function sendRuntimeMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, response => {
                const error = chrome.runtime.lastError;
                if (error) {
                    reject(new Error(error.message));
                    return;
                }

                resolve(response);
            });
        });
    }

    async function downloadImageForElement(img, context) {
        if (img.getAttribute('data-alexai-download-busy') === 'true') return;

        img.setAttribute('data-alexai-download-busy', 'true');
        setImageButtonsState(img, 'loading');

        try {
            const bestCandidate = await resolveBestImageCandidate(getImageCandidates(img));
            const filename = buildImageFilename(img, bestCandidate, context);
            const response = await sendRuntimeMessage({
                action: 'downloadAmazonImage',
                imageUrl: bestCandidate.url,
                filename
            });

            if (!response?.success) {
                throw new Error(response?.error || 'Download failed');
            }

            showImageDownloadToast('Image download started');
        } catch (error) {
            console.error('alexai image download failed:', error);
            showImageDownloadToast(`Download failed: ${error.message}`, 'error');
        } finally {
            img.removeAttribute('data-alexai-download-busy');
            setImageButtonsState(img, 'idle');
        }
    }

    function getCurrentThumbnailCandidate(img) {
        const values = [
            img.currentSrc,
            img.src,
            img.getAttribute('data-src')
        ];

        for (const value of values) {
            const url = normalizeImageUrl(value);
            if (url && isLikelyAmazonImageUrl(url)) {
                return { url, width: img.width || 0, height: img.height || 0, source: 'thumbnail' };
            }
        }

        throw new Error('No current thumbnail URL found');
    }

    async function downloadThumbnailForElement(img, context) {
        if (img.getAttribute('data-alexai-download-busy') === 'true') return;

        img.setAttribute('data-alexai-download-busy', 'true');
        setImageButtonsState(img, 'loading');

        try {
            const thumbnailCandidate = getCurrentThumbnailCandidate(img);
            const filename = buildImageFilename(img, thumbnailCandidate, context, 'thumb');
            const response = await sendRuntimeMessage({
                action: 'downloadAmazonImage',
                imageUrl: thumbnailCandidate.url,
                filename
            });

            if (!response?.success) {
                throw new Error(response?.error || 'Download failed');
            }

            showImageDownloadToast('Thumbnail download started');
        } catch (error) {
            console.error('alexai thumbnail download failed:', error);
            showImageDownloadToast(`Download failed: ${error.message}`, 'error');
        } finally {
            img.removeAttribute('data-alexai-download-busy');
            setImageButtonsState(img, 'idle');
        }
    }

    function decodeJsonString(value) {
        const raw = String(value || '');

        try {
            return cleanText(JSON.parse(`"${raw.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`));
        } catch (_) {
            return cleanText(raw
                .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
                .replace(/\\\//g, '/')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\'));
        }
    }

    function readJsonField(context, fieldName) {
        const decoded = decodeHtmlEntities(context || '')
            .replace(/\\u0026/g, '&')
            .replace(/\\u002F/gi, '/')
            .replace(/\\\//g, '/');
        const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = decoded.match(new RegExp(`"${escapedField}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i'));
        return match ? decodeJsonString(match[1]) : '';
    }

    function extractVideoMetadata(context, url, index) {
        const title = readJsonField(context, 'title') || readJsonField(context, 'altText') || 'amazon-video';
        const vendorName = readJsonField(context, 'vendorName') || readJsonField(context, 'publicName');
        const duration = readJsonField(context, 'formattedDuration');
        const videoImagePhysicalId = readJsonField(context, 'videoImagePhysicalId');
        const imageUrl = [
            'videoImageUrl',
            'hiResVideoImageUrl',
            'secondaryImgUrl',
            'secondaryHighResImgUrl',
            'videoImageUrlUnchanged',
            'videoPreviewImageSrc'
        ].map(field => normalizeImageUrl(readJsonField(context, field)))
            .find(Boolean) || '';

        return {
            url,
            title,
            vendorName,
            duration,
            imageUrl,
            imageKey: sanitizeFilenamePart(videoImagePhysicalId || getImageKey(imageUrl), ''),
            assetKey: getVideoAssetKey(url) || getVideoAssetKey(imageUrl),
            index
        };
    }

    function normalizeVideoMetadataItem(item, index) {
        if (!item || typeof item !== 'object') return null;

        const url = normalizeMediaUrl(item.videoURL || item.videoUrl || item.videoSrc || item.url || '');
        if (!url || !isLikelyAmazonVideoUrl(url)) {
            return null;
        }

        const imageUrl = [
            item.videoImageUrl,
            item.hiResVideoImageUrl,
            item.secondaryImgUrl,
            item.secondaryHighResImgUrl,
            item.videoImageUrlUnchanged,
            item.videoPreviewImageSrc,
            item.poster
        ].map(normalizeImageUrl).find(Boolean) || '';
        const imageKey = sanitizeFilenamePart(item.videoImagePhysicalId || getImageKey(imageUrl), '');

        return {
            url,
            title: cleanText(item.title || item.altText || 'amazon-video'),
            vendorName: cleanText(item.vendorName || item.publicName || ''),
            duration: cleanText(item.formattedDuration || ''),
            imageUrl,
            imageKey,
            assetKey: getVideoAssetKey(url) || getVideoAssetKey(imageUrl),
            index
        };
    }

    function addVideoMetadata(videos, seen, video) {
        if (!video?.url || seen.has(video.url)) {
            return false;
        }

        seen.add(video.url);
        videos.push(video);
        return true;
    }

    function extractAmazonVideosFromMetadataElements(videos, seen) {
        Array.from(document.querySelectorAll('.video-items-metadata[data-video-items], [data-video-items]'))
            .forEach(element => {
                const items = parseJsonAttribute(element.getAttribute('data-video-items'));
                if (!Array.isArray(items)) return;

                items.forEach((item, index) => {
                    addVideoMetadata(videos, seen, normalizeVideoMetadataItem(item, index));
                });
            });
    }

    function getVideoElementSources(videoElement) {
        if (!videoElement) return [];

        const values = [
            videoElement.currentSrc,
            videoElement.src,
            videoElement.getAttribute('src'),
            videoElement.getAttribute('data-src')
        ];

        Array.from(videoElement.querySelectorAll?.('source[src]') || [])
            .forEach(source => values.push(source.currentSrc, source.src, source.getAttribute('src')));

        return Array.from(new Set(values
            .map(normalizeMediaUrl)
            .filter(url => url && isLikelyAmazonVideoUrl(url))));
    }

    function getVideoTextHost(element) {
        return element?.closest?.([
            'li.a-carousel-card[class*="MultiBrandVideoDesktop_carouselElement" i]',
            '[class*="MultiBrandVideoDesktop_mbvItem" i]',
            '[data-type="videoProductAdItem"]',
            'li.a-carousel-card.vse-video-card',
            '[data-csa-c-media-type="VIDEO"]',
            '[class*="videoBlock" i]',
            '#video-outer-container',
            '#ive-hero-video-player'
        ].join(',')) || element?.parentElement || null;
    }

    function getVideoElementTitle(videoElement) {
        const host = getVideoTextHost(videoElement);
        const title = cleanText(
            host?.querySelector?.('[data-type="productTitle"], a[data-type="productTitle"]')?.textContent ||
            host?.querySelector?.('img[data-type="productImage"][alt], img[alt]')?.getAttribute('alt') ||
            videoElement.getAttribute('title') ||
            ''
        );

        if (title) return title;

        const ariaLabel = cleanText(videoElement.getAttribute('aria-label') || '');
        return /^sponsored video\b/i.test(ariaLabel) ? 'amazon-video' : (ariaLabel || 'amazon-video');
    }

    function extractAmazonVideosFromVideoElements(videos, seen, htmlSource = '') {
        Array.from(document.querySelectorAll('video')).forEach((videoElement, elementIndex) => {
            const imageUrl = normalizeImageUrl(
                videoElement.poster ||
                videoElement.getAttribute('poster') ||
                videoElement.getAttribute('data-poster') ||
                ''
            );

            getVideoElementSources(videoElement).forEach(url => {
                const htmlIndex = htmlSource ? htmlSource.indexOf(url) : -1;
                addVideoMetadata(videos, seen, {
                    url,
                    title: getVideoElementTitle(videoElement),
                    vendorName: '',
                    duration: '',
                    imageUrl,
                    imageKey: '',
                    assetKey: getVideoAssetKey(url) || getVideoAssetKey(imageUrl),
                    index: htmlIndex >= 0 ? htmlIndex : Number.MAX_SAFE_INTEGER - 100000 + elementIndex
                });
            });
        });
    }

    function addAmazonVideoCandidate(videos, seen, source, matchIndex, matchLength, htmlSource = document.documentElement.innerHTML) {
        const url = normalizeMediaUrl(source);
        if (!url || !isLikelyAmazonVideoUrl(url) || seen.has(url)) {
            return;
        }

        const contextStart = Math.max(0, matchIndex - 1600);
        const contextEnd = Math.min(htmlSource.length, matchIndex + matchLength + 2200);
        const rawContext = htmlSource.slice(contextStart, contextEnd);
        addVideoMetadata(videos, seen, extractVideoMetadata(rawContext, url, matchIndex));
    }

    function extractAmazonVideosFromDocument() {
        const html = document.documentElement?.innerHTML || '';
        const videos = [];
        const seen = new Set();
        extractAmazonVideosFromMetadataElements(videos, seen);
        extractAmazonVideosFromVideoElements(videos, seen, html);

        if (!html || (!/videoURL|videoUrl|videoSrc|\.m3u8|\.mp4|\.webm|vse-vms/i.test(html) && videos.length === 0)) {
            return videos.sort((a, b) => a.index - b.index);
        }

        const decodedHtml = decodeHtmlEntities(html)
            .replace(/\\u0026/g, '&')
            .replace(/\\u002F/gi, '/')
            .replace(/\\\//g, '/');

        const patterns = [
            /"(?:videoURL|videoUrl|videoSrc)"\s*:\s*"((?:\\.|[^"\\])+?\.(?:m3u8|mp4|webm)(?:\\.|[^"\\])*)"/ig,
            /https?:\/\/[^"'<>\s]+?\.(?:m3u8|mp4|webm)(?:[^"'<>\s]*)?/ig
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(decodedHtml)) !== null) {
                addAmazonVideoCandidate(videos, seen, match[1] || match[0], match.index, match[0].length, decodedHtml);
            }
        }

        return videos.sort((a, b) => a.index - b.index);
    }

    function parseHlsAttributeList(value) {
        const attrs = {};
        String(value || '')
            .split(/,(?=[A-Z0-9-]+=)/i)
            .forEach(part => {
                const separatorIndex = part.indexOf('=');
                if (separatorIndex < 0) return;

                const key = part.slice(0, separatorIndex).trim().toUpperCase();
                const rawValue = part.slice(separatorIndex + 1).trim();
                attrs[key] = rawValue.replace(/^"|"$/g, '');
            });
        return attrs;
    }

    function resolvePlaylistUrl(baseUrl, value) {
        return new URL(value, baseUrl).href;
    }

    async function fetchTextResource(url) {
        const response = await fetch(url, {
            credentials: 'omit',
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response.text();
    }

    async function fetchBinaryResource(url) {
        const response = await fetch(url, {
            credentials: 'omit',
            cache: 'force-cache'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response.arrayBuffer();
    }

    function parseMasterPlaylist(text, playlistUrl) {
        const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const variants = [];

        for (let index = 0; index < lines.length; index++) {
            const line = lines[index];
            if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

            const attributes = parseHlsAttributeList(line.slice('#EXT-X-STREAM-INF:'.length));
            const nextLine = lines.slice(index + 1).find(candidate => candidate && !candidate.startsWith('#'));
            if (!nextLine) continue;

            variants.push({
                url: resolvePlaylistUrl(playlistUrl, nextLine),
                bandwidth: Number(attributes.BANDWIDTH || attributes['AVERAGE-BANDWIDTH'] || 0),
                resolution: attributes.RESOLUTION || '',
                attributes
            });
        }

        return variants;
    }

    async function resolveBestHlsPlaylist(url, depth = 0) {
        const text = await fetchTextResource(url);
        const variants = parseMasterPlaylist(text, url);

        if (variants.length === 0 || depth >= 2) {
            return { url, text };
        }

        const best = variants
            .sort((a, b) => {
                const areaA = a.resolution.split('x').reduce((total, part) => total * (parseInt(part, 10) || 1), 1);
                const areaB = b.resolution.split('x').reduce((total, part) => total * (parseInt(part, 10) || 1), 1);
                return (areaB - areaA) || (b.bandwidth - a.bandwidth);
            })[0];

        return resolveBestHlsPlaylist(best.url, depth + 1);
    }

    function parseMediaPlaylist(text, playlistUrl) {
        const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const unsupportedKey = lines.find(line => /^#EXT-X-KEY:/i.test(line) && !/METHOD=NONE/i.test(line));

        if (unsupportedKey) {
            throw new Error('Encrypted HLS is not supported');
        }

        let mapUrl = '';
        const segments = [];

        for (const line of lines) {
            if (/^#EXT-X-MAP:/i.test(line)) {
                const attrs = parseHlsAttributeList(line.slice(line.indexOf(':') + 1));
                if (attrs.URI) {
                    mapUrl = resolvePlaylistUrl(playlistUrl, attrs.URI);
                }
                continue;
            }

            if (!line || line.startsWith('#')) continue;
            segments.push(resolvePlaylistUrl(playlistUrl, line));
        }

        if (segments.length === 0) {
            throw new Error('No HLS segments found');
        }

        return { mapUrl, segments };
    }

    function buildVideoFilename(video, extension) {
        const asin = sanitizeFilenamePart(extractAsin() || 'amazon', 'amazon');
        const title = sanitizeFilenamePart(video.title || 'video', 'video').slice(0, 90);
        const vendor = sanitizeFilenamePart(video.vendorName || '', '').slice(0, 40);
        const suffix = vendor ? `_${vendor}` : '';
        return `amazon-videos_${asin}_${title}${suffix}.${extension}`;
    }

    function triggerBlobDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    function getVideoButtonGroup(url) {
        if (!videoDownloadButtonGroups.has(url)) {
            videoDownloadButtonGroups.set(url, new Set());
        }
        return videoDownloadButtonGroups.get(url);
    }

    function registerVideoDownloadButton(video, button) {
        const group = getVideoButtonGroup(video.url);
        group.add(button);
    }

    function setVideoButtonsState(videoUrl, label, disabled = false) {
        const group = videoDownloadButtonGroups.get(videoUrl);
        if (!group) return;

        for (const button of Array.from(group)) {
            if (!button.isConnected) {
                group.delete(button);
                continue;
            }

            button.textContent = label || button.dataset.label || 'VID';
            button.disabled = disabled;
        }
    }

    async function buildVideoBlob(video, onProgress) {
        if (!/\.m3u8(?:$|[?#])/i.test(video.url)) {
            const buffer = await fetchBinaryResource(video.url);
            return {
                blob: new Blob([buffer], { type: /\.webm(?:$|[?#])/i.test(video.url) ? 'video/webm' : 'video/mp4' }),
                extension: /\.webm(?:$|[?#])/i.test(video.url) ? 'webm' : 'mp4'
            };
        }

        const playlist = await resolveBestHlsPlaylist(video.url);
        const media = parseMediaPlaylist(playlist.text, playlist.url);
        const parts = [];
        const total = media.segments.length + (media.mapUrl ? 1 : 0);
        let completed = 0;

        if (media.mapUrl) {
            parts.push(await fetchBinaryResource(media.mapUrl));
            completed++;
            onProgress(completed, total);
        }

        for (const segmentUrl of media.segments) {
            parts.push(await fetchBinaryResource(segmentUrl));
            completed++;
            onProgress(completed, total);
        }

        const usesMp4Fragments = Boolean(media.mapUrl) || media.segments.some(url => /\.(?:m4s|mp4)(?:$|[?#])/i.test(url));
        return {
            blob: new Blob(parts, { type: usesMp4Fragments ? 'video/mp4' : 'video/mp2t' }),
            extension: usesMp4Fragments ? 'mp4' : 'ts'
        };
    }

    async function downloadAmazonVideo(video) {
        if (!video?.url || activeVideoDownloads.has(video.url)) return;

        activeVideoDownloads.set(video.url, true);
        setVideoButtonsState(video.url, '...', true);

        try {
            showImageDownloadToast('Video download preparing');
            const result = await buildVideoBlob(video, (completed, total) => {
                setVideoButtonsState(video.url, `${completed}/${total}`, true);
            });
            const filename = buildVideoFilename(video, result.extension);
            triggerBlobDownload(result.blob, filename);
            showImageDownloadToast('Video download started');
        } catch (error) {
            console.error('alexai video download failed:', error);
            showImageDownloadToast(`Video failed: ${error.message}`, 'error');
        } finally {
            activeVideoDownloads.delete(video.url);
            setVideoButtonsState(video.url, null, false);
        }
    }

    function getImagePhysicalKeyFromElement(img) {
        return getImageKey(
            img.currentSrc ||
            img.src ||
            img.getAttribute('data-src') ||
            img.getAttribute('data-old-hires') ||
            img.getAttribute('data-a-hires') ||
            ''
        );
    }

    function getHostImageKeys(host) {
        return Array.from(host?.querySelectorAll?.('img') || [])
            .map(getImagePhysicalKeyFromElement)
            .filter(Boolean);
    }

    function getVideoElementsInHost(host) {
        const videos = Array.from(host?.querySelectorAll?.('video') || []);
        if (host?.matches?.('video')) {
            videos.unshift(host);
        }
        return videos;
    }

    function getHostVideoUrls(host) {
        return getVideoElementsInHost(host)
            .flatMap(getVideoElementSources)
            .filter(Boolean);
    }

    function getHostVideoKeys(host) {
        const urls = [];
        getVideoElementsInHost(host).forEach(videoElement => {
            urls.push(...getVideoElementSources(videoElement));
            urls.push(videoElement.poster, videoElement.getAttribute('poster'), videoElement.getAttribute('data-poster'));
        });

        return Array.from(new Set(urls
            .map(getVideoAssetKey)
            .filter(Boolean)));
    }

    function getVideoHostFromElement(element) {
        if (!element) return null;

        const selector = [
            '#ive-hero-video-player',
            '#video-outer-container',
            'li.a-carousel-card.vse-video-card',
            '[data-type="videoContainer"]',
            '[class*="style_videoContainer" i]',
            '[class*="vseCarouselItem" i]',
            '[class*="vseVideoDataItem" i]',
            '[class*="vseVideoImageWrapper" i]',
            '[class*="videoPreviewWrapper" i]',
            '[class*="vftp-hoc-thumbnail-wrapper" i]',
            '[data-elementid*="thumbnail" i]',
            '[data-element-id*="thumbnail" i]',
            '[data-csa-c-media-type="VIDEO"]',
            '[class*="videoBlock" i]',
            '[class*="videoThumbnail" i]'
        ].join(',');

        if (element.tagName === 'IMG') {
            return element.closest(selector) || element.parentElement;
        }

        return element.closest(selector) || element;
    }

    function isReasonableVideoHost(host) {
        if (!host || host === document.body || host === document.documentElement) return false;

        const rect = host.getBoundingClientRect();
        const hasSize = rect.width >= 36 && rect.height >= 30;
        const text = cleanText(host.innerText || host.textContent);
        const className = typeof host.className === 'string' ? host.className : '';
        const hasVideoSignal = /video|vse|watch/i.test(`${host.id || ''} ${className} ${text}`);
        const hasVideoImage = getHostImageKeys(host).length > 0;
        const hasVideoElement = host.matches?.('video') || Boolean(host.querySelector?.('video'));
        const textIsScoped = text.length < 650;

        return hasSize && textIsScoped && (hasVideoSignal || hasVideoImage || hasVideoElement || host.matches?.('video, #ive-hero-video-player, #video-outer-container'));
    }

    function getVideoHostPriority(host) {
        if (!host?.matches) return 0;

        const rect = host.getBoundingClientRect?.() || { width: 0, height: 0 };
        const areaScore = Math.min((rect.width * rect.height) / 1000, 300);
        const inProductVideos = Boolean(host.closest?.('#va-related-videos-widget_feature_div, [data-feature-name="va-related-videos-widget"], .vse-video-widget-dp-container'));

        if (host.matches('#ive-hero-video-player')) return 1200 + areaScore;
        if (inProductVideos) return 900 + areaScore;
        if (host.matches('li.a-carousel-card.vse-video-card, [class*="vseCarouselItem" i], [class*="vseVideoDataItem" i]')) return 700 + areaScore;
        if (host.matches('[data-csa-c-media-type="VIDEO"]')) return 600 + areaScore;
        if (host.matches('#video-outer-container')) return 400 + areaScore;
        if (host.matches('.videoBlockIngress, [class*="videoThumbnail" i]')) return 100 + areaScore;

        return areaScore;
    }

    function getVideoCandidateHosts() {
        const selectors = [
            '#ive-hero-video-player',
            '#video-outer-container',
            'li.a-carousel-card.vse-video-card',
            '[data-type="videoContainer"]',
            '[class*="style_videoContainer" i]',
            '[class*="vseCarouselItem" i]',
            '[class*="vseVideoDataItem" i]',
            '[class*="vseVideoImageWrapper" i]',
            '[class*="videoPreviewWrapper" i]',
            '[class*="vftp-hoc-thumbnail-wrapper" i]',
            '.videoBlockIngress',
            '[data-csa-c-media-type="VIDEO"]',
            'video'
        ];
        const hosts = [];
        const seen = new Set();

        Array.from(document.querySelectorAll(selectors.join(','))).forEach(element => {
            const host = getVideoHostFromElement(element);
            if (!isReasonableVideoHost(host) || seen.has(host)) return;

            seen.add(host);
            hosts.push(host);
        });

        return hosts.sort((a, b) => getVideoHostPriority(b) - getVideoHostPriority(a));
    }

    function hostMatchesVideo(host, video) {
        const text = cleanText(host.innerText || host.textContent).toLowerCase();
        const title = cleanText(video.title).toLowerCase();
        const vendor = cleanText(video.vendorName).toLowerCase();

        if (video.url && getHostVideoUrls(host).includes(video.url)) return true;

        if (video.assetKey) {
            const hostVideoKeys = getHostVideoKeys(host);
            if (hostVideoKeys.includes(video.assetKey)) return true;
        }

        if (video.imageKey) {
            const hostImageKeys = getHostImageKeys(host);
            if (hostImageKeys.includes(video.imageKey)) return true;
        }

        const compactHost = text.length > 0 && text.length < 520 && getHostImageKeys(host).length <= 2;
        if (!compactHost) return false;

        if (title && title.length >= 8 && text.includes(title.slice(0, 42))) return true;
        if (title && vendor && vendor.length >= 4 && text.includes(title.slice(0, 24)) && text.includes(vendor)) return true;

        return false;
    }

    function isLargeVideoDownloadHost(host) {
        if (!host?.getBoundingClientRect) return false;

        if (host.matches('#ive-hero-video-player, #video-outer-container, [class*="hero" i][class*="video" i]')) {
            return true;
        }

        const rect = host.getBoundingClientRect();
        return rect.width >= 360 && rect.height >= 180;
    }

    function updateVideoButtonPresentation(host, button, fallbackLabel = 'VID') {
        if (!button) return;

        const isLarge = isLargeVideoDownloadHost(host);
        const label = isLarge ? '下载视频' : fallbackLabel;
        button.classList.toggle('alexai-download-video-large', isLarge);
        button.dataset.label = label;

        if (!button.disabled) {
            button.textContent = label;
        }
    }

    function attachVideoDownloadButton(host, video, label = 'VID') {
        const existingButton = host ? videoDownloadButtons.get(host) : null;
        if (!host) return false;
        if (existingButton?.isConnected && existingButton.dataset.videoUrl === video.url) {
            updateVideoButtonPresentation(host, existingButton, label);
            updateVideoHostControlClass(host);
            return true;
        }
        if (existingButton?.isConnected) {
            existingButton.remove();
        }
        if (existingButton && !existingButton.isConnected) {
            videoDownloadButtons.delete(host);
        }

        host.classList.add('alexai-image-download-host');
        updateVideoHostControlClass(host);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'alexai-image-download-button alexai-download-video';
        button.dataset.videoUrl = video.url;
        button.title = `Download Amazon video${video.title ? `: ${video.title}` : ''}`;
        button.setAttribute('aria-label', 'Download Amazon video');
        updateVideoButtonPresentation(host, button, label);
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            downloadAmazonVideo(video);
        });

        videoDownloadButtons.set(host, button);
        registerVideoDownloadButton(video, button);
        host.appendChild(button);
        return true;
    }

    function updateVideoHostControlClass(host) {
        const hasCornerControls = Boolean(host?.querySelector?.([
            '[class*="audioToggle" i]',
            '[class*="pauseIcon" i]',
            '[aria-label*="Mute Sponsored Video" i]',
            '[aria-label*="Unmute Sponsored Video" i]',
            '[aria-label*="Pause Sponsored Video" i]'
        ].join(',')));

        host?.classList?.toggle('alexai-video-host-has-controls', hasCornerControls);
    }

    function attachVideoButtonsToHosts(videos) {
        const hosts = getVideoCandidateHosts();
        const assignedHosts = new Set();
        const attachedUrls = new Set();

        for (const video of videos) {
            const matchedHost = hosts.find(host => !assignedHosts.has(host) && hostMatchesVideo(host, video));
            if (matchedHost && attachVideoDownloadButton(matchedHost, video)) {
                assignedHosts.add(matchedHost);
                attachedUrls.add(video.url);
            }
        }

        return attachedUrls;
    }

    function isAllowedVideoButtonHost(host) {
        return Boolean(host?.matches?.([
            '#ive-hero-video-player',
            '#video-outer-container',
            'li.a-carousel-card.vse-video-card',
            '[data-type="videoContainer"]',
            '[class*="style_videoContainer" i]',
            '[class*="vseCarouselItem" i]',
            '[class*="vseVideoDataItem" i]',
            '[class*="vseVideoImageWrapper" i]',
            '[class*="videoPreviewWrapper" i]',
            '[class*="vftp-hoc-thumbnail-wrapper" i]',
            '[data-elementid*="thumbnail" i]',
            '[data-element-id*="thumbnail" i]',
            '.videoBlockIngress',
            '[data-csa-c-media-type="VIDEO"]'
        ].join(',')));
    }

    function removeMisplacedVideoButtons() {
        Array.from(document.querySelectorAll('.alexai-download-video')).forEach(button => {
            const host = button.closest('.alexai-image-download-host');
            if (!isAllowedVideoButtonHost(host)) {
                button.remove();
            }
        });
    }

    function removeVideoDownloadPanel() {
        document.getElementById('alexai-video-download-panel')?.remove();
    }

    function findVideoPanelSection() {
        return document.querySelector([
            '#va-related-videos-widget_feature_div',
            '[data-feature-name="va-related-videos-widget"]',
            '.vse-video-widget-dp-container',
            '[class*="vseVideoWidgetContainer" i]',
            '#videoBlock_feature_div',
            '#vse-vw-dp-card_DetailPage'
        ].join(','));
    }

    function findVideoPanelAnchor(section) {
        return section?.querySelector?.([
            '[class*="vseHeroWidgetHeaderBlock" i]',
            '[class*="vseWidgetHeader" i]',
            'h2',
            'h3'
        ].join(',')) || section?.firstElementChild || section;
    }

    function renderVideoDownloadPanel(videos, attachedUrls) {
        const fallbackVideos = videos.filter(video => !attachedUrls?.has?.(video.url));
        if (!fallbackVideos.length) return;

        const section = findVideoPanelSection();
        const anchor = findVideoPanelAnchor(section);
        if (!section || !anchor) return;

        const panel = document.createElement('div');
        panel.id = 'alexai-video-download-panel';

        fallbackVideos.slice(0, 48).forEach((video, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'alexai-video-panel-button';
            button.dataset.label = fallbackVideos.length === 1 ? 'VID' : `VID ${index + 1}`;
            button.textContent = button.dataset.label;
            button.title = `${video.title || 'Amazon video'}${video.duration ? ` (${video.duration})` : ''}`;
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                downloadAmazonVideo(video);
            });
            registerVideoDownloadButton(video, button);
            panel.appendChild(button);
        });

        if (anchor.parentElement) {
            anchor.insertAdjacentElement('afterend', panel);
        } else {
            section.prepend(panel);
        }
    }

    function enhanceProductVideoDownloads() {
        if (!isProductPage) return;

        const videos = extractAmazonVideosFromDocument();
        removeMisplacedVideoButtons();
        removeVideoDownloadPanel();
        const attachedUrls = attachVideoButtonsToHosts(videos);
        renderVideoDownloadPanel(videos, attachedUrls);
    }

    function getDisplayedImageSize(img) {
        const rect = img.getBoundingClientRect();
        return {
            width: rect.width || img.width || img.naturalWidth || 0,
            height: rect.height || img.height || img.naturalHeight || 0
        };
    }

    function hasUsefulImageSize(img, minimum = 36) {
        const size = getDisplayedImageSize(img);
        return size.width >= minimum && size.height >= minimum;
    }

    function getPrimaryImageUrl(img) {
        const values = [
            img.getAttribute('data-old-hires'),
            img.getAttribute('data-a-hires'),
            img.getAttribute('data-src'),
            img.currentSrc,
            img.src
        ];

        for (const value of values) {
            const url = normalizeImageUrl(value);
            if (url && isLikelyAmazonImageUrl(url)) {
                return url;
            }
        }

        return '';
    }

    function getImageOverlayHost(img) {
        const host = img.closest([
            '.s-product-image-container',
            '.s-image-square-aspect',
            '#imgTagWrapperId',
            '#main-image-container',
            '.imageBlockAltImageSpan',
            'li.imageThumbnail',
            'picture',
            '[data-mediatype="IMAGE"]',
            '[class*="media-thumbnail" i]',
            '[class*="media-popover-thumbnail" i]',
            '.aok-relative',
            '.a-declarative'
        ].join(','));

        if (host && host !== img) {
            return host;
        }

        return img.parentElement;
    }

    function updateImageDownloadButtonPlacement(host) {
        if (!host?.getBoundingClientRect) return;

        const rect = host.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
        if (!viewportWidth || rect.width <= 0) return;

        const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const mostlyOutOfView = visibleWidth / rect.width < 0.2;
        let clippingRight = viewportWidth;
        let ancestor = host.parentElement;

        while (ancestor && ancestor !== document.documentElement) {
            const style = getComputedStyle(ancestor);
            if (/(hidden|clip|auto|scroll)/i.test(style.overflowX)) {
                const ancestorRect = ancestor.getBoundingClientRect();
                if (ancestorRect.width > 0) {
                    clippingRight = Math.min(clippingRight, ancestorRect.right);
                }
            }

            ancestor = ancestor.parentElement;
        }

        const needsInsideEdge = !mostlyOutOfView && rect.right + 38 > clippingRight;

        host.classList.toggle('alexai-image-download-host-out-of-view', mostlyOutOfView);
        host.classList.toggle('alexai-image-download-host-edge-inside', needsInsideEdge);
    }

    function attachImageDownloadButton(img, contextFactory) {
        const existingButton = imageDownloadButtons.get(img);
        const existingThumbnailButton = thumbnailDownloadButtons.get(img);
        const standardEnabled = imageDownloadSettings.qualityMode === 'both';

        if (existingButton?.isConnected && !standardEnabled) {
            existingThumbnailButton?.remove();
            thumbnailDownloadButtons.delete(img);
            updateImageDownloadButtonPlacement(existingButton.closest('.alexai-image-download-host'));
            return;
        }

        if (existingButton?.isConnected && existingThumbnailButton?.isConnected) {
            updateImageDownloadButtonPlacement(existingButton.closest('.alexai-image-download-host'));
            return;
        }

        if (existingButton && !existingButton.isConnected) {
            imageDownloadButtons.delete(img);
        }
        if (existingThumbnailButton && !existingThumbnailButton.isConnected) {
            thumbnailDownloadButtons.delete(img);
        }

        const host = getImageOverlayHost(img);
        if (!host) return;

        host.classList.add('alexai-image-download-host');
        updateImageDownloadButtonPlacement(host);

        if (!existingButton?.isConnected) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'alexai-image-download-button alexai-download-large';
            button.dataset.label = 'HD';
            button.textContent = 'HD';
            button.title = '下载高清图片';
            button.setAttribute('aria-label', '下载高清图片');
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                downloadImageForElement(img, contextFactory());
            });

            imageDownloadButtons.set(img, button);
            host.appendChild(button);
        }

        if (!standardEnabled || existingThumbnailButton?.isConnected) {
            return;
        }

        const thumbnailButton = document.createElement('button');
        thumbnailButton.type = 'button';
        thumbnailButton.className = 'alexai-image-download-button alexai-download-thumbnail';
        thumbnailButton.dataset.label = 'SD';
        thumbnailButton.textContent = 'SD';
        thumbnailButton.title = '下载当前尺寸图片';
        thumbnailButton.setAttribute('aria-label', '下载当前尺寸图片');
        thumbnailButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            downloadThumbnailForElement(img, contextFactory());
        });

        thumbnailDownloadButtons.set(img, thumbnailButton);
        host.appendChild(thumbnailButton);
    }

    function isSearchResultImage(img) {
        return Boolean(
            img.matches('img.s-image') &&
            img.closest('.s-result-item[data-asin], [data-component-type="s-search-result"]') &&
            hasUsefulImageSize(img, 64) &&
            isLikelyAmazonImageUrl(getPrimaryImageUrl(img))
        );
    }

    function isReviewDownloadImage(img) {
        if (!img.closest('#reviewsMedley, [data-hook="reviews-medley-widget"], [data-hook*="review" i]')) {
            return false;
        }

        if (!hasUsefulImageSize(img, 64) || !isLikelyAmazonImageUrl(getPrimaryImageUrl(img))) {
            return false;
        }

        const imageUrl = getPrimaryImageUrl(img);
        const imageText = [
            img.getAttribute('alt'),
            img.getAttribute('class'),
            img.parentElement?.getAttribute('class'),
            img.closest('[data-mediaid]')?.getAttribute('data-mediaid'),
            imageUrl
        ].map(cleanText).join(' ');

        if (/avatar|profile|sash|sprite|grey-pixel|transparent-pixel|aspect-icon|button-icon/i.test(imageText)) {
            return false;
        }

        return /Customer Image|community-reviews|media-thumbnail-image|media-popover-thumbnail|\/images\/I\/[A-Za-z0-9+-]+(?:\._|\.jpg)/i.test(imageText);
    }

    function isProductDownloadImage(img) {
        if (!hasUsefulImageSize(img, 36) || !isLikelyAmazonImageUrl(getPrimaryImageUrl(img))) {
            return false;
        }

        if (isReviewDownloadImage(img)) {
            return true;
        }

        if (img.closest('#navbar, #navFooter, #rhf, [id*="sponsored" i]')) {
            return false;
        }

        if (img.closest('#reviewsMedley, [data-hook="reviews-medley-widget"], [data-hook*="review" i]')) {
            return false;
        }

        return Boolean(img.closest([
            '#imageBlock',
            '#main-image-container',
            '#altImages',
            '#imgTagWrapperId',
            '#aplus',
            '#aplus_feature_div',
            '[data-a-dynamic-image]'
        ].join(',')));
    }

    function enhanceSearchImageDownloads() {
        Array.from(document.querySelectorAll('img.s-image')).forEach(img => {
            if (isSearchResultImage(img)) {
                attachImageDownloadButton(img, () => getSearchImageContext(img));
            }
        });
    }

    function enhanceProductImageDownloads() {
        Array.from(document.querySelectorAll([
            '#imageBlock img',
            '#main-image-container img',
            '#altImages img',
            '#imgTagWrapperId img',
            '#aplus img',
            '#aplus_feature_div img',
            'img[data-a-dynamic-image]',
            '#reviewsMedley img[src*="community-reviews"]',
            '#reviewsMedley img[class*="media-thumbnail" i]',
            '#reviewsMedley img[alt*="Customer Image" i]',
            '[data-hook="reviews-medley-widget"] img[src*="community-reviews"]',
            '[data-hook="reviews-medley-widget"] img[class*="media-thumbnail" i]',
            '[data-hook="reviews-medley-widget"] img[alt*="Customer Image" i]'
        ].join(',')))
            .forEach(img => {
                if (!isProductDownloadImage(img)) return;

                attachImageDownloadButton(img, () => getProductImageContext(img));
            });
    }

    function enhanceImageDownloads() {
        if (!isImageDownloadDetectionEnabled()) {
            return;
        }

        if (isSearchPage) {
            enhanceSearchImageDownloads();
        }

        if (isProductPage) {
            enhanceProductImageDownloads();
            enhanceProductVideoDownloads();
        }
    }

    function scheduleImageDownloadScan() {
        if (!isImageDownloadDetectionEnabled()) {
            return;
        }

        if (imageDownloadScanTimer) return;

        imageDownloadScanTimer = setTimeout(() => {
            imageDownloadScanTimer = null;
            enhanceImageDownloads();
        }, 200);
    }

    function removeInjectedDownloadControls() {
        document.querySelectorAll('.alexai-image-download-button, #alexai-video-download-panel')
            .forEach(element => element.remove());
        document.querySelectorAll('.alexai-image-download-host')
            .forEach(element => element.classList.remove(
                'alexai-image-download-host',
                'alexai-video-host-has-controls',
                'alexai-image-download-host-edge-inside',
                'alexai-image-download-host-out-of-view'
            ));
        document.querySelectorAll('[data-alexai-download-busy="true"]')
            .forEach(element => element.removeAttribute('data-alexai-download-busy'));
        videoDownloadButtonGroups.clear();
    }

    async function setupImageDownloader() {
        await loadImageDownloadSettings();
        injectImageDownloadStyles();
        if (isImageDownloadDetectionEnabled()) {
            enhanceImageDownloads();
        }

        if (!imageDownloadObserver && document.body) {
            imageDownloadObserver = new MutationObserver(scheduleImageDownloadScan);
            imageDownloadObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'srcset', 'data-src', 'data-old-hires', 'data-a-dynamic-image', 'data-video-url', 'data-video-id', 'data-videoid']
            });
        }

        window.addEventListener('scroll', scheduleImageDownloadScan, { passive: true });
        window.addEventListener('resize', scheduleImageDownloadScan, { passive: true });

        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local' || !changes.imageDownloadSettings) return;

            const wasEnabled = imageDownloadSettings.detectionEnabled;
            const previousQualityMode = imageDownloadSettings.qualityMode;
            imageDownloadSettings = normalizeImageDownloadSettings(changes.imageDownloadSettings.newValue);
            applyImageDownloadSettings();

            if (!imageDownloadSettings.detectionEnabled) {
                removeInjectedDownloadControls();
                return;
            }

            if (!wasEnabled || previousQualityMode !== imageDownloadSettings.qualityMode) {
                removeInjectedDownloadControls();
            }

            if (!wasEnabled || imageDownloadSettings.detectionEnabled) {
                scheduleImageDownloadScan();
            }
        });
    }

    function addScrapingIndicator() {
        if (document.getElementById('amazon-rufus-scraper-indicator')) return;

        const indicator = document.createElement('div');
        indicator.id = 'amazon-rufus-scraper-indicator';
        const shadow = indicator.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host {
                    position: fixed;
                    right: 18px;
                    bottom: 18px;
                    z-index: 999999;
                    color: #111827;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    font-size: 13px;
                    line-height: 1.35;
                    letter-spacing: 0;
                }

                *, *::before, *::after {
                    box-sizing: border-box;
                }

                button, select, input {
                    font: inherit;
                    letter-spacing: 0;
                }

                #launcher {
                    position: relative;
                    width: 42px;
                    height: 42px;
                    border: 1px solid rgba(255, 255, 255, 0.82);
                    border-radius: 8px;
                    background: #1d4ed8;
                    color: #fff;
                    box-shadow: 0 5px 18px rgba(15, 23, 42, 0.28);
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                    transition: background-color 0.14s ease, box-shadow 0.14s ease;
                }

                #launcher:hover {
                    background: #1e40af;
                    box-shadow: 0 7px 22px rgba(15, 23, 42, 0.34);
                }

                #launcher:focus-visible,
                button:focus-visible,
                select:focus-visible,
                input:focus-visible {
                    outline: 2px solid #f59e0b;
                    outline-offset: 2px;
                }

                .mark {
                    font-size: 18px;
                    font-weight: 800;
                }

                .ready-dot {
                    position: absolute;
                    right: 4px;
                    bottom: 4px;
                    width: 8px;
                    height: 8px;
                    border: 2px solid #1d4ed8;
                    border-radius: 50%;
                    background: #22c55e;
                }

                #panel {
                    position: absolute;
                    right: 0;
                    bottom: 50px;
                    width: 264px;
                    padding: 12px;
                    border: 1px solid #dbe2ea;
                    border-radius: 8px;
                    background: #fff;
                    box-shadow: 0 16px 40px rgba(15, 23, 42, 0.22);
                }

                #panel[hidden] {
                    display: none;
                }

                .panel-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding-bottom: 9px;
                    border-bottom: 1px solid #e5e7eb;
                }

                .panel-title {
                    font-size: 14px;
                    font-weight: 700;
                }

                #close {
                    width: 28px;
                    height: 28px;
                    border: 0;
                    border-radius: 5px;
                    background: transparent;
                    color: #64748b;
                    cursor: pointer;
                    font-size: 18px;
                    line-height: 1;
                }

                #close:hover {
                    background: #f1f5f9;
                    color: #0f172a;
                }

                .setting-row {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) 116px;
                    gap: 10px;
                    align-items: center;
                    min-height: 42px;
                    border-bottom: 1px solid #eef2f7;
                }

                .setting-row:last-of-type {
                    border-bottom: 0;
                }

                .setting-label {
                    color: #334155;
                    font-weight: 600;
                }

                select {
                    width: 116px;
                    height: 30px;
                    border: 1px solid #cbd5e1;
                    border-radius: 5px;
                    background: #fff;
                    color: #0f172a;
                    padding: 0 7px;
                    cursor: pointer;
                }

                .switch {
                    justify-self: end;
                    position: relative;
                    width: 38px;
                    height: 22px;
                }

                .switch input {
                    position: absolute;
                    opacity: 0;
                    width: 1px;
                    height: 1px;
                }

                .switch-track {
                    position: absolute;
                    inset: 0;
                    border-radius: 11px;
                    background: #cbd5e1;
                    cursor: pointer;
                    transition: background-color 0.14s ease;
                }

                .switch-track::after {
                    content: "";
                    position: absolute;
                    top: 3px;
                    left: 3px;
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    background: #fff;
                    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
                    transition: transform 0.14s ease;
                }

                .switch input:checked + .switch-track {
                    background: #2563eb;
                }

                .switch input:checked + .switch-track::after {
                    transform: translateX(16px);
                }

                .switch input:focus-visible + .switch-track {
                    outline: 2px solid #f59e0b;
                    outline-offset: 2px;
                }

                #summary {
                    margin-top: 8px;
                    color: #64748b;
                    font-size: 12px;
                }
            </style>
            <button id="launcher" type="button" title="alexai 页面下载设置" aria-label="打开 alexai 页面下载设置" aria-expanded="false">
                <span class="mark">A</span>
                <span class="ready-dot" aria-hidden="true"></span>
            </button>
            <section id="panel" aria-label="页面下载设置" hidden>
                <div class="panel-header">
                    <span class="panel-title">页面下载</span>
                    <button id="close" type="button" title="关闭" aria-label="关闭">&times;</button>
                </div>
                <div class="setting-row">
                    <span class="setting-label">下载按钮</span>
                    <label class="switch" title="启用页面图片和视频下载按钮">
                        <input id="detectionEnabled" type="checkbox">
                        <span class="switch-track"></span>
                    </label>
                </div>
                <label class="setting-row" for="displayMode">
                    <span class="setting-label">显示方式</span>
                    <select id="displayMode">
                        <option value="hover">悬停显示</option>
                        <option value="visible">直接显示</option>
                    </select>
                </label>
                <label class="setting-row" for="qualityMode">
                    <span class="setting-label">图片清晰度</span>
                    <select id="qualityMode">
                        <option value="high">仅高清 HD</option>
                        <option value="both">高清 + 标清</option>
                    </select>
                </label>
                <div id="summary" aria-live="polite"></div>
            </section>
        `;

        const launcher = shadow.getElementById('launcher');
        const panel = shadow.getElementById('panel');
        const closeButton = shadow.getElementById('close');
        const detectionEnabled = shadow.getElementById('detectionEnabled');
        const displayMode = shadow.getElementById('displayMode');
        const qualityMode = shadow.getElementById('qualityMode');
        const summary = shadow.getElementById('summary');

        function setPanelOpen(open) {
            panel.hidden = !open;
            launcher.setAttribute('aria-expanded', String(open));
        }

        function syncSettings() {
            detectionEnabled.checked = imageDownloadSettings.detectionEnabled;
            displayMode.value = imageDownloadSettings.displayMode;
            qualityMode.value = imageDownloadSettings.qualityMode;
            displayMode.disabled = !imageDownloadSettings.detectionEnabled;
            qualityMode.disabled = !imageDownloadSettings.detectionEnabled;

            if (!imageDownloadSettings.detectionEnabled) {
                summary.textContent = '页面下载按钮已关闭';
                return;
            }

            const displayText = imageDownloadSettings.displayMode === 'hover' ? '悬停显示' : '直接显示';
            const qualityText = imageDownloadSettings.qualityMode === 'high' ? '仅高清' : '高清和标清';
            summary.textContent = `${displayText}，${qualityText}`;
        }

        async function saveSettings(changes) {
            const previousSettings = imageDownloadSettings;
            imageDownloadSettings = normalizeImageDownloadSettings({
                ...imageDownloadSettings,
                ...changes
            });
            applyImageDownloadSettings();

            if (!imageDownloadSettings.detectionEnabled) {
                removeInjectedDownloadControls();
            } else if (
                previousSettings.detectionEnabled !== imageDownloadSettings.detectionEnabled ||
                previousSettings.qualityMode !== imageDownloadSettings.qualityMode
            ) {
                removeInjectedDownloadControls();
                scheduleImageDownloadScan();
            }

            const snapshot = { ...imageDownloadSettings };
            imageDownloadSettingsSaveQueue = imageDownloadSettingsSaveQueue
                .catch(() => {})
                .then(() => chrome.storage.local.set({ imageDownloadSettings: snapshot }));
            await imageDownloadSettingsSaveQueue;
        }

        launcher.addEventListener('click', () => setPanelOpen(panel.hidden));
        closeButton.addEventListener('click', () => setPanelOpen(false));
        detectionEnabled.addEventListener('change', () => saveSettings({ detectionEnabled: detectionEnabled.checked }));
        displayMode.addEventListener('change', () => saveSettings({ displayMode: displayMode.value }));
        qualityMode.addEventListener('change', () => saveSettings({ qualityMode: qualityMode.value }));

        document.addEventListener('pointerdown', event => {
            if (!panel.hidden && !indicator.contains(event.target)) {
                setPanelOpen(false);
            }
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !panel.hidden) {
                setPanelOpen(false);
                launcher.focus();
            }
        });

        syncPageDownloadSettings = syncSettings;
        syncSettings();
        document.body.appendChild(indicator);
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
        setupImageDownloader();
        addScrapingIndicator();

        if (isProductPage) {
            observePageChanges();
            window.amazonRufusLastData = extractRufusData();
        }
    }

    if (isProductPage) {
        window.amazonRufusExtractData = extractRufusData;
    }

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
