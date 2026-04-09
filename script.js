

(function () {
  'use strict';
  const DOM = {
    stepsValue: document.getElementById('steps-value'),
    stepsProgressFill: document.getElementById('steps-progress-fill'),
    heartrateValue: document.getElementById('heartrate-value'),
    ecgLine: document.getElementById('ecg-line'),
    weightValue: document.getElementById('weight-value'),
    heightInput: document.getElementById('height-input'),
    btnCalculate: document.getElementById('btn-calculate'),
    bmiValue: document.getElementById('bmi-value'),
    bmiTag: document.getElementById('bmi-tag'),
    bmiIndicator: document.getElementById('bmi-indicator'),
    connectionStatus: document.getElementById('connection-status'),
    cardHeartrate: document.getElementById('card-heartrate'),
    // Timer
    cardTimer: document.getElementById('card-timer'),
    timerValue: document.getElementById('timer-value'),
    timerLabel: document.getElementById('timer-label'),
    timerRingProgress: document.getElementById('timer-ring-progress'),
    btnTimer: document.getElementById('btn-timer'),
    btnTimerText: document.getElementById('btn-timer-text'),
    timerPlayIcon: document.getElementById('timer-play-icon'),
    timerPauseIcon: document.getElementById('timer-pause-icon'),
    btnTimerReset: document.getElementById('btn-timer-reset'),
    // Views & Tabs
    tabTest: document.getElementById('tab-test'),
    tabList: document.getElementById('tab-list'),
    viewTest: document.getElementById('view-test'),
    viewList: document.getElementById('view-list'),
    // Finish Test
    btnFinishTest: document.getElementById('btn-finish-test'),
    // List Dashboard
    listCount: document.getElementById('list-count'),
    listEmpty: document.getElementById('list-empty'),
    resultsList: document.getElementById('results-list'),
    // Modal
    modalOverlay: document.getElementById('modal-overlay'),
    modalClose: document.getElementById('modal-close'),
    modalAvatar: document.getElementById('modal-avatar'),
    modalName: document.getElementById('modal-name'),
    modalDate: document.getElementById('modal-date'),
    modalGrid: document.getElementById('modal-grid'),
  };

  // ── State ──
  const state = {
    steps: 0,
    heartRate: 0,
    weight: 0,
    height: 0,
    bmi: null,
    dailyGoal: 1000,
    connected: false,
    ws: null,
    // Timer
    timerDuration: 180,
    timerRemaining: 180,
    timerRunning: false,
    timerFinished: false,
    timerIntervalId: null,
    // Student results (stored in-memory + localStorage)
    results: [],
    studentCounter: 0,
  };

  // ── Load persisted results ──
  function loadResults() {
    try {
      const saved = localStorage.getItem('stepsync_results');
      if (saved) {
        const parsed = JSON.parse(saved);
        state.results = parsed.results || [];
        state.studentCounter = parsed.studentCounter || state.results.length;
      }
    } catch (e) {
      console.warn('[StepSync] Could not load saved results');
    }
  }

  function saveResults() {
    try {
      localStorage.setItem('stepsync_results', JSON.stringify({
        results: state.results,
        studentCounter: state.studentCounter,
      }));
    } catch (e) {
      console.warn('[StepSync] Could not save results');
    }
  }

  // ── ECG Waveform ──
  const ECG = {
    points: [],
    width: 200,
    height: 40,
    mid: 20,
    speed: 1.5,
    frameId: null,

    beatPattern(amplitude) {
      return [
        0, 0, 0, 0,
        2, 3, 2,
        0, 0,
        -3, amplitude * 0.8, -amplitude * 0.2,
        0, 0,
        3, 5, 3,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0
      ];
    },

    init() {
      this.points = new Array(this.width).fill(this.mid);
      this.render();
      this.animate();
    },

    pushBeat() {
      const amp = 12 + Math.random() * 6;
      const pattern = this.beatPattern(amp);
      this._queue = this._queue || [];
      this._queue.push(...pattern);
    },

    animate() {
      const newY = this._queue && this._queue.length > 0
        ? this.mid - this._queue.shift()
        : this.mid + (Math.random() - 0.5) * 0.5;

      this.points.push(newY);
      if (this.points.length > this.width) {
        this.points.shift();
      }

      this.render();
      this.frameId = requestAnimationFrame(() => this.animate());
    },

    render() {
      const pts = this.points
        .map((y, x) => `${x},${y.toFixed(1)}`)
        .join(' ');
      DOM.ecgLine.setAttribute('points', pts);
    },

    stop() {
      if (this.frameId) cancelAnimationFrame(this.frameId);
    }
  };

  // ── BMI ──
  function calculateBMI(weightKg, heightCm) {
    if (weightKg <= 0 || heightCm <= 0) return null;
    const heightM = heightCm / 100;
    return weightKg / (heightM * heightM);
  }

  function getBMICategory(bmi) {
    if (bmi < 18.5) return { label: 'Underweight', className: 'underweight', color: '#60a5fa' };
    if (bmi < 25) return { label: 'Normal', className: 'normal', color: '#22c55e' };
    if (bmi < 30) return { label: 'Overweight', className: 'overweight', color: '#f59e0b' };
    return { label: 'Obese', className: 'obese', color: '#ef4444' };
  }

  function getBMIIndicatorPosition(bmi) {
    const min = 15, max = 40;
    const clamped = Math.max(min, Math.min(max, bmi));
    return ((clamped - min) / (max - min)) * 100;
  }

  // ── UI Helpers ──
  function animateValue(element, newText) {
    element.textContent = newText;
    element.classList.remove('value-updated');
    void element.offsetWidth;
    element.classList.add('value-updated');
  }

  function updateSteps(count) {
    state.steps = count;
    animateValue(DOM.stepsValue, count.toLocaleString());
    const percent = Math.min(100, Math.round((count / state.dailyGoal) * 100));
    DOM.stepsProgressFill.style.width = percent + '%';
  }

  function updateHeartRate(bpm) {
    state.heartRate = bpm;
    animateValue(DOM.heartrateValue, bpm > 0 ? bpm : '--');
    if (bpm > 0) {
      DOM.cardHeartrate.classList.add('heart-beating');
    } else {
      DOM.cardHeartrate.classList.remove('heart-beating');
    }
  }

  function updateWeight(kg) {
    state.weight = kg;
    animateValue(DOM.weightValue, kg > 0 ? kg.toFixed(1) : '--');
  }

  function updateBMI() {
    const heightCm = parseFloat(DOM.heightInput.value);
    if (isNaN(heightCm) || heightCm <= 0) {
      DOM.bmiValue.textContent = '--';
      DOM.bmiTag.textContent = 'Enter height to calculate';
      DOM.bmiTag.className = 'bmi-tag';
      DOM.bmiIndicator.style.opacity = '0';
      return;
    }

    if (state.weight <= 0) {
      DOM.bmiValue.textContent = '--';
      DOM.bmiTag.textContent = 'Waiting for weight data';
      DOM.bmiTag.className = 'bmi-tag';
      DOM.bmiIndicator.style.opacity = '0';
      return;
    }

    state.height = heightCm;
    const bmi = calculateBMI(state.weight, heightCm);
    state.bmi = bmi;
    const cat = getBMICategory(bmi);
    const pos = getBMIIndicatorPosition(bmi);

    animateValue(DOM.bmiValue, bmi.toFixed(1));
    DOM.bmiTag.textContent = cat.label;
    DOM.bmiTag.className = 'bmi-tag ' + cat.className;
    DOM.bmiIndicator.style.left = pos + '%';
    DOM.bmiIndicator.style.opacity = '1';
    DOM.bmiIndicator.style.borderColor = cat.color;
  }

  function updateConnectionStatus(connected, text) {
    state.connected = connected;
    DOM.connectionStatus.className = 'connection-status ' +
      (connected ? 'connected' : 'disconnected');
    DOM.connectionStatus.querySelector('.status-text').textContent =
      text || (connected ? 'Connected' : 'Disconnected');
  }

  // ── View Switching ──
  function showView(view) {
    if (view === 'test') {
      DOM.viewTest.classList.remove('hidden');
      DOM.viewList.classList.add('hidden');
      DOM.tabTest.classList.add('active');
      DOM.tabList.classList.remove('active');
    } else {
      DOM.viewTest.classList.add('hidden');
      DOM.viewList.classList.remove('hidden');
      DOM.tabTest.classList.remove('active');
      DOM.tabList.classList.add('active');
      renderResultsList();
    }
  }

  DOM.tabTest.addEventListener('click', function () { showView('test'); });
  DOM.tabList.addEventListener('click', function () { showView('list'); });

  // ── Timer Logic ──
  const CIRCUMFERENCE = 2 * Math.PI * 70;

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function updateTimerDisplay() {
    DOM.timerValue.textContent = formatTime(state.timerRemaining);
    const fraction = state.timerRemaining / state.timerDuration;
    const offset = CIRCUMFERENCE * (1 - fraction);
    DOM.timerRingProgress.style.strokeDasharray = CIRCUMFERENCE;
    DOM.timerRingProgress.style.strokeDashoffset = offset;
  }

  function startTimer() {
    if (state.timerFinished) return;
    state.timerRunning = true;
    DOM.cardTimer.classList.add('running');
    DOM.cardTimer.classList.remove('finished');
    DOM.timerLabel.textContent = 'IN PROGRESS';
    DOM.btnTimerText.textContent = 'Pause';
    DOM.timerPlayIcon.classList.add('hidden');
    DOM.timerPauseIcon.classList.remove('hidden');
    DOM.btnTimerReset.classList.remove('hidden');

    state.timerIntervalId = setInterval(function () {
      state.timerRemaining--;
      updateTimerDisplay();
      if (state.timerRemaining <= 0) {
        finishTimer();
      }
    }, 1000);
  }

  function pauseTimer() {
    state.timerRunning = false;
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
    DOM.cardTimer.classList.remove('running');
    DOM.timerLabel.textContent = 'PAUSED';
    DOM.btnTimerText.textContent = 'Resume';
    DOM.timerPlayIcon.classList.remove('hidden');
    DOM.timerPauseIcon.classList.add('hidden');
  }

  function finishTimer() {
    state.timerRunning = false;
    state.timerFinished = true;
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
    state.timerRemaining = 0;
    updateTimerDisplay();

    DOM.cardTimer.classList.remove('running');
    DOM.cardTimer.classList.add('finished');
    DOM.timerLabel.textContent = 'TIME\'S UP!';
    DOM.timerValue.textContent = '0:00';
    DOM.btnTimerText.textContent = 'Done';
    DOM.timerPlayIcon.classList.remove('hidden');
    DOM.timerPauseIcon.classList.add('hidden');
    DOM.btnTimer.disabled = true;
    DOM.btnTimer.style.opacity = '0.5';
    DOM.btnTimer.style.cursor = 'default';
    DOM.btnTimerReset.classList.remove('hidden');
  }

  function resetTimer() {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
    state.timerRunning = false;
    state.timerFinished = false;
    state.timerRemaining = state.timerDuration;

    DOM.cardTimer.classList.remove('running', 'finished');
    DOM.timerLabel.textContent = 'TAP TO START';
    DOM.btnTimerText.textContent = 'Start Test';
    DOM.timerPlayIcon.classList.remove('hidden');
    DOM.timerPauseIcon.classList.add('hidden');
    DOM.btnTimer.disabled = false;
    DOM.btnTimer.style.opacity = '';
    DOM.btnTimer.style.cursor = '';
    DOM.btnTimerReset.classList.add('hidden');

    updateTimerDisplay();
  }

  DOM.btnTimer.addEventListener('click', function () {
    if (state.timerFinished) return;
    if (state.timerRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  });

  DOM.btnTimerReset.addEventListener('click', function () {
    resetTimer();
  });

  // ── Finish Test & Save ──
  DOM.btnFinishTest.addEventListener('click', function () {
    // Gather current data
    const steps = state.steps;
    const heartRate = state.heartRate;
    const weight = state.weight;
    const heightCm = parseFloat(DOM.heightInput.value) || state.height;
    const bmi = (weight > 0 && heightCm > 0) ? calculateBMI(weight, heightCm) : null;
    const bmiCat = bmi ? getBMICategory(bmi) : null;
    const timerUsed = state.timerDuration - state.timerRemaining;

    // Auto-name student
    state.studentCounter++;
    const name = 'Student ' + state.studentCounter;

    const result = {
      id: Date.now(),
      name: name,
      date: new Date().toLocaleString(),
      steps: steps,
      heartRate: heartRate,
      weight: weight,
      heightCm: heightCm,
      bmi: bmi ? parseFloat(bmi.toFixed(1)) : null,
      bmiCategory: bmiCat ? bmiCat.label : '--',
      bmiClass: bmiCat ? bmiCat.className : '',
      timerUsed: timerUsed,
    };

    state.results.unshift(result);
    saveResults();

    // Reset for next student
    resetTimer();
    updateSteps(0);
    updateHeartRate(0);
    updateWeight(0);
    DOM.heightInput.value = '';
    DOM.bmiValue.textContent = '--';
    DOM.bmiTag.textContent = 'Enter height to calculate';
    DOM.bmiTag.className = 'bmi-tag';
    DOM.bmiIndicator.style.opacity = '0';
    state.height = 0;
    state.bmi = null;

    // Switch to list view
    showView('list');
  });

  // ── BMI Events ──
  DOM.btnCalculate.addEventListener('click', function () {
    updateBMI();
  });

  DOM.heightInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      updateBMI();
    }
  });

  // ── List Dashboard Rendering ──
  function renderResultsList() {
    const results = state.results;
    DOM.listCount.textContent = results.length + (results.length === 1 ? ' student' : ' students');

    if (results.length === 0) {
      DOM.listEmpty.classList.remove('hidden');
      DOM.resultsList.innerHTML = '';
      return;
    }

    DOM.listEmpty.classList.add('hidden');
    DOM.resultsList.innerHTML = results.map(function (r, i) {
      const initial = r.name.charAt(0).toUpperCase();
      const bmiDisplay = r.bmi !== null ? r.bmi.toFixed(1) : '--';
      const hrDisplay = r.heartRate > 0 ? r.heartRate : '--';
      return `
        <div class="result-card" data-index="${i}" style="animation-delay: ${i * 0.05}s">
          <div class="result-avatar">${initial}</div>
          <div class="result-info">
            <div class="result-name">${r.name}</div>
            <div class="result-date">${r.date}</div>
          </div>
          <div class="result-metrics">
            <div class="result-metric">
              <span class="result-metric-value">${r.steps}</span>
              <span class="result-metric-label">Steps</span>
            </div>
            <div class="result-metric">
              <span class="result-metric-value">${hrDisplay}</span>
              <span class="result-metric-label">BPM</span>
            </div>
            <div class="result-metric">
              <span class="result-metric-value">${bmiDisplay}</span>
              <span class="result-metric-label">BMI</span>
            </div>
          </div>
          <svg class="result-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      `;
    }).join('');

    // Add click listeners to result cards
    DOM.resultsList.querySelectorAll('.result-card').forEach(function (card) {
      card.addEventListener('click', function () {
        const idx = parseInt(card.getAttribute('data-index'));
        showDetailModal(state.results[idx]);
      });
    });
  }

  // ── Detail Modal ──
  function showDetailModal(result) {
    const initial = result.name.charAt(0).toUpperCase();
    DOM.modalAvatar.textContent = initial;
    DOM.modalName.textContent = result.name;
    DOM.modalDate.textContent = result.date;

    const bmiDisplay = result.bmi !== null ? result.bmi.toFixed(1) : '--';
    const hrDisplay = result.heartRate > 0 ? result.heartRate : '--';
    const weightDisplay = result.weight > 0 ? result.weight.toFixed(1) : '--';
    const heightDisplay = result.heightCm > 0 ? result.heightCm.toFixed(1) : '--';
    const bmiLabelClass = result.bmiClass ? 'bmi-' + result.bmiClass : '';
    const timerMin = Math.floor(result.timerUsed / 60);
    const timerSec = result.timerUsed % 60;
    const timerDisplay = timerMin + ':' + String(timerSec).padStart(2, '0');

    DOM.modalGrid.innerHTML = `
      <div class="modal-stat full-width">
        <span class="modal-stat-value">${result.steps}</span>
        <span class="modal-stat-label">Total Steps</span>
      </div>
      <div class="modal-stat">
        <span class="modal-stat-value">${hrDisplay}</span>
        <span class="modal-stat-label">Heart Rate (bpm)</span>
      </div>
      <div class="modal-stat">
        <span class="modal-stat-value">${weightDisplay} <small style="font-size:0.6em;font-weight:500;color:#9ca3af">kg</small></span>
        <span class="modal-stat-label">Weight</span>
      </div>
      <div class="modal-stat">
        <span class="modal-stat-value">${heightDisplay} <small style="font-size:0.6em;font-weight:500;color:#9ca3af">cm</small></span>
        <span class="modal-stat-label">Height</span>
      </div>
      <div class="modal-stat">
        <span class="modal-stat-value">${bmiDisplay}</span>
        <span class="modal-stat-label ${bmiLabelClass}">${result.bmiCategory}</span>
      </div>
      <div class="modal-stat full-width">
        <span class="modal-stat-value">${timerDisplay}</span>
        <span class="modal-stat-label">Time Elapsed</span>
      </div>
    `;

    DOM.modalOverlay.classList.remove('hidden');
  }

  function hideDetailModal() {
    DOM.modalOverlay.classList.add('hidden');
  }

  DOM.modalClose.addEventListener('click', hideDetailModal);
  DOM.modalOverlay.addEventListener('click', function (e) {
    if (e.target === DOM.modalOverlay) hideDetailModal();
  });

  // ── WebSocket ──
  function connectWebSocket() {
    const host = window.location.hostname || '192.168.1.100';
    const wsUrl = `ws://${host}/ws`;

    updateConnectionStatus(false, 'Connecting…');

    try {
      state.ws = new WebSocket(wsUrl);

      state.ws.onopen = function () {
        updateConnectionStatus(true, 'Connected');
      };

      state.ws.onmessage = function (event) {
        try {
          const data = JSON.parse(event.data);
          if (data.steps !== undefined) updateSteps(data.steps);
          if (data.heartRate !== undefined) updateHeartRate(data.heartRate);
          if (data.weight !== undefined) updateWeight(data.weight);
          if (state.height > 0) updateBMI();
        } catch (e) {
          console.warn('[StepSync] Invalid message:', event.data);
        }
      };

      state.ws.onerror = function () {
        updateConnectionStatus(false, 'Error');
      };

      state.ws.onclose = function () {
        updateConnectionStatus(false, 'Disconnected');
        setTimeout(connectWebSocket, 3000);
      };
    } catch (e) {
      console.warn('[StepSync] WebSocket failed:', e);
      updateConnectionStatus(false, 'Failed');
      setTimeout(connectWebSocket, 5000);
    }
  }

  // ── Simulation ──
  let simInterval = null;

  function startSimulation() {
    updateConnectionStatus(true, 'Demo Mode');
    let stepCount = 0;
    let beatTimer = 0;

    simInterval = setInterval(() => {
      stepCount += Math.floor(Math.random() * 3);
      updateSteps(stepCount);

      const hr = 72 + Math.floor(Math.random() * 20 - 10);
      updateHeartRate(hr);

      beatTimer++;
      if (beatTimer >= 2) {
        ECG.pushBeat();
        beatTimer = 0;
      }

      const w = 62.5 + Math.random() * 0.5 - 0.25;
      updateWeight(w);

      if (state.height > 0) updateBMI();
    }, 800);
  }

  function stopSimulation() {
    if (simInterval) {
      clearInterval(simInterval);
      simInterval = null;
    }
  }

  // ── Init ──
  function init() {
    ECG.init();
    updateTimerDisplay();
    loadResults();

    const isLocal = window.location.protocol === 'file:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '';

    if (isLocal) {
      startSimulation();
    } else {
      connectWebSocket();
      setTimeout(() => {
        if (!state.connected) {
          startSimulation();
        }
      }, 5000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
