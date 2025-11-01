# Настройка systemd service для игры

## Установка service

### 1. Скопируйте файл service

```bash
sudo cp /opt/czech-fool/czech-fool.service /etc/systemd/system/
```

### 2. Перезагрузите systemd

```bash
sudo systemctl daemon-reload
```

### 3. Включите автозапуск

```bash
sudo systemctl enable czech-fool
```

### 4. Запустите сервис

```bash
sudo systemctl start czech-fool
```

## Управление сервисом

### Проверка статуса
```bash
sudo systemctl status czech-fool
```

### Просмотр логов
```bash
sudo journalctl -u czech-fool -f
```

### Просмотр последних 100 строк логов
```bash
sudo journalctl -u czech-fool -n 100
```

### Перезапуск (с очисткой комнат)
```bash
sudo systemctl restart czech-fool
```

### Остановка
```bash
sudo systemctl stop czech-fool
```

### Отключение автозапуска
```bash
sudo systemctl disable czech-fool
```

## Флаг --clearrooms

Флаг `--clearrooms` в файле service:
```
ExecStart=/usr/bin/python3 /opt/czech-fool/server.py --clearrooms
```

### Что делает:
- ✅ Удаляет **ВСЕ** комнаты из базы данных при запуске
- ✅ Очищает зависшие комнаты с отключенными игроками
- ✅ Начинает с чистого листа

### Когда использовать:
- При рестарте сервера
- После обновления кода
- Для очистки зависших комнат

### Без флага:
Если убрать `--clearrooms` из ExecStart:
```
ExecStart=/usr/bin/python3 /opt/czech-fool/server.py
```
- Загружает существующие комнаты из БД
- Удаляет только старые (>24 часов)
- Игроки могут продолжить игру после рестарта

## Редактирование service

```bash
sudo systemctl edit --full czech-fool
```

После изменений:
```bash
sudo systemctl daemon-reload
sudo systemctl restart czech-fool
```

## Проверка работы

### 1. Проверьте что сервис запущен
```bash
sudo systemctl is-active czech-fool
# Должно вывести: active
```

### 2. Проверьте логи запуска
```bash
sudo journalctl -u czech-fool -n 50
```

Должны увидеть:
```
Starting with --clearrooms flag: all rooms will be deleted
Connecting to PostgreSQL...
PostgreSQL connected successfully!
Clearing all rooms from database...
Deleted X rooms from database
WebSocket server started on ws://0.0.0.0:8765
HTTP server started on http://0.0.0.0:8080
```

### 3. Проверьте порты
```bash
sudo netstat -tulpn | grep python3
```

Должны быть открыты:
- `0.0.0.0:8765` (WebSocket)
- `0.0.0.0:8080` (HTTP)

## Troubleshooting

### Сервис не запускается
```bash
sudo journalctl -u czech-fool -n 100
```

### Ошибка подключения к PostgreSQL
Проверьте что PostgreSQL запущен:
```bash
sudo systemctl status postgresql
```

### Ошибка прав доступа
Убедитесь что ваш пользователь может читать файлы:
```bash
ls -la /opt/czech-fool/server.py
```

### Порты заняты
Проверьте что порты 8765 и 8080 свободны:
```bash
sudo lsof -i :8765
sudo lsof -i :8080
```
