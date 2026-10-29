const db = window.supabase;

const grid = document.getElementById('grave-grid');
const backdrop = document.getElementById('modal-backdrop');
const modalContent = document.getElementById('modal-content');

let currentUser = null;
let projects = [];
let messages = [];
let activeChatUserId = null;
let activeChatUserName = null;

// ================= МОДЕРАЦИЯ =================
const BAD_WORDS_RE = /(^|[^\p{L}\p{N}])(?:пенис\p{L}*|вагин\p{L}*|вульв\p{L}*|порн\p{L}*|эротик\p{L}*|сперм\p{L}*|минет\p{L}*|куни\p{L}*|дроч\p{L}*|секс\p{L}*|хуй\p{L}*|пизд\p{L}*|еб(?:ать|у|л|ан|н|ись|ени|аш|ну|ал|ла)\p{L}*|бляд\p{L}*|манда\p{L}*|гандон\p{L}*|пидор\p{L}*|педик\p{L}*|сука\p{L}*|сучк\p{L}*|хер\p{L}*|fuck\p{L}*|shit\p{L}*|porn\p{L}*|penis\p{L}*|vagina\p{L}*|dick\p{L}*|cock\p{L}*|sex\p{L}*|nude\p{L}*|xxx)(?=$|[^\p{L}\p{N}])/iu;

function isNonsense(text) {
  const t = text.trim().toLowerCase();
  if (t.length < 3) return true;
  if (/(.)\1{3,}/.test(t)) return true;
  if (/(.{2,})\1{2,}/.test(t)) return true;
  const keyboardMashes = ['йцукен', 'фывапр', 'ячсмит', 'qwerty', 'asdfgh', 'zxcvbn', '123456', 'ываол', 'цйукк'];
  if (keyboardMashes.some(mash => t.includes(mash))) return true;
  if (/[бвгджзйклмнпрстфхцчшщbcdfghjklmnpqrstvwxyz]{5,}/i.test(t)) return true;
  const words = t.split(/\s+/);
  for (let w of words) {
      if (w.length > 3 && !/[аеёиоуыэюяaeiouy]/.test(w)) return true;
  }
  const vowels = (t.match(/[аеёиоуыэюяaeiouy]/g) || []).length;
  const consonants = (t.match(/[бвгджзйклмнпрстфхцчшщbcdfghjklmnpqrstvwxyz]/g) || []).length;
  if (vowels === 0 && consonants > 2) return true;
  if (consonants === 0 && vowels > 2) return true;
  return false;
}

function validateTextAI(text) {
  const t = String(text || '').trim();
  if (t.length < 2) return { ok: false, msg: 'Слишком коротко.' };
  const normalized = t.normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
  if (BAD_WORDS_RE.test(normalized)) return { ok: false, msg: 'Нецензурная лексика.' };
  if (isNonsense(t)) return { ok: false, msg: 'Бессмысленный набор символов или спам.' };
  return { ok: true };
}

// ================= АВТОРИЗАЦИЯ =================
db.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    showPasswordResetForm();
    return;
  }
  if (session) {
    currentUser = {
      id: session.user.id,
      email: session.user.email,
      username: session.user.user_metadata?.username || session.user.email.split('@')[0]
    };
  } else {
    currentUser = null;
  }
  updateAccountButton();
  loadProjects();
  if (currentUser) {
    loadMessages();
    setupRealtimeMessages();
  }
});

function updateAccountButton() {
  const b = document.getElementById('account-button');
  if (!b) return;
  b.innerHTML = currentUser ? `<span>◉</span> ${currentUser.username}` : '<span>◉</span> Войти';
}

// ================= ЗАГРУЗКА ДАННЫХ =================
async function loadProjects() {
  const { data, error } = await db.from('projects').select('*').order('created_at', { ascending: false });
  if (!error) { projects = data; render(); }
}

