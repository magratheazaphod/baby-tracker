/* global navigator */
const $ = (sel) => document.querySelector(sel)

let cfg = null
let timelineOldest = null
const PAGE_SIZE = 100

// ---------- api ----------

async function api(url, opts = {}) {
  if (opts.json) {
    opts.body = JSON.stringify(opts.json)
    opts.headers = { 'Content-Type': 'application/json' }
    delete opts.json
  }
  const res = await fetch(url, opts)
  if (res.status === 401) {
    showLogin()
    throw new Error('Not logged in')
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

// ---------- formatting ----------

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayLongFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

function fmtTime(iso) {
  return timeFmt.format(new Date(iso))
}

function dayKey(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDayHeader(key) {
  const today = dayKey(new Date().toISOString())
  const yesterday = dayKey(new Date(Date.now() - 86400 * 1000).toISOString())
  if (key === today) return 'Today'
  if (key === yesterday) return 'Yesterday'
  return dayLongFmt.format(new Date(`${key}T12:00:00`))
}

function toLocalInput(date) {
  const d = new Date(date)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

function gramsToLbOz(g) {
  const totalOz = g / 28.3495
  const lb = Math.floor(totalOz / 16)
  const oz = Math.round((totalOz % 16) * 10) / 10
  return { lb, oz }
}

function fmtWeight(g) {
  const { lb, oz } = gramsToLbOz(g)
  return `${(g / 1000).toFixed(2)} kg (${lb} lb ${oz} oz)`
}

function fmtHeight(cm) {
  return `${cm.toFixed(1)} cm (${(cm / 2.54).toFixed(1)} in)`
}

function describe(e) {
  switch (e.type) {
    case 'breastfeed':
      return { emoji: '🤱', title: 'Breastfeeding', sub: e.duration_min ? `${e.duration_min} min` : '' }
    case 'formula':
      return { emoji: '🍼', title: `Bottle · ${e.kind === 'breastmilk' ? 'Breast milk' : 'Formula'}`, sub: `${e.amount_ml} ml` }
    case 'diaper': {
      const label = { pee: 'Pee', poop: 'Poop', both: 'Pee + poop' }[e.kind] || e.kind
      const emoji = { pee: '💧', poop: '💩', both: '💧💩' }[e.kind] || '💧'
      return { emoji, title: `Diaper · ${label}`, sub: '' }
    }
    case 'weight':
      return { emoji: '⚖️', title: 'Weight', sub: fmtWeight(e.weight_g) }
    case 'height':
      return { emoji: '📏', title: 'Height', sub: fmtHeight(e.height_cm) }
    case 'photo':
      return { emoji: '📷', title: 'Photo', sub: '' }
    case 'milestone':
      return { emoji: '🌟', title: e.notes || 'Milestone', sub: '' }
    default:
      return { emoji: '❓', title: e.type, sub: '' }
  }
}

function toast(msg, onTap) {
  const el = $('#toast')
  el.textContent = msg
  el.onclick = onTap
    ? () => {
        el.classList.add('hidden')
        onTap()
      }
    : null
  el.style.cursor = onTap ? 'pointer' : ''
  el.classList.remove('hidden')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => el.classList.add('hidden'), onTap ? 5000 : 2200)
}

function fmtDur(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ---------- login ----------

function showLogin() {
  $('#app').classList.add('hidden')
  $('#login').classList.remove('hidden')
  const usersEl = $('#login-users')
  const errEl = $('#login-error')
  const contBtn = $('#login-continue')

  const post = async (body) => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Login failed')
    return data
  }

  // Step 1: prove the secret; only then does the server reveal the name list.
  const probe = async () => {
    errEl.textContent = ''
    try {
      const { users } = await post({ secret: $('#login-secret').value })
      contBtn.classList.add('hidden')
      usersEl.innerHTML = ''
      for (const name of users) {
        const btn = document.createElement('button')
        btn.textContent = `I'm ${name}`
        btn.onclick = async () => {
          try {
            await post({ secret: $('#login-secret').value, user: name })
            location.reload()
          } catch (err) {
            errEl.textContent = err.message
          }
        }
        usersEl.appendChild(btn)
      }
    } catch (err) {
      errEl.textContent = err.message
    }
  }
  contBtn.onclick = probe
  $('#login-secret').onkeydown = (e) => {
    if (e.key === 'Enter') probe()
  }
}

// ---------- sheet (bottom form) ----------

function closeSheet() {
  $('#sheet-backdrop').classList.add('hidden')
}

$('#sheet-backdrop').addEventListener('click', (e) => {
  if (e.target === $('#sheet-backdrop')) closeSheet()
})

function fieldTime(value) {
  return `<label>Time<input type="datetime-local" name="occurred_at" value="${value}" required></label>`
}

function fieldNotes(value = '') {
  return `<label>Notes (optional)<input type="text" name="notes" value="${escapeHtml(value)}" placeholder=""></label>`
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function sheetActions(existing) {
  return `<div class="sheet-actions">
    ${existing ? '<button type="button" class="delete" id="sheet-delete">Delete</button>' : ''}
    <button type="submit" class="save">Save</button>
  </div>`
}

// Builds and opens the sheet for a new entry or an edit (existing = event row).
function openSheet(type, { kind, existing } = {}) {
  const sheet = $('#sheet-form')
  const timeVal = toLocalInput(existing ? existing.occurred_at : new Date())
  const titles = {
    breastfeed: '🤱 Breastfeeding',
    formula: '🍼 Bottle',
    diaper: '💧 Diaper',
    weight: '⚖️ Weight',
    height: '📏 Height',
    photo: '📷 Photo',
    milestone: '🌟 Milestone',
  }
  $('#sheet-title').textContent = (existing ? 'Edit — ' : '') + titles[type]

  let fields = ''
  if (type === 'breastfeed') {
    fields = `${fieldTime(timeVal)}
      <label>Duration in minutes (optional)<input type="number" name="duration_min" inputmode="numeric" min="1" step="1" value="${existing?.duration_min ?? ''}"></label>
      ${fieldNotes(existing?.notes)}`
  } else if (type === 'formula') {
    const last = existing?.amount_ml ?? Number(localStorage.getItem('lastFormulaMl') || 30)
    const selectedKind = existing?.kind || localStorage.getItem('lastBottleKind') || 'formula'
    fields = `${fieldTime(timeVal)}
      <input type="hidden" name="kind" value="${selectedKind}">
      <div class="seg" id="kind-seg">
        <button type="button" data-kind="formula">Formula</button>
        <button type="button" data-kind="breastmilk">Breast milk</button>
      </div>
      <label>Amount (ml)
        <div class="stepper">
          <button type="button" data-step="-5">−</button>
          <input type="number" name="amount_ml" inputmode="numeric" min="5" step="5" value="${last}" required>
          <button type="button" data-step="5">+</button>
        </div>
      </label>
      ${fieldNotes(existing?.notes)}`
  } else if (type === 'diaper') {
    const selected = existing?.kind || kind || 'pee'
    fields = `${fieldTime(timeVal)}
      <input type="hidden" name="kind" value="${selected}">
      <div class="seg" id="kind-seg">
        <button type="button" data-kind="pee">💧 Pee</button>
        <button type="button" data-kind="poop">💩 Poop</button>
        <button type="button" data-kind="both">Both</button>
      </div>
      <label>${existing?.photo_path ? 'Replace photo' : 'Photo (optional)'}<input type="file" name="photo" accept="image/*"></label>
      <img class="photo-preview ${existing?.photo_path ? '' : 'hidden'}" id="photo-preview" src="${existing?.photo_path ? `/photos/${escapeHtml(existing.photo_path)}` : ''}" alt="">
      ${existing?.analysis ? `<div class="entry-analysis">✨ ${escapeHtml(existing.analysis)}</div>` : ''}
      ${existing?.photo_path ? '<button type="button" class="photo-remove" id="photo-remove">Remove photo</button>' : ''}
      ${fieldNotes(existing?.notes)}`
  } else if (type === 'weight') {
    const unit = localStorage.getItem('weightUnit') || 'lb'
    const g = existing?.weight_g
    const { lb, oz } = g ? gramsToLbOz(g) : { lb: '', oz: '' }
    fields = `${fieldTime(timeVal)}
      <input type="hidden" name="unit" value="${unit}">
      <div class="seg" id="unit-seg">
        <button type="button" data-unit="lb">lb / oz</button>
        <button type="button" data-unit="kg">kg</button>
      </div>
      <div id="weight-lb" class="${unit === 'lb' ? '' : 'hidden'}" style="display:${unit === 'lb' ? 'flex' : 'none'};gap:10px">
        <label style="flex:1">Pounds<input type="number" name="lb" inputmode="numeric" min="0" step="1" value="${lb}"></label>
        <label style="flex:1">Ounces<input type="number" name="oz" inputmode="decimal" min="0" max="15.9" step="0.1" value="${oz}"></label>
      </div>
      <label id="weight-kg" style="display:${unit === 'kg' ? 'flex' : 'none'}">Kilograms<input type="number" name="kg" inputmode="decimal" min="0" step="0.001" value="${g ? (g / 1000).toFixed(3) : ''}"></label>
      ${fieldNotes(existing?.notes)}`
  } else if (type === 'height') {
    const unit = localStorage.getItem('heightUnit') || 'in'
    const cm = existing?.height_cm
    fields = `${fieldTime(timeVal)}
      <input type="hidden" name="unit" value="${unit}">
      <div class="seg" id="hunit-seg">
        <button type="button" data-unit="in">inches</button>
        <button type="button" data-unit="cm">cm</button>
      </div>
      <label>Height (<span id="hunit-label">${unit}</span>)<input type="number" name="height" inputmode="decimal" min="0" step="0.1" value="${cm ? (unit === 'cm' ? cm.toFixed(1) : (cm / 2.54).toFixed(1)) : ''}" required></label>
      ${fieldNotes(existing?.notes)}`
  } else if (type === 'photo') {
    fields = `${fieldTime(timeVal)}
      ${existing
        ? `<img class="photo-preview" src="/photos/${escapeHtml(existing.photo_path)}" alt="">`
        : `<label>Photo<input type="file" name="photo" accept="image/*" required></label>
           <img class="photo-preview hidden" id="photo-preview" alt="">`}
      <label>Caption (optional)<input type="text" name="notes" value="${escapeHtml(existing?.notes ?? '')}"></label>`
  } else if (type === 'milestone') {
    fields = `${fieldTime(timeVal)}
      <label>What happened?<input type="text" name="notes" value="${escapeHtml(existing?.notes ?? '')}" placeholder="Rolled over for the first time" required></label>`
  }

  sheet.innerHTML = fields + sheetActions(existing)

  sheet.querySelectorAll('[data-step]').forEach((btn) => {
    btn.onclick = () => {
      const input = sheet.querySelector('[name=amount_ml]')
      input.dataset.touched = '1'
      input.value = Math.max(5, (Number(input.value) || 0) + Number(btn.dataset.step))
    }
  })

  // Anticipate the formula amount: default to whatever the last formula feed
  // was (from the server, so it syncs across both phones).
  if (type === 'formula' && !existing) {
    const amountInput = sheet.querySelector('[name=amount_ml]')
    amountInput.addEventListener('input', () => (amountInput.dataset.touched = '1'))
    api('/api/events?limit=1&type=formula')
      .then((rows) => {
        if (rows[0]?.amount_ml && !amountInput.dataset.touched && sheet.contains(amountInput)) {
          amountInput.value = rows[0].amount_ml
        }
      })
      .catch(() => {})
  }

  const kindSeg = sheet.querySelector('#kind-seg')
  if (kindSeg) {
    const sync = () => {
      const v = sheet.querySelector('[name=kind]').value
      kindSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.kind === v))
    }
    kindSeg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        sheet.querySelector('[name=kind]').value = b.dataset.kind
        sync()
      }
    })
    sync()
  }

  const unitSeg = sheet.querySelector('#unit-seg')
  if (unitSeg) {
    const sync = () => {
      const v = sheet.querySelector('[name=unit]').value
      unitSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.unit === v))
      sheet.querySelector('#weight-lb').style.display = v === 'lb' ? 'flex' : 'none'
      sheet.querySelector('#weight-kg').style.display = v === 'kg' ? 'flex' : 'none'
    }
    unitSeg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        sheet.querySelector('[name=unit]').value = b.dataset.unit
        localStorage.setItem('weightUnit', b.dataset.unit)
        sync()
      }
    })
    sync()
  }

  const hunitSeg = sheet.querySelector('#hunit-seg')
  if (hunitSeg) {
    const sync = () => {
      const v = sheet.querySelector('[name=unit]').value
      hunitSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.unit === v))
      sheet.querySelector('#hunit-label').textContent = v
    }
    hunitSeg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const input = sheet.querySelector('[name=height]')
        const prev = sheet.querySelector('[name=unit]').value
        if (input.value && prev !== b.dataset.unit) {
          input.value = (b.dataset.unit === 'cm' ? Number(input.value) * 2.54 : Number(input.value) / 2.54).toFixed(1)
        }
        sheet.querySelector('[name=unit]').value = b.dataset.unit
        localStorage.setItem('heightUnit', b.dataset.unit)
        sync()
      }
    })
    sync()
  }

  const fileInput = sheet.querySelector('[name=photo]')
  if (fileInput) {
    fileInput.onchange = () => {
      const f = fileInput.files[0]
      if (!f) return
      const preview = sheet.querySelector('#photo-preview')
      preview.src = URL.createObjectURL(f)
      preview.classList.remove('hidden')
      // Default the entry time to when the photo was taken, if older than "now".
      // Photo entries only — a diaper's logged time shouldn't move because a
      // picture from the library was attached.
      if (type === 'photo' && f.lastModified && f.lastModified < Date.now() - 60 * 1000) {
        sheet.querySelector('[name=occurred_at]').value = toLocalInput(f.lastModified)
      }
    }
  }

  const photoRemove = sheet.querySelector('#photo-remove')
  if (photoRemove) {
    photoRemove.onclick = async () => {
      if (!confirm('Remove this photo?')) return
      try {
        const updated = await api(`/api/events/${existing.id}/photo`, { method: 'DELETE' })
        toast('Photo removed')
        refreshAll()
        openSheet(type, { existing: updated })
      } catch (err) {
        toast(err.message)
      }
    }
  }

  const deleteBtn = sheet.querySelector('#sheet-delete')
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm('Delete this entry?')) return
      await api(`/api/events/${existing.id}`, { method: 'DELETE' })
      closeSheet()
      toast('Deleted')
      refreshAll()
    }
  }

  sheet.onsubmit = async (e) => {
    e.preventDefault()
    const fd = new FormData(sheet)
    const occurredAt = new Date(fd.get('occurred_at')).toISOString()

    try {
      if (type === 'photo' && !existing) {
        const upload = new FormData()
        upload.append('photo', fd.get('photo'))
        upload.append('occurred_at', occurredAt)
        upload.append('notes', fd.get('notes') || '')
        await api('/api/photos', { method: 'POST', body: upload })
      } else {
        const body = { occurred_at: occurredAt, notes: fd.get('notes') || null }
        if (type === 'breastfeed') body.duration_min = fd.get('duration_min') ? Number(fd.get('duration_min')) : null
        if (type === 'formula') {
          body.amount_ml = Number(fd.get('amount_ml'))
          body.kind = fd.get('kind') || 'formula'
          localStorage.setItem('lastFormulaMl', body.amount_ml)
          localStorage.setItem('lastBottleKind', body.kind)
        }
        if (type === 'diaper') body.kind = fd.get('kind')
        if (type === 'weight') {
          body.weight_g = fd.get('unit') === 'kg'
            ? Math.round(Number(fd.get('kg')) * 1000)
            : Math.round((Number(fd.get('lb') || 0) * 16 + Number(fd.get('oz') || 0)) * 28.3495)
        }
        if (type === 'height') {
          const v = Number(fd.get('height'))
          body.height_cm = Math.round((fd.get('unit') === 'cm' ? v : v * 2.54) * 10) / 10
        }
        let saved
        if (existing) {
          saved = await api(`/api/events/${existing.id}`, { method: 'PATCH', json: body })
        } else {
          body.type = type
          saved = await api('/api/events', { method: 'POST', json: body })
        }
        const photoFile = fd.get('photo')
        if (photoFile instanceof File && photoFile.size > 0) {
          const upload = new FormData()
          upload.append('photo', photoFile)
          await api(`/api/events/${saved.id}/photo`, { method: 'POST', body: upload })
          // The diaper analysis is generated asynchronously server-side;
          // refresh a couple of times so it appears once ready.
          if (type === 'diaper') {
            setTimeout(refreshAll, 12000)
            setTimeout(refreshAll, 30000)
          }
        }
      }
      closeSheet()
      toast(existing ? 'Updated' : 'Saved 💜')
      refreshAll()
    } catch (err) {
      toast(err.message)
    }
  }

  $('#sheet-backdrop').classList.remove('hidden')
}

