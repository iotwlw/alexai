const DEFAULT_LINK_INSPECTION_API_URL = 'http://127.0.0.1:8080';

// Popup State
const state = {
    urls: [],
    urlsHash: '',  // URL 列表的哈希值，用于检测是否修改
    scrapedData: [],
    isRunning: false,
    isPaused: false,
    config: {
        delayMin: 2000,
        delayMax: 5000,
        minConcurrentWindows: 2,
        maxConcurrentWindows: 5,
        batchSize: 25,
        restTime: 60000,
        enableAntiDetection: true,
        enableRetry: true,
        retryLimit: 3
    },
    imageDownloadSettings: {
        detectionEnabled: true,
        displayMode: 'hover',
        qualityMode: 'high'
    },
    linkInspection: {
        input: '',
        results: [],
        isRunning: false,
        statusMessage: '尚未运行',
        settings: {
            apiBaseUrl: DEFAULT_LINK_INSPECTION_API_URL,
            licenseCode: '',
            verified: false,
            lastVerifiedAt: '',
            domain: 'www.amazon.com'
        }
    },
    stats: {
        total: 0,
        success: 0,
        failed: 0,
        pending: 0,
        active: 0
    }
};

// DOM Elements
const elements = {
    urlInput: document.getElementById('urlInput'),
    urlCount: document.getElementById('urlCount'),
    loadFromFile: document.getElementById('loadFromFile'),
    clearUrls: document.getElementById('clearUrls'),
    fileInput: document.getElementById('fileInput'),
    delayMin: document.getElementById('delayMin'),
    delayMax: document.getElementById('delayMax'),
    minConcurrentWindows: document.getElementById('minConcurrentWindows'),
    maxConcurrentWindows: document.getElementById('maxConcurrentWindows'),
    batchSize: document.getElementById('batchSize'),
    restTime: document.getElementById('restTime'),
    enableAntiDetection: document.getElementById('enableAntiDetection'),
    enableRetry: document.getElementById('enableRetry'),
    imageDownloadDetectionEnabled: document.getElementById('imageDownloadDetectionEnabled'),
    imageDownloadDisplayMode: document.getElementById('imageDownloadDisplayMode'),
    imageDownloadQualityMode: document.getElementById('imageDownloadQualityMode'),
    progressBar: document.getElementById('progressBar'),
    progressPercent: document.getElementById('progressPercent'),
    statTotal: document.getElementById('statTotal'),
    statSuccess: document.getElementById('statSuccess'),
    statFailed: document.getElementById('statFailed'),
    statPending: document.getElementById('statPending'),
    statActive: document.getElementById('statActive'),
    statusMessage: document.getElementById('statusMessage'),
    startBtn: document.getElementById('startBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    resumeBtn: document.getElementById('resumeBtn'),
    stopBtn: document.getElementById('stopBtn'),
    exportCsv: document.getElementById('exportCsv'),
    exportJson: document.getElementById('exportJson'),
    clearData: document.getElementById('clearData'),
    dataCount: document.getElementById('dataCount'),
    planBadge: document.getElementById('planBadge'),
    inspectionPlanBadge: document.getElementById('inspectionPlanBadge'),
    workspaceTabs: Array.from(document.querySelectorAll('.workspace-tab')),
    scraperWorkspace: document.getElementById('scraperWorkspace'),
    inspectionWorkspace: document.getElementById('inspectionWorkspace'),
    inspectionInput: document.getElementById('inspectionInput'),
    inspectionCount: document.getElementById('inspectionCount'),
    inspectionLoadFromFile: document.getElementById('inspectionLoadFromFile'),
    inspectionFileInput: document.getElementById('inspectionFileInput'),
    clearInspectionUrls: document.getElementById('clearInspectionUrls'),
    inspectionDomain: document.getElementById('inspectionDomain'),
    linkInspectionLicenseCode: document.getElementById('linkInspectionLicenseCode'),
    saveLinkInspectionLicense: document.getElementById('saveLinkInspectionLicense'),
    linkInspectionLicenseStatus: document.getElementById('linkInspectionLicenseStatus'),
    runLinkInspection: document.getElementById('runLinkInspection'),
    inspectionResultStatus: document.getElementById('inspectionResultStatus'),
    inspectionSuccessCount: document.getElementById('inspectionSuccessCount'),
    inspectionFailedCount: document.getElementById('inspectionFailedCount'),
    inspectionResultsBody: document.getElementById('inspectionResultsBody'),
    exportInspectionCsv: document.getElementById('exportInspectionCsv'),
    exportInspectionJson: document.getElementById('exportInspectionJson'),
    linkInspectionApiUrl: document.getElementById('linkInspectionApiUrl'),
    inspectionLockPanel: document.getElementById('inspectionLockPanel')
};

// Initialize
async function init() {
    bindEvents();
    updateUI();
    await loadSavedState();
    await checkRunningStatus();
}

// Load saved state from chrome.storage
async function loadSavedState() {
    try {
        const result = await chrome.storage.local.get([
            'scraperUrls',
            'scraperUrlsHash',
            'scraperData',
            'scraperConfig',
            'scraperStats',
            'scraperRunning',
            'scraperPaused',
            'imageDownloadSettings',
            'linkInspectionInput',
            'linkInspectionResults',
            'linkInspectionSettings'
        ]);

        if (result.scraperUrls) {
            state.urls = result.scraperUrls;
            elements.urlInput.value = state.urls.join('\n');
        }

        if (result.scraperUrlsHash !== undefined) {
            state.urlsHash = result.scraperUrlsHash;
        }

        if (result.scraperData) {
            state.scrapedData = result.scraperData;
        }

        if (result.scraperConfig) {
            Object.assign(state.config, result.scraperConfig);
        }

        if (result.scraperStats) {
            Object.assign(state.stats, result.scraperStats);
        }

        if (result.scraperRunning !== undefined) {
            state.isRunning = result.scraperRunning;
        }

        if (result.scraperPaused !== undefined) {
            state.isPaused = result.scraperPaused;
        }

        if (result.imageDownloadSettings) {
            Object.assign(state.imageDownloadSettings, normalizeImageDownloadSettings(result.imageDownloadSettings));
        }

        if (result.linkInspectionInput !== undefined) {
            state.linkInspection.input = String(result.linkInspectionInput || '');
            elements.inspectionInput.value = state.linkInspection.input;
        }

        if (Array.isArray(result.linkInspectionResults)) {
            state.linkInspection.results = result.linkInspectionResults;
        }

        if (result.linkInspectionSettings) {
            Object.assign(state.linkInspection.settings, normalizeLinkInspectionSettings(result.linkInspectionSettings));
        }

        // Load config into UI
        elements.delayMin.value = state.config.delayMin / 1000;
        elements.delayMax.value = state.config.delayMax / 1000;
        elements.minConcurrentWindows.value = state.config.minConcurrentWindows || 2;
        elements.maxConcurrentWindows.value = state.config.maxConcurrentWindows || 5;
        elements.batchSize.value = state.config.batchSize;
        elements.restTime.value = state.config.restTime / 1000;
        elements.enableAntiDetection.checked = state.config.enableAntiDetection;
        elements.enableRetry.checked = state.config.enableRetry;
        elements.imageDownloadDetectionEnabled.checked = state.imageDownloadSettings.detectionEnabled;
        elements.imageDownloadDisplayMode.value = state.imageDownloadSettings.displayMode;
        elements.imageDownloadQualityMode.value = state.imageDownloadSettings.qualityMode;
        elements.linkInspectionLicenseCode.value = state.linkInspection.settings.licenseCode;
        elements.linkInspectionApiUrl.value = state.linkInspection.settings.apiBaseUrl;
        elements.inspectionDomain.value = state.linkInspection.settings.domain;

        updateUI();
        updateLinkInspectionUI();
    } catch (error) {
        console.error('Failed to load saved state:', error);
    }
}

// Bind event listeners
function bindEvents() {
    // URL input
    elements.urlInput.addEventListener('input', handleUrlInput);
    elements.loadFromFile.addEventListener('click', () => elements.fileInput.click());
    elements.fileInput.addEventListener('change', handleFileLoad);
    elements.clearUrls.addEventListener('click', handleClearUrls);

    // Settings
    elements.delayMin.addEventListener('change', updateConfig);
    elements.delayMax.addEventListener('change', updateConfig);
    elements.minConcurrentWindows.addEventListener('change', updateConfig);
    elements.maxConcurrentWindows.addEventListener('change', updateConfig);
    elements.batchSize.addEventListener('change', updateConfig);
    elements.restTime.addEventListener('change', updateConfig);
    elements.enableAntiDetection.addEventListener('change', updateConfig);
    elements.enableRetry.addEventListener('change', updateConfig);
    elements.imageDownloadDetectionEnabled.addEventListener('change', updateImageDownloadSettings);
    elements.imageDownloadDisplayMode.addEventListener('change', updateImageDownloadSettings);
    elements.imageDownloadQualityMode.addEventListener('change', updateImageDownloadSettings);

    // Control buttons
    elements.startBtn.addEventListener('click', handleStart);
    elements.pauseBtn.addEventListener('click', handlePause);
    elements.resumeBtn.addEventListener('click', handleResume);
    elements.stopBtn.addEventListener('click', handleStop);

    // Export
    elements.exportCsv.addEventListener('click', exportCSV);
    elements.exportJson.addEventListener('click', exportJSON);
    elements.clearData.addEventListener('click', handleClearData);

    // Workspace navigation and link inspection
    elements.workspaceTabs.forEach(tab => {
        tab.addEventListener('click', () => switchWorkspace(tab.dataset.workspace));
    });
    elements.inspectionInput.addEventListener('input', handleInspectionInput);
    elements.inspectionLoadFromFile.addEventListener('click', () => elements.inspectionFileInput.click());
    elements.inspectionFileInput.addEventListener('change', handleInspectionFileLoad);
    elements.clearInspectionUrls.addEventListener('click', clearInspectionInput);
    elements.inspectionDomain.addEventListener('change', saveLinkInspectionSettings);
    elements.linkInspectionLicenseCode.addEventListener('input', handleLinkInspectionLicenseInput);
    elements.saveLinkInspectionLicense.addEventListener('click', handleSaveLinkInspectionLicense);
    elements.linkInspectionApiUrl.addEventListener('change', handleLinkInspectionApiUrlChange);
    elements.runLinkInspection.addEventListener('click', handleRunLinkInspection);
    elements.exportInspectionCsv.addEventListener('click', exportInspectionCSV);
    elements.exportInspectionJson.addEventListener('click', exportInspectionJSON);
}

// Handle URL input
function handleUrlInput() {
    const text = elements.urlInput.value.trim();
    state.urls = text.split('\n')
        .map(line => line.trim())
        .map(line => normalizeToUrl(line))
        .filter(url => url && isValidUrl(url));

    // 注意：不在这里更新 urlsHash，只在启动成功后更新
    // 这样可以正确检测用户是否修改了输入框内容

    elements.urlCount.textContent = `${state.urls.length} 个链接`;
    saveState();
}

// 将ASIN或商品URL标准化为完整URL
function normalizeToUrl(input) {
    if (!input) return '';

    // 检查是否是完整的URL
    if (input.startsWith('http://') || input.startsWith('https://')) {
        return input;
    }

    // 检查是否是纯ASIN格式 (如: B0D2R3KRFN)
    const asinPattern = /^[A-Z0-9]{10}$/i;
    if (asinPattern.test(input)) {
        return `https://www.amazon.com/dp/${input.toUpperCase()}?th=1`;
    }

    return '';
}

// Validate URL
function isValidUrl(string) {
    try {
        const url = new URL(string);
        const pathname = url.pathname;
        const isValidHostname = url.hostname.includes('amazon.');
        const isValidPath = /\/dp\/[A-Z0-9]{10}(?:[/?]|$)/i.test(pathname) ||
                            /\/gp\/product\/[A-Z0-9]{10}(?:[/?]|$)/i.test(pathname);
        return isValidHostname && isValidPath;
    } catch (_) {
        return false;
    }
}

// Handle file load
function handleFileLoad(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        elements.urlInput.value = text;
        handleUrlInput();
    };
    reader.readAsText(file);
    event.target.value = '';
}

