/* ============================================================
   DEEPECHO-SAM  app.js
   Instrument-UI logic — matches redesigned index.html
   ============================================================ */

// ── Navigation ──────────────────────────────────────────────
function navTo(pageId) {
  document.querySelectorAll('.page-view').forEach(el => el.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
    btn.removeAttribute('aria-current');
  });
  const activeBtn = document.getElementById('nav-' + pageId);
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.setAttribute('aria-current', 'page');
  }
}

// ── WaveSurfer & Forensic State ───────────────────────────────
let wavesurfer         = null;
let wsRegions          = null;
let lastAnalysisResult = null;
let currentTamperIdx   = 0;

document.addEventListener('DOMContentLoaded', () => {
  wavesurfer = WaveSurfer.create({
    container: '#waveform-container',
    waveColor:     '#1A4A3A',
    progressColor: '#00FF88',
    cursorColor:   '#00FF88',
    barWidth:  2,
    barRadius: 1,
    barGap:    1,
    cursorWidth: 1,
    height: 56,
    normalize: true,
  });

  // Register WaveSurfer Regions Plugin if available
  try {
    const RegionsPlugin = window.WaveSurferRegions || (WaveSurfer && WaveSurfer.Regions ? WaveSurfer.Regions : null);
    if (RegionsPlugin) {
      wsRegions = wavesurfer.registerPlugin(RegionsPlugin.create());
    }
  } catch (e) {
    console.warn('WaveSurfer Regions plugin notice:', e);
  }

  wavesurfer.on('play', () => {
    document.getElementById('play-icon').setAttribute('d', 'M4 3h3v10H4zm5 0h3v10H9z');
    const lungViz = document.getElementById('lung-viz-container');
    if (lungViz) lungViz.classList.add('playback-active');
  });
  wavesurfer.on('pause', () => {
    document.getElementById('play-icon').setAttribute('d', 'M4 3l10 5-10 5z');
    const lungViz = document.getElementById('lung-viz-container');
    if (lungViz) lungViz.classList.remove('playback-active');
  });
  wavesurfer.on('finish', () => {
    document.getElementById('play-icon').setAttribute('d', 'M4 3l10 5-10 5z');
    const lungViz = document.getElementById('lung-viz-container');
    if (lungViz) lungViz.classList.remove('playback-active');
  });

  document.getElementById('play-pause-btn').addEventListener('click', () => {
    if (wavesurfer) wavesurfer.playPause();
  });

  initChart();
  initTrimmerInteractions();
});

// ── Chart ────────────────────────────────────────────────────
let timelineChart = null;

function initChart() {
  const ctx = document.getElementById('timeline-chart').getContext('2d');
  timelineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(399).fill(''),
      datasets: [{
        label: 'P(synthetic)',
        data: Array(399).fill(0),
        borderColor: '#1A4A3A',
        borderWidth: 1.5,
        fill: true,
        backgroundColor: 'rgba(0,255,136,0.04)',
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: '#00FF88',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 600, easing: 'easeOutExpo' },
      scales: {
        y: {
          min: 0, max: 1,
          grid: { color: '#1A2B3C', lineWidth: 1 },
          border: { color: '#1A2B3C', dash: [4,4] },
          ticks: {
            color: '#38566A',
            font: { family: "'JetBrains Mono', monospace", size: 9 },
            maxTicksLimit: 5,
            callback: v => (v * 100).toFixed(0) + '%'
          }
        },
        x: {
          grid: { display: false },
          border: { color: '#1A2B3C' },
          ticks: {
            color: '#38566A',
            font: { family: "'JetBrains Mono', monospace", size: 9 },
            maxTicksLimit: 10,
            maxRotation: 0,
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0C1622',
          borderColor: '#1A2B3C',
          borderWidth: 1,
          titleColor: '#38566A',
          bodyColor: '#00FF88',
          titleFont: { family: "'JetBrains Mono', monospace", size: 9 },
          bodyFont:  { family: "'JetBrains Mono', monospace", size: 11 },
          callbacks: {
            label: ctx => {
              if (ctx.datasetIndex === 1) return 'Threshold (\u03C4): ' + (ctx.raw * 100).toFixed(1) + '%';
              return 'P(fake): ' + (ctx.raw * 100).toFixed(1) + '%';
            }
          }
        }
      }
    }
  });
}

function updateChart(timelineData, threshold, spliceTimestamp, duration) {
  const labels = timelineData.map((_, i) =>
    ((i / (timelineData.length - 1)) * duration).toFixed(1) + 's'
  );

  const avg = timelineData.reduce((a, b) => a + b, 0) / timelineData.length;
  const isFake = avg >= threshold;
  const signalColor = isFake ? '#FF2D55' : '#00FF88';
  const fillColor   = isFake ? 'rgba(255,45,85,0.06)' : 'rgba(0,255,136,0.05)';

  timelineChart.data.labels = labels;
  timelineChart.data.datasets[0].data = timelineData;
  timelineChart.data.datasets[0].borderColor = signalColor;
  timelineChart.data.datasets[0].backgroundColor = fillColor;

  // Threshold line as second dataset
  if (timelineChart.data.datasets.length === 1) {
    timelineChart.data.datasets.push({
      label: 'Threshold',
      data: Array(timelineData.length).fill(threshold),
      borderColor: '#38566A',
      borderWidth: 1,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
      tension: 0,
    });
  } else {
    timelineChart.data.datasets[1].data = Array(timelineData.length).fill(threshold);
  }

  timelineChart.update('active');
}

// ── Drop Zone ────────────────────────────────────────────────
const dropZone  = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('click', (e) => {
  if (e.target !== fileInput) fileInput.click();
});

dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) processFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) processFile(e.target.files[0]);
});

// ── Demo load ─────────────────────────────────────────────────
function loadDemo(filename) {
  fetch('/test_samples/' + filename)
    .then(r => r.blob())
    .then(blob => {
      const file = new File([blob], filename, { type: 'audio/wav' });
      processFile(file);
    })
    .catch(() => alert('Failed to load demo file: ' + filename));
}

// ── Audio Trimmer System ──────────────────────────────────────
const MAX_TRIM_SECONDS = 35.0;

let trimmerState = {
  active: false,
  file: null,
  audioBuffer: null,
  totalDuration: 0,
  startSec: 0,
  endSec: 35.0,
  isPreviewing: false,
  dragTarget: null,
  dragStartX: 0,
  dragStartSec: 0,
  dragEndSec: 0,
};

function formatTimeCode(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
}

function sliceAudioBuffer(audioBuffer, startSec, endSec) {
  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(audioBuffer.length, Math.floor(endSec * sampleRate));
  const length = Math.max(1, endSample - startSample);

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const slicedBuffer = ctx.createBuffer(audioBuffer.numberOfChannels, length, sampleRate);
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const channelData = audioBuffer.getChannelData(c).subarray(startSample, endSample);
    slicedBuffer.copyToChannel(channelData, c, 0);
  }
  ctx.close();
  return slicedBuffer;
}

function openTrimmer(file, audioBuffer) {
  trimmerState.active = true;
  trimmerState.file = file;
  trimmerState.audioBuffer = audioBuffer;
  trimmerState.totalDuration = audioBuffer.duration;
  trimmerState.startSec = 0;
  trimmerState.endSec = Math.min(MAX_TRIM_SECONDS, audioBuffer.duration);

  // Load full audio into WaveSurfer so user sees the complete waveform
  const objUrl = URL.createObjectURL(file);
  wavesurfer.load(objUrl);
  document.getElementById('play-pause-btn').disabled = false;

  // Show trimmer panel and overlay
  const panel = document.getElementById('trimmer-panel');
  const overlay = document.getElementById('trimmer-overlay');
  if (panel) {
    panel.style.display = 'flex';
    panel.setAttribute('aria-hidden', 'false');
  }
  if (overlay) overlay.style.display = 'flex';

  const origDurEl = document.getElementById('trimmer-orig-dur');
  if (origDurEl) origDurEl.textContent = `${audioBuffer.duration.toFixed(1)}s`;

  updateTrimmerUI();
}