// ---------- timeline ----------

function entryEl(e) {
  const { emoji, title, sub } = describe(e)
  // Photo notes render as a caption below the image; milestone notes ARE the title.
  const subText = [sub, e.type === 'photo' || e.type === 'milestone' ? '' : e.notes].filter(Boolean).join(' · ')
  const div = document.createElement('div')
  div.className = 'entry'
  div.innerHTML = `
    <span class="entry-emoji">${emoji}</span>
    <div class="entry-body">
      <div class="entry-title">${escapeHtml(title)}</div>
      ${subText ? `<div class="entry-sub">${escapeHtml(subText)}</div>` : ''}
      ${e.photo_path ? `${e.type === 'photo' && e.notes ? `<div class="entry-sub">${escapeHtml(e.notes)}</div>` : ''}<img class="entry-photo" loading="lazy" src="/photos/${escapeHtml(e.photo_path)}" alt="">` : ''}
      ${e.analysis ? `<div class="entry-analysis">✨ ${escapeHtml(e.analysis)}</div>` : ''}
    </div>
    <div class="entry-time">${fmtTime(e.occurred_at)}<span class="by">${escapeHtml(e.created_by)}</span></div>`
  div.onclick = (ev) => {
    if (ev.target.classList.contains('entry-photo')) {
      openLightbox(ev.target.src)
      return
    }
    openSheet(e.type, { existing: e })
  }
  return div
}

