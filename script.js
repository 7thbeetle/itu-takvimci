// Global veri
let allCourses = [];
let filteredCourses = [];
let departmentFilters = [];
let selectedCourses = [];
let courseColors = new Map();
let formCounter = 0; // Form ID sayacı
let formToCRN = new Map(); // Her formun son eklediği CRN'i takip et
let calendars = [];
let currentCalendarId = null;
let autoSaveStarted = false;
let isBootstrapping = true;
let isAltMode = false;
let alternativePrograms = [];
let alternativeIndex = 0;
let alternativeFormOrder = [];
let pinnedForms = new Set();
const CRN_SCRIPT_PREFIX = "javascript: !function()%7Bvar e=%5B";
const CRN_SCRIPT_SUFFIX = "%5D;let t=document.querySelectorAll(\"input%5Btype='number'%5D\"),n=0;t.forEach(t=>%7B(function e(t)%7Blet n=window.getComputedStyle(t);if(\"none\"===n.display%7C%7C\"hidden\"===n.visibility)return!1;let l=t.parentElement;for(;l;)%7Blet i=window.getComputedStyle(l);if(\"none\"===i.display%7C%7C\"hidden\"===i.visibility)return!1;l=l.parentElement%7Dreturn!0%7D)(t)&&n<e.length&&(t.value=e%5Bn%5D,t.dispatchEvent(new Event(\"input\",%7Bbubbles:!0%7D)),n++)%7D),setTimeout(function()%7Blet e=document.querySelector('button%5Btype=\"submit\"%5D:not(%5Bdisabled%5D)');e&&e.click(),setTimeout(function()%7Blet e=document.querySelector(\".card-footer.d-flex.justify-content-end\");if(e)%7Blet t=e.getElementsByTagName(\"button\");t.length>1&&t%5B1%5D.click()%7D%7D,50)%7D,50)%7D();";

// localStorage anahtarları
const CALENDARS_STORAGE_KEY = 'itu_takvimci_calendars_v2';
const STORAGE_KEY = 'itu_takvimci_program'; // legacy
const FILTER_STORAGE_KEY = 'itu_takvimci_filters'; // legacy

// Renk paleti
const colorPalette = [
  '#6B8FA3', '#8B4A5C', '#D4A574', '#5A7D5A', '#7A7A7A',
  '#7B9CB5', '#9B5A6C', '#E4B584', '#6A8D6A', '#8A8A8A',
  '#5B7F93', '#7B3A4C', '#C49564', '#4A6D4A', '#6A6A6A',
  '#8B9FA3', '#AB6A7C', '#F4C594', '#7A9D7A', '#9A9A9A'
];

// Helper: DOM elementi oluştur
function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  children.forEach(c => {
    if (typeof c === 'string') {
      e.appendChild(document.createTextNode(c));
    } else {
      e.appendChild(c);
    }
  });
  return e;
}