function closeTrimmer() {
  trimmerState.active = false;
  if (trimmerState.isPreviewing) {
    wavesurfer.pause();
    trimmerState.isPreviewing = false;
    const btn = document.getElementById('trim-preview-btn');
    const playIcon = document.getElementById('trim-preview-play');
    const pauseIcon = document.getElementById('trim-preview-pause');
    const label = document.getElementById('trim-preview-label');
    if (btn) btn.classList.remove('playing');
    if (playIcon) playIcon.style.display = 'inline-block';
    if (pauseIcon) pauseIcon.style.display = 'none';
    if (label) label.textContent = 'Preview Trim';
  }
  const panel = document.getElementById('trimmer-panel');
  const overlay = document.getElementById('trimmer-overlay');
  if (panel) {
    panel.style.display = 'none';
    panel.setAttribute('aria-hidden', 'true');
  }
  if (overlay) overlay.style.display = 'none';
}

function toggleManualTrim() {
  if (!trimmerState.audioBuffer) return;
  if (trimmerState.active) {
    closeTrimmer();
  } else {
    openTrimmer(trimmerState.file, trimmerState.audioBuffer);
  }
}

function updateTrimmerUI() {
  const { totalDuration, startSec, endSec } = trimmerState;
  if (totalDuration <= 0) return;

  const startPct = (startSec / totalDuration) * 100;
  const endPct = (endSec / totalDuration) * 100;
  const widthPct = Math.max(0.5, endPct - startPct);

  // Update overlay elements
  const shadeLeft = document.getElementById('trim-shade-left');
  const shadeRight = document.getElementById('trim-shade-right');
  const windowEl = document.getElementById('trim-selection-window');
  const durBadge = document.getElementById('trim-dur-badge');

  if (shadeLeft) shadeLeft.style.width = `${startPct}%`;
  if (windowEl) windowEl.style.width = `${widthPct}%`;
  if (shadeRight) shadeRight.style.width = `${Math.max(0, 100 - endPct)}%`;

  const windowLen = (endSec - startSec).toFixed(1);
  if (durBadge) {
    durBadge.textContent = `${formatTimeCode(startSec)} → ${formatTimeCode(endSec)} (${windowLen}s)`;
  }

  // Update info chip readouts
  const startTxt = document.getElementById('trim-start-txt');
  const endTxt = document.getElementById('trim-end-txt');
  const lenTxt = document.getElementById('trim-len-txt');
  const submitBtn = document.getElementById('trim-submit-btn');

  if (startTxt) startTxt.textContent = formatTimeCode(startSec);
  if (endTxt) endTxt.textContent = formatTimeCode(endSec);
  if (lenTxt) lenTxt.textContent = `${windowLen}s`;
  if (submitBtn) {
    submitBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 8l3 3 7-7"/></svg>
      <span>Analyze Trim (${windowLen}s)</span>
    `;
  }
}

function applyTrimPreset(preset) {
  const { totalDuration } = trimmerState;
  if (totalDuration <= 0) return;

  const win = Math.min(MAX_TRIM_SECONDS, totalDuration);
  if (preset === 'start') {
    trimmerState.startSec = 0;
    trimmerState.endSec = win;
  } else if (preset === 'middle') {
    const start = Math.max(0, (totalDuration - win) / 2);
    trimmerState.startSec = start;
    trimmerState.endSec = start + win;
  } else if (preset === 'end') {
    const start = Math.max(0, totalDuration - win);
    trimmerState.startSec = start;
    trimmerState.endSec = totalDuration;
  }

  updateTrimmerUI();

  if (trimmerState.isPreviewing) {
    wavesurfer.setTime(trimmerState.startSec);
  }
}

function toggleTrimPreview() {
  const btn = document.getElementById('trim-preview-btn');
  const playIcon = document.getElementById('trim-preview-play');
  const pauseIcon = document.getElementById('trim-preview-pause');
  const label = document.getElementById('trim-preview-label');

  if (trimmerState.isPreviewing) {
    wavesurfer.pause();
    trimmerState.isPreviewing = false;
    if (btn) btn.classList.remove('playing');
    if (playIcon) playIcon.style.display = 'inline-block';
    if (pauseIcon) pauseIcon.style.display = 'none';
    if (label) label.textContent = 'Preview Trim';
  } else {
    wavesurfer.setTime(trimmerState.startSec);
    wavesurfer.play();
    trimmerState.isPreviewing = true;
    if (btn) btn.classList.add('playing');
    if (playIcon) playIcon.style.display = 'none';
    if (pauseIcon) pauseIcon.style.display = 'inline-block';
    if (label) label.textContent = 'Pause Preview';
  }
}

function submitTrimmedAudio() {
  if (!trimmerState.audioBuffer || !trimmerState.file) return;

  if (trimmerState.isPreviewing) {
    wavesurfer.pause();
    trimmerState.isPreviewing = false;
  }

  const { audioBuffer, file, startSec, endSec } = trimmerState;
  
  // Slice audio buffer in memory
  const slicedBuffer = sliceAudioBuffer(audioBuffer, startSec, endSec);
  
  // Encode as 16kHz mono WAV
  const wavBlob = encodeWAV(slicedBuffer);
  const baseName = file.name.replace(/\.[^/.]+$/, "");
  const trimmedName = `${baseName}_trim_${Math.round(startSec)}s-${Math.round(endSec)}s.wav`;
  const trimmedFile = new File([wavBlob], trimmedName, { type: 'audio/wav' });

  closeTrimmer();

  // Load trimmed audio into WaveSurfer for clean inspection
  const objUrl = URL.createObjectURL(trimmedFile);
  wavesurfer.load(objUrl);

  // Send trimmed file to model
  sendAudioForPrediction(trimmedFile);
}

function initTrimmerInteractions() {
  const overlay = document.getElementById('trimmer-overlay');
  const handleStart = document.getElementById('trim-handle-start');
  const handleEnd = document.getElementById('trim-handle-end');
  const winCenter = document.getElementById('trim-window-center');
  const shadeLeft = document.getElementById('trim-shade-left');
  const shadeRight = document.getElementById('trim-shade-right');

  if (!overlay) return;

  function onMouseDown(e, target) {
    if (!trimmerState.active) return;
    e.preventDefault();
    e.stopPropagation();

    trimmerState.dragTarget = target;
    trimmerState.dragStartX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
    trimmerState.dragStartSec = trimmerState.startSec;
    trimmerState.dragEndSec = trimmerState.endSec;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onMouseMove, { passive: false });
    document.addEventListener('touchend', onMouseUp);
  }

  function onMouseMove(e) {
    if (!trimmerState.dragTarget || !trimmerState.active) return;
    const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
    const rect = overlay.getBoundingClientRect();
    if (rect.width <= 0) return;

    const deltaX = clientX - trimmerState.dragStartX;
    const deltaSec = (deltaX / rect.width) * trimmerState.totalDuration;

    if (trimmerState.dragTarget === 'start') {
      let newStart = trimmerState.dragStartSec + deltaSec;
      newStart = Math.max(0, Math.min(newStart, trimmerState.endSec - 0.5));
      if (trimmerState.endSec - newStart > MAX_TRIM_SECONDS) {
        newStart = trimmerState.endSec - MAX_TRIM_SECONDS;
      }
      trimmerState.startSec = Math.max(0, newStart);
    } else if (trimmerState.dragTarget === 'end') {
      let newEnd = trimmerState.dragEndSec + deltaSec;
      newEnd = Math.max(trimmerState.startSec + 0.5, Math.min(newEnd, trimmerState.totalDuration));
      if (newEnd - trimmerState.startSec > MAX_TRIM_SECONDS) {
        newEnd = trimmerState.startSec + MAX_TRIM_SECONDS;
      }
      trimmerState.endSec = Math.min(trimmerState.totalDuration, newEnd);
    } else if (trimmerState.dragTarget === 'window') {
      const windowLen = trimmerState.dragEndSec - trimmerState.dragStartSec;
      let newStart = trimmerState.dragStartSec + deltaSec;
      let newEnd = newStart + windowLen;

      if (newStart < 0) {
        newStart = 0;
        newEnd = windowLen;
      }
      if (newEnd > trimmerState.totalDuration) {
        newEnd = trimmerState.totalDuration;
        newStart = Math.max(0, newEnd - windowLen);
      }
      trimmerState.startSec = newStart;
      trimmerState.endSec = newEnd;
    }

    updateTrimmerUI();
  }

  function onMouseUp() {
    if (!trimmerState.dragTarget) return;
    trimmerState.dragTarget = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('touchmove', onMouseMove);
    document.removeEventListener('touchend', onMouseUp);
  }

  if (handleStart) {
    handleStart.addEventListener('mousedown', e => onMouseDown(e, 'start'));
    handleStart.addEventListener('touchstart', e => onMouseDown(e, 'start'), { passive: false });
  }
  if (handleEnd) {
    handleEnd.addEventListener('mousedown', e => onMouseDown(e, 'end'));
    handleEnd.addEventListener('touchstart', e => onMouseDown(e, 'end'), { passive: false });
  }
  if (winCenter) {
    winCenter.addEventListener('mousedown', e => onMouseDown(e, 'window'));
    winCenter.addEventListener('touchstart', e => onMouseDown(e, 'window'), { passive: false });
  }

  if (shadeLeft) {
    shadeLeft.addEventListener('click', e => {
      if (!trimmerState.active) return;
      const rect = overlay.getBoundingClientRect();
      const clickSec = ((e.clientX - rect.left) / rect.width) * trimmerState.totalDuration;
      const windowLen = trimmerState.endSec - trimmerState.startSec;
      trimmerState.startSec = Math.max(0, clickSec);
      trimmerState.endSec = Math.min(trimmerState.totalDuration, trimmerState.startSec + windowLen);
      updateTrimmerUI();
    });
  }
  if (shadeRight) {
    shadeRight.addEventListener('click', e => {
      if (!trimmerState.active) return;
      const rect = overlay.getBoundingClientRect();
      const clickSec = ((e.clientX - rect.left) / rect.width) * trimmerState.totalDuration;
      const windowLen = trimmerState.endSec - trimmerState.startSec;
      trimmerState.endSec = Math.min(trimmerState.totalDuration, clickSec);
      trimmerState.startSec = Math.max(0, trimmerState.endSec - windowLen);
      updateTrimmerUI();
    });
  }

  // Auto-stop preview when reaching endSec
  wavesurfer.on('timeupdate', currentTime => {
    if (trimmerState.active && trimmerState.isPreviewing) {
      if (currentTime >= trimmerState.endSec) {
        wavesurfer.pause();
        wavesurfer.setTime(trimmerState.startSec);
        trimmerState.isPreviewing = false;
        const btn = document.getElementById('trim-preview-btn');
        const playIcon = document.getElementById('trim-preview-play');
        const pauseIcon = document.getElementById('trim-preview-pause');
        const label = document.getElementById('trim-preview-label');
        if (btn) btn.classList.remove('playing');
        if (playIcon) playIcon.style.display = 'inline-block';
        if (pauseIcon) pauseIcon.style.display = 'none';
        if (label) label.textContent = 'Preview Trim';
      }
    }
  });
}

// ── Ingest & Process file ─────────────────────────────────────
async function processFile(file) {
  // Update drop zone label
  const primary = document.getElementById('drop-zone-primary');
  if (primary) primary.textContent = file.name;

  try {
    const arrayBuf = await file.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const decodeCtx = new AudioCtx();
    if (decodeCtx.state === 'suspended') {
      await decodeCtx.resume();
    }
    const audioBuf = await new Promise((resolve, reject) => {
      decodeCtx.decodeAudioData(arrayBuf.slice(0), resolve, reject);
    });
    decodeCtx.close();

    const duration = audioBuf.duration;
    trimmerState.audioBuffer = audioBuf;
    trimmerState.file = file;

    const trimToggle = document.getElementById('toolbar-trim-toggle');
    if (trimToggle) trimToggle.style.display = 'inline-flex';

    if (duration > MAX_TRIM_SECONDS) {
      // Audio exceeds 35-second limit: open trimmer
      openTrimmer(file, audioBuf);
    } else {
      // Audio within 35-second limit: proceed directly
      closeTrimmer();
      sendAudioForPrediction(file);
    }
  } catch (err) {
    console.warn('Direct decode fallback:', err);
    sendAudioForPrediction(file);
  }
}

function sendAudioForPrediction(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('threshold_mode', document.getElementById('threshold-mode').value);

  // Update drop zone label
  const primary = document.getElementById('drop-zone-primary');
  if (primary) primary.textContent = file.name;

  // Reset previous tamper states
  const tamperBtn = document.getElementById('jump-tamper-btn');
  if (tamperBtn) tamperBtn.style.display = 'none';
  const regionsCont = document.getElementById('splice-regions-container');
  if (regionsCont) regionsCont.innerHTML = '';
  if (wsRegions) { try { wsRegions.clearRegions(); } catch(e){} }
  resetRespiratoryWidget();

  // Show loading
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.add('visible');

  // Load waveform immediately
  const objUrl = URL.createObjectURL(file);
  wavesurfer.load(objUrl);
  document.getElementById('play-pause-btn').disabled = false;
  triggerLaserScan();

  fetch('/api/predict', { method: 'POST', body: formData })
    .then(r => r.json())
    .then(data => {
      overlay.classList.remove('visible');
      if (data.error) { alert('Error: ' + data.error); return; }
      updateUI(data);
    })
    .catch(err => {
      overlay.classList.remove('visible');
      console.error(err);
      alert('Failed to process audio.');
    });
}

// ── Forensic Animation Utilities ──────────────────────────────
function triggerLaserScan() {
  const laser = document.getElementById('waveform-laser-scan');
  if (!laser) return;
  laser.classList.remove('scanning');
  void laser.offsetWidth; // Force CSS reflow
  laser.classList.add('scanning');
  setTimeout(() => laser.classList.remove('scanning'), 1200);
}

function animateValue(el, start, end, duration, decimals = 1, suffix = '%') {
  if (!el) return;
  const startTime = performance.now();
  const diff = end - start;
  el.classList.add('telemetry-spinning');
  function tick(now) {
    const elapsed = Math.min(1, (now - startTime) / duration);
    const progress = elapsed === 1 ? 1 : 1 - Math.pow(2, -10 * elapsed);
    const val = start + diff * progress;
    el.textContent = val.toFixed(decimals) + suffix;
    if (elapsed < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = end.toFixed(decimals) + suffix;
      el.classList.remove('telemetry-spinning');
    }
  }
  requestAnimationFrame(tick);
}

// ── Update UI after prediction ────────────────────────────────
function updateUI(result) {
  lastAnalysisResult = result;
  currentTamperIdx = 0;

  // Trigger laser scan sweep across waveform
  triggerLaserScan();

  // Enable Forensic Export buttons
  const expBtn = document.getElementById('export-pdf-btn');
  if (expBtn) expBtn.disabled = false;
  const vCertBtn = document.getElementById('verdict-cert-btn');
  if (vCertBtn) vCertBtn.disabled = false;

  const fakePct = (result.fake_probability * 100).toFixed(1);
  const confPct = parseFloat(result.confidence_percentage).toFixed(1);

  // Metric values with odometer rolling tickers
  const probEl = document.getElementById('metric-prob');
  const confEl = document.getElementById('metric-conf');
  const durEl  = document.getElementById('metric-dur');
  const frEl   = document.getElementById('metric-frames');

  animateValue(probEl, 0, parseFloat(fakePct), 700, 1, '%');
  animateValue(confEl, 0, parseFloat(confPct), 700, 1, '%');
  durEl.textContent  = (result.analyzed_duration_sec || result.duration_seconds) + 's';
  frEl.textContent   = (result.active_speech_frames || 0) + ' active frames';

  probEl.classList.remove('idle');
  confEl.classList.remove('idle');
  durEl.classList.remove('idle');

  // Metric color for prob
  const probVal = result.fake_probability;
  if (probVal >= 0.7)      probEl.style.color = 'var(--heat-red)';
  else if (probVal >= 0.4) probEl.style.color = 'var(--amber-sig)';
  else                     probEl.style.color = 'var(--phosphor)';

  // Metric bars
  const probBar = document.getElementById('prob-bar');
  const confBar = document.getElementById('conf-bar');
  if (probBar) {
    probBar.style.width = (probVal * 100) + '%';
    probBar.style.background = probVal >= 0.7 ? 'var(--heat-red)' : probVal >= 0.4 ? 'var(--amber-sig)' : 'var(--phosphor)';
  }
  if (confBar) confBar.style.width = confPct + '%';

  // Verdict cell
  const verdictCell = document.getElementById('verdict-cell');
  const verdictText = document.getElementById('verdict-text');
  const verdictFill = document.getElementById('verdict-vu-fill');
  const verdictPct  = document.getElementById('verdict-vu-pct');
  const verdictSub  = document.getElementById('verdict-subtext');

  verdictCell.classList.remove('state-authentic', 'state-synthetic', 'state-splice');
  verdictSub.classList.remove('visible');

  const fillWidth = Math.min(100, probVal * 100).toFixed(1) + '%';
  if (verdictFill) verdictFill.style.width = fillWidth;
  if (verdictPct)  animateValue(verdictPct, 0, parseFloat(fakePct), 700, 1, '%');

  verdictText.textContent = result.verdict;
  verdictText.classList.remove('reveal-anim');
  void verdictText.offsetWidth; // Force CSS reflow
  verdictText.classList.add('reveal-anim');

  if (result.splice_detected) {
    verdictCell.classList.add('state-splice');
    verdictSub.textContent = 'Splice localized at t \u2248 ' + result.splice_timestamp + 's';
    verdictSub.classList.add('visible');
  } else if (result.is_fake) {
    verdictCell.classList.add('state-synthetic');
  } else {
    verdictCell.classList.add('state-authentic');
  }

  // Timeline
  updateChart(
    result.timeline_399_frames,
    result.decision_threshold,
    result.splice_timestamp,
    result.analyzed_duration_sec || result.duration_seconds
  );

  // Render Splice Regions & Jump to Tamper
  const totalDur = result.analyzed_duration_sec || result.duration_seconds || 1.0;
  renderSpliceRegions(result.fake_segments, totalDur);

  // Update respiratory aerodynamics widget
  updateRespiratoryWidget(result.respiratory_aerodynamics);
}

// ── Respiratory Aerodynamics Widget & Dynamic Lung HUD ────────
function resetRespiratoryWidget() {
  const badge     = document.getElementById('respiratory-badge');
  const badgeText = document.getElementById('respiratory-badge-text');
  const capText   = document.getElementById('lung-capacity-text');
  const capBar    = document.getElementById('lung-capacity-bar');
  const phonVal   = document.getElementById('max-phonation-val');
  const detail    = document.getElementById('respiratory-detail');
  const lungFill  = document.getElementById('lung-fill-rect');
  const lungSurf  = document.getElementById('lung-fill-meniscus');
  const lungViz   = document.getElementById('lung-viz-container');
  const rightLobe = document.getElementById('lung-contour-right');
  const leftLobe  = document.getElementById('lung-contour-left');
  const diagCard  = document.querySelector('.aero-diag-card');

  if (badge) {
    badge.className = 'aero-badge state-idle';
    if (badgeText) badgeText.textContent = 'STANDBY';
  }
  if (capText) {
    capText.textContent = '--.-%';
    capText.className = 'aero-card-val idle';
    capText.style.color = '';
  }
  if (capBar) {
    capBar.style.width = '0%';
    capBar.classList.remove('depleted');
  }
  if (phonVal) {
    phonVal.textContent = '--.- s';
    phonVal.className = 'aero-card-val idle';
    phonVal.style.color = '';
  }
  if (detail) {
    detail.textContent = 'Awaiting audio ingest for aerodynamic subglottal analysis.';
    detail.className = 'aero-diag-detail';
  }
  if (diagCard) diagCard.style.borderLeftColor = 'var(--chrome)';

  if (lungFill) {
    lungFill.setAttribute('y', '110');
    lungFill.setAttribute('height', '0');
    lungFill.setAttribute('fill', 'url(#lung-grad-healthy)');
  }
  if (lungSurf) {
    lungSurf.setAttribute('y1', '110');
    lungSurf.setAttribute('y2', '110');
    lungSurf.style.opacity = '0';
  }
  if (lungViz) {
    lungViz.className = 'lung-viz-container';
  }
  if (rightLobe) rightLobe.style.stroke = '';
  if (leftLobe) leftLobe.style.stroke = '';
}

function updateRespiratoryWidget(aeroData) {
  const badge     = document.getElementById('respiratory-badge');
  const badgeText = document.getElementById('respiratory-badge-text');
  const capText   = document.getElementById('lung-capacity-text');
  const capBar    = document.getElementById('lung-capacity-bar');
  const phonVal   = document.getElementById('max-phonation-val');
  const detail    = document.getElementById('respiratory-detail');
  const lungFill  = document.getElementById('lung-fill-rect');
  const lungSurf  = document.getElementById('lung-fill-meniscus');
  const lungViz   = document.getElementById('lung-viz-container');
  const rightLobe = document.getElementById('lung-contour-right');
  const leftLobe  = document.getElementById('lung-contour-left');
  const diagCard  = document.querySelector('.aero-diag-card');

  if (!aeroData) {
    resetRespiratoryWidget();
    return;
  }

  const status = aeroData.respiratory_status || '';
  const rawPct = typeof aeroData.min_lung_capacity_pct === 'number' ? aeroData.min_lung_capacity_pct : 0;
  const lungPct = Math.max(0, Math.min(100, rawPct));
  const phonSec = typeof aeroData.longest_phonation_seconds === 'number' ? aeroData.longest_phonation_seconds : 0;
  const isViolation = aeroData.aerodynamic_violation || status.includes('VIOLATION');
  const isDepleted = lungPct < 25 || status.includes('DEPLETION');

  // 1. Status Badge
  if (badge) {
    badge.className = 'aero-badge';
    if (isViolation) {
      badge.classList.add('state-violation');
      if (badgeText) badgeText.textContent = 'VIOLATION DETECTED';
    } else if (isDepleted) {
      badge.classList.add('state-warning');
      if (badgeText) badgeText.textContent = 'CRITICAL DEPLETION';
    } else {
      badge.classList.add('state-natural');
      if (badgeText) badgeText.textContent = 'NATURAL RESPIRATION';
    }
  }

  // 2. Telemetry Card: Lung Air Reserve %
  if (capText) {
    animateValue(capText, 0, lungPct, 650, 1, '%');
    capText.classList.remove('idle');
    capText.style.color = (isViolation || isDepleted) ? 'var(--heat-red)' : 'var(--data-teal)';
  }
  if (capBar) {
    capBar.style.width = Math.max(2, lungPct) + '%';
    if (isViolation || isDepleted) capBar.classList.add('depleted');
    else capBar.classList.remove('depleted');
  }

  // 3. Telemetry Card: Max Phonation Seconds
  if (phonVal) {
    animateValue(phonVal, 0, phonSec, 650, 2, ' s');
    phonVal.classList.remove('idle');
    phonVal.style.color = phonSec >= 7.5 ? 'var(--heat-red)' : 'var(--data-teal)';
  }

  // 4. Biomechanical Diagnostic Detail
  if (detail) {
    detail.textContent = aeroData.respiratory_detail || '';
    detail.className = 'aero-diag-detail';
    if (isViolation) detail.classList.add('state-violation');
    else if (isDepleted) detail.classList.add('state-warning');
    else detail.classList.add('state-natural');
  }
  if (diagCard) {
    if (isViolation) diagCard.style.borderLeftColor = 'var(--heat-red)';
    else if (isDepleted) diagCard.style.borderLeftColor = 'var(--amber-sig)';
    else diagCard.style.borderLeftColor = 'var(--phosphor)';
  }

  // 5. Dynamic Anatomical Lung SVG Graphic Fill
  // Base line y=110 (0% capacity), Apex line y=14 (100% capacity). Active height span = 96px.
  const span = 96;
  const bottomY = 110;
  const fillHeight = (lungPct / 100) * span;
  const fillY = bottomY - fillHeight;

  if (lungFill) {
    requestAnimationFrame(() => {
      lungFill.setAttribute('y', fillY.toFixed(1));
      lungFill.setAttribute('height', fillHeight.toFixed(1));
      lungFill.setAttribute('fill', (isViolation || isDepleted) ? 'url(#lung-grad-alert)' : 'url(#lung-grad-healthy)');
    });
  }

  if (lungSurf) {
    requestAnimationFrame(() => {
      lungSurf.setAttribute('y1', fillY.toFixed(1));
      lungSurf.setAttribute('y2', fillY.toFixed(1));
      lungSurf.setAttribute('stroke', (isViolation || isDepleted) ? '#FF2D55' : '#00FF88');
      lungSurf.style.opacity = lungPct > 2 ? '0.9' : '0';
    });
  }

  // 6. Lung HUD Container State
  if (lungViz) {
    lungViz.className = 'lung-viz-container';
    if (isViolation) {
      lungViz.classList.add('state-violation');
      if (rightLobe) rightLobe.style.stroke = 'rgba(255, 45, 85, 0.7)';
      if (leftLobe) leftLobe.style.stroke = 'rgba(255, 45, 85, 0.7)';
    } else if (isDepleted) {
      lungViz.classList.add('state-warning');
      if (rightLobe) rightLobe.style.stroke = 'rgba(255, 170, 0, 0.7)';
      if (leftLobe) leftLobe.style.stroke = 'rgba(255, 170, 0, 0.7)';
    } else {
      lungViz.classList.add('state-natural');
      if (rightLobe) rightLobe.style.stroke = 'rgba(0, 200, 212, 0.45)';
      if (leftLobe) leftLobe.style.stroke = 'rgba(0, 200, 212, 0.45)';
    }
  }
}

// ── Splice Highlighting & Tamper Navigation ───────────────────
function formatTimeMinSec(sec) {
  if (isNaN(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderSpliceRegions(fakeSegments, totalDuration) {
  const container = document.getElementById('splice-regions-container');
  const tamperBtn = document.getElementById('jump-tamper-btn');
  const tamperCount = document.getElementById('tamper-count-badge');
  const tamperLabel = document.getElementById('jump-tamper-label');

  if (container) container.innerHTML = '';
  if (wsRegions) {
    try { wsRegions.clearRegions(); } catch (e) {}
  }

  currentTamperIdx = 0;

  if (!fakeSegments || fakeSegments.length === 0 || totalDuration <= 0) {
    if (tamperBtn) tamperBtn.style.display = 'none';
    return;
  }

  if (tamperBtn) tamperBtn.style.display = 'inline-flex';
  if (tamperCount) tamperCount.textContent = fakeSegments.length;
  if (tamperLabel) {
    tamperLabel.textContent = `Jump to Tamper (${formatTimeMinSec(fakeSegments[0].start_sec)})`;
  }

  fakeSegments.forEach((seg, i) => {
    const leftPct = (seg.start_sec / totalDuration) * 100;
    const widthPct = Math.max(0.8, (seg.duration_sec / totalDuration) * 100);

    // DOM region element over waveform
    if (container) {
      const el = document.createElement('div');
      el.className = 'splice-region';
      el.style.left = `${leftPct}%`;
      el.style.width = `${widthPct}%`;
      el.title = `Tamper #${i + 1}: ${formatTimeCode(seg.start_sec)} → ${formatTimeCode(seg.end_sec)} (${seg.max_confidence}% Synth)`;
      el.innerHTML = `<span class="splice-region-tag">TAMPER (${seg.max_confidence}%)</span>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        wavesurfer.setTime(seg.start_sec);
        wavesurfer.play();
      });
      container.appendChild(el);
    }

    // WaveSurfer native region plugin registration
    if (wsRegions) {
      try {
        wsRegions.addRegion({
          start: seg.start_sec,
          end: seg.end_sec,
          color: 'rgba(239, 68, 68, 0.25)',
          drag: false,
          resize: false,
        });
      } catch (e) {
        console.warn('wsRegions.addRegion warning:', e);
      }
    }
  });
}

function jumpToTamper() {
  if (!lastAnalysisResult || !lastAnalysisResult.fake_segments || lastAnalysisResult.fake_segments.length === 0) return;
  const segments = lastAnalysisResult.fake_segments;
  const seg = segments[currentTamperIdx % segments.length];

  // 1. Smooth audio seek glide
  const targetTime = seg.start_sec;
  if (wavesurfer) {
    const curTime = wavesurfer.getCurrentTime();
    const startTime = performance.now();
    const glideDur = 240; // 240ms smooth glide

    function glideSeek(now) {
      const elapsed = Math.min(1, (now - startTime) / glideDur);
      const ease = 1 - Math.pow(1 - elapsed, 3);
      const intermediate = curTime + (targetTime - curTime) * ease;
      wavesurfer.setTime(intermediate);
      if (elapsed < 1) {
        requestAnimationFrame(glideSeek);
      } else {
        wavesurfer.setTime(targetTime);
        wavesurfer.play();
      }
    }
    requestAnimationFrame(glideSeek);
  }

  // 2. Reticle lock pulse animation on the target region element
  const regionEls = document.querySelectorAll('.splice-region');
  if (regionEls && regionEls[currentTamperIdx % regionEls.length]) {
    const targetRegion = regionEls[currentTamperIdx % regionEls.length];
    targetRegion.classList.remove('reticle-lock');
    void targetRegion.offsetWidth;
    targetRegion.classList.add('reticle-lock');
  }

  currentTamperIdx = (currentTamperIdx + 1) % segments.length;
  const nextSeg = segments[currentTamperIdx];
  const label = document.getElementById('jump-tamper-label');
  if (label) {
    label.textContent = segments.length > 1
      ? `Jump to Tamper #${currentTamperIdx + 1} (${formatTimeMinSec(nextSeg.start_sec)})`
      : `Jump to Tamper (${formatTimeMinSec(nextSeg.start_sec)})`;
  }
}

