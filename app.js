const STORE_KEY = 'tdg.archive.v1';
const ACCOUNT_KEY = 'tdg.accounts.v1';
const SESSION_KEY = 'tdg.session.v1';
const VISITOR_KEY = 'tdg.visitor.v1';
const COMMENTS_KEY = 'tdg.comments.v1';
const MESSAGES_KEY = 'tdg.messages.v1';
const SUPPORT_KEY = 'tdg.support.v1';

const visitorId = getOrCreateVisitor();
let projects = loadProjects();
let accounts = loadAccounts();
let currentUser = getCurrentUser();
let comments = loadComments();
let messages = loadMessages();
let selectedProjectFile = null;
let toastTimer;
let pendingAction = null;
let activeChatUserId = null;

const grid = document.getElementById('grave-grid');
const backdrop = document.getElementById('modal-backdrop');
const modalContent = document.getElementById('modal-content');
const modal = document.getElementById('modal');

function getOrCreateVisitor() {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

function loadProjects() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) {}
  const list = Array.isArray(saved)
    ? saved.filter(p => !String(p.id || '').startsWith('seed-') && typeof p.ownerId === 'string' && p.ownerId.length > 0)
    : [];
  localStorage.setItem(STORE_KEY, JSON.stringify(list));
  return list;
}

function persist() { localStorage.setItem(STORE_KEY, JSON.stringify(projects)); }
function loadAccounts() { try { const a = JSON.parse(localStorage.getItem(ACCOUNT_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function saveAccounts() { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts)); }
function getCurrentUser() { const id = localStorage.getItem(SESSION_KEY); return accounts.find(a => a.id === id) || null; }
function loadComments() { try { const c = JSON.parse(localStorage.getItem(COMMENTS_KEY)); return c && typeof c === 'object' ? c : {}; } catch (e) { return {}; } }
function persistComments() { localStorage.setItem(COMMENTS_KEY, JSON.stringify(comments)); }
function loadMessages() { try { const m = JSON.parse(localStorage.getItem(MESSAGES_KEY)); return Array.isArray(m) ? m : []; } catch (e) { return []; } }
function persistMessages() { localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages)); }
function userKey() { return currentUser ? 'account:' + currentUser.id : 'visitor:' + visitorId; }

function updateAccountButton() {
  const b = document.getElementById('account-button');
  if (!b) return;
  b.innerHTML = currentUser ? '<span>◉</span>' + esc(currentUser.username) : '<span>◉</span> Войти';
  b.title = currentUser ? 'Аккаунт ' + currentUser.username : 'Войти или зарегистрироваться';
}

function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function safeImage(value) { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch (e) { return ''; } }

function formatBytes(size) {
  if (size >= 1073741824) return (size / 1073741824).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + ' GB';
  if (size >= 1048576) return (size / 1048576).toFixed(1) + ' MB';
  if (size >= 1024) return Math.round(size / 1024) + ' KB';
  return size + ' B';
}

function openFileDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tdg-project-files', 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('files')) request.result.createObjectStore('files', { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB недоступен'));
  });
}

function saveProjectFile(id, file) {
  return openFileDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put({ id, blob: file, name: file.name, type: file.type || 'application/octet-stream', size: file.size });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const error = tx.error || new Error('Не удалось сохранить файл'); db.close(); reject(error); };
  }));
}

function deleteStoredProjectFile(id) {
  return openFileDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('Не удалось удалить вложение')); };
  }));
}

function downloadProjectFile(id, name) {
  return openFileDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const request = tx.objectStore('files').get(id);
    request.onsuccess = () => {
      const record = request.result;
      if (!record) { reject(new Error('Файл не найден')); return; }
      const url = URL.createObjectURL(record.blob);
      const a = document.createElement('a');
      a.href = url; a.download = name || record.name || 'project-file';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      resolve();
    };
    request.onerror = () => reject(request.error || new Error('Ошибка файла'));
    tx.oncomplete = () => db.close();
  }));
}

// ---------- ЛОКАЛЬНЫЙ ИИ-МОДЕРАТОР ----------

const BAD_WORDS_RE = /(^|[^\p{L}\p{N}])(?:пенис\p{L}*|вагин\p{L}*|вульв\p{L}*|порн\p{L}*|эротик\p{L}*|сперм\p{L}*|минет\p{L}*|куни\p{L}*|дроч\p{L}*|секс\p{L}*|хуй\p{L}*|пизд\p{L}*|еб(?:ать|у|л|ан|н|ись|ени|аш|ну|ал|ла)\p{L}*|бляд\p{L}*|манда\p{L}*|гандон\p{L}*|пидор\p{L}*|педик\p{L}*|сука\p{L}*|сучк\p{L}*|хер\p{L}*|fuck\p{L}*|shit\p{L}*|porn\p{L}*|penis\p{L}*|vagina\p{L}*|dick\p{L}*|cock\p{L}*|sex\p{L}*|nude\p{L}*|xxx)(?=$|[^\p{L}\p{N}])/iu;

