# EDU MODE — Technical Specification v1.0

**Product:** EDU MODE  
**Platform:** Mozilla Firefox Extension, Manifest V3
**Audience:** General learners  
**Policy:** Strict whitelist; default deny  
**Initial subjects:** CBSE/NCERT, JEE preparation, Programming, Cybersecurity, AI/ML, History & Humanities, Science documentaries

## 1. Product objective

EDU MODE changes YouTube into an approved-content environment. Content is hidden unless its channel, playlist, or individual video has been explicitly approved. Unknown content is blocked by default.

This is an access-control product, not merely a classifier. A high educational score must never silently grant access in strict mode.

## 2. Core policy

Decision precedence, highest priority first:

1. User BLOCK override.
2. User ALLOW override, unless a global safety/administrative block exists.
3. Explicit administrator BLOCK.
4. Approved individual video.
5. User-approved channel, which allows all uploads.
6. Approved playlist policy.
7. Approved channel policy, only if `allowed_video_policy = all_uploads`.
8. Otherwise BLOCK.

The add-on's user-facing channel approval allows all uploads from that selected channel. Warn users to review mixed-content channels first. For curated registries, the recommended default remains `approved_playlists_only` or `per_video`.

**Strict mode invariant:** `unknown => BLOCK`. AI classification can recommend a review outcome but cannot approve content automatically.

## 3. YouTube surfaces to filter

- Home feed and recommendation shelves
- Search results
- Shorts shelf and Shorts pages
- Related videos / watch-next sidebar
- Channel video grids
- Subscription feed
- Embedded YouTube cards where practical

The extension should not interfere with the playback controls of an already approved video. On a direct video URL, check the video ID before allowing the watch page. Unknown direct links should show a local blocked page or overlay with a clear explanation.

YouTube changes its DOM frequently. Use resilient selectors, a debounced `MutationObserver`, URL-change detection for SPA navigation, and a fail-closed strategy. Do not remove whole page regions unless the user has enabled that setting.

## 4. Recommended project structure

```text
edu-mode/
├── manifest.json
├── manifest.json
├── src/
│   ├── background.js
│   ├── content.js
│   ├── content.css
│   ├── popup/
│   ├── options/
│   └── shared/policy.js
├── tests/policy.test.js
└── README.md
```

## 5. Firefox permissions

Start with the minimum permissions:

- `storage`
- `alarms` for completing focus sessions when the popup is closed
- Host permissions for YouTube pages only
- Optional host permission for your own sync API

Avoid broad permissions such as `<all_urls>`. Do not request browsing-history access. The extension does not need it.

## 6. Database design

The companion `database-schema.json` defines the logical schema. The production database should use these tables:

### channels
Canonical identity is the YouTube channel ID (`UC...`), never the display name or handle. Handles can change and display names are not unique.

Fields:
- `channel_id` primary key
- `channel_name`
- `handle`
- `channel_url`
- `subjects`
- `languages`
- `trust_level`
- `approval_status`
- `default_decision`
- `allowed_video_policy`
- `source_url`
- `last_verified_at`
- audit timestamps

### videos
Stores individual approved or blocked videos. Use `video_id` as the primary key. Keep only the metadata needed for decisions; avoid storing full viewing histories.

### playlists
Allows approval of a specific course or educational series without approving every upload from that channel.

### user_overrides
Allows users to approve or block a specific channel, playlist, or video. User overrides must be visible and reversible.

### taxonomy
Stores subjects, subtopics, keywords, language aliases and curriculum tags.

### audit_log
Records policy changes and why a video became visible or hidden. Do not record watch history.

## 7. Classification rules

Classification is a review aid, not the authorization mechanism.

### Stage A: identity
Extract `video_id` and `channel_id` from YouTube's rendered card or URL. If either is unavailable, block the card.

### Stage B: explicit policy lookup
Look up user overrides, administrator decisions, video approvals, playlist approvals and channel approvals in precedence order.

### Stage C: optional candidate scoring
For items submitted for review, calculate a score from:
- Subject relevance: 0–30
- Educational intent in title: 0–20
- Educational description: 0–15
- Approved course/playlist context: 0–20
- Trusted channel history: 0–15
- Entertainment signals: subtract 0–40

Interpretation:
- 80–100: high-priority review candidate
- 55–79: manual review
- 0–54: reject candidate

In strict mode, even 100/100 remains blocked until approval is recorded. This prevents a title like “LEARN PHYSICS WHILE I DESTROY MY ROOM” from becoming an accidental loophole.

### Stage D: language and subject matching
Support multilingual keywords and aliases. Do not reject a video merely because the title is not English. Use title, description and playlist context. Treat tags as optional because they are often missing.

### Entertainment signals
Potential negative indicators include:
- prank, reaction, celebrity gossip, challenge, meme compilation
- gameplay, highlights, fan edits
- daily vlog, shopping haul, unboxing
- music video, trailer, movie clip