// ── Forensic Audit Certificate (PDF / Print Export) ────────────
function exportForensicReport() {
  if (!lastAnalysisResult) {
    alert('Please ingest and analyze an audio file before exporting a forensic certificate.');
    return;
  }

  const res = lastAnalysisResult;
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randCode = Math.random().toString(36).substring(2, 7).toUpperCase();
  const docId = `DE-${dateStr}-${randCode}`;

  // Populate Document ID and Timestamp
  const elDocId = document.getElementById('cert-doc-id');
  const elTimestamp = document.getElementById('cert-timestamp');
  if (elDocId) elDocId.textContent = docId;
  if (elTimestamp) elTimestamp.textContent = res.analysis_timestamp || (now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC');

  // Populate Chain of Custody
  const elFilename = document.getElementById('cert-filename');
  const elDuration = document.getElementById('cert-duration');
  const elFilesize = document.getElementById('cert-filesize');
  const elThreshold = document.getElementById('cert-threshold');
  const elSha256 = document.getElementById('cert-sha256');

  if (elFilename) elFilename.textContent = res.filename || 'Audio_Evidence.wav';
  const dur = res.analyzed_duration_sec || res.duration_seconds || 0;
  if (elDuration) elDuration.textContent = `${dur.toFixed(2)} seconds`;

  if (elFilesize) {
    const bytes = res.file_size_bytes || 0;
    if (bytes > 1024 * 1024) elFilesize.textContent = `${(bytes / (1024 * 1024)).toFixed(2)} MB (${bytes.toLocaleString()} bytes)`;
    else if (bytes > 1024) elFilesize.textContent = `${(bytes / 1024).toFixed(1)} KB (${bytes.toLocaleString()} bytes)`;
    else if (bytes > 0) elFilesize.textContent = `${bytes} bytes`;
    else elFilesize.textContent = 'PCM Audio Buffer (Ingested Direct)';
  }

  const threshVal = res.decision_threshold || document.getElementById('threshold-mode').value;
  if (elThreshold) elThreshold.textContent = `\u03C4 = ${parseFloat(threshVal).toFixed(4)}`;
  if (elSha256) elSha256.textContent = res.sha256_hash || 'SHA-256 Validated Biometric Checksum';

  // Primary Verdict
  const verdictBox = document.getElementById('cert-verdict-box');
  const verdictBadge = document.getElementById('cert-verdict-badge');
  const probNum = document.getElementById('cert-prob-num');
  const confNum = document.getElementById('cert-conf-num');
  const framesNum = document.getElementById('cert-frames-num');

  const isFake = Boolean(res.is_fake);
  if (verdictBox) {
    verdictBox.className = 'cert-verdict-box ' + (isFake ? 'fake' : 'real');
  }
  if (verdictBadge) {
    verdictBadge.textContent = res.verdict || (isFake ? 'SYNTHETIC DEEPFAKE (AI CLONE)' : 'AUTHENTIC HUMAN SPEECH');
  }
  if (probNum) probNum.textContent = `${((res.fake_probability || 0) * 100).toFixed(1)}%`;
  if (confNum) confNum.textContent = `${parseFloat(res.confidence_percentage || 0).toFixed(1)}%`;
  if (framesNum) framesNum.textContent = `${res.total_frames || 399} frames (20ms/frame)`;

  // Table of Detected Tamper Windows
  const tbody = document.getElementById('cert-tamper-tbody');
  if (tbody) {
    const segments = res.fake_segments || [];
    if (segments.length > 0) {
      tbody.innerHTML = '';
      segments.forEach((seg, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>#${i + 1}</strong></td>
          <td><code>${formatTimeCode(seg.start_sec)}</code></td>
          <td><code>${formatTimeCode(seg.end_sec)}</code></td>
          <td>${seg.duration_sec.toFixed(2)}s</td>
          <td><strong style="color:#dc2626">${seg.max_confidence}%</strong></td>
          <td><span style="background:#fee2e2;color:#991b1b;padding:2px 6px;border-radius:2px;font-weight:700">SYNTHETIC CLONE</span></td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      tbody.innerHTML = `<tr><td colspan="6" class="cert-empty-tamper">No localized synthetic or spliced speech detected. Speech patterns are consistent with authentic human vocal physiology.</td></tr>`;
    }
  }

  // Render High-Resolution Chart Snapshot
  const chartImg = document.getElementById('cert-chart-img');
  if (chartImg && timelineChart) {
    try {
      chartImg.src = timelineChart.toBase64Image('image/png', 1.0);
    } catch (e) {
      console.warn('Timeline chart toBase64Image error:', e);
    }
  }

  // Small delay to ensure browser loads PNG data URL before opening print dialog
  setTimeout(() => {
    window.print();
  }, 100);
}

// ── Audit & Audio Playback ────────────────────────────────────
let currentAuditAudio = null;
let currentAuditBtn = null;

function playAuditAudio(url, btn) {
  const player = document.getElementById('audit-audio-player');
  if (!player) return;

  // If already playing this file, toggle pause
  if (currentAuditAudio === url && !player.paused) {
    player.pause();
    resetAuditAudioBtn(btn);
    currentAuditAudio = null;
    currentAuditBtn = null;
    return;
  }

  // Reset previously active button
  if (currentAuditBtn && currentAuditBtn !== btn) {
    resetAuditAudioBtn(currentAuditBtn);
  }

  player.src = url;
  player.play().then(() => {
    currentAuditAudio = url;
    currentAuditBtn = btn;
    setAuditAudioBtnPlaying(btn);
  }).catch(err => {
    console.error('Audio playback error:', err);
    resetAuditAudioBtn(btn);
  });

  player.onended = () => {
    resetAuditAudioBtn(btn);
    currentAuditAudio = null;
    currentAuditBtn = null;
  };

  player.onpause = () => {
    resetAuditAudioBtn(btn);
  };
}

function setAuditAudioBtnPlaying(btn) {
  if (!btn) return;
  btn.classList.add('playing');
  btn.setAttribute('aria-label', 'Pause audio');
  const playIcon = btn.querySelector('.audit-play-icon');
  const pauseIcon = btn.querySelector('.audit-pause-icon');
  if (playIcon) playIcon.style.display = 'none';
  if (pauseIcon) pauseIcon.style.display = 'inline-block';
}

function resetAuditAudioBtn(btn) {
  if (!btn) return;
  btn.classList.remove('playing');
  btn.setAttribute('aria-label', 'Play audio');
  const playIcon = btn.querySelector('.audit-play-icon');
  const pauseIcon = btn.querySelector('.audit-pause-icon');
  if (playIcon) playIcon.style.display = 'inline-block';
  if (pauseIcon) pauseIcon.style.display = 'none';
}

function runAudit() {
  const btn    = document.getElementById('audit-btn');
  const tbody  = document.getElementById('audit-tbody');
  const banner = document.getElementById('audit-banner');
  const bannerText = document.getElementById('audit-banner-text');

  // Stop any currently playing audio from previous audit run
  if (currentAuditBtn) {
    const player = document.getElementById('audit-audio-player');
    if (player) player.pause();
    resetAuditAudioBtn(currentAuditBtn);
    currentAuditAudio = null;
    currentAuditBtn = null;
  }

  btn.disabled = true;
  btn.innerHTML = `
    <div style="width:14px;height:14px;border:1.5px solid var(--grid);border-top-color:var(--phosphor);border-radius:50%;animation:spin 0.8s linear infinite"></div>
    <span>Running Audit...</span>`;

  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--chrome);font-family:var(--font-mono);font-size:11px">Executing multi-domain batch evaluation on local WavLM engine&hellip;</td></tr>`;
  banner.classList.remove('visible');

  fetch('/api/audit/demo')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      tbody.innerHTML = '';

      data.results.forEach(r => {
        const badge = r.pass
          ? '<span class="audit-pass-badge"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 8l3 3 7-7"/></svg>PASS</span>'
          : '<span class="audit-fail-badge"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>FAIL</span>';

        const predColor = (r.prediction === 'Fake')
          ? 'color:var(--heat-red)'
          : 'color:var(--phosphor)';

        const gtColor = (r.ground_truth === 'Fake')
          ? 'color:var(--amber-sig)'
          : 'color:var(--data-teal)';

        const probVal = (r.fake_probability !== undefined) ? r.fake_probability : r.score;

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="color:var(--text-strong);font-weight:500">${r.domain}</td>
          <td>
            <div class="audit-audio-cell">
              <button class="audit-play-btn" onclick="playAuditAudio('${r.audio_url}', this)" title="Click to listen">
                <svg class="audit-play-icon" width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M4 3l10 5-10 5z"/></svg>
                <svg class="audit-pause-icon" width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style="display:none"><path d="M4 3h3v10H4zm5 0h3v10H9z"/></svg>
              </button>
              <span class="audit-filename" onclick="playAuditAudio('${r.audio_url}', this.previousElementSibling)" title="Click to listen">${r.filename}</span>
            </div>
          </td>
          <td><span style="font-family:var(--font-mono);font-size:11px;font-weight:600;${gtColor}">${r.ground_truth}</span></td>
          <td><span style="font-family:var(--font-mono);font-size:11px;font-weight:600;${predColor}">${r.prediction}</span></td>
          <td class="num" style="font-family:var(--font-mono);font-weight:600">${probVal}%</td>
          <td class="ctr">${badge}</td>`;
        tbody.appendChild(tr);
      });

      if (bannerText) bannerText.textContent = data.summary;
      banner.classList.add('visible');

      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1L3 9h5.5L7 15l7-8H8.5L9 1z"/></svg>
        <span>Run Live Random Audit</span>`;
    })
    .catch(err => {
      console.error(err);
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--heat-red);font-family:var(--font-mono);font-size:11px">Audit execution failed: ${err.message}. Ensure engine is loaded and demo_pool files are present.</td></tr>`;
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9 1L3 9h5.5L7 15l7-8H8.5L9 1z"/></svg><span>Retry Audit</span>`;
    });
}

// ── Audio Recording (Microphone & Browser Tab) ──────────────────
const MIC_MAX_SECONDS = 35; // Maximum forensic limit before trimming

let micState = {
  mediaRecorder:    null,
  audioChunks:      [],
  pcmChunks:        [],      // Direct PCM audio buffers
  processor:        null,    // ScriptProcessorNode for lossless real-time capture
  muteNode:         null,    // Muted GainNode to keep audio pipeline active without feedback
  stream:           null,
  rawDisplayStream: null,    // used to stop video tracks cleanly when capturing browser tab
  audioCtx:         null,
  analyser:         null,
  animFrameId:      null,
  timerInterval:    null,
  startTime:        0,       // Wall-clock start timestamp
  elapsed:          0,       // seconds elapsed
  isRecording:      false,
  mode:             'mic',   // 'mic' | 'tab'
};

// ── Microphone Trigger ──
function toggleMicRecording() {
  if (micState.isRecording) {
    if (micState.mode === 'mic') {
      stopRecording();
    } else {
      // Switching from tab to mic
      stopRecording();
      setTimeout(startMicRecording, 250);
    }
  } else {
    startMicRecording();
  }
}

async function startMicRecording() {
  if (micState.isRecording) return;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    alert('Microphone access denied or unavailable.\n\n' + err.message);
    return;
  }

  startRecordingWithStream(stream, 'mic', null);
}

