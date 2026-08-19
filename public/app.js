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

// POST a FormData with upload-progress reporting. fetch() can't observe upload
// progress, so photo uploads go through XHR. onProgress gets a 0..1 fraction
// (only while the body is still uploading; null once the server is processing).
function apiUpload(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.upload.onprogress = (e) => {
      if (onProgress) onProgress(e.lengthComputable ? e.loaded / e.total : null)
    }
    xhr.upload.onload = () => { if (onProgress) onProgress(null) } // body sent; server working
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch { /* non-JSON error body */ }
      if (xhr.status === 401) { showLogin(); reject(new Error('Not logged in')); return }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new Error(data.error || 'Request failed'))
    }
    xhr.onerror = () => reject(new Error('Upload failed — check your connection'))
    xhr.send(formData)
  })
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

function fmtHead(cm) {
  return `${cm.toFixed(1)} cm (${(cm / 2.54).toFixed(1)} in)`
}

function describe(e) {
  switch (e.type) {
    case 'breastfeed':
      return { emoji: '🤱', title: 'Breastfeeding', sub: e.duration_min ? `${e.duration_min} min` : '' }
    case 'formula':
      return { emoji: '🍼', title: `Bottle · ${e.kind === 'breastmilk' ? 'Breast milk' : 'Formula'}`, sub: `${e.amount_ml} mL` }
    case 'pump':
      return { emoji: '🫙', title: 'Pumping', sub: `${e.amount_ml} mL` }
    case 'diaper': {
      const label = { pee: 'Pee', poop: 'Poop', both: 'Pee + poop' }[e.kind] || e.kind
      const emoji = { pee: '💧', poop: '💩', both: '💧💩' }[e.kind] || '💧'
      return { emoji, title: `Diaper · ${label}`, sub: '' }
    }
    case 'weight':
      return { emoji: '⚖️', title: 'Weight', sub: fmtWeight(e.weight_g) }
    case 'height':
      return { emoji: '📏', title: 'Height', sub: fmtHeight(e.height_cm) }
    case 'head':
      return { emoji: '🧠', title: 'Head', sub: fmtHead(e.head_cm) }
    case 'photo':
      return { emoji: '📷', title: 'Photo', sub: '' }
    case 'milestone':
      return { emoji: '🌟', title: e.notes || 'Milestone', sub: '' }
    default:
      return { emoji: '❓', title: e.type, sub: '' }
  }
}

