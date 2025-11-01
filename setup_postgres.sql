-- Создание базы данных и пользователя для игры
-- Выполните эти команды от имени postgres пользователя

-- Создание базы данных
CREATE DATABASE czechdb;

-- Создание пользователя
CREATE USER czech WITH PASSWORD 'password';

-- Выдача прав
GRANT ALL PRIVILEGES ON DATABASE czechdb TO czech;

-- Подключитесь к базе card_game
\c czechdb

-- Выдача прав на схему public
GRANT ALL ON SCHEMA public TO czech;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO czech;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO czech;

-- Права по умолчанию для будущих таблиц
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO czech;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO czech;