const CATEGORY_KEYWORDS = {
  'Социальное': ['социал', 'общен', 'люди', 'друз', 'связ', 'чат', 'сеть', 'комьюнити', 'сообществ'],
  'Web3': ['web3', 'блокчейн', 'крипт', 'токен', 'nft', 'кошел', 'децентрал', 'смарт', 'контракт', 'эфир'],
  'Маркетплейс': ['маркет', 'площадк', 'торг', 'прода', 'покуп', 'магазин', 'услуг', 'товар', 'доск', 'объявлен'],
  'Искусственный интеллект': ['ии', 'ai', 'нейросет', 'интеллект', 'машин', 'обучен', 'gpt', 'бот', 'нейрон', 'генерац'],
  'Игры': ['игр', 'геймплей', 'разработ', 'персонаж', 'уровен', 'гейм', 'консол', 'квест', 'шутер', 'стратег'],
  'Приложение': ['прилож', 'app', 'софт', 'программ', 'сервис', 'мобил', 'утилит', 'интерфейс', 'софт', 'клиент']
};

// Функция поиска бессмыслицы (спам, набор букв, отсутствие гласных)
function isNonsense(text) {
  const t = text.trim().toLowerCase();
  if (t.length < 3) return true;
  // Повторяющиеся символы (аааааа)
  if (/(.)\1{3,}/.test(t)) return true;
  // Спам с клавиатуры
  const keyboardMashes = ['йцукен', 'фывапр', 'ячсмит', 'qwerty', 'asdfgh', 'zxcvbn', '123456', 'ываол', 'цйукк'];
  if (keyboardMashes.some(mash => t.includes(mash))) return true;
  
  const vowels = (t.match(/[аеёиоуыэюяaeiouy]/g) || []).length;
  const consonants = (t.match(/[бвгджзйклмнпрстфхцчшщbcdfghjklmnpqrstvwxyz]/g) || []).length;
  
  // Слишком много согласных или гласных подряд
  if (vowels === 0 && consonants > 2) return true;
  if (consonants === 0 && vowels > 2) return true;
  
  // Если текст длинный, но в нем нет пробелов, и соотношение гласных нарушено
  if (t.length > 8 && !t.includes(' ')) {
    const ratio = vowels / t.length;
    if (ratio < 0.2 || ratio > 0.8) return true;
  }
  return false;
}

// Проверка соответствия категории
function isRelevantToCategory(title, description, category) {
  if (category === 'Другое') return true; // Для "Другое" пропускаем всё
  const keywords = CATEGORY_KEYWORDS[category] || [];
  const text = (title + ' ' + description).toLowerCase();
  return keywords.some(k => text.includes(k));
}

function validateTextAI(text, checkCategory = null) {
  const t = String(text || '').trim();
  if (t.length < 2) return { ok: false, msg: 'Слишком коротко.' };
  
  const normalized = t.normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
  if (BAD_WORDS_RE.test(normalized)) return { ok: false, msg: 'Нецензурная лексика.' };
  
  if (isNonsense(t)) return { ok: false, msg: 'Бессмысленный набор символов или спам.' };
  
  return { ok: true };
}

function showModerationResult(kind, text) {
  const el = document.getElementById('moderation-result');
  if (el) { el.className = 'moderation-result ' + kind; el.textContent = text; }
}

