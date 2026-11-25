// iPad reminders. The in-page ticker is off (it only knows how to send Telegram). iOS keeps these
// notifications and shows them after the app is closed. «Принято» / «Пропустить» records the dose.
(function () {
  const plugin = () => window.__TAURI_PLUGIN_NOTIFICATION__;
  if (!window.__TAURI_INTERNALS__) return;

  // Texts come from locales/<lang>/ipad.json (mc-words.js loads them); W holds the current set for pushNote.
  let W = { title: 'MedControl' };
  const words = (dict) => {
    const n = (dict && dict.notify) || {};
    const f = (key, args) => window.mcWords.fmt(n[key], args);
    return {
      title: n.title || W.title, taken: n.taken || 'Taken', skip: n.skip || 'Skip',
      dose: (name) => f('dose', { name }), again: (name) => f('again', { name }),
      visitWeek: (name) => f('visitWeek', { name }), visitTomorrow: (name) => f('visitTomorrow', { name }),
      visitToday: (name) => f('visitToday', { name }), visitReport: (name) => f('visitReport', { name }),
      course: (name) => f('course', { name }), alert: n.alert || '', sample: n.sample || '',
      labsLongAgo: n.labsLongAgo || '', labsDaysAgo: (days) => f('labsDaysAgo', { n: days }),
      labsAsk: n.labsAsk || '', labsStale: (when, hint) => f('labsStale', { when, hint }),
    };
  };

  const pad = (n) => String(n).padStart(2, '0');
  const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dayOf(new Date());
  const addDays = (day, n) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return dayOf(d); };
  const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
  const hm = (value) => { const [h, m] = String(value || '').split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? [h, m] : null; };
  // The plugin reads a scheduled date without the time zone, so the wall-clock time is shifted onto UTC.
  const at = (day, hour, minute) => {
    const local = new Date(`${day}T${pad(hour)}:${pad(minute)}:00`);
    return new Date(local.getTime() - local.getTimezoneOffset() * 60000);
  };
  // Compare the real local epoch, not the shifted one at() builds for the plugin: behind UTC the shifted
  // value would drop reminders due sooner than the offset, ahead of UTC it would let past ones through.
  const localTime = (day, hour, minute) => new Date(`${day}T${pad(hour)}:${pad(minute)}:00`).getTime();
  const future = (day, hour, minute) => localTime(day, hour, minute) > Date.now() + 20000;

  function doseDays(regimen, item, kind, hour, minute) {
    const current = today();
    const start = String(regimen.startDate || current).slice(0, 10);
    const end = regimen.endDate && String(regimen.endDate).slice(0, 10);
    const marks = item.today?.marks || [];
    const doneToday = marks.some((mark) => mark.status === 'PAUSED') ||
      marks.length >= (item.timesPerDay || 1) || (kind === 'dose' && marks.length > 0);
    const first = start > current ? start : current;
    const out = [];
    // Fill at most one native queue per slot. The final queue is sorted across all medications.
    const schedule = { ...item, startDate: start };
    const next = (from) => window.mcGateway.nextDoseDay(schedule, from);
    for (let day = next(first); day && out.length < 60; day = next(addDays(day, 1))) {
      if (end && day >= end) break;
      if (day === current && doneToday) continue;
      if (future(day, hour, minute)) out.push({ day, hour, minute });
    }
    return out;
  }

  function pushNote(list, body, extra, when) {
    list.push({ body, extra, date: at(when.day, when.hour, when.minute), day: when.day, due: localTime(when.day, when.hour, when.minute) });
  }

  async function get(url) {
    const r = await fetch(url);
    if (r.status === 401 || r.status === 403) return null;
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return r.json();
  }

  let scheduling = false;
  let refreshPending = false;
  async function schedule() {
    const N = plugin();
    if (!N) return;
    if (scheduling) { refreshPending = true; return; }
    if (!localStorage.getItem('dtc_token')) return;
    scheduling = true;
    try {
      let granted = await N.isPermissionGranted();
      if (!granted) {
        if (localStorage.getItem('mc_notify_asked') === '1') return;
        localStorage.setItem('mc_notify_asked', '1');
        granted = (await N.requestPermission()) === 'granted';
      }
      if (!granted) return;
      const w = words(await window.mcWords.load());
      W = w;
      await N.registerActionTypes([{ id: 'dose', actions: [{ id: 'taken', title: w.taken }, { id: 'skipped', title: w.skip }] }]);
      const soft = (url) => get(url).catch(() => null);
      const [meds, notify, visits, courses, alerts, protocol] = await Promise.all([
        soft('/api/gateway/meds/regimens'),
        soft('/api/gateway/notify/status'),
        soft('/api/gateway/appointments'),
        soft('/api/gateway/infusions'),
        soft('/api/gateway/alerts'),
        soft('/api/gateway/protocol'),
      ]);
      if (!meds) return;
      const notes = [];
      const doseAt = notify?.schedule?.doseAt || '11:00';
      const againAt = notify?.schedule?.doseAgainAt || '';
      for (const reg of meds.regimens || []) {
        for (const it of reg.items || []) {
          if (it.prn) continue;
          const name = it.medication?.name || '';
          const slots = it.medication?.role === 'systemic'
            ? [['dose', doseAt], ...(againAt ? [['again', againAt]] : [])]
            : (it.remindAt ? [['dose', it.remindAt]] : []);
          const extra = { medicationId: it.medication?.id, regimenItemId: it.id };
          for (const [kind, time] of slots) {
            const clock = hm(time);
            if (!clock) continue;
            const body = kind === 'again' ? w.again(name) : w.dose(name);
            for (const when of doseDays(reg, it, kind, clock[0], clock[1])) pushNote(notes, body, extra, when);
          }
        }
      }
      const nowDay = visits?.today || today();
      for (const a of visits?.appointments || []) {
        if (a.status !== 'planned') continue;
        const who = [a.doctor, a.place].filter(Boolean).join(', ') || a.date;
        const plan = [[-7, 10, 0, w.visitWeek], [-1, 18, 0, w.visitTomorrow], [0, 8, 0, w.visitToday]];
        for (const [delta, hour, minute, say] of plan) {
          const day = addDays(a.date, delta);
          if (future(day, hour, minute)) pushNote(notes, say(who), null, { kind: 'once', day, hour, minute });
        }
      }
      for (const a of visits?.overdue || []) {
        let daysAfter = Math.max(1, daysBetween(a.date, nowDay));
        while ((daysAfter - 1) % 3 !== 0) daysAfter += 1;
        for (let i = 0; i < 4; i++) {
          const day = addDays(a.date, daysAfter + i * 3);
          if (future(day, 19, 0)) pushNote(notes, w.visitReport(a.doctor || a.date), null, { kind: 'once', day, hour: 19, minute: 0 });
        }
      }
      for (const c of courses?.courses || []) {
        if (c.status !== 'active' || !c.remind || !c.nextDue) continue;
        const name = c.title || c.agentShort || c.agentName || '';
        const step = c.cadenceDays || 1;
        for (let i = 0; i < 4; i++) {
          const day = addDays(c.nextDue, i * step);
          if (future(day, 10, 0)) pushNote(notes, w.course(name), null, { kind: 'once', day, hour: 10, minute: 0 });
        }
      }
      const staleDays = Number(notify?.schedule?.labStaleDays) || 28;
      const lastLab = notify?.lastLabAt ? new Date(notify.lastLabAt) : null;
      const age = lastLab && !Number.isNaN(lastLab.getTime()) ? Math.floor((Date.now() - lastLab.getTime()) / 86400000) : null;
      if (age == null || age >= staleDays) {
        const dow = new Date().getDay();
        let delta = (1 - dow + 7) % 7;
        if (delta === 0 && !future(today(), 10, 0)) delta = 7;
        const hint = (protocol?.protocol?.labCadenceHint || '').trim() || w.labsAsk;
        const when = age == null ? w.labsLongAgo : w.labsDaysAgo(age);
        pushNote(notes, w.labsStale(when, hint), null, { kind: 'once', day: addDays(today(), delta), hour: 10, minute: 0 });
      }
      const seen = new Set(JSON.parse(localStorage.getItem('mc_alert_notes') || '[]'));
      await N.cancelAll();
      for (const a of alerts?.alerts || []) {
        if (!a.id || seen.has(a.id)) continue;
        N.sendNotification({ title: w.title, body: a.message || a.title || w.alert });
        seen.add(a.id);
        localStorage.setItem('mc_alert_notes', JSON.stringify([...seen].slice(-200)));
      }
      // Delivered notifications may stay in Notification Center after a refresh.
      const oldActions = JSON.parse(localStorage.getItem('mc_dose_actions') || '{}');
      const doseMap = Object.fromEntries(Object.entries(oldActions).filter(([, extra]) => extra.day === today() && extra.due <= Date.now()));
      let nextId = Number(localStorage.getItem('mc_next_note_id')) || 1000;
      const upcoming = notes.sort((a, b) => a.date - b.date).slice(0, 60);
      for (const note of upcoming) {
        const id = nextId++;
        const extra = note.extra && { ...note.extra, day: note.day, due: note.due };
        if (extra) doseMap[id] = extra;
        N.sendNotification({ id, title: w.title, body: note.body, extra, actionTypeId: extra ? 'dose' : undefined, schedule: N.Schedule.at(note.date) });
      }
      localStorage.setItem('mc_next_note_id', String(nextId));
      localStorage.setItem('mc_dose_actions', JSON.stringify(doseMap));
      if (!localStorage.getItem('mc_sample_note')) {
        localStorage.setItem('mc_sample_note', '1');
        N.sendNotification({ title: w.title, body: w.sample, actionTypeId: 'dose' });
      }
    } catch (e) {
      console.error('[medcontrol] notifications', e);
    } finally {
      scheduling = false;
      if (refreshPending) { refreshPending = false; schedule(); }
    }
  }

  function listen() {
    const N = plugin();
    if (!N || listen.done) return;
    listen.done = true;
    N.onAction((event) => {
      const id = event && event.actionId;
      if (id !== 'taken' && id !== 'skipped') return;
      const fromEvent = event.notification && event.notification.extra || {};
      let extra = fromEvent.medicationId ? fromEvent : null;
      if (!extra) {
        const nid = event.notification && event.notification.id;
        try {
          const saved = JSON.parse(localStorage.getItem('mc_dose_actions') || '{}');
          extra = saved[nid] || saved[String(nid)] || null;
        } catch { extra = null; }
      }
      if (!extra || !extra.medicationId || extra.day !== today()) return;
      fetch('/api/gateway/meds/administrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ medication_id: extra.medicationId, regimen_item_id: extra.regimenItemId, status: id === 'taken' ? 'TAKEN' : 'SKIPPED' }),
      }).then(() => schedule()).catch((e) => console.error('[medcontrol] dose from notification', e));
    }).catch(() => {});
  }

  function boot() {
    if (!plugin() || !window.mcWords) { setTimeout(boot, 300); return; }
    listen();
    window.addEventListener('mc-reminders-changed', schedule);
    schedule();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(); });
    setInterval(() => { if (document.visibilityState === 'visible') schedule(); }, 15 * 60 * 1000);
  }
  boot();
})();