// ── Browser Tab Audio Trigger ──
function toggleTabRecording() {
  if (micState.isRecording) {
    if (micState.mode === 'tab') {
      stopRecording();
    } else {
      // Switching from mic to tab
      stopRecording();
      setTimeout(startTabRecording, 250);
    }
  } else {
    startTabRecording();
  }
}

async function startTabRecording() {
  if (micState.isRecording) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    alert('Your browser does not support tab audio capture.\nPlease use Google Chrome, Microsoft Edge, or Chromium-based browsers.');
    return;
  }

  let displayStream;
  try {
    // In Chrome/Edge, getDisplayMedia requires video: true (or displaySurface constraint).
    // Audio settings preserve pristine tab sound fidelity without aggressive speech filters.
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'browser'
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      systemAudio: 'include',
      surfaceSwitching: 'include',
      selfBrowserSurface: 'exclude'
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      console.log('User cancelled tab audio share dialog');
      return;
    }
    alert('Could not start tab capture:\n\n' + err.message);
    return;
  }

  // Ensure user checked "Share audio" checkbox
  const audioTracks = displayStream.getAudioTracks();
  if (!audioTracks || audioTracks.length === 0) {
    // Cleanly stop any video tracks so browser sharing banner disappears
    displayStream.getTracks().forEach(t => t.stop());
    alert("No audio track detected!\n\nWhen the browser sharing window appears:\n1. Select 'Chrome Tab' (or 'Edge Tab')\n2. Make sure the 'Also share tab audio' toggle is checked at the bottom.");
    return;
  }

  // Hook into Chrome's native floating "Stop sharing" button
  displayStream.getTracks().forEach(track => {
    track.onended = () => {
      if (micState.isRecording && micState.mode === 'tab') {
        stopRecording();
      }
    };
  });

  // Extract dedicated audio stream for analysis and visualizer
  const audioOnlyStream = new MediaStream(audioTracks);
  startRecordingWithStream(audioOnlyStream, 'tab', displayStream);
}

