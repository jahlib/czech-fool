const CACHE_NAME = 'czech-fool-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/game.js',
  '/sounds/playcard.ogg',
  '/sounds/drawcard.ogg',
  '/sounds/eight.ogg',
  '/sounds/change.ogg',
  '/sounds/skip.ogg',
  '/sounds/alert.ogg',
  '/sounds/chat.ogg',
  '/sounds/win.ogg',
  '/sounds/lose.ogg',
  '/sounds/two.ogg',
  '/sounds/six.ogg',
  '/sounds/seven.ogg',
  '/sounds/shuffle.ogg',
  '/sounds/ace.ogg',
  '/sounds/eightplace.ogg'
];

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
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Обработка запросов
self.addEventListener('fetch', event => {
  // Игнорируем запросы не http/https (chrome-extension, data, blob и т.д.)
  if (!event.request.url.startsWith('http')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Возвращаем из кеша если есть
        if (response) {
          return response;
        }
        
        // Клонируем запрос
        const fetchRequest = event.request.clone();
        
        return fetch(fetchRequest).then(response => {
          // Проверяем валидность ответа
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          // Клонируем ответ
          const responseToCache = response.clone();
          
          // Кешируем новый ресурс
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
          
          return response;
        });
      })
  );
});