// Handle clear URLs
function handleClearUrls() {
    elements.urlInput.value = '';
    state.urls = [];
    elements.urlCount.textContent = '已导入: 0 个URL';
    saveState();
}

// Update config
function updateConfig() {
    state.config = {
        delayMin: parseInt(elements.delayMin.value) * 1000,
        delayMax: parseInt(elements.delayMax.value) * 1000,
        minConcurrentWindows: parseInt(elements.minConcurrentWindows.value),
        maxConcurrentWindows: parseInt(elements.maxConcurrentWindows.value),
        batchSize: parseInt(elements.batchSize.value),
        restTime: parseInt(elements.restTime.value) * 1000,
        enableAntiDetection: elements.enableAntiDetection.checked,
        enableRetry: elements.enableRetry.checked,
        retryLimit: 3
    };
    saveState();
}

function normalizeImageDownloadSettings(settings = {}) {
    const requestedDisplayMode = settings.displayMode === 'hidden'
        ? 'hover'
        : settings.displayMode;
    const displayMode = ['visible', 'hover'].includes(requestedDisplayMode)
        ? requestedDisplayMode
        : 'hover';
    const qualityMode = ['high', 'both'].includes(settings.qualityMode)
        ? settings.qualityMode
        : 'high';

    return {
        detectionEnabled: settings.detectionEnabled !== false,
        displayMode,
        qualityMode
    };
}

