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

    // Проверка ИИ
    const check = validateTextAI(message);
    if (!check.ok) { result.className = 'support-result error'; result.textContent = 'ИИ-модератор отклонил обращение: ' + check.msg; return; }

    btn.disabled = true; btn.textContent = 'ОТПРАВКА...';
    
    // Отправляем в базу данных Supabase
    const { error } = await db.from('support_messages').insert([{
      message: message,
      user_email: currentUser ? currentUser.email : 'Гость (не авторизован)'
    }]);

    if (error) {
      result.className = 'support-result error';
      result.textContent = 'Ошибка базы данных: ' + error.message;
      btn.disabled = false; btn.textContent = 'ОТПРАВИТЬ ОБРАЩЕНИЕ ↗';
      return;
    }

    // Запоминаем время
    localStorage.setItem('tdg_support_time', Date.now().toString());

    result.className = 'support-result success';
    result.textContent = 'ИИ одобрил. Обращение доставлено в закрытый ящик автора!';
    btn.disabled = false; btn.textContent = 'ОТПРАВИТЬ ОБРАЩЕНИЕ ↗';
    form.reset();
    return;
  }