// ms overrides the default dwell - spoken answers are a whole sentence and
// need longer on screen than a "Saved 💜".
function toast(msg, onTap, ms) {
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
  toast._t = setTimeout(() => el.classList.add('hidden'), ms || (onTap ? 5000 : 2200))
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

$('#sheet-close').addEventListener('click', closeSheet)

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
  return `<div class="upload-progress hidden" id="upload-progress" role="progressbar" aria-label="Uploading photo">
    <div class="upload-progress-bar" id="upload-progress-bar"></div>
  </div>
  <div class="sheet-actions">
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
    pump: '🫙 Pumping',
    diaper: '💧 Diaper',
    weight: '⚖️ Weight',
    height: '📏 Height',
    head: '🧠 Head circumference',
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
    // Breast milk is pumped in odd amounts, so step by 1 ml; formula stays at 5.
    const stepMl = selectedKind === 'breastmilk' ? 1 : 5
    fields = `${fieldTime(timeVal)}
      <input type="hidden" name="kind" value="${selectedKind}">
      <div class="seg" id="kind-seg">
        <button type="button" data-kind="formula">Formula</button>
        <button type="button" data-kind="breastmilk">Breast milk</button>
      </div>
      <label>Amount (mL)
        <div class="stepper">
          <button type="button" data-step="-1">−</button>
          <input type="number" name="amount_ml" inputmode="numeric" min="${stepMl}" step="${stepMl}" value="${last}" required>
          <button type="button" data-step="1">+</button>
        </div>
      </label>
      ${fieldNotes(existing?.notes)}`
  } else if (type === 'pump') {
    const last = existing?.amount_ml ?? Number(localStorage.getItem('lastPumpMl') || 60)
    fields = `${fieldTime(timeVal)}
      <label>Amount pumped (mL)
        <div class="stepper">
          <button type="button" data-step="-1">−</button>
          <input type="number" name="amount_ml" inputmode="numeric" min="1" step="1" value="${last}" required>
          <button type="button" data-step="1">+</button>
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
      <label><span>Height (<span id="hunit-label">${unit}</span>)</span><input type="number" name="height" inputmode="decimal" min="0" step="0.1" value="${cm ? (unit === 'cm' ? cm.toFixed(1) : (cm / 2.54).toFixed(1)) : ''}" required></label>
      ${fieldNotes(existing?.notes)}`
  } else if (type === 'head') {
    const unit = localStorage.getItem('headUnit') || 'cm'
    const cm = existing?.head_cm
    fields = `${fieldTime(timeVal)}
      <input type="hidden" name="unit" value="${unit}">
      <div class="seg" id="headunit-seg">
        <button type="button" data-unit="in">inches</button>
        <button type="button" data-unit="cm">cm</button>
      </div>
      <label><span>Head circumference (<span id="headunit-label">${unit}</span>)</span><input type="number" name="head" inputmode="decimal" min="0" step="0.1" value="${cm ? (unit === 'cm' ? cm.toFixed(1) : (cm / 2.54).toFixed(1)) : ''}" required></label>
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
      const stepMl = sheet.querySelector('[name=kind]')?.value === 'breastmilk' ? 1 : 5
      input.dataset.touched = '1'
      input.value = Math.max(stepMl, (Number(input.value) || 0) + stepMl * Number(btn.dataset.step))
    }
  })

  // Anticipate the formula amount: default to whatever the last formula feed
  // was (from the server, so it syncs across both phones).
  if ((type === 'formula' || type === 'pump') && !existing) {
    const amountInput = sheet.querySelector('[name=amount_ml]')
    amountInput.addEventListener('input', () => (amountInput.dataset.touched = '1'))
    api(`/api/events?limit=1&type=${type}`)
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
      const amount = sheet.querySelector('[name=amount_ml]')
      if (amount) {
        const stepMl = v === 'breastmilk' ? 1 : 5
        amount.min = stepMl
        amount.step = stepMl
      }
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

  const headunitSeg = sheet.querySelector('#headunit-seg')
  if (headunitSeg) {
    const sync = () => {
      const v = sheet.querySelector('[name=unit]').value
      headunitSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.unit === v))
      sheet.querySelector('#headunit-label').textContent = v
    }
    headunitSeg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const input = sheet.querySelector('[name=head]')
        const prev = sheet.querySelector('[name=unit]').value
        if (input.value && prev !== b.dataset.unit) {
          input.value = (b.dataset.unit === 'cm' ? Number(input.value) * 2.54 : Number(input.value) / 2.54).toFixed(1)
        }
        sheet.querySelector('[name=unit]').value = b.dataset.unit
        localStorage.setItem('headUnit', b.dataset.unit)
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

  let submitting = false
  sheet.onsubmit = async (e) => {
    e.preventDefault()
    if (submitting) return // guard against double-tap / Enter re-submits
    submitting = true
    const fd = new FormData(sheet)
    const occurredAt = new Date(fd.get('occurred_at')).toISOString()

    // Busy-state UI: disable Save, and for photo uploads show a progress bar.
    const saveBtn = sheet.querySelector('.save')
    const progress = sheet.querySelector('#upload-progress')
    const progressBar = sheet.querySelector('#upload-progress-bar')
    const photoToUpload = fd.get('photo')
    const hasUpload = photoToUpload instanceof File && photoToUpload.size > 0
    saveBtn.disabled = true
    saveBtn.textContent = hasUpload ? 'Uploading…' : 'Saving…'
    const onProgress = (frac) => {
      progress.classList.remove('hidden')
      if (frac == null) {
        // Body sent, server processing — fill the bar and let it pulse.
        progressBar.style.width = '100%'
        progress.classList.add('processing')
      } else {
        progress.classList.remove('processing')
        progressBar.style.width = `${Math.round(frac * 100)}%`
      }
    }

    try {
      if (type === 'photo' && !existing) {
        const upload = new FormData()
        upload.append('photo', fd.get('photo'))
        upload.append('occurred_at', occurredAt)
        upload.append('notes', fd.get('notes') || '')
        await apiUpload('/api/photos', upload, onProgress)
      } else {
        const body = { occurred_at: occurredAt, notes: fd.get('notes') || null }
        if (type === 'breastfeed') body.duration_min = fd.get('duration_min') ? Number(fd.get('duration_min')) : null
        if (type === 'formula') {
          body.amount_ml = Number(fd.get('amount_ml'))
          body.kind = fd.get('kind') || 'formula'
          localStorage.setItem('lastFormulaMl', body.amount_ml)
          localStorage.setItem('lastBottleKind', body.kind)
        }
        if (type === 'pump') {
          body.amount_ml = Number(fd.get('amount_ml'))
          localStorage.setItem('lastPumpMl', body.amount_ml)
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
        if (type === 'head') {
          const v = Number(fd.get('head'))
          body.head_cm = Math.round((fd.get('unit') === 'cm' ? v : v * 2.54) * 10) / 10
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
          await apiUpload(`/api/events/${saved.id}/photo`, upload, onProgress)
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
      // Re-enable the form so the user can retry.
      submitting = false
      saveBtn.disabled = false
      saveBtn.textContent = 'Save'
      progress.classList.add('hidden')
      progress.classList.remove('processing')
      progressBar.style.width = '0%'
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

// Fullscreen photo viewer: tap a timeline or gallery photo to open, tap
// anywhere to close. caption is optional (the Photos gallery passes the
// event's notes; the timeline already shows notes inline above the thumbnail
// so it doesn't need one here).
function openLightbox(src, caption) {
  const overlay = document.createElement('div')
  overlay.className = 'lightbox'
  const img = document.createElement('img')
  img.src = src
  img.alt = ''
  overlay.appendChild(img)
  if (caption) {
    const cap = document.createElement('div')
    cap.className = 'lightbox-caption'
    cap.textContent = caption
    overlay.appendChild(cap)
  }
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
  const name = cfg.babyName
  const markers = []
  const add = (d, label) => {
    if (d > now) return
    // Pin to the end of its day so it sorts to the top of that day's group.
    const at = new Date(d)
    at.setHours(23, 59, 59, 999)
    const iso = at.toISOString()
    if (iso <= afterIso || iso > beforeIso) return
    markers.push({ type: '_marker', occurred_at: iso, label })
  }
  for (const w of [1, 2, 3]) {
    const d = new Date(birth)
    d.setDate(d.getDate() + w * 7)
    add(d, `${name} is ${w} week${w === 1 ? '' : 's'} old!`)
  }
  for (let m = 1; m <= 24; m++) {
    const d = new Date(birth.getFullYear(), birth.getMonth() + m, birth.getDate(), 12)
    if (d.getDate() !== birth.getDate()) d.setDate(0) // month overflow: clamp to last day
    add(d, `${name} is ${m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} month${m === 1 ? '' : 's'}`} old!`)
  }
  // The odd-unit ones land between the calendar markers — little surprises.
  const HOUR = 3600000
  for (const [ms, label] of [
    [100 * 24 * HOUR, `${name} is 100 days old! 💯`],
    [1000 * HOUR, `${name} is 1,000 hours old! ⏰`],
    [10000 * HOUR, `${name} is 10,000 hours old! ⏰`],
    [1000000 * 60000, `${name} is 1,000,000 minutes old! 🤯`],
  ]) {
    add(new Date(birth.getTime() + ms), label)
  }
  return markers
}

// Data-driven fun milestones (Nth diaper, weight comparisons, …) computed
// server-side from the full history. Cached per refresh cycle.
let autoMilestones = null

async function funMilestones(afterIso, beforeIso) {
  if (autoMilestones == null) {
    try {
      autoMilestones = await api('/api/milestones/auto')
    } catch {
      autoMilestones = []
    }
  }
  return autoMilestones
    .filter((m) => m.occurred_at > afterIso && m.occurred_at <= beforeIso)
    .map((m) => ({ type: '_marker', occurred_at: m.occurred_at, label: m.label }))
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

let timelineFilter = ''

$('#timeline-filter').onclick = (ev) => {
  const chip = ev.target.closest('.filter-chip')
  if (!chip) return
  timelineFilter = chip.dataset.filter
  document.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip))
  timelineOldest = null
  loadTimeline()
}

async function loadTimeline({ append = false } = {}) {
  const typeParam = timelineFilter ? `&type=${timelineFilter}` : ''
  const url = append && timelineOldest
    ? `/api/events?limit=${PAGE_SIZE}${typeParam}&before=${encodeURIComponent(timelineOldest)}`
    : `/api/events?limit=${PAGE_SIZE}${typeParam}`
  const events = await api(url)
  const upper = append && timelineOldest ? timelineOldest : '9999'
  if (events.length) timelineOldest = events[events.length - 1].occurred_at
  // On the last page there is no lower cutoff — show any older markers too.
  const lower = events.length === PAGE_SIZE ? timelineOldest : ''
  // Markers stay out of single-type views, except the milestone filter,
  // where the auto ones belong.
  const showMarkers = !timelineFilter || timelineFilter === 'milestone'
  const merged = [
    ...events,
    ...(showMarkers ? ageMarkers(lower, upper) : []),
    ...(showMarkers ? await funMilestones(lower, upper) : []),
  ].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
  renderTimeline(merged, { append })
  $('#load-more').classList.toggle('hidden', events.length < PAGE_SIZE)
  if (!append && !events.length) {
    $('#timeline').innerHTML = '<div class="day-header">No entries yet — log the first one! 💜</div>'
  }
}

$('#load-more').onclick = () => loadTimeline({ append: true })

// ---------- photos gallery ----------
//
// Photo-type events only (photos attached to diapers/other events are mostly
// diaper-analysis shots and are excluded - the server-side ?type=photo filter
// does that). Grouped by "baby month" (birth to the day before the next
// month-iversary, clamped to month-end for a birth on the 29th-31st), with a
// pinned strip of the shots that landed exactly on a month-iversary day.
// Falls back to calendar-month grouping when no birth date is configured.

const PHOTO_PAGE_SIZE = 200
let photosOldest = null
let photosLoaded = [] // accumulated pages, newest first

// n=0 is birth itself; n>=1 is the n-th month-iversary, clamped to the last
// day of the target month when the birth day doesn't exist there (e.g. a
// birth on the 31st in a 30-day month) - same clamp ageMarkers() uses.
function monthAnniversary(birth, n) {
  if (n <= 0) return new Date(birth.getFullYear(), birth.getMonth(), birth.getDate(), 12)
  const d = new Date(birth.getFullYear(), birth.getMonth() + n, birth.getDate(), 12)
  if (d.getDate() !== birth.getDate()) d.setDate(0)
  return d
}

// Which baby-month bucket a timestamp falls in: -1 for anything before birth
// (a single bucket, however far back), otherwise the n with
// monthAnniversary(n) <= d < monthAnniversary(n+1) - "Month n+1" in the UI.
function monthIndexOf(iso, birth) {
  const d = new Date(iso)
  if (d < monthAnniversary(birth, 0)) return -1
  let n = (d.getFullYear() - birth.getFullYear()) * 12 + (d.getMonth() - birth.getMonth())
  if (n < 0) n = 0
  while (monthAnniversary(birth, n) > d) n--
  while (monthAnniversary(birth, n + 1) <= d) n++
  return n
}

// True when a timestamp lands exactly on a month-iversary day (month 1+,
// never the birth day itself).
function isMonthlyBirthday(iso, birth) {
  const n = monthIndexOf(iso, birth)
  if (n < 1) return false
  const d = new Date(iso)
  const anniv = monthAnniversary(birth, n)
  return d.getFullYear() === anniv.getFullYear() && d.getMonth() === anniv.getMonth() && d.getDate() === anniv.getDate()
}

const monthDayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

function monthGroupLabel(n, birth) {
  if (n < 0) return { label: 'Before birth', sub: `through ${monthDayFmt.format(monthAnniversary(birth, 0))}` }
  const start = monthAnniversary(birth, n)
  const end = new Date(monthAnniversary(birth, n + 1).getTime() - 86400000)
  return { label: `Month ${n + 1}`, sub: `${monthDayFmt.format(start)} - ${monthDayFmt.format(end)}` }
}

function calendarGroupLabel(key) {
  const [y, m] = key.split('-').map(Number)
  return { label: monthYearFmt.format(new Date(y, m - 1, 1, 12)), sub: '' }
}

function photoTile(e, badge) {
  return `<button type="button" class="photo-tile" data-id="${e.id}">
    <img loading="lazy" src="/photos/thumb/${escapeHtml(e.photo_path)}" alt="">
    ${badge ? '<span class="photo-badge" title="Monthly birthday">🎂</span>' : ''}
  </button>`
}

function groupPhotos(events, birth) {
  const groups = []
  let lastKey = null
  for (const e of events) {
    const key = birth ? monthIndexOf(e.occurred_at, birth) : dayKey(e.occurred_at).slice(0, 7)
    if (key !== lastKey) {
      groups.push({ key, items: [] })
      lastKey = key
    }
    groups[groups.length - 1].items.push(e)
  }
  return groups
}

function renderPhotos(events) {
  const el = $('#photos')
  if (!events.length) {
    el.innerHTML = '<div class="day-header">No photos yet - snap the first one! 📷</div>'
    $('#photos-load-more').classList.add('hidden')
    return
  }
  const birth = cfg?.birthDate ? new Date(`${cfg.birthDate}T12:00:00`) : null
  const monthly = birth ? events.filter((e) => isMonthlyBirthday(e.occurred_at, birth)) : []

  let html = ''
  if (monthly.length) {
    html += `<div class="photos-pinned">
      <h3>🎂 Monthly shots</h3>
      <div class="photos-strip">${monthly.map((e) => photoTile(e, true)).join('')}</div>
    </div>`
  }

  const groups = groupPhotos(events, birth)
  html += groups
    .map((g) => {
      const { label, sub } = birth ? monthGroupLabel(g.key, birth) : calendarGroupLabel(g.key)
      return `<div class="photos-month">
        <div class="photos-month-header"><span class="photos-month-title">${label}</span>${sub ? `<span class="photos-month-range">${sub}</span>` : ''}</div>
        <div class="photos-grid">${g.items.map((e) => photoTile(e, birth && isMonthlyBirthday(e.occurred_at, birth))).join('')}</div>
      </div>`
    })
    .join('')

  el.innerHTML = html
  el.querySelectorAll('.photo-tile').forEach((btn) => {
    btn.onclick = () => {
      const e = events.find((ev) => String(ev.id) === btn.dataset.id)
      if (e) openLightbox(`/photos/${escapeHtml(e.photo_path)}`, e.notes)
    }
  })
}

async function loadPhotos({ append = false } = {}) {
  const url = append && photosOldest
    ? `/api/events?limit=${PHOTO_PAGE_SIZE}&type=photo&before=${encodeURIComponent(photosOldest)}`
    : `/api/events?limit=${PHOTO_PAGE_SIZE}&type=photo`
  const events = await api(url)
  if (!append) photosLoaded = []
  photosLoaded.push(...events)
  if (events.length) photosOldest = events[events.length - 1].occurred_at
  $('#photos-load-more').classList.toggle('hidden', events.length < PHOTO_PAGE_SIZE)
  renderPhotos(photosLoaded)
}

$('#photos-load-more').onclick = () => loadPhotos({ append: true })

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

// Stamp each log button with when that thing was last logged. Diaper buttons
// key on type+kind so each (pee/poop/both) shows its own last time - a
// glance-check against double-logging that particular kind. Buttons with no
// data-kind (Bottle) aren't kind-specific, so they take the latest across all
// kinds of that type (formula and breastmilk bottles both count).
async function loadLastLogged() {
  try {
    const rows = await api('/api/events/latest')
    const byKey = Object.fromEntries(rows.map((r) => [`${r.type}|${r.kind || ''}`, r.occurred_at]))
    const byType = {}
    for (const r of rows) {
      if (!byType[r.type] || r.occurred_at > byType[r.type]) byType[r.type] = r.occurred_at
    }
    document.querySelectorAll('.log-btn[data-log]').forEach((btn) => {
      const last = btn.dataset.kind ? byKey[`${btn.dataset.log}|${btn.dataset.kind}`] : byType[btn.dataset.log]
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

// Rows now arrive that this phone didn't create (voice logs, the other
// parent), so the log view re-polls in the background. Repainting the list
// rebuilds every entry element, which swallows a tap already in flight — so a
// background repaint only happens when the content actually changed AND the
// screen is calm. Foreground calls (nav, post-save) always repaint.
let pointerIsDown = false
let lastPointerAt = 0
const QUIET_MS = 700
document.addEventListener('pointerdown', () => { pointerIsDown = true; lastPointerAt = Date.now() }, true)
document.addEventListener('pointerup', () => { pointerIsDown = false; lastPointerAt = Date.now() }, true)
document.addEventListener('pointercancel', () => { pointerIsDown = false; lastPointerAt = Date.now() }, true)

function screenIsCalm() {
  if (!$('#sheet-backdrop').classList.contains('hidden')) return false // mid-edit
  if (pointerIsDown) return false
  return Date.now() - lastPointerAt > QUIET_MS
}

let recentSig = null
let recentRepaintTimer = null

async function loadRecent({ background = false } = {}) {
  loadLastLogged()
  const events = await api('/api/events?limit=5')
  if (background && JSON.stringify(events) === recentSig) return // nothing new — leave the DOM alone
  paintRecent(events, background)
}

// `deferrable` retries the paint (not the fetch) until the screen is calm, so
// a finger-down or an open sheet postpones the repaint instead of stealing it.
function paintRecent(events, deferrable) {
  if (deferrable && !screenIsCalm()) {
    clearTimeout(recentRepaintTimer)
    recentRepaintTimer = setTimeout(() => paintRecent(events, true), QUIET_MS)
    return
  }
  recentSig = JSON.stringify(events)
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
  // Pumped milk is breast milk, so it keeps the breastfeeding colour.
  pump: { label: 'Pumped', color: 'var(--c-breastfeed)' },
  pee: { label: 'Pee', color: 'var(--c-pee)' },
  poop: { label: 'Poop', color: 'var(--c-poop)' },
  // Estimates keep their source's colour: supply comes from pumped breast
  // milk, appetite from what she drains out of a bottle.
  supply: { label: 'Est. supply', color: 'var(--c-breastfeed)' },
  appetite: { label: 'Est. appetite', color: 'var(--c-formula)' },
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

// PROTOTYPE chart: sparse per-day estimates (only the days that produced a
// qualifying sample) as dots, with a 7-day trailing mean drawn through them so
// the direction reads despite the noise. Bars would imply the empty days
// measured zero; they measured nothing.
// opts.band (optional) shades an expected range behind the marks: { loOf, hiOf,
// midOf } per day, any of which may return null on days with no benchmark.
// opts.fmt formats values in tooltips.
function estimateChart(days, seriesList, opts = {}) {
  const W = 520
  const H = 190
  const M = { top: 12, right: 6, bottom: 22, left: 34 }
  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const band = opts.band
  const fmt = opts.fmt || ((v) => `${v} mL`)
  const all = seriesList.flatMap((s) => days.map((d) => s.valueOf(d)).filter((v) => v != null))
  if (band) all.push(...days.map((d) => band.hiOf(d)).filter((v) => v != null))
  const yMax = niceCeil(Math.max(1, ...all))
  const slot = plotW / days.length
  const px = (i) => M.left + i * slot + slot / 2
  const py = (v) => M.top + plotH - (Math.min(v, yMax) / yMax) * plotH

  // The band is drawn first so every sample sits on top of it.
  let bandMark = ''
  if (band) {
    const pts = days.map((d, i) => ({ i, lo: band.loOf(d), hi: band.hiOf(d) })).filter((p) => p.lo != null && p.hi != null)
    if (pts.length) {
      // A single day still deserves a visible band, so a lone point is widened
      // to the full plot rather than collapsing to a zero-width sliver.
      const xs = pts.length > 1 ? pts.map((p) => px(p.i)) : [M.left, W - M.right]
      // It is a background region, not a series: run it to the plot edges
      // rather than stopping at the first and last dot centre.
      if (pts.length > 1) {
        xs[0] = M.left
        xs[xs.length - 1] = W - M.right
      }
      const top = xs.map((x, k) => `${k ? 'L' : 'M'}${x.toFixed(1)},${py(pts[Math.min(k, pts.length - 1)].hi).toFixed(1)}`).join(' ')
      const bottom = xs
        .map((x, k) => ({ x, p: pts[Math.min(k, pts.length - 1)] }))
        .reverse()
        .map(({ x, p }) => `L${x.toFixed(1)},${py(p.lo).toFixed(1)}`)
        .join(' ')
      bandMark += `<path d="${top} ${bottom} Z" fill="var(--c-band)" opacity="0.9"/>`
      if (band.midOf) {
        const mid = xs
          .map((x, k) => `${k ? 'L' : 'M'}${x.toFixed(1)},${py(band.midOf(days[pts[Math.min(k, pts.length - 1)].i])).toFixed(1)}`)
          .join(' ')
        bandMark += `<path d="${mid}" fill="none" stroke="var(--c-band-line)" stroke-width="1.5" stroke-dasharray="4 4"/>`
      }
    }
  }

  let marks = ''
  for (const s of seriesList) {
    const color = SERIES[s.key].color
    const points = days.map((d, i) => ({ i, d, v: s.valueOf(d) })).filter((p) => p.v != null)
    if (!points.length) continue

    // Trailing 7-day mean, plotted only where the window holds 2+ samples so a
    // lone estimate never masquerades as a trend.
    const trend = []
    days.forEach((d, i) => {
      const win = points.filter((p) => p.i <= i && p.i > i - 7)
      if (win.length < 2) return
      trend.push({ i, v: win.reduce((sum, p) => sum + p.v, 0) / win.length })
    })
    if (trend.length > 1) {
      const path = trend.map((t, k) => `${k ? 'L' : 'M'}${px(t.i).toFixed(1)},${py(t.v).toFixed(1)}`).join(' ')
      marks += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.55"/>`
    }
    marks += points
      .map((p) => {
        const n = s.samplesOf(p.d)
        const extra = s.tipExtra ? s.tipExtra(p.d) : ''
        const tip = `${fmtDayHeader(p.d.date)} · ${SERIES[s.key].label}: ${fmt(p.v)}${extra} (${n} sample${n === 1 ? '' : 's'})`
        return `<circle cx="${px(p.i).toFixed(1)}" cy="${py(p.v).toFixed(1)}" r="3.5" fill="${color}" stroke="var(--surface)" stroke-width="1.5" data-tip="${escapeHtml(tip)}"/>`
      })
      .join('')
  }

  const grid = yTicks(yMax)
    .map((t) => {
      const y = py(t)
      return `<line x1="${M.left}" y1="${y}" x2="${W - M.right}" y2="${y}" stroke="var(--grid)" stroke-width="1"/>
        <text x="${M.left - 6}" y="${y + 3.5}" text-anchor="end" font-size="10" fill="var(--muted)">${t}</text>`
    })
    .join('')

  const labelEvery = Math.ceil(days.length / 7)
  const xLabels = days
    .map((d, i) => {
      if (i % labelEvery !== 0 && i !== days.length - 1) return ''
      const dt = new Date(`${d.date}T12:00:00`)
      return `<text x="${px(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${dt.getMonth() + 1}/${dt.getDate()}</text>`
    })
    .join('')

  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}">
    ${bandMark}${grid}
    <line x1="${M.left}" y1="${M.top + plotH}" x2="${W - M.right}" y2="${M.top + plotH}" stroke="var(--hairline)" stroke-width="1"/>
    ${marks}${xLabels}
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
  // Above P95 / below P5 a whole number hides real movement (99.1 vs 99.9
  // matters out there), so the tails get one decimal.
  if (p < 0.1) return '<0.1st'
  if (p > 99.9) return '>99.9th'
  const tail = Math.round(p) <= 5 || Math.round(p) >= 95
  const str = tail ? p.toFixed(1) : String(Math.round(p))
  const n = Math.round(p)
  const last = tail ? Number(str.at(-1)) : n % 10
  const teen = !tail && n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'
  return `${str}${suffix}`
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

// Methodology text for the inferred charts. It matters (these numbers are
// guesses, and the reader deserves to know from what) but it is long and it is
// read once, so it hides behind a "?" instead of eating a third of the card.
function helpBtn(id) {
  return `<button class="chart-help" data-help="${id}" aria-label="How this is calculated">?</button>`
}
function helpNote(id, html) {
  return `<div class="chart-note hidden" data-help-for="${id}">${html}</div>`
}

// A collapsible row of tiles. Collapsed state lives in localStorage per group,
// so each parent's phone keeps whichever rows they actually read. A group whose
// tiles all came back empty renders nothing rather than an empty heading.
function tileGroupCollapsed(id) {
  return localStorage.getItem(`tiles:${id}`) === 'closed'
}

function tileGroup(id, label, tiles) {
  const body = tiles.filter(Boolean).join('')
  if (!body) return ''
  const open = !tileGroupCollapsed(id)
  return `<div class="tile-group">
    <button class="tile-group-label" data-tile-group="${id}" aria-expanded="${open}" aria-controls="tiles-${id}"><span class="caret">▶</span>${label}</button>
    <div class="tiles" id="tiles-${id}"${open ? '' : ' hidden'}>${body}</div>
  </div>`
}

function chartCard(title, sub, keys, svg) {
  return `<div class="chart-card"><h3>${title}</h3><div class="chart-sub">${sub}</div>${keys.length > 1 ? legend(keys) : ''}${svg}</div>`
}

// How much history the per-day charts show. A month of newborn data is a wall
// of bars on a phone, so a week is the default and the longer views are opt-in.
const RANGES = [
  { id: '7', label: '1 week', days: 7 },
  { id: '30', label: '1 month', days: 30 },
  { id: '90', label: '3 months', days: 90 },
]
const REPORT_DAYS = 90 // fetched window; the range only slices what's plotted

function activeRange() {
  const id = localStorage.getItem('reportsRange')
  return RANGES.find((r) => r.id === id) || RANGES[0]
}

function rangeToggle() {
  const active = activeRange().id
  return `<div class="range-toggle">${RANGES.map(
    (r) => `<button data-range="${r.id}" class="${r.id === active ? 'active' : ''}">${r.label}</button>`
  ).join('')}</div>`
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
      byDate.get(key) || { date: key, breastfeedCount: 0, breastfeedMin: 0, formulaCount: 0, formulaMl: 0, breastmilkMl: 0, breastmilkCount: 0, pumpCount: 0, pumpedMl: 0, pee: 0, poop: 0, supplyMl: null, supplySamples: 0, appetiteMl: null, appetiteMlHr: null, appetiteHours: null, appetiteSamples: 0 }
    )
    if (key >= today) break
    cursor.setDate(cursor.getDate() + 1)
  }
  return out.slice(-activeRange().days)
}

// Growth charts + percentile tiles, shared by the top-level Growth view and
// the Reports > Growth sub-tab. weights/heights/heads are ascending arrays of
// {occurred_at, weight_g|height_cm|head_cm} - normally the all-time data from
// /api/reports/growth, so measurements never fall off a windowed report.
function buildGrowthHtml(weights, heights, heads) {
  const lastWeight = weights[weights.length - 1]
  const unit = localStorage.getItem('weightUnit') || 'lb'
  const fmtW = (g) => (unit === 'kg' ? `${(g / 1000).toFixed(2)} kg` : `${(g / 453.592).toFixed(2)} lb`)
  const lastHeight = heights[heights.length - 1]
  const hUnit = localStorage.getItem('heightUnit') || 'in'
  const fmtH = (cm) => (hUnit === 'cm' ? `${cm.toFixed(1)} cm` : `${(cm / 2.54).toFixed(1)} in`)
  const lastHead = heads[heads.length - 1]
  const cUnit = localStorage.getItem('headUnit') || 'cm'
  const fmtC = (cm) => (cUnit === 'cm' ? `${cm.toFixed(1)} cm` : `${(cm / 2.54).toFixed(1)} in`)
  let growthHtml = ''

  const GROWTH_LMS = typeof GROWTH_LMS_BY_SEX !== 'undefined' ? GROWTH_LMS_BY_SEX[cfg.babySex] : null
  if (cfg.birthDate && GROWTH_LMS && (weights.length || heights.length || heads.length)) {
    const birth = new Date(`${cfg.birthDate}T12:00:00`)
    const ageMo = (iso) => Math.max(0, (new Date(iso) - birth) / (86400000 * 30.4375))
    const wg = weights.map((w) => ({ iso: w.occurred_at, value: w.weight_g / 1000, ageMo: ageMo(w.occurred_at) }))
    const hg = heights.map((h) => ({ iso: h.occurred_at, value: h.height_cm, ageMo: ageMo(h.occurred_at) }))
    const cg = heads.map((h) => ({ iso: h.occurred_at, value: h.head_cm, ageMo: ageMo(h.occurred_at) }))
    const lastW = wg[wg.length - 1]
    const lastH = hg[hg.length - 1]
    const lastC = cg[cg.length - 1]

    growthHtml += `<div class="tiles">
      ${lastW ? `<div class="tile"><div class="tile-label">⚖️ Weight percentile</div><div class="tile-value">${fmtPercentile(percentileFor(GROWTH_LMS.weight, lastW.ageMo, lastW.value))}</div><div class="tile-sub">${fmtWeight(lastW.value * 1000)}</div></div>` : ''}
      ${lastH ? `<div class="tile"><div class="tile-label">📏 Height percentile</div><div class="tile-value">${fmtPercentile(percentileFor(GROWTH_LMS.length, lastH.ageMo, lastH.value))}</div><div class="tile-sub">${fmtHeight(lastH.value)}</div></div>` : ''}
      ${lastC ? `<div class="tile"><div class="tile-label">🧠 Head percentile</div><div class="tile-value">${fmtPercentile(percentileFor(GROWTH_LMS.head, lastC.ageMo, lastC.value))}</div><div class="tile-sub">${fmtHead(lastC.value)}</div></div>` : ''}
    </div>`

    const curveLabel = `on WHO ${cfg.babySex}s' growth standards (3rd-97th percentile) - tap a dot for the exact percentile`
    if (wg.length) {
      growthHtml += chartCard('Weight', curveLabel, [],
        growthChart(wg, GROWTH_LMS.weight, 'var(--c-weight)', (kg) => fmtW(kg * 1000)))
    }
    if (hg.length) {
      growthHtml += chartCard('Height', curveLabel, [],
        growthChart(hg, GROWTH_LMS.length, 'var(--c-breastfeed)', (cm) => fmtH(cm)))
    }
    if (cg.length) {
      growthHtml += chartCard('Head circumference', curveLabel, [],
        growthChart(cg, GROWTH_LMS.head, 'var(--c-feed)', (cm) => fmtC(cm)))
    }
    if (wg.length >= 2 || hg.length >= 2 || cg.length >= 2) {
      const series = []
      if (wg.length >= 2) series.push({ label: 'Weight', color: 'var(--c-weight)', points: wg.map((p) => ({ iso: p.iso, value: percentileFor(GROWTH_LMS.weight, p.ageMo, p.value) })) })
      if (hg.length >= 2) series.push({ label: 'Height', color: 'var(--c-breastfeed)', points: hg.map((p) => ({ iso: p.iso, value: percentileFor(GROWTH_LMS.length, p.ageMo, p.value) })) })
      if (cg.length >= 2) series.push({ label: 'Head', color: 'var(--c-feed)', points: cg.map((p) => ({ iso: p.iso, value: percentileFor(GROWTH_LMS.head, p.ageMo, p.value) })) })
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
      growthHtml += `<div class="chart-card"><h3>Weight</h3><div class="chart-sub">latest: ${fmtWeight(lastWeight.weight_g)} - the curve appears after a second measurement</div></div>`
    }
    if (heights.length >= 2) {
      growthHtml += chartCard('Height', lastHeight ? `latest: ${fmtHeight(lastHeight.height_cm)}` : '', [],
        lineChart(heights.map((h) => ({ occurred_at: h.occurred_at, value: h.height_cm })), 'var(--c-breastfeed)', (cm) => fmtH(cm)))
    } else if (lastHeight) {
      growthHtml += `<div class="chart-card"><h3>Height</h3><div class="chart-sub">latest: ${fmtHeight(lastHeight.height_cm)} - the curve appears after a second measurement</div></div>`
    }
    if (heads.length >= 2) {
      growthHtml += chartCard('Head circumference', lastHead ? `latest: ${fmtHead(lastHead.head_cm)}` : '', [],
        lineChart(heads.map((h) => ({ occurred_at: h.occurred_at, value: h.head_cm })), 'var(--c-feed)', (cm) => fmtC(cm)))
    } else if (lastHead) {
      growthHtml += `<div class="chart-card"><h3>Head circumference</h3><div class="chart-sub">latest: ${fmtHead(lastHead.head_cm)} - the curve appears after a second measurement</div></div>`
    }
  }
  if (!growthHtml) growthHtml = '<div class="chart-card"><h3>Growth</h3><div class="chart-sub">no measurements yet</div></div>'
  return growthHtml
}

// Fetches all-time weight/height/head measurements (never windowed, unlike
// /api/reports/daily) and renders them into the given container via
// buildGrowthHtml. Shared by the top-level Growth view and the Reports tab.
async function loadGrowthInto(el) {
  try {
    const { weights, heights, heads = [] } = await api('/api/reports/growth')
    el.innerHTML = buildGrowthHtml(weights, heights, heads)
  } catch (err) {
    el.innerHTML = `<div class="chart-card"><h3>Growth</h3><div class="chart-sub">${escapeHtml(err.message)}</div></div>`
  }
  el.querySelectorAll('.chart-svg').forEach((svg) => chartTip(svg))
}

async function loadGrowth() {
  await loadGrowthInto($('#growth'))
}

async function loadReports() {
  // Growth tiles/charts are all-time (never windowed like the rest of this
  // report), so old measurements never silently drop off. The two fetches are
  // independent - issue them together.
  const [daily, growthData] = await Promise.all([
    api(`/api/reports/daily?days=${REPORT_DAYS}`),
    api('/api/reports/growth').catch(() => ({ weights: [], heights: [], heads: [] })),
  ])
  const { days: rawDays, weights, heights, heads = [], latestWeight = null } = daily
  const el = $('#reports')
  if (!rawDays.length && !weights.length && !heights.length && !heads.length &&
      !growthData.weights.length && !growthData.heights.length && !(growthData.heads || []).length) {
    el.innerHTML = '<div class="day-header">No data yet — reports appear once you start logging.</div>'
    return
  }
  const days = fillDays(rawDays)
  const todayKey = dayKey(new Date().toISOString())
  const today = days.find((d) => d.date === todayKey) || { breastfeedCount: 0, breastfeedMin: 0, formulaMl: 0, formulaCount: 0, breastmilkMl: 0, breastmilkCount: 0, pumpCount: 0, pumpedMl: 0, pee: 0, poop: 0 }

  const growthHtml = buildGrowthHtml(growthData.weights, growthData.heights, growthData.heads || [])

  // Estimates are sparse - a day only produces one when a qualifying pump or
  // isolated bottle happened - so the tile shows the most recent one and dates it.
  const lastEst = (key) => [...days].reverse().find((d) => d[key] != null)
  const estTile = (key, label, emoji, value, sub, cls = '') => {
    const d = lastEst(key)
    if (!d) return ''
    const when = d.date === todayKey ? 'today' : fmtDayHeader(d.date)
    return `<div class="tile ${cls}"><div class="tile-label">${emoji} ${label} <span class="proto-tag">PROTOTYPE</span></div><div class="tile-value">${value(d)}</div><div class="tile-sub">${sub(d)} · ${when}</div></div>`
  }

  // One flat grid of tiles was a wall to scroll past on a phone, and it mixed
  // measured counts with inferred estimates. The tiles now group by what they
  // answer, each group collapsible from its heading and remembered per device -
  // a parent who never looks at the estimates can fold them away for good.
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const formulaOnlyMl = today.formulaMl - today.breastmilkMl
  const formulaOnlyCount = today.formulaCount - today.breastmilkCount
  const bfMin = today.breastfeedMin
  const bfHrMin = bfMin >= 60 ? `${Math.floor(bfMin / 60)} hr ${bfMin % 60} min` : `${bfMin} min`

  const tilesHtml = [
    tileGroup('breastmilk', 'Breast milk', [
      `<div class="tile"><div class="tile-label">🤱 Breastfeeds today</div><div class="tile-value">${today.breastfeedCount}</div></div>`,
      days.some((d) => d.pumpedMl > 0)
        ? `<div class="tile"><div class="tile-label">🫙 Pumped today</div><div class="tile-value">${today.pumpedMl} mL</div><div class="tile-sub">${plural(today.pumpCount, 'session')}</div></div>`
        : '',
      bfMin
        ? `<div class="tile wide"><div class="tile-label">⏱️ Time on the breast today</div><div class="tile-value">${bfHrMin}</div><div class="tile-sub">${today.breastfeedCount ? `${Math.round(bfMin / today.breastfeedCount)} min average per feed` : ''}</div></div>`
        : '',
    ]),
    tileGroup('diapers', 'Diapers', [
      `<div class="tile"><div class="tile-label">💧 Pee today</div><div class="tile-value">${today.pee}</div></div>`,
      `<div class="tile"><div class="tile-label">💩 Poop today</div><div class="tile-value">${today.poop}</div></div>`,
    ]),
    tileGroup('bottle', 'Bottle feeding', [
      `<div class="tile"><div class="tile-label">🍼 Formula today</div><div class="tile-value">${formulaOnlyMl} mL</div><div class="tile-sub">${plural(formulaOnlyCount, 'feed')}</div></div>`,
      `<div class="tile"><div class="tile-label">🥛 Breast milk today</div><div class="tile-value">${today.breastmilkMl} mL</div><div class="tile-sub">${plural(today.breastmilkCount, 'feed')}</div></div>`,
    ]),
    tileGroup('estimates', 'Supply &amp; appetite', [
      estTile('supplyMl', 'Est. supply', '🧪', (d) => `${d.supplyMl} mL`, () => 'per feed'),
      estTile('appetiteMl', 'Est. appetite', '🧪', (d) => `${d.appetiteMl} mL`, () => 'per feed'),
      estTile('appetiteMlHr', 'Est. appetite buildup', '🧪', (d) => `${d.appetiteMlHr} mL/hr`, (d) => `${d.appetiteMl} mL over ${d.appetiteHours} hr`, 'wide'),
    ]),
  ].join('')

  // Time at the breast leads the tab: it is the one feeding number that is
  // measured rather than inferred, and it is the one the parent doing it wants
  // to see trended.
  let feedingHtml = ''
  if (days.some((d) => d.breastfeedMin > 0)) {
    feedingHtml += chartCard('Breastfeeding', 'Minutes per day', ['breastfeed'],
      barChart(days, ['breastfeed'], (d) => d.breastfeedMin || 0, (v) => `${v} min`))
  }
  if (days.some((d) => d.formulaMl > 0)) {
    feedingHtml += chartCard('Bottle Feeding', 'mL per Day', ['formula', 'breastmilk'],
      barChart(days, ['formula', 'breastmilk'],
        (d, k) => (k === 'breastmilk' ? d.breastmilkMl || 0 : d.formulaMl - (d.breastmilkMl || 0)), (v) => `${v} mL`))
  }
  if (days.some((d) => d.pumpedMl > 0)) {
    feedingHtml += chartCard('Pumping', 'mL per Day', ['pump'],
      barChart(days, ['pump'], (d) => d.pumpedMl || 0, (v) => `${v} mL`))
  }

  // Inferred, never measured - so the card, the subtitle and the tiles all say
  // PROTOTYPE, and a footnote spells out where the numbers come from.
  //
  // Two cards. The first puts appetite and supply back on shared axes: both are
  // ml in one feed, and the question they answer together - does a feed's worth
  // of milk cover a feed's worth of hunger - only reads off a single pair of
  // axes. The second keeps appetite as ml/hr, which supply has no counterpart
  // for and which is the schedule-independent view.
  if (days.some((d) => d.supplyMl != null || d.appetiteMl != null)) {
    feedingHtml += `<div class="chart-card">
      <h3>Appetite vs Supply <span class="proto-tag">PROTOTYPE</span> ${helpBtn('perfeed')}</h3>
      <div class="chart-sub">mL per feed</div>
      ${legend(['appetite', 'supply'])}
      ${helpNote('perfeed', `<p><strong>What a supply dot is.</strong> A pumping session that started 60+ minutes after the last feed or pump, so the breast had refilled and what came out stands in for one feed's worth of milk.</p>
        <p><strong>What an appetite dot is.</strong> A bottle with no breastfeeding within 60 minutes of it — usually an overnight feed — is the one time we know exactly how much went in. Bottles less than an hour apart count as one feeding.</p>
        <p><strong>Why days are missing.</strong> Pumps too soon after a feed measure a partly emptied breast, and bottles alongside breastfeeding do not measure a whole meal, so neither is counted. Days with several qualifying samples show the median of them.</p>
        <p><strong>The lines</strong> are trailing 7-day averages, drawn only where the window holds at least two samples.</p>
        <p>Both are inferred from the log, never measured — treat them as a direction, not a number.</p>`)}
      ${estimateChart(days, [
        { key: 'appetite', valueOf: (d) => d.appetiteMl, samplesOf: (d) => d.appetiteSamples },
        { key: 'supply', valueOf: (d) => d.supplyMl, samplesOf: (d) => d.supplySamples },
      ])}
    </div>`
  }

  if (days.some((d) => d.appetiteMlHr != null)) {
    // Benchmark: standard pediatric intake guidance for a term infant is
    // ~150 ml/kg/day (commonly quoted range 120-180), which is also what WHO's
    // feeding guidance for supplemented infants uses. WHO publishes no ml/hr
    // figure, so the daily range is divided by 24 to meet the estimate's units
    // — fair here because a newborn feeds around the clock.
    const kgOn = (dateKey) => {
      const prior = weights.filter((w) => w.date <= dateKey).pop() || weights[0] || latestWeight
      return prior ? prior.weight_g / 1000 : null
    }
    const perHr = (mlPerKgDay) => (d) => {
      const kg = kgOn(d.date)
      return kg == null ? null : (kg * mlPerKgDay) / 24
    }
    const band = weights.length || latestWeight
      ? { loOf: perHr(120), hiOf: perHr(180), midOf: perHr(150) }
      : null
    feedingHtml += `<div class="chart-card">
      <h3>Appetite Buildup <span class="proto-tag">PROTOTYPE</span> ${helpBtn('appetite')}</h3>
      <div class="chart-sub">mL per hour</div>
      ${helpNote('appetite', `<p><strong>What a dot is.</strong> A bottle with no breastfeeding within 60 minutes of it — usually an overnight feed — is the one time we know exactly how much went in. Bottles less than an hour apart count as one feeding.</p>
        <p><strong>Why mL per hour.</strong> How much she takes in one sitting mostly reflects how long she went without, so the volume is divided by the hours since the previous feed <em>started</em>. That makes a 4-hourly night comparable to a 2-hourly day. Intervals under 1 hour or over 8 are dropped as unreliable.</p>
        <p><strong>The line</strong> is a trailing 7-day average of the daily medians.</p>
        ${band ? '<p><strong>The shaded band</strong> is typical intake for her most recent weight — 120–180 mL/kg/day, dashed line at the commonly quoted 150 — spread evenly over 24 hours. It is general pediatric guidance, not a target: her own pediatrician and her growth curve are what matter.</p>' : ''}
        <p>Inferred from the log, never measured — treat it as a direction, not a number.</p>`)}
      ${estimateChart(days, [{
        key: 'appetite',
        valueOf: (d) => d.appetiteMlHr,
        samplesOf: (d) => d.appetiteSamples,
        tipExtra: (d) => ` — ${d.appetiteMl} mL over ${d.appetiteHours} hr`,
      }], { band, fmt: (v) => `${v} mL/hr` })}
    </div>`
  }
  feedingHtml += chartCard('Feeding Sessions', 'Times per Day', ['breastfeed', 'bottle'],
    barChart(days, ['breastfeed', 'bottle'], (d, k) => (k === 'breastfeed' ? d.breastfeedCount : d.formulaCount), (v) => `${v}`))

  const diapersHtml = chartCard('Diapers per day', 'pee and poop counts', ['pee', 'poop'],
    barChart(days, ['pee', 'poop'], (d, k) => d[k], (v) => `${v}`))

  const historyHtml = `<div class="report-table-wrap"><table class="report-table">
    <tr><th>Day</th><th>🤱</th><th>🍼 mL</th><th>💧</th><th>💩</th></tr>
    ${[...days].reverse().slice(0, 14).map((d) =>
      `<tr><td>${fmtDayHeader(d.date)}</td><td>${d.breastfeedCount}</td><td>${d.formulaMl}${d.breastmilkMl ? ` <span class="bm-share">(${d.breastmilkMl} bm)</span>` : ''}</td><td>${d.pee}</td><td>${d.poop}</td></tr>`
    ).join('')}
  </table></div>
  <div class="chart-sub">🍼 mL is total bottle volume; (bm) is the breast-milk share of it</div>`

  const sections = [
    { id: 'today', label: 'Today', html: tilesHtml },
    { id: 'history', label: 'History', html: historyHtml },
    // Growth is measurement-driven, not per-day, so the range toggle only
    // rides along with the tabs whose charts are one-bar-per-day.
    { id: 'feeding', label: 'Feeding', html: rangeToggle() + feedingHtml },
    { id: 'weight', label: 'Growth', html: growthHtml },
    { id: 'diapers', label: 'Diapers', html: rangeToggle() + diapersHtml },
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
  el.querySelectorAll('[data-help]').forEach((btn) => {
    btn.onclick = () => {
      const note = el.querySelector(`[data-help-for="${btn.dataset.help}"]`)
      const open = note.classList.toggle('hidden')
      btn.classList.toggle('active', !open)
    }
  })
  el.querySelectorAll('[data-tile-group]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.tileGroup
      const open = btn.getAttribute('aria-expanded') === 'true'
      btn.setAttribute('aria-expanded', String(!open))
      el.querySelector(`#tiles-${id}`).hidden = open
      localStorage.setItem(`tiles:${id}`, open ? 'closed' : 'open')
    }
  })
  el.querySelectorAll('[data-range]').forEach((btn) => {
    btn.onclick = () => {
      localStorage.setItem('reportsRange', btn.dataset.range)
      loadReports()
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

  // Sleep and longest asleep stretch within a day row.
  const dayStats = (row) => {
    let awakeMs = 0
    let longest = 0
    let cursor = row.ds
    for (const [s, e] of awake) {
      const cs = Math.max(s, row.ds)
      const ce = Math.min(e, row.de)
      if (ce <= cs) continue
      awakeMs += ce - cs
      longest = Math.max(longest, cs - cursor)
      cursor = Math.max(cursor, ce)
    }
    return { sleepMs: row.de - row.ds - awakeMs, longest: Math.max(longest, row.de - cursor) }
  }
  rows.forEach((r) => Object.assign(r, dayStats(r)))
  const { sleepMs, longest } = rows[0]

  const W = 520
  const LEFT = 46
  const RIGHT = 44
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
    svg += `<text x="${W - 2}" y="${y + rowH / 2 + 3}" text-anchor="end" font-size="9" fill="var(--muted)">${(r.sleepMs / 3600000).toFixed(1)}hr</text>`
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

const views = { log: loadRecent, timeline: () => loadTimeline(), reports: loadReports, sleep: loadSleep, home: loadHome, growth: loadGrowth, photos: () => loadPhotos() }

// The app often sits open on the log/home screen for hours - keep the stamps
// AND the Recent list from going stale. loadRecent() refreshes the stamps
// too, and it targets #last-entries/.log-btn by id/class rather than by
// view, so it works no matter which view currently holds those reparented
// elements (see applyLayoutDom).
setInterval(() => {
  if (!$('#view-log').classList.contains('hidden')) loadRecent({ background: true }).catch(() => {})
  else if (!$('#view-home').classList.contains('hidden')) loadHome({ background: true }).catch(() => {})
}, 60000)

// Coming back to a backgrounded tab is when the data is most likely stale and
// when you'd notice — but focus and visibilitychange both fire on the same
// return, hence the throttle.
let lastRefreshAt = Date.now()
function backgroundRefresh() {
  if (document.visibilityState !== 'visible') return
  if (!$('#sheet-backdrop').classList.contains('hidden')) return // don't yank a form out from under an edit
  if (Date.now() - lastRefreshAt < 5000) return
  lastRefreshAt = Date.now()
  if (!activeView) return // still on the login screen
  if (activeView === 'log') loadRecent({ background: true }).catch(() => {})
  else if (activeView === 'home') loadHome({ background: true }).catch(() => {})
  else views[activeView]()
}
document.addEventListener('visibilitychange', backgroundRefresh)
window.addEventListener('focus', backgroundRefresh)

// The current view is tracked here rather than read back off .nav-btn.active:
// some views (reports/sleep in the new layout) have no button in the visible
// nav, where the Home button is highlighted as a stand-in.
let activeView = null

function switchView(name) {
  activeView = name
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name))
  const nav = document.querySelector(currentLayout() === 'classic' ? '#nav-classic' : '#nav-new')
  if (!nav.querySelector('.nav-btn.active')) nav.querySelector('[data-view="home"]')?.classList.add('active')
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'))
  $(`#view-${name}`).classList.remove('hidden')
  views[name]()
}

function refreshAll() {
  autoMilestones = null // new logs can cross a fun-milestone threshold
  lastRefreshAt = Date.now()
  views[activeView]()
}

// ---------- layout: new (Home-first) vs classic (Log-first) ----------

function currentLayout() {
  return localStorage.getItem('layout') === 'classic' ? 'classic' : 'new'
}

function setLayout(layout) {
  localStorage.setItem('layout', layout)
  // A reload is simpler and more robust than reconciling reparented DOM
  // nodes and nav state in place, and the toggle is a rare action.
  location.reload()
}

// The quick-log grid and the Recent list are single DOM nodes shared between
// the classic Log view and the new-layout Home view - moved rather than
// duplicated, so there is exactly one copy of the log buttons in the app.
function applyLayoutDom(layout) {
  const grid = document.querySelector('.log-grid')
  const recent = $('#last-entries')
  const logView = $('#view-log')
  const gridMount = $('#home-log-grid-mount')
  const recentMount = $('#home-recent-mount')
  if (layout === 'classic') {
    if (grid) logView.insertBefore(grid, logView.firstChild)
    if (recent) logView.insertBefore(recent, logView.querySelector('.layout-toggle'))
  } else {
    if (grid) gridMount.appendChild(grid)
    if (recent) recentMount.appendChild(recent)
  }
}

function homeLogOpen() {
  return localStorage.getItem('homeLogOpen') === '1'
}

function applyHomeLogDisclosure() {
  const open = homeLogOpen()
  $('#home-log-grid-mount').classList.toggle('hidden', !open)
  $('#home-log-toggle').setAttribute('aria-expanded', String(open))
}

$('#home-log-toggle').onclick = () => {
  localStorage.setItem('homeLogOpen', homeLogOpen() ? '0' : '1')
  applyHomeLogDisclosure()
}

$('#home-layout-toggle').onclick = (e) => {
  e.preventDefault()
  setLayout('classic')
}
$('#log-layout-toggle').onclick = (e) => {
  e.preventDefault()
  setLayout('new')
}

// "X weeks old" up to ~12 weeks, then "X months, Y days old" - computed
// client-side from the configured birth date so it's never stored or stale.
function homeAgeText() {
  if (!cfg?.birthDate) return null
  const birth = new Date(`${cfg.birthDate}T12:00:00`)
  if (Number.isNaN(birth.getTime())) return null
  const now = new Date()
  const totalDays = Math.floor((now - birth) / 86400000)
  if (totalDays < 0) return null
  const weeks = Math.floor(totalDays / 7)
  if (weeks < 12) return `${weeks} week${weeks === 1 ? '' : 's'} old`
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
  // Clamp to month-end so a birth on the 29th-31st doesn't overflow into the
  // next month in shorter months (same clamp as ageMarkers).
  const anchorFor = (m) => {
    const a = new Date(birth.getFullYear(), birth.getMonth() + m, birth.getDate())
    if (a.getDate() !== birth.getDate()) a.setDate(0)
    return a
  }
  let anchor = anchorFor(months)
  if (anchor > now) {
    months--
    anchor = anchorFor(months)
  }
  const days = Math.floor((now - anchor) / 86400000)
  return `${months} month${months === 1 ? '' : 's'}, ${days} day${days === 1 ? '' : 's'} old`
}

function renderHomeAge() {
  const el = $('#home-age')
  const text = homeAgeText()
  el.textContent = text || ''
  el.classList.toggle('hidden', !text)
}

// Pillar cards: only built for what exists today (weight/growth, reports,
// sleep) - no placeholders for features that don't exist yet.
function renderHomeCards(latestWeight, weightPct) {
  const cards = []
  if (latestWeight) {
    cards.push(`<button type="button" class="home-card" data-nav="growth">
      <div class="home-card-label">⚖️ Latest weight</div>
      <div class="home-card-value">${fmtWeight(latestWeight.weight_g)}</div>
      ${weightPct != null ? `<div class="home-card-sub">${fmtPercentile(weightPct)} percentile</div>` : ''}
    </button>`)
  }
  cards.push(`<button type="button" class="home-card" data-nav="reports">
    <div class="home-card-label">📊 Reports</div>
  </button>`)
  cards.push(`<button type="button" class="home-card" data-nav="sleep">
    <div class="home-card-label">😴 Sleep</div>
  </button>`)
  const el = $('#home-cards')
  el.innerHTML = cards.join('')
  el.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => switchView(b.dataset.nav)))
}

async function loadHome({ background = false } = {}) {
  renderHomeAge()
  applyHomeLogDisclosure()
  loadRecent({ background }).catch(() => {})
  const GROWTH_LMS = typeof GROWTH_LMS_BY_SEX !== 'undefined' && cfg.babySex ? GROWTH_LMS_BY_SEX[cfg.babySex] : null
  try {
    const { weights } = await api('/api/reports/growth')
    const lastW = weights[weights.length - 1]
    let pct = null
    if (lastW && cfg.birthDate && GROWTH_LMS) {
      const birth = new Date(`${cfg.birthDate}T12:00:00`)
      const ageMo = Math.max(0, (new Date(lastW.occurred_at) - birth) / (86400000 * 30.4375))
      pct = percentileFor(GROWTH_LMS.weight, ageMo, lastW.weight_g / 1000)
    }
    renderHomeCards(lastW || null, pct)
  } catch {
    renderHomeCards(null, null)
  }
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

// Voice logging from inside the app, following quickDiaper's rule: save
// immediately, toast to undo, no confirm step. Tap to start, tap again to stop.
//
// The clip is transcribed server-side rather than by the browser's Web Speech
// API, which takes a single `lang` per call - that would reproduce exactly the
// Siri limitation this button exists to escape. Nothing is stored locally; the
// audio goes straight up and is dropped once transcribed.

// A pocket tap must not record until the battery dies.
const VOICE_MAX_MS = 20000

// Safari yields audio/mp4, Chrome audio/webm. Whatever the browser produces is
// passed through as the upload's content type.
function pickAudioMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) || ''
}