// ---------- РЕНДЕР ----------
function render() {
  if (!grid) return;
  const sorted = projects.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  
  grid.innerHTML = sorted.map(function(p, i) {
    const liked = (p.likedBy || []).includes(userKey());
    const img = safeImage(p.screenshot);
    let html = `<article class="grave-card" data-id="${esc(p.id)}" style="animation-delay:${Math.min(i, 8) * 55}ms">`;
    html += `<div class="grave-top"><span class="grave-index">№ ${String(sorted.length - i).padStart(3, '0')}</span><span class="grave-state">ПОКОИТСЯ С МИРОМ</span></div>`;
    html += `<div class="tombstone">${img ? `<img class="tombstone-img" src="${esc(img)}" alt="" loading="lazy">` : ''}<span class="tombstone-glyph">†</span></div>`;
    html += `<div class="grave-meta">${esc(p.category || 'Без категории')}</div>`;
    html += `<h3 class="grave-title">${esc(p.title)}</h3>`;
    html += `<div class="epitaph-label">ПРИЧИНА СМЕРТИ</div>`;
    html += `<p class="grave-description">${esc(p.description)}</p>`;
    html += `<div class="grave-bottom"><div class="grave-actions">`;
    html += `<button class="rose-button ${liked ? 'is-loved' : ''}" data-action="rose" aria-pressed="${liked}"><span class="rose">🌹</span>${Number(p.roses) || 0}</button>`;
    html += `<button class="view-secret-btn" data-action="view-secret">Посмотреть исходники</button>`;
    html += `<button class="message-author-btn" data-action="message-author">Написать автору</button>`;
    html += `<button class="comments-toggle-btn" data-action="toggle-comments">Комментарии (${(comments[p.id] || []).length})</button>`;
    html += `</div></div>`;

    let secretHtml = '';
    if (p.secretFile && p.secretFile.id) {
      secretHtml = `<div class="secret-download"><span>📁 ${esc(p.secretFile.name)} · ${formatBytes(p.secretFile.size)}</span><button type="button" data-download-file="${esc(p.secretFile.id)}" data-file-name="${esc(p.secretFile.name)}">СКАЧАТЬ ФАЙЛ ↓</button></div>`;
    }
    if (p.secret) secretHtml += `<div class="secret-content">${esc(p.secret)}</div>`;
    if (!p.secret && !p.secretFile) secretHtml = `<div class="secret-content">Исходники не приложены.</div>`;
    
    html += `<div class="secret-box" data-secret-box style="display:none;">${secretHtml}</div>`;
    html += `<div class="comments-box" data-comments-box><div class="comments-list"></div><form class="comment-form" data-comment-form><input name="comment" placeholder="Оставить мысль..." maxlength="500"><button type="submit">Отправить</button></form><div class="comment-warning"></div></div>`;
    html += `</article>`;
    return html;
  }).join('');

  const countEl = document.getElementById('grave-count');
  if (countEl) countEl.textContent = String(sorted.length).padStart(3, '0');
  
  const roseEl = document.getElementById('rose-total');
  if (roseEl) roseEl.textContent = String(sorted.reduce((n, p) => n + (Number(p.roses) || 0), 0)).padStart(3, '0') + ' 🌹';
  
  const emptyEl = document.getElementById('empty-state');
  if (emptyEl) emptyEl.hidden = sorted.length !== 0;
  updateAccountButton();
}

function showToast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function openModal(content) {
  if (!modalContent || !backdrop) return;
  modalContent.innerHTML = content;
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => modal?.querySelector('input,textarea,select')?.focus(), 60);
}

function closeModal() {
  if (!backdrop) return;
  backdrop.hidden = true;
  document.body.style.overflow = '';
}

// ---------- АККАУНТЫ ----------
function authForm(mode, error) {
  const registering = mode === 'register';
  openModal(`
    <div class="modal-kicker">ЛИЧНОСТЬ / ДОСТУП В АРХИВ</div>
    <h3 id="modal-title">${registering ? 'Создать аккаунт.' : 'С возвращением.'}</h3>
    <div class="auth-switch">
      <button type="button" data-auth-mode="login" class="${!registering ? 'active' : ''}">ВОЙТИ</button>
      <button type="button" data-auth-mode="register" class="${registering ? 'active' : ''}">РЕГИСТРАЦИЯ</button>
    </div>
    <form id="auth-form" data-mode="${mode}">
      ${registering ? '<label class="field"><span class="form-label">ИМЯ В АРХИВЕ <em>*</em></span><input name="username" required maxlength="24" autocomplete="username" placeholder="gravekeeper"></label>' : ''}
      <label class="field" style="margin-top:14px"><span class="form-label">EMAIL <em>*</em></span><input type="email" name="email" required autocomplete="email" placeholder="you@example.com"></label>
      <label class="field" style="margin-top:14px"><span class="form-label">ПАРОЛЬ <em>*</em></span><input type="password" name="password" required minlength="8" autocomplete="${registering ? 'new-password' : 'current-password'}" placeholder="Минимум 8 символов"></label>
      <p class="auth-error">${esc(error || '')}</p>
      <p class="modal-fine">АККАУНТ ДЕМО-ВЕРСИИ хранится в этом браузере.</p>
      <button class="modal-submit" type="submit">${registering ? 'СОЗДАТЬ АККАУНТ ↗' : 'ВОЙТИ В АРХИВ ↗'}</button>
    </form>
  `);
}

function accountPanel() {
  if (!currentUser) return;
  const count = projects.filter(p => p.ownerId === currentUser.id).length;
  openModal(`
    <div class="modal-kicker">ВАШ МЕМОРИАЛЬНЫЙ ПРОФИЛЬ</div>
    <h3 id="modal-title">${esc(currentUser.username)}</h3>
    <div class="profile-email">${esc(currentUser.email)}<span class="account-badge">В АРХИВЕ</span></div>
    <div class="profile-actions">
      <button type="button" class="profile-action" id="my-projects">МОИ ПРОЕКТЫ · ${count}</button>
      <button type="button" class="profile-action" id="profile-support">ТЕХ.ПОДДЕРЖКА</button>
    </div>
    <button type="button" class="danger-button" id="logout-button" style="margin-top:17px">ВЫЙТИ ИЗ АККАУНТА</button>
  `);
}