function updateImageDownloadSettings() {
    state.imageDownloadSettings = normalizeImageDownloadSettings({
        detectionEnabled: elements.imageDownloadDetectionEnabled.checked,
        displayMode: elements.imageDownloadDisplayMode.value,
        qualityMode: elements.imageDownloadQualityMode.value
    });
    elements.imageDownloadDisplayMode.disabled = !state.imageDownloadSettings.detectionEnabled;
    elements.imageDownloadQualityMode.disabled = !state.imageDownloadSettings.detectionEnabled;
    saveState();
    showStatus('页面下载设置已保存，已同步到 Amazon 页面', 'success');
}

function normalizeLinkInspectionSettings(settings = {}) {
    return {
        apiBaseUrl: normalizeLinkInspectionApiUrl(settings.apiBaseUrl || DEFAULT_LINK_INSPECTION_API_URL),
        licenseCode: String(settings.licenseCode || '').trim(),
        verified: settings.verified === true,
        lastVerifiedAt: String(settings.lastVerifiedAt || ''),
        domain: normalizeInspectionDomain(settings.domain)
    };
}

function normalizeInspectionDomain(value) {
    const allowedDomains = new Set([
        'www.amazon.com',
        'www.amazon.ca',
        'www.amazon.co.uk',
        'www.amazon.de',
        'www.amazon.co.jp'
    ]);
    const domain = String(value || '').trim().toLowerCase();
    return allowedDomains.has(domain) ? domain : 'www.amazon.com';
}

function normalizeLinkInspectionApiUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return DEFAULT_LINK_INSPECTION_API_URL;

    try {
        const url = new URL(raw);
        if (!['http:', 'https:'].includes(url.protocol)) {
            return DEFAULT_LINK_INSPECTION_API_URL;
        }

        return url.href.replace(/\/+$/, '');
    } catch (_) {
        return DEFAULT_LINK_INSPECTION_API_URL;
    }
}

function switchWorkspace(workspace) {
    const inspectionActive = workspace === 'inspection';
    elements.workspaceTabs.forEach(tab => {
        const active = tab.dataset.workspace === workspace;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });
    elements.scraperWorkspace.classList.toggle('active', !inspectionActive);
    elements.scraperWorkspace.hidden = inspectionActive;
    elements.inspectionWorkspace.classList.toggle('active', inspectionActive);
    elements.inspectionWorkspace.hidden = !inspectionActive;
    if (inspectionActive) {
        updateLinkInspectionUI();
    }
}

function getInspectionInputLines() {
    return elements.inspectionInput.value
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
}

function handleInspectionInput() {
    state.linkInspection.input = elements.inspectionInput.value;
    state.linkInspection.statusMessage = '尚未运行';
    updateLinkInspectionUI();
    saveState();
}

async function handleInspectionFileLoad(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
        const text = await file.text();
        elements.inspectionInput.value = text;
        handleInspectionInput();
        showInspectionStatus(`已导入 ${getInspectionInputLines().length} 条链接`, 'success');
    } catch (error) {
        showInspectionStatus(`文件读取失败：${error.message}`, 'error');
    } finally {
        event.target.value = '';
    }
}

function clearInspectionInput() {
    elements.inspectionInput.value = '';
    state.linkInspection.input = '';
    state.linkInspection.results = [];
    state.linkInspection.statusMessage = '尚未运行';
    saveState();
    updateLinkInspectionUI();
}

function saveLinkInspectionSettings() {
    state.linkInspection.settings = normalizeLinkInspectionSettings({
        ...state.linkInspection.settings,
        domain: elements.inspectionDomain.value
    });
    saveState();
}

function handleLinkInspectionApiUrlChange() {
    state.linkInspection.settings = normalizeLinkInspectionSettings({
        ...state.linkInspection.settings,
        apiBaseUrl: elements.linkInspectionApiUrl.value,
        verified: false
    });
    elements.linkInspectionApiUrl.value = state.linkInspection.settings.apiBaseUrl;
    saveState();
    updateLinkInspectionUI();
}

function handleLinkInspectionLicenseInput() {
    const changed = elements.linkInspectionLicenseCode.value.trim() !== state.linkInspection.settings.licenseCode;
    if (changed) {
        elements.linkInspectionLicenseStatus.textContent = '授权码有修改，请先保存';
        elements.linkInspectionLicenseStatus.dataset.type = 'info';
    }
}

