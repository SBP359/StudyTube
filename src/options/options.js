/**
 * EDU MODE — Options Page Controller (v1.2)
 */
(function () {
  'use strict';

  const ext = typeof chrome !== 'undefined' ? chrome : browser;
  const Policy = window.EduModePolicy;

  const AVAILABLE_LANGUAGES = ['English', 'Hindi', 'Malayalam', 'Tamil', 'Telugu', 'Bengali'];

  const optLevelTitle = document.getElementById('optLevelTitle');
  const optXpValue = document.getElementById('optXpValue');
  const optStreakValue = document.getElementById('optStreakValue');
  const statusToast = document.getElementById('statusToast');

  const settingRedirectHomepage = document.getElementById('settingRedirectHomepage');
  const customHomeQueryInput = document.getElementById('customHomeQueryInput');
  const saveHomeQueryBtn = document.getElementById('saveHomeQueryBtn');

  const channelSearchInput = document.getElementById('channelSearchInput');
  const findOnYoutubeBtn = document.getElementById('findOnYoutubeBtn');
  const approveByNameBtn = document.getElementById('approveByNameBtn');

  const playlistUrlInput = document.getElementById('playlistUrlInput');
  const playlistTitleInput = document.getElementById('playlistTitleInput');
  const approvePlaylistBtn = document.getElementById('approvePlaylistBtn');
  const approvedPlaylistsCount = document.getElementById('approvedPlaylistsCount');
  const approvedPlaylistsList = document.getElementById('approvedPlaylistsList');

  const approvedChannelsCount = document.getElementById('approvedChannelsCount');
  const approvedChannelsList = document.getElementById('approvedChannelsList');

  const seedFilterInput = document.getElementById('seedFilterInput');
  const seedCandidatesList = document.getElementById('seedCandidatesList');

  const settingBasicEduAllow = document.getElementById('settingBasicEduAllow');
  const settingHideThumbnails = document.getElementById('settingHideThumbnails');
  const settingHideShorts = document.getElementById('settingHideShorts');
  const settingHideRecommendations = document.getElementById('settingHideRecommendations');
  const settingStudyTheater = document.getElementById('settingStudyTheater');
  const settingHideComments = document.getElementById('settingHideComments');
  const settingHideLiveChat = document.getElementById('settingHideLiveChat');
  const settingHideEndScreen = document.getElementById('settingHideEndScreen');

  const settingPomodoroAutoCycle = document.getElementById('settingPomodoroAutoCycle');
  const settingDesktopNotifications = document.getElementById('settingDesktopNotifications');

  const subjectCheckboxes = document.getElementById('subjectCheckboxes');
  const languageCheckboxes = document.getElementById('languageCheckboxes');

  const blockChannelInput = document.getElementById('blockChannelInput');
  const addBlockChannelBtn = document.getElementById('addBlockChannelBtn');
  const addBlockVideoBtn = document.getElementById('addBlockVideoBtn');
  const userOverridesList = document.getElementById('userOverridesList');

  const exportRulesBtn = document.getElementById('exportRulesBtn');
  const importRulesInput = document.getElementById('importRulesInput');
  const resetDefaultsBtn = document.getElementById('resetDefaultsBtn');

  let fullState = null;
  let seedChannels = [];

  function sendMessagePromise(msg) {
    return new Promise((resolve) => {
      try {
        ext.runtime.sendMessage(msg, (res) => resolve(res || null));
      } catch (_) {
        resolve(null);
      }
    });
  }

  function showToast(msg) {
    statusToast.textContent = msg;
    statusToast.classList.remove('hidden');
    setTimeout(() => statusToast.classList.add('hidden'), 2400);
  }

  async function loadAll() {
    try {
      const seedResp = await fetch(ext.runtime.getURL('seed-channels.json'));
      const seedJson = await seedResp.json();
      seedChannels = Array.isArray(seedJson.channels) ? seedJson.channels : [];
    } catch (_) {
      seedChannels = [];
    }

    const res = await sendMessagePromise({ type: 'GET_STATE' });
    if (res && res.ok && res.state) {
      fullState = res.state;
      renderAll();
    }
  }

  function renderAll() {
    if (!fullState) return;

    const lvl = fullState.levelInfo || Policy.calculateLevel(fullState.xp || 0);
    optLevelTitle.textContent = `Level ${lvl.level} (${lvl.title})`;
    optXpValue.textContent = `${lvl.xp} XP`;
    const streakDays = (fullState.streakState && fullState.streakState.streakDays) || 0;
    optStreakValue.textContent = `${streakDays}d Streak`;

    const s = fullState.settings || Policy.DEFAULT_SETTINGS;
    settingRedirectHomepage.checked = s.redirectHomepageToEduFeed !== false;
    customHomeQueryInput.value = s.customHomeQuery || Policy.DEFAULT_SETTINGS.customHomeQuery;

    settingBasicEduAllow.checked = s.basicEduKeywordAllow !== false;
    settingHideThumbnails.checked = s.hideThumbnails !== false;
    settingHideShorts.checked = s.hideShorts !== false;
    settingHideRecommendations.checked = Boolean(s.hideRecommendations);
    settingStudyTheater.checked = s.studyTheaterMode !== false;
    settingHideComments.checked = s.hideComments !== false;
    settingHideLiveChat.checked = s.hideLiveChat !== false;
    settingHideEndScreen.checked = s.hideEndScreenCards !== false;

    settingPomodoroAutoCycle.checked = Boolean(s.pomodoroAutoCycle);
    settingDesktopNotifications.checked = s.desktopNotifications !== false;

    renderSubjectsAndLanguages(s);
    renderApprovedPlaylists();
    renderApprovedChannels();
    renderSeedCandidates();
    renderUserOverrides();
  }

  function renderApprovedPlaylists() {
    const list = fullState.approvedPlaylists || fullState.playlists || [];
    approvedPlaylistsCount.textContent = String(list.length);
    approvedPlaylistsList.innerHTML = '';

    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'item-sub';
      empty.textContent = 'No individual playlists approved yet. Paste a playlist URL above or click "+ Approve Playlist Only" on YouTube.';
      approvedPlaylistsList.appendChild(empty);
      return;
    }

    list.forEach((pl) => {
      const row = document.createElement('div');
      row.className = 'list-item';

      const meta = document.createElement('div');
      meta.className = 'item-meta';
      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = pl.title || `Playlist ${pl.playlist_id}`;
      const sub = document.createElement('div');
      sub.className = 'item-sub';
      sub.textContent = `Playlist ID: ${pl.playlist_id}${pl.channel_name ? ' • ' + pl.channel_name : ''}`;
      meta.appendChild(title);
      meta.appendChild(sub);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'actions-bar';

      const openBtn = document.createElement('a');
      openBtn.href = `https://www.youtube.com/playlist?list=${encodeURIComponent(pl.playlist_id)}`;
      openBtn.target = '_blank';
      openBtn.rel = 'noopener noreferrer';
      openBtn.className = 'btn btn-secondary btn-sm';
      openBtn.textContent = 'Open Playlist ↗';
      btnGroup.appendChild(openBtn);

      const rmBtn = document.createElement('button');
      rmBtn.className = 'btn btn-secondary btn-sm';
      rmBtn.textContent = 'Remove';
      rmBtn.addEventListener('click', async () => {
        await sendMessagePromise({
          type: 'REMOVE_APPROVED_PLAYLIST',
          playlistId: pl.playlist_id
        });
        showToast('Removed playlist');
        await loadAll();
      });
      btnGroup.appendChild(rmBtn);

      row.appendChild(meta);
      row.appendChild(btnGroup);
      approvedPlaylistsList.appendChild(row);
    });
  }

  function renderSubjectsAndLanguages(settings) {
    const taxonomy =
      Array.isArray(fullState.taxonomy) && fullState.taxonomy.length > 0
        ? fullState.taxonomy
        : [
            { subject_id: 'cbse_ncert', label: 'CBSE / NCERT' },
            { subject_id: 'jee', label: 'JEE preparation' },
            { subject_id: 'programming', label: 'Programming' },
            { subject_id: 'cybersecurity', label: 'Cybersecurity' },
            { subject_id: 'ai_ml', label: 'AI / ML' },
            { subject_id: 'history_humanities', label: 'History & Humanities' },
            { subject_id: 'science_docs', label: 'Science documentaries' }
          ];

    subjectCheckboxes.innerHTML = '';
    const enabledSubj = Array.isArray(settings.enabledSubjects) ? settings.enabledSubjects : [];

    taxonomy.forEach((subj) => {
      const label = document.createElement('label');
      label.className = 'chip-toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = enabledSubj.includes(subj.subject_id);
      cb.addEventListener('change', async () => {
        const next = cb.checked
          ? [...new Set([...enabledSubj, subj.subject_id])]
          : enabledSubj.filter((x) => x !== subj.subject_id);
        await saveSettingsPatch({ enabledSubjects: next });
      });
      const span = document.createElement('span');
      span.textContent = subj.label;
      label.appendChild(cb);
      label.appendChild(span);
      subjectCheckboxes.appendChild(label);
    });

    languageCheckboxes.innerHTML = '';
    const prefLangs = Array.isArray(settings.preferredLanguages) ? settings.preferredLanguages : ['English'];

    AVAILABLE_LANGUAGES.forEach((lang) => {
      const label = document.createElement('label');
      label.className = 'chip-toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = prefLangs.includes(lang);
      cb.addEventListener('change', async () => {
        const next = cb.checked
          ? [...new Set([...prefLangs, lang])]
          : prefLangs.filter((x) => x !== lang);
        await saveSettingsPatch({ preferredLanguages: next });
      });
      const span = document.createElement('span');
      span.textContent = lang;
      label.appendChild(cb);
      label.appendChild(span);
      languageCheckboxes.appendChild(label);
    });
  }

  function renderApprovedChannels() {
    const list = fullState.userApprovedChannels || [];
    approvedChannelsCount.textContent = String(list.length);
    approvedChannelsList.innerHTML = '';

    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'item-sub';
      empty.textContent = 'No channels approved yet. Add a channel by name above.';
      approvedChannelsList.appendChild(empty);
      return;
    }

    list.forEach((ch) => {
      const row = document.createElement('div');
      row.className = 'list-item';

      const meta = document.createElement('div');
      meta.className = 'item-meta';
      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = ch.channel_name + (ch.handle ? ` (${ch.handle})` : '');
      const sub = document.createElement('div');
      sub.className = 'item-sub';
      sub.textContent = `${(ch.subjects || ['Education']).join(', ')}`;
      meta.appendChild(title);
      meta.appendChild(sub);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'actions-bar';

      if (ch.channel_url) {
        const visitBtn = document.createElement('a');
        visitBtn.href = ch.channel_url;
        visitBtn.target = '_blank';
        visitBtn.rel = 'noopener noreferrer';
        visitBtn.className = 'btn btn-secondary btn-sm';
        visitBtn.textContent = 'Open ↗';
        btnGroup.appendChild(visitBtn);
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-secondary btn-sm';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', async () => {
        await sendMessagePromise({
          type: 'REMOVE_APPROVED_CHANNEL',
          channel: ch
        });
        showToast(`Removed ${ch.channel_name}`);
        await loadAll();
      });

      btnGroup.appendChild(removeBtn);
      row.appendChild(meta);
      row.appendChild(btnGroup);
      approvedChannelsList.appendChild(row);
    });
  }

  function renderSeedCandidates() {
    const query = (seedFilterInput.value || '').trim().toLowerCase();
    seedCandidatesList.innerHTML = '';

    const filtered = seedChannels.filter((c) => {
      if (!query) return true;
      const nameMatch = (c.channel_name || '').toLowerCase().includes(query);
      const subjMatch = (c.subjects || []).join(' ').toLowerCase().includes(query);
      return nameMatch || subjMatch;
    });

    filtered.forEach((cand) => {
      const isApproved = (fullState.userApprovedChannels || []).some((ch) =>
        Policy.channelMatchesRecord(
          {
            channelId: cand.channel_id,
            channelName: cand.channel_name,
            channelHandle: cand.handle_hint
          },
          ch
        )
      );

      const card = document.createElement('div');
      card.className = 'seed-card';

      const top = document.createElement('div');
      const h4 = document.createElement('h4');
      h4.textContent = cand.channel_name;
      const tags = document.createElement('div');
      tags.className = 'seed-tags';
      tags.textContent = (cand.subjects || []).join(' • ');
      top.appendChild(h4);
      top.appendChild(tags);

      const actions = document.createElement('div');
      actions.className = 'actions-bar';

      const approveBtn = document.createElement('button');
      approveBtn.className = isApproved ? 'btn btn-secondary btn-sm' : 'btn btn-red btn-sm';
      approveBtn.textContent = isApproved ? '✓ Approved' : '+ Allow';
      approveBtn.disabled = isApproved;
      approveBtn.addEventListener('click', async () => {
        await sendMessagePromise({
          type: 'APPROVE_CHANNEL',
          channel: {
            channel_id: cand.channel_id,
            channel_name: cand.channel_name,
            handle: cand.handle_hint,
            channel_url: cand.channel_url,
            subjects: cand.subjects,
            languages: cand.languages
          }
        });
        showToast(`Approved ${cand.channel_name}`);
        await loadAll();
      });

      actions.appendChild(approveBtn);
      card.appendChild(top);
      card.appendChild(actions);
      seedCandidatesList.appendChild(card);
    });
  }

  function renderUserOverrides() {
    const overrides = fullState.userOverrides || [];
    userOverridesList.innerHTML = '';

    if (overrides.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'item-sub';
      empty.textContent = 'No custom overrides set.';
      userOverridesList.appendChild(empty);
      return;
    }

    overrides.forEach((ov) => {
      const row = document.createElement('div');
      row.className = 'list-item';

      const meta = document.createElement('div');
      meta.className = 'item-meta';
      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = `[${ov.decision}] ${ov.channel_name || ov.title || ov.entity_id}`;
      meta.appendChild(title);

      const rmBtn = document.createElement('button');
      rmBtn.className = 'btn btn-secondary btn-sm';
      rmBtn.textContent = 'Remove';
      rmBtn.addEventListener('click', async () => {
        await sendMessagePromise({
          type: 'REMOVE_USER_OVERRIDE',
          id: ov.id
        });
        showToast('Override removed');
        await loadAll();
      });

      row.appendChild(meta);
      row.appendChild(rmBtn);
      userOverridesList.appendChild(row);
    });
  }

  async function saveSettingsPatch(patch) {
    await sendMessagePromise({
      type: 'UPDATE_SETTINGS',
      settings: patch
    });
    showToast('Settings updated');
    await loadAll();
  }

  settingRedirectHomepage.addEventListener('change', () =>
    saveSettingsPatch({ redirectHomepageToEduFeed: settingRedirectHomepage.checked })
  );

  saveHomeQueryBtn.addEventListener('click', () => {
    const q = customHomeQueryInput.value.trim();
    saveSettingsPatch({
      activeQuickSubject: 'custom',
      customHomeQuery: q || Policy.DEFAULT_SETTINGS.customHomeQuery
    });
  });

  approvePlaylistBtn.addEventListener('click', async () => {
    const rawUrl = playlistUrlInput.value.trim();
    const label = playlistTitleInput.value.trim();
    const pid = Policy.extractPlaylistId(rawUrl);
    if (!pid) {
      showToast('Enter a valid YouTube playlist URL or PL... ID');
      return;
    }
    await sendMessagePromise({
      type: 'APPROVE_PLAYLIST',
      playlist: {
        playlist_id: pid,
        title: label || `Course Playlist (${pid.slice(0, 10)}...)`
      }
    });
    playlistUrlInput.value = '';
    playlistTitleInput.value = '';
    showToast('Playlist approved');
    await loadAll();
  });

  findOnYoutubeBtn.addEventListener('click', () => {
    const q = channelSearchInput.value.trim();
    if (!q) {
      showToast('Enter a channel name first');
      return;
    }
    const ytChannelSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAg%253D%253D`;
    window.open(ytChannelSearchUrl, '_blank', 'noopener');
  });

  approveByNameBtn.addEventListener('click', async () => {
    const raw = channelSearchInput.value.trim();
    if (!raw) {
      showToast('Enter a channel name to add');
      return;
    }
    await sendMessagePromise({
      type: 'APPROVE_CHANNEL',
      channel: {
        channel_name: raw,
        handle: raw.startsWith('@') ? raw : null
      }
    });
    channelSearchInput.value = '';
    showToast(`Added "${raw}"`);
    await loadAll();
  });

  seedFilterInput.addEventListener('input', renderSeedCandidates);

  settingBasicEduAllow.addEventListener('change', () =>
    saveSettingsPatch({ basicEduKeywordAllow: settingBasicEduAllow.checked })
  );
  settingHideThumbnails.addEventListener('change', () =>
    saveSettingsPatch({ hideThumbnails: settingHideThumbnails.checked })
  );
  settingHideShorts.addEventListener('change', () =>
    saveSettingsPatch({ hideShorts: settingHideShorts.checked })
  );
  settingHideRecommendations.addEventListener('change', () =>
    saveSettingsPatch({ hideRecommendations: settingHideRecommendations.checked })
  );
  settingStudyTheater.addEventListener('change', () =>
    saveSettingsPatch({ studyTheaterMode: settingStudyTheater.checked })
  );
  settingHideComments.addEventListener('change', () =>
    saveSettingsPatch({ hideComments: settingHideComments.checked })
  );
  settingHideLiveChat.addEventListener('change', () =>
    saveSettingsPatch({ hideLiveChat: settingHideLiveChat.checked })
  );
  settingHideEndScreen.addEventListener('change', () =>
    saveSettingsPatch({ hideEndScreenCards: settingHideEndScreen.checked })
  );
  settingPomodoroAutoCycle.addEventListener('change', () =>
    saveSettingsPatch({ pomodoroAutoCycle: settingPomodoroAutoCycle.checked })
  );
  settingDesktopNotifications.addEventListener('change', () =>
    saveSettingsPatch({ desktopNotifications: settingDesktopNotifications.checked })
  );

  addBlockChannelBtn.addEventListener('click', async () => {
    const val = blockChannelInput.value.trim();
    if (!val) return;
    await sendMessagePromise({
      type: 'SET_USER_OVERRIDE',
      override: {
        entity_type: 'channel',
        channel_name: val,
        entity_id: Policy.getCanonicalChannelKey(val, val),
        decision: 'BLOCK'
      }
    });
    blockChannelInput.value = '';
    showToast(`Blocked "${val}"`);
    await loadAll();
  });

  addBlockVideoBtn.addEventListener('click', async () => {
    const val = blockChannelInput.value.trim();
    if (!val) return;
    await sendMessagePromise({
      type: 'SET_USER_OVERRIDE',
      override: {
        entity_type: 'video',
        entity_id: val,
        title: `Video ${val}`,
        decision: 'BLOCK'
      }
    });
    blockChannelInput.value = '';
    showToast(`Blocked video "${val}"`);
    await loadAll();
  });

  exportRulesBtn.addEventListener('click', () => {
    if (!fullState) return;
    const exportObj = {
      exportedAt: new Date().toISOString(),
      schema_version: '1.2.0',
      settings: fullState.settings,
      userApprovedChannels: fullState.userApprovedChannels,
      approvedPlaylists: fullState.approvedPlaylists || fullState.playlists,
      userOverrides: fullState.userOverrides
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studytube-rules.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  importRulesInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await sendMessagePromise({
        type: 'IMPORT_RULES',
        payload: parsed
      });
      if (res && res.ok) {
        showToast('Imported rules');
        await loadAll();
      }
    } catch (_) {
      showToast('Invalid JSON file');
    }
  });

  resetDefaultsBtn.addEventListener('click', async () => {
    await sendMessagePromise({ type: 'RESET_TO_STRICT_DEFAULTS' });
    showToast('Reset to defaults');
    await loadAll();
  });

  loadAll();
})();