function myProjectsPanel(confirmId) {
  if (!currentUser) return;
  const mine = projects.filter(p => p.ownerId === currentUser.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  let rows = '';
  if (!mine.length) {
    rows = '<div class="my-projects-empty">Вы пока ничего не публиковали.<br>Здесь появятся ваши надгробия.</div>';
  } else {
    rows = mine.map(p => {
      let controls = '';
      if (confirmId === p.id) {
        controls = `<div class="my-project-controls"><button class="confirm-delete" data-confirm-delete="${esc(p.id)}">УДАЛИТЬ</button><button data-cancel-delete>ОТМЕНА</button></div>`;
      } else {
        controls = `<button data-delete-project="${esc(p.id)}">УДАЛИТЬ</button>`;
      }
      return `<div class="my-project-row"><div><div class="my-project-title">${esc(p.title)}</div><div class="my-project-meta">${esc(p.category || 'Другое')} · В АРХИВЕ</div></div><div class="my-project-controls">${controls}</div></div>`;
    }).join('');
  }
  openModal(`
    <div class="modal-kicker">ЛИЧНЫЙ АРХИВ / ${String(mine.length).padStart(2, '0')}</div>
    <h3 id="modal-title">Мои проекты</h3>
    <div class="my-projects-list">${rows}</div>
    <button class="profile-action" id="back-profile">← ПРОФИЛЬ</button>
  `);
}

function supportModal() {
  openModal(`
    <div class="modal-kicker">СВЯЗЬ С АВТОРОМ ПРОЕКТА</div>
    <h3 id="modal-title">Техническая<br>поддержка.</h3>
    <p class="modal-lead">Опишите проблему. ИИ проверит сообщение на адекватность и отсутствие матов.</p>
    <form id="support-form" class="support-form">
      <label class="field"><span class="form-label">ВАШЕ ОБРАЩЕНИЕ · 12–1500 СИМВОЛОВ</span><textarea name="message" required minlength="12" maxlength="1500" placeholder="Опишите, что случилось…"></textarea></label>
      <div class="support-result" id="support-result" aria-live="polite"></div>
      <button class="modal-submit" type="submit">ОТПРАВИТЬ ОБРАЩЕНИЕ ↗</button>
    </form>
  `);
}

function hashPassword(password, salt) {
  const data = new TextEncoder().encode(salt + ':' + password);
  return crypto.subtle.digest('SHA-256', data).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
}

function makeSalt() {
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function continuePending() {
  const action = pendingAction; pendingAction = null;
  if (!action) return;
  if (action.type === 'create') createForm();
  if (action.type === 'rose') { const p = projects.find(x => x.id === action.id); if (p) toggleRose(p, null); }
  if (action.type === 'messenger') openMessenger(action.targetUserId);
}

function toggleRose(p, button) {
  if (!currentUser) { pendingAction = { type: 'rose', id: p.id }; authForm('login'); return; }
  p.likedBy = p.likedBy || [];
  const key = userKey(), idx = p.likedBy.indexOf(key);
  if (idx >= 0) { p.likedBy.splice(idx, 1); p.roses = Math.max(0, (Number(p.roses) || 0) - 1); }
  else { p.likedBy.push(key); p.roses = (Number(p.roses) || 0) + 1; if (button) addPetals(button); }
  persist(); render();
}

function createForm() {
  if (!currentUser) { pendingAction = { type: 'create' }; authForm('register'); return; }
  selectedProjectFile = null;
  openModal(`
    <div class="modal-kicker">РИТУАЛ ЗАХОРОНЕНИЯ / 01</div>
    <h3 id="modal-title">Пусть проект<br>найдёт покой.</h3>
    <form id="create-form">
      <div class="form-grid">
        <label class="field full"><span class="form-label">НАЗВАНИЕ <em>*</em></span><input name="title" required maxlength="72" placeholder="Амбициозное имя, скромная судьба"></label>
        <label class="field full"><span class="form-label">ПОЧЕМУ ПРОЕКТ УМЕР <span style="color:#707170">· НЕОБЯЗАТЕЛЬНО</span></span><textarea name="description" maxlength="280" placeholder="Инвестор ушёл за кофе и не вернулся…"></textarea></label>
        <label class="field"><span class="form-label">КАТЕГОРИЯ <em>*</em></span><select name="category" required><option value="" disabled selected>Выберите...</option><option>Социальное</option><option>Web3</option><option>Маркетплейс</option><option>Искусственный интеллект</option><option>Игры</option><option>Приложение</option><option>Другое</option></select></label>
        <label class="field full"><span class="form-label">ССЫЛКА НА СКРИНШОТ</span><input name="screenshot" type="url" placeholder="https://..."></label>
        <div class="field full">
          <span class="form-label">СЕКРЕТНЫЙ ФАЙЛ / ИСХОДНИКИ <em>*</em></span>
          <div class="file-picker-row">
            <button type="button" class="file-pick-button" data-pick-secret>＋ ВЫБРАТЬ ФАЙЛ</button>
            <span class="file-name" id="secret-file-name">Файл не выбран</span>
            <input id="secret-file-input" type="file" hidden>
          </div>
          <textarea name="secret" class="secret-input" maxlength="12000" placeholder="Или вставьте сюда текст, исходный код или ссылку на архив"></textarea>
        </div>
      </div>
      <p class="moderation-notice"><span>◈ ИИ-МОДЕРАЦИЯ</span> ИИ проверит текст, имя файла, отсутствие матов и соответствие выбранной категории.</p>
      <div class="moderation-result" id="moderation-result" aria-live="polite"></div>
      <button class="modal-submit" type="submit">ЗАЖЕЧЬ ПОСЛЕДНЮЮ СВЕЧУ ↗</button>
    </form>
  `);
}

function addPetals(button) {
  const r = button.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  for (let i = 0; i < 9; i++) {
    const el = document.createElement('span');
    el.className = 'petal'; el.textContent = i % 3 === 0 ? '🌹' : '✿';
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.setProperty('--dx', (Math.random() * 90 - 45) + 'px');
    el.style.setProperty('--dy', (Math.random() * -75 - 10) + 'px');
    el.style.setProperty('--rot', (Math.random() * 240 - 120) + 'deg');
    el.style.fontSize = (9 + Math.random() * 8) + 'px';
    document.body.append(el); setTimeout(() => el.remove(), 900);
  }
}

// ---------- КОММЕНТАРИИ ----------
function addComment(projectId, text) {
  if (!comments[projectId]) comments[projectId] = [];
  const userId = currentUser ? currentUser.id : 'visitor:' + visitorId;
  comments[projectId].push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), userId, text: text.trim(), createdAt: Date.now() });
  persistComments();
}

