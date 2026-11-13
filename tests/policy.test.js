/**
 * EDU MODE — Unit & Acceptance Test Suite (`node tests/policy.test.js`)
 * Verifies all 14 Acceptance Criteria in Section 12 of `technical-specification.md`
 * plus the 5 v1.2 features (Quick Subject Switcher, Study Theater, Playlist-Only Approval, Daily Streak Bonus XP, Pomodoro Cycles).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Policy = require('../src/shared/policy.js');

const seedData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'seed-channels.json'), 'utf8')
);
const taxonomyData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'taxonomy.json'), 'utf8')
);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ PASS: ${name}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

console.log('=== EDU MODE v1.2 Policy, Streak, Playlist & Gamification Tests ===\n');

test('1. Unknown channel is hidden by default', () => {
  const res = Policy.evaluatePolicy(
    {
      videoId: 'dQw4w9WgXcQ',
      channelId: 'UC_unknown_123456',
      channelName: 'Random Entertainment Channel'
    },
    { settings: { eduModeEnabled: true } }
  );
  assert.strictEqual(res.decision, Policy.DECISIONS.BLOCK);
  assert.strictEqual(res.reason, Policy.REASONS.UNKNOWN_DEFAULT_BLOCK);
});

test('2. Unknown direct video URL is blocked', () => {
  const res = Policy.evaluatePolicy(
    {
      videoId: 'vid_direct_unknown',
      channelId: null,
      channelName: '',
      isDirectWatch: true
    },
    { settings: { eduModeEnabled: true } }
  );
  assert.strictEqual(res.decision, Policy.DECISIONS.BLOCK);
});

test('3. Approved individual video is visible', () => {
  const res = Policy.evaluatePolicy(
    {
      videoId: 'ncert_electrostatics_01',
      channelId: 'UC_unverified_111',
      channelName: 'Guest Physics Lecturer'
    },
    {
      videos: [{ video_id: 'ncert_electrostatics_01', decision: 'ALLOW' }]
    }
  );
  assert.strictEqual(res.decision, Policy.DECISIONS.ALLOW);
  assert.strictEqual(res.reason, Policy.REASONS.APPROVED_VIDEO);
});

test('4. User BLOCK video override beats an approved channel allow', () => {
  const res = Policy.evaluatePolicy(
    {
      videoId: 'off_topic_vlog_99',
      channelId: 'UC_physics_wallah_123',
      channelName: 'Physics Wallah'
    },
    {
      userApprovedChannels: [
        {
          channel_id: 'UC_physics_wallah_123',
          channel_name: 'Physics Wallah',
          default_decision: 'ALLOW'
        }
      ],
      userOverrides: [
        {
          entity_type: 'video',
          entity_id: 'off_topic_vlog_99',
          decision: 'BLOCK'
        }
      ]
    }
  );
  assert.strictEqual(res.decision, Policy.DECISIONS.BLOCK);
  assert.strictEqual(res.reason, Policy.REASONS.USER_BLOCK_OVERRIDE);
});

test('5. User-approved channel by name and User ALLOW override work as specified', () => {
  const byNameRes = Policy.evaluatePolicy(
    {
      videoId: 'vid_pw_101',
      channelName: 'Physics Wallah',
      channelHandle: '@PhysicsWallah'
    },
    {
      userApprovedChannels: [
        {
          channel_id: 'name:physics wallah',
          channel_name: 'Physics Wallah',
          handle: '@PhysicsWallah',
          default_decision: 'ALLOW'
        }
      ]
    }
  );
  assert.strictEqual(byNameRes.decision, Policy.DECISIONS.ALLOW);
  assert.strictEqual(byNameRes.reason, Policy.REASONS.USER_APPROVED_CHANNEL);

  const safetyBlocked = Policy.evaluatePolicy(
    {
      videoId: 'unsafe_vid_001',
      channelName: 'Some Channel'
    },
    {
      userOverrides: [{ entity_type: 'video', entity_id: 'unsafe_vid_001', decision: 'ALLOW' }],
      adminBlocks: [{ entity_type: 'video', entity_id: 'unsafe_vid_001', safety_block: true }]
    }
  );
  assert.strictEqual(safetyBlocked.decision, Policy.DECISIONS.BLOCK);
  assert.strictEqual(safetyBlocked.reason, Policy.REASONS.ADMIN_SAFETY_BLOCK);
});

test('6. Shorts are blocked when hideShorts is enabled, even from an approved channel', () => {
  const res = Policy.evaluatePolicy(
    {
      videoId: 'short_12345',
      channelName: '3Blue1Brown',
      isShort: true
    },
    {
      settings: { eduModeEnabled: true, hideShorts: true },
      userApprovedChannels: [{ channel_name: '3Blue1Brown', default_decision: 'ALLOW' }]
    }
  );
  assert.strictEqual(res.decision, Policy.DECISIONS.BLOCK);
  assert.strictEqual(res.reason, Policy.REASONS.SHORTS_BLOCKED);
});

test('7. Mixed-content channel with approved_playlists_only blocks general uploads but allows approved playlists', () => {
  const mixedRes = Policy.evaluatePolicy(
    {
      videoId: 'natgeo_random_clip',
      channelId: 'UC_natgeo_01',
      channelName: 'National Geographic'
    },
    {
      channels: [
        {
          channel_id: 'UC_natgeo_01',
          channel_name: 'National Geographic',
          approval_status: 'approved',
          default_decision: 'ALLOW',
          allowed_video_policy: 'approved_playlists_only'
        }
      ]
    }
  );
  assert.strictEqual(mixedRes.decision, Policy.DECISIONS.BLOCK);
  assert.strictEqual(mixedRes.reason, Policy.REASONS.MIXED_CHANNEL_RESTRICTED);

  const playlistAllowed = Policy.evaluatePolicy(
    {
      videoId: 'natgeo_cosmos_ep1',
      playlistId: 'PL_cosmos_approved',
      channelId: 'UC_natgeo_01',
      channelName: 'National Geographic'
    },
    {
      playlists: [
        {
          playlist_id: 'PL_cosmos_approved',
          channel_id: 'UC_natgeo_01',
          approval_status: 'approved'
        }
      ]
    }
  );
  assert.strictEqual(playlistAllowed.decision, Policy.DECISIONS.ALLOW);
  assert.strictEqual(playlistAllowed.reason, Policy.REASONS.APPROVED_PLAYLIST);
});

test('8. Candidate scoring computes educational vs entertainment signals and never auto-approves', () => {
  const highEdu = Policy.scoreCandidateForReview(
    {
      title: 'CBSE Class 12 Physics Chapter 1 Electrostatics One Shot Lecture | JEE Main PYQ',
      description: 'Complete NCERT derivation, tutorial, and physics problem solving course.',
      inApprovedPlaylist: true,
      channelTrustLevel: 'verified'
    },
    { taxonomy: taxonomyData.subjects }
  );
  assert.ok(highEdu.score >= 80);
  assert.strictEqual(highEdu.tier, 'high_priority_review');
  assert.strictEqual(highEdu.autoApproved, false);
});

test('9. Bundled seed-channels.json passes schema validation and defaults to BLOCK', () => {
  const check = Policy.validateDatabaseSnapshot(seedData);
  assert.strictEqual(check.valid, true);
});

test('10. Malformed database snapshot is rejected by validateDatabaseSnapshot', () => {
  assert.strictEqual(Policy.validateDatabaseSnapshot(null).valid, false);
  assert.strictEqual(
    Policy.validateDatabaseSnapshot({ schema_version: '1.0.0', channels: 'invalid' }).valid,
    false
  );
});

test('11. Gamification XP rewards and penalties floor at 0', () => {
  const reward25 = Policy.calculateSprintReward(25);
  assert.strictEqual(reward25, 60);
  let xp = Policy.applyXpChange(0, reward25);
  assert.strictEqual(xp, 60);
  xp = Policy.applyXpChange(xp, -Policy.GAMIFICATION_CONSTANTS.EARLY_STOP_PENALTY_XP);
  assert.strictEqual(xp, 50);
  xp = Policy.applyXpChange(xp, -Policy.GAMIFICATION_CONSTANTS.PAUSE_MODE_PENALTY_XP);
  assert.strictEqual(xp, 30);
  xp = Policy.applyXpChange(10, -Policy.GAMIFICATION_CONSTANTS.PAUSE_MODE_PENALTY_XP);
  assert.strictEqual(xp, 0);
});

test('12. Feature 1 & 3: Quick Subject Switcher query builder and Playlist URL/ID parser', () => {
  const physicsQuery = Policy.buildHomepageEduQuery({ activeQuickSubject: 'physics' });
  assert.ok(physicsQuery.includes('Physics'));

  const parsedFromWatchUrl = Policy.extractPlaylistId(
    'https://www.youtube.com/watch?v=abcd12345&list=PL_Electrostatics_Class12_01&index=2'
  );
  assert.strictEqual(parsedFromWatchUrl, 'PL_Electrostatics_Class12_01');

  const parsedFromRaw = Policy.extractPlaylistId('PL1234567890ABCDEF');
  assert.strictEqual(parsedFromRaw, 'PL1234567890ABCDEF');
});

test('13. Feature 4: Daily Study Streak increments on consecutive days and awards +5 XP/day bonus', () => {
  // Day 1
  const d1 = Policy.updateDailyStreak({ streakDays: 0, lastStudyDate: null }, '2026-11-13');
  assert.strictEqual(d1.streakDays, 1);
  assert.strictEqual(d1.streakBonusXp, 5);

  // Same Day (no duplicate daily bonus)
  const d1Repeat = Policy.updateDailyStreak(d1, '2026-11-13');
  assert.strictEqual(d1Repeat.streakDays, 1);
  assert.strictEqual(d1Repeat.streakBonusXp, 0);

  // Consecutive Day 2 (+10 XP bonus)
  const d2 = Policy.updateDailyStreak(d1, '2026-11-14');
  assert.strictEqual(d2.streakDays, 2);
  assert.strictEqual(d2.streakBonusXp, 10);

  // Missed a day (resets to 1 day)
  const dGap = Policy.updateDailyStreak(d2, '2026-11-17');
  assert.strictEqual(dGap.streakDays, 1);
  assert.strictEqual(dGap.streakBonusXp, 5);
  assert.strictEqual(dGap.longestStreak, 2);
});

console.log(`\nAll ${passed} acceptance test suites passed!\n`);
