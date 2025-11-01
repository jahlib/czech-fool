# Запуск с PostgreSQL

## 1. Установите asyncpg

```bash
pip install asyncpg
```

## 2. Укажите пароль в server.py

Откройте `/opt/czech-fool/server.py` и найдите строку 80:

```python
password="password"  # Замените на ваш пароль
```

Замените `password` на пароль пользователя `czech` в PostgreSQL.

## 3. Проверьте подключение

```bash
psql -U czech -d czechdb -h localhost
# Введите пароль
```

Если подключение успешно, выйдите: `\q`

## 4. Запустите сервер

```bash
cd /opt/czech-fool
python3 server.py
```

Вы должны увидеть:
```
Connecting to PostgreSQL...
PostgreSQL connected successfully!
Room stats: 0 total, 0 active games, 0 inactive >1h, 0 inactive >24h
WebSocket server started on ws://0.0.0.0:8765
HTTP server started on http://0.0.0.0:8080
Open https://game.ruwk.ru in your browser
Automatic cleanup task started (runs every 6 hours)
```

## Что изменилось

### Производительность
- ✅ **Асинхронные операции** - игра не зависает при сохранении
- ✅ **Пул соединений** - 2-10 одновременных подключений
- ✅ **Батчинг** - массовая вставка карт
- ✅ **Нет блокировок** - MVCC в PostgreSQL

### База данных
- База: `czechdb`
- Пользователь: `czech`
- Порт: `5432`
- Хост: `localhost`

### Сохранение
Теперь сохранение происходит:
- ✅ При создании комнаты
- ✅ При присоединении игрока
- ✅ При старте игры
- ✅ При каждом ходе (асинхронно!)
- ✅ При взятии карты
- ✅ При окончании игры
- ❌ НЕ блокирует игру!

## Мониторинг

### Проверка активных соединений
```sql
SELECT * FROM pg_stat_activity WHERE datname = 'czechdb';
```

### Статистика таблиц
```sql
SELECT tablename, n_tup_ins, n_tup_upd, n_tup_del 
FROM pg_stat_user_tables;
```

### Размер базы
```sql
SELECT pg_size_pretty(pg_database_size('czechdb'));
```

## Troubleshooting

### Ошибка: "password authentication failed"
Проверьте пароль в `server.py` строка 80.

### Ошибка: "database does not exist"
Создайте базу:
```bash
sudo -u postgres psql
CREATE DATABASE czechdb;
GRANT ALL PRIVILEGES ON DATABASE czechdb TO czech;
```

### Ошибка: "role does not exist"
Создайте пользователя:
```bash
sudo -u postgres psql
CREATE USER czech WITH PASSWORD 'password';
```

### Ошибка: "could not connect to server"
Запустите PostgreSQL:
```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql
```