async function handleSaveLinkInspectionLicense() {
    const licenseCode = elements.linkInspectionLicenseCode.value.trim();
    state.linkInspection.settings = normalizeLinkInspectionSettings({
        ...state.linkInspection.settings,
        licenseCode,
        verified: false,
        lastVerifiedAt: ''
    });
    await saveState();

    if (!licenseCode) {
        showInspectionStatus('请输入授权码', 'error');
        return;
    }

    showInspectionStatus('授权码已保存，将在首次巡查时向服务端验证', 'info');
    updateLinkInspectionUI();
}

function sendExtensionMessage(message) {
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

async function requestInspectionOriginPermission(apiBaseUrl) {
    if (!chrome.permissions?.contains || !chrome.permissions?.request) return true;

    const url = new URL(apiBaseUrl);
    const originPattern = `${url.protocol}//${url.hostname}/*`;
    const alreadyGranted = await chrome.permissions.contains({ origins: [originPattern] });
    if (alreadyGranted) return true;

    return chrome.permissions.request({ origins: [originPattern] });
}

async function handleRunLinkInspection() {
    const lines = getInspectionInputLines();
    if (!lines.length) {
        showInspectionStatus('请先输入链接或 ASIN', 'error');
        return;
    }

    if (lines.length > 50) {
        showInspectionStatus('单次最多巡查 50 条，请拆分后再运行', 'error');
        return;
    }

    if (!state.linkInspection.settings.licenseCode) {
        showInspectionStatus('请先输入授权码', 'error');
        elements.linkInspectionLicenseCode.focus();
        return;
    }

    if (elements.linkInspectionLicenseCode.value.trim() !== state.linkInspection.settings.licenseCode) {
        showInspectionStatus('授权码有修改，请先保存', 'error');
        elements.saveLinkInspectionLicense.focus();
        return;
    }

    const apiBaseUrl = normalizeLinkInspectionApiUrl(elements.linkInspectionApiUrl.value);
    try {
        const permissionGranted = await requestInspectionOriginPermission(apiBaseUrl);
        if (!permissionGranted) {
            showInspectionStatus('未获得巡查服务的网络权限', 'error');
            return;
        }
    } catch (error) {
        showInspectionStatus(`服务地址无效：${error.message}`, 'error');
        return;
    }

    state.linkInspection.settings = normalizeLinkInspectionSettings({
        ...state.linkInspection.settings,
        apiBaseUrl,
        domain: elements.inspectionDomain.value
    });
    state.linkInspection.isRunning = true;
    state.linkInspection.statusMessage = '正在巡查...';
    state.linkInspection.results = [];
    await saveState();
    updateLinkInspectionUI();

    try {
        const response = await sendExtensionMessage({
            action: 'runLinkInspection',
            inputs: lines,
            domain: state.linkInspection.settings.domain
        });

        if (!response?.success) {
            throw new Error(response?.error || '巡查服务返回失败');
        }

        state.linkInspection.results = Array.isArray(response.data?.items) ? response.data.items : [];
        state.linkInspection.settings.verified = true;
        state.linkInspection.settings.lastVerifiedAt = new Date().toISOString();
        state.linkInspection.statusMessage = `已完成 ${state.linkInspection.results.length} 条`;
        await saveState();
        showInspectionStatus(state.linkInspection.statusMessage, 'success');
    } catch (error) {
        state.linkInspection.settings.verified = false;
        state.linkInspection.statusMessage = error.message;
        await saveState();
        showInspectionStatus(error.message, 'error');
    } finally {
        state.linkInspection.isRunning = false;
        updateLinkInspectionUI();
    }
}

function showInspectionStatus(message, type = 'info') {
    state.linkInspection.statusMessage = message;
    elements.linkInspectionLicenseStatus.textContent = message;
    elements.linkInspectionLicenseStatus.dataset.type = type;
    elements.inspectionResultStatus.textContent = message;
}

function updateLinkInspectionUI() {
    if (!elements.inspectionInput) return;

    const lines = getInspectionInputLines();
    const settings = state.linkInspection.settings;
    const verified = settings.verified === true;
    elements.inspectionCount.textContent = `${lines.length} 条`;
    elements.planBadge.textContent = verified ? '专业版' : '免费版';
    elements.planBadge.className = `plan-badge ${verified ? 'pro' : 'free'}`;
    elements.inspectionPlanBadge.textContent = verified ? '已授权' : '未授权';
    elements.inspectionPlanBadge.className = `plan-badge ${verified ? 'pro' : 'free'}`;
    elements.inspectionLockPanel.classList.toggle('authorized', verified);
    elements.linkInspectionLicenseStatus.textContent = verified
        ? `已验证${settings.lastVerifiedAt ? ` · ${formatLocalTime(settings.lastVerifiedAt)}` : ''}`
        : (state.linkInspection.statusMessage || '尚未验证');
    elements.linkInspectionLicenseStatus.dataset.type = verified ? 'success' : 'info';
    elements.runLinkInspection.disabled = state.linkInspection.isRunning;
    elements.runLinkInspection.textContent = state.linkInspection.isRunning ? '巡查中...' : '开始链接巡查';
    elements.exportInspectionCsv.disabled = state.linkInspection.results.length === 0;
    elements.exportInspectionJson.disabled = state.linkInspection.results.length === 0;
    elements.inspectionResultStatus.textContent = state.linkInspection.statusMessage || '尚未运行';
    renderInspectionResults();
}

function formatLocalTime(value) {
    try {
        return new Date(value).toLocaleString();
    } catch (_) {
        return value;
    }
}

function setTableCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = String(value || '-');
    cell.title = String(value || '');
    row.appendChild(cell);
}