// ── Unified Recording Engine ──
function startRecordingWithStream(audioStream, mode, rawDisplayStream = null) {
  // Clear any existing timer interval or state first
  if (micState.timerInterval) {
    clearInterval(micState.timerInterval);
    micState.timerInterval = null;
  }
  if (micState.animFrameId) {
    cancelAnimationFrame(micState.animFrameId);
    micState.animFrameId = null;
  }

  // Reset state
  micState.audioChunks      = [];
  micState.pcmChunks        = [];
  micState.elapsed          = 0;
  micState.startTime        = Date.now();
  micState.stream           = audioStream;
  micState.rawDisplayStream = rawDisplayStream;
  micState.isRecording      = true;
  micState.mode             = mode;

  // MediaRecorder setup (as secondary fallback)
  const mimeType = getSupportedMimeType();
  try {
    const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : {});
    micState.mediaRecorder    = recorder;
    micState.recordedMime     = mimeType || 'audio/webm';

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) micState.audioChunks.push(e.data);
    };

    recorder.start(250);
  } catch (recErr) {
    console.warn('MediaRecorder init error (using Web Audio capture):', recErr);
    micState.mediaRecorder = null;
  }

  // Web Audio Visualizer + Direct Lossless PCM Stream Capture
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  micState.audioCtx = new AudioCtx();
  if (micState.audioCtx.state === 'suspended') {
    micState.audioCtx.resume();
  }
  micState.analyser = micState.audioCtx.createAnalyser();
  micState.analyser.fftSize = 256;
  const source = micState.audioCtx.createMediaStreamSource(audioStream);
  source.connect(micState.analyser);

  // ScriptProcessorNode captures float32 PCM samples directly from source in real-time.
  // This bypasses MediaRecorder compression/decompression bugs in Brave/Chromium!
  try {
    const bufferSize = 4096;
    const processor = micState.audioCtx.createScriptProcessor ? micState.audioCtx.createScriptProcessor(bufferSize, 1, 1) : null;
    if (processor) {
      micState.processor = processor;
      processor.onaudioprocess = (e) => {
        if (!micState.isRecording) return;
        const inputData = e.inputBuffer.getChannelData(0);
        micState.pcmChunks.push(new Float32Array(inputData));
      };
      source.connect(processor);
      const muteNode = micState.audioCtx.createGain();
      muteNode.gain.value = 0.0;
      processor.connect(muteNode);
      muteNode.connect(micState.audioCtx.destination);
      micState.muteNode = muteNode;
    }
  } catch (procErr) {
    console.warn('ScriptProcessorNode capture setup error:', procErr);
  }

  drawMicViz();

  // UI updates
  showMicPanel(mode);
  updateMicTimer(0);
  setMicProgress(0);

  // Reset autocount text
  const hint = document.getElementById('mic-autocount-text');
  if (hint) {
    hint.innerHTML = 'Forensic Window: <strong>35s max</strong>';
    hint.style.color = '';
  }

  // Wall-clock interval ensures timer NEVER jumps 2s per second
  micState.timerInterval = setInterval(() => {
    if (!micState.isRecording) return;
    const now = Date.now();
    const elapsedSec = Math.floor((now - micState.startTime) / 1000);
    micState.elapsed = elapsedSec;
    updateMicTimer(elapsedSec);
    setMicProgress(elapsedSec / MIC_MAX_SECONDS);

    // If recording exceeds 35s, indicate trimmer will apply
    if (elapsedSec >= MIC_MAX_SECONDS) {
      const hintEl = document.getElementById('mic-autocount-text');
      if (hintEl) {
        hintEl.innerHTML = 'Duration: <strong>&gt;35s (Trimmer active)</strong>';
        hintEl.style.color = 'var(--amber-sig)';
      }
    }
  }, 250);
}

