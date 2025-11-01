# Настройка PostgreSQL для игры

## 1. Установка PostgreSQL

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# Проверка статуса
sudo systemctl status postgresql
```

## 2. Создание базы данных и пользователя

```bash
# Войти в PostgreSQL
sudo -u postgres psql

# Выполнить SQL команды
\i /path/to/setup_postgres.sql

# Или вручную:
CREATE DATABASE card_game;
CREATE USER card_game_user WITH PASSWORD 'your_secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE card_game TO card_game_user;
\c card_game
GRANT ALL ON SCHEMA public TO card_game_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO card_game_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO card_game_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO card_game_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO card_game_user;

# Выход
\q
```

## 3. Настройка подключения

Отредактируйте `/etc/postgresql/*/main/pg_hba.conf`:

```
# Добавьте строку для локального подключения
local   card_game    card_game_user                     md5
host    card_game    card_game_user    127.0.0.1/32     md5
```

Перезапустите PostgreSQL:
```bash
sudo systemctl restart postgresql
```

## 4. Установка Python зависимостей

```bash
pip install asyncpg
```

## 5. Настройка в коде

В `server.py` измените параметры подключения:

```python
from database_postgres import GameDatabase

# В __init__:
self.db = GameDatabase(
    host="localhost",
    port=5432,
    database="card_game",
    user="card_game_user",
    password="your_secure_password_here"
)

# В main():
await game_server.db.connect()
```

## 6. Проверка подключения

```bash
psql -U card_game_user -d card_game -h localhost
# Введите пароль
```

## Преимущества PostgreSQL vs SQLite

- ✅ **Асинхронные операции** - не блокируют игру
- ✅ **Пул соединений** - быстрое переиспользование
- ✅ **Параллельные запросы** - несколько игроков одновременно
- ✅ **Лучшая производительность** - оптимизированные индексы
- ✅ **MVCC** - нет блокировок при чтении
- ✅ **Масштабируемость** - готово к росту нагрузки

## Мониторинг

```sql
-- Активные соединения
SELECT * FROM pg_stat_activity WHERE datname = 'card_game';

-- Размер базы
SELECT pg_size_pretty(pg_database_size('card_game'));

-- Статистика таблиц
SELECT schemaname, tablename, n_tup_ins, n_tup_upd, n_tup_del 
FROM pg_stat_user_tables;
```