function renderInspectionResults() {
    const results = state.linkInspection.results;
    const successCount = results.filter(item => item.status === 'success').length;
    const failedCount = results.length - successCount;
    elements.inspectionSuccessCount.textContent = successCount;
    elements.inspectionFailedCount.textContent = failedCount;
    elements.inspectionResultsBody.textContent = '';

    if (!results.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.className = 'empty-row';
        cell.textContent = '运行后显示结果';
        row.appendChild(cell);
        elements.inspectionResultsBody.appendChild(row);
        return;
    }

    results.forEach(item => {
        const row = document.createElement('tr');
        if (item.status !== 'success') row.classList.add('failed');
        setTableCell(row, item.asin || item.original_asin);
        setTableCell(row, item.price);
        setTableCell(row, item.coupon || item.display_discount);
        setTableCell(row, item.choice_badge);
        setTableCell(row, item.newer_model);
        setTableCell(row, item.status === 'success' ? '成功' : (item.error_message || '失败'));
        elements.inspectionResultsBody.appendChild(row);
    });
}

function getInspectionExportRecords() {
    return state.linkInspection.results.map(item => ({
        输入: item.input || '',
        URL: item.url || '',
        原ASIN: item.original_asin || '',
        ASIN: item.asin || '',
        状态: item.status || '',
        商品标题: item.product_title || '',
        价格: item.price || '',
        优惠券: item.coupon || '',
        Deal: item.is_deal || '',
        Prime专享: item.prime_exclusive || '',
        展示折扣: item.display_discount || '',
        评分: item.rating || '',
        评价数: item.review_count || '',
        促销检查: item.promo_check || '',
        促销: item.promotion || '',
        优惠码: item.promo_code || '',
        保留: item.keep || '',
        Choice: item.choice_badge || '',
        高频退货: item.frequent_return || '',
        新款: item.newer_model || '',
        错误: item.error_message || '',
        检查时间: item.captured_at || ''
    }));
}

function exportInspectionCSV() {
    const records = getInspectionExportRecords();
    if (!records.length) return;
    const headers = Object.keys(records[0]);
    const rows = records.map(record => headers.map(header => record[header] || ''));
    const csv = [headers, ...rows].map(row => row.map(toCsvCell).join(',')).join('\n');
    downloadFile(csv, 'alexai_link_inspection.csv', 'text/csv;charset=utf-8;');
    showInspectionStatus('巡查 CSV 已导出', 'success');
}

function exportInspectionJSON() {
    const records = getInspectionExportRecords();
    if (!records.length) return;
    downloadFile(JSON.stringify(records, null, 2), 'alexai_link_inspection.json', 'application/json;charset=utf-8;');
    showInspectionStatus('巡查 JSON 已导出', 'success');
}

// Handle start
async function handleStart() {
    if (state.urls.length === 0) {
        showStatus('⚠️ 请先导入URL', 'error');
        return;
    }

    // Validate config
    if (state.config.delayMin >= state.config.delayMax) {
        showStatus('⚠️ 最大延迟必须大于最小延迟', 'error');
        return;
    }

    if (
        state.config.minConcurrentWindows < 2 ||
        state.config.maxConcurrentWindows > 5 ||
        state.config.minConcurrentWindows > state.config.maxConcurrentWindows
    ) {
        showStatus('⚠️ 并发窗口范围必须在 2-5，且最小值不能大于最大值', 'error');
        return;
    }

    // 检查是否是新任务（URL 列表是否改变）
    const currentHash = JSON.stringify(state.urls);
    const isNewTask = currentHash !== state.urlsHash;

    state.isRunning = true;
    state.isPaused = false;

    await saveState();

    // Send message to background
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'start',
            urls: state.urls,
            config: state.config,
            isNewTask: isNewTask  // 传递新任务标志
        });

        if (response && response.success) {
            // 更新保存的哈希值
            state.urlsHash = currentHash;
            await saveState();
            showStatus(isNewTask ? '✅ 开始新任务' : '✅ 继续未完成任务', 'success');
        } else {
            showStatus('❌ 启动失败: ' + (response?.error || '未知错误'), 'error');
            state.isRunning = false;
            await saveState();
        }
    } catch (error) {
        console.error('Failed to start:', error);
        showStatus('❌ 启动失败: ' + error.message, 'error');
        state.isRunning = false;
        await saveState();
    }

    updateUI();
}

