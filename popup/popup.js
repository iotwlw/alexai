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
        displayMode: 'visible'
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
    dataCount: document.getElementById('dataCount')
};

// Initialize
function init() {
    loadSavedState();
    bindEvents();
    updateUI();
    checkRunningStatus();
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
            'imageDownloadSettings'
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

        updateUI();
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

    // Control buttons
    elements.startBtn.addEventListener('click', handleStart);
    elements.pauseBtn.addEventListener('click', handlePause);
    elements.resumeBtn.addEventListener('click', handleResume);
    elements.stopBtn.addEventListener('click', handleStop);

    // Export
    elements.exportCsv.addEventListener('click', exportCSV);
    elements.exportJson.addEventListener('click', exportJSON);
    elements.clearData.addEventListener('click', handleClearData);
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

    elements.urlCount.textContent = `已导入: ${state.urls.length} 个URL`;
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
    const displayMode = ['visible', 'hidden'].includes(settings.displayMode)
        ? settings.displayMode
        : 'visible';

    return {
        detectionEnabled: settings.detectionEnabled !== false,
        displayMode
    };
}

function updateImageDownloadSettings() {
    state.imageDownloadSettings = normalizeImageDownloadSettings({
        detectionEnabled: elements.imageDownloadDetectionEnabled.checked,
        displayMode: elements.imageDownloadDisplayMode.value
    });
    elements.imageDownloadDisplayMode.disabled = !state.imageDownloadSettings.detectionEnabled;
    saveState();
    showStatus('图片下载设置已保存，Amazon页面会自动更新', 'success');
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
    elements.dataCount.textContent = `已抓取数据: ${state.scrapedData.length} 条`;

    // Update progress
    const progress = state.stats.total > 0
        ? Math.round(((state.stats.success + state.stats.failed) / state.stats.total) * 100)
        : 0;
    elements.progressBar.style.width = progress + '%';
    elements.progressBar.textContent = progress + '%';
    elements.progressPercent.textContent = progress + '%';

    // Update button visibility
    elements.startBtn.style.display = (!state.isRunning || state.isPaused) ? 'inline-flex' : 'none';
    elements.pauseBtn.style.display = (state.isRunning && !state.isPaused) ? 'inline-flex' : 'none';
    elements.resumeBtn.style.display = (state.isRunning && state.isPaused) ? 'inline-flex' : 'none';
    elements.stopBtn.style.display = state.isRunning ? 'inline-flex' : 'none';
    elements.imageDownloadDisplayMode.disabled = !state.imageDownloadSettings.detectionEnabled;

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
        success: 'var(--success-color)',
        error: 'var(--danger-color)',
        warning: 'var(--warning-color)',
        info: 'var(--text-secondary)'
    }[type] || 'var(--text-secondary)';
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