function renderComments(projectId, card) {
  const list = card.querySelector('.comments-list');
  if (!list) return;
  const arr = comments[projectId] || [];
  if (!arr.length) { list.innerHTML = '<div class="comment-empty">Пока нет мыслей.</div>'; return; }
  list.innerHTML = arr.map(c => {
    const user = accounts.find(a => a.id === c.userId);
    const name = user ? user.username : (String(c.userId).startsWith('visitor:') ? 'Гость' : 'Пользователь');
    return `<div class="comment-item"><div class="comment-meta">${esc(name)} · ${new Date(c.createdAt).toLocaleString()}</div><div class="comment-text">${esc(c.text)}</div></div>`;
  }).join('');
}

function updateCommentsCount(card, projectId) {
  const btn = card.querySelector('[data-action="toggle-comments"]');
  if (btn) btn.textContent = `Комментарии (${(comments[projectId] || []).length})`;
}

// ---------- МЕССЕНДЖЕР ----------
function openMessenger(initialUserId) {
  if (!currentUser) { pendingAction = { type: 'messenger', targetUserId: initialUserId }; authForm('login'); return; }
  const modalEl = document.getElementById('messenger-modal');
  if (!modalEl) return;
  modalEl.style.display = 'flex'; activeChatUserId = initialUserId || null; renderMessenger();
}

function closeMessenger() {
  const modalEl = document.getElementById('messenger-modal');
  if (modalEl) modalEl.style.display = 'none';
}