async function loadMessages() {
  if (!currentUser) return;
  const { data, error } = await db.from('messages').select('*').or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`).order('created_at', { ascending: true });
  if (!error) { messages = data; renderMessenger(); }
}

let realtimeSub = null;
function setupRealtimeMessages() {
  if (realtimeSub) return;
  realtimeSub = db.channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      if (currentUser && (payload.new.sender_id === currentUser.id || payload.new.receiver_id === currentUser.id)) {
        if (!messages.find(m => m.id === payload.new.id)) {
          messages.push(payload.new);
          renderMessenger();
        }
      }
    }).subscribe();
}

// ================= РЕНДЕР =================
function render() {
  if (!grid) return;
  const emptyEl = document.getElementById('empty-state');
  if (emptyEl) emptyEl.hidden = projects.length !== 0;
  
  const countEl = document.getElementById('grave-count');
  if (countEl) countEl.textContent = String(projects.length).padStart(3, '0');
  
  const roseEl = document.getElementById('rose-total');
  if (roseEl) {
    const totalRoses = projects.reduce((sum, p) => sum + (p.liked_by?.length || 0), 0);
    roseEl.textContent = String(totalRoses).padStart(3, '0') + ' 🌹';
  }

  grid.innerHTML = projects.map((p, i) => {
    const liked = p.liked_by?.includes(currentUser?.id);
    let html = `<article class="grave-card" data-id="${p.id}">`;
    html += `<div class="grave-top"><span class="grave-index">№ ${String(projects.length - i).padStart(3, '0')}</span><span class="grave-state">ПОКОИТСЯ С МИРОМ</span></div>`;
    html += `<div class="tombstone">${p.screenshot ? `<img class="tombstone-img" src="${p.screenshot}" alt="">` : ''}<span class="tombstone-glyph">†</span></div>`;
    html += `<div class="grave-meta">${p.category || 'Без категории'}</div>`;
    html += `<h3 class="grave-title">${p.title}</h3>`;
    html += `<div class="epitaph-label">ПРИЧИНА СМЕРТИ</div>`;
    html += `<p class="grave-description">${p.description || 'Не указана'}</p>`;
    html += `<div class="grave-bottom"><div class="grave-actions">`;
    html += `<button class="rose-button ${liked ? 'is-loved' : ''}" data-action="rose"><span class="rose">🌹</span>${p.liked_by?.length || 0}</button>`;
    html += `<button class="view-secret-btn" data-action="view-secret">Исходники</button>`;
    if (currentUser && p.owner_id !== currentUser.id) {
      html += `<button class="message-author-btn" data-action="message-author" data-owner="${p.owner_id}" data-ownername="${p.owner_name || 'Автор'}">Написать</button>`;
    }
    html += `<button class="comments-toggle-btn" data-action="toggle-comments">Комментарии (${(p.comments || []).length})</button>`;
    html += `</div></div>`;
    
    let secretHtml = p.secret ? `<div class="secret-content">${p.secret}</div>` : `<div class="secret-content">Файл не приложен.</div>`;
    html += `<div class="secret-box" data-secret-box style="display:none;">${secretHtml}</div>`;
    
    let commentsHtml = (p.comments || []).map(c => `<div class="comment-item"><div class="comment-meta">${c.userName} · ${new Date(c.createdAt).toLocaleString()}</div><div class="comment-text">${c.text}</div></div>`).join('');
    if (!commentsHtml) commentsHtml = '<div class="comment-empty">Пока нет мыслей.</div>';
    
    html += `<div class="comments-box" data-comments-box><div class="comments-list">${commentsHtml}</div>`;
    html += `<form class="comment-form" data-comment-form><input name="comment" placeholder="Оставить мысль..." maxlength="500"><button type="submit">Отправить</button></form><div class="comment-warning" style="display:none;"></div></div>`;
    html += `</article>`;
    return html;
  }).join('');
}

// ================= МОДАЛКИ =================
function openModal(content) {
  if (!modalContent || !backdrop) return;
  modalContent.innerHTML = content;
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  if (!backdrop) return;
  backdrop.hidden = true;
  document.body.style.overflow = '';
}

function showToast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4000); // Сделал подольше, чтобы читалось
}

function showPasswordResetForm() {
  openModal(`
    <div class="modal-kicker">ВОССТАНОВЛЕНИЕ ДОСТУПА</div>
    <h3 id="modal-title">Придумайте новый пароль</h3>
    <form id="reset-password-form">
      <label class="field full" style="margin-top:14px"><span class="form-label">НОВЫЙ ПАРОЛЬ <em>*</em></span><input type="password" name="newPassword" required minlength="6" placeholder="Минимум 6 символов"></label>
      <p class="auth-error" style="color:var(--pink);font-size:10px;margin-top:10px;"></p>
      <button class="modal-submit" type="submit">СОХРАНИТЬ ПАРОЛЬ ↗</button>
    </form>
  `);
}

function openAuthModal(mode = 'login') {
  const isLogin = mode === 'login';
  openModal(`
    <div class="modal-kicker">ЛИЧНОСТЬ / ДОСТУП В АРХИВ</div>
    <h3 id="modal-title">${isLogin ? 'Вход в архив' : 'Регистрация'}</h3>
    <form id="auth-form" data-mode="${mode}">
      ${!isLogin ? '<label class="field full"><span class="form-label">ИМЯ (Ник)</span><input type="text" name="username" placeholder="gravekeeper"></label>' : ''}
      <label class="field full" style="margin-top:14px"><span class="form-label">EMAIL <em>*</em></span><input type="email" name="email" required placeholder="you@example.com"></label>
      <label class="field full" style="margin-top:14px"><span class="form-label">ПАРОЛЬ <em>*</em></span><input type="password" name="password" required minlength="6" placeholder="Минимум 6 символов"></label>
      <p class="auth-error" style="color:var(--pink);font-size:10px;margin-top:10px;"></p>
      <button class="modal-submit" type="submit" id="auth-btn">${isLogin ? 'ВОЙТИ ↗' : 'СОЗДАТЬ АККАУНТ ↗'}</button>
      <div style="display:flex; justify-content:space-between; margin-top:15px;">
        <button type="button" style="background:none;border:none;color:var(--muted);font-size:10px;cursor:pointer;" id="switch-auth">${isLogin ? 'СОЗДАТЬ АККАУНТ' : 'У МЕНЯ ЕСТЬ АККАУНТ'}</button>
        ${isLogin ? '<button type="button" style="background:none;border:none;color:var(--muted);font-size:10px;cursor:pointer;" id="forgot-pwd-btn">ЗАБЫЛИ ПАРОЛЬ?</button>' : ''}
      </div>
    </form>
  `);

  document.getElementById('switch-auth').onclick = () => openAuthModal(isLogin ? 'register' : 'login');
  
  if (isLogin) {
    document.getElementById('forgot-pwd-btn').onclick = () => {
      openModal(`
        <div class="modal-kicker">ВОССТАНОВЛЕНИЕ</div>
        <h3 id="modal-title">Сброс пароля</h3>
        <p style="font-size:12px;color:#aaa;margin-bottom:15px;">Укажите email, на который зарегистрирован аккаунт. Мы отправим ссылку.</p>
        <form id="forgot-form">
          <label class="field full"><span class="form-label">EMAIL <em>*</em></span><input type="email" name="email" required placeholder="you@example.com"></label>
          <p class="auth-error" style="color:var(--pink);font-size:10px;margin-top:10px;"></p>
          <button class="modal-submit" type="submit">ОТПРАВИТЬ ССЫЛКУ ↗</button>
          <button type="button" class="modal-submit" style="background:transparent;color:inherit;border:1px solid #555;margin-top:10px;" onclick="document.getElementById('account-button').click()">НАЗАД</button>
        </form>
      `);
    };
  }
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

// ================= СОБЫТИЯ =================
document.getElementById('open-create')?.addEventListener('click', () => {
  if (!currentUser) return showToast('Сначала войдите в аккаунт!');
  openModal(`
    <div class="modal-kicker">РИТУАЛ ЗАХОРОНЕНИЯ / 01</div>
    <h3 id="modal-title">Пусть проект<br>найдёт покой.</h3>
    <form id="create-form">
      <div class="form-grid">
        <label class="field full"><span class="form-label">НАЗВАНИЕ <em>*</em></span><input name="title" required maxlength="72" placeholder="Амбициозное имя"></label>
        <label class="field full"><span class="form-label">ПОЧЕМУ ПРОЕКТ УМЕР</span><textarea name="description" maxlength="280" placeholder="Инвестор ушёл за кофе…"></textarea></label>
        <label class="field"><span class="form-label">КАТЕГОРИЯ</span><select name="category" required><option>Социальное</option><option>Web3</option><option>Маркетплейс</option><option>Искусственный интеллект</option><option>Игры</option><option>Приложение</option><option>Другое</option></select></label>
        <label class="field full"><span class="form-label">ССЫЛКА НА СКРИНШОТ</span><input name="screenshot" type="url" placeholder="https://..."></label>
        <div class="field full"><span class="form-label">ИСХОДНИКИ / СЕКРЕТНЫЙ ТЕКСТ <em>*</em></span><textarea name="secret" class="secret-input" required></textarea></div>
      </div>
      <div class="moderation-result" id="moderation-result" aria-live="polite"></div>
      <button class="modal-submit" type="submit">ЗАЖЕЧЬ ПОСЛЕДНЮЮ СВЕЧУ ↗</button>
    </form>
  `);
});

document.getElementById('account-button')?.addEventListener('click', () => {
  if (currentUser) { db.auth.signOut(); showToast('Вы вышли из аккаунта.'); return; }
  openAuthModal('login');
});

document.getElementById('open-support')?.addEventListener('click', supportModal);
document.getElementById('open-dialogs')?.addEventListener('click', () => {
  if (!currentUser) return showToast('Войдите, чтобы открыть диалоги!');
  activeChatUserId = null; activeChatUserName = null;
  document.getElementById('messenger-modal').style.display = 'flex';
  loadMessages();
});
document.getElementById('messenger-close')?.addEventListener('click', () => document.getElementById('messenger-modal').style.display = 'none');
document.getElementById('modal-close')?.addEventListener('click', closeModal);
backdrop?.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });

// ================= ОТПРАВКА ФОРМ =================
modalContent?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;

  // 1. Восстановление пароля (запрос)
  if (form.id === 'forgot-form') {
    const email = form.email.value;
    const btn = form.querySelector('button[type="submit"]');
    const err = form.querySelector('.auth-error');
    btn.disabled = true; btn.textContent = 'ОТПРАВКА...';
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split('#')[0] });
    if (error) { err.textContent = error.message; btn.disabled = false; btn.textContent = 'ОТПРАВИТЬ ССЫЛКУ ↗'; }
    else { showToast('Ссылка для сброса отправлена на почту!'); closeModal(); }
    return;
  }

  // 2. Установка нового пароля
  if (form.id === 'reset-password-form') {
    const newPassword = form.newPassword.value;
    const btn = form.querySelector('button[type="submit"]');
    const err = form.querySelector('.auth-error');
    btn.disabled = true; btn.textContent = 'СОХРАНЕНИЕ...';
    const { error } = await db.auth.updateUser({ password: newPassword });
    if (error) { err.textContent = error.message; btn.disabled = false; btn.textContent = 'СОХРАНИТЬ ПАРОЛЬ ↗'; }
    else { showToast('Пароль успешно изменен! Войдите с новым паролем.'); closeModal(); db.auth.signOut(); }
    return;
  }

  // 3. Вход и регистрация
  if (form.id === 'auth-form') {
    const email = form.email.value;
    const password = form.password.value;
    const btn = document.getElementById('auth-btn');
    const errP = form.querySelector('.auth-error');
    btn.disabled = true; btn.textContent = 'ЗАГРУЗКА...';

    if (form.dataset.mode === 'register') {
      const username = form.username.value.trim() || email.split('@')[0];
      const { data, error } = await db.auth.signUp({ email, password, options: { data: { username } } });
      if (error) { errP.textContent = error.message; btn.disabled = false; btn.textContent = 'СОЗДАТЬ АККАУНТ ↗'; }
      else { 
        // ПРОВЕРКА: если Supabase требует подтверждения, сессии не будет
        if (data.session === null) {
          showToast('Аккаунт создан! ПРОВЕРЬТЕ ВАШУ ПОЧТУ (и папку Спам).'); 
        } else {
          showToast('Аккаунт создан! Вы вошли.'); 
        }
        closeModal(); 
      }
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) { errP.textContent = error.message; btn.disabled = false; btn.textContent = 'ВОЙТИ ↗'; }
      else { showToast('Вы вошли.'); closeModal(); }
    }
    return;
  }

  // 4. Создание проекта
  if (form.id === 'create-form') {
    const title = form.title.value.trim();
    const secret = form.secret.value.trim();
    const desc = form.description.value.trim();
    const modResult = document.getElementById('moderation-result');
    
    const titleCheck = validateTextAI(title);
    if (!titleCheck.ok) { modResult.className = 'moderation-result blocked'; modResult.textContent = 'ИИ отклонил название: ' + titleCheck.msg; return; }
    if (desc) {
      const descCheck = validateTextAI(desc);
      if (!descCheck.ok) { modResult.className = 'moderation-result blocked'; modResult.textContent = 'ИИ отклонил описание: ' + descCheck.msg; return; }
    }

    modResult.className = 'moderation-result checking'; modResult.textContent = 'ИИ анализирует...';
    const btn = form.querySelector('button[type="submit"]'); btn.disabled = true; btn.textContent = 'ПУБЛИКАЦИЯ...';

    await new Promise(r => setTimeout(r, 800));

    const { error } = await db.from('projects').insert([{
      title, description: desc, category: form.category.value, screenshot: form.screenshot.value, secret,
      owner_id: currentUser.id, owner_name: currentUser.username, liked_by: [], comments: []
    }]);

    if (error) { modResult.className = 'moderation-result blocked'; modResult.textContent = 'Ошибка БД: ' + error.message; btn.disabled = false; btn.textContent = 'ЗАЖЕЧЬ ПОСЛЕДНЮЮ СВЕЧУ ↗'; }
    else { closeModal(); showToast('Проект опубликован!'); loadProjects(); }
    return;
  }

    // 5. ТЕХНИЧЕСКАЯ ПОДДЕРЖКА (С ИИ-ФИЛЬТРОМ И ЛИМИТОМ)
  if (form.id === 'support-form') {
    const message = form.message.value.trim();
    const result = document.getElementById('support-result');
    const btn = form.querySelector('button[type="submit"]');

    // Проверка лимита (1 час)
    const lastSupportTime = localStorage.getItem('tdg_support_time');
    if (lastSupportTime && Date.now() - Number(lastSupportTime) < 3600000) {
      const minutesLeft = Math.ceil((3600000 - (Date.now() - Number(lastSupportTime))) / 60000);
      result.className = 'support-result error';
      result.textContent = `Слишком часто. Следующее обращение можно отправить через ${minutesLeft} мин.`;
      return;
    }

    // Проверка ИИ (маты, бессмыслица)
    const check = validateTextAI(message);
    if (!check.ok) {
      result.className = 'support-result error';
      result.textContent = 'ИИ-модератор отклонил обращение: ' + check.msg;
      return;
    }

    btn.disabled = true; btn.textContent = 'ОТПРАВКА...';
    await new Promise(r => setTimeout(r, 600)); // Имитация задержки
    
    // Сохраняем локально (для демо)
    const supportMessages = JSON.parse(localStorage.getItem('tdg_support') || '[]');
    supportMessages.push({ message, user: currentUser?.email || 'Гость', date: new Date() });
    localStorage.setItem('tdg_support', JSON.stringify(supportMessages));
    
    // Запоминаем время отправки
    localStorage.setItem('tdg_support_time', Date.now().toString());

    result.className = 'support-result success';
    result.textContent = 'ИИ одобрил. Обращение отправлено! Следующее можно будет отправить через час.';
    btn.disabled = false; btn.textContent = 'ОТПРАВИТЬ ОБРАЩЕНИЕ ↗';
    form.reset();
    return;
  }

    btn.disabled = true; btn.textContent = 'ОТПРАВКА...';
    await new Promise(r => setTimeout(r, 600)); // Имитация задержки
    
    // Сохраняем локально (для демо)
    const supportMessages = JSON.parse(localStorage.getItem('tdg_support') || '[]');
    supportMessages.push({ message, user: currentUser?.email || 'Гость', date: new Date() });
    localStorage.setItem('tdg_support', JSON.stringify(supportMessages));

    result.className = 'support-result success';
    result.textContent = 'ИИ одобрил. Обращение отправлено!';
    btn.disabled = false; btn.textContent = 'ОТПРАВИТЬ ОБРАЩЕНИЕ ↗';
    form.reset();
    return;
  }

  // 6. Отправка комментария
  if (form.matches('.comment-form')) {
    if (!currentUser) return showToast('Войдите, чтобы комментировать!');
    const card = form.closest('.grave-card');
    const projectId = card.dataset.id;
    const text = form.querySelector('input[name="comment"]').value.trim();
    const warning = card.querySelector('.comment-warning');

    const check = validateTextAI(text);
    if (!check.ok) { warning.textContent = 'Смотритель кладбища не пропустил: ' + check.msg; warning.style.display = 'block'; return; }
    warning.style.display = 'none';

    const project = projects.find(p => p.id === projectId);
    const newComments = [...(project.comments || []), { userId: currentUser.id, userName: currentUser.username, text, createdAt: Date.now() }];
    const { error } = await db.from('projects').update({ comments: newComments }).eq('id', projectId);
    if (!error) { form.reset(); loadProjects(); }
    return;
  }
});

// ================= КЛИКИ ПО КАРТОЧКАМ =================
grid?.addEventListener('click', async (e) => {
  const card = e.target.closest('.grave-card');
  if (!card) return;
  const p = projects.find(x => x.id === card.dataset.id);

  if (e.target.closest('[data-action="rose"]')) {
    if (!currentUser) return showToast('Войдите, чтобы ставить розы!');
    let likedBy = p.liked_by || [];
    likedBy = likedBy.includes(currentUser.id) ? likedBy.filter(id => id !== currentUser.id) : [...likedBy, currentUser.id];
    await db.from('projects').update({ liked_by: likedBy }).eq('id', p.id);
    loadProjects();
  }

  if (e.target.closest('[data-action="view-secret"]')) {
    const box = card.querySelector('[data-secret-box]');
    if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
  }

  if (e.target.closest('[data-action="toggle-comments"]')) {
    const box = card.querySelector('[data-comments-box]');
    if (box) box.classList.toggle('open');
  }

  if (e.target.closest('[data-action="message-author"]')) {
    if (!currentUser) return showToast('Войдите, чтобы писать автору!');
    const btn = e.target.closest('[data-action="message-author"]');
    activeChatUserId = btn.dataset.owner;
    activeChatUserName = btn.dataset.ownername;
    document.getElementById('messenger-modal').style.display = 'flex';
    loadMessages();
  }
});

// ================= МЕССЕНДЖЕР =================
function renderMessenger() {
  if (!currentUser) return;
  const listEl = document.getElementById('conversation-list');
  const chatHeader = document.getElementById('chat-header');
  const chatMessages = document.getElementById('chat-messages');
  const inputArea = document.getElementById('chat-input-area');
  if (!listEl || !chatHeader || !chatMessages || !inputArea) return;

  const userIds = new Set();
  messages.forEach(m => { if (m.sender_id === currentUser.id) userIds.add(m.receiver_id); if (m.receiver_id === currentUser.id) userIds.add(m.sender_id); });
  if (activeChatUserId && !userIds.has(activeChatUserId)) userIds.add(activeChatUserId);
  const usersArr = Array.from(userIds);

  if (!usersArr.length) listEl.innerHTML = '<div class="empty-conversations">Нет активных диалогов</div>';
  else {
    listEl.innerHTML = usersArr.map(uid => {
      const msgs = messages.filter(m => (m.sender_id === uid && m.receiver_id === currentUser.id) || (m.sender_id === currentUser.id && m.receiver_id === uid));
      const lastMsg = msgs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      let name = 'Пользователь';
      if (uid === activeChatUserId && activeChatUserName) name = activeChatUserName;
      else if (lastMsg) name = lastMsg.sender_id === currentUser.id ? 'Вы' : lastMsg.sender_name;
      return `<div class="conversation-item ${activeChatUserId === uid ? 'active' : ''}" data-uid="${uid}" data-name="${name}"><div class="conversation-name">${name}</div><div class="conversation-preview">${lastMsg ? lastMsg.text : ''}</div></div>`;
    }).join('');
  }

  listEl.querySelectorAll('.conversation-item').forEach(el => {
    el.onclick = () => { activeChatUserId = el.dataset.uid; activeChatUserName = el.dataset.name; renderMessenger(); };
  });

  if (!activeChatUserId) {
    chatHeader.textContent = 'Выберите собеседника';
    chatMessages.innerHTML = '';
    inputArea.style.display = 'none';
  } else {
    const peerMsgs = messages.filter(m => (m.sender_id === activeChatUserId && m.receiver_id === currentUser.id) || (m.sender_id === currentUser.id && m.receiver_id === activeChatUserId)).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    chatHeader.textContent = 'Диалог с ' + (activeChatUserName || 'Пользователем');
    chatMessages.innerHTML = peerMsgs.map(m => {
      const own = m.sender_id === currentUser.id;
      return `<div class="message-bubble ${own ? 'own' : 'other'}">${m.text}<div class="message-time">${new Date(m.created_at).toLocaleTimeString()}</div></div>`;
    }).join('');
    chatMessages.scrollTop = chatMessages.scrollHeight;
    inputArea.style.display = 'flex';

    const sendBtn = document.getElementById('chat-send');
    const chatInput = document.getElementById('chat-input');
    const send = async () => {
      const text = chatInput.value.trim();
      if (!text) return;
      const check = validateTextAI(text);
      if (!check.ok) return showToast('ИИ-модератор отклонил сообщение: ' + check.msg);
      chatInput.value = '';
      await db.from('messages').insert([{ sender_id: currentUser.id, sender_name: currentUser.username, receiver_id: activeChatUserId, text: text }]);
    };
    sendBtn.onclick = send;
    chatInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } };
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateAccountButton();
  loadProjects();
});
