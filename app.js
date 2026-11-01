'use strict';

const App = (() => {

  /* ─── STATE ─── */
  const state = {
    currentService: null,
    myTicket:       null,
    myName:         '',
    myMatric:       '',
    nowServing:     0,
    liveInterval:   null,
    phase:          'waiting', // 'waiting' | 'almost' | 'yourturn' | 'done'
    history:        [],
  };

  /* ─── SERVICES REGISTRY ─── */
  const SERVICES = {
    SA01: {
      code: 'SA01', name: 'Course Registration & Add/Drop',
      location: 'Student Affairs Office', prefix: 'C',
      status: 'open', waiting: 6, waitMin: 18,
      nowServing: 19, counter: 'Counter 1',
    },
    SA02: {
      code: 'SA02', name: 'Transcript Requests',
      location: 'Student Affairs Office', prefix: 'T',
      status: 'open', waiting: 3, waitMin: 10,
      nowServing: 45, counter: 'Counter 2',
    },
    SA03: {
      code: 'SA03', name: 'Student ID Card Issuance',
      location: 'Student Affairs Office', prefix: 'CAF',
      status: 'full', waiting: 15, waitMin: 30,
      nowServing: 120, counter: 'Counter A',
    },
    SA04: {
      code: 'SA04', name: 'Leave of Absence / Withdrawal Processing',
      location: 'Student Affairs Office', prefix: 'REG',
      status: 'closed', waiting: 0, waitMin: 0,
      nowServing: 0, counter: 'Counter 3',
      hours: 'Mon–Fri · 9:00AM – 4:00PM',
    },
    SA05: {
      code: 'SA05', name: 'Scholarship and Financial Aid Applications',
      location: 'Student Affairs Office', prefix: 'SC',
      status: 'closed', waiting: 0, waitMin: 0,
      nowServing: 0, counter: 'Counter 3',
      hours: 'Mon–Fri · 9:00AM – 4:00PM',
    }
  };

  /* ─── UTILS ─── */
  const el      = id => document.getElementById(id);
  const pad     = (n, len = 5) => String(n).padStart(len, '0');
  const fmtDate = d  => d.toLocaleDateString('en-MY', { year:'numeric', month:'long', day:'numeric' });
  const fmtTime = d  => d.toLocaleTimeString('en-MY', { hour:'2-digit', minute:'2-digit' });

  function shake(inputEl) {
    inputEl.classList.remove('shake');
    void inputEl.offsetWidth;
    inputEl.classList.add('shake');
    inputEl.focus();
    setTimeout(() => inputEl.classList.remove('shake'), 500);
  }

  /* ══════════════════════════════════════════
     ALERT SYSTEM
     Fires ONLY on green "your turn" screen
  ══════════════════════════════════════════ */

  /* 1. Notification permission */
  async function requestNotifPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }

  /* 2. Push Notification */
  function sendNotification() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const t   = state.myTicket;
    const svc = state.currentService;
    try {
      const notif = new Notification(`✅ It's Your Turn! — ${t.label}`, {
        body: `${svc.name}\nPlease proceed to ${t.counter} immediately.\nYou have 3 minutes before your turn is skipped.`,
        tag:  'nextoq-yourturn',
        requireInteraction: true,
        icon: buildIconDataUrl('#16a34a'),
      });
      notif.onclick = () => { window.focus(); notif.close(); };
    } catch (e) { console.warn('Notification error:', e); }
  }

  function buildIconDataUrl(color) {
    return 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="14" fill="${color}"/>
        <text x="32" y="46" text-anchor="middle" font-size="34"
              font-family="Arial Black" fill="white">Q</text>
      </svg>`
    );
  }

  /* 3. Vibration */
  function vibrate() {
    if (!navigator.vibrate) return;
    // Strong pattern: 3 long pulses
    navigator.vibrate([600, 200, 600, 200, 600]);
  }
    /* 4. Screen Flash — ADD THIS WHOLE BLOCK HERE */
  function flashScreen() {
    const overlay = document.createElement('div');
    overlay.id = 'nextoq-flash';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: white;
      z-index: 99998;
      pointer-events: none;
      animation: flashAnim 1.8s ease-out forwards;
    `;
    const style = document.createElement('style');
    style.textContent = `
      @keyframes flashAnim {
        0%   { opacity: 0.9; }
        20%  { opacity: 0; }
        40%  { opacity: 0.7; }
        60%  { opacity: 0; }
        80%  { opacity: 0.4; }
        100% { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 1900);
  }

  /* 4. Sound — ascending victory chime */
  function playYourTurnSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [
        { freq: 523, start: 0.00, dur: 0.3 },   // C5
        { freq: 659, start: 0.20, dur: 0.3 },   // E5
        { freq: 784, start: 0.40, dur: 0.3 },   // G5
        { freq: 1047, start: 0.60, dur: 0.6 },  // C6 — held
      ];
      notes.forEach(({ freq, start, dur }) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ctx.currentTime + start);
        gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur + 0.05);
      });
    } catch (e) { console.warn('Audio error:', e); }
  }

  /* 5. In-app green banner (slides from top, stays until dismissed) */
  function showGreenBanner() {
    const existing = document.getElementById('nextoq-banner');
    if (existing) existing.remove();

    const t   = state.myTicket;
    const svc = state.currentService;

    const banner = document.createElement('div');
    banner.id = 'nextoq-banner';
    banner.innerHTML = `
      <div style="
        position:fixed;top:0;left:0;right:0;z-index:9999;
        background:#15803d;color:#fff;
        padding:18px 16px 16px;
        display:flex;align-items:center;gap:12px;
        box-shadow:0 6px 24px rgba(0,0,0,0.4);
        animation:bannerIn .35s cubic-bezier(.22,1,.36,1) both;
      ">
        <span style="font-size:32px;line-height:1;flex-shrink:0;">✅</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:16px;font-weight:800;margin-bottom:3px;">
            It's Your Turn — ${t.label}
          </div>
          <div style="font-size:13px;opacity:.9;line-height:1.5;">
            Go to <strong>${t.counter}</strong> now · 3 min before skip
          </div>
        </div>
        <button onclick="document.getElementById('nextoq-banner').remove()" style="
          background:rgba(255,255,255,.2);border:none;color:#fff;
          border-radius:8px;padding:8px 10px;font-size:14px;
          font-weight:800;cursor:pointer;flex-shrink:0;
        ">✕</button>
      </div>
      <style>
        @keyframes bannerIn {
          from{opacity:0;transform:translateY(-100%)}
          to  {opacity:1;transform:translateY(0)}
        }
      </style>
    `;
    document.body.prepend(banner);
  }

  /* 6. Master alert — all 4 fire together on green screen */
  async function fireYourTurnAlerts() {
    await requestNotifPermission(); // ask permission (needs prior user gesture)
    playYourTurnSound();            // 🔊 sound
    vibrate();                      // 📳 vibration
    sendNotification();             // 🔔 push notification
    showGreenBanner();   
    flashScreen();           // 📢 in-app banner
  }

  /* ══════════════════════════════════════════
     NAVIGATION
  ══════════════════════════════════════════ */
  function goTo(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = el(screenId);
    if (target) { target.classList.add('active'); window.scrollTo(0, 0); }
    if (screenId === 'screen-history')  renderHistory('all');
    if (screenId === 'screen-services') renderServices();
  }

  function openHistory() { goTo('screen-history'); }

  /* ══════════════════════════════════════════
     INIT — Read URL param: index.html?dept=L01
  ══════════════════════════════════════════ */
  function init() {
    loadHistory();
    seedDemoHistory();
    loadHistory();
    renderServices();

    const params   = new URLSearchParams(window.location.search);
    const deptCode = (params.get('dept') || '').toUpperCase().trim();
    if (deptCode && SERVICES[deptCode]) {
      loadServiceInfo(SERVICES[deptCode]);
      goTo('screen-serviceinfo');
    }
  }

  /* ══════════════════════════════════════════
     SERVICE INFO
  ══════════════════════════════════════════ */
  function loadServiceInfo(svc) {
    state.currentService = svc;
    state.nowServing      = svc.nowServing;

    el('si-code').textContent     = svc.code;
    el('si-name').textContent     = svc.name;
    el('si-location').textContent = svc.location;
    el('si-waiting').textContent  = svc.waiting;
    el('si-wait').textContent     = svc.waitMin > 0 ? `~${svc.waitMin}m` : '—';
    el('si-now').textContent      = svc.prefix + pad(svc.nowServing);

    const dot       = el('si-dot');
    const statusTxt = el('si-status-text');
    const bar       = el('si-status-bar');
    const cfg = {
      open:   { txt:'OPEN NOW',   dotColor:'#22c55e', txtColor:'#16a34a', bg:'#f0fdf4', border:'#d1fae5' },
      full:   { txt:'QUEUE FULL', dotColor:'#f97316', txtColor:'#c2410c', bg:'#fff7ed', border:'#fed7aa' },
      closed: { txt:'CLOSED',     dotColor:'#ef4444', txtColor:'#b91c1c', bg:'#fef2f2', border:'#fecaca' },
    }[svc.status];

    dot.style.background        = cfg.dotColor;
    statusTxt.textContent       = cfg.txt;
    statusTxt.style.color       = cfg.txtColor;
    bar.style.background        = cfg.bg;
    bar.style.borderBottomColor = cfg.border;

    const joinBtn = el('si-join-btn');
    if (svc.status !== 'open') {
      joinBtn.disabled         = true;
      joinBtn.textContent      = svc.status === 'full' ? 'Queue is Full' : 'Service Closed';
      joinBtn.style.background = '#9ca3af';
      joinBtn.style.cursor     = 'not-allowed';
    } else {
      joinBtn.disabled         = false;
      joinBtn.textContent      = 'Join Queue Now';
      joinBtn.style.background = '';
      joinBtn.style.cursor     = '';
    }
    el('join-service-name').textContent = svc.name;
  }

  function joinFromServices(code) {
    const svc = SERVICES[code];
    if (!svc) return;
    loadServiceInfo(svc);
    goTo('screen-serviceinfo');
  }

  /* ══════════════════════════════════════════
     JOIN FORM — SUBMIT
  ══════════════════════════════════════════ */
  async function submitJoin() {
    const name   = el('f-name').value.trim();
    const matric = el('f-matric').value.trim();
    if (!name)   { shake(el('f-name'));   return; }
    if (!matric) { shake(el('f-matric')); return; }

    const svc = state.currentService;
    if (!svc) { goTo('screen-services'); return; }

    // Request notification permission NOW (needs user gesture — button tap)
    await requestNotifPermission();

    // Issue ticket number
    svc.waiting++;
    const ticketNum   = svc.nowServing + svc.waiting;
    const ticketLabel = svc.prefix + pad(ticketNum);

    state.myName    = name;
    state.myMatric  = matric;
    state.phase     = 'waiting';
    state.myTicket  = {
      label:    ticketLabel,
      num:      ticketNum,      // the RAW number e.g. 49
      service:  svc.name,
      location: svc.location,
      counter:  svc.counter,
      prefix:   svc.prefix,
      joinedAt: new Date(),
      status:   'waiting',
    };

    addToHistory(state.myTicket, name, matric, el('f-reason').value.trim());
    renderTicket();
    goTo('screen-ticket');
    startLiveTracking();
  }

  /* ══════════════════════════════════════════
     LIVE TICKET — render & update
  ══════════════════════════════════════════ */
  function renderTicket() {
    const t = state.myTicket;
    el('t-number').textContent = t.label;
    el('t-loc').textContent    = `${t.service} · ${t.location}`;
    updateTicketStats();
  }

  /* ─── THE CORE QUEUE LOGIC ───────────────────
     myNum  = my ticket number (e.g. 49)
     nowServing = currently being served (e.g. 46)

     ahead  = myNum - nowServing - 1
              = 49 - 46 - 1 = 2  → still waiting

     When nowServing = 48:
       ahead = 49 - 48 - 1 = 0
       → phase: 'almost' → RED screen (silent)

     When nowServing = 49:
       nowServing >= myNum
       → phase: 'yourturn' → GREEN screen + ALL alerts
  ─────────────────────────────────────────── */
  function updateTicketStats() {
    const t   = state.myTicket;
    const svc = state.currentService;
    if (!t || !svc) return;

    const myNum    = t.num;
    const serving  = state.nowServing;
    const ahead    = myNum - serving - 1; // people between nowServing and me

    /* ── PHASE: YOUR TURN — nowServing equals my number ── */
    if (serving >= myNum) {
      if (state.phase !== 'yourturn') {
        state.phase = 'yourturn';
        doYourTurn();
      }
      return; // stop — no further stat updates needed
    }

    /* ── PHASE: ALMOST — exactly 1 person ahead (nowServing = myNum - 1) ── */
    if (ahead <= 0 && serving < myNum) {
      // ahead = 0 means nowServing = myNum - 1, i.e. the person just before me
      if (state.phase !== 'almost') {
        state.phase = 'almost';
        doAlmost();
      }
      return; // stop — we are on red screen, no stat updates
    }

    /* ── PHASE: WAITING — more than 1 ahead ── */
    const waitMin = ahead * Math.max(1, Math.round(svc.waitMin / Math.max(svc.waiting, 1)));
    el('t-position').textContent = `#${ahead + 1}`;
    el('t-wait').textContent     = `~${waitMin}m`;
    el('t-now').textContent      = svc.prefix + pad(serving);
  }

  function startLiveTracking() {
    if (state.liveInterval) clearInterval(state.liveInterval);
    // Production: replace body with fetch('/api/queue/status?dept=X') poll
    state.liveInterval = setInterval(updateTicketStats, 10000);
  }

  /* Demo button — advance the serving counter by 1 */
  function simulateAdvance() {
    state.nowServing++;
    state.currentService.nowServing = state.nowServing;
    updateTicketStats();
  }

  /* ══════════════════════════════════════════
     PHASE: ALMOST YOUR TURN
     → Red screen, NO alerts, silent transition
     Condition: nowServing = myNum - 1
                e.g. serving L00048, my ticket L00049
  ══════════════════════════════════════════ */
  function doAlmost() {
    const t = state.myTicket;

    // Populate red screen fields
    el('a-number').textContent  = t.label;
    el('a-loc').textContent     = t.service;
    el('a-counter').textContent = t.counter;
    el('a-now').textContent     = state.currentService.prefix + pad(state.nowServing);

    updateHistoryStatus(t.label, 'serving');

    // ⚠️ NO sound, NO vibration, NO notification here
    // Just switch screen to red — user sees they are next
    goTo('screen-almost');

    // Keep polling so we detect when nowServing reaches myNum → green screen
    // (interval may have been cleared; restart it to be safe)
    startLiveTracking();
  }

  /* ══════════════════════════════════════════
     PHASE: IT'S YOUR TURN
     → Green screen + ALL 4 alerts fire
     Condition: nowServing = myNum
                e.g. serving L00049, my ticket L00049
  ══════════════════════════════════════════ */
  async function doYourTurn() {
    const t = state.myTicket;

    // Populate green screen fields
    el('yt-number').textContent  = t.label;
    el('yt-loc').textContent     = t.service;
    el('yt-counter').textContent = t.counter;

    // Switch to green screen FIRST so user sees it immediately
    goTo('screen-yourturn');

    // Then fire all 4 alerts simultaneously
    await fireYourTurnAlerts();
  }

  /* ══════════════════════════════════════════
     MARK AS DONE → All Done screen
     Called by "I'm Here! ✓" button on green screen
  ══════════════════════════════════════════ */
  function markCompleted() {
    if (state.liveInterval) clearInterval(state.liveInterval);

    const banner = document.getElementById('nextoq-banner');
    if (banner) banner.remove();

    if (state.myTicket) {
      updateHistoryStatus(state.myTicket.label, 'completed');
    }

    state.phase = 'done';

    el('done-num').textContent  = state.myTicket?.label || '—';
    el('done-svc').textContent  = state.currentService?.name || '—';
    el('done-date').textContent = fmtDate(new Date());

    goTo('screen-done');
  }

  function rejoinQueue() { goTo('screen-serviceinfo'); }
  function viewDetails(code) {
    const svc = SERVICES[code];
    if (!svc) return;

    el('det-code').textContent     = svc.code;
    el('det-name').textContent     = svc.name;
    el('det-location').textContent = svc.location;
    el('det-counter').textContent  = svc.counter;
    el('det-prefix').textContent   = svc.prefix + '00001';

    // Status badge
    const badgeCfg = {
      full:   { bg:'#fff7ed', color:'#c2410c', text:'● FULL' },
      closed: { bg:'#fef2f2', color:'#b91c1c', text:'● CLOSED' },
    }[svc.status] || { bg:'#f0fdf4', color:'#16a34a', text:'● OPEN' };

    const badge = el('det-status-badge');
    badge.textContent   = badgeCfg.text;
    badge.style.cssText = `background:${badgeCfg.bg};color:${badgeCfg.color};padding:4px 10px;border-radius:8px;font-size:12px;font-weight:700;`;

    // Status banner
    const bannerCfg = {
      full: {
        bg:'#fff7ed', icon:'⏳',
        title:'Queue is Currently Full',
        msg:'Please come back later or try during off-peak hours.',
      },
      closed: {
        bg:'#fef2f2', icon:'🔒',
        title:'Service is Currently Closed',
        msg:'Please visit during office hours listed below.',
      },
    }[svc.status] || { bg:'#f0fdf4', icon:'✅', title:'Service is Open', msg:'' };

    const banner = el('det-status-banner');
    banner.style.background             = bannerCfg.bg;
    el('det-status-icon').textContent   = bannerCfg.icon;
    el('det-status-title').textContent  = bannerCfg.title;
    el('det-status-msg').textContent    = bannerCfg.msg;

    // Office hours
    const hoursCfg = {
      SA04: ['Mon – Fri &nbsp;&nbsp; 9:00AM – 4:00PM', 'Sat – Sun &nbsp;&nbsp; Closed'],
      SA05: ['Mon – Fri &nbsp;&nbsp; 9:00AM – 4:00PM', 'Sat – Sun &nbsp;&nbsp; Closed'],
      SA03: ['Mon – Fri &nbsp;&nbsp; 8:30AM – 5:00PM', 'Sat &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 9:00AM – 1:00PM', 'Sun &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Closed'],
    };
    const hours = hoursCfg[code] || ['Mon – Fri &nbsp;&nbsp; 9:00AM – 5:00PM', 'Sat – Sun &nbsp;&nbsp; Closed'];
    el('det-hours-list').innerHTML = hours.map(h => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#374151;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b5bdb" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
        </svg>
        ${h}
      </div>
    `).join('');

    goTo('screen-details');
  }

  /* ══════════════════════════════════════════
     AVAILABLE SERVICES LIST
  ══════════════════════════════════════════ */
  function renderServices() {
    const grid = el('services-grid');
    if (!grid) return;
    grid.innerHTML = Object.values(SERVICES).map(svc => `
      <div class="sci-card">
        <div class="sci-top">
          <span class="sci-code">${svc.code}</span>
          <span class="sci-status-badge badge-${svc.status}">
            ● ${{ open:'OPEN', full:'FULL', closed:'CLOSED' }[svc.status]}
          </span>
        </div>
        <div class="sci-name">${svc.name}</div>
        <div class="sci-loc">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          ${svc.location}
        </div>
        ${svc.status !== 'closed'
          ? `<div class="sci-stats">
               <div class="sci-stat-item"><strong>${svc.waiting}</strong>Waiting</div>
               <div class="sci-stat-item"><strong>~${svc.waitMin}m</strong>Est. Wait</div>
             </div>`
          : `<div style="font-size:11px;color:#9ca3af;margin-bottom:12px;flex:1;">${svc.hours||''}</div>`
        }
        ${svc.status === 'open'
          ? `<button class="btn-blue" style="width:100%;padding:10px;font-size:13px;border-radius:9px;"
               onclick="App.joinFromServices('${svc.code}')">Join Queue</button>`
          : `<button class="btn-grey" style="width:100%;padding:10px;font-size:13px;border-radius:9px;cursor:pointer;"
               onclick="App.viewDetails('${svc.code}')">View Details</button>`
        }
      </div>
    `).join('');
  }

  /* ══════════════════════════════════════════
     HISTORY
  ══════════════════════════════════════════ */
  function loadHistory() {
    try { state.history = JSON.parse(localStorage.getItem('nextoq_history') || '[]'); }
    catch (e) { state.history = []; }
  }
  function saveHistory() {
    try { localStorage.setItem('nextoq_history', JSON.stringify(state.history)); } catch(e){}
  }
  function addToHistory(ticket, name, matric, reason) {
    state.history.unshift({
      ticket: ticket.label, service: ticket.service, location: ticket.location,
      name, matric, reason, status: 'waiting', joinedAt: new Date().toISOString(),
    });
    saveHistory();
  }
  function updateHistoryStatus(ticketLabel, status) {
    const entry = state.history.find(h => h.ticket === ticketLabel);
    if (entry) {
      entry.status = status;
      if (status === 'completed') entry.completedAt = new Date().toISOString();
      saveHistory();
    }
  }

  function renderHistory(filter) {
    loadHistory();
    const all       = state.history;
    const completed = all.filter(h => h.status === 'completed');
    const inprog    = all.filter(h => h.status === 'waiting' || h.status === 'serving');
    const skipped   = all.filter(h => h.status === 'skipped');

    el('history-summary').innerHTML = `
      <div class="hsumm-card">
        <div class="hsumm-icon" style="background:#eff6ff;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b5bdb" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <div class="hsumm-val">${all.length}</div>
        <div class="hsumm-lbl">Total Visits</div>
      </div>
      <div class="hsumm-card">
        <div class="hsumm-icon" style="background:#dcfce7;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M8 12l2.5 2.5L16 9"/>
          </svg>
        </div>
        <div class="hsumm-val" style="color:#16a34a;">${completed.length}</div>
        <div class="hsumm-lbl">Completed</div>
      </div>
      <div class="hsumm-card">
        <div class="hsumm-icon" style="background:#fff7ed;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e8630a" stroke-width="2">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
          </svg>
        </div>
        <div class="hsumm-val" style="color:#e8630a;">${inprog.length}</div>
        <div class="hsumm-lbl">In Progress</div>
      </div>
      <div class="hsumm-card">
        <div class="hsumm-icon" style="background:#fee2e2;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>
          </svg>
        </div>
        <div class="hsumm-val" style="color:#ef4444;">${skipped.length}</div>
        <div class="hsumm-lbl">Skipped</div>
      </div>
    `;

    el('history-tabs').querySelector('[data-filter="all"]').textContent       = `All (${all.length})`;
    el('history-tabs').querySelector('[data-filter="completed"]').textContent = `Completed (${completed.length})`;
    el('history-tabs').querySelector('[data-filter="waiting"]').textContent   = `In Progress (${inprog.length})`;
    el('history-tabs').querySelector('[data-filter="skipped"]').textContent   = `Skipped (${skipped.length})`;

    const map   = { all, completed, waiting: inprog, skipped };
    const items = map[filter] || all;

    if (items.length === 0) {
      el('history-list').innerHTML = '<div class="empty-history">No records found.</div>';
      return;
    }

    const iconBg = { waiting:'#eff6ff', serving:'#fff7ed', completed:'#dcfce7', skipped:'#fee2e2' };
    const icons  = {
      waiting:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b5bdb" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
      serving:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e8630a" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/></svg>`,
      completed: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12l2.5 2.5L16 9"/></svg>`,
      skipped:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`,
    };
    const labels = { waiting:'Waiting', serving:'Serving', completed:'Completed', skipped:'Skipped' };

    el('history-list').innerHTML = items.map(h => {
      const d  = new Date(h.joinedAt);
      const st = h.status;
      return `
        <div class="history-item">
          <div class="hi-top">
            <div class="hi-icon" style="background:${iconBg[st]||'#f3f4f6'};">
              ${icons[st]||icons.waiting}
            </div>
            <div class="hi-num-row">
              <span class="hi-num">${h.ticket}</span>
              <span class="hi-badge s-${st}">${labels[st]||st}</span>
            </div>
            <div class="hi-date-col">📅 ${fmtDate(d)}<br>🕐 ${fmtTime(d)}</div>
          </div>
          <div class="hi-svc">${h.service}</div>
          <div class="hi-loc">${h.location}</div>
          <div class="hi-meta-row">
            <span>Name: <strong>${h.name}</strong></span>
            <span>Matric: <strong>${h.matric}</strong></span>
          </div>
          ${(st==='waiting'||st==='serving')
            ? `<div class="hi-actions">
                 <button class="hi-action-btn hi-btn-blue" onclick="App.goTo('screen-ticket')">View Live Ticket</button>
               </div>` : ''}
          ${st==='skipped'
            ? `<div class="hi-actions">
                 <button class="hi-action-btn hi-btn-orange" onclick="App.rejoinQueue()">Rejoin Queue</button>
               </div>` : ''}
          ${st==='completed'&&h.completedAt
            ? `<div class="hi-completed-note">
                 ✓ Completed on ${fmtDate(new Date(h.completedAt))} · ${fmtTime(new Date(h.completedAt))}
               </div>` : ''}
        </div>
      `;
    }).join('');
  }

  function filterHistory(filter, btn) {
    el('history-tabs').querySelectorAll('.htab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    renderHistory(filter);
  }

  function clearHistory() {
    if (!confirm('Clear all queue history?')) return;
    state.history = [];
    saveHistory();
    renderHistory('all');
  }

  /* ── Demo seed data ── */
  function seedDemoHistory() {
    if (localStorage.getItem('nextoq_seeded_v2')) return;
    const now = new Date();
    const ago = m => new Date(now.getTime() - m * 60000).toISOString();
    state.history = [
      { ticket:'T00045', service:'Transcript Requests', location:'Student Affairs Office',
        name:'Puteri Najiha binti Tengku Ahmad', matric:'2315270', reason:'Transcript request',
        status:'completed', joinedAt:ago(37), completedAt:ago(3) },
      { ticket:'C00019', service:'Course Registration & Add/Drop', location:'Student Affairs Office',
        name:'Muhammad Aqil bin Malik', matric:'2215270', reason:'',
        status:'skipped', joinedAt:ago(10) },
      { ticket:'C00020', service:'Course Registration & Add/Drop', location:'Student Affairs Office',
        name:'Aina binti Aiman', matric:'2415270', reason:'',
        status:'waiting', joinedAt:now.toISOString() },
    ];
    saveHistory();
    localStorage.setItem('nextoq_seeded_v2', '1');
  }

  /* ── Boot ── */
  document.addEventListener('DOMContentLoaded', init);

  /* ── Public API ── */
  return {
    goTo,
    openHistory,
    joinFromServices,
    submitJoin,
    simulateAdvance,
    markCompleted,
    rejoinQueue,
    viewDetails,
    filterHistory,
    clearHistory,
  };

})();