// Handle pause
async function handlePause() {
    try {
        await chrome.runtime.sendMessage({ action: 'pause' });
        state.isPaused = true;
        showStatus('⏸️ 任务已暂停', 'warning');
        await saveState();
        updateUI();
    } catch (error) {
        console.error('Failed to pause:', error);
    }
}

// Handle resume
async function handleResume() {
    try {
        await chrome.runtime.sendMessage({ action: 'resume' });
        state.isPaused = false;
        showStatus('▶️ 任务已继续', 'success');
        await saveState();
        updateUI();
    } catch (error) {
        console.error('Failed to resume:', error);
    }
}

// Handle stop
async function handleStop() {
    if (!confirm('确定要停止抓取吗？')) return;

    try {
        await chrome.runtime.sendMessage({ action: 'stop' });
        state.isRunning = false;
        state.isPaused = false;
        state.stats.active = 0;
        showStatus('⏹️ 任务已停止', 'info');
        await saveState();
        updateUI();
    } catch (error) {
        console.error('Failed to stop:', error);
    }
}

function getExportHeaders() {
    return [
        'ASIN',
        '商品标题',
        '品牌',
        '评分',
        '评价数',
        '价格标识',
        '是否High price',
        '问题1',
        '问题2',
        '问题3',
        '问题4',
        '问题5',
        'URL',
        '抓取时间'
    ];
}

function getQuestionColumns(item) {
    const prompts = [];
    const seen = new Set();

    function addPrompt(value) {
        const normalized = String(value || '').replace(/\s+/g, ' ').trim();
        const key = normalized.toLowerCase();

        if (!normalized || key === 'ask something else' || seen.has(key)) {
            return;
        }

        seen.add(key);
        prompts.push(normalized);
    }

    ['问题1', '问题2', '问题3', '问题4', '问题5'].forEach(key => addPrompt(item[key]));
    ['question1', 'question2', 'question3', 'question4', 'question5'].forEach(key => addPrompt(item[key]));

    if (Array.isArray(item.questions)) {
        item.questions.forEach(addPrompt);
    }

    if (Array.isArray(item.rufusPrompts)) {
        item.rufusPrompts.forEach(addPrompt);
    }

    if (prompts.length < 5) {
        if (Array.isArray(item.rufusQuestions)) {
            item.rufusQuestions.forEach(addPrompt);
        }

        if (Array.isArray(item.rufusActions)) {
            item.rufusActions.forEach(addPrompt);
        }
    }

    return Array.from({ length: 5 }, (_, index) => prompts[index] || '');
}

function buildExportRecord(item) {
    const questions = getQuestionColumns(item);

    return {
        ASIN: item.asin || '',
        商品标题: item.productTitle || '',
        品牌: item.brand || '',
        评分: item.rating || '',
        评价数: item.reviewCount || '',
        价格标识: item.priceInsightLabel || '',
        '是否High price': item.highPriceDetected ? '是' : '否',
        问题1: questions[0],
        问题2: questions[1],
        问题3: questions[2],
        问题4: questions[3],
        问题5: questions[4],
        URL: item.url || '',
        抓取时间: item.scrapedAt || ''
    };
}

function getExportRecords() {
    return state.scrapedData.map(buildExportRecord);
}

// Export CSV
function exportCSV() {
    if (state.scrapedData.length === 0) {
        showStatus('⚠️ 暂无数据可导出', 'warning');
        return;
    }

    const headers = getExportHeaders();
    const rows = getExportRecords().map(record => headers.map(header => record[header] || ''));

    const csv = [headers, ...rows]
        .map(row => row.map(toCsvCell).join(','))
        .join('\n');

    downloadFile(csv, 'alexai_data.csv', 'text/csv;charset=utf-8;');
    showStatus('✅ CSV文件已导出', 'success');
}

function toCsvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

