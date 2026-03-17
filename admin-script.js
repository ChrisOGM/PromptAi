'use strict';
const SB_URL  = 'https://sdrmbrrhgovkzzlmdqul.supabase.co';
const SB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkcm1icnJoZ292a3p6bG1kcXVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MTcwNjEsImV4cCI6MjA4OTE5MzA2MX0.YIcN9PQRcKAvCq-3_wpom3Ir-uD8tCZh2efg7Xasyyg';

// ⬇ CHANGE THIS PASSWORD
const ADMIN_PASSWORD = 'promptai2025';

async function sbSelect(table, params) {
  const url = `${SB_URL}/rest/v1/${table}?${params || ''}`;
  const r = await fetch(url, {
    headers: {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Range': '0-999'
    }
  });
  if (!r.ok) throw new Error('Failed to load ' + table);
  return r.json();
}

function adminLogin() {
  const pass = document.getElementById('adminPass').value;
  if (pass === ADMIN_PASSWORD) {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    loadData();
  } else {
    document.getElementById('loginErr').style.display = 'block';
  }
}

function adminLogout() {
  document.getElementById('adminPanel').style.display = 'none';
  document.getElementById('loginPage').style.display = '';
  document.getElementById('adminPass').value = '';
  document.getElementById('loginErr').style.display = 'none';
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');
}

async function loadData() {
  document.getElementById('lastUpdated').textContent = 'Refreshing...';
  try {
    const [users, events, waitlist] = await Promise.all([
      sbSelect('users', 'order=created_at.desc'),
      sbSelect('events', 'order=created_at.desc&limit=200'),
      sbSelect('waitlist', 'order=created_at.desc')
    ]);

    document.getElementById('lastUpdated').textContent = 'Live · ' + new Date().toLocaleTimeString();

    const gens = events.filter(e => e.type === 'generation');
    const todayStr = new Date().toDateString();
    const todayGens = gens.filter(e => new Date(e.created_at).toDateString() === todayStr);

    // Stats
    set('statUsers', users.length);
    set('statWaitlist', waitlist.length);
    set('statGen', gens.length);
    set('statToday', todayGens.length);

    // Categories
    const catCounts = {};
    gens.forEach(e => { catCounts[e.category] = (catCounts[e.category]||0)+1; });
    const catEntries = Object.entries(catCounts).sort((a,b)=>b[1]-a[1]);
    const catEl = document.getElementById('catTable');
    if (!catEntries.length) {
      catEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div>No generations yet</div>';
    } else {
      const colors = ['blue','purple','green','yellow','blue','purple'];
      let h = '<table><thead><tr><th>Category</th><th>Count</th><th>Share</th></tr></thead><tbody>';
      catEntries.forEach((e,i) => {
        const pct = Math.round(e[1]/gens.length*100);
        h += `<tr><td>${catEmoji(e[0])} ${cap(e[0])}</td><td><strong>${e[1]}</strong></td><td><span class="badge ${colors[i%colors.length]}">${pct}%</span></td></tr>`;
      });
      catEl.innerHTML = h + '</tbody></table>';
    }

    // Recent signups
    set('recentCount', users.length);
    const rsEl = document.getElementById('recentSignups');
    if (!users.length) {
      rsEl.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div>No sign-ups yet</div>';
    } else {
      let h = '<table><thead><tr><th>Name</th><th>Email</th><th>Provider</th><th>Joined</th></tr></thead><tbody>';
      users.slice(0,10).forEach(u => {
        const pc = u.provider==='google'?'blue':'purple';
        h += `<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td><span class="badge ${pc}">${esc(u.provider||'email')}</span></td><td>${fmt(u.created_at)}</td></tr>`;
      });
      rsEl.innerHTML = h + '</tbody></table>';
    }

    // Activity
    set('eventsCount', events.length);
    const feedEl = document.getElementById('activityFeed');
    if (!events.length) {
      feedEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📡</div>No events yet</div>';
    } else {
      let h = '';
      events.slice(0,100).forEach(ev => {
        let text = '';
        let dotClass = ev.type;
        if (ev.type === 'generation') {
          text = `<strong>${esc(ev.email||'User')}</strong> generated a <em>${esc(ev.category)}</em> prompt (${esc(ev.tone)})`;
        } else if (ev.type === 'waitlist') {
          text = `<strong>${esc(ev.email)}</strong> joined the waitlist`;
        } else {
          text = `<strong>${esc(ev.type)}</strong>${ev.email?' — '+esc(ev.email):''}`;
          dotClass = 'other';
        }
        h += `<div class="activity-item"><div class="dot ${dotClass}"></div><div class="activity-text">${text}</div><div class="activity-time">${fmt(ev.created_at)}</div></div>`;
      });
      feedEl.innerHTML = h;
    }

    // Users table
    set('usersCount', users.length);
    const ub = document.getElementById('usersBody');
    if (!users.length) {
      ub.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">👤</div>No users yet</div></td></tr>';
    } else {
      let h = '';
      users.forEach(u => {
        const pc = u.provider==='google'?'blue':'purple';
        h += `<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td><span class="badge ${pc}">${esc(u.provider||'email')}</span></td><td>${fmt(u.created_at)}</td></tr>`;
      });
      ub.innerHTML = h;
    }

    // Waitlist table
    set('waitlistCount', waitlist.length);
    const wb = document.getElementById('waitlistBody');
    if (!waitlist.length) {
      wb.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">📋</div>Waitlist is empty</div></td></tr>';
    } else {
      let h = '';
      waitlist.forEach(w => {
        h += `<tr><td>${esc(w.email)}</td><td>${esc(w.whatsapp)}</td><td>${fmt(w.created_at)}</td><td><span class="badge yellow">Pending</span></td></tr>`;
      });
      wb.innerHTML = h;
    }

  } catch(err) {
    document.getElementById('lastUpdated').textContent = 'Error: ' + err.message;
  }
}

function set(id, val) { document.getElementById(id).textContent = val; }
function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) + ' ' +
         d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
}
function esc(s) {
  if (!s) return '—';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function cap(s) { return s ? s[0].toUpperCase()+s.slice(1) : ''; }
function catEmoji(c) {
  return {general:'✦',writing:'✍️',coding:'💻',business:'💼',image:'🎨',marketing:'📣',education:'📚',research:'🔬'}[c]||'•';
}

// Auto-refresh every 30s
setInterval(() => {
  if (document.getElementById('adminPanel').style.display !== 'none') loadData();
}, 30000);
