/**
 * EDU MODE — Shared Policy, Fast Heuristic Filter, Streak, Playlist & Pomodoro Engine (v1.2)
 * Compatible with Chrome Service Workers (importScripts), Content Scripts (window.EduModePolicy), and Node.js (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EduModePolicy = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DECISIONS = {
    ALLOW: 'ALLOW',
    BLOCK: 'BLOCK'
  };

  const REASONS = {
    MODE_PAUSED: 'MODE_PAUSED',
    MISSING_IDENTITY: 'MISSING_IDENTITY',
    SHORTS_BLOCKED: 'SHORTS_BLOCKED',
    USER_BLOCK_OVERRIDE: 'USER_BLOCK_OVERRIDE',
    ADMIN_SAFETY_BLOCK: 'ADMIN_SAFETY_BLOCK',
    USER_ALLOW_OVERRIDE: 'USER_ALLOW_OVERRIDE',
    ADMIN_BLOCK: 'ADMIN_BLOCK',
    APPROVED_VIDEO: 'APPROVED_VIDEO',
    USER_APPROVED_CHANNEL: 'USER_APPROVED_CHANNEL',
    APPROVED_PLAYLIST: 'APPROVED_PLAYLIST',
    APPROVED_CHANNEL_POLICY: 'APPROVED_CHANNEL_POLICY',
    MIXED_CHANNEL_RESTRICTED: 'MIXED_CHANNEL_RESTRICTED',
    FAST_EDU_FILTER_ALLOW: 'FAST_EDU_FILTER_ALLOW',
    UNKNOWN_DEFAULT_BLOCK: 'UNKNOWN_DEFAULT_BLOCK'
  };

  // Feature 1: Quick Subject Switcher Presets for Popup & Disguised Homepage
  const QUICK_SUBJECT_PRESETS = [
    {
      id: 'all',
      label: 'All PCM',
      query: 'CBSE Class 12 Physics Chemistry Mathematics JEE NCERT Lecture'
    },
    {
      id: 'physics',
      label: 'Physics',
      query: 'CBSE Class 12 Physics NCERT JEE Main PYQ One Shot Lecture'
    },
    {
      id: 'chemistry',
      label: 'Chemistry',
      query: 'CBSE Class 12 Chemistry Organic Inorganic Physical NCERT Lecture'
    },
    {
      id: 'maths',
      label: 'Maths',
      query: 'CBSE Class 12 Mathematics Calculus Vectors JEE Main Lecture'
    },
    {
      id: 'cs',
      label: 'CS & AI',
      query: 'Class 12 Computer Science Python SQL Algorithms Programming Lecture'
    },
    {
      id: 'english',
      label: 'English',
      query: 'CBSE Class 12 English Core Flamingo Vistas Chapter Explanation'
    }
  ];

  const DEFAULT_SETTINGS = {
    eduModeEnabled: true,
    strictMode: true,
    basicEduKeywordAllow: true,
    redirectHomepageToEduFeed: true,
    activeQuickSubject: 'all',
    customHomeQuery: 'CBSE Class 12 Physics Chemistry Mathematics JEE NCERT Lecture',
    hideShorts: true,
    hideRecommendations: false,
    hideThumbnails: true,
    // Feature 2: Clean Watch Page ("Study Theater") settings
    studyTheaterMode: true,
    hideComments: true,
    hideLiveChat: true,
    hideEndScreenCards: true,
    // Feature 5: Pomodoro Auto-Cycle settings
    pomodoroAutoCycle: false,
    pomodoroBreakMinutes: 5,
    desktopNotifications: true,
    moveApprovedToTop: true,
    distractionMinimizingPlaceholders: true,
    enabledSubjects: [
      'cbse_ncert',
      'jee',
      'programming',
      'cybersecurity',
      'ai_ml',
      'history_humanities',
      'science_docs'
    ],
    preferredLanguages: ['English', 'Hindi', 'Malayalam']
  };

  const ENTERTAINMENT_SIGNALS = [
    'prank',
    'reaction',
    'celebrity gossip',
    'challenge',
    'meme compilation',
    'memes',
    'gameplay',
    'gaming highlights',
    'fan edit',
    'daily vlog',
    'vlog',
    'shopping haul',
    'unboxing',
    'music video',
    'official trailer',
    'movie clip',
    'roast',
    'drama',
    'funny moments',
    'tiktok',
    'diss track',
    'biggboss',
    'bigg boss'
  ];

  const EDUCATIONAL_INTENT_TERMS = [
    'lecture',
    'tutorial',
    'course',
    'explained',
    'explanation',
    'ncert',
    'cbse',
    'jee',
    'neet',
    'pyq',
    'chapter',
    'class 12',
    'class 11',
    'class 10',
    'derivation',
    'problem solving',
    'oneshot',
    'one shot',
    'revision',
    'documentary',
    'algorithm',
    'data structures',
    'physics',
    'chemistry',
    'mathematics',
    'calculus',
    'electrostatics',
    'optics',
    'thermodynamics',
    'organic chemistry',
    'haloalkanes',
    'coordination compounds',
    'programming',
    'python',
    'javascript',
    'c++',
    'cybersecurity',
    'machine learning',
    'neural network',
    'flamingo',
    'vistas',
    'history',
    'science',
    'engineering',
    'mit opencourseware',
    'nptel',
    'khan academy'
  ];

  const SUBJECT_QUERY_MAP = {
    cbse_ncert: 'NCERT Class 12 Physics Chemistry Maths Lecture',
    jee: 'JEE Main Advanced Physics Chemistry Maths PYQ Lecture',
    programming: 'Computer Science Programming Algorithms Full Course',
    cybersecurity: 'Cybersecurity Networking Linux Tutorial Course',
    ai_ml: 'Machine Learning Deep Learning Statistics Lecture',
    history_humanities: 'World History Civilization Documentary Lecture',
    science_docs: 'Physics Astronomy Science Documentary Lecture'
  };

  /**
   * Build the educational search query used for the disguised YouTube homepage
   */
  function buildHomepageEduQuery(settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    if (s.activeQuickSubject && s.activeQuickSubject !== 'custom') {
      const preset = QUICK_SUBJECT_PRESETS.find((p) => p.id === s.activeQuickSubject);
      if (preset && preset.query) return preset.query;
    }
    if (s.customHomeQuery && String(s.customHomeQuery).trim()) {
      return String(s.customHomeQuery).trim();
    }
    const enabled = Array.isArray(s.enabledSubjects) ? s.enabledSubjects : [];
    if (enabled.length > 0 && SUBJECT_QUERY_MAP[enabled[0]]) {
      return SUBJECT_QUERY_MAP[enabled[0]];
    }
    return DEFAULT_SETTINGS.customHomeQuery;
  }

  /**
   * Feature 3: Parse Playlist ID (`PL...`, `OL...`, `UU...`, `RD...`, or `list=` query param) from URL or raw string
   */
  function extractPlaylistId(input) {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Check URL query parameter ?list=... or &list=...
    const listMatch = trimmed.match(/[?&]list=([a-zA-Z0-9_-]{10,})/);
    if (listMatch) return listMatch[1];

    // Check raw playlist ID format (e.g. PL..., OLAK5uy_..., UU..., FL...)
    if (/^(PL|OL|UU|FL|LL|RD)[a-zA-Z0-9_-]{8,}$/.test(trimmed)) {
      return trimmed;
    }
    if (/^[a-zA-Z0-9_-]{12,}$/.test(trimmed) && !trimmed.includes('/') && !trimmed.includes(' ')) {
      return trimmed;
    }
    return null;
  }

  function normalizeName(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .trim()
      .toLowerCase()
      .replace(/^@+/, '')
      .replace(/\s+/g, ' ');
  }

  function getCanonicalChannelKey(channelObjOrId, fallbackName) {
    if (!channelObjOrId && !fallbackName) return null;
    if (typeof channelObjOrId === 'string') {
      const trimmed = channelObjOrId.trim();
      if (/^UC[\w-]{10,}$/.test(trimmed)) return trimmed;
      const norm = normalizeName(trimmed);
      return norm ? `name:${norm}` : null;
    }
    if (typeof channelObjOrId === 'object') {
      if (channelObjOrId.channel_id && /^UC[\w-]{10,}$/.test(String(channelObjOrId.channel_id).trim())) {
        return String(channelObjOrId.channel_id).trim();
      }
      const nameCandidate = channelObjOrId.channel_name || channelObjOrId.handle || fallbackName;
      const norm = normalizeName(nameCandidate);
      return norm ? `name:${norm}` : null;
    }
    return null;
  }

  function channelMatchesRecord(item, record) {
    if (!item || !record) return false;

    const itemCid = item.channelId || item.channel_id || null;
    const recCid = record.channelId || record.channel_id || record.entity_id || null;

    if (itemCid && recCid && /^UC[\w-]{10,}$/.test(itemCid) && itemCid === recCid) {
      return true;
    }

    const itemNameNorm = normalizeName(item.channelName || item.channel_name || '');
    const itemHandleNorm = normalizeName(item.channelHandle || item.handle || '');

    const recNameNorm = normalizeName(record.channelName || record.channel_name || '');
    const recHandleNorm = normalizeName(record.handle || record.handle_hint || '');
    const recEntityNorm = recCid && String(recCid).startsWith('name:')
      ? normalizeName(String(recCid).slice(5))
      : normalizeName(recCid || '');

    if (itemNameNorm) {
      if (recNameNorm && itemNameNorm === recNameNorm) return true;
      if (recEntityNorm && itemNameNorm === recEntityNorm) return true;
    }
    if (itemHandleNorm) {
      if (recHandleNorm && itemHandleNorm === recHandleNorm) return true;
      if (recNameNorm && itemHandleNorm === recNameNorm) return true;
      if (recEntityNorm && itemHandleNorm === recEntityNorm) return true;
    }

    return false;
  }

  function matchesBasicEducationalFilter(item) {
    if (!item) return false;
    const text = `${item.title || ''} ${item.channelName || ''}`.toLowerCase();
    if (!text.trim()) return false;

    for (let i = 0; i < ENTERTAINMENT_SIGNALS.length; i++) {
      if (text.includes(ENTERTAINMENT_SIGNALS[i])) {
        return false;
      }
    }
    for (let i = 0; i < EDUCATIONAL_INTENT_TERMS.length; i++) {
      if (text.includes(EDUCATIONAL_INTENT_TERMS[i])) {
        return true;
      }
    }
    return false;
  }

  function evaluatePolicy(item, state = {}) {
    const settings = Object.assign({}, DEFAULT_SETTINGS, state.settings || {});

    if (settings.eduModeEnabled === false) {
      return {
        decision: DECISIONS.ALLOW,
        reason: REASONS.MODE_PAUSED,
        ruleSource: 'settings'
      };
    }

    if (!item || typeof item !== 'object') {
      return {
        decision: DECISIONS.BLOCK,
        reason: REASONS.MISSING_IDENTITY,
        ruleSource: 'stage_a_identity'
      };
    }

    if (item.isShort && settings.hideShorts !== false) {
      return {
        decision: DECISIONS.BLOCK,
        reason: REASONS.SHORTS_BLOCKED,
        ruleSource: 'shorts_policy'
      };
    }

    const videoId = item.videoId || item.video_id || null;
    const channelId = item.channelId || item.channel_id || null;
    const channelName = item.channelName || item.channel_name || null;
    const channelHandle = item.channelHandle || item.handle || null;
    const playlistId = item.playlistId || item.playlist_id || null;

    const hasChannelIdentity = Boolean(
      (channelId && String(channelId).trim()) ||
      (channelName && String(channelName).trim()) ||
      (channelHandle && String(channelHandle).trim())
    );

    if (!videoId && !hasChannelIdentity && !playlistId) {
      return {
        decision: DECISIONS.BLOCK,
        reason: REASONS.MISSING_IDENTITY,
        ruleSource: 'stage_a_identity'
      };
    }

    const userOverrides = Array.isArray(state.userOverrides) ? state.userOverrides : [];
    const adminBlocks = Array.isArray(state.adminBlocks) ? state.adminBlocks : [];
    const userApprovedChannels = Array.isArray(state.userApprovedChannels) ? state.userApprovedChannels : [];

    const videosList = normalizeCollection(state.videos, 'video_id');
    const playlistsList = normalizeCollection(state.playlists, 'playlist_id');
    const channelsList = normalizeCollection(state.channels, 'channel_id');

    const hasGlobalSafetyBlock = adminBlocks.some((b) => {
      if (!b || !b.safety_block) return false;
      if (b.entity_type === 'video' && videoId && b.entity_id === videoId) return true;
      if (b.entity_type === 'playlist' && playlistId && b.entity_id === playlistId) return true;
      if (b.entity_type === 'channel' && channelMatchesRecord(item, b)) return true;
      return false;
    });

    // 1. User BLOCK override
    const userBlock = userOverrides.find((ov) => {
      if (!ov || ov.decision !== DECISIONS.BLOCK) return false;
      if (ov.entity_type === 'video' && videoId && ov.entity_id === videoId) return true;
      if (ov.entity_type === 'playlist' && playlistId && ov.entity_id === playlistId) return true;
      if (ov.entity_type === 'channel' && channelMatchesRecord(item, ov)) return true;
      return false;
    });

    if (userBlock) {
      return {
        decision: DECISIONS.BLOCK,
        reason: REASONS.USER_BLOCK_OVERRIDE,
        ruleSource: `user_override:${userBlock.entity_type}:${userBlock.entity_id || userBlock.channel_name}`
      };
    }

    if (hasGlobalSafetyBlock) {
      return {
        decision: DECISIONS.BLOCK,
        reason: REASONS.ADMIN_SAFETY_BLOCK,
        ruleSource: 'admin_safety_block'
      };
    }

    // 2. User ALLOW override
    const userAllow = userOverrides.find((ov) => {
      if (!ov || ov.decision !== DECISIONS.ALLOW) return false;
      if (ov.entity_type === 'video' && videoId && ov.entity_id === videoId) return true;
      if (ov.entity_type === 'playlist' && playlistId && ov.entity_id === playlistId) return true;
      if (ov.entity_type === 'channel' && channelMatchesRecord(item, ov)) return true;
      return false;
    });

    if (userAllow) {
      return {
        decision: DECISIONS.ALLOW,
        reason: REASONS.USER_ALLOW_OVERRIDE,
        ruleSource: `user_override:${userAllow.entity_type}:${userAllow.entity_id || userAllow.channel_name}`
      };
    }

    // 3. Explicit administrator BLOCK
    const explicitAdminBlock = adminBlocks.find((b) => {
      if (!b) return false;
      if (b.entity_type === 'video' && videoId && b.entity_id === videoId) return true;
      if (b.entity_type === 'playlist' && playlistId && b.entity_id === playlistId) return true;
      if (b.entity_type === 'channel' && channelMatchesRecord(item, b)) return true;
      return false;
    });

    if (explicitAdminBlock) {
      return {
        decision: DECISIONS.BLOCK,
        reason: REASONS.ADMIN_BLOCK,
        ruleSource: `admin_block:${explicitAdminBlock.entity_type}:${explicitAdminBlock.entity_id}`
      };
    }

    if (videoId) {
      const regVideo = videosList.find((v) => v && v.video_id === videoId);
      if (regVideo && regVideo.decision === DECISIONS.BLOCK) {
        return {
          decision: DECISIONS.BLOCK,
          reason: REASONS.ADMIN_BLOCK,
          ruleSource: `registry_video_block:${videoId}`
        };
      }
    }

    const regChannelForBlock = channelsList.find((c) => channelMatchesRecord(item, c));
    if (
      regChannelForBlock &&
      (regChannelForBlock.trust_level === 'blocked' ||
        regChannelForBlock.approval_status === 'rejected' ||
        regChannelForBlock.approval_status === 'suspended')
    ) {
      return {
        decision: DECISIONS.BLOCK,
        reason: REASONS.ADMIN_BLOCK,
        ruleSource: `registry_channel_block:${regChannelForBlock.channel_id || regChannelForBlock.channel_name}`
      };
    }

    // 4. Approved individual video
    if (videoId) {
      const approvedVideo = videosList.find(
        (v) => v && v.video_id === videoId && v.decision === DECISIONS.ALLOW
      );
      if (approvedVideo) {
        if (!approvedVideo.expires_at || new Date(approvedVideo.expires_at) > new Date()) {
          return {
            decision: DECISIONS.ALLOW,
            reason: REASONS.APPROVED_VIDEO,
            ruleSource: `video:${videoId}`
          };
        }
      }
    }

    // Check Approved Playlist Policy (Allows playlist page or watch page with list= parameter)
    if (playlistId) {
      const matchedPlaylist = playlistsList.find(
        (pl) => pl && pl.playlist_id === playlistId && pl.approval_status === 'approved'
      );
      if (matchedPlaylist) {
        return {
          decision: DECISIONS.ALLOW,
          reason: REASONS.APPROVED_PLAYLIST,
          ruleSource: `playlist:${playlistId}`
        };
      }
    }

    if (!videoId || (!hasChannelIdentity && !playlistId)) {
      return {
        decision: DECISIONS.BLOCK,
        reason: REASONS.MISSING_IDENTITY,
        ruleSource: 'stage_a_identity'
      };
    }

    // 5. User-approved channel
    const matchedUserChannel = userApprovedChannels.find((ch) => channelMatchesRecord(item, ch));
    if (matchedUserChannel && matchedUserChannel.default_decision !== DECISIONS.BLOCK) {
      return {
        decision: DECISIONS.ALLOW,
        reason: REASONS.USER_APPROVED_CHANNEL,
        ruleSource: `user_channel:${matchedUserChannel.channel_id || matchedUserChannel.channel_name}`
      };
    }

    // 7. Approved channel policy (only if allowed_video_policy = 'all_uploads')
    const matchedRegChannel = channelsList.find((c) => channelMatchesRecord(item, c));
    if (matchedRegChannel && matchedRegChannel.approval_status === 'approved') {
      if (
        matchedRegChannel.default_decision === DECISIONS.ALLOW &&
        matchedRegChannel.allowed_video_policy === 'all_uploads'
      ) {
        return {
          decision: DECISIONS.ALLOW,
          reason: REASONS.APPROVED_CHANNEL_POLICY,
          ruleSource: `channel_policy:${matchedRegChannel.channel_id || matchedRegChannel.channel_name}`
        };
      }
      return {
        decision: DECISIONS.BLOCK,
        reason: REASONS.MIXED_CHANNEL_RESTRICTED,
        ruleSource: `channel_restricted:${matchedRegChannel.channel_id || matchedRegChannel.channel_name}`
      };
    }

    if (settings.strictMode === false && settings.basicEduKeywordAllow && matchesBasicEducationalFilter(item)) {
      return {
        decision: DECISIONS.ALLOW,
        reason: REASONS.FAST_EDU_FILTER_ALLOW,
        ruleSource: 'basic_edu_keyword_filter'
      };
    }

    // 8. Otherwise BLOCK
    return {
      decision: DECISIONS.BLOCK,
      reason: REASONS.UNKNOWN_DEFAULT_BLOCK,
      ruleSource: 'default_deny'
    };
  }

  function normalizeCollection(col, keyField) {
    if (!col) return [];
    if (Array.isArray(col)) return col;
    if (col instanceof Map) return Array.from(col.values());
    if (typeof col === 'object') {
      return Object.entries(col).map(([k, v]) => {
        if (v && typeof v === 'object') {
          return Object.assign({ [keyField]: k }, v);
        }
        return { [keyField]: k, decision: v };
      });
    }
    return [];
  }

  function scoreCandidateForReview(candidate, context = {}) {
    if (!candidate || typeof candidate !== 'object') {
      return {
        score: 0,
        tier: 'reject_candidate',
        breakdown: {},
        autoApproved: false
      };
    }

    const title = String(candidate.title || '').toLowerCase();
    const description = String(candidate.description || '').toLowerCase();
    const combinedText = `${title} ${description}`;
    const taxonomy = Array.isArray(context.taxonomy) ? context.taxonomy : [];

    let subjectScore = 0;
    const matchedSubjects = [];
    for (const subj of taxonomy) {
      const keywords = Array.isArray(subj.keywords) ? subj.keywords : [];
      let hits = 0;
      for (const kw of keywords) {
        if (combinedText.includes(String(kw).toLowerCase())) {
          hits += 1;
        }
      }
      if (hits > 0) {
        matchedSubjects.push(subj.label || subj.subject_id);
        subjectScore += Math.min(15, hits * 6);
      }
    }
    if (subjectScore === 0) {
      for (const term of EDUCATIONAL_INTENT_TERMS) {
        if (combinedText.includes(term)) {
          subjectScore += 6;
        }
      }
    }
    subjectScore = Math.min(30, subjectScore);

    let titleScore = 0;
    for (const term of EDUCATIONAL_INTENT_TERMS) {
      if (title.includes(term)) {
        titleScore += 7;
      }
    }
    titleScore = Math.min(20, titleScore);

    let descriptionScore = 0;
    for (const term of EDUCATIONAL_INTENT_TERMS) {
      if (description.includes(term)) {
        descriptionScore += 5;
      }
    }
    if (description.length > 120 && descriptionScore > 0) {
      descriptionScore += 3;
    }
    descriptionScore = Math.min(15, descriptionScore);

    let playlistScore = 0;
    if (candidate.inApprovedPlaylist || context.inApprovedPlaylist) {
      playlistScore = 20;
    } else if (candidate.playlistTitle) {
      const plTitle = String(candidate.playlistTitle).toLowerCase();
      if (EDUCATIONAL_INTENT_TERMS.some((t) => plTitle.includes(t))) {
        playlistScore = 12;
      }
    }

    let channelScore = 0;
    if (candidate.channelTrustLevel === 'verified' || context.channelTrustLevel === 'verified') {
      channelScore = 15;
    } else if (candidate.channelTrustLevel === 'candidate' || context.channelTrustLevel === 'candidate') {
      channelScore = 8;
    }

    let entertainmentPenalty = 0;
    const matchedSignals = [];
    for (const sig of ENTERTAINMENT_SIGNALS) {
      if (combinedText.includes(sig)) {
        matchedSignals.push(sig);
        entertainmentPenalty += 15;
      }
    }
    entertainmentPenalty = Math.min(40, entertainmentPenalty);

    const rawScore =
      subjectScore +
      titleScore +
      descriptionScore +
      playlistScore +
      channelScore -
      entertainmentPenalty;

    const finalScore = Math.max(0, Math.min(100, rawScore));

    let tier = 'reject_candidate';
    if (finalScore >= 80) {
      tier = 'high_priority_review';
    } else if (finalScore >= 55) {
      tier = 'manual_review';
    }

    return {
      score: finalScore,
      tier,
      matchedSubjects,
      matchedSignals,
      breakdown: {
        subjectScore,
        titleScore,
        descriptionScore,
        playlistScore,
        channelScore,
        entertainmentPenalty
      },
      autoApproved: false
    };
  }

  const GAMIFICATION_CONSTANTS = {
    SPRINT_BASE_XP: 10,
    SPRINT_XP_PER_MINUTE: 2,
    EARLY_STOP_PENALTY_XP: 10,
    PAUSE_MODE_PENALTY_XP: 20,
    DAILY_STREAK_BONUS_PER_DAY: 5,
    MAX_STREAK_BONUS_XP: 50
  };

  function calculateSprintReward(durationMinutes) {
    const mins = Math.max(1, Math.floor(Number(durationMinutes) || 0));
    return GAMIFICATION_CONSTANTS.SPRINT_BASE_XP + mins * GAMIFICATION_CONSTANTS.SPRINT_XP_PER_MINUTE;
  }

  /**
   * Feature 4: Daily Study Streak & Bonus XP Calculator
   * - Same day as `lastStudyDate`: keeps current `streakDays`, 0 extra daily streak bonus (already earned today)
   * - Next consecutive calendar day (`YYYY-MM-DD`): increments `streakDays` by 1 and awards +5 XP per streak day (up to +50 XP)
   * - Gap > 1 day or first ever sprint: resets `streakDays` to 1 and awards +5 XP starter bonus
   */
  function updateDailyStreak(streakState = {}, todayDateStr) {
    const today = todayDateStr || new Date().toISOString().slice(0, 10);
    const prevDate = streakState.lastStudyDate || null;
    const prevStreak = Math.max(0, Number(streakState.streakDays) || 0);
    const longestStreak = Math.max(0, Number(streakState.longestStreak) || 0);

    if (prevDate === today) {
      return {
        streakDays: Math.max(1, prevStreak),
        longestStreak: Math.max(longestStreak, Math.max(1, prevStreak)),
        lastStudyDate: today,
        streakBonusXp: 0,
        streakIncremented: false
      };
    }

    let nextStreak = 1;
    if (prevDate) {
      const t1 = Date.parse(`${prevDate}T00:00:00Z`);
      const t2 = Date.parse(`${today}T00:00:00Z`);
      const diffDays = Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        nextStreak = prevStreak + 1;
      }
    }

    const streakBonusXp = Math.min(
      GAMIFICATION_CONSTANTS.MAX_STREAK_BONUS_XP,
      nextStreak * GAMIFICATION_CONSTANTS.DAILY_STREAK_BONUS_PER_DAY
    );

    return {
      streakDays: nextStreak,
      longestStreak: Math.max(longestStreak, nextStreak),
      lastStudyDate: today,
      streakBonusXp,
      streakIncremented: true
    };
  }

  function applyXpChange(currentXp, deltaXp) {
    const cur = Math.max(0, Math.floor(Number(currentXp) || 0));
    const next = cur + Math.floor(Number(deltaXp) || 0);
    return Math.max(0, next);
  }

  function calculateLevel(xp) {
    const safeXp = Math.max(0, Math.floor(Number(xp) || 0));
    const level = Math.floor(Math.sqrt(safeXp / 25)) + 1;
    const currentLevelFloor = Math.pow(level - 1, 2) * 25;
    const nextLevelCeiling = Math.pow(level, 2) * 25;
    const progressPercent = Math.min(
      100,
      Math.round(((safeXp - currentLevelFloor) / Math.max(1, nextLevelCeiling - currentLevelFloor)) * 100)
    );

    const titles = [
      'Novice Scholar',
      'Focused Learner',
      'Concept Seeker',
      'Deep Thinker',
      'Problem Solver',
      'Master Researcher',
      'Grand Polymath'
    ];
    const title = titles[Math.min(titles.length - 1, level - 1)];

    return {
      level,
      title,
      xp: safeXp,
      currentLevelFloor,
      nextLevelCeiling,
      xpToNextLevel: Math.max(0, nextLevelCeiling - safeXp),
      progressPercent
    };
  }

  function validateDatabaseSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return { valid: false, error: 'Snapshot must be a non-null JSON object.' };
    }
    if (!snapshot.schema_version || typeof snapshot.schema_version !== 'string') {
      return { valid: false, error: 'Missing or invalid schema_version.' };
    }
    if (!Array.isArray(snapshot.channels)) {
      return { valid: false, error: 'Snapshot channels must be an array.' };
    }
    for (let i = 0; i < snapshot.channels.length; i++) {
      const ch = snapshot.channels[i];
      if (!ch || typeof ch !== 'object') {
        return { valid: false, error: `Invalid channel object at index ${i}.` };
      }
      if (!ch.channel_name || typeof ch.channel_name !== 'string') {
        return { valid: false, error: `Missing channel_name at index ${i}.` };
      }
      if (ch.default_decision && ![DECISIONS.ALLOW, DECISIONS.BLOCK].includes(ch.default_decision)) {
        return { valid: false, error: `Invalid default_decision at index ${i}.` };
      }
    }
    return { valid: true, error: null };
  }

  return {
    DECISIONS,
    REASONS,
    QUICK_SUBJECT_PRESETS,
    DEFAULT_SETTINGS,
    GAMIFICATION_CONSTANTS,
    buildHomepageEduQuery,
    extractPlaylistId,
    matchesBasicEducationalFilter,
    normalizeName,
    getCanonicalChannelKey,
    channelMatchesRecord,
    evaluatePolicy,
    scoreCandidateForReview,
    calculateSprintReward,
    updateDailyStreak,
    applyXpChange,
    calculateLevel,
    validateDatabaseSnapshot
  };
});