function generateId() {
  return `cal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCalendarById(id) {
  return calendars.find(c => c.id === id);
}

function getNextCalendarName() {
  const base = 'Takvimim';
  const existingNames = new Set(calendars.map(c => c.name));
  if (!existingNames.has(base)) return base;
  let idx = 1;
  while (existingNames.has(`${base} ${idx}`)) {
    idx += 1;
  }
  return `${base} ${idx}`;
}

function ensureUniqueCalendarName(name) {
  const existingNames = new Set(calendars.map(c => c.name));
  if (!existingNames.has(name)) return name;
  let idx = 2;
  while (existingNames.has(`${name} (${idx})`)) {
    idx += 1;
  }
  return `${name} (${idx})`;
}

function syncCurrentCalendar() {
  const current = getCalendarById(currentCalendarId);
  if (!current) return;
  const anaDal = document.getElementById('ana-dal')?.value || '';
  const yanDal = document.getElementById('yan-dal')?.value || '';
  current.selectedCourses = selectedCourses;
  current.courseColors = Array.from(courseColors.entries());
  current.formToCRN = Array.from(formToCRN.entries());
  current.filters = { anaDal, yanDal };
}

function saveCalendarsToLocalStorage() {
  try {
    const data = {
      calendars,
      currentCalendarId
    };
    localStorage.setItem(CALENDARS_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Takvimleri kaydetme hatası:', e);
  }
}

function saveNow(options = {}) {
  const { force = false } = options;
  if (isBootstrapping && !force) return;
  syncCurrentCalendar();
  saveCalendarsToLocalStorage();
  updateCrnScript();
}

function updateCrnScript() {
  const crnBtn = document.getElementById('crn-fill-btn');
  if (!crnBtn) return;
  const crns = selectedCourses.map(c => c.CRN).filter(Boolean);
  const list = crns.map(crn => `'${crn}'`).join(',');
  const script = `${CRN_SCRIPT_PREFIX}${list}${CRN_SCRIPT_SUFFIX}`;
  crnBtn.setAttribute('href', script);
}

function getCoursesForRender() {
  if (isAltMode && alternativePrograms.length > 0) {
    return alternativePrograms[alternativeIndex] || selectedCourses;
  }
  return selectedCourses;
}

function parseCourseBlocks(course) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const gunler = course.Gün.split(/\s*\/\s*|\s*\|\s*/).map(g => g.trim()).filter(g => g);
  const saatParts = course.Saat.split(/\s+\/\s+|\s+\|\s+/).map(s => s.trim()).filter(s => s);
  const blocks = [];
  const toMin = t => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  
  gunler.forEach((gunStr, idx) => {
    const saatStr = saatParts[idx] || saatParts[0];
    if (!saatStr) return;
    const [start, end] = saatStr.split('/').map(t => t.trim());
    if (!start || !end) return;
    const dayIdx = days.findIndex(d => gunStr.includes(d));
    if (dayIdx === -1) return;
    blocks.push({
      dayIdx,
      startMin: toMin(start),
      endMin: toMin(end)
    });
  });
  
  return blocks;
}

function hasConflict(scheduleByDay, blocks) {
  for (const block of blocks) {
    const list = scheduleByDay[block.dayIdx] || [];
    for (const existing of list) {
      if (block.startMin < existing.endMin && block.endMin > existing.startMin) {
        return true;
      }
    }
  }
  return false;
}

function addBlocks(scheduleByDay, blocks) {
  blocks.forEach(block => {
    if (!scheduleByDay[block.dayIdx]) scheduleByDay[block.dayIdx] = [];
    scheduleByDay[block.dayIdx].push(block);
  });
}

function removeBlocks(scheduleByDay, blocks) {
  blocks.forEach(block => {
    const list = scheduleByDay[block.dayIdx];
    if (!list) return;
    const idx = list.indexOf(block);
    if (idx !== -1) list.splice(idx, 1);
  });
}

function updateAltControls() {
  const controls = document.getElementById('alt-controls');
  const countEl = document.getElementById('alt-count');
  const prevBtn = document.getElementById('alt-prev');
  const nextBtn = document.getElementById('alt-next');
  if (!controls || !countEl || !prevBtn || !nextBtn) return;
  
  if (!isAltMode) {
    controls.classList.add('hidden');
    return;
  }
  
  controls.classList.remove('hidden');
  const total = alternativePrograms.length || 1;
  const current = Math.min(alternativeIndex + 1, total);
  countEl.textContent = `${current}/${total}`;
  prevBtn.disabled = current <= 1;
  nextBtn.disabled = current >= total;
}

function setAltMode(enabled) {
  isAltMode = enabled;
  if (!enabled) {
    alternativePrograms = [];
    alternativeIndex = 0;
  }
  togglePins(enabled);
  updateAltControls();
}

function togglePins(show) {
  const pins = document.querySelectorAll('.pin-toggle');
  pins.forEach(pin => {
    if (show) {
      pin.classList.remove('hidden');
    } else {
      pin.classList.add('hidden');
      pin.classList.remove('active');
    }
  });
  if (!show) {
    pinnedForms.clear();
  }
}

function computeAlternativePrograms() {
  const pool = filteredCourses.length ? filteredCourses : allCourses;
  alternativeFormOrder = Array.from(formToCRN.keys());
  const currentCourses = alternativeFormOrder.map(formId => {
    const crn = formToCRN.get(formId);
    return pool.find(c => c.CRN === crn) || allCourses.find(c => c.CRN === crn);
  }).filter(Boolean);
  
  if (currentCourses.length === 0) {
    alternativePrograms = [selectedCourses];
    alternativeIndex = 0;
    updateAltControls();
    renderCalendar();
    return;
  }
  
  const candidatesByForm = alternativeFormOrder.map((formId, idx) => {
    const current = currentCourses[idx];
    if (!current) return [];
    if (pinnedForms.has(formId)) return [current];
    const list = pool.filter(c => c.Kod === current.Kod);
    const unique = [];
    const seen = new Set();
    list.forEach(c => {
      if (!seen.has(c.CRN)) {
        seen.add(c.CRN);
        unique.push(c);
      }
    });
    return unique.length ? unique : [current];
  });
  
  const results = [];
  const scheduleByDay = {};
  const currentCombo = [];
  
  const backtrack = idx => {
    if (idx === candidatesByForm.length) {
      results.push([...currentCombo]);
      return;
    }
    for (const course of candidatesByForm[idx]) {
      const blocks = parseCourseBlocks(course);
      if (hasConflict(scheduleByDay, blocks)) continue;
      addBlocks(scheduleByDay, blocks);
      currentCombo.push(course);
      backtrack(idx + 1);
      currentCombo.pop();
      removeBlocks(scheduleByDay, blocks);
    }
  };
  
  backtrack(0);
  
  const comboKey = combo => combo.map(c => c.CRN).join('|');
  const currentKey = comboKey(currentCourses);
  const uniqueResults = [];
  const seen = new Set();
  results.forEach(combo => {
    const key = comboKey(combo);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueResults.push(combo);
    }
  });
  
  if (uniqueResults.length === 0) {
    alternativePrograms = [currentCourses];
  } else {
    // Mevcut programı her zaman 1. sıraya al
    const withoutCurrent = uniqueResults.filter(combo => comboKey(combo) !== currentKey);
    alternativePrograms = [currentCourses, ...withoutCurrent];
  }
  alternativeIndex = 0;
  updateAltControls();
  renderCalendar();
}

function applyAlternativeProgram() {
  const program = alternativePrograms[alternativeIndex];
  if (!program || program.length === 0) return;
  selectedCourses = program.map(c => ({
    Kod: c.Kod,
    Ders: c.Ders,
    CRN: c.CRN,
    'Öğretim Yöntemi': c['Öğretim Yöntemi'],
    Eğitmen: c.Eğitmen,
    Gün: c.Gün,
    Saat: c.Saat,
    Bina: c.Bina
  }));
  
  const newFormToCRN = new Map();
  alternativeFormOrder.forEach((formId, idx) => {
    const course = program[idx];
    if (course) newFormToCRN.set(formId, course.CRN);
  });
  formToCRN = newFormToCRN;
  
  // Renkleri güncelle
  program.forEach(course => {
    if (!courseColors.has(course.CRN)) {
      const color = colorPalette[courseColors.size % colorPalette.length];
      courseColors.set(course.CRN, color);
    }
  });
  
  setAltMode(false);
  rebuildFormsFromState();
  renderCalendar();
  saveNow();
}

function copyAlternativeToNewCalendar() {
  const program = alternativePrograms[alternativeIndex];
  if (!program || program.length === 0) return;
  const current = getCalendarById(currentCalendarId);
  const baseName = `${current?.name || 'Takvimim'} alternatif ${alternativeIndex + 1}`;
  const name = ensureUniqueCalendarName(baseName);
  
  const newCourseColors = [];
  const colorMap = new Map();
  program.forEach(course => {
    if (!colorMap.has(course.CRN)) {
      if (courseColors.has(course.CRN)) {
        colorMap.set(course.CRN, courseColors.get(course.CRN));
      } else {
        const color = colorPalette[colorMap.size % colorPalette.length];
        colorMap.set(course.CRN, color);
      }
    }
  });
  newCourseColors.push(...Array.from(colorMap.entries()));
  
  const newFormToCRN = [];
  alternativeFormOrder.forEach((formId, idx) => {
    const course = program[idx];
    if (course) newFormToCRN.push([formId, course.CRN]);
  });
  
  const newCalendar = {
    id: generateId(),
    name,
    selectedCourses: program.map(c => ({
      Kod: c.Kod,
      Ders: c.Ders,
      CRN: c.CRN,
      'Öğretim Yöntemi': c['Öğretim Yöntemi'],
      Eğitmen: c.Eğitmen,
      Gün: c.Gün,
      Saat: c.Saat,
      Bina: c.Bina
    })),
    courseColors: newCourseColors,
    formToCRN: newFormToCRN,
    filters: {
      anaDal: document.getElementById('ana-dal')?.value || '',
      yanDal: document.getElementById('yan-dal')?.value || ''
    }
  };
  
  calendars.push(newCalendar);
  populateCalendarSelect();
  const select = document.getElementById('calendar-select');
  if (select) select.value = currentCalendarId;
  saveNow();
  alert('Program yeni takvime kopyalandı.');
}

function startAutoSave() {
  if (autoSaveStarted) return;
  autoSaveStarted = true;
  
  // Periyodik kayıt (15 saniyede bir)
  setInterval(() => {
    saveNow();
  }, 15000);
  
  // Sayfa kapanırken son kez kaydet
  window.addEventListener('beforeunload', () => {
    saveNow();
  });
  
  // Sekme arka plana giderken kaydet
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveNow();
    }
  });
}

function applyCalendarToState(calendar) {
  selectedCourses = Array.isArray(calendar.selectedCourses) ? calendar.selectedCourses : [];
  courseColors = new Map(Array.isArray(calendar.courseColors) ? calendar.courseColors : []);
  formToCRN = new Map(Array.isArray(calendar.formToCRN) ? calendar.formToCRN : []);
}

function rebuildFormsFromState() {
  // Formları yeniden oluştur
  const formsContainer = document.getElementById('course-selection-forms');
  if (!formsContainer) return;
  formsContainer.innerHTML = '';
  formCounter = 0;
  if (formToCRN.size === 0) {
    addCourseForm();
    return;
  }
  formToCRN.forEach((crn, formId) => {
    // Form ID'den sayacı çıkar
    const formIdNum = parseInt(formId.replace('course-form-', ''), 10);
    if (!Number.isNaN(formIdNum) && formIdNum >= formCounter) {
      formCounter = formIdNum + 1;
    }
    
    // Formu oluştur
    const wrapper = el('div', { className: 'course-selection-form-wrapper' });
    wrapper.id = formId;
    
    const form = el('div', { className: 'course-selection' });
    
    const pinBtn = el('button', { className: 'pin-toggle hidden', textContent: '📌' });
    pinBtn.addEventListener('click', () => {
      if (pinnedForms.has(formId)) {
        pinnedForms.delete(formId);
        pinBtn.classList.remove('active');
      } else {
        pinnedForms.add(formId);
        pinBtn.classList.add('active');
      }
      if (isAltMode) {
        computeAlternativePrograms();
      }
    });
    
    // Ders bilgisini bul (önce allCourses'da, yoksa selectedCourses'da)
    let course = allCourses.find(c => c.CRN === crn);
    if (!course) {
      course = selectedCourses.find(c => c.CRN === crn);
    }
    if (!course) return;
    
    // Ders Kodu
    const kodGroup = el('div', { className: 'selection-group' });
    const kodSelect = el('select', { id: `ders-kodu-${formId}` });
    kodSelect.appendChild(el('option', { value: '', textContent: 'Seçiniz' }));
    kodGroup.appendChild(kodSelect);
    
    // Ders
    const dersGroup = el('div', { className: 'selection-group' });
    const dersSelect = el('select', { id: `ders-${formId}` });
    dersSelect.appendChild(el('option', { value: '', textContent: 'Seçiniz' }));
    dersGroup.appendChild(dersSelect);
    
    // CRN
    const crnGroup = el('div', { className: 'selection-group' });
    const crnSelect = el('select', { id: `crn-${formId}` });
    crnSelect.appendChild(el('option', { value: '', textContent: 'Seçiniz' }));
    crnGroup.appendChild(crnSelect);
    
    // Silme butonu
    const removeBtn = el('button', {
      className: 'form-remove-btn',
      textContent: '×'
    });
    removeBtn.addEventListener('click', () => {
      const formCRN = formToCRN.get(formId);
      if (formCRN) {
        const courseIndex = selectedCourses.findIndex(c => c.CRN === formCRN);
        if (courseIndex !== -1) {
          selectedCourses.splice(courseIndex, 1);
        }
        formToCRN.delete(formId);
        saveNow();
        renderCalendar();
      }
      wrapper.remove();
    });
    
    form.appendChild(pinBtn);
    form.appendChild(kodGroup);
    form.appendChild(dersGroup);
    form.appendChild(crnGroup);
    
    wrapper.appendChild(form);
    wrapper.appendChild(removeBtn);
    formsContainer.appendChild(wrapper);
    
    // Event listener'ları ekle
    kodSelect.addEventListener('change', () => {
      updateCourseOptionsForForm(formId);
      saveNow();
    });
    dersSelect.addEventListener('change', () => {
      updateCRNOptionsForForm(formId);
      saveNow();
    });
    crnSelect.addEventListener('change', () => {
      if (crnSelect.value) {
        addCourseFromForm(formId);
      }
      saveNow();
    });
    
    // Form değerlerini doldur
    updateCourseCodeOptionsForForm(formId, true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const kodPrefix = course.Kod.split(' ')[0];
        if (kodSelect.querySelector(`option[value="${kodPrefix}"]`)) {
          kodSelect.value = kodPrefix;
          updateCourseOptionsForForm(formId, true);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (dersSelect.querySelector(`option[value="${course.Kod}"]`)) {
                dersSelect.value = course.Kod;
                updateCRNOptionsForForm(formId, true);
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    if (crnSelect.querySelector(`option[value="${crn}"]`)) {
                      crnSelect.value = crn;
                    }
                  });
                });
              }
            });
          });
        }
      });
    });
  });
}

function populateCalendarSelect() {
  const select = document.getElementById('calendar-select');
  if (!select) return;
  select.innerHTML = '';
  calendars.forEach(calendar => {
    const option = el('option', { value: calendar.id, textContent: calendar.name });
    select.appendChild(option);
  });
}

function setCurrentCalendar(id, options = {}) {
  const { skipSave = false } = options;
  if (!id) return;
  if (currentCalendarId) {
    saveNow();
  }
  const calendar = getCalendarById(id);
  if (!calendar) return;
  currentCalendarId = id;
  const select = document.getElementById('calendar-select');
  if (select) select.value = id;
  applyCalendarToState(calendar);
  rebuildFormsFromState();
  
  const anaDalSelect = document.getElementById('ana-dal');
  const yanDalSelect = document.getElementById('yan-dal');
  if (anaDalSelect) anaDalSelect.value = calendar.filters?.anaDal || '';
  if (yanDalSelect) yanDalSelect.value = calendar.filters?.yanDal || '';
  applyFilters({ skipSave: true });
  renderCalendar();
  updateCrnScript();
  if (!skipSave) {
    saveNow();
  }
}

function loadCalendarsFromLocalStorage() {
  try {
    const saved = localStorage.getItem(CALENDARS_STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      calendars = Array.isArray(data.calendars) ? data.calendars : [];
      currentCalendarId = data.currentCalendarId || (calendars[0] && calendars[0].id);
    } else {
      // Legacy migration
      const legacyProgram = localStorage.getItem(STORAGE_KEY);
      const legacyFilters = localStorage.getItem(FILTER_STORAGE_KEY);
      const calendar = {
        id: generateId(),
        name: 'Takvimim',
        selectedCourses: [],
        courseColors: [],
        formToCRN: [],
        filters: { anaDal: '', yanDal: '' }
      };
      if (legacyProgram) {
        try {
          const legacyData = JSON.parse(legacyProgram);
          calendar.selectedCourses = legacyData.selectedCourses || [];
          calendar.courseColors = legacyData.courseColors || [];
          calendar.formToCRN = legacyData.formToCRN || [];
        } catch (e) {
          console.warn('Legacy program verisi okunamadı:', e);
        }
      }
      if (legacyFilters) {
        try {
          const legacyFilterData = JSON.parse(legacyFilters);
          calendar.filters = {
            anaDal: legacyFilterData.anaDal || '',
            yanDal: legacyFilterData.yanDal || ''
          };
        } catch (e) {
          console.warn('Legacy filtre verisi okunamadı:', e);
        }
      }
      calendars = [calendar];
      currentCalendarId = calendar.id;
    }
    
    if (!calendars.length) {
      const calendar = {
        id: generateId(),
        name: 'Takvimim',
        selectedCourses: [],
        courseColors: [],
        formToCRN: [],
        filters: { anaDal: '', yanDal: '' }
      };
      calendars = [calendar];
      currentCalendarId = calendar.id;
    }
    
    populateCalendarSelect();
    setCurrentCalendar(currentCalendarId || calendars[0].id, { skipSave: true });
    // Alternatif mod kontrollerini yüklemede gizle
    setAltMode(false);
    // İlk yükleme tamamlandıktan sonra kaydetmeyi aç
    setTimeout(() => {
      isBootstrapping = false;
      saveNow({ force: true });
    }, 300);
    startAutoSave();
  } catch (e) {
    console.warn('Takvimleri yükleme hatası:', e);
  }
}

function initCalendarManager() {
  const select = document.getElementById('calendar-select');
  const addBtn = document.getElementById('calendar-add');
  const deleteBtn = document.getElementById('calendar-delete');
  const copyBtn = document.getElementById('calendar-copy');
  const renameBtn = document.getElementById('calendar-rename');
  
  if (select) {
    select.addEventListener('change', () => {
      setCurrentCalendar(select.value);
      saveNow();
    });
  }
  
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const defaultName = getNextCalendarName();
      const name = prompt('Yeni takvim adı:', defaultName);
      if (name === null) return;
      const trimmed = name.trim() || defaultName;
      const newCalendar = {
        id: generateId(),
        name: trimmed,
        selectedCourses: [],
        courseColors: [],
        formToCRN: [],
        filters: { anaDal: '', yanDal: '' }
      };
      calendars.push(newCalendar);
      populateCalendarSelect();
      setCurrentCalendar(newCalendar.id);
      saveNow();
    });
  }
  
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (calendars.length <= 1) {
        alert('En az bir takvim olmalı.');
        return;
      }
      const current = getCalendarById(currentCalendarId);
      const ok = confirm(`"${current?.name || 'Takvim'}" silinsin mi?`);
      if (!ok) return;
      calendars = calendars.filter(c => c.id !== currentCalendarId);
      const nextId = calendars[0]?.id;
      populateCalendarSelect();
      setCurrentCalendar(nextId);
      saveNow();
    });
  }
  
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const current = getCalendarById(currentCalendarId);
      if (!current) return;
      saveNow();
      const defaultName = getNextCalendarName();
      const newCalendar = {
        id: generateId(),
        name: defaultName,
        selectedCourses: JSON.parse(JSON.stringify(current.selectedCourses || [])),
        courseColors: JSON.parse(JSON.stringify(current.courseColors || [])),
        formToCRN: JSON.parse(JSON.stringify(current.formToCRN || [])),
        filters: { ...(current.filters || { anaDal: '', yanDal: '' }) }
      };
      calendars.push(newCalendar);
      populateCalendarSelect();
      setCurrentCalendar(newCalendar.id);
      saveNow();
    });
  }
  
  if (renameBtn) {
    renameBtn.addEventListener('click', () => {
      const current = getCalendarById(currentCalendarId);
      if (!current) return;
      const name = prompt('Takvim adını düzenle:', current.name);
      if (name === null) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      current.name = trimmed;
      populateCalendarSelect();
      setCurrentCalendar(current.id);
      saveNow();
    });
  }
}

// CSV ve JSON yükle
Promise.all([
  fetch('data/program.csv').then(r => {
    if (!r.ok) throw new Error(`CSV yüklenemedi: ${r.status}`);
    return r.text();
  }),
  fetch('data/department_filters.json').then(r => {
    if (!r.ok) throw new Error(`JSON yüklenemedi: ${r.status}`);
    return r.json();
  })
]).then(([csvText, depts]) => {
  departmentFilters = depts;
  
  // CSV'yi parse et
  Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    complete: ({ data, errors }) => {
      if (errors.length > 0) {
        console.warn('CSV parse hataları:', errors);
      }
      allCourses = data;
      filteredCourses = [...allCourses];
      
      console.log(`${allCourses.length} ders yüklendi`);
      
      initFilters();
      initCourseSelection();
      initCalendarManager();
      loadCalendarsFromLocalStorage();
    }
  });
}).catch(error => {
  console.error('Veri yükleme hatası:', error);
  alert('Veriler yüklenirken bir hata oluştu. Lütfen sayfayı yenileyin.');
});

// Filtreleri başlat
function initFilters() {
  const anaDalSelect = document.getElementById('ana-dal');
  const yanDalSelect = document.getElementById('yan-dal');
  
  departmentFilters.forEach(fac => {
    const anaGroup = el('optgroup', { label: fac.faculty });
    const yanGroup = el('optgroup', { label: fac.faculty });
    
    fac.programs.forEach(p => {
      const option = el('option', { value: p.code, textContent: p.name });
      anaGroup.appendChild(option.cloneNode(true));
      yanGroup.appendChild(option.cloneNode(true));
    });
    
    anaDalSelect.appendChild(anaGroup);
    yanDalSelect.appendChild(yanGroup);
  });
  
  document.getElementById('filtrele-btn').addEventListener('click', applyFilters);

  // Filtre seçimlerinde anında kaydet
  if (anaDalSelect) {
    anaDalSelect.addEventListener('change', () => {
      saveNow();
    });
  }
  if (yanDalSelect) {
    yanDalSelect.addEventListener('change', () => {
      saveNow();
    });
  }
}

// Filtreleme uygula
function applyFilters(options = {}) {
  const { skipSave = false } = options;
  const anaDal = document.getElementById('ana-dal').value;
  const yanDal = document.getElementById('yan-dal').value;
  
  if (!skipSave) {
    saveNow();
  }
  
  if (!anaDal && !yanDal) {
    filteredCourses = [...allCourses];
  } else {
    filteredCourses = allCourses.filter(course => {
      const bolumSinirlamasi = course['Bölüm Sınırlaması'] || course['Bölüm'] || '';
      if (!bolumSinirlamasi) return false;
      const limits = bolumSinirlamasi.split(',').map(s => s.trim());
      return (anaDal && limits.includes(anaDal)) || (yanDal && limits.includes(yanDal));
    });
  }
  
  updateCourseCodeOptions();
  
  // Mevcut formların dropdown'larını güncelle (değerleri koruyarak)
  const forms = document.querySelectorAll('.course-selection-form-wrapper');
  forms.forEach(wrapper => {
    const formId = wrapper.id;
    const kodSelect = document.getElementById(`ders-kodu-${formId}`);
    const dersSelect = document.getElementById(`ders-${formId}`);
    const crnSelect = document.getElementById(`crn-${formId}`);
    
    if (!kodSelect || !dersSelect || !crnSelect) return;
    
    // Formun CRN'ini kontrol et (formToCRN'den)
    const formCRN = formToCRN.get(formId);
    if (formCRN) {
      // formToCRN'de CRN varsa, ders bilgisini bul ve dropdown'ları güncelle
      const course = allCourses.find(c => c.CRN === formCRN);
      if (course) {
        // Önce ders kodunu güncelle
        updateCourseCodeOptionsForForm(formId);
        
        // Dropdown'ların dolmasını bekle
        requestAnimationFrame(() => {
          const kodPrefix = course.Kod.split(' ')[0];
          // Ders kodu filtrelenmiş listede var mı kontrol et
          const kodExists = filteredCourses.some(c => c.Kod.startsWith(kodPrefix));
          if (kodExists && kodSelect.querySelector(`option[value="${kodPrefix}"]`)) {
            kodSelect.value = kodPrefix;
            updateCourseOptionsForForm(formId);
            
            requestAnimationFrame(() => {
              // Ders filtrelenmiş listede var mı kontrol et
              const dersExists = filteredCourses.some(c => c.Kod === course.Kod);
              if (dersExists && dersSelect.querySelector(`option[value="${course.Kod}"]`)) {
                dersSelect.value = course.Kod;
                updateCRNOptionsForForm(formId);
                
                requestAnimationFrame(() => {
                  // CRN filtrelenmiş listede var mı kontrol et
                  const crnExists = filteredCourses.some(c => c.CRN === formCRN && c.Kod === course.Kod);
                  if (crnExists && crnSelect.querySelector(`option[value="${formCRN}"]`)) {
                    crnSelect.value = formCRN;
                  } else {
                    // CRN filtrelenmiş listede yoksa, sıfırla
                    crnSelect.value = '';
                  }
                });
              } else {
                // Ders filtrelenmiş listede yoksa, sıfırla
                dersSelect.value = '';
                crnSelect.value = '';
              }
            });
          } else {
            // Ders kodu filtrelenmiş listede yoksa, sıfırla
            kodSelect.value = '';
            dersSelect.value = '';
            crnSelect.value = '';
          }
        });
        return;
      }
    }
    
    // Eğer formToCRN'de CRN yoksa, mevcut dropdown değerlerini kontrol et
    const currentKod = kodSelect.value;
    const currentDers = dersSelect.value;
    const currentCRN = crnSelect.value;
    
    if (currentKod || currentDers || currentCRN) {
      // Ders kodunu güncelle
      updateCourseCodeOptionsForForm(formId);
      
      // Eğer ders kodu seçiliyse, ders dropdown'ını güncelle
      if (currentKod) {
        // Ders kodunun hala filtrelenmiş listede olup olmadığını kontrol et
        const kodExists = filteredCourses.some(c => c.Kod.startsWith(currentKod));
        if (kodExists) {
          // Ders kodunu koru ve ders dropdown'ını güncelle
          requestAnimationFrame(() => {
            if (kodSelect.querySelector(`option[value="${currentKod}"]`)) {
              kodSelect.value = currentKod;
              updateCourseOptionsForForm(formId);
              
              // Eğer ders seçiliyse, ders dropdown'ını güncelle
              if (currentDers) {
                requestAnimationFrame(() => {
                  const dersExists = filteredCourses.some(c => c.Kod === currentDers);
                  if (dersExists && dersSelect.querySelector(`option[value="${currentDers}"]`)) {
                    dersSelect.value = currentDers;
                    updateCRNOptionsForForm(formId);
                    
                    // Eğer CRN seçiliyse, CRN dropdown'ını güncelle
                    if (currentCRN) {
                      requestAnimationFrame(() => {
                        const crnExists = filteredCourses.some(c => c.CRN === currentCRN && c.Kod === currentDers);
                        if (crnExists && crnSelect.querySelector(`option[value="${currentCRN}"]`)) {
                          crnSelect.value = currentCRN;
                        } else {
                          // CRN filtrelenmiş listede yoksa, sıfırla
                          crnSelect.value = '';
                        }
                      });
                    }
                  } else {
                    // Ders filtrelenmiş listede yoksa, sıfırla
                    dersSelect.value = '';
                    crnSelect.value = '';
                  }
                });
              }
            } else {
              // Ders kodu filtrelenmiş listede yoksa, sıfırla
              kodSelect.value = '';
              dersSelect.value = '';
              crnSelect.value = '';
            }
          });
        } else {
          // Ders kodu filtrelenmiş listede yoksa, sıfırla
          kodSelect.value = '';
          dersSelect.value = '';
          crnSelect.value = '';
        }
      }
    }
  });
}

// Ders seçimini başlat
function initCourseSelection() {
  // Yeni ders formu ekle butonu
  document.getElementById('yeni-ders-form-btn').addEventListener('click', () => {
    addCourseForm();
  });
  
  // Takvimi indir butonu
  const downloadBtn = document.getElementById('download-calendar-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadCalendarAsImage);
  }
  
  updateCrnScript();

  const altBtn = document.getElementById('alt-crn-btn');
  const prevBtn = document.getElementById('alt-prev');
  const nextBtn = document.getElementById('alt-next');
  const copyBtn = document.getElementById('alt-copy');
  const confirmBtn = document.getElementById('alt-confirm');
  
  if (altBtn) {
    altBtn.addEventListener('click', () => {
      setAltMode(true);
      computeAlternativePrograms();
    });
  }
  
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (alternativeIndex > 0) {
        alternativeIndex -= 1;
        updateAltControls();
        renderCalendar();
      }
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (alternativeIndex < alternativePrograms.length - 1) {
        alternativeIndex += 1;
        updateAltControls();
        renderCalendar();
      }
    });
  }
  
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      copyAlternativeToNewCalendar();
    });
  }

  updateCrnScript();
  
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      applyAlternativeProgram();
    });
  }

  // Alternatif mod kontrollerini başlangıçta gizle
  setAltMode(false);
}

// Yeni ders seçim formu ekle
function addCourseForm() {
  const formId = `course-form-${formCounter++}`;
  const formsContainer = document.getElementById('course-selection-forms');
  
  const formWrapper = el('div', { className: 'course-selection-form-wrapper' });
  formWrapper.id = formId;
  
  const form = el('div', { className: 'course-selection' });
  
  const pinBtn = el('button', { className: 'pin-toggle hidden', textContent: '📌' });
  pinBtn.addEventListener('click', () => {
    if (pinnedForms.has(formId)) {
      pinnedForms.delete(formId);
      pinBtn.classList.remove('active');
    } else {
      pinnedForms.add(formId);
      pinBtn.classList.add('active');
    }
    if (isAltMode) {
      computeAlternativePrograms();
    }
  });
  
  // Ders Kodu
  const kodGroup = el('div', { className: 'selection-group' });
  const kodSelect = el('select', { id: `ders-kodu-${formId}` });
  kodSelect.appendChild(el('option', { value: '', textContent: 'Seçiniz' }));
  kodGroup.appendChild(kodSelect);
  
  // Ders
  const dersGroup = el('div', { className: 'selection-group' });
  const dersSelect = el('select', { id: `ders-${formId}` });
  dersSelect.appendChild(el('option', { value: '', textContent: 'Seçiniz' }));
  dersGroup.appendChild(dersSelect);
  
  // CRN
  const crnGroup = el('div', { className: 'selection-group' });
  const crnSelect = el('select', { id: `crn-${formId}` });
  crnSelect.appendChild(el('option', { value: '', textContent: 'Seçiniz' }));
  crnGroup.appendChild(crnSelect);
  
  // Silme butonu
  const removeBtn = el('button', {
    className: 'form-remove-btn',
    textContent: '×'
  });
  removeBtn.addEventListener('click', () => {
    // Formdan eklenen dersi kaldır
    const formCRN = formToCRN.get(formId);
    if (formCRN) {
      const courseIndex = selectedCourses.findIndex(c => c.CRN === formCRN);
      if (courseIndex !== -1) {
        selectedCourses.splice(courseIndex, 1);
      }
      formToCRN.delete(formId);
      saveNow();
    renderCalendar();
    }
    // Formu kaldır
    formWrapper.remove();
  });
  
  form.appendChild(pinBtn);
  form.appendChild(kodGroup);
  form.appendChild(dersGroup);
  form.appendChild(crnGroup);
  
  formWrapper.appendChild(form);
  formWrapper.appendChild(removeBtn); // X butonunu formWrapper içine ekle (absolute positioning için)
  formsContainer.appendChild(formWrapper);
  
  // Event listener'ları ekle
  updateCourseCodeOptionsForForm(formId);
  kodSelect.addEventListener('change', () => {
    updateCourseOptionsForForm(formId);
    saveNow();
  });
  dersSelect.addEventListener('change', () => {
    updateCRNOptionsForForm(formId);
    saveNow();
  });
  // CRN değiştiğinde otomatik olarak ders ekle
  crnSelect.addEventListener('change', () => {
    if (crnSelect.value) {
      addCourseFromForm(formId);
    }
    saveNow();
  });
}

// Ders kodlarını güncelle (belirli form için)
function updateCourseCodeOptionsForForm(formId, useAllCourses = false) {
  const select = document.getElementById(`ders-kodu-${formId}`);
  if (!select) return;
  
  const currentValue = select.value;
  // Form yüklenirken allCourses kullan, normal kullanımda filteredCourses kullan
  const sourceCourses = useAllCourses ? allCourses : filteredCourses;
  const codes = [...new Set(sourceCourses.map(c => c.Kod.split(' ')[0]))].sort();
  
  select.innerHTML = '<option value="">Seçiniz</option>';
  codes.forEach(code => {
    select.appendChild(el('option', { value: code, textContent: code }));
  });
  
  if (codes.includes(currentValue)) {
    select.value = currentValue;
  }
  
  // Ders ve CRN'i sıfırla
  const dersSelect = document.getElementById(`ders-${formId}`);
  const crnSelect = document.getElementById(`crn-${formId}`);
  if (dersSelect) dersSelect.innerHTML = '<option value="">Seçiniz</option>';
  if (crnSelect) crnSelect.innerHTML = '<option value="">Seçiniz</option>';
}

// Tüm formlar için ders kodlarını güncelle
function updateCourseCodeOptions() {
  const forms = document.querySelectorAll('.course-selection-form-wrapper');
  forms.forEach(wrapper => {
    const formId = wrapper.id;
    updateCourseCodeOptionsForForm(formId);
  });
}

// Ders seçeneklerini güncelle (belirli form için)
function updateCourseOptionsForForm(formId, useAllCourses = false) {
  const codeSelect = document.getElementById(`ders-kodu-${formId}`);
  const courseSelect = document.getElementById(`ders-${formId}`);
  const crnSelect = document.getElementById(`crn-${formId}`);
  
  if (!codeSelect || !courseSelect) return;
  
  const code = codeSelect.value;
  
  courseSelect.innerHTML = '<option value="">Seçiniz</option>';
  if (crnSelect) crnSelect.innerHTML = '<option value="">Seçiniz</option>';
  
  if (!code) return;

  // Form yüklenirken allCourses kullan, normal kullanımda filteredCourses kullan
  const sourceCourses = useAllCourses ? allCourses : filteredCourses;
  const courses = sourceCourses.filter(c => c.Kod.startsWith(code));
  const uniqueCourses = [...new Map(courses.map(c => [c.Kod, c.Ders])).entries()];
  
  uniqueCourses.forEach(([kod, ders]) => {
    const option = el('option', { value: kod, textContent: `${kod} - ${ders}` });
    courseSelect.appendChild(option);
  });
}

// CRN seçeneklerini güncelle (belirli form için)
function updateCRNOptionsForForm(formId, useAllCourses = false) {
  const courseSelect = document.getElementById(`ders-${formId}`);
  const crnSelect = document.getElementById(`crn-${formId}`);
  
  if (!courseSelect || !crnSelect) return;
  
  const kod = courseSelect.value;
  
  crnSelect.innerHTML = '<option value="">Seçiniz</option>';
  
  if (!kod) return;
  
  // Form yüklenirken allCourses kullan, normal kullanımda filteredCourses kullan
  const sourceCourses = useAllCourses ? allCourses : filteredCourses;
  const crns = sourceCourses.filter(c => c.Kod === kod);
  const uniqueCRNs = [...new Set(crns.map(c => c.CRN))].sort();
  
  uniqueCRNs.forEach(crn => {
    const course = crns.find(c => c.CRN === crn);
    // Gün ve saatleri daha okunabilir formatta göster
    const gunDisplay = course.Gün.replace(/\s*\/\s*/g, ', ').replace(/\s*\|\s*/g, ', ');
    const saatDisplay = course.Saat.replace(/\s+\/\s+/g, ' | ').replace(/\s*\|\s*/g, ' | ');
    const info = `${crn} - ${course.Eğitmen} (${gunDisplay}, ${saatDisplay})`;
    const option = el('option', { value: crn, textContent: info });
    crnSelect.appendChild(option);
  });
}

// Ders ekle
function addCourse() {
  const kod = document.getElementById('ders').value;
  const crn = document.getElementById('crn').value;
  
  if (!kod || !crn) {
    alert('Lütfen ders ve CRN seçiniz!');
    return;
  }
  
  // Zaten ekli mi kontrol et
  if (selectedCourses.some(c => c.CRN === crn)) {
    alert('Bu ders zaten eklenmiş!');
    return;
  }
  
  const course = filteredCourses.find(c => c.Kod === kod && c.CRN === crn);
  if (!course) return;
  
  // Renk ata
  if (!courseColors.has(crn)) {
    const color = colorPalette[courseColors.size % colorPalette.length];
    courseColors.set(crn, color);
  }
  
  selectedCourses.push({
    Kod: course.Kod,
    Ders: course.Ders,
    CRN: course.CRN,
    'Öğretim Yöntemi': course['Öğretim Yöntemi'],
    Eğitmen: course.Eğitmen,
    Gün: course.Gün,
    Saat: course.Saat,
    Bina: course.Bina
  });
  
  renderCalendar();
  
  // Formu sıfırla (boşaltma - artık formlar dinamik olduğu için bu fonksiyon kullanılmıyor)
  // Eski kod: document.getElementById('ders').value = '';
  // Eski kod: document.getElementById('crn').innerHTML = '<option value="">Seçiniz</option>';
}

// Ders ekle (belirli formdan)
function addCourseFromForm(formId) {
  const kodSelect = document.getElementById(`ders-${formId}`);
  const crnSelect = document.getElementById(`crn-${formId}`);
  
  if (!kodSelect || !crnSelect) return;
  
  const kod = kodSelect.value;
  const crn = crnSelect.value;
  
  if (!kod || !crn) {
    return; // Sessizce atla
  }
  
  // Aynı formdan daha önce eklenen dersi kaldır (eğer varsa)
  const previousCRN = formToCRN.get(formId);
  if (previousCRN && previousCRN !== crn) {
    const previousIndex = selectedCourses.findIndex(c => c.CRN === previousCRN);
    if (previousIndex !== -1) {
      selectedCourses.splice(previousIndex, 1);
    }
  }
  
  // Eğer yeni CRN zaten başka bir formdan eklenmişse
  const existingIndex = selectedCourses.findIndex(c => c.CRN === crn);
  if (existingIndex !== -1) {
    // Önceki formun mapping'ini kaldır ve yeni formun mapping'ini güncelle
    formToCRN.forEach((prevCRN, prevFormId) => {
      if (prevCRN === crn && prevFormId !== formId) {
        formToCRN.delete(prevFormId);
      }
    });
    formToCRN.set(formId, crn);
    saveNow();
    renderCalendar();
    return;
  }
  
  const course = filteredCourses.find(c => c.Kod === kod && c.CRN === crn);
  if (!course) return;
  
  // Renk ata
  if (!courseColors.has(crn)) {
    const color = colorPalette[courseColors.size % colorPalette.length];
    courseColors.set(crn, color);
  }
  
  selectedCourses.push({
    Kod: course.Kod,
    Ders: course.Ders,
    CRN: course.CRN,
    'Öğretim Yöntemi': course['Öğretim Yöntemi'],
    Eğitmen: course.Eğitmen,
    Gün: course.Gün,
    Saat: course.Saat,
    Bina: course.Bina
  });
  
  // Formun son eklediği CRN'i kaydet
  formToCRN.set(formId, crn);
  
  saveNow();
  renderCalendar();
  
  // Formu sıfırlama
}


// Takvimi görüntü olarak indir
function downloadCalendarAsImage() {
  const calendar = document.getElementById('calendar');
  if (!calendar) {
    alert('Takvim bulunamadı!');
    return;
  }
  
  // Butonu geçici olarak devre dışı bırak
  const downloadBtn = document.getElementById('download-calendar-btn');
  if (downloadBtn) {
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'İndiriliyor...';
  }
  
  // html2canvas ile takvimi görüntüye çevir
  html2canvas(calendar, {
    backgroundColor: '#ffffff',
    scale: 2, // Yüksek kalite için
    logging: false,
    useCORS: true
  }).then(canvas => {
    // Canvas'ı PNG olarak indir
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ders-programi.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      // Butonu tekrar aktif et
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Takvimi İndir';
      }
    }, 'image/png');
  }).catch(error => {
    console.error('Görüntü oluşturma hatası:', error);
    alert('Takvim görüntüsü oluşturulurken bir hata oluştu.');
    
    // Butonu tekrar aktif et
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = '📥 Takvimi İndir';
    }
  });
}

// İndirme butonu event listener'ı
document.addEventListener('DOMContentLoaded', () => {
  const downloadBtn = document.getElementById('download-calendar-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadCalendarAsImage);
  }
});

// Takvim çiz
function renderCalendar() {
  const calendar = document.getElementById('calendar');
  calendar.innerHTML = '';
  
  // Header
  const header = el('div', { className: 'calendar-header' });
  header.appendChild(el('div', { className: 'calendar-time-header', textContent: '' }));
  ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'].forEach(day => {
    header.appendChild(el('div', { className: 'calendar-day-header', textContent: day }));
  });
  calendar.appendChild(header);
  
  // Body
  const body = el('div', { className: 'calendar-body' });
  
  // Zaman slotları: 08:00 - 18:00 (her 30 dakika)
  const times = [];
  for (let h = 8; h <= 18; h++) {
    times.push(`${h.toString().padStart(2, '0')}:00`);
    if (h < 18) {
      times.push(`${h.toString().padStart(2, '0')}:30`);
    }
  }
  
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const dayNames = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
  
  // Zaman etiketlerini sol tarafa absolute olarak ekle
  // 20 slot (08:00-18:00), body yüksekliği 515px
  const slotHeight = 25.75; // 515px / 20 slot = 25.75px
  const headerHeight = 45;
  
  times.forEach((time, timeIdx) => {
    const timeLabel = el('div', { 
      className: 'calendar-time-label',
      textContent: time 
    });
    timeLabel.style.position = 'absolute';
    // Çizginin üzerinde görünmesi için biraz yukarı kaydır
    timeLabel.style.top = (headerHeight + timeIdx * slotHeight - 1) + 'px';
    timeLabel.style.left = '0';
    timeLabel.style.width = '60px';
    timeLabel.style.height = slotHeight + 'px';
    calendar.appendChild(timeLabel);
    
    // Gün slotları (sadece 5 gün, zaman sütunu yok)
    days.forEach(() => {
      body.appendChild(el('div', { className: 'calendar-day-slot' }));
    });
  });
  
  calendar.appendChild(body);
  
  // Ders bloklarını çiz
  // Calendar genişliği: 1600px (sabit değer - CSS ile aynı olmalı)
  const calendarWidth = 1600;
  const timeColumnWidth = 60; // Zaman sütunu genişliği
  const dayWidth = (calendarWidth - timeColumnWidth) / 5; // 308px per day
  
  // Önce tüm ders bloklarını hazırla (çakışma kontrolü için)
  const courseBlocks = [];
  
  const coursesToRender = getCoursesForRender();
  coursesToRender.forEach(course => {
    // Günleri parse et: "Tuesday / Wednesday" veya "Tuesday | Wednesday" -> ["Tuesday", "Wednesday"]
    const gunler = course.Gün.split(/\s*\/\s*|\s*\|\s*/).map(g => g.trim()).filter(g => g);
    
    // Saatleri parse et: "14:30/17:29 / 09:30/11:29" veya "14:30/17:29 | 09:30/11:29" -> ["14:30/17:29", "09:30/11:29"]
    // Önce " / " (boşluk + slash + boşluk) veya " | " ile ayır, tek "/" saat aralığı içindir
    const saatParts = course.Saat.split(/\s+\/\s+|\s+\|\s+/).map(s => s.trim()).filter(s => s);
    
    gunler.forEach((gunStr, idx) => {
      // Her gün için karşılık gelen saat
      const saatStr = saatParts[idx] || saatParts[0];
      if (!saatStr) return;
      
      // Saat formatı: "14:30/17:29"
      const [start, end] = saatStr.split('/').map(t => t.trim());
      if (!start || !end) return;
      
      const dayIdx = days.findIndex(d => gunStr.includes(d));
      if (dayIdx === -1) return;
      
      const toMin = t => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
      };
      
      const startMin = toMin(start);
      const endMin = toMin(end);
      
      // 08:00 = 480 dakika, 18:00 = 1080 dakika
      const calStart = 8 * 60; // 08:00
      const calEnd = 18 * 60; // 18:00
      const calDuration = calEnd - calStart; // 600 dakika (10 saat)
      
      // Takvim body yüksekliği: 515px (560px - 45px header)
      const bodyHeight = 515;
      const headerHeight = 45;
      const slotHeight = 25.75; // 515px / 20 slot = 25.75px
      
      // Zaman bazlı pozisyon hesaplama
      // Her slot 30 dakika = 25.75px, yani 1 dakika = 25.75/30 = 0.858px
      const minutesPerPixel = slotHeight / 30; // 30 dakika = 25.75px
      const topPx = (startMin - calStart) * minutesPerPixel;
      const heightPx = (endMin - startMin) * minutesPerPixel;
      
      // Gün bazlı pozisyon hesaplama
      // Zaman sütunu genişliği kadar sağa kaydır
      const leftPx = timeColumnWidth + (dayIdx * dayWidth);
      
      // Ders blok bilgilerini kaydet
      courseBlocks.push({
        course,
        dayIdx,
        startMin,
        endMin,
        topPx,
        heightPx,
        start,
        end
      });
    });
  });
  
  // Çakışmaları tespit et ve düzenle
  const blocksByDay = {};
  courseBlocks.forEach(block => {
    if (!blocksByDay[block.dayIdx]) {
      blocksByDay[block.dayIdx] = [];
    }
    blocksByDay[block.dayIdx].push(block);
  });
  
  // Her gün için çakışmaları çöz
  Object.keys(blocksByDay).forEach(dayIdx => {
    const dayBlocks = blocksByDay[dayIdx];
    
    // Blokları başlangıç zamanına göre sırala
    dayBlocks.sort((a, b) => a.startMin - b.startMin);
    
    // Çakışma gruplarını bul - daha iyi algoritma
    const groups = [];
    dayBlocks.forEach(block => {
      // Bu blokla çakışan tüm grupları bul
      const conflictingGroups = [];
      groups.forEach((group, groupIdx) => {
        const hasConflict = group.some(b => 
          (block.startMin < b.endMin && block.endMin > b.startMin)
        );
        if (hasConflict) {
          conflictingGroups.push(groupIdx);
        }
      });
      
      if (conflictingGroups.length === 0) {
        // Çakışma yok, yeni grup oluştur
        groups.push([block]);
      } else if (conflictingGroups.length === 1) {
        // Tek bir grupla çakışıyor, o gruba ekle
        groups[conflictingGroups[0]].push(block);
      } else {
        // Birden fazla grupla çakışıyor, grupları birleştir
        const mergedGroup = [block];
        // Çakışan grupları ters sırada birleştir (splice için)
        conflictingGroups.sort((a, b) => b - a);
        conflictingGroups.forEach(groupIdx => {
          mergedGroup.push(...groups[groupIdx]);
          groups.splice(groupIdx, 1);
        });
        groups.push(mergedGroup);
      }
    });
    
    // Grupları başlangıç zamanına göre sırala (görsel düzen için)
    groups.forEach(group => {
      group.sort((a, b) => a.startMin - b.startMin);
    });
    
    // Her grup için blokları oluştur ve yerleştir
    groups.forEach(group => {
      const groupWidth = dayWidth / group.length;
      group.forEach((block, idx) => {
        const blockEl = el('div', { className: 'course-block' });
        const blockColor = courseColors.get(block.course.CRN) || colorPalette[Math.abs(block.course.CRN?.toString()?.split('').reduce((a, c) => a + c.charCodeAt(0), 0) || 0) % colorPalette.length];
        blockEl.style.backgroundColor = blockColor;
        blockEl.style.position = 'absolute';
        blockEl.style.top = (headerHeight + block.topPx) + 'px';
        blockEl.style.left = (timeColumnWidth + (block.dayIdx * dayWidth) + (idx * groupWidth)) + 'px';
        blockEl.style.width = (groupWidth - 2) + 'px';
        blockEl.style.height = Math.max(block.heightPx, 15) + 'px';
        
        // Saat bilgisi
        blockEl.appendChild(el('div', { 
          className: 'course-block-time', 
          textContent: `${block.start}-${block.end}` 
        }));
        
        // Ders kodu
        blockEl.appendChild(el('div', { 
          className: 'course-block-code', 
          textContent: block.course.Kod 
        }));
        
        // Ders adı
        blockEl.appendChild(el('div', { 
          className: 'course-block-name', 
          textContent: block.course.Ders 
        }));

        // Öğretim yöntemi
        if (block.course['Öğretim Yöntemi']) {
          blockEl.appendChild(el('div', {
            className: 'course-block-method',
            textContent: block.course['Öğretim Yöntemi']
          }));
        }
        
        // Hoca adı
        if (block.course.Eğitmen && block.course.Eğitmen !== '-') {
          blockEl.appendChild(el('div', { 
            className: 'course-block-instructor', 
            textContent: block.course.Eğitmen 
          }));
        }
        
        // Bina bilgisi
        if (block.course.Bina && block.course.Bina !== '-') {
          const binaText = block.course.Bina.split('/').map(b => b.trim()).filter(b => b && b !== '--').join(', ');
          if (binaText) {
            blockEl.appendChild(el('div', { 
              className: 'course-block-location', 
              textContent: binaText 
            }));
          }
        }
        
        calendar.appendChild(blockEl);
      });
    });
  });
}