function renderMessenger() {
  const listEl = document.getElementById('conversation-list'), chatHeader = document.getElementById('chat-header'), chatMessages = document.getElementById('chat-messages'), inputArea = document.getElementById('chat-input-area');
  if (!currentUser || !listEl || !chatHeader || !chatMessages || !inputArea) return;

  const userIds = new Set();
  messages.forEach(m => { if (m.from === currentUser.id) userIds.add(m.to); if (m.to === currentUser.id) userIds.add(m.from); });
  let userIdsArr = Array.from(userIds).filter(id => id !== currentUser.id);
  if (activeChatUserId && !userIdsArr.includes(activeChatUserId)) userIdsArr.unshift(activeChatUserId);
  
  userIdsArr.sort((a, b) => {
    const lastA = Math.max(...messages.filter(m => (m.from === a && m.to === currentUser.id) || (m.from === currentUser.id && m.to === a)).map(m => m.createdAt), 0);
    const lastB = Math.max(...messages.filter(m => (m.from === b && m.to === currentUser.id) || (m.from === currentUser.id && m.to === b)).map(m => m.createdAt), 0);
    return lastB - lastA;
  });

  if (!userIdsArr.length) {
    listEl.innerHTML = '<div class="empty-conversations">Нет активных диалогов</div>';
  } else {
    listEl.innerHTML = userIdsArr.map(uid => {
      const user = accounts.find(a => a.id === uid), name = user ? user.username : 'Пользователь';
      const lastMsg = messages.filter(m => (m.from === uid && m.to === currentUser.id) || (m.from === currentUser.id && m.to === uid)).sort((a, b) => b.createdAt - a.createdAt)[0];
      const preview = lastMsg ? lastMsg.text.slice(0, 30) : '';
      return `<div class="conversation-item ${activeChatUserId === uid ? 'active' : ''}" data-user-id="${esc(uid)}"><div class="conversation-name">${esc(name)}</div><div class="conversation-preview">${esc(preview)}</div></div>`;
    }).join('');
  }

  if (!activeChatUserId) activeChatUserId = userIdsArr[0] || null;

  if (!activeChatUserId) {
    chatHeader.textContent = 'Выберите собеседника'; chatMessages.innerHTML = ''; inputArea.style.display = 'none';
  } else {
    const peer = accounts.find(a => a.id === activeChatUserId), peerName = peer ? peer.username : 'Пользователь';
    chatHeader.textContent = 'Диалог с ' + peerName;
    const chatMsgs = messages.filter(m => (m.from === currentUser.id && m.to === activeChatUserId) || (m.from === activeChatUserId && m.to === currentUser.id)).sort((a, b) => a.createdAt - b.createdAt);
    chatMessages.innerHTML = chatMsgs.map(m => {
      const own = m.from === currentUser.id;
      return `<div class="message-bubble ${own ? 'own' : 'other'}">${esc(m.text)}<div class="message-time">${new Date(m.createdAt).toLocaleTimeString()}</div></div>`;
    }).join('');
    chatMessages.scrollTop = chatMessages.scrollHeight; inputArea.style.display = 'flex';
  }

  listEl.querySelectorAll('.conversation-item').forEach(el => { el.onclick = () => { activeChatUserId = el.dataset.userId; renderMessenger(); }; });

  const sendBtn = document.getElementById('chat-send'), chatInput = document.getElementById('chat-input');
  if (sendBtn && chatInput) {
    const send = () => {
      const text = chatInput.value.trim(); if (!text || !activeChatUserId) return;
      const validation = validateTextAI(text);
      if (!validation.ok) { showToast('ИИ-модератор: ' + validation.msg + ' Пишите уважительно и по делу.'); return; }
      messages.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), from: currentUser.id, to: activeChatUserId, text: text, createdAt: Date.now() });
      persistMessages(); chatInput.value = ''; renderMessenger();
    };
    sendBtn.onclick = send; chatInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } };
  }
}

function startConversation(authorId) {
  if (!currentUser) { pendingAction = { type: 'messenger', targetUserId: authorId }; authForm('login'); return; }
  if (authorId === currentUser.id) { showToast('Нельзя написать самому себе.'); return; }
  const peer = accounts.find(a => a.id === authorId); if (!peer) { showToast('Автор не найден.'); return; }
  openMessenger(authorId);
}