// Fullscreen photo viewer: tap a timeline photo to open, tap anywhere to close.
function openLightbox(src) {
  const overlay = document.createElement('div')
  overlay.className = 'lightbox'
  const img = document.createElement('img')
  img.src = src
  img.alt = ''
  overlay.appendChild(img)
  overlay.onclick = () => overlay.remove()
  document.body.appendChild(overlay)
}

// Virtual age markers ("1 week old", monthly birthdays) computed from the
// configured birth date — never stored, so both phones always agree and
// nothing needs backfilling. Only markers whose day has arrived are shown;
// (afterIso, beforeIso] bounds them to the timeline page being rendered.
function ageMarkers(afterIso, beforeIso) {
  if (!cfg?.birthDate) return []
  const birth = new Date(`${cfg.birthDate}T12:00:00`)
  if (Number.isNaN(birth.getTime())) return []
  const now = new Date()
  const markers = []
  const add = (d, ageLabel) => {
    if (d > now) return
    // Pin to the end of its day so it sorts to the top of that day's group.
    const at = new Date(d)
    at.setHours(23, 59, 59, 999)
    const iso = at.toISOString()
    if (iso <= afterIso || iso > beforeIso) return
    markers.push({ type: '_marker', occurred_at: iso, label: `${cfg.babyName} is ${ageLabel} old!` })
  }
  for (const w of [1, 2, 3]) {
    const d = new Date(birth)
    d.setDate(d.getDate() + w * 7)
    add(d, `${w} week${w === 1 ? '' : 's'}`)
  }
  for (let m = 1; m <= 24; m++) {
    const d = new Date(birth.getFullYear(), birth.getMonth() + m, birth.getDate(), 12)
    if (d.getDate() !== birth.getDate()) d.setDate(0) // month overflow: clamp to last day
    add(d, m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} month${m === 1 ? '' : 's'}`)
  }
  return markers
}

function renderTimeline(events, { append = false } = {}) {
  const container = $('#timeline')
  if (!append) container.innerHTML = ''
  let lastDay = append ? container.dataset.lastDay : null
  for (const e of events) {
    const key = dayKey(e.occurred_at)
    if (key !== lastDay) {
      const h = document.createElement('div')
      h.className = 'day-header'
      h.textContent = fmtDayHeader(key)
      container.appendChild(h)
      lastDay = key
    }
    if (e.type === '_marker') {
      const m = document.createElement('div')
      m.className = 'milestone-marker'
      m.textContent = `🎉 ${e.label}`
      container.appendChild(m)
    } else {
      container.appendChild(entryEl(e))
    }
  }
  container.dataset.lastDay = lastDay || ''
}

async function loadTimeline({ append = false } = {}) {
  const url = append && timelineOldest
    ? `/api/events?limit=${PAGE_SIZE}&before=${encodeURIComponent(timelineOldest)}`
    : `/api/events?limit=${PAGE_SIZE}`
  const events = await api(url)
  const upper = append && timelineOldest ? timelineOldest : '9999'
  if (events.length) timelineOldest = events[events.length - 1].occurred_at
  // On the last page there is no lower cutoff — show any older markers too.
  const lower = events.length === PAGE_SIZE ? timelineOldest : ''
  const merged = [...events, ...ageMarkers(lower, upper)]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
  renderTimeline(merged, { append })
  $('#load-more').classList.toggle('hidden', events.length < PAGE_SIZE)
  if (!append && !events.length) {
    $('#timeline').innerHTML = '<div class="day-header">No entries yet — log the first one! 💜</div>'
  }
}

$('#load-more').onclick = () => loadTimeline({ append: true })

// ---------- recent entries on log screen ----------

function fmtAgo(iso) {
  const min = Math.floor((Date.now() - new Date(iso)) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

// Stamp each log button with when that thing was last logged (all diaper
// buttons share the diaper time) — a glance-check against double-logging.
async function loadLastLogged() {
  try {
    const rows = await api('/api/events/latest')
    const byType = Object.fromEntries(rows.map((r) => [r.type, r.occurred_at]))
    document.querySelectorAll('.log-btn').forEach((btn) => {
      const last = byType[btn.dataset.log]
      let el = btn.querySelector('.log-last')
      if (!el) {
        el = document.createElement('span')
        el.className = 'log-last'
        btn.appendChild(el)
      }
      el.textContent = last ? fmtAgo(last) : '—'
    })
  } catch {
    /* cosmetic — never block the log screen */
  }
}

async function loadRecent() {
  loadLastLogged()
  const events = await api('/api/events?limit=5')
  const el = $('#last-entries')
  if (!events.length) {
    el.innerHTML = ''
    return
  }
  el.innerHTML = '<h3>Recent</h3>'
  for (const e of events) el.appendChild(entryEl(e))
}

// ---------- reports ----------

const SERIES = {
  formula: { label: 'Formula', color: 'var(--c-formula)' },
  breastmilk: { label: 'Breast milk', color: 'var(--c-breastfeed)' },
  bottle: { label: 'Bottle', color: 'var(--c-formula)' },
  breastfeed: { label: 'Breastfeeding', color: 'var(--c-breastfeed)' },
  pee: { label: 'Pee', color: 'var(--c-pee)' },
  poop: { label: 'Poop', color: 'var(--c-poop)' },
}

function chartTip(svg, getText) {
  svg.addEventListener('pointerdown', (ev) => {
    const target = ev.target.closest('[data-tip]')
    document.querySelectorAll('.chart-tip').forEach((t) => t.remove())
    if (!target) return
    const tip = document.createElement('div')
    tip.className = 'chart-tip'
    tip.textContent = target.dataset.tip
    document.body.appendChild(tip)
    const pad = 8
    let x = ev.clientX - tip.offsetWidth / 2
    x = Math.max(pad, Math.min(x, window.innerWidth - tip.offsetWidth - pad))
    tip.style.left = `${x}px`
    tip.style.top = `${ev.clientY - tip.offsetHeight - 14}px`
    setTimeout(() => tip.remove(), 1800)
  })
}

function roundedTopBar(x, y, w, h, r) {
  if (h <= 0) return ''
  r = Math.min(r, w / 2, h)
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
}

// Stacked (or single-series) bar chart. days: [{date, ...}], seriesKeys map to SERIES.
function barChart(days, seriesKeys, valueOf, fmtVal) {
  const W = 520
  const H = 190
  const M = { top: 12, right: 6, bottom: 22, left: 34 }
  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const totals = days.map((d) => seriesKeys.reduce((s, k) => s + valueOf(d, k), 0))
  const max = Math.max(1, ...totals)
  const yMax = niceCeil(max)
  const slot = plotW / days.length
  const barW = Math.max(4, Math.min(26, slot - 2))
  const GAP = 2

  let bars = ''
  days.forEach((d, i) => {
    const x = M.left + i * slot + (slot - barW) / 2
    let yCursor = M.top + plotH
    seriesKeys.forEach((k, si) => {
      const v = valueOf(d, k)
      if (v <= 0) return
      const h = (v / yMax) * plotH
      const isTop = seriesKeys.slice(si + 1).every((k2) => valueOf(d, k2) <= 0)
      const y = yCursor - h
      const gap = si > 0 ? GAP : 0
      const tip = `${fmtDayHeader(d.date)} · ${SERIES[k].label}: ${fmtVal(v)}`
      bars += isTop
        ? `<path d="${roundedTopBar(x, y, barW, h - gap, 4)}" fill="${SERIES[k].color}" data-tip="${escapeHtml(tip)}"/>`
        : `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(0, h - gap)}" fill="${SERIES[k].color}" data-tip="${escapeHtml(tip)}"/>`
      yCursor = y
    })
  })

  const grid = yTicks(yMax)
    .map((t) => {
      const y = M.top + plotH - (t / yMax) * plotH
      return `<line x1="${M.left}" y1="${y}" x2="${W - M.right}" y2="${y}" stroke="var(--grid)" stroke-width="1"/>
        <text x="${M.left - 6}" y="${y + 3.5}" text-anchor="end" font-size="10" fill="var(--muted)">${t}</text>`
    })
    .join('')

  const labelEvery = Math.ceil(days.length / 7)
  const xLabels = days
    .map((d, i) => {
      if (i % labelEvery !== 0 && i !== days.length - 1) return ''
      const x = M.left + i * slot + slot / 2
      const dt = new Date(`${d.date}T12:00:00`)
      return `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${dt.getMonth() + 1}/${dt.getDate()}</text>`
    })
    .join('')

  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}">
    ${grid}
    <line x1="${M.left}" y1="${M.top + plotH}" x2="${W - M.right}" y2="${M.top + plotH}" stroke="var(--hairline)" stroke-width="1"/>
    ${bars}${xLabels}
  </svg>`
}

// ---------- growth percentiles (WHO 0-24mo LMS, see growth-curves.js) ----------

function lmsAt(table, ageMo) {
  const a = Math.max(table[0][0], Math.min(ageMo, table[table.length - 1][0]))
  let i = 0
  while (i < table.length - 2 && table[i + 1][0] <= a) i++
  const [a0, L0, M0, S0] = table[i]
  const [a1, L1, M1, S1] = table[i + 1]
  const f = a1 === a0 ? 0 : (a - a0) / (a1 - a0)
  return { L: L0 + f * (L1 - L0), M: M0 + f * (M1 - M0), S: S0 + f * (S1 - S0) }
}

function stdNormCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

function percentileFor(table, ageMo, value) {
  const { L, M, S } = lmsAt(table, ageMo)
  const z = L !== 0 ? (Math.pow(value / M, L) - 1) / (L * S) : Math.log(value / M) / S
  return 100 * stdNormCdf(z)
}

function curveValue(table, ageMo, z) {
  const { L, M, S } = lmsAt(table, ageMo)
  return L !== 0 ? M * Math.pow(1 + L * S * z, 1 / L) : M * Math.exp(S * z)
}

function fmtPercentile(p) {
  if (p < 1) return '<1st'
  if (p > 99) return '>99th'
  const n = Math.round(p)
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'
  return `${n}${suffix}`
}

const PCT_LINES = [
  [-1.88079, 'P3'], [-1.28155, 'P10'], [-0.67449, 'P25'], [0, 'P50'],
  [0.67449, 'P75'], [1.28155, 'P90'], [1.88079, 'P97'],
]

// Measurements over CDC percentile curve background. points: [{ageMo, value, iso}]
// in native units (kg / cm); fmtVal converts for display.
function growthChart(points, table, color, fmtVal) {
  const W = 520
  const H = 240
  const M = { top: 14, right: 36, bottom: 22, left: 44 }
  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const maxAge = Math.max(2, points[points.length - 1].ageMo * 1.15)
  const ages = table.map((r) => r[0]).filter((a) => a < maxAge)
  ages.push(maxAge)

  let lo = Infinity
  let hi = -Infinity
  for (const a of ages) {
    lo = Math.min(lo, curveValue(table, a, PCT_LINES[0][0]))
    hi = Math.max(hi, curveValue(table, a, PCT_LINES[PCT_LINES.length - 1][0]))
  }
  for (const p of points) {
    lo = Math.min(lo, p.value)
    hi = Math.max(hi, p.value)
  }
  const pad = (hi - lo) * 0.06
  lo -= pad
  hi += pad

  const x = (age) => M.left + (age / maxAge) * plotW
  const y = (v) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH

  let svg = ''
  for (const [z, label] of PCT_LINES) {
    const pts = ages.map((a) => `${x(a).toFixed(1)},${y(curveValue(table, a, z)).toFixed(1)}`).join(' ')
    const mid = z === 0
    svg += `<polyline points="${pts}" fill="none" stroke="var(--muted)" stroke-width="1" opacity="${mid ? 0.9 : 0.45}" ${mid ? 'stroke-dasharray="4 3"' : ''}/>`
    svg += `<text x="${W - M.right + 3}" y="${y(curveValue(table, maxAge, z)) + 3}" font-size="8" fill="var(--muted)">${label}</text>`
  }

  // x axis: weeks for a small window, months later
  if (maxAge <= 3.5) {
    for (let w = 0; w * 7 * (1 / 30.4375) <= maxAge + 0.01; w += 2) {
      const a = (w * 7) / 30.4375
      svg += `<text x="${x(a).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${w}w</text>`
    }
  } else {
    const step = maxAge > 12 ? 3 : 1
    for (let m = 0; m <= maxAge; m += step) {
      svg += `<text x="${x(m).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${m}m</text>`
    }
  }
  const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, lo + (hi - lo) * 0.85]
  for (const tv of ticks) {
    svg += `<text x="${M.left - 5}" y="${(y(tv) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${fmtVal(tv)}</text>`
  }

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.ageMo).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`
  for (const p of points) {
    const pct = percentileFor(table, p.ageMo, p.value)
    const tip = `${dayLongFmt.format(new Date(p.iso))} · ${fmtVal(p.value)} · ${fmtPercentile(pct)} pctile`
    svg += `<circle cx="${x(p.ageMo).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2" data-tip="${escapeHtml(tip)}"/>`
  }

  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}">${svg}</svg>`
}