// Export JSON
function exportJSON() {
    if (state.scrapedData.length === 0) {
        showStatus('⚠️ 暂无数据可导出', 'warning');
        return;
    }

    const json = JSON.stringify(getExportRecords(), null, 2);
    downloadFile(json, 'alexai_data.json', 'application/json;charset=utf-8;');
    showStatus('✅ JSON文件已导出', 'success');
}

// Download file
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Handle clear data
async function handleClearData() {
    if (!confirm('确定要清空所有抓取数据吗？')) return;

    state.scrapedData = [];
    state.stats = { total: 0, success: 0, failed: 0, pending: 0, active: 0 };
    await saveState();
    updateUI();
    showStatus('🗑️ 数据已清空', 'info');
}

// Save state to chrome.storage
async function saveState() {
    try {
        await chrome.storage.local.set({
            scraperUrls: state.urls,
            scraperUrlsHash: state.urlsHash,
            scraperData: state.scrapedData,
            scraperConfig: state.config,
            imageDownloadSettings: state.imageDownloadSettings,
            linkInspectionInput: state.linkInspection.input,
            linkInspectionResults: state.linkInspection.results,
            linkInspectionSettings: state.linkInspection.settings,
            scraperStats: state.stats,
            scraperRunning: state.isRunning,
            scraperPaused: state.isPaused
        });
    } catch (error) {
        console.error('Failed to save state:', error);
    }
}

// Check running status
async function checkRunningStatus() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getStatus' });
        if (response && response.status === 'running') {
            state.isRunning = true;
            state.isPaused = response.paused || false;
            updateUI();
        }
    } catch (error) {
        console.error('Failed to check status:', error);
    }
}

// Update UI
function updateUI() {
    // Update stats
    state.stats.total = state.urls.length;
    state.stats.pending = state.urls.length - state.stats.success - state.stats.failed;
    if (!state.isRunning) {
        state.stats.active = 0;
    }

    elements.statTotal.textContent = state.stats.total;
    elements.statSuccess.textContent = state.stats.success;
    elements.statFailed.textContent = state.stats.failed;
    elements.statPending.textContent = state.stats.pending;
    elements.statActive.textContent = state.stats.active || 0;
    elements.urlCount.textContent = `${state.urls.length} 个链接`;
    elements.dataCount.textContent = `已抓取 ${state.scrapedData.length} 条`;

    // Update progress
    const progress = state.stats.total > 0
        ? Math.round(((state.stats.success + state.stats.failed) / state.stats.total) * 100)
        : 0;
    elements.progressBar.style.width = progress + '%';
    elements.progressPercent.textContent = progress + '%';

    // Update button visibility
    elements.startBtn.style.display = (!state.isRunning || state.isPaused) ? 'inline-flex' : 'none';
    elements.pauseBtn.style.display = (state.isRunning && !state.isPaused) ? 'inline-flex' : 'none';
    elements.resumeBtn.style.display = (state.isRunning && state.isPaused) ? 'inline-flex' : 'none';
    elements.stopBtn.style.display = state.isRunning ? 'inline-flex' : 'none';
    elements.imageDownloadDisplayMode.disabled = !state.imageDownloadSettings.detectionEnabled;
    elements.imageDownloadQualityMode.disabled = !state.imageDownloadSettings.detectionEnabled;
    updateLinkInspectionUI();

    // Update container class for animation
    if (state.isRunning && !state.isPaused) {
        document.body.classList.add('running');
    } else {
        document.body.classList.remove('running');
    }
}

// Show status message
function showStatus(message, type = 'info') {
    elements.statusMessage.textContent = message;

    elements.statusMessage.style.color = {
        success: 'var(--success)',
        error: 'var(--danger)',
        warning: 'var(--warning)',
        info: 'var(--muted)'
    }[type] || 'var(--muted)';
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateProgress') {
        state.stats = message.stats;
        state.scrapedData = message.data || state.scrapedData;
        updateUI();
        saveState();
        showStatus(message.status || '正在抓取...', 'info');
        sendResponse({ success: true });
    } else if (message.action === 'updateData') {
        state.scrapedData = message.data || [];
        updateUI();
        saveState();
        sendResponse({ success: true });
    } else if (message.action === 'taskComplete') {
        state.isRunning = false;
        state.isPaused = false;
        state.stats.active = 0;
        updateUI();
        saveState();
        showStatus('🎉 抓取任务已完成！正在导出CSV...', 'success');
        sendResponse({ success: true });

        // 自动导出CSV
        setTimeout(() => {
            exportCSV();
        }, 500);
    }
    return true;
});

// Initialize on load
init();