These terms should not be absolute bans. For example, a documentary about the history of gaming may be educational. Signals only rank candidates for human review.

## 8. Local data and sync

Use IndexedDB for a large channel/video registry and `browser.storage.local` for preferences, score and small settings.

Suggested sync model:
- Bundle a small seed database with the extension.
- Download signed/versioned database snapshots from your backend.
- Validate schema version and checksum before applying.
- Apply updates transactionally.
- Keep the previous working snapshot if an update fails.
- Cache the last successful sync timestamp.
- Never fail open when offline; use the last known approved database.

Supabase is appropriate for collaborative curation. Use Row Level Security. Public clients should have read-only access to published records. Only authorized maintainers should approve or publish channels. Never put a service-role key in the extension.

## 9. YouTube metadata strategy

Do not call the YouTube Data API for every visible card. That is slow, expensive in quota, and unnecessary.

Preferred order:
1. Use video and channel IDs already present in YouTube's rendered page.
2. Check local IndexedDB.
3. Apply explicit policy.
4. Queue unresolved candidates for optional backend review.
5. Do not reveal the candidate while review is pending.

If using the YouTube Data API, use official documentation and respect quota, API terms, caching and attribution requirements. `videos.list` can retrieve metadata for known IDs; `search.list` is not a good per-card lookup mechanism.

## 10. Interface requirements

### Popup
- Master EDU MODE switch
- Focus sprint timer, reward preview, and score/level
- Points for completing a sprint; visible penalties for early stop or pausing the mode
- Current policy status
- Counts of approved and blocked cards in the current session
- Quick access to settings
- Last database sync

### Options page
- Subject toggles
- Language preferences
- Hide Shorts
- Hide recommendations
- Manage approved channels
- Manage blocked channels
- Review pending candidates
- Find channels by name using YouTube's live channel-search results and approve them from the result or channel page
- Export/import user rules
- Reset to strict defaults

Focus points are a local motivation feature, not tamper-proof enforcement. Browser extensions cannot reliably detect being disabled or uninstalled from Firefox's own controls.

### On-page blocked placeholder
Display a neutral message: "Hidden by EDU MODE: this content is not on your approved learning list." Provide an optional "Review this item" action. Do not show a thumbnail or title if the user has enabled distraction-minimizing mode.

## 11. Security and privacy

- No collection of watch history.
- No analytics by default.
- No remote executable JavaScript.
- No API secrets in extension files.
- Validate all remote JSON.
- Use HTTPS for sync.
- Restrict content-script access to YouTube.
- Keep user overrides local unless the user explicitly enables sync.
- Do not let remote database text execute as code.
- Document all data collected and why.

## 12. Testing and acceptance criteria

A release candidate must pass:

1. Unknown channel is hidden.
2. Unknown direct video URL is blocked.
3. Approved video is visible.
4. A blocked video override beats a channel-level allow.
5. A user-approved video can be allowed under the documented override policy.
6. Shorts are filtered independently of normal videos.
7. Infinite scroll cards are filtered.
8. SPA navigation triggers a fresh scan.
9. Offline mode uses the last valid local database.
10. Malformed or failed database updates do not replace the last valid snapshot.
11. Duplicate cards are processed once.
12. A mixed-content channel does not automatically expose every upload.
13. Completing a focus sprint awards the displayed XP; stopping it early applies the displayed penalty.
14. Pausing EDU MODE through its popup applies the displayed penalty.

Measure false allows as the most serious failure. Track false blocks separately so legitimate educational material can be reviewed.

## 13. Implementation roadmap

### Milestone 1 — Working extension
- Manifest V3 skeleton
- YouTube content script
- Extract IDs from video cards
- Hide all unknown cards
- Allow manually seeded video/channel IDs

### Milestone 2 — Policy engine
- IndexedDB registry
- Channel, playlist and video decisions
- Override precedence
- Strict fail-closed behavior
- Unit tests

### Milestone 3 — YouTube coverage
- Home, search, Shorts, subscriptions and watch-next
- SPA navigation detection
- MutationObserver with debouncing
- Blocked placeholders

### Milestone 4 — Curated database
- Seed candidates
- Official identity verification
- Manual review workflow
- Subject and language tags
- Versioned JSON snapshots

### Milestone 5 — Cloud sync
- Supabase tables
- RLS policies
- Admin review interface
- Signed/versioned published snapshots

### Milestone 6 — Quality
- Test against YouTube DOM changes
- Accessibility
- Performance profiling
- Chrome Web Store privacy disclosures
- Open-source contribution guide

## 14. Definition of done for V1

V1 is complete when a user can install the extension, enable strict mode, see only approved videos across the main YouTube surfaces, manually approve or block items, and continue using the last synced policy while offline.

Do not add AI classification, recommendation algorithms, or a giant public database before this works reliably. A small accurate whitelist beats a giant pile of questionable metadata.