// Percentile-over-time chart, fixed 0-100 axis, one line per series.
function pctChart(seriesList) {
  const W = 520
  const H = 180
  const M = { top: 12, right: 12, bottom: 22, left: 34 }
  const all = seriesList.flatMap((s) => s.points)
  const t0 = Math.min(...all.map((p) => +new Date(p.iso)))
  const t1 = Math.max(...all.map((p) => +new Date(p.iso)))
  const span = Math.max(t1 - t0, 1)
  const x = (p) => M.left + ((+new Date(p.iso) - t0) / span) * (W - M.left - M.right)
  const y = (v) => M.top + (H - M.top - M.bottom) * (1 - v / 100)

  let svg = ''
  for (const g of [25, 50, 75]) {
    svg += `<line x1="${M.left}" y1="${y(g)}" x2="${W - M.right}" y2="${y(g)}" stroke="var(--grid)" stroke-width="1"/>
      <text x="${M.left - 5}" y="${y(g) + 3}" text-anchor="end" font-size="9" fill="var(--muted)">${g}</text>`
  }
  for (const s of seriesList) {
    const path = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
    svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`
    for (const p of s.points) {
      const tip = `${dayLongFmt.format(new Date(p.iso))} · ${s.label}: ${fmtPercentile(p.value)} pctile`
      svg += `<circle cx="${x(p).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2" data-tip="${escapeHtml(tip)}"/>`
    }
  }
  svg += `<text x="${M.left}" y="${H - 6}" text-anchor="start" font-size="10" fill="var(--muted)">${dayLongFmt.format(new Date(t0))}</text>
    <text x="${W - M.right}" y="${H - 6}" text-anchor="end" font-size="10" fill="var(--muted)">${dayLongFmt.format(new Date(t1))}</text>`
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}">${svg}</svg>`
}

function lineChart(points, color, fmtVal) {
  const W = 520
  const H = 190
  const M = { top: 14, right: 12, bottom: 22, left: 42 }
  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const vals = points.map((p) => p.value)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pad = Math.max((hi - lo) * 0.15, hi * 0.02, 0.01)
  const yLo = lo - pad
  const yHi = hi + pad
  const t0 = new Date(points[0].occurred_at).getTime()
  const t1 = new Date(points[points.length - 1].occurred_at).getTime()
  const span = Math.max(t1 - t0, 1)
  const px = (p) => M.left + ((new Date(p.occurred_at).getTime() - t0) / span) * plotW
  const py = (p) => M.top + plotH - ((p.value - yLo) / (yHi - yLo)) * plotH

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${px(p).toFixed(1)},${py(p).toFixed(1)}`).join(' ')
  const dots = points
    .map((p) => {
      const tip = `${dayLongFmt.format(new Date(p.occurred_at))}: ${fmtVal(p.value)}`
      return `<circle cx="${px(p).toFixed(1)}" cy="${py(p).toFixed(1)}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2" data-tip="${escapeHtml(tip)}"/>`
    })
    .join('')

  const ticks = [yLo + (yHi - yLo) * 0.1, (yLo + yHi) / 2, yLo + (yHi - yLo) * 0.9]
  const grid = ticks
    .map((t) => {
      const y = M.top + plotH - ((t - yLo) / (yHi - yLo)) * plotH
      return `<line x1="${M.left}" y1="${y}" x2="${W - M.right}" y2="${y}" stroke="var(--grid)" stroke-width="1"/>
        <text x="${M.left - 6}" y="${y + 3.5}" text-anchor="end" font-size="10" fill="var(--muted)">${fmtVal(t)}</text>`
    })
    .join('')

  const first = points[0]
  const last = points[points.length - 1]
  const xLabels = `<text x="${px(first)}" y="${H - 6}" text-anchor="start" font-size="10" fill="var(--muted)">${dayLongFmt.format(new Date(first.occurred_at))}</text>
    <text x="${px(last)}" y="${H - 6}" text-anchor="end" font-size="10" fill="var(--muted)">${dayLongFmt.format(new Date(last.occurred_at))}</text>`

  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}">
    ${grid}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    ${dots}${xLabels}
  </svg>`
}

function niceCeil(v) {
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * mag >= v) return m * mag
  }
  return 10 * mag
}