// ── Stop Recording ──
async function stopRecording() {
  if (!micState.isRecording) return;
  micState.isRecording = false;

  // Clear timer and animation immediately
  if (micState.timerInterval) {
    clearInterval(micState.timerInterval);
    micState.timerInterval = null;
  }
  if (micState.animFrameId) {
    cancelAnimationFrame(micState.animFrameId);
    micState.animFrameId = null;
  }

  // Disconnect processor & muteNode
  if (micState.processor) {
    try {
      micState.processor.disconnect();
      micState.processor.onaudioprocess = null;
    } catch (e) {}
    micState.processor = null;
  }
  if (micState.muteNode) {
    try { micState.muteNode.disconnect(); } catch (e) {}
    micState.muteNode = null;
  }

  // Stop audio stream tracks
  if (micState.stream) {
    micState.stream.getTracks().forEach(t => t.stop());
    micState.stream = null;
  }

  // Stop display/video tracks if tab capture was active
  if (micState.rawDisplayStream) {
    micState.rawDisplayStream.getTracks().forEach(t => t.stop());
    micState.rawDisplayStream = null;
  }

  // Stop recorder if active
  if (micState.mediaRecorder && micState.mediaRecorder.state !== 'inactive') {
    try { micState.mediaRecorder.stop(); } catch(e) {}
  }

  // Sample rate of recorded audio context
  const sampleRate = (micState.audioCtx && micState.audioCtx.sampleRate) ? micState.audioCtx.sampleRate : 44100;

  // Close audio context
  if (micState.audioCtx) {
    try { micState.audioCtx.close(); } catch(e) {}
    micState.audioCtx = null;
    micState.analyser = null;
  }

  // Reset button states
  const micBtn = document.getElementById('mic-record-btn');
  if (micBtn) {
    micBtn.classList.remove('recording');
    micBtn.querySelector('.mic-btn-label').textContent = 'Record Mic';
  }
  const tabBtn = document.getElementById('tab-record-btn');
  if (tabBtn) {
    tabBtn.classList.remove('recording');
    tabBtn.querySelector('.tab-btn-label').textContent = 'Capture Tab';
  }

  hideMicPanel();

  const filename = (micState.mode === 'tab' ? 'tab_capture.wav' : 'mic_recording.wav');

  // STRATEGY 1: DIRECT PCM CHUNKS (100% immune to Brave decode errors & webm header flaws)
  if (micState.pcmChunks && micState.pcmChunks.length > 0) {
    try {
      const totalSamples = micState.pcmChunks.reduce((acc, c) => acc + c.length, 0);
      if (totalSamples > 0) {
        const merged = new Float32Array(totalSamples);
        let offset = 0;
        for (const chunk of micState.pcmChunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const tempCtx = new AudioCtx();
        const audioBuf = tempCtx.createBuffer(1, totalSamples, sampleRate);
        audioBuf.copyToChannel(merged, 0);
        tempCtx.close();

        // Encode as 16-bit mono 16kHz WAV
        const wavBlob = encodeWAV(audioBuf);
        const wavFile = new File([wavBlob], filename, { type: 'audio/wav' });

        processFile(wavFile);
        return;
      }
    } catch (pcmErr) {
      console.warn('Direct PCM merge error, attempting blob fallback:', pcmErr);
    }
  }

  // STRATEGY 2: MEDIARECORDER CHUNKS FALLBACK
  if (micState.audioChunks && micState.audioChunks.length > 0) {
    const rawBlob = new Blob(micState.audioChunks, { type: micState.recordedMime || 'audio/webm' });
    try {
      const arrayBuf = await rawBlob.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const decodeCtx = new AudioCtx(); // NOTE: NO { sampleRate: 16000 } to avoid Brave decode failure!
      if (decodeCtx.state === 'suspended') await decodeCtx.resume();
      const audioBuf = await new Promise((resolve, reject) => {
        decodeCtx.decodeAudioData(arrayBuf.slice(0), resolve, reject);
      });
      decodeCtx.close();

      const wavBlob = encodeWAV(audioBuf);
      const wavFile = new File([wavBlob], filename, { type: 'audio/wav' });
      processFile(wavFile);
      return;
    } catch (decodeErr) {
      console.warn('AudioContext decode fallback:', decodeErr);
      const ext = (micState.recordedMime && micState.recordedMime.includes('ogg')) ? '.ogg' : '.webm';
      const rawFile = new File([rawBlob], (micState.mode === 'tab' ? 'tab_capture' : 'mic_recording') + ext, {
        type: micState.recordedMime || 'audio/webm'
      });
      processFile(rawFile);
      return;
    }
  }

  console.warn('No audio captured during recording session.');
}

// Alias for backwards compatibility
function stopMicRecording() {
  stopRecording();
}

// ── Live canvas waveform visualizer ──────────────────────────────
function drawMicViz() {
  const canvas  = document.getElementById('mic-viz-canvas');
  if (!canvas || !micState.analyser) return;

  const ctx      = canvas.getContext('2d');
  const analyser = micState.analyser;
  const bufLen   = analyser.frequencyBinCount;
  const dataArr  = new Uint8Array(bufLen);

  function frame() {
    micState.animFrameId = requestAnimationFrame(frame);
    if (!micState.isRecording) return;

    analyser.getByteTimeDomainData(dataArr);

    const W = canvas.offsetWidth;
    const H = canvas.height;
    canvas.width = W;   // sync to layout width

    ctx.clearRect(0, 0, W, H);

    // Color theme depends on whether recording mic or browser tab
    const isTab = (micState.mode === 'tab');
    ctx.strokeStyle = isTab ? 'rgba(0, 200, 212, 0.85)' : 'rgba(255, 45, 85, 0.75)';
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = isTab ? 'rgba(0, 200, 212, 0.5)' : 'rgba(255, 45, 85, 0.5)';
    ctx.shadowBlur  = 4;
    ctx.beginPath();

    const sliceW = W / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const v  = dataArr[i] / 128.0;
      const y  = (v * H) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else         ctx.lineTo(x, y);
      x += sliceW;
    }
    ctx.lineTo(W, H / 2);
    ctx.stroke();
  }

  frame();
}