let voiceRec = null

function setVoiceState(state, label) {
  const btn = $('#voice-btn')
  btn.classList.toggle('recording', state === 'recording')
  btn.classList.toggle('busy', state === 'busy')
  btn.disabled = state === 'busy'
  btn.querySelector('.voice-label').textContent = label
}

function showVoiceResult(res) {
  const saved = res.saved || []
  if (!saved.length) {
    // Failures, clarifications and answers to spoken questions all arrive as
    // one short sentence that already reads correctly on screen. Answers need
    // longer than the default toast to actually be read.
    toast(res.speech, null, res.ok ? 6000 : 4000)
    return
  }
  if (saved.length === 1) {
    const e = saved[0]
    const d = describe(e)
    toast(`${d.emoji} ${d.title}${d.sub ? ` · ${d.sub}` : ''} saved · tap to edit`, () =>
      openSheet(e.type, { existing: e })
    )
  } else {
    toast(`✅ ${saved.length} entries saved · tap to view`, () => switchView('timeline'))
  }
  refreshAll()
}

async function recordUtterance() {
  if (voiceRec) {
    voiceRec.stop() // second tap stops it
    return
  }

  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    // Denied permission is silent otherwise, and the fix is buried in Settings.
    toast('Microphone blocked - allow it in Settings, then try again', null, 5000)
    return
  }

  const stopTracks = () => stream.getTracks().forEach((t) => t.stop())
  const mime = pickAudioMime()
  let rec
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  } catch {
    stopTracks()
    toast("This browser can't record audio")
    return
  }

  const chunks = []
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }

  const startedAt = Date.now()
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - startedAt) / 1000)
    setVoiceState('recording', `Stop · 0:${String(s).padStart(2, '0')}`)
  }, 250)
  const cap = setTimeout(() => {
    if (rec.state === 'recording') rec.stop()
  }, VOICE_MAX_MS)

  rec.onstop = async () => {
    clearInterval(tick)
    clearTimeout(cap)
    stopTracks()
    voiceRec = null
    setVoiceState('busy', 'Transcribing…')
    try {
      const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })
      if (!blob.size) throw new Error("I didn't hear anything")
      const fd = new FormData()
      fd.append('audio', blob, 'utterance')
      showVoiceResult(await apiUpload('/api/voice/audio', fd))
    } catch (err) {
      toast(err.message)
    } finally {
      setVoiceState('idle', 'Voice log')
    }
  }

  voiceRec = rec
  rec.start()
  setVoiceState('recording', 'Stop · 0:00')
}

$('#voice-btn').onclick = recordUtterance

document.querySelectorAll('.log-btn[data-log]').forEach((b) => {
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
  // Needs both halves: a transcription key on the server and a browser that
  // can actually reach a microphone (getUserMedia needs a secure context).
  if (cfg.voiceInput && navigator.mediaDevices?.getUserMedia && window.MediaRecorder) {
    $('#voice-btn').classList.remove('hidden')
  }
  if (isIOS && !isStandalone && !localStorage.getItem('iosHintDismissed')) {
    $('#ios-hint').classList.remove('hidden')
  }
  const layout = currentLayout()
  document.body.dataset.layout = layout // in sync already via the inline head script; kept authoritative here too
  applyLayoutDom(layout)
  switchView(layout === 'classic' ? 'log' : 'home')
}

boot()