function yTicks(yMax) {
  return [yMax / 2, yMax].map((t) => (Number.isInteger(t) ? t : Math.round(t * 10) / 10))
}

function legend(keys) {
  return `<div class="legend">${keys
    .map((k) => `<span><i style="background:${SERIES[k].color}"></i>${SERIES[k].label}</span>`)
    .join('')}</div>`
}

function chartCard(title, sub, keys, svg) {
  return `<div class="chart-card"><h3>${title}</h3><div class="chart-sub">${sub}</div>${keys.length > 1 ? legend(keys) : ''}${svg}</div>`
}

// Fill gaps so charts show every calendar day between first entry and today.
function fillDays(days) {
  if (!days.length) return []
  const byDate = new Map(days.map((d) => [d.date, d]))
  const out = []
  const cursor = new Date(`${days[0].date}T12:00:00`)
  const today = dayKey(new Date().toISOString())
  while (true) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    out.push(
      byDate.get(key) || { date: key, breastfeedCount: 0, breastfeedMin: 0, formulaCount: 0, formulaMl: 0, breastmilkMl: 0, pee: 0, poop: 0 }
    )
    if (key >= today) break
    cursor.setDate(cursor.getDate() + 1)
  }
  return out.slice(-30)
}

async function loadReports() {
  const { days: rawDays, weights, heights } = await api('/api/reports/daily?days=30')
  const el = $('#reports')
  if (!rawDays.length && !weights.length && !heights.length) {
    el.innerHTML = '<div class="day-header">No data yet — reports appear once you start logging.</div>'
    return
  }
  const days = fillDays(rawDays)
  const todayKey = dayKey(new Date().toISOString())
  const today = days.find((d) => d.date === todayKey) || { breastfeedCount: 0, formulaMl: 0, formulaCount: 0, breastmilkMl: 0, pee: 0, poop: 0 }
  const lastWeight = weights[weights.length - 1]

  const unit = localStorage.getItem('weightUnit') || 'lb'
  const fmtW = (g) => (unit === 'kg' ? `${(g / 1000).toFixed(2)} kg` : `${(g / 453.592).toFixed(2)} lb`)

  const tilesHtml = `<div class="tiles">
    <div class="tile"><div class="tile-label">🤱 Breastfeeds today</div><div class="tile-value">${today.breastfeedCount}</div></div>
    <div class="tile"><div class="tile-label">🍼 Bottle today</div><div class="tile-value">${today.formulaMl} ml</div><div class="tile-sub">${today.formulaCount} feed${today.formulaCount === 1 ? '' : 's'}${today.breastmilkMl ? ` · ${today.breastmilkMl} ml breast milk` : ''}</div></div>
    <div class="tile"><div class="tile-label">💧 Pee today</div><div class="tile-value">${today.pee}</div></div>
    <div class="tile"><div class="tile-label">💩 Poop today</div><div class="tile-value">${today.poop}</div></div>
  </div>`

  let feedingHtml = ''
  if (days.some((d) => d.formulaMl > 0)) {
    feedingHtml += chartCard('Bottle per day', 'ml by bottle — formula vs pumped breast milk', ['formula', 'breastmilk'],
      barChart(days, ['formula', 'breastmilk'],
        (d, k) => (k === 'breastmilk' ? d.breastmilkMl || 0 : d.formulaMl - (d.breastmilkMl || 0)), (v) => `${v} ml`))
  }
  feedingHtml += chartCard('Feeds per day', 'breastfeeding sessions + bottle feeds', ['breastfeed', 'bottle'],
    barChart(days, ['breastfeed', 'bottle'], (d, k) => (k === 'breastfeed' ? d.breastfeedCount : d.formulaCount), (v) => `${v}`))

  const diapersHtml = chartCard('Diapers per day', 'pee and poop counts', ['pee', 'poop'],
    barChart(days, ['pee', 'poop'], (d, k) => d[k], (v) => `${v}`))

  const lastHeight = heights[heights.length - 1]
  const hUnit = localStorage.getItem('heightUnit') || 'in'
  const fmtH = (cm) => (hUnit === 'cm' ? `${cm.toFixed(1)} cm` : `${(cm / 2.54).toFixed(1)} in`)
  let growthHtml = ''

  const GROWTH_LMS = typeof GROWTH_LMS_BY_SEX !== 'undefined' ? GROWTH_LMS_BY_SEX[cfg.babySex] : null
  if (cfg.birthDate && GROWTH_LMS && (weights.length || heights.length)) {
    const birth = new Date(`${cfg.birthDate}T12:00:00`)
    const ageMo = (iso) => Math.max(0, (new Date(iso) - birth) / (86400000 * 30.4375))
    const wg = weights.map((w) => ({ iso: w.occurred_at, value: w.weight_g / 1000, ageMo: ageMo(w.occurred_at) }))
    const hg = heights.map((h) => ({ iso: h.occurred_at, value: h.height_cm, ageMo: ageMo(h.occurred_at) }))
    const lastW = wg[wg.length - 1]
    const lastH = hg[hg.length - 1]

    growthHtml += `<div class="tiles">
      ${lastW ? `<div class="tile"><div class="tile-label">⚖️ Weight percentile</div><div class="tile-value">${fmtPercentile(percentileFor(GROWTH_LMS.weight, lastW.ageMo, lastW.value))}</div><div class="tile-sub">${fmtWeight(lastW.value * 1000)}</div></div>` : ''}
      ${lastH ? `<div class="tile"><div class="tile-label">📏 Height percentile</div><div class="tile-value">${fmtPercentile(percentileFor(GROWTH_LMS.length, lastH.ageMo, lastH.value))}</div><div class="tile-sub">${fmtHeight(lastH.value)}</div></div>` : ''}
    </div>`

    const curveLabel = `on WHO ${cfg.babySex}s’ growth standards (3rd–97th percentile) — tap a dot for the exact percentile`
    if (wg.length) {
      growthHtml += chartCard('Weight', curveLabel, [],
        growthChart(wg, GROWTH_LMS.weight, 'var(--c-weight)', (kg) => fmtW(kg * 1000)))
    }
    if (hg.length) {
      growthHtml += chartCard('Height', curveLabel, [],
        growthChart(hg, GROWTH_LMS.length, 'var(--c-breastfeed)', (cm) => fmtH(cm)))
    }
    if (wg.length >= 2 || hg.length >= 2) {
      const series = []
      if (wg.length >= 2) series.push({ label: 'Weight', color: 'var(--c-weight)', points: wg.map((p) => ({ iso: p.iso, value: percentileFor(GROWTH_LMS.weight, p.ageMo, p.value) })) })
      if (hg.length >= 2) series.push({ label: 'Height', color: 'var(--c-breastfeed)', points: hg.map((p) => ({ iso: p.iso, value: percentileFor(GROWTH_LMS.length, p.ageMo, p.value) })) })
      growthHtml += `<div class="chart-card"><h3>Percentile history</h3><div class="chart-sub">tracking against the curves over time</div>
        <div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>
        ${pctChart(series)}</div>`
    }
  } else {
    // No birth date configured: plain measurement charts.
    if (weights.length >= 2) {
      growthHtml += chartCard('Weight', lastWeight ? `latest: ${fmtWeight(lastWeight.weight_g)}` : '', [],
        lineChart(weights.map((w) => ({ occurred_at: w.occurred_at, value: w.weight_g })), 'var(--c-weight)', (g) => fmtW(g)))
    } else if (lastWeight) {
      growthHtml += `<div class="chart-card"><h3>Weight</h3><div class="chart-sub">latest: ${fmtWeight(lastWeight.weight_g)} — the curve appears after a second measurement</div></div>`
    }
    if (heights.length >= 2) {
      growthHtml += chartCard('Height', lastHeight ? `latest: ${fmtHeight(lastHeight.height_cm)}` : '', [],
        lineChart(heights.map((h) => ({ occurred_at: h.occurred_at, value: h.height_cm })), 'var(--c-breastfeed)', (cm) => fmtH(cm)))
    } else if (lastHeight) {
      growthHtml += `<div class="chart-card"><h3>Height</h3><div class="chart-sub">latest: ${fmtHeight(lastHeight.height_cm)} — the curve appears after a second measurement</div></div>`
    }
  }
  if (!growthHtml) growthHtml = '<div class="chart-card"><h3>Growth</h3><div class="chart-sub">no measurements yet</div></div>'

  const historyHtml = `<div class="report-table-wrap"><table class="report-table">
    <tr><th>Day</th><th>🤱</th><th>🍼 ml</th><th>💧</th><th>💩</th></tr>
    ${[...days].reverse().slice(0, 14).map((d) =>
      `<tr><td>${fmtDayHeader(d.date)}</td><td>${d.breastfeedCount}</td><td>${d.formulaMl}${d.breastmilkMl ? ` <span class="bm-share">(${d.breastmilkMl} bm)</span>` : ''}</td><td>${d.pee}</td><td>${d.poop}</td></tr>`
    ).join('')}
  </table></div>
  <div class="chart-sub">🍼 ml is total bottle volume; (bm) is the breast-milk share of it</div>`

  const sections = [
    { id: 'today', label: 'Today', html: tilesHtml },
    { id: 'feeding', label: 'Feeding', html: feedingHtml },
    { id: 'diapers', label: 'Diapers', html: diapersHtml },
    { id: 'weight', label: 'Growth', html: growthHtml },
    { id: 'history', label: 'History', html: historyHtml },
  ]
  let active = localStorage.getItem('reportsTab') || 'today'
  if (!sections.some((s) => s.id === active)) active = 'today'

  el.innerHTML =
    `<div class="subtabs">${sections
      .map((s) => `<button data-rtab="${s.id}" class="${s.id === active ? 'active' : ''}">${s.label}</button>`)
      .join('')}</div>` +
    sections
      .map((s) => `<div class="rsection${s.id === active ? '' : ' hidden'}" id="rsec-${s.id}">${s.html}</div>`)
      .join('')

  el.querySelectorAll('[data-rtab]').forEach((btn) => {
    btn.onclick = () => {
      localStorage.setItem('reportsTab', btn.dataset.rtab)
      el.querySelectorAll('[data-rtab]').forEach((b) => b.classList.toggle('active', b === btn))
      el.querySelectorAll('.rsection').forEach((sec) => sec.classList.toggle('hidden', sec.id !== `rsec-${btn.dataset.rtab}`))
    }
  })
  el.querySelectorAll('.chart-svg').forEach((svg) => chartTip(svg))
}

