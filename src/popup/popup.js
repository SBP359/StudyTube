/**
 * StudyTube — Popup Controller
 */
(function () {
  'use strict';

  const ext = typeof chrome !== 'undefined' ? chrome : browser;
  const Policy = window.EduModePolicy;

  const eduModeToggle = document.getElementById('eduModeToggle');
  const policyStatusBadge = document.getElementById('policyStatusBadge');
  const penaltyNotice = document.getElementById('penaltyNotice');
  const quickSubjectsBar = document.getElementById('quickSubjectsBar');

  const levelTitle = document.getElementById('levelTitle');
  const xpValue = document.getElementById('xpValue');
  const streakDaysCount = document.getElementById('streakDaysCount');
  const completedSprintsCount = document.getElementById('completedSprintsCount');
  const levelProgressBar = document.getElementById('levelProgressBar');
  const xpToNextText = document.getElementById('xpToNextText');

  const sprintPhaseTitle = document.getElementById('sprintPhaseTitle');
  const sprintDurationSelect = document.getElementById('sprintDurationSelect');
  const pomodoroAutoCycleToggle = document.getElementById('pomodoroAutoCycleToggle');
  const rewardPreview = document.getElementById('rewardPreview');
  const sprintSetupView = document.getElementById('sprintSetupView');
  const sprintActiveView = document.getElementById('sprintActiveView');
  const sprintCountdown = document.getElementById('sprintCountdown');
  const sprintWarningText = document.getElementById('sprintWarningText');
  const startSprintBtn = document.getElementById('startSprintBtn');
  const stopSprintBtn = document.getElementById('stopSprintBtn');

  const studyTheaterToggle = document.getElementById('studyTheaterToggle');
  const approvedCount = document.getElementById('approvedCount');
  const blockedCount = document.getElementById('blockedCount');
  const openOptionsBtn = document.getElementById('openOptionsBtn');

  let countdownInterval = null;
  let currentActiveSprint = null;

  function sendMessagePromise(msg) {
    return new Promise((resolve) => {
      try {
        ext.runtime.sendMessage(msg, (res) => resolve(res || null));
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function loadPopupState() {
    const res = await sendMessagePromise({ type: 'GET_STATE' });
    if (!res || !res.ok || !res.state) return;
    renderState(res.state);
  }

  function renderQuickSubjectPills(activeId) {
    quickSubjectsBar.innerHTML = '';
    const presets = Policy.QUICK_SUBJECT_PRESETS || [];
    presets.forEach((preset) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'subject-pill-btn' + (preset.id === (activeId || 'all') ? ' active' : '');
      btn.textContent = preset.label;
      btn.addEventListener('click', async () => {
        await sendMessagePromise({
          type: 'SELECT_QUICK_SUBJECT',
          subjectId: preset.id,
          reloadYouTubeHome: true
        });
        await loadPopupState();
      });
      quickSubjectsBar.appendChild(btn);
    });
  }

  function renderState(state) {
    const settings = state.settings || Policy.DEFAULT_SETTINGS;
    const enabled = settings.eduModeEnabled !== false;
    eduModeToggle.checked = enabled;

    if (enabled) {
      policyStatusBadge.textContent = 'Focused';
      policyStatusBadge.className = 'status-pill status-active';
    } else {
      policyStatusBadge.textContent = 'Paused';
      policyStatusBadge.className = 'status-pill status-paused';
    }

    renderQuickSubjectPills(settings.activeQuickSubject || 'all');

    const lvl = state.levelInfo || Policy.calculateLevel(state.xp || 0);
    levelTitle.textContent = `Level ${lvl.level} • ${lvl.title}`;
    xpValue.textContent = String(lvl.xp);

    const streakDays = (state.streakState && state.streakState.streakDays) || 0;
    streakDaysCount.textContent = String(streakDays);
    completedSprintsCount.textContent = String(state.completedSprints || 0);
    levelProgressBar.style.width = `${lvl.progressPercent}%`;
    xpToNextText.textContent = `${lvl.xpToNextLevel} XP to Level ${lvl.level + 1}`;

    pomodoroAutoCycleToggle.checked = Boolean(settings.pomodoroAutoCycle);
    studyTheaterToggle.checked = settings.studyTheaterMode !== false;

    approvedCount.textContent = String((state.sessionStats && state.sessionStats.approvedCount) || 0);
    blockedCount.textContent = String((state.sessionStats && state.sessionStats.blockedCount) || 0);

    currentActiveSprint = state.activeSprint || null;
    updateSprintUI();
  }

  function updateSprintUI() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    if (currentActiveSprint && currentActiveSprint.endTime > Date.now()) {
      sprintSetupView.classList.add('hidden');
      sprintActiveView.classList.remove('hidden');

      const isBreak = currentActiveSprint.phase === 'break';
      if (isBreak) {
        sprintPhaseTitle.textContent = 'Pomodoro Break';
        rewardPreview.textContent = 'Rest Phase';
        sprintWarningText.innerHTML = 'Take a short breather before your next cycle.';
        stopSprintBtn.textContent = 'End Break';
      } else {
        const cyc = currentActiveSprint.autoCycle ? ` (Cycle #${currentActiveSprint.cycleCount || 1})` : '';
        sprintPhaseTitle.textContent = `Study Sprint${cyc}`;
        rewardPreview.textContent = `+${currentActiveSprint.rewardXp} XP`;
        sprintWarningText.innerHTML = 'Stopping early deducts <strong>10 XP</strong>';
        stopSprintBtn.textContent = 'End Sprint Early (-10 XP)';
      }

      const tick = () => {
        const remainingMs = Math.max(0, currentActiveSprint.endTime - Date.now());
        const totalSecs = Math.ceil(remainingMs / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        sprintCountdown.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        if (remainingMs <= 0) {
          clearInterval(countdownInterval);
          setTimeout(loadPopupState, 400);
        }
      };
      tick();
      countdownInterval = setInterval(tick, 1000);
    } else {
      sprintPhaseTitle.textContent = 'Study Sprint';
      sprintSetupView.classList.remove('hidden');
      sprintActiveView.classList.add('hidden');
      updateRewardPreview();
    }
  }

  function updateRewardPreview() {
    const mins = Number(sprintDurationSelect.value) || 25;
    const reward = Policy.calculateSprintReward(mins);
    rewardPreview.textContent = `+${reward} XP`;
  }

  sprintDurationSelect.addEventListener('change', updateRewardPreview);

  pomodoroAutoCycleToggle.addEventListener('change', async () => {
    await sendMessagePromise({
      type: 'UPDATE_SETTINGS',
      settings: { pomodoroAutoCycle: pomodoroAutoCycleToggle.checked }
    });
  });

  studyTheaterToggle.addEventListener('change', async () => {
    await sendMessagePromise({
      type: 'UPDATE_SETTINGS',
      settings: { studyTheaterMode: studyTheaterToggle.checked }
    });
  });

  eduModeToggle.addEventListener('change', async () => {
    const enabled = eduModeToggle.checked;
    const res = await sendMessagePromise({
      type: 'TOGGLE_EDU_MODE',
      enabled
    });
    if (res && res.penaltyApplied > 0) {
      penaltyNotice.innerHTML = `<i class="fa-inline">!</i> Paused StudyTube: <strong>-${res.penaltyApplied} XP deducted</strong>.`;
    } else {
      penaltyNotice.innerHTML = `<i class="fa-inline">✓</i> StudyTube active. Off-topic thumbnails blurred.`;
    }
    await loadPopupState();
  });

  startSprintBtn.addEventListener('click', async () => {
    const durationMinutes = Number(sprintDurationSelect.value) || 25;
    await sendMessagePromise({
      type: 'START_SPRINT',
      durationMinutes,
      autoCycle: pomodoroAutoCycleToggle.checked
    });
    await loadPopupState();
  });

  stopSprintBtn.addEventListener('click', async () => {
    await sendMessagePromise({
      type: 'STOP_SPRINT_EARLY'
    });
    await loadPopupState();
  });

  openOptionsBtn.addEventListener('click', () => {
    if (ext.runtime.openOptionsPage) {
      ext.runtime.openOptionsPage();
    } else {
      window.open(ext.runtime.getURL('src/options/options.html'));
    }
  });

  loadPopupState();
})();