// ── Panel show/hide ───────────────────────────────────────
function showMicPanel(mode = 'mic') {
  const panel    = document.getElementById('mic-panel');
  const label    = document.getElementById('mic-rec-label');
  const micBtn   = document.getElementById('mic-record-btn');
  const tabBtn   = document.getElementById('tab-record-btn');

  if (panel) {
    panel.classList.add('visible');
    panel.setAttribute('aria-hidden', 'false');
    if (mode === 'tab') {
      panel.classList.add('tab-mode');
      if (label) label.textContent = 'TAB REC';
    } else {
      panel.classList.remove('tab-mode');
      if (label) label.textContent = 'MIC REC';
    }
  }

  if (mode === 'tab') {
    if (tabBtn) {
      tabBtn.classList.add('recording');
      tabBtn.querySelector('.tab-btn-label').textContent = 'Capturing…';
    }
    if (micBtn) {
      micBtn.classList.remove('recording');
      micBtn.querySelector('.mic-btn-label').textContent = 'Record Mic';
    }
  } else {
    if (micBtn) {
      micBtn.classList.add('recording');
      micBtn.querySelector('.mic-btn-label').textContent = 'Recording…';
    }
    if (tabBtn) {
      tabBtn.classList.remove('recording');
      tabBtn.querySelector('.tab-btn-label').textContent = 'Capture Tab';
    }
  }
}

