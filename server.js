const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
require('dotenv').config();
const session = require('express-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
// const FileStore = require('session-file-store')(session);

// Установка кодировки для консоли
process.stdout.setEncoding('utf8');

const app = express();
const PORT = process.env.PORT || 3001;

// Ключи (лучше хранить в .env)
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || 'CG-56kAjpNgMLX2KvXsAQtfdtDs';
const COINMARKETCAP_API_KEY = process.env.COINMARKETCAP_API_KEY || '2bc7292c-8a26-4bd7-8a51-5f7d6ff2f8ad';
const CRYPTOCOMPARE_API_KEY = process.env.CRYPTOCOMPARE_API_KEY || 'bb4039ed8dd766e676e5fbb71a7a26f280c1466bf3a899c4f0d48103ac7cdd7a';

app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      'http://127.0.0.1:5500', 
      'http://localhost:5500',
      'https://helili1.github.io',
      'https://helili1.github.io/kriptomonitor'
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '5mb' }));
app.use(session({
  // store: new FileStore({
  //   ttl: 86400, // время жизни сессии в секундах (24 часа)
  //   path: './sessions', // директория для хранения сессий
  //   retries: 0 // не пытаться повторно создать сессию при ошибке
  // }),
  secret: 'твой_секрет',
  resave: false, // не сохранять сессию, если она не изменилась
  saveUninitialized: false, // не создавать сессию для неавторизованных пользователей
  cookie: {
    secure: false,        // true — только через HTTPS
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 1 день
  }
}));

// Подключение к базе данных
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Прокси для CoinGecko (публичный)
app.get('/api/coingecko', async (req, res) => {
  try {
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1';
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (e) {
    console.error(e); // обязательно!
    res.status(500).json({ error: 'Ошибка сервера', details: e.message });
  }
});

// Прокси для CoinMarketCap
app.get('/api/coinmarketcap', async (req, res) => {
  try {
    const url = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=10&convert=USD';
    const response = await fetch(url, {
      headers: {
        'X-CMC_PRO_API_KEY': COINMARKETCAP_API_KEY
      }
    });
    const data = await response.json();
    res.json(data.data);
  } catch (e) {
    console.error(e); // обязательно!
    res.status(500).json({ error: 'Ошибка сервера', details: e.message });
  }
});

// Прокси для CryptoCompare
app.get('/api/cryptocompare', async (req, res) => {
  try {
    const url = 'https://min-api.cryptocompare.com/data/top/mktcapfull?limit=10&tsym=USD';
    const response = await fetch(url, {
      headers: {
        'authorization': `Apikey ${CRYPTOCOMPARE_API_KEY}`
      }
    });
    const data = await response.json();
    res.json(data.Data);
  } catch (e) {
    console.error(e); // обязательно!
    res.status(500).json({ error: 'Ошибка сервера', details: e.message });
  }
});

// Регистрация
app.post('/api/register', async (req, res) => {
  const { email, display_name, password } = req.body;
  if (!email || !display_name || !password) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }
  try {
    const [users] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (users.length) {
      return res.status(409).json({ error: 'Пользователь уже существует' });
    }
    const hash = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)', [email, display_name, hash]);
    res.json({ message: 'Регистрация успешна' });
  } catch (e) {
    console.error(e); // обязательно!
    res.status(500).json({ error: 'Ошибка сервера', details: e.message });
  }
});

// Авторизация
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('Попытка входа:', { email });
  
  if (!email || !password) {
    console.log('Отсутствуют обязательные поля');
    return res.status(400).json({ error: 'Заполните все поля' });
  }
  try {
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    console.log('Найден пользователь:', users.length > 0);
    
    if (!users.length) {
      console.log('Пользователь не найден');
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    const user = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    console.log('Пароль верный:', valid);
    
    if (!valid) {
      console.log('Неверный пароль');
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    // Создаем новую сессию
    req.session.regenerate((err) => {
      if (err) {
        console.error('Ошибка регенерации сессии:', err);
        return res.status(500).json({ error: 'Ошибка создания сессии' });
      }

      // Сохраняем данные пользователя в сессии
      req.session.userId = user.id;
      req.session.email = user.email;
      req.session.displayName = user.display_name;
      
      console.log('Установлен userId в сессию:', req.session.userId);
      console.log('Полная сессия:', req.session);
      
      // Отправляем ответ
      res.json({ 
        message: 'Вход выполнен', 
        user: { 
          id: user.id, 
          email: user.email, 
          display_name: user.display_name,
          avatar: user.avatar || null
        } 
      });
    });
  } catch (e) {
    console.error('Ошибка при авторизации:', e);
    res.status(500).json({ error: 'Ошибка сервера', details: e.message });
  }
});

// Получение профиля
app.get('/api/profile', async (req, res) => {
  console.log('Запрос профиля. Сессия:', req.session);
  console.log('userId в сессии:', req.session.userId);
  
  if (!req.session.userId) {
    console.log('Пользователь не авторизован');
    return res.status(401).json({ error: 'Не авторизован' });
  }
  try {
    const [users] = await db.query('SELECT id, email, display_name, avatar, created_at FROM users WHERE id = ?', [req.session.userId]);
    if (!users.length) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json(users[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера', details: e.message });
  }
});

// Обновление профиля пользователя
app.put('/api/profile', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  const { display_name, email, description, avatar } = req.body;
  console.log('PUT /api/profile данные:', req.body);
  try {
    // Обновляем только переданные поля
    const fields = [];
    const values = [];
    if (display_name) { fields.push('display_name = ?'); values.push(display_name); }
    if (email) { fields.push('email = ?'); values.push(email); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    if (avatar !== undefined) { fields.push('avatar = ?'); values.push(avatar); }
    if (!fields.length) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }
    values.push(req.session.userId);
    await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    // Получаем обновлённые данные пользователя
    const [users] = await db.query('SELECT id, email, display_name, avatar, description FROM users WHERE id = ?', [req.session.userId]);
    console.log('Обновлённые данные пользователя:', users[0]);
    if (users.length) {
      req.session.displayName = users[0].display_name;
      req.session.email = users[0].email;
      // req.session.avatar = users[0].avatar; // если нужно
    }
    res.json({ message: 'Профиль обновлён', user: users[0] });
  } catch (e) {
    console.error('Ошибка при обновлении профиля:', e);
    if (e && e.sqlMessage) {
      console.error('SQL ошибка:', e.sqlMessage);
    }
    res.status(500).json({ error: 'Ошибка сервера', details: e.message });
  }
});

// Выход из системы
app.post('/api/logout', (req, res) => {
  console.log('Выход из системы. Сессия до:', req.session);
  req.session.destroy((err) => {
    if (err) {
      console.error('Ошибка при выходе:', err);
      return res.status(500).json({ error: 'Ошибка при выходе из системы' });
    }
    console.log('Сессия уничтожена');
    res.clearCookie('connect.sid');
    res.json({ message: 'Выход выполнен' });
  });
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
}); 