// ---------- ОБРАБОТЧИКИ ----------
if (grid) {
  grid.addEventListener('click', async function(e) {
    const download = e.target.closest('[data-download-file]');
    if (download) { try { await downloadProjectFile(download.dataset.downloadFile, download.dataset.fileName); } catch (error) { showToast('Не удалось скачать файл.'); } return; }
    const actionBtn = e.target.closest('button[data-action]');
    if (!actionBtn) return;
    const card = actionBtn.closest('.grave-card'), p = projects.find(x => x.id === card?.dataset.id);
    if (!p) return;
    const action = actionBtn.dataset.action;
    if (action === 'rose') toggleRose(p, actionBtn);
    else if (action === 'view-secret') { const box = card.querySelector('[data-secret-box]'); if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none'; }
    else if (action === 'message-author') startConversation(p.ownerId);
    else if (action === 'toggle-comments') { const box = card.querySelector('[data-comments-box]'); if (box) { box.classList.toggle('open'); if (box.classList.contains('open')) renderComments(p.id, card); } }
  });

  grid.addEventListener('submit', function(e) {
    if (!e.target.matches('.comment-form')) return;
    e.preventDefault();
    const form = e.target, card = form.closest('.grave-card'), pId = card.dataset.id;
    const input = form.querySelector('input[name="comment"]'), text = input.value.trim(), warning = card.querySelector('.comment-warning');
    
    const validation = validateTextAI(text);
    if (!validation.ok) {
      if (warning) { warning.textContent = 'ИИ-смотритель не пропустил: ' + validation.msg + ' Пожалуйста, пишите по делу.'; warning.style.display = 'block'; }
      return;
    }
    if (warning) warning.style.display = 'none';
    addComment(pId, text); input.value = ''; renderComments(pId, card); updateCommentsCount(card, pId);
  });
}

if (modalContent) {
  modalContent.addEventListener('change', function(e) {
    if (e.target.id === 'secret-file-input') {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024 * 1024) { selectedProjectFile = null; e.target.value = ''; document.getElementById('secret-file-name').textContent = 'Лимит — 10 GB'; showToast('Максимальный размер файла — 10 GB.'); return; }
      selectedProjectFile = file;
      document.getElementById('secret-file-name').textContent = file.name + ' · ' + (file.size < 1024 ? file.size + ' Б' : (file.size / 1024).toFixed(0) + ' КБ');
    }
  });

  modalContent.addEventListener('click', function(e) {
    if (e.target.closest('[data-pick-secret]')) { document.getElementById('secret-file-input')?.click(); return; }
    if (e.target.closest('#profile-support')) { supportModal(); return; }
    if (e.target.closest('#my-projects')) { myProjectsPanel(); return; }
    if (e.target.closest('#back-profile')) { accountPanel(); return; }
    const deleteButton = e.target.closest('[data-delete-project]');
    if (deleteButton) { myProjectsPanel(deleteButton.dataset.deleteProject); return; }
    if (e.target.closest('[data-cancel-delete]')) { myProjectsPanel(); return; }
    const confirmDelete = e.target.closest('[data-confirm-delete]');
    if (confirmDelete) {
      const project = projects.find(p => p.id === confirmDelete.dataset.confirmDelete);
      if (project && project.ownerId === currentUser.id) {
        projects = projects.filter(p => p.id !== project.id); delete comments[project.id]; persistComments(); persist();
        if (project.secretFile && project.secretFile.id) deleteStoredProjectFile(project.secretFile.id).catch(console.warn);
        render(); showToast('Проект удалён из вашего архива.'); myProjectsPanel();
      }
      return;
    }
    const switcher = e.target.closest('[data-auth-mode]');
    if (switcher) { authForm(switcher.dataset.authMode); return; }
    if (e.target.closest('#logout-button')) { localStorage.removeItem(SESSION_KEY); currentUser = null; render(); closeModal(); showToast('Вы вышли из аккаунта.'); }
  });

  modalContent.addEventListener('submit', async function(e) {
    e.preventDefault();
    const form = e.target;

    // --- ФОРМА ПОДДЕРЖКИ ---
    if (form.id === 'support-form') {
      const message = String(new FormData(form).get('message') || '').trim();
      const button = form.querySelector('button[type=submit]'), result = document.getElementById('support-result');
      
      const validation = validateTextAI(message);
      if (!validation.ok) { if (result) { result.className = 'support-result error'; result.textContent = 'ИИ-модератор: ' + validation.msg; } return; }
      
      if (button) { button.disabled = true; button.innerHTML = '<span class="spinner"></span> ИИ ПРОВЕРЯЕТ...'; }
      setTimeout(() => {
        const supportMessages = JSON.parse(localStorage.getItem(SUPPORT_KEY) || '[]');
        supportMessages.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), message, userId: currentUser?.id || null, createdAt: Date.now() });
        localStorage.setItem(SUPPORT_KEY, JSON.stringify(supportMessages));
        if (result) { result.className = 'support-result success'; result.textContent = 'ИИ одобрил. Обращение сохранено.'; }
        form.reset();
        if (button) { button.disabled = false; button.textContent = 'ОТПРАВИТЬ ОБРАЩЕНИЕ ↗'; }
      }, 800);
      return;
    }

    // --- АВТОРИЗАЦИЯ ---
    if (form.id === 'auth-form') {
      const data = new FormData(form), mode = form.dataset.mode;
      const email = String(data.get('email')).trim().toLowerCase(), password = String(data.get('password'));
      if (mode === 'register') {
        const username = String(data.get('username')).trim();
        if (password.length < 8) { authForm(mode, 'Пароль должен быть не менее 8 символов.'); return; }
        if (accounts.some(a => a.email.toLowerCase() === email)) { authForm(mode, 'Этот email уже зарегистрирован.'); return; }
        const salt = makeSalt();
        const account = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), username, email, salt, passwordHash: await hashPassword(password, salt), createdAt: Date.now() };
        accounts.push(account); saveAccounts(); currentUser = account; localStorage.setItem(SESSION_KEY, account.id);
        render(); closeModal(); showToast('Аккаунт создан.'); continuePending(); return;
      }
      const account = accounts.find(a => a.email.toLowerCase() === email);
      if (!account || await hashPassword(password, account.salt) !== account.passwordHash) { authForm(mode, 'Неверный email или пароль.'); return; }
      currentUser = account; localStorage.setItem(SESSION_KEY, account.id);
      render(); closeModal(); showToast('Вы вошли.'); continuePending(); return;
    }

    // --- СОЗДАНИЕ ПРОЕКТА С ИИ-ПРОВЕРКОЙ ---
    if (form.id === 'create-form') {
      const data = new FormData(form);
      const secret = String(data.get('secret') || '').trim();
      const title = String(data.get('title')).trim();
      const description = String(data.get('description')).trim();
      const category = String(data.get('category'));
      const fileName = selectedProjectFile ? selectedProjectFile.name : '';

      if (!secret && !selectedProjectFile) { showToast('Добавьте файл или текст.'); return; }

      const publishButton = form.querySelector('button[type=submit]');
      if (publishButton) { publishButton.disabled = true; publishButton.innerHTML = '<span class="spinner"></span> ИИ АНАЛИЗИРУЕТ...'; }
      showModerationResult('checking', 'ИИ проверяет текст, файлы, маты и соответствие категории...');

      // Имитация задержки работы ИИ
      await new Promise(resolve => setTimeout(resolve, 1200));

      // 1. Проверка на маты и бессмыслицу
      const titleCheck = validateTextAI(title);
      if (!titleCheck.ok) {
        showModerationResult('blocked', 'ИИ отклонил название: ' + titleCheck.msg);
        if (publishButton) { publishButton.disabled = false; publishButton.textContent = 'ЗАЖЕЧЬ ПОСЛЕДНЮЮ СВЕЧУ ↗'; }
        return;
      }
      const descCheck = validateTextAI(description);
      if (description.length > 0 && !descCheck.ok) {
        showModerationResult('blocked', 'ИИ отклонил описание: ' + descCheck.msg);
        if (publishButton) { publishButton.disabled = false; publishButton.textContent = 'ЗАЖЕЧЬ ПОСЛЕДНЮЮ СВЕЧУ ↗'; }
        return;
      }
      const fileCheck = validateTextAI(fileName);
      if (fileName.length > 0 && !fileCheck.ok) {
        showModerationResult('blocked', 'ИИ отклонил имя файла: ' + fileCheck.msg);
        if (publishButton) { publishButton.disabled = false; publishButton.textContent = 'ЗАЖЕЧЬ ПОСЛЕДНЮЮ СВЕЧУ ↗'; }
        return;
      }

      // 2. Проверка на соответствие категории
      if (!isRelevantToCategory(title, description, category)) {
        showModerationResult('blocked', `ИИ-модератор: Ваш проект не соответствует категории «${category}». Пожалуйста, добавьте в название или описание ключевые слова по теме.`);
        if (publishButton) { publishButton.disabled = false; publishButton.textContent = 'ЗАЖЕЧЬ ПОСЛЕДНЮЮ СВЕЧУ ↗'; }
        return;
      }

      // Всё ок
      showModerationResult('approved', 'ИИ одобрил. Публикуем…');
      const image = safeImage(String(data.get('screenshot') || ''));
      const projectId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      
      let secretFile = null;
      if (selectedProjectFile) {
        try {
          await saveProjectFile(projectId, selectedProjectFile);
          secretFile = { id: projectId, name: selectedProjectFile.name, type: selectedProjectFile.type || 'application/octet-stream', size: selectedProjectFile.size };
        } catch (error) {
          showToast('Браузер не смог сохранить файл.');
          if (publishButton) { publishButton.disabled = false; publishButton.textContent = 'ЗАЖЕЧЬ ПОСЛЕДНЮЮ СВЕЧУ ↗'; }
          return;
        }
      }

      projects.unshift({
        id: projectId, title, description, category, roses: 0, screenshot: image, secret, secretFile,
        ownerId: currentUser.id, createdAt: Date.now(), likedBy: []
      });
      
      persist(); render(); closeModal(); showToast('Проект упокоен. Свеча горит.');
      return;
    }
  });
}

document.getElementById('open-create')?.addEventListener('click', createForm);
document.getElementById('empty-create')?.addEventListener('click', createForm);
document.getElementById('open-support')?.addEventListener('click', supportModal);
document.getElementById('account-button')?.addEventListener('click', function() { if (currentUser) accountPanel(); else { pendingAction = null; authForm('login'); } });
document.getElementById('open-dialogs')?.addEventListener('click', () => openMessenger());
document.getElementById('messenger-close')?.addEventListener('click', closeMessenger);
document.getElementById('modal-close')?.addEventListener('click', closeModal);

backdrop?.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && backdrop && !backdrop.hidden) closeModal(); });

render();