// ---------- sleep cycle ----------

const SLEEP_COLORS = { asleep: 'var(--c-formula)', awake: 'var(--c-pee)' }
const FEED_AWAKE_MS = 15 * 60000 // assumed awake window for feeds with no duration

async function loadSleep() {
  const feeds = await api('/api/sleep/feeds?days=14')
  const el = $('#sleep')
  if (feeds.length < 2) {
    el.innerHTML = '<div class="day-header">The sleep view appears after a couple of logged feedings. 😴</div>'
    return
  }
  const now = Date.now()
  const t = (iso) => new Date(iso).getTime()

  // Awake segments: each feeding window, plus any between-feed gap marked awake.
  const segs = []
  const gaps = []
  feeds.forEach((f, i) => {
    const start = t(f.occurred_at)
    const winEnd = start + (f.duration_min ? f.duration_min * 60000 : FEED_AWAKE_MS)
    const next = feeds[i + 1]
    const nextStart = next ? t(next.occurred_at) : null
    segs.push([start, Math.min(winEnd, nextStart ?? now)])
    if (next && nextStart > winEnd) {
      // Formula shortly after a breastfeed is a top-up — one continuous awake
      // session, the baby has no time to go back down in between.
      const topUp = f.type === 'breastfeed' && next.type === 'formula' && nextStart - winEnd <= 60 * 60000
      gaps.push({ start: winEnd, end: nextStart, feedId: f.id, awake: !!f.awake_after, locked: topUp })
      if (topUp || f.awake_after) segs.push([winEnd, nextStart])
    }
  })
  segs.sort((a, b) => a[0] - b[0])
  const awake = []
  for (const s of segs) {
    const last = awake[awake.length - 1]
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1])
    else awake.push([...s])
  }

  // One row per local day, today first, back to the first feed in range.
  const firstFeed = t(feeds[0].occurred_at)
  const rows = []
  for (let d = 0; d < 14; d++) {
    const day = new Date(now)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - d)
    const ds = day.getTime()
    if (ds + 86400000 <= firstFeed) break
    rows.push({
      ds,
      de: Math.min(ds + 86400000, now),
      label: d === 0 ? 'Today' : `${day.getMonth() + 1}/${day.getDate()}`,
    })
  }

  // Today's stats: total sleep and the longest asleep stretch.
  const todayRow = rows[0]
  let awakeMs = 0
  let longest = 0
  let cursor = todayRow.ds
  for (const [s, e] of awake) {
    const cs = Math.max(s, todayRow.ds)
    const ce = Math.min(e, todayRow.de)
    if (ce <= cs) continue
    awakeMs += ce - cs
    longest = Math.max(longest, cs - cursor)
    cursor = Math.max(cursor, ce)
  }
  longest = Math.max(longest, todayRow.de - cursor)
  const sleepMs = todayRow.de - todayRow.ds - awakeMs

  const W = 520
  const LEFT = 46
  const RIGHT = 8
  const TOP = 18
  const rowH = 16
  const gapY = 7
  const plotW = W - LEFT - RIGHT
  const H = TOP + rows.length * (rowH + gapY)
  const x = (row, ms) => LEFT + ((ms - row.ds) / 86400000) * plotW

  let svg = ''
  for (const h of [0, 6, 12, 18, 24]) {
    const xx = LEFT + (h / 24) * plotW
    const label = h === 0 || h === 24 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`
    svg += `<text x="${xx}" y="10" text-anchor="middle" font-size="9" fill="var(--muted)">${label}</text>
      <line x1="${xx}" y1="${TOP - 3}" x2="${xx}" y2="${H - gapY + 3}" stroke="var(--grid)" stroke-width="1"/>`
  }
  rows.forEach((r, i) => {
    const y = TOP + i * (rowH + gapY)
    svg += `<text x="${LEFT - 6}" y="${y + rowH / 2 + 3}" text-anchor="end" font-size="9" fill="var(--muted)">${r.label}</text>`
    svg += `<rect x="${LEFT}" y="${y}" width="${Math.max(2, x(r, r.de) - LEFT)}" height="${rowH}" rx="4" fill="${SLEEP_COLORS.asleep}"/>`
    for (const [s, e] of awake) {
      const cs = Math.max(s, r.ds)
      const ce = Math.min(e, r.de)
      if (ce > cs) svg += `<rect x="${x(r, cs).toFixed(1)}" y="${y}" width="${Math.max(1, x(r, ce) - x(r, cs)).toFixed(1)}" height="${rowH}" fill="${SLEEP_COLORS.awake}"/>`
    }
    for (const f of feeds) {
      const ft = t(f.occurred_at)
      if (ft >= r.ds && ft < r.de) svg += `<line x1="${x(r, ft).toFixed(1)}" y1="${y - 1.5}" x2="${x(r, ft).toFixed(1)}" y2="${y + rowH + 1.5}" stroke="var(--c-feed)" stroke-width="2"/>`
    }
    gaps.forEach((g, gi) => {
      const cs = Math.max(g.start, r.ds)
      const ce = Math.min(g.end, r.de)
      if (ce > cs) svg += `<rect x="${x(r, cs).toFixed(1)}" y="${y}" width="${(x(r, ce) - x(r, cs)).toFixed(1)}" height="${rowH}" fill="transparent" style="cursor:pointer" data-gap="${gi}"/>`
    })
  })

  el.innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="tile-label">😴 Est. sleep today</div><div class="tile-value">${fmtDur(sleepMs)}</div></div>
      <div class="tile"><div class="tile-label">🌙 Longest stretch today</div><div class="tile-value">${fmtDur(longest)}</div></div>
    </div>
    <div class="chart-card">
      <h3>Sleep by day</h3>
      <div class="chart-sub">assumes asleep between feedings (a bottle top-up within an hour of breastfeeding counts as awake) — tap a stretch to flip it</div>
      <div class="legend">
        <span><i style="background:${SLEEP_COLORS.asleep}"></i>Asleep</span>
        <span><i style="background:${SLEEP_COLORS.awake}"></i>Awake</span>
        <span><i style="background:var(--c-feed);width:3px;border-radius:0"></i>Feeding</span>
      </div>
      <svg class="chart-svg" viewBox="0 0 ${W} ${H}"></svg>
    </div>`
  el.querySelector('svg').innerHTML = svg
  el.querySelector('svg').addEventListener('click', async (ev) => {
    const target = ev.target.closest('[data-gap]')
    if (!target) return
    const g = gaps[Number(target.dataset.gap)]
    if (g.locked) {
      toast('Breastfeeding → bottle top-ups count as awake')
      return
    }
    try {
      await api(`/api/events/${g.feedId}`, { method: 'PATCH', json: { awake_after: g.awake ? 0 : 1 } })
      toast(g.awake ? 'Marked asleep 😴' : 'Marked awake ☀️')
      loadSleep()
    } catch (err) {
      toast(err.message)
    }
  })
}

