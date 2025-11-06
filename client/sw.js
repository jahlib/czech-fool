const CACHE_NAME = 'czech-fool-v1';
const CACHE_TIMESTAMP_KEY = 'cache-timestamps';
const CACHE_MAX_AGE = 60 * 60 * 1000; // 1 час в миллисекундах

const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/game.js',
  '/sounds/playcard.aac',
  '/sounds/drawcard.aac',
  '/sounds/eight.aac',
  '/sounds/change.aac',
  '/sounds/skip.aac',
  '/sounds/alert.aac',
  '/sounds/chat.aac',
  '/sounds/win.aac',
  '/sounds/lose.aac',
  '/sounds/two.aac',
  '/sounds/six.aac',
  '/sounds/seven.aac',
  '/sounds/shuffle.aac',
  '/sounds/ace.aac',
  '/sounds/eightplace.aac'
];

// Функция для получения временных меток из IndexedDB
async function getTimestamps() {
  try {
    const cache = await caches.open(CACHE_TIMESTAMP_KEY);
    const response = await cache.match('timestamps');
    if (response) {
      return await response.json();
    }
  } catch (e) {
    console.log('Error reading timestamps:', e);
  }
  return {};
}

// Функция для сохранения временных меток
async function saveTimestamps(timestamps) {
  try {
    const cache = await caches.open(CACHE_TIMESTAMP_KEY);
    const response = new Response(JSON.stringify(timestamps));
    await cache.put('timestamps', response);
  } catch (e) {
    console.log('Error saving timestamps:', e);
  }
}

// Функция для очистки старых записей кеша
async function cleanOldCache() {
  try {
    const timestamps = await getTimestamps();
    const now = Date.now();
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    
    let cleaned = 0;
    for (const request of requests) {
      const url = request.url;
      const timestamp = timestamps[url];
      
      // Если запись старше часа - удаляем
      if (timestamp && (now - timestamp) > CACHE_MAX_AGE) {
        await cache.delete(request);
        delete timestamps[url];
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`Cleaned ${cleaned} old cache entries`);
      await saveTimestamps(timestamps);
    }
  } catch (e) {
    console.log('Error cleaning cache:', e);
  }
}

// Установка service worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Активация service worker
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      // Удаляем старые версии кеша
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME && cacheName !== CACHE_TIMESTAMP_KEY) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Очищаем записи старше часа
      cleanOldCache()
    ])
  );
});

// Обработка запросов
self.addEventListener('fetch', event => {
  // Игнорируем запросы не http/https (chrome-extension, data, blob и т.д.)
  if (!event.request.url.startsWith('http')) {
    return;
  }
  
  event.respondWith(
    (async () => {
      // Проверяем кеш
      const cachedResponse = await caches.match(event.request);
      
      if (cachedResponse) {
        // Проверяем возраст записи
        const timestamps = await getTimestamps();
        const url = event.request.url;
        const timestamp = timestamps[url];
        const now = Date.now();
        
        // Если запись свежая (младше часа) - возвращаем из кеша
        if (timestamp && (now - timestamp) < CACHE_MAX_AGE) {
          return cachedResponse;
        }
        
        // Если запись старая - удаляем и загружаем заново
        console.log('Cache expired for:', url);
        const cache = await caches.open(CACHE_NAME);
        await cache.delete(event.request);
        delete timestamps[url];
        await saveTimestamps(timestamps);
      }
      
      // Загружаем с сервера
      try {
        const fetchRequest = event.request.clone();
        const response = await fetch(fetchRequest);
        
        // Проверяем валидность ответа
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        
        // Кешируем новый ресурс с временной меткой
        const responseToCache = response.clone();
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, responseToCache);
        
        // Сохраняем временную метку
        const timestamps = await getTimestamps();
        timestamps[event.request.url] = Date.now();
        await saveTimestamps(timestamps);
        
        return response;
      } catch (error) {
        console.log('Fetch failed:', error);
        // Если есть старый кеш - возвращаем его как fallback
        if (cachedResponse) {
          return cachedResponse;
        }
        throw error;
      }
    })()
  );
});
