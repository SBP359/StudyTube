/**
 * EDU MODE — High-Speed YouTube Content Script (v1.2 — Runs at document_start)
 * Features:
 * 1. Instant Disguised Educational Homepage (`/results?search_query=...&edu_home=1`) with cleared search bar.
 * 2. Zero-Lag Instant Heavy Blur (`filter: blur(28px)`) at `document_start`, unblurring approved/educational videos in `requestAnimationFrame`.
 * 3. Clean Watch Page ("Study Theater"): Hides comments, live chat, and distracting end-screen cards via instant root CSS classes.
 * 4. Playlist-Only Approval: One-click "+ Approve Playlist" on `/playlist?list=...`, watch page playlist panels, and playlist search cards.
 * 5. Channel Approval by Name: One-click "+ Add to StudyTube" on channel search results and channel headers.
 */
(function () {
  'use strict';

  const ext = typeof chrome !== 'undefined' ? chrome : browser;
  const Policy = window.EduModePolicy;

  const CARD_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-renderer',
    'ytd-reel-item-renderer',
    'ytm-video-with-context-renderer',
    'ytm-compact-video-renderer'
  ].join(',');

  const CHANNEL_RENDERER_SELECTORS = [
    'ytd-channel-renderer',
    'ytm-compact-channel-renderer'
  ].join(',');

  let currentState = {
    settings: Object.assign({}, Policy.DEFAULT_SETTINGS),
    userApprovedChannels: [],
    userOverrides: [],
    channels: [],
    videos: [],
    playlists: [],
    approvedPlaylists: []
  };

  let lastUrl = location.href;
  let rafPending = false;
  const processedDecisions = new WeakMap();

  // Apply root CSS classes at document_start so zero distracting thumbnails or comments flash
  if (document.documentElement) {
    document.documentElement.classList.add(
      'edu-mode-active',
      'edu-mode-hide-shorts',
      'edu-mode-hide-comments',
      'edu-mode-hide-chat',
      'edu-mode-hide-endscreen'
    );
  }

  function sendMessagePromise(msg) {
    return new Promise((resolve) => {
      try {
        ext.runtime.sendMessage(msg, (res) => {
          resolve(res || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function checkAndRedirectHomepage(settings) {
    const s = settings || currentState.settings || Policy.DEFAULT_SETTINGS;
    if (!s.eduModeEnabled || s.redirectHomepageToEduFeed === false) {
      if (document.documentElement) {
        document.documentElement.classList.remove('edu-mode-home-disguise');
      }
      return false;
    }

    const path = location.pathname;
    const params = new URLSearchParams(location.search);

    if (path === '/' || path === '/index') {
      const eduQuery = Policy.buildHomepageEduQuery(s);
      const targetUrl = `${location.origin}/results?search_query=${encodeURIComponent(eduQuery)}&edu_home=1`;
      location.replace(targetUrl);
      return true;
    }

    if (path === '/results' && params.get('edu_home') === '1') {
      if (document.documentElement) {
        document.documentElement.classList.add('edu-mode-home-disguise');
      }
      clearSearchBoxForDisguisedHome();
    } else if (document.documentElement) {
      document.documentElement.classList.remove('edu-mode-home-disguise');
    }

    return false;
  }

  function clearSearchBoxForDisguisedHome() {
    const inputs = document.querySelectorAll(
      'input#search, input.ytSearchboxComponentInput, ytd-searchbox input'
    );
    inputs.forEach((inp) => {
      if (document.activeElement !== inp && inp.value !== '') {
        inp.value = '';
        inp.setAttribute('placeholder', 'Search study lectures & courses...');
      }
    });
    if (document.title && document.title.includes('- YouTube')) {
      document.title = 'YouTube';
    }
  }

  function setupHomepageClickInterceptor() {
    document.addEventListener(
      'click',
      (e) => {
        const s = (currentState && currentState.settings) || Policy.DEFAULT_SETTINGS;
        if (!s.eduModeEnabled || s.redirectHomepageToEduFeed === false) return;

        const anchor =
          e.target && e.target.closest
            ? e.target.closest(
                'a#logo, a[title="YouTube Home"], ytd-guide-entry-renderer a[href="/"], ytd-mini-guide-entry-renderer a[href="/"]'
              )
            : null;
        if (anchor) {
          const href = anchor.getAttribute('href') || '';
          if (href === '/' || href.startsWith('/?')) {
            e.preventDefault();
            e.stopPropagation();
            const eduQuery = Policy.buildHomepageEduQuery(s);
            location.href = `${location.origin}/results?search_query=${encodeURIComponent(eduQuery)}&edu_home=1`;
          }
        }
      },
      true
    );
  }

  async function init() {
    setupHomepageClickInterceptor();

    const res = await sendMessagePromise({ type: 'GET_STATE' });
    if (res && res.ok && res.state) {
      currentState = res.state;
    }

    if (checkAndRedirectHomepage(currentState.settings)) {
      return;
    }

    applyGlobalRootClasses();
    scheduleFastScan();
    setupObservers();
  }

  /**
   * Feature 2: Apply Study Theater & Global Surface Classes
   */
  function applyGlobalRootClasses() {
    if (!document.documentElement) return;
    const s = (currentState && currentState.settings) || Policy.DEFAULT_SETTINGS;
    const active = Boolean(s.eduModeEnabled);

    document.documentElement.classList.toggle('edu-mode-active', active);
    document.documentElement.classList.toggle('edu-mode-hide-shorts', Boolean(active && s.hideShorts));
    document.documentElement.classList.toggle(
      'edu-mode-hide-recommendations',
      Boolean(active && s.hideRecommendations)
    );

    // Clean Watch Page ("Study Theater") toggles
    const theaterOn = Boolean(active && s.studyTheaterMode !== false);
    document.documentElement.classList.toggle(
      'edu-mode-hide-comments',
      Boolean(theaterOn && s.hideComments !== false)
    );
    document.documentElement.classList.toggle(
      'edu-mode-hide-chat',
      Boolean(theaterOn && s.hideLiveChat !== false)
    );
    document.documentElement.classList.toggle(
      'edu-mode-hide-endscreen',
      Boolean(theaterOn && s.hideEndScreenCards !== false)
    );
  }

  ext.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'EDU_MODE_STATE_UPDATED' && msg.payload) {
      currentState = msg.payload;
      applyGlobalRootClasses();
      resetCardStates();
      scheduleFastScan();
    }
  });

  function resetCardStates() {
    const cards = document.querySelectorAll('[data-edu-decision]');
    for (let i = 0; i < cards.length; i++) {
      cards[i].removeAttribute('data-edu-decision');
      cards[i].classList.remove('edu-card-approved', 'edu-card-blurred', 'edu-card-revealed');
    }
  }

  function setupObservers() {
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        onUrlChange();
      }
      scheduleFastScan();
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });

    window.addEventListener('yt-navigate-start', () => {
      lastUrl = location.href;
      checkAndRedirectHomepage(currentState.settings);
    });

    window.addEventListener('yt-navigate-finish', () => {
      lastUrl = location.href;
      onUrlChange();
      scheduleFastScan();
    });

    window.addEventListener('popstate', () => {
      lastUrl = location.href;
      onUrlChange();
      scheduleFastScan();
    });
  }

  function onUrlChange() {
    removeWatchBlockOverlay();
    checkAndRedirectHomepage(currentState.settings);
  }

  function scheduleFastScan() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      scanPage();
    });
  }

  function extractCardMetadata(card) {
    let videoId = null;
    let playlistId = null;
    let isShort = card.tagName.toLowerCase().includes('reel');

    // If on a `/playlist?list=...` page, inherit the current page's playlist ID for playlist items
    if (location.pathname === '/playlist') {
      const pageList = new URLSearchParams(location.search).get('list');
      if (pageList) playlistId = pageList;
    }

    const videoLinks = card.querySelectorAll(
      'a[href*="/watch?"], a[href*="/shorts/"], a[href*="/playlist?"]'
    );
    for (let i = 0; i < videoLinks.length; i++) {
      const href = videoLinks[i].getAttribute('href') || '';
      if (href.includes('/shorts/')) {
        isShort = true;
        const m = href.match(/\/shorts\/([a-zA-Z0-9_-]{6,})/);
        if (m) videoId = m[1];
      } else if (href.includes('/watch?') || href.includes('/playlist?')) {
        const vMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
        if (vMatch) videoId = vMatch[1];
        const listMatch = href.match(/[?&]list=([a-zA-Z0-9_-]+)/);
        if (listMatch) playlistId = listMatch[1];
      }
      if (videoId || playlistId) break;
    }

    const titleEl =
      card.querySelector('#video-title') ||
      card.querySelector('#video-title-link') ||
      card.querySelector('h3 a') ||
      card.querySelector('.media-item-headline');
    const title = titleEl ? titleEl.textContent.trim() : '';

    let channelId = null;
    let channelHandle = null;
    let channelName = '';

    const channelLinks = card.querySelectorAll(
      'ytd-channel-name a, #channel-name a, #text-container.ytd-channel-name a, a[href^="/channel/"], a[href^="/@"]'
    );

    for (let i = 0; i < channelLinks.length; i++) {
      const chLink = channelLinks[i];
      const href = chLink.getAttribute('href') || '';
      const text = chLink.textContent.trim();
      if (text && !channelName) {
        channelName = text;
      }
      const ucMatch = href.match(/\/channel\/(UC[\w-]{10,})/);
      if (ucMatch) channelId = ucMatch[1];
      const handleMatch = href.match(/\/(@[\w.-]+)/);
      if (handleMatch) channelHandle = handleMatch[1];
    }

    if (!channelName) {
      const fallbackCh =
        card.querySelector('ytd-channel-name #text') ||
        card.querySelector('#channel-name #text') ||
        card.querySelector('.ytd-channel-name');
      if (fallbackCh) {
        channelName = fallbackCh.textContent.trim();
      }
    }

    if (!channelName && !channelId && !channelHandle) {
      const pageCh = extractCurrentChannelPageIdentity();
      if (pageCh) {
        channelId = pageCh.channel_id;
        channelName = pageCh.channel_name;
        channelHandle = pageCh.handle;
      }
    }

    return {
      videoId,
      playlistId,
      channelId,
      channelName,
      channelHandle,
      title,
      isShort
    };
  }

  function extractCurrentChannelPageIdentity() {
    const path = location.pathname || '';
    if (!path.startsWith('/@') && !path.startsWith('/channel/') && !path.startsWith('/c/')) {
      return null;
    }

    let channelId = null;
    let handle = null;
    const ucMatch = path.match(/\/channel\/(UC[\w-]{10,})/);
    if (ucMatch) channelId = ucMatch[1];
    const hMatch = path.match(/\/(@[\w.-]+)/);
    if (hMatch) handle = hMatch[1];

    const headerNameEl =
      document.querySelector('ytd-channel-name#channel-name #text') ||
      document.querySelector('yt-dynamic-header-view-model h1') ||
      document.querySelector('#channel-header ytd-channel-name #text') ||
      document.querySelector('meta[itemprop="name"]');

    const channelName = headerNameEl
      ? (headerNameEl.content || headerNameEl.textContent || '').trim()
      : handle || channelId || '';

    if (!channelName && !channelId && !handle) return null;

    return {
      channel_id: channelId,
      channel_name: channelName,
      handle
    };
  }

  function scanPage() {
    if (!currentState || !Policy) return;
    const settings = currentState.settings || Policy.DEFAULT_SETTINGS;

    if (checkAndRedirectHomepage(settings)) {
      return;
    }

    applyGlobalRootClasses();
    decorateChannelSearchCards();
    decorateChannelHeaderPage();
    decoratePlaylistPageAndPanel();

    if (!settings.eduModeEnabled) {
      removeWatchBlockOverlay();
      return;
    }

    if (location.pathname.startsWith('/shorts/') && settings.hideShorts) {
      renderDirectWatchBlockOverlay({
        title: 'YouTube Shorts are hidden by StudyTube',
        reason: 'Shorts are hidden so you can stay focused on your classes.'
      });
      return;
    }

    if (location.pathname === '/watch') {
      checkDirectWatchPage();
    } else {
      removeWatchBlockOverlay();
    }

    const cards = document.querySelectorAll(CARD_SELECTORS);
    let newlyApproved = 0;
    let newlyBlocked = 0;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const meta = extractCardMetadata(card);

      if (!meta.videoId && !meta.playlistId && !meta.channelName && !meta.title) {
        continue;
      }

      let result = Policy.evaluatePolicy(meta, currentState);
      if (
        result.decision === Policy.DECISIONS.BLOCK &&
        result.reason === Policy.REASONS.UNKNOWN_DEFAULT_BLOCK &&
        settings.basicEduKeywordAllow !== false &&
        Policy.matchesBasicEducationalFilter(meta)
      ) {
        result = {
          decision: Policy.DECISIONS.ALLOW,
          reason: Policy.REASONS.FAST_EDU_FILTER_ALLOW,
          ruleSource: 'fast_edu_filter'
        };
      }

      const sig = `${meta.videoId || ''}|${meta.playlistId || ''}|${meta.channelName || ''}=>${result.decision}`;
      if (processedDecisions.get(card) !== sig) {
        processedDecisions.set(card, sig);
        if (result.decision === Policy.DECISIONS.ALLOW) {
          newlyApproved += 1;
        } else {
          newlyBlocked += 1;
        }
      }

      applyFastBlurCardState(card, meta, result);
    }

    if (newlyApproved > 0 || newlyBlocked > 0) {
      sendMessagePromise({
        type: 'RECORD_SESSION_COUNTS',
        approvedDelta: newlyApproved,
        blockedDelta: newlyBlocked
      });
    }
  }

  function applyFastBlurCardState(card, meta, result) {
    card.setAttribute('data-edu-decision', result.decision);

    if (result.decision === Policy.DECISIONS.ALLOW) {
      card.classList.remove('edu-card-blurred');
      card.classList.add('edu-card-approved');
      const bar = card.querySelector('.edu-inline-action-bar');
      if (bar) bar.remove();
    } else {
      card.classList.remove('edu-card-approved');
      card.classList.add('edu-card-blurred');

      if (!card.querySelector('.edu-inline-action-bar')) {
        const bar = document.createElement('div');
        bar.className = 'edu-inline-action-bar';

        const label = document.createElement('span');
        label.className = 'edu-blur-tag';
        label.textContent = 'Blurred';
        bar.appendChild(label);

        // Feature 3: If card is a playlist or belongs to a playlist, offer "+ Allow Playlist Only"
        if (meta.playlistId) {
          const allowPlBtn = document.createElement('button');
          allowPlBtn.type = 'button';
          allowPlBtn.className = 'edu-clean-btn edu-clean-btn-red';
          allowPlBtn.textContent = '+ Allow Playlist';
          allowPlBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await sendMessagePromise({
              type: 'APPROVE_PLAYLIST',
              playlist: {
                playlist_id: meta.playlistId,
                title: meta.title || `Playlist ${meta.playlistId}`,
                channel_name: meta.channelName
              }
            });
            const res = await sendMessagePromise({ type: 'GET_STATE' });
            if (res && res.ok && res.state) currentState = res.state;
            resetCardStates();
            scheduleFastScan();
          });
          bar.appendChild(allowPlBtn);
        }

        if (meta.channelName || meta.channelHandle) {
          const approveBtn = document.createElement('button');
          approveBtn.type = 'button';
          approveBtn.className = 'edu-clean-btn edu-clean-btn-red';
          approveBtn.textContent = `+ Allow ${meta.channelName || meta.channelHandle}`;
          approveBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await sendMessagePromise({
              type: 'APPROVE_CHANNEL',
              channel: {
                channel_id: meta.channelId,
                channel_name: meta.channelName || meta.channelHandle,
                handle: meta.channelHandle
              }
            });
            const res = await sendMessagePromise({ type: 'GET_STATE' });
            if (res && res.ok && res.state) currentState = res.state;
            resetCardStates();
            scheduleFastScan();
          });
          bar.appendChild(approveBtn);
        }

        const peekBtn = document.createElement('button');
        peekBtn.type = 'button';
        peekBtn.className = 'edu-clean-btn';
        peekBtn.textContent = 'Unblur';
        peekBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          card.classList.add('edu-card-revealed');
          bar.remove();
        });
        bar.appendChild(peekBtn);

        card.appendChild(bar);
      }
    }
  }

  /**
   * Feature 3: Decorate `/playlist?list=...` header and Watch Page playlist panel with "+ Approve Playlist Only"
   */
  function decoratePlaylistPageAndPanel() {
    if (!currentState) return;
    const params = new URLSearchParams(location.search);
    const listId = params.get('list');
    if (!listId) return;

    const isApproved = (currentState.playlists || []).some(
      (p) => p && p.playlist_id === listId && p.approval_status === 'approved'
    );

    const playlistHeaderTarget =
      document.querySelector('ytd-playlist-header-renderer .immersive-header-content .metadata-action-bar') ||
      document.querySelector('ytd-playlist-panel-renderer #header-contents');

    if (!playlistHeaderTarget) return;

    let btn = document.getElementById('edu-playlist-approve-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'edu-playlist-approve-btn';
      btn.type = 'button';
      btn.className = 'edu-clean-btn edu-channel-search-btn';
      playlistHeaderTarget.prepend(btn);
    }

    const titleEl =
      document.querySelector('ytd-playlist-header-renderer #container h1') ||
      document.querySelector('ytd-playlist-panel-renderer h3.title');
    const plTitle = titleEl ? titleEl.textContent.trim() : `Playlist ${listId}`;

    if (isApproved) {
      btn.textContent = '✓ Playlist Approved';
      btn.classList.remove('edu-clean-btn-red');
      btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await sendMessagePromise({
          type: 'REMOVE_APPROVED_PLAYLIST',
          playlistId: listId
        });
        const res = await sendMessagePromise({ type: 'GET_STATE' });
        if (res && res.ok && res.state) currentState = res.state;
        resetCardStates();
        scheduleFastScan();
      };
    } else {
      btn.textContent = '+ Approve Playlist Only';
      btn.classList.add('edu-clean-btn-red');
      btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await sendMessagePromise({
          type: 'APPROVE_PLAYLIST',
          playlist: {
            playlist_id: listId,
            title: plTitle
          }
        });
        const res = await sendMessagePromise({ type: 'GET_STATE' });
        if (res && res.ok && res.state) currentState = res.state;
        resetCardStates();
        scheduleFastScan();
      };
    }
  }

  function checkDirectWatchPage() {
    const params = new URLSearchParams(location.search);
    const videoId = params.get('v');
    const playlistId = params.get('list');

    const ownerChannelLink =
      document.querySelector('ytd-video-owner-renderer ytd-channel-name a') ||
      document.querySelector('#owner #channel-name a') ||
      document.querySelector('ytd-watch-metadata ytd-channel-name a');

    let channelName = '';
    let channelId = null;
    let channelHandle = null;

    if (ownerChannelLink) {
      channelName = ownerChannelLink.textContent.trim();
      const href = ownerChannelLink.getAttribute('href') || '';
      const ucMatch = href.match(/\/channel\/(UC[\w-]{10,})/);
      if (ucMatch) channelId = ucMatch[1];
      const hMatch = href.match(/\/(@[\w.-]+)/);
      if (hMatch) channelHandle = hMatch[1];
    }

    const titleEl =
      document.querySelector('ytd-watch-metadata h1 yt-formatted-string') ||
      document.querySelector('h1.title');
    const title = titleEl ? titleEl.textContent.trim() : '';

    if (!channelName && !title && !playlistId) {
      return;
    }

    const settings = currentState.settings || Policy.DEFAULT_SETTINGS;
    let result = Policy.evaluatePolicy(
      {
        videoId,
        playlistId,
        channelId,
        channelName,
        channelHandle,
        title,
        isDirectWatch: true
      },
      currentState
    );

    if (
      result.decision === Policy.DECISIONS.BLOCK &&
      settings.basicEduKeywordAllow !== false &&
      Policy.matchesBasicEducationalFilter({ title, channelName })
    ) {
      result = { decision: Policy.DECISIONS.ALLOW };
    }

    if (result.decision === Policy.DECISIONS.ALLOW) {
      removeWatchBlockOverlay();
    } else {
      const videoEl = document.querySelector('video.html5-main-video');
      if (videoEl && !videoEl.paused) {
        try {
          videoEl.pause();
        } catch (_) {}
      }
      renderDirectWatchBlockOverlay({
        videoId,
        playlistId,
        channelId,
        channelName,
        channelHandle,
        title
      });
    }
  }

  function renderDirectWatchBlockOverlay(info) {
    let overlay = document.getElementById('edu-mode-watch-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'edu-mode-watch-overlay';
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'edu-watch-modal';

    const topTag = document.createElement('div');
    topTag.className = 'edu-modal-tag';
    topTag.textContent = 'STUDYTUBE • FOCUS LOCK';
    box.appendChild(topTag);

    const h2 = document.createElement('h2');
    h2.textContent = info.title || 'Unapproved Video';
    box.appendChild(h2);

    const p = document.createElement('p');
    p.textContent = info.reason || 'This channel, playlist, or video is not on your educational list.';
    box.appendChild(p);

    const actions = document.createElement('div');
    actions.className = 'edu-modal-actions';

    if (info.playlistId) {
      const allowPlBtn = document.createElement('button');
      allowPlBtn.type = 'button';
      allowPlBtn.className = 'edu-clean-btn edu-clean-btn-red';
      allowPlBtn.textContent = '+ Approve This Playlist Only';
      allowPlBtn.addEventListener('click', async () => {
        await sendMessagePromise({
          type: 'APPROVE_PLAYLIST',
          playlist: {
            playlist_id: info.playlistId,
            title: info.title || `Playlist ${info.playlistId}`,
            channel_name: info.channelName
          }
        });
        const res = await sendMessagePromise({ type: 'GET_STATE' });
        if (res && res.ok && res.state) currentState = res.state;
        removeWatchBlockOverlay();
        scheduleFastScan();
      });
      actions.appendChild(allowPlBtn);
    }

    if (info.channelName || info.channelHandle) {
      const allowChBtn = document.createElement('button');
      allowChBtn.type = 'button';
      allowChBtn.className = 'edu-clean-btn edu-clean-btn-red';
      allowChBtn.textContent = `+ Approve ${info.channelName || info.channelHandle}`;
      allowChBtn.addEventListener('click', async () => {
        await sendMessagePromise({
          type: 'APPROVE_CHANNEL',
          channel: {
            channel_id: info.channelId,
            channel_name: info.channelName || info.channelHandle,
            handle: info.channelHandle
          }
        });
        const res = await sendMessagePromise({ type: 'GET_STATE' });
        if (res && res.ok && res.state) currentState = res.state;
        removeWatchBlockOverlay();
        scheduleFastScan();
      });
      actions.appendChild(allowChBtn);
    }

    if (info.videoId) {
      const allowVidBtn = document.createElement('button');
      allowVidBtn.type = 'button';
      allowVidBtn.className = 'edu-clean-btn';
      allowVidBtn.textContent = 'Allow This Video Only';
      allowVidBtn.addEventListener('click', async () => {
        await sendMessagePromise({
          type: 'SET_USER_OVERRIDE',
          override: {
            entity_type: 'video',
            entity_id: info.videoId,
            title: info.title,
            channel_name: info.channelName,
            decision: 'ALLOW'
          }
        });
        const res = await sendMessagePromise({ type: 'GET_STATE' });
        if (res && res.ok && res.state) currentState = res.state;
        removeWatchBlockOverlay();
        scheduleFastScan();
      });
      actions.appendChild(allowVidBtn);
    }

    box.appendChild(actions);
    overlay.appendChild(box);
  }

  function removeWatchBlockOverlay() {
    const existing = document.getElementById('edu-mode-watch-overlay');
    if (existing) existing.remove();
  }

  function decorateChannelSearchCards() {
    if (!currentState) return;
    const channelCards = document.querySelectorAll(CHANNEL_RENDERER_SELECTORS);

    for (let i = 0; i < channelCards.length; i++) {
      const card = channelCards[i];
      const nameEl =
        card.querySelector('#channel-title #text') ||
        card.querySelector('ytd-channel-name #text') ||
        card.querySelector('#info-section a');
      const linkEl = card.querySelector('a#main-link, a[href^="/@"], a[href^="/channel/"]');

      const channelName = nameEl ? nameEl.textContent.trim() : '';
      const href = linkEl ? linkEl.getAttribute('href') || '' : '';
      const ucMatch = href.match(/\/channel\/(UC[\w-]{10,})/);
      const handleMatch = href.match(/\/(@[\w.-]+)/);

      const channelId = ucMatch ? ucMatch[1] : null;
      const handle = handleMatch ? handleMatch[1] : null;

      if (!channelName && !handle) continue;

      const isAlreadyApproved = (currentState.userApprovedChannels || []).some((ch) =>
        Policy.channelMatchesRecord({ channelId, channelName, channelHandle: handle }, ch)
      );

      let btn = card.querySelector('.edu-channel-search-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'edu-clean-btn edu-channel-search-btn';
        const targetContainer = card.querySelector('#buttons') || card.querySelector('#subscribe-button') || card;
        targetContainer.prepend(btn);
      }

      if (isAlreadyApproved) {
        btn.textContent = '✓ Approved Channel';
        btn.classList.remove('edu-clean-btn-red');
        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await sendMessagePromise({
            type: 'REMOVE_APPROVED_CHANNEL',
            channel: { channel_id: channelId, channel_name: channelName, handle }
          });
          const res = await sendMessagePromise({ type: 'GET_STATE' });
          if (res && res.ok && res.state) currentState = res.state;
          decorateChannelSearchCards();
        };
      } else {
        btn.textContent = '+ Add to StudyTube';
        btn.classList.add('edu-clean-btn-red');
        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await sendMessagePromise({
            type: 'APPROVE_CHANNEL',
            channel: {
              channel_id: channelId,
              channel_name: channelName,
              handle,
              channel_url: href ? new URL(href, location.origin).href : null
            }
          });
          const res = await sendMessagePromise({ type: 'GET_STATE' });
          if (res && res.ok && res.state) currentState = res.state;
          decorateChannelSearchCards();
        };
      }
    }
  }

  function decorateChannelHeaderPage() {
    if (!currentState) return;
    const chIdentity = extractCurrentChannelPageIdentity();
    if (!chIdentity || !chIdentity.channel_name) return;

    const headerActions =
      document.querySelector('#channel-header #subscribe-button') ||
      document.querySelector('yt-flexible-actions-view-model') ||
      document.querySelector('#inner-header-container #buttons');

    if (!headerActions) return;

    const isApproved = (currentState.userApprovedChannels || []).some((ch) =>
      Policy.channelMatchesRecord(
        {
          channelId: chIdentity.channel_id,
          channelName: chIdentity.channel_name,
          channelHandle: chIdentity.handle
        },
        ch
      )
    );

    let btn = document.getElementById('edu-header-channel-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'edu-header-channel-btn';
      btn.type = 'button';
      btn.className = 'edu-clean-btn edu-channel-search-btn';
      headerActions.prepend(btn);
    }

    if (isApproved) {
      btn.textContent = `✓ ${chIdentity.channel_name} Approved`;
      btn.classList.remove('edu-clean-btn-red');
      btn.onclick = async () => {
        await sendMessagePromise({
          type: 'REMOVE_APPROVED_CHANNEL',
          channel: chIdentity
        });
        const res = await sendMessagePromise({ type: 'GET_STATE' });
        if (res && res.ok && res.state) currentState = res.state;
        resetCardStates();
        scheduleFastScan();
      };
    } else {
      btn.textContent = '+ Add to StudyTube';
      btn.classList.add('edu-clean-btn-red');
      btn.onclick = async () => {
        await sendMessagePromise({
          type: 'APPROVE_CHANNEL',
          channel: Object.assign({}, chIdentity, { channel_url: location.href })
        });
        const res = await sendMessagePromise({ type: 'GET_STATE' });
        if (res && res.ok && res.state) currentState = res.state;
        resetCardStates();
        scheduleFastScan();
      };
    }
  }

  init();
})();