// ---------- push notifications ----------

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone

async function enableNudges() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('Push not supported in this browser')
    return
  }
  if (isIOS && !isStandalone) {
    $('#ios-hint').classList.remove('hidden')
    return
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    toast('Notifications were declined')
    return
  }
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey),
  })
  await api('/api/push/subscribe', { method: 'POST', json: sub.toJSON() })
  localStorage.setItem('nudgesEnabled', '1')
  $('#nudge-btn').classList.add('enabled')
  toast('Nudges enabled 🔔')
}

// ---------- navigation & boot ----------

const views = { log: loadRecent, timeline: () => loadTimeline(), reports: loadReports, sleep: loadSleep }

// The app often sits open on the log screen for hours — keep the
// "last logged" stamps from going stale.
setInterval(() => {
  if (!$('#view-log').classList.contains('hidden')) loadLastLogged()
}, 60000)

function switchView(name) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name))
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'))
  $(`#view-${name}`).classList.remove('hidden')
  views[name]()
}

function refreshAll() {
  const active = document.querySelector('.nav-btn.active').dataset.view
  views[active]()
}

// Theme toggle: overrides the system appearance and persists per device.
function effectiveTheme() {
  return (
    localStorage.getItem('theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  )
}
function applyTheme() {
  const forced = localStorage.getItem('theme')
  if (forced) document.documentElement.dataset.theme = forced
  else delete document.documentElement.dataset.theme
  $('#theme-btn').textContent = effectiveTheme() === 'dark' ? '☀️' : '🌙'
}
$('#theme-btn').onclick = () => {
  localStorage.setItem('theme', effectiveTheme() === 'dark' ? 'light' : 'dark')
  applyTheme()
}
applyTheme()

document.querySelectorAll('.nav-btn').forEach((b) => (b.onclick = () => switchView(b.dataset.view)))
// Diapers save instantly with the current time — the toast offers an edit.
async function quickDiaper(kind) {
  try {
    const e = await api('/api/events', { method: 'POST', json: { type: 'diaper', kind } })
    const label = { pee: '💧 Pee', poop: '💩 Poop', both: '💧💩 Diaper' }[kind]
    toast(`${label} saved · tap to edit`, () => openSheet('diaper', { existing: e }))
    refreshAll()
  } catch (err) {
    toast(err.message)
  }
}

document.querySelectorAll('.log-btn').forEach((b) => {
  b.onclick = () =>
    b.dataset.log === 'diaper' ? quickDiaper(b.dataset.kind) : openSheet(b.dataset.log, { kind: b.dataset.kind })
})
$('#nudge-btn').onclick = enableNudges
$('#ios-hint-dismiss').onclick = () => {
  $('#ios-hint').classList.add('hidden')
  localStorage.setItem('iosHintDismissed', '1')
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js')
  cfg = await fetch('/api/config').then((r) => r.json())
  if (cfg.appName) {
    $('#app-title').textContent = cfg.appName
    document.title = cfg.appName
  }
  if (!cfg.user) {
    showLogin()
    return
  }
  $('#login').classList.add('hidden')
  $('#app').classList.remove('hidden')
  $('#whoami').textContent = cfg.user
  if (localStorage.getItem('nudgesEnabled')) $('#nudge-btn').classList.add('enabled')
  if (isIOS && !isStandalone && !localStorage.getItem('iosHintDismissed')) {
    $('#ios-hint').classList.remove('hidden')
  }
  switchView('log')
}

boot()