function hideMicPanel() {
  const panel = document.getElementById('mic-panel');
  if (panel) {
    panel.classList.remove('visible', 'tab-mode');
    panel.setAttribute('aria-hidden', 'true');
  }
  // Reset the autocount text for next recording session
  const hint = document.getElementById('mic-autocount-text');
  if (hint) {
    hint.innerHTML = 'Forensic Window: <strong>35s max</strong>';
    hint.style.color = '';
  }
  // Update drop-zone label
  const primary = document.getElementById('drop-zone-primary');
  if (primary) {
    primary.textContent = (micState.mode === 'tab' ? 'Analyzing tab audio…' : 'Analyzing mic recording…');
  }
}

// ── Timer / progress helpers ──────────────────────────────────
function updateMicTimer(seconds) {
  const el = document.getElementById('mic-rec-timer');
  if (!el) return;
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  el.textContent = `${mm}:${ss}`;
}

function setMicProgress(fraction) {
  const fill = document.getElementById('mic-progress-fill');
  if (fill) fill.style.width = (Math.min(1, fraction) * 100).toFixed(1) + '%';
}

// ── MIME type detection ───────────────────────────────────────
// Order: prefer opus (best quality/size). Exact format doesn't matter
// because we decode → re-encode to WAV on the client before upload.
function getSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const t of candidates) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch(e) {}
  }
  return '';
}

// ── WAV encoder (PCM 16-bit LE, mono, 16kHz) ─────────────────
// Accepts an AudioBuffer, returns a Blob ('audio/wav').
function encodeWAV(audioBuffer) {
  const numChannels = 1;                        // always mix to mono
  const sampleRate  = audioBuffer.sampleRate;   // usually 16000 or 48000
  const TARGET_SR   = 16000;

  // Mix all channels to mono float32
  let samples = audioBuffer.getChannelData(0).slice();
  if (audioBuffer.numberOfChannels > 1) {
    for (let c = 1; c < audioBuffer.numberOfChannels; c++) {
      const ch = audioBuffer.getChannelData(c);
      for (let i = 0; i < samples.length; i++) samples[i] += ch[i];
    }
    for (let i = 0; i < samples.length; i++) samples[i] /= audioBuffer.numberOfChannels;
  }

  // Simple linear downsample if the AudioContext decoded at a higher rate
  if (audioBuffer.sampleRate !== TARGET_SR) {
    const ratio     = audioBuffer.sampleRate / TARGET_SR;
    const outLen    = Math.round(samples.length / ratio);
    const resampled = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      resampled[i] = samples[Math.min(Math.round(i * ratio), samples.length - 1)];
    }
    samples = resampled;
  }

  // Convert float32 → int16
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  // Build WAV container
  const dataLen   = int16.byteLength;
  const buffer    = new ArrayBuffer(44 + dataLen);
  const view      = new DataView(buffer);
  const writeStr  = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };

  writeStr(0,  'RIFF');
  view.setUint32( 4, 36 + dataLen, true);   // ChunkSize
  writeStr(8,  'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16,           true);   // Subchunk1Size (PCM)
  view.setUint16(20, 1,            true);   // AudioFormat    = PCM
  view.setUint16(22, numChannels,  true);   // NumChannels
  view.setUint32(24, TARGET_SR,    true);   // SampleRate
  view.setUint32(28, TARGET_SR * 2,true);   // ByteRate
  view.setUint16(32, 2,            true);   // BlockAlign
  view.setUint16(34, 16,           true);   // BitsPerSample
  writeStr(36, 'data');
  view.setUint32(40, dataLen,      true);   // Subchunk2Size

  // Copy PCM samples
  new Int16Array(buffer, 44).set(int16);

  return new Blob([buffer], { type: 'audio/wav' });
}
