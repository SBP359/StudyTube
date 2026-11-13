/**
 * EDU MODE — Chrome & Firefox Compatible Background Service Worker (v1.2)
 * Handles:
 * 1. Quick Subject Switcher state & instant YouTube tab homepage reload
 * 2. Clean Watch Page ("Study Theater") settings sync
 * 3. Playlist-Only Approval (`APPROVE_PLAYLIST` / `REMOVE_APPROVED_PLAYLIST`)
 * 4. Daily Study Streak & Bonus XP tracking (`streakState`)
 * 5. Pomodoro Auto-Cycles (25m Focus -> 5m Break -> Next Focus) + Desktop Notifications
 */
if (typeof importScripts === 'function') {
  try {
    importScripts('shared/policy.js', 'shared/db.js');
  } catch (e) {
    console.warn('[StudyTube] importScripts fallback:', e);
  }
}

(function () {
  'use strict';

  const ext = typeof chrome !== 'undefined' ? chrome : browser;
  const Policy = self.EduModePolicy;
  const DB = self.EduModeDB;

  const SPRINT_ALARM_NAME = 'edu_mode_focus_sprint_complete';

  const INITIAL_APPROVED_CHANNELS = [
    {
      channel_id: 'name:ncert official',
      channel_name: 'NCERT Official',
      handle: '@NCERTOFFICIAL',
      channel_url: 'https://www.youtube.com/@NCERTOFFICIAL',
      subjects: ['CBSE / NCERT'],
      languages: ['English', 'Hindi'],
      trust_level: 'verified',
      approval_status: 'approved',
      default_decision: 'ALLOW',
      allowed_video_policy: 'all_uploads'
    },
    {
      channel_id: 'name:physics wallah',
      channel_name: 'Physics Wallah',
      handle: '@PhysicsWallah',
      channel_url: 'https://www.youtube.com/@PhysicsWallah',
      subjects: ['JEE preparation', 'CBSE / NCERT'],
      languages: ['Hindi', 'English'],
      trust_level: 'verified',
      approval_status: 'approved',
      default_decision: 'ALLOW',
      allowed_video_policy: 'all_uploads'
    },
    {
      channel_id: 'name:jee wallah',
      channel_name: 'JEE Wallah',
      handle: '@PW-JEEWallah',
      channel_url: 'https://www.youtube.com/@PW-JEEWallah',
      subjects: ['JEE preparation'],
      languages: ['Hindi', 'English'],
      trust_level: 'verified',
      approval_status: 'approved',
      default_decision: 'ALLOW',
      allowed_video_policy: 'all_uploads'
    },
    {
      channel_id: 'name:3blue1brown',
      channel_name: '3Blue1Brown',
      handle: '@3blue1brown',
      channel_url: 'https://www.youtube.com/@3blue1brown',
      subjects: ['JEE preparation', 'AI / ML'],
      languages: ['English'],
      trust_level: 'verified',
      approval_status: 'approved',
      default_decision: 'ALLOW',
      allowed_video_policy: 'all_uploads'
    },
    {
      channel_id: 'name:khan academy',
      channel_name: 'Khan Academy',
      handle: '@khanacademy',
      channel_url: 'https://www.youtube.com/@khanacademy',
      subjects: ['CBSE / NCERT', 'JEE preparation'],
      languages: ['English', 'Hindi'],
      trust_level: 'verified',
      approval_status: 'approved',
      default_decision: 'ALLOW',
      allowed_video_policy: 'all_uploads'
    },
    {
      channel_id: 'name:freecodecamp.org',
      channel_name: 'freeCodeCamp.org',
      handle: '@freecodecamp',
      channel_url: 'https://www.youtube.com/@freecodecamp',
      subjects: ['Programming', 'AI / ML'],
      languages: ['English'],
      trust_level: 'verified',
      approval_status: 'approved',
      default_decision: 'ALLOW',
      allowed_video_policy: 'all_uploads'
    }
  ];

  const DEFAULT_STATE = {
    settings: Object.assign({}, Policy.DEFAULT_SETTINGS),
    xp: 0,
    completedSprints: 0,
    streakState: {
      streakDays: 0,
      longestStreak: 0,
      lastStudyDate: null
    },
    activeSprint: null, // { phase: 'focus'|'break', durationMinutes, startTime, endTime, rewardXp, autoCycle, cycleCount }
    sessionStats: {
      approvedCount: 0,
      blockedCount: 0
    },
    userApprovedChannels: INITIAL_APPROVED_CHANNELS,
    userOverrides: [],
    approvedVideos: [],
    approvedPlaylists: [],
    reviewCandidates: [],
    lastSyncTimestamp: null
  };

  function storageGet(keys) {
    return new Promise((resolve) => {
      ext.storage.local.get(keys, (res) => resolve(res || {}));
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      ext.storage.local.set(obj, () => resolve());
    });
  }

  function notifyUser(title, message) {
    if (!ext.notifications || typeof ext.notifications.create !== 'function') return;
    try {
      ext.notifications.create({
        type: 'basic',
        iconUrl: ext.runtime.getURL('icons/icon128.png'),
        title,
        message
      });
    } catch (_) {}
  }

  async function getLocalState() {
    const raw = await storageGet(null);
    return {
      settings: Object.assign({}, DEFAULT_STATE.settings, raw.settings || {}),
      xp: typeof raw.xp === 'number' ? raw.xp : DEFAULT_STATE.xp,
      completedSprints: typeof raw.completedSprints === 'number' ? raw.completedSprints : 0,
      streakState: Object.assign({}, DEFAULT_STATE.streakState, raw.streakState || {}),
      activeSprint: raw.activeSprint || null,
      sessionStats: Object.assign({}, DEFAULT_STATE.sessionStats, raw.sessionStats || {}),
      userApprovedChannels: Array.isArray(raw.userApprovedChannels)
        ? raw.userApprovedChannels
        : INITIAL_APPROVED_CHANNELS,
      userOverrides: Array.isArray(raw.userOverrides) ? raw.userOverrides : [],
      approvedVideos: Array.isArray(raw.approvedVideos) ? raw.approvedVideos : [],
      approvedPlaylists: Array.isArray(raw.approvedPlaylists) ? raw.approvedPlaylists : [],
      reviewCandidates: Array.isArray(raw.reviewCandidates) ? raw.reviewCandidates : [],
      lastSyncTimestamp: raw.lastSyncTimestamp || null
    };
  }

  async function saveLocalState(partial) {
    await storageSet(partial);
    await broadcastPolicyUpdate();
  }

  async function loadBundledSeedAndTaxonomy() {
    try {
      const [seedResp, taxResp] = await Promise.all([
        fetch(ext.runtime.getURL('seed-channels.json')),
        fetch(ext.runtime.getURL('taxonomy.json'))
      ]);
      const seedData = await seedResp.json();
      const taxData = await taxResp.json();

      if (DB) {
        const validation = Policy.validateDatabaseSnapshot(seedData);
        if (validation.valid) {
          await DB.applySnapshotTransactionally(seedData, Policy.validateDatabaseSnapshot);
        }
        if (taxData && Array.isArray(taxData.subjects)) {
          for (const subj of taxData.subjects) {
            await DB.putInStore(DB.STORES.TAXONOMY, subj);
          }
        }
      }

      const nowIso = new Date().toISOString();
      await storageSet({
        lastSyncTimestamp: nowIso,
        taxonomySubjects: taxData.subjects || [],
        seedCandidateChannels: seedData.channels || []
      });
    } catch (err) {
      console.warn('[StudyTube] Bundled seed load warning:', err);
    }
  }

  async function broadcastPolicyUpdate() {
    try {
      ext.tabs.query(
        { url: ['*://www.youtube.com/*', '*://youtube.com/*', '*://m.youtube.com/*'] },
        async (tabs) => {
          if (!tabs || !tabs.length) return;
          const fullState = await buildEvaluationState();
          for (const tab of tabs) {
            if (tab.id) {
              try {
                ext.tabs.sendMessage(tab.id, {
                  type: 'EDU_MODE_STATE_UPDATED',
                  payload: fullState
                });
              } catch (_) {}
            }
          }
        }
      );
    } catch (_) {}
  }

  async function buildEvaluationState() {
    const local = await getLocalState();
    let dbChannels = [];
    let dbVideos = [];
    let dbPlaylists = [];
    let dbOverrides = [];
    let taxonomy = [];

    if (DB) {
      try {
        [dbChannels, dbVideos, dbPlaylists, dbOverrides, taxonomy] = await Promise.all([
          DB.getAllFromStore(DB.STORES.CHANNELS),
          DB.getAllFromStore(DB.STORES.VIDEOS),
          DB.getAllFromStore(DB.STORES.PLAYLISTS),
          DB.getAllFromStore(DB.STORES.USER_OVERRIDES),
          DB.getAllFromStore(DB.STORES.TAXONOMY)
        ]);
      } catch (_) {}
    }

    const mergedOverridesMap = new Map();
    for (const ov of [...dbOverrides, ...local.userOverrides]) {
      if (ov && ov.id) mergedOverridesMap.set(ov.id, ov);
    }

    const mergedPlaylistsMap = new Map();
    for (const pl of [...dbPlaylists, ...local.approvedPlaylists]) {
      if (pl && pl.playlist_id) mergedPlaylistsMap.set(pl.playlist_id, pl);
    }

    const levelInfo = Policy.calculateLevel(local.xp);

    return {
      settings: local.settings,
      xp: local.xp,
      levelInfo,
      completedSprints: local.completedSprints,
      streakState: local.streakState,
      activeSprint: local.activeSprint,
      sessionStats: local.sessionStats,
      userApprovedChannels: local.userApprovedChannels,
      userOverrides: Array.from(mergedOverridesMap.values()),
      channels: dbChannels,
      videos: [...dbVideos, ...local.approvedVideos],
      playlists: Array.from(mergedPlaylistsMap.values()),
      approvedPlaylists: Array.from(mergedPlaylistsMap.values()),
      reviewCandidates: local.reviewCandidates,
      taxonomy,
      lastSyncTimestamp: local.lastSyncTimestamp
    };
  }

  ext.runtime.onInstalled.addListener(async () => {
    const existing = await storageGet('settings');
    if (!existing || !existing.settings) {
      await storageSet(DEFAULT_STATE);
    }
    await loadBundledSeedAndTaxonomy();
  });

  // Feature 4 & Feature 5: Focus Sprint + Daily Streak Bonus + Pomodoro Auto-Cycle Alarm Handler
  ext.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm || alarm.name !== SPRINT_ALARM_NAME) return;
    const state = await getLocalState();
    const sprint = state.activeSprint;
    if (!sprint) return;

    const autoCycle = Boolean(sprint.autoCycle || (state.settings && state.settings.pomodoroAutoCycle));
    const breakMins = Math.max(1, Number((state.settings && state.settings.pomodoroBreakMinutes) || 5));

    if (sprint.phase === 'break') {
      // Break finished -> If autoCycle is enabled, automatically start next Focus Sprint
      if (autoCycle) {
        const focusMins = sprint.focusDurationMinutes || 25;
        const now = Date.now();
        const endTime = now + focusMins * 60 * 1000;
        const rewardXp = Policy.calculateSprintReward(focusMins);
        const nextSprint = {
          phase: 'focus',
          durationMinutes: focusMins,
          focusDurationMinutes: focusMins,
          startTime: now,
          endTime,
          rewardXp,
          autoCycle: true,
          cycleCount: (sprint.cycleCount || 1) + 1
        };
        await ext.alarms.create(SPRINT_ALARM_NAME, { when: endTime });
        await saveLocalState({ activeSprint: nextSprint });
        if (state.settings.desktopNotifications !== false) {
          notifyUser('Break Complete — Back to Study!', `Starting Pomodoro Cycle #${nextSprint.cycleCount} (${focusMins} mins).`);
        }
      } else {
        await saveLocalState({ activeSprint: null });
        if (state.settings.desktopNotifications !== false) {
          notifyUser('Break Finished', 'Ready for your next study session!');
        }
      }
      return;
    }

    // Focus phase completed! Award sprint XP + Daily Streak Bonus XP
    const sprintReward = Policy.calculateSprintReward(sprint.durationMinutes);
    const streakUpdate = Policy.updateDailyStreak(state.streakState);
    const totalEarnedXp = sprintReward + streakUpdate.streakBonusXp;
    const nextXp = Policy.applyXpChange(state.xp, totalEarnedXp);

    let nextActiveSprint = null;
    if (autoCycle) {
      const now = Date.now();
      const breakEnd = now + breakMins * 60 * 1000;
      nextActiveSprint = {
        phase: 'break',
        durationMinutes: breakMins,
        focusDurationMinutes: sprint.durationMinutes,
        startTime: now,
        endTime: breakEnd,
        rewardXp: 0,
        autoCycle: true,
        cycleCount: sprint.cycleCount || 1
      };
      await ext.alarms.create(SPRINT_ALARM_NAME, { when: breakEnd });
    }

    await saveLocalState({
      xp: nextXp,
      completedSprints: (state.completedSprints || 0) + 1,
      streakState: {
        streakDays: streakUpdate.streakDays,
        longestStreak: streakUpdate.longestStreak,
        lastStudyDate: streakUpdate.lastStudyDate
      },
      activeSprint: nextActiveSprint
    });

    if (state.settings.desktopNotifications !== false) {
      const bonusMsg =
        streakUpdate.streakBonusXp > 0
          ? ` (+${streakUpdate.streakBonusXp} XP ${streakUpdate.streakDays}-day streak bonus!)`
          : '';
      const nextMsg = nextActiveSprint ? ` Starting ${breakMins}m Pomodoro break.` : '';
      notifyUser('StudyTube Sprint Complete!', `Earned +${sprintReward} XP${bonusMsg}.${nextMsg}`);
    }
  });

  ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true;
  });

  async function handleMessage(message) {
    if (!message || !message.type) {
      return { ok: false, error: 'Missing message type' };
    }

    switch (message.type) {
      case 'GET_STATE': {
        const evalState = await buildEvaluationState();
        return { ok: true, state: evalState };
      }

      case 'TOGGLE_EDU_MODE': {
        const local = await getLocalState();
        const nextEnabled = Boolean(message.enabled);
        let nextXp = local.xp;
        let penaltyApplied = 0;

        if (local.settings.eduModeEnabled === true && nextEnabled === false) {
          penaltyApplied = Policy.GAMIFICATION_CONSTANTS.PAUSE_MODE_PENALTY_XP;
          nextXp = Policy.applyXpChange(local.xp, -penaltyApplied);
        }

        const updatedSettings = Object.assign({}, local.settings, { eduModeEnabled: nextEnabled });
        await saveLocalState({
          settings: updatedSettings,
          xp: nextXp
        });

        return {
          ok: true,
          eduModeEnabled: nextEnabled,
          xp: nextXp,
          penaltyApplied,
          levelInfo: Policy.calculateLevel(nextXp)
        };
      }

      case 'UPDATE_SETTINGS': {
        const local = await getLocalState();
        const updatedSettings = Object.assign({}, local.settings, message.settings || {});
        await saveLocalState({ settings: updatedSettings });
        return { ok: true, settings: updatedSettings };
      }

      // Feature 1: Quick Subject Switcher handler (updates subject & redirects active YouTube homepage tab)
      case 'SELECT_QUICK_SUBJECT': {
        const local = await getLocalState();
        const subjectId = message.subjectId || 'all';
        const preset =
          Policy.QUICK_SUBJECT_PRESETS.find((p) => p.id === subjectId) ||
          Policy.QUICK_SUBJECT_PRESETS[0];

        const updatedSettings = Object.assign({}, local.settings, {
          activeQuickSubject: preset.id,
          customHomeQuery: preset.query
        });

        await saveLocalState({ settings: updatedSettings });

        if (message.reloadYouTubeHome) {
          try {
            ext.tabs.query(
              { url: ['*://www.youtube.com/*', '*://youtube.com/*'] },
              (tabs) => {
                if (!tabs || !tabs.length) return;
                const targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(preset.query)}&edu_home=1`;
                for (const tab of tabs) {
                  if (tab.active && tab.id) {
                    ext.tabs.update(tab.id, { url: targetUrl });
                    return;
                  }
                }
                if (tabs[0] && tabs[0].id) {
                  ext.tabs.update(tabs[0].id, { url: targetUrl });
                }
              }
            );
          } catch (_) {}
        }

        return { ok: true, settings: updatedSettings, preset };
      }

      case 'START_SPRINT': {
        const local = await getLocalState();
        const durationMinutes = Math.max(1, Math.min(180, Number(message.durationMinutes) || 25));
        const autoCycle =
          typeof message.autoCycle === 'boolean'
            ? message.autoCycle
            : Boolean(local.settings.pomodoroAutoCycle);
        const now = Date.now();
        const endTime = now + durationMinutes * 60 * 1000;
        const rewardXp = Policy.calculateSprintReward(durationMinutes);

        const activeSprint = {
          phase: 'focus',
          durationMinutes,
          focusDurationMinutes: durationMinutes,
          startTime: now,
          endTime,
          rewardXp,
          autoCycle,
          cycleCount: 1
        };

        const updatedSettings = Object.assign({}, local.settings, { pomodoroAutoCycle: autoCycle });
        await ext.alarms.clear(SPRINT_ALARM_NAME);
        await ext.alarms.create(SPRINT_ALARM_NAME, { when: endTime });
        await saveLocalState({ activeSprint, settings: updatedSettings });

        return { ok: true, activeSprint };
      }

      case 'STOP_SPRINT_EARLY': {
        const local = await getLocalState();
        await ext.alarms.clear(SPRINT_ALARM_NAME);

        let nextXp = local.xp;
        let penaltyApplied = 0;
        // Only deduct penalty if stopping an active focus phase (not during break)
        if (local.activeSprint && local.activeSprint.phase !== 'break') {
          penaltyApplied = Policy.GAMIFICATION_CONSTANTS.EARLY_STOP_PENALTY_XP;
          nextXp = Policy.applyXpChange(local.xp, -penaltyApplied);
        }

        await saveLocalState({
          xp: nextXp,
          activeSprint: null
        });

        return {
          ok: true,
          xp: nextXp,
          penaltyApplied,
          levelInfo: Policy.calculateLevel(nextXp)
        };
      }

      // Feature 3: Approve Playlist by URL or ID
      case 'APPROVE_PLAYLIST': {
        const local = await getLocalState();
        const plInput = message.playlist || {};
        const playlistId = Policy.extractPlaylistId(plInput.playlist_id || plInput.url || '');
        if (!playlistId) {
          return { ok: false, error: 'Valid YouTube playlist URL or ID (e.g., PL...) is required.' };
        }

        const newPlaylist = {
          playlist_id: playlistId,
          channel_id: plInput.channel_id || null,
          channel_name: plInput.channel_name || null,
          title: String(plInput.title || `Approved Playlist (${playlistId.slice(0, 10)}...)`).trim(),
          subjects: Array.isArray(plInput.subjects) ? plInput.subjects : ['Course Playlist'],
          approval_status: 'approved',
          created_at: new Date().toISOString()
        };

        const filtered = local.approvedPlaylists.filter((p) => p.playlist_id !== playlistId);
        filtered.unshift(newPlaylist);

        if (DB) {
          await DB.putInStore(DB.STORES.PLAYLISTS, newPlaylist);
        }

        await saveLocalState({ approvedPlaylists: filtered });
        return { ok: true, playlist: newPlaylist, approvedPlaylists: filtered };
      }

      case 'REMOVE_APPROVED_PLAYLIST': {
        const local = await getLocalState();
        const playlistId = message.playlistId;
        const filtered = local.approvedPlaylists.filter((p) => p.playlist_id !== playlistId);
        if (DB && playlistId) {
          await DB.deleteFromStore(DB.STORES.PLAYLISTS, playlistId);
        }
        await saveLocalState({ approvedPlaylists: filtered });
        return { ok: true, approvedPlaylists: filtered };
      }

      case 'APPROVE_CHANNEL': {
        const local = await getLocalState();
        const chInput = message.channel || {};
        const channelName = String(chInput.channel_name || chInput.channelName || '').trim();
        const handle = String(chInput.handle || chInput.channelHandle || '').trim() || null;
        const rawId = String(chInput.channel_id || chInput.channelId || '').trim();
        const canonicalId = Policy.getCanonicalChannelKey(
          { channel_id: rawId, channel_name: channelName, handle },
          channelName
        );

        if (!canonicalId && !channelName) {
          return { ok: false, error: 'Channel name or ID is required.' };
        }

        const newChannel = {
          channel_id: canonicalId,
          channel_name: channelName || canonicalId,
          handle: handle,
          channel_url:
            chInput.channel_url ||
            (handle
              ? `https://www.youtube.com/${handle.startsWith('@') ? handle : '@' + handle}`
              : `https://www.youtube.com/results?search_query=${encodeURIComponent(channelName)}&sp=EgIQAg%253D%253D`),
          subjects: Array.isArray(chInput.subjects) ? chInput.subjects : ['General Education'],
          languages: Array.isArray(chInput.languages) ? chInput.languages : ['English'],
          trust_level: 'verified',
          approval_status: 'approved',
          default_decision: Policy.DECISIONS.ALLOW,
          allowed_video_policy: chInput.allowed_video_policy || 'all_uploads',
          last_verified_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const filteredOverrides = local.userOverrides.filter(
          (ov) => !(ov.entity_type === 'channel' && Policy.channelMatchesRecord(newChannel, ov))
        );

        const filteredApproved = local.userApprovedChannels.filter(
          (existing) => !Policy.channelMatchesRecord(newChannel, existing)
        );
        filteredApproved.unshift(newChannel);

        if (DB) {
          await DB.putInStore(DB.STORES.CHANNELS, newChannel);
        }

        await saveLocalState({
          userApprovedChannels: filteredApproved,
          userOverrides: filteredOverrides
        });

        return { ok: true, channel: newChannel, userApprovedChannels: filteredApproved };
      }

      case 'REMOVE_APPROVED_CHANNEL': {
        const local = await getLocalState();
        const target = message.channel || {
          channel_id: message.channelId,
          channel_name: message.channelName
        };

        const nextApproved = local.userApprovedChannels.filter(
          (ch) => !Policy.channelMatchesRecord(target, ch)
        );

        if (DB && target.channel_id) {
          await DB.deleteFromStore(DB.STORES.CHANNELS, target.channel_id);
        }

        await saveLocalState({ userApprovedChannels: nextApproved });
        return { ok: true, userApprovedChannels: nextApproved };
      }

      case 'SET_USER_OVERRIDE': {
        const local = await getLocalState();
        const ov = message.override || {};
        const entityType = ov.entity_type || 'channel';
        const decision = ov.decision === Policy.DECISIONS.ALLOW ? Policy.DECISIONS.ALLOW : Policy.DECISIONS.BLOCK;
        const entityId =
          ov.entity_id ||
          Policy.getCanonicalChannelKey(ov, ov.channel_name) ||
          `id:${Date.now()}`;

        const record = {
          id: `${entityType}:${entityId}`,
          entity_type: entityType,
          entity_id: entityId,
          channel_name: ov.channel_name || null,
          handle: ov.handle || null,
          title: ov.title || null,
          decision,
          created_at: new Date().toISOString()
        };

        const filtered = local.userOverrides.filter((item) => item.id !== record.id);
        filtered.unshift(record);

        if (DB) {
          await DB.putInStore(DB.STORES.USER_OVERRIDES, record);
        }

        await saveLocalState({ userOverrides: filtered });
        return { ok: true, override: record, userOverrides: filtered };
      }

      case 'REMOVE_USER_OVERRIDE': {
        const local = await getLocalState();
        const id = message.id;
        const filtered = local.userOverrides.filter((item) => item.id !== id);
        if (DB && id) {
          await DB.deleteFromStore(DB.STORES.USER_OVERRIDES, id);
        }
        await saveLocalState({ userOverrides: filtered });
        return { ok: true, userOverrides: filtered };
      }

      case 'RECORD_SESSION_COUNTS': {
        const local = await getLocalState();
        const approvedDelta = Math.max(0, Number(message.approvedDelta) || 0);
        const blockedDelta = Math.max(0, Number(message.blockedDelta) || 0);
        const sessionStats = {
          approvedCount: (local.sessionStats.approvedCount || 0) + approvedDelta,
          blockedCount: (local.sessionStats.blockedCount || 0) + blockedDelta
        };
        await storageSet({ sessionStats });
        return { ok: true, sessionStats };
      }

      case 'IMPORT_RULES': {
        const payload = message.payload || {};
        if (!payload || typeof payload !== 'object') {
          return { ok: false, error: 'Invalid import JSON payload.' };
        }
        const local = await getLocalState();
        const nextApproved = Array.isArray(payload.userApprovedChannels)
          ? payload.userApprovedChannels
          : local.userApprovedChannels;
        const nextPlaylists = Array.isArray(payload.approvedPlaylists)
          ? payload.approvedPlaylists
          : local.approvedPlaylists;
        const nextOverrides = Array.isArray(payload.userOverrides)
          ? payload.userOverrides
          : local.userOverrides;
        const nextSettings = Object.assign({}, local.settings, payload.settings || {});

        await saveLocalState({
          userApprovedChannels: nextApproved,
          approvedPlaylists: nextPlaylists,
          userOverrides: nextOverrides,
          settings: nextSettings
        });
        return { ok: true };
      }

      case 'RESET_TO_STRICT_DEFAULTS': {
        await ext.alarms.clear(SPRINT_ALARM_NAME);
        if (DB) {
          await DB.clearStore(DB.STORES.USER_OVERRIDES);
        }
        await saveLocalState({
          settings: Object.assign({}, Policy.DEFAULT_SETTINGS),
          userApprovedChannels: INITIAL_APPROVED_CHANNELS,
          userOverrides: [],
          approvedVideos: [],
          approvedPlaylists: [],
          reviewCandidates: [],
          sessionStats: { approvedCount: 0, blockedCount: 0 }
        });
        await loadBundledSeedAndTaxonomy();
        return { ok: true };
      }

      default:
        return { ok: false, error: `Unknown message type: ${message.type}` };
    }
  }
})();
