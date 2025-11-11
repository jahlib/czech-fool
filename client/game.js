class CardGame {
    constructor() {
        this.ws = null;
        this.playerId = null;
        this.roomId = null;
        this.currentRoom = null;
        this.hand = [];
        this.pendingCardToPlay = null;
        this.eightDrawnCards = [];  // ID карт взятых из колоды на восьмёрку
        this.lastShakeTime = 0;  // Время последней тряски для кулдауна
        this.lastReactionTime = 0;  // Время последней реакции для кулдауна
        
        // Загружаем состояние звука из localStorage
        this.soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
        
        // Маппинг звуков для реакций
        this.reactionSounds = {
            '🙃': 'chat',
            '🙁': 'chat',
            '😡': 'chat',
            '😈': 'chat',
            '😇': 'chat',
            '😠': 'chat',
            '😄': 'chat',
            '😎': 'chat',
            '🤔': 'pogodika',
            '😤': 'chat',
            '😐': 'chat',
            '👍': 'chat',
            '👎': 'chat',
            '🤝': 'chat',
            '🫰': 'chat',
            '🪬': 'chat',
            '🤯': 'chat',
            '🤡': 'chat',
            '🤨': 'chat',
            '😑': 'chat',
            '😌': 'chat',
            '😴': 'chat',
            '🌚': 'chat',
            '🐱': 'cat',
            '🐸': 'frog',
            '🐺': 'chat',
            '🐊': 'dance',
            '🐠': 'chat',
            '🌹': 'chat',
            '🗿': 'huh',
            '👁️': 'chat',
            '💩': 'chat',
            '🔩': 'pipe',
            '🔪': 'okay',
            '⚔️': 'sword',
            '🎺': 'chat',
            '🔮': 'chat',
            '🎲': 'chat',
            '🎯': 'chat',
            '♥️': 'chat',
            '♦️': 'chat',
            '♣️': 'chat',
            '♠️': 'chat'
        };
        
        // Инициализация звуков
        this.sounds = {
            playcard: new Audio('/sounds/playcard.aac'),
            drawcard: new Audio('/sounds/drawcard.aac'),
            eight: new Audio('/sounds/eight.aac'),
            change: new Audio('/sounds/change.aac'),
            skip: new Audio('/sounds/skip.aac'),
            alert: new Audio('/sounds/alert.aac'),
            chat: new Audio('/sounds/chat.aac'),
            frog: new Audio('/sounds/frog.aac'),
            win: new Audio('/sounds/win.aac'),
            winqueen: new Audio('/sounds/winqueen.aac'),
            lose: new Audio('/sounds/lose.aac'),
            two: new Audio('/sounds/two.aac'),
            six: new Audio('/sounds/six.aac'),
            seven: new Audio('/sounds/seven.aac'),
            shuffle: new Audio('/sounds/shuffle.aac'),
            ace: new Audio('/sounds/ace.aac'),
            eightplace: new Audio('/sounds/eightplace.aac'),
            cat: new Audio('/sounds/cat.aac'),
            okay: new Audio('/sounds/okay.aac'),
            sword: new Audio('/sounds/sword.aac'),
            pipe: new Audio('/sounds/pipe.aac'),
            huh: new Audio('/sounds/huh.aac'),
            pogodika: new Audio('/sounds/pogodika.aac'),
            dance: new Audio('/sounds/dance.aac')
        };
        
        this.initElements();
        this.initEventListeners();
        
        // Загружаем правила игры
        this.loadRules();
        
        // Отслеживаем видимость страницы
        this.pageVisible = !document.hidden;
        this.setupVisibilityHandling();
        
        // Проверяем URL и localStorage для переподключения
        this.checkReconnect();
        
        // Инициализируем PWA
        this.initPWA();
    }
    
    setupVisibilityHandling() {
        // Обработка видимости страницы
        document.addEventListener('visibilitychange', () => {
            this.pageVisible = !document.hidden;
            
            // Проверяем на каком экране мы находимся
            const lobbyScreen = document.getElementById('lobby-screen');
            const isOnLobby = lobbyScreen && lobbyScreen.classList.contains('active');
            
            if (document.hidden) {
                // Страница скрыта - закрываем WebSocket ТОЛЬКО на главной странице
                if (isOnLobby) {
                    console.log('Page hidden on lobby, closing WebSocket');
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.close();
                    }
                } else {
                    console.log('Page hidden during game, keeping connection');
                }
            } else {
                // Страница видима - переподключаемся если нужно
                console.log('Page visible, checking connection');
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    this.connect(true);
                }
            }
        });
    }
    
    playSound(soundName) {
        if (!this.soundEnabled || !this.sounds[soundName]) {
            return;
        }
        
        // Проверяем на каком экране мы находимся
        const isOnLobby = this.lobbyScreen && this.lobbyScreen.classList.contains('active');
        
        // Если на главной странице и вкладка скрыта - не воспроизводим звук
        if (isOnLobby && !this.pageVisible) {
            return;
        }
        
        // Во время игры (room или game экран) звуки работают даже в фоне
        // Используем существующий объект вместо клонирования
        const sound = this.sounds[soundName];
        sound.currentTime = 0; // Сбрасываем на начало для повторного воспроизведения
        sound.volume = 0.5;
        sound.play().catch(err => {}); // Убираем console.log для производительности
    }
    
    toggleSound() {
        this.soundEnabled = this.soundToggle.checked;
        localStorage.setItem('soundEnabled', this.soundEnabled);
    }
    
    toggleAnimations() {
        this.animationsEnabled = this.animationsToggle.checked;
        localStorage.setItem('animationsEnabled', this.animationsEnabled);
    }
    
    toggleProMode() {
        this.proModeEnabled = this.proModeToggle.checked;
        localStorage.setItem('proModeEnabled', this.proModeEnabled);
        
        // Обновляем отображение карт в руке если игра идёт
        if (this.hand && this.hand.length > 0 && this.topCard) {
            this.updateHand(this.topCard, this.chosenSuit);
        }
    }
    
    toggleNightMode() {
        this.nightModeEnabled = this.nightModeToggle.checked;
        localStorage.setItem('nightModeEnabled', this.nightModeEnabled);
        
        if (this.nightModeEnabled) {
            document.body.classList.add('night-mode');
            // Показываем настройку белых мастей
            if (this.whiteSuitsSetting) {
                this.whiteSuitsSetting.style.display = 'flex';
            }
            // Восстанавливаем состояние белых мастей если оно было сохранено
            const savedWhiteSuits = localStorage.getItem('whiteSuitsEnabled');
            if (savedWhiteSuits === 'true') {
                this.whiteSuitsEnabled = true;
                if (this.whiteSuitsToggle) {
                    this.whiteSuitsToggle.checked = true;
                }
                document.body.classList.add('white-suits');
            }
        } else {
            document.body.classList.remove('night-mode');
            // Скрываем настройку белых мастей
            if (this.whiteSuitsSetting) {
                this.whiteSuitsSetting.style.display = 'none';
            }
            // Выключаем белые масти
            this.whiteSuitsEnabled = false;
            document.body.classList.remove('white-suits');
        }
        
        this.updateNightModeButton();
    }
    
    toggleNightModeFromButton() {
        this.nightModeEnabled = !this.nightModeEnabled;
        localStorage.setItem('nightModeEnabled', this.nightModeEnabled);
        
        if (this.nightModeEnabled) {
            document.body.classList.add('night-mode');
            // Показываем настройку белых мастей
            if (this.whiteSuitsSetting) {
                this.whiteSuitsSetting.style.display = 'flex';
            }
            // Восстанавливаем состояние белых мастей если оно было сохранено
            const savedWhiteSuits = localStorage.getItem('whiteSuitsEnabled');
            if (savedWhiteSuits === 'true') {
                this.whiteSuitsEnabled = true;
                if (this.whiteSuitsToggle) {
                    this.whiteSuitsToggle.checked = true;
                }
                document.body.classList.add('white-suits');
            }
        } else {
            document.body.classList.remove('night-mode');
            // Скрываем настройку белых мастей
            if (this.whiteSuitsSetting) {
                this.whiteSuitsSetting.style.display = 'none';
            }
            // Выключаем белые масти
            this.whiteSuitsEnabled = false;
            document.body.classList.remove('white-suits');
        }
        
        // Синхронизируем с переключателем в настройках
        if (this.nightModeToggle) {
            this.nightModeToggle.checked = this.nightModeEnabled;
        }
        
        this.updateNightModeButton();
    }
    
    updateNightModeButton() {
        if (!this.nightModeToggleBtn) return;
        
        const sunIcon = this.nightModeToggleBtn.querySelector('.sun-icon');
        const moonIcon = this.nightModeToggleBtn.querySelector('.moon-icon');
        
        if (this.nightModeEnabled) {
            // Ночной режим включен - показываем солнце (переключит на дневной)
            if (sunIcon) sunIcon.style.display = 'inline';
            if (moonIcon) moonIcon.style.display = 'none';
        } else {
            // Дневной режим - показываем луну (переключит на ночной)
            if (sunIcon) sunIcon.style.display = 'none';
            if (moonIcon) moonIcon.style.display = 'inline';
        }
    }
    
    toggleWhiteSuits() {
        this.whiteSuitsEnabled = this.whiteSuitsToggle.checked;
        localStorage.setItem('whiteSuitsEnabled', this.whiteSuitsEnabled);
        
        if (this.whiteSuitsEnabled) {
            document.body.classList.add('white-suits');
        } else {
            document.body.classList.remove('white-suits');
        }
    }
    
    setCardBackColor(color) {
        this.cardBackColor = color;
        localStorage.setItem('cardBackColor', color);
        document.body.setAttribute('data-card-back', color);
        
        // Обновляем выделение в селекторе
        document.querySelectorAll('.card-back-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        const selectedOption = document.querySelector(`.card-back-option[data-back="${color}"]`);
        if (selectedOption) {
            selectedOption.classList.add('selected');
        }
    }

    showAlert(message) {
        if (!this.alertModal || !this.alertText) return;
        this.playSound('alert');
        this.alertText.textContent = message;
        this.alertModal.classList.add('active');
    }
    
    checkReconnect() {
        // Получаем room_id из URL
        const path = window.location.pathname;
        
        // Проверяем формат /room/join/{room_id} (приглашение в приватную комнату)
        let match = path.match(/\/room\/join\/([a-f0-9-]+)/);
        if (match) {
            this.roomId = match[1];
            this.isJoiningViaLink = true;
            // Не проверяем player_id, показываем модалку для ввода никнейма
            this.connect(false);
            return;
        }
        
        // Проверяем формат /room/{room_id} (обычное переподключение)
        match = path.match(/\/room\/([a-f0-9-]+)/);
        if (match) {
            this.roomId = match[1];
            // Получаем player_id из localStorage
            this.playerId = localStorage.getItem(`player_${this.roomId}`);
            
            // Пытаемся переподключиться (даже без player_id, чтобы получить ошибку)
            this.connect(true);
            return;
        }
        
        // Обычное подключение
        this.connect(false);
    }
    
    saveToLocalStorage() {
        if (this.roomId && this.playerId) {
            localStorage.setItem(`player_${this.roomId}`, this.playerId);
        }
    }
    
    clearLocalStorage() {
        if (this.roomId) {
            localStorage.removeItem(`player_${this.roomId}`);
        }
    }
    
    updateURL(roomId) {
        const newUrl = `/room/${roomId}`;
        window.history.pushState({roomId}, '', newUrl);
    }
    
    goToLobby() {
        this.clearLocalStorage();
        
        // Закрываем WebSocket соединение перед перезагрузкой
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
        
        window.history.pushState({}, '', '/');
        
        // Небольшая задержка чтобы сообщение успело отправиться
        setTimeout(() => {
            location.reload();
        }, 40);
    }
    
    initElements() {
        // Screens
        this.lobbyScreen = document.getElementById('lobby-screen');
        this.roomScreen = document.getElementById('room-screen');
        this.errorScreen = document.getElementById('error-screen');
        this.gameScreen = document.getElementById('game-screen');
        
        // Lobby elements
        this.nicknameInput = document.getElementById('nickname-input');
        this.createRoomBtn = document.getElementById('create-room-btn');
        this.roomsList = document.getElementById('rooms-list');
        this.privateRoomToggle = document.getElementById('private-room-toggle');
        this.privateRoomSettings = document.getElementById('private-room-settings');
        this.inviteLinkBlock = document.getElementById('invite-link-block');
        this.inviteLink = document.getElementById('invite-link');
        this.copyLinkBtn = document.getElementById('copy-link-btn');
        this.shareLinkBtn = document.getElementById('share-link-btn');
        this.nightModeToggleBtn = document.getElementById('night-mode-toggle-btn');
        
        // Room elements
        this.playersList = document.getElementById('players-list');
        this.readyToggleBtn = document.getElementById('ready-toggle-btn');
        this.leaveRoomBtn = document.getElementById('leave-room-btn');
        this.roomSettings = document.getElementById('room-settings');
        this.deckSizeToggle = document.getElementById('deck-size-toggle');
        
        // Game elements
        this.deckCount = document.getElementById('deck-count');
        this.discardPile = document.getElementById('discard-pile');
        this.chosenSuitIndicator = document.getElementById('chosen-suit-indicator');
        this.handCards = document.getElementById('hand-cards');
        this.drawCardBtn = document.getElementById('draw-card-btn');
        this.skipTurnBtn = document.getElementById('skip-turn-btn');
        
        // Game state
        this.cardDrawnThisTurn = false;
        this.waitingForEight = false;
        this.eightDrawUsed = false;
        
        // Countdown elements
        this.countdownDisplay = document.getElementById('countdown-display');
        this.countdownNumber = document.getElementById('countdown-number');
        
        // Game log
        this.gameLog = document.getElementById('game-log');
        
        // Modals
        this.suitModal = document.getElementById('suit-modal');
        this.resultsModal = document.getElementById('results-modal');
        this.joinModal = document.getElementById('join-modal');
        this.joinNicknameInput = document.getElementById('join-nickname-input');
        this.joinConfirmBtn = document.getElementById('join-confirm-btn');
        this.joinCancelBtn = document.getElementById('join-cancel-btn');
        this.closeResultsBtn = document.getElementById('close-results-btn');
        this.cancelSuitBtn = document.getElementById('cancel-suit-btn');
        this.alertModal = document.getElementById('alert-modal');
        this.alertText = document.getElementById('alert-text');
        this.alertOkBtn = document.getElementById('alert-ok-btn');
        
        // Chat elements
        this.chatBtn = document.getElementById('chat-btn');
        this.chatModal = document.getElementById('chat-modal');
        this.chatInput = document.getElementById('chat-input');
        this.sendChatBtn = document.getElementById('send-chat-btn');
        this.closeChatBtn = document.getElementById('close-chat-btn');
        
        // Reaction elements
        this.reactionPicker = document.getElementById('reaction-picker');
        this.playerInfo = document.querySelector('.player-info');
        
        // Rules elements
        this.rulesBtn = document.getElementById('rules-btn');
        this.rulesModal = document.getElementById('rules-modal');
        this.rulesContent = document.getElementById('rules-content'); // Модалка
        this.lobbyRulesContent = document.getElementById('lobby-rules-content'); // Главная страница
        this.closeRulesBtn = document.getElementById('close-rules-btn');
        
        // Settings elements
        this.settingsBtn = document.getElementById('settings-btn');
        this.settingsModal = document.getElementById('settings-modal');
        this.closeSettingsBtn = document.getElementById('close-settings-btn');
        this.fullscreenToggle = document.getElementById('fullscreen-toggle');
        this.soundToggle = document.getElementById('sound-toggle');
        this.animationsToggle = document.getElementById('animations-toggle');
        this.proModeToggle = document.getElementById('pro-mode-toggle');
        this.nightModeToggle = document.getElementById('night-mode-toggle');
        this.whiteSuitsToggle = document.getElementById('white-suits-toggle');
        this.whiteSuitsSetting = document.getElementById('white-suits-setting');
        this.logToggle = document.getElementById('log-toggle');
        
        // Leave game button and modal
        this.leaveGameBtn = document.getElementById('leave-game-btn');
        this.leaveConfirmModal = document.getElementById('leave-confirm-modal');
        this.leaveConfirmBtn = document.getElementById('leave-confirm-btn');
        this.leaveCancelBtn = document.getElementById('leave-cancel-btn');
        
        // Bot game buttons
        this.playWith1BotBtn = document.getElementById('play-with-1-bot-btn');
        this.playWith2BotsBtn = document.getElementById('play-with-2-bots-btn');
        this.playWith3BotsBtn = document.getElementById('play-with-3-bots-btn');
        
        // Инициализируем состояние анимаций
        const savedAnimations = localStorage.getItem('animationsEnabled');
        this.animationsEnabled = savedAnimations !== null ? savedAnimations === 'true' : true;
        
        // Инициализируем режим Про
        const savedProMode = localStorage.getItem('proModeEnabled');
        this.proModeEnabled = savedProMode === 'true';
        
        // Инициализируем ночной режим
        const savedNightMode = localStorage.getItem('nightModeEnabled');
        this.nightModeEnabled = savedNightMode === 'true';
        if (this.nightModeEnabled) {
            document.body.classList.add('night-mode');
        }
        
        // Инициализируем белые масти
        const savedWhiteSuits = localStorage.getItem('whiteSuitsEnabled');
        this.whiteSuitsEnabled = savedWhiteSuits === 'true';
        
        // Показываем настройку белых мастей только если ночной режим включен
        if (this.nightModeEnabled && this.whiteSuitsSetting) {
            this.whiteSuitsSetting.style.display = 'flex';
            // Применяем белые масти если они были включены
            if (this.whiteSuitsEnabled) {
                document.body.classList.add('white-suits');
            }
        }
        
        // Инициализируем цвет рубашки карт
        const savedCardBack = localStorage.getItem('cardBackColor') || 'gray';
        this.cardBackColor = savedCardBack;
        document.body.setAttribute('data-card-back', savedCardBack);
        
        // Обновляем иконку кнопки ночного режима
        this.updateNightModeButton();
    }
    
    initEventListeners() {
        this.createRoomBtn.addEventListener('click', () => this.createRoom());
        this.nicknameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.createRoom();
        });
        
        // Private room toggle
        this.privateRoomToggle.addEventListener('change', () => this.togglePrivateRoom());
        
        // Copy and share link buttons
        this.copyLinkBtn.addEventListener('click', () => this.copyInviteLink());
        this.shareLinkBtn.addEventListener('click', () => this.shareInviteLink());
        
        // Show share button if Web Share API is available
        if (navigator.share) {
            this.shareLinkBtn.style.display = 'block';
        }
        
        // Night mode toggle button on lobby
        if (this.nightModeToggleBtn) {
            this.nightModeToggleBtn.addEventListener('click', () => this.toggleNightModeFromButton());
        }
        
        this.readyToggleBtn.addEventListener('click', () => this.toggleReady());
        this.leaveRoomBtn.addEventListener('click', () => this.leaveRoom());
        
        // Deck size toggle
        this.deckSizeToggle.addEventListener('change', () => this.changeDeckSize());
        
        // Bot game buttons
        this.playWith1BotBtn.addEventListener('click', () => this.createBotGame(1));
        this.playWith2BotsBtn.addEventListener('click', () => this.createBotGame(2));
        this.playWith3BotsBtn.addEventListener('click', () => this.createBotGame(3));
        
        this.drawCardBtn.addEventListener('click', () => this.drawCard());
        this.skipTurnBtn.addEventListener('click', () => this.skipTurn());
        
        // Settings modal
        this.settingsBtn.addEventListener('click', () => this.openSettings());
        this.closeSettingsBtn.addEventListener('click', () => this.closeSettings());
        this.fullscreenToggle.addEventListener('change', () => this.toggleFullscreen());
        this.soundToggle.addEventListener('change', () => this.toggleSound());
        this.animationsToggle.addEventListener('change', () => this.toggleAnimations());
        this.proModeToggle.addEventListener('change', () => this.toggleProMode());
        this.nightModeToggle.addEventListener('change', () => this.toggleNightMode());
        this.whiteSuitsToggle.addEventListener('change', () => this.toggleWhiteSuits());
        this.logToggle.addEventListener('change', () => this.toggleLog());
        
        // Leave game button
        this.leaveGameBtn.addEventListener('click', () => this.showLeaveConfirm());
        this.leaveConfirmBtn.addEventListener('click', () => this.confirmLeaveGame());
        this.leaveCancelBtn.addEventListener('click', () => this.cancelLeaveGame());
        
        // Suit selection
        document.querySelectorAll('.suit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const suit = e.currentTarget.dataset.suit;
                this.selectSuit(suit);
            });
        });
        
        this.joinConfirmBtn.addEventListener('click', () => this.confirmJoin());
        this.joinCancelBtn.addEventListener('click', () => this.cancelJoin());
        this.joinNicknameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.confirmJoin();
        });
        
        this.closeResultsBtn.addEventListener('click', () => {
            this.closeResultsModal();
        });
        
        // Chat handlers
        this.chatBtn.addEventListener('click', () => this.openChat());
        this.sendChatBtn.addEventListener('click', () => this.sendChatMessage());
        this.closeChatBtn.addEventListener('click', () => this.closeChat());
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendChatMessage();
            }
        });
        
        // Reaction handlers - клик по блоку с никнеймом
        if (this.playerInfo) {
            this.playerInfo.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showReactionPicker(e);
            });
        }
        
        document.querySelectorAll('.reaction-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const reaction = e.currentTarget.dataset.reaction;
                this.sendReaction(reaction);
                this.hideReactionPicker();
            });
        });
        
        // Закрываем пикер при клике вне его
        document.addEventListener('click', (e) => {
            if (this.reactionPicker && 
                this.reactionPicker.classList.contains('active') &&
                !this.reactionPicker.contains(e.target) &&
                (!this.playerInfo || !this.playerInfo.contains(e.target))) {
                this.hideReactionPicker();
            }
        });
        
        // Card back color selector
        document.querySelectorAll('.card-back-option').forEach(option => {
            option.addEventListener('click', (e) => {
                const backColor = e.currentTarget.dataset.back;
                this.setCardBackColor(backColor);
            });
        });
        
        // Rules handlers
        this.rulesBtn.addEventListener('click', () => this.openRules());
        this.closeRulesBtn.addEventListener('click', () => this.closeRules());
        
        const goHomeBtn = document.getElementById('go-home-btn');
        if (goHomeBtn) {
            goHomeBtn.addEventListener('click', () => this.goToLobby());
        }
        
        // Горячие клавиши
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));

        if (this.alertOkBtn && this.alertModal) {
            this.alertOkBtn.addEventListener('click', () => {
                this.alertModal.classList.remove('active');
            });
        }
        
        if (this.cancelSuitBtn) {
            this.cancelSuitBtn.addEventListener('click', () => {
                this.suitModal.classList.remove('active');
                this.pendingCardToPlay = null;
            });
        }
        
        // Закрытие модалок по клику на фон
        this.setupModalBackdropClose();
    }
    
    setupModalBackdropClose() {
        // Список всех модалок
        const modals = [
            { element: this.settingsModal, closeMethod: () => this.closeSettings() },
            { element: this.resultsModal, closeMethod: () => this.closeResultsModal() },
            { element: this.rulesModal, closeMethod: () => this.closeRules() },
            { element: this.alertModal, closeMethod: () => this.alertModal.classList.remove('active') },
            { element: this.suitModal, closeMethod: () => {
                this.suitModal.classList.remove('active');
                this.pendingCardToPlay = null;
            }},
            { element: this.chatModal, closeMethod: () => this.chatModal.classList.remove('active') },
            { element: this.joinModal, closeMethod: () => this.joinModal.classList.remove('active') },
            { element: this.leaveConfirmModal, closeMethod: () => this.leaveConfirmModal.classList.remove('active') }
        ];
        
        // Добавляем обработчик для каждой модалки
        modals.forEach(modal => {
            if (modal.element) {
                modal.element.addEventListener('click', (e) => {
                    // Закрываем только если клик был по самой модалке (фону), а не по её содержимому
                    if (e.target === modal.element) {
                        modal.closeMethod();
                    }
                });
            }
        });
    }
    
    connect(reconnect = false) {
        // Определяем протокол WebSocket (ws или wss)
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        
        // Проверяем, есть ли кастомный WebSocket домен в meta теге
        const wsHostMeta = document.querySelector('meta[name="ws-host"]');
        let wsUrl;
        
        if (wsHostMeta && wsHostMeta.content) {
            // Используем кастомный домен для WebSocket
            wsUrl = `${wsProtocol}//${wsHostMeta.content}`;
        } else {
            // Используем текущий хост с портом 8765
            wsUrl = `${wsProtocol}//${window.location.hostname}:8765`;
        }
        
        console.log('Connecting to:', wsUrl);
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('Connected to server');
            
            if (reconnect && this.roomId) {
                // Переподключаемся к существующей игре
                // Если нет playerId - сервер вернёт ошибку и покажется экран ошибки
                this.send({ 
                    type: 'reconnect',
                    player_id: this.playerId || 'temp_' + Date.now(),
                    room_id: this.roomId
                });
            } else if (this.isJoiningViaLink && this.roomId) {
                // Переход по ссылке приглашения - показываем модалку для ввода никнейма
                this.joinModal.classList.add('active');
                this.joinNicknameInput.focus();
            } else {
                // Обычное подключение
                this.send({ type: 'get_rooms' });
            }
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            // Показываем алерт только если страница видима и мы не в игре
            const lobbyScreen = document.getElementById('lobby-screen');
            const isOnLobby = lobbyScreen && lobbyScreen.classList.contains('active');
            if (this.pageVisible && isOnLobby) {
                this.showAlert('Ошибка подключения к серверу');
            }
        };
        
        this.ws.onclose = () => {
            console.log('Disconnected from server');
            // Переподключаемся всегда если страница видима, или если мы в игре (даже если скрыта)
            const lobbyScreen = document.getElementById('lobby-screen');
            const isOnLobby = lobbyScreen && lobbyScreen.classList.contains('active');
            
            if (this.pageVisible || !isOnLobby) {
                // Переподключаемся если: страница видима ИЛИ мы в игре (не на лобби)
                setTimeout(() => this.connect(), 3000);
            }
        };
    }
    
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
    
    handleMessage(data) {
        // console.log('Received:', data); // Закомментировано для производительности
        
        switch (data.type) {
            case 'rooms_list':
                this.updateRoomsList(data.rooms);
                break;
            case 'room_created':
                this.playerId = data.player_id;
                this.roomId = data.room_id;
                this.currentRoom = data.room;
                this.saveToLocalStorage();
                this.updateURL(this.roomId);
                
                this.showScreen('room');
                this.updatePlayersInRoom(data.room.players);
                this.updateRoomSettings(data.room);
                break;
            case 'room_joined':
                this.playerId = data.player_id;
                this.roomId = data.room_id;
                this.currentRoom = data.room;
                this.saveToLocalStorage();
                this.updateURL(this.roomId);
                this.showScreen('room');
                this.updatePlayersInRoom(data.room.players);
                this.updateRoomSettings(data.room);
                break;
            case 'player_joined':
                if (this.currentRoom) {
                    this.currentRoom.players.push(data.player);
                    this.updatePlayersInRoom(this.currentRoom.players);
                }
                break;
            case 'player_left':
                if (this.currentRoom) {
                    this.currentRoom.players = this.currentRoom.players.filter(
                        p => p.id !== data.player_id
                    );
                    this.updatePlayersInRoom(this.currentRoom.players);
                }
                break;
            case 'player_ready_changed':
                if (this.currentRoom) {
                    const player = this.currentRoom.players.find(p => p.id === data.player_id);
                    if (player) {
                        player.ready = data.ready;
                        this.updatePlayersInRoom(this.currentRoom.players);
                    }
                }
                break;
            case 'room_updated':
                this.currentRoom = data.room;
                this.updatePlayersInRoom(data.room.players);
                break;
            case 'game_started':
                // Проверяем это переподключение или новая игра
                // Если мы на экране комнаты или лобби - это новая игра
                // Если мы на экране игры - это переподключение
                const isReconnect = this.gameScreen.classList.contains('active') || 
                                   (this.hand && this.hand.length > 0 && !this.roomScreen.classList.contains('active'));
                
                this.hand = data.hand;
                this.currentPlayerId = data.current_player;
                this.dealerId = data.dealer;
                this.deckCount.textContent = data.deck_count;
                this.waitingForEight = data.waiting_for_eight || false;
                this.eightDrawUsed = data.eight_draw_used || false;
                this.eightDrawnCards = data.eight_drawn_cards || [];
                this.cardDrawnThisTurn = data.card_drawn_this_turn || false;
                
                if (!isReconnect) {
                    // Новая игра - очищаем лог и добавляем сообщение
                    this.clearLog();
                    this.addLogEntry('Игра началась!');
                    
                    // Воспроизводим звук если игра началась со специальной карты
                    if (data.top_card) {
                        const rank = data.top_card.rank;
                        const deckSize = data.deck_size || 52;
                        if (rank === 'A') {
                            this.playSound('ace');
                        } else if (rank === '8' && deckSize === 52) {
                            // Восьмёрка только в режиме 52 карт
                            this.playSound('eightplace');
                        } else if (rank === '6') {
                            this.playSound('six');
                        } else if (rank === '7') {
                            this.playSound('seven');
                        } else if (rank === 'Q') {
                            this.playSound('change');
                        }
                    }
                    
                    // Если кто-то принудительно взял карты при старте (6 или 7)
                    if (data.forced_draw_player_id && data.forced_draw_count > 0) {
                        // Анимация принудительного взятия карт при старте игры
                        // Задержка чтобы элементы успели отрендериться
                        setTimeout(() => {
                            this.animateDrawCards(data.forced_draw_player_id, data.forced_draw_count);
                        }, 300);
                        
                        const cardName = `${data.top_card.rank}${this.getSuitSymbolForLog(data.top_card.suit)}`;
                        const cardsText = data.forced_draw_count === 1 ? '1 карту' : `${data.forced_draw_count} карты`;
                        this.addLogEntry(`${data.forced_draw_player_nickname} взял ${cardsText} от ${cardName}`);
                    }
                } else {
                    // Переподключение - просто добавляем сообщение в лог
                    this.addLogEntry('Вы переподключились');
                }
                
                this.hideCountdown();
                this.showScreen('game');
                this.updateGameState(data);
                
                // Скрываем настройки комнаты когда игра началась
                if (this.roomSettings) {
                    this.roomSettings.style.display = 'none';
                }
                break;
            case 'card_played':
                // Сохраняем старое значение waiting_for_eight перед обновлением
                const wasWaitingForEight = this.waitingForEight;
                
                // Анимация полета карты от игрока к столу
                if (data.player_id) {
                    this.animatePlayCard(data.player_id);
                }
                
                this.hand = data.hand;
                this.currentPlayerId = data.current_player;
                this.deckCount.textContent = data.deck_count;
                this.cardDrawnThisTurn = data.card_drawn_this_turn || false;
                this.waitingForEight = data.waiting_for_eight || false;
                this.eightDrawUsed = data.eight_draw_used || false;
                this.eightDrawnCards = data.eight_drawn_cards || [];
                
                // Звук игры карты
                // Специальные карты - звук для всех игроков
                const deckSize = data.deck_size || 52;
                if (data.card.rank === 'A') {
                    this.playSound('playcard');
                    setTimeout(() => this.playSound('ace'), 60);
                } else if (data.card.rank === '8' && deckSize === 52) {
                    // Восьмёрка только в режиме 52 карт
                    this.playSound('eightplace');
                } else if (data.card.rank === '6') {
                    this.playSound('playcard');
                    setTimeout(() => this.playSound('six'), 40);
                } else if (data.card.rank === '7') {
                    this.playSound('playcard');
                    setTimeout(() => this.playSound('seven'), 40);
                } else if (data.card.rank === '2' && data.waiting_for_eight === false && wasWaitingForEight === true) {
                    this.playSound('two');
                } else {
                    this.playSound('playcard');
                }
                
                // Логируем событие
                const cardName = `${data.card.rank} ${this.getSuitSymbolForLog(data.card.suit)}`;
                this.addLogEntry(`${data.player_nickname} сыграл ${cardName}`);
                
                // Если выбрана масть дамой
                if (data.card.rank === 'Q' && data.chosen_suit) {
                    // Звук смены масти для всех игроков
                    this.playSound('change');
                    this.addLogEntry(`${data.player_nickname} назвал ${this.getSuitName(data.chosen_suit)}`);
                }
                
                // Если кто-то принудительно взял карты (6 или 7)
                if (data.forced_draw_player_id && data.forced_draw_count > 0) {
                    // Анимация принудительного взятия карт
                    this.animateDrawCards(data.forced_draw_player_id, data.forced_draw_count);
                    
                    const cardsText = data.forced_draw_count === 1 ? '1 карту' : `${data.forced_draw_count} карты`;
                    this.addLogEntry(`${data.forced_draw_player_nickname} взял ${cardsText} от ${cardName}`);
                }
                
                this.updateGameState(data);
                break;
            case 'card_drawn':
                // Анимация взятия карт из колоды
                if (data.player_id && data.cards_count) {
                    this.animateDrawCards(data.player_id, data.cards_count);
                }
                
                this.hand = data.hand;
                this.currentPlayerId = data.current_player;
                this.deckCount.textContent = data.deck_count;
                this.cardDrawnThisTurn = data.card_drawn_this_turn || false;
                this.waitingForEight = data.waiting_for_eight || false;
                this.eightDrawUsed = data.eight_draw_used || false;
                this.eightDrawnCards = data.eight_drawn_cards || [];
                
                // Звук взятия карты
                if (data.waiting_for_eight) {
                    this.playSound('eight');
                } else {
                    this.playSound('drawcard');
                }
                
                // Логируем событие
                const cardsText = data.cards_count === 1 ? '1 карту' : `${data.cards_count} карты`;
                if (data.waiting_for_eight) {
                    const topCard = data.top_card;
                    this.addLogEntry(`${data.player_nickname} взял ${cardsText} от ${topCard.rank} ${this.getSuitSymbolForLog(topCard.suit)}`);
                } else {
                    const cardsText = data.cards_count === 1 ? 'карту' : 'карты';
                    this.addLogEntry(`${data.player_nickname} взял ${data.cards_count} ${cardsText}`);
                }
                
                this.updateGameState(data);
                break;
            case 'turn_skipped':
                this.hand = data.hand;
                this.currentPlayerId = data.current_player;
                this.cardDrawnThisTurn = false;
                this.waitingForEight = data.waiting_for_eight || false;
                this.eightDrawUsed = data.eight_draw_used || false;
                this.eightDrawnCards = data.eight_drawn_cards || [];
                
                // Звук пропуска хода (для всех игроков)
                this.playSound('skip');
                
                // Логируем пропуск хода
                if (data.log_message) {
                    this.addLogEntry(data.log_message);
                }
                
                this.updateGameState(data);
                break;
            case 'deck_shuffled':
                // Анимация перемешивания колоды
                this.animateDeckShuffle();
                
                // Звук перемешивания колоды (для всех игроков)
                this.playSound('shuffle');
                
                // Логируем перемешивание колоды
                if (data.log_message) {
                    this.addLogEntry(data.log_message);
                }
                break;
            case 'chat_message':
                // Отображаем сообщение в логе с выделением
                if (data.message) {
                    // Звук чата для всех
                    this.playSound('chat');
                    
                    // Определяем класс для сообщения
                    let chatClass = 'chat-other';
                    if (data.player_id === this.playerId) {
                        chatClass = 'chat-player';
                    } else {
                        // Для других игроков назначаем цвет по их ID
                        const colorIndex = this.getPlayerColorIndex(data.player_id);
                        chatClass = `chat-other chat-color-${colorIndex}`;
                    }
                    
                    this.addLogEntry(data.message, chatClass);
                }
                break;
            case 'game_ended':
                this.showResults(data);
                break;
            case 'player_kicked':
                // Игрок вылетел из комнаты (набрал >101)
                if (data.player_id === this.playerId) {
                    // Это мы вылетели
                    this.showAlert(`Вы набрали больше 101 очка и выбыли из игры`);
                    setTimeout(() => this.goToLobby(), 6000);
                } else {
                    // Другой игрок вылетел
                    this.addLogEntry(`${data.player_nickname} выбыл (>101 очка)`);
                    if (this.currentRoom) {
                        this.currentRoom.players = this.currentRoom.players.filter(
                            p => p.id !== data.player_id
                        );
                        this.updatePlayersInRoom(this.currentRoom.players);
                    }
                }
                break;
            case 'final_winner':
                // Финальная победа - комната закрывается
                const winnerText = data.winner_id === this.playerId 
                    ? 'Поздравляем! Вы победили!' 
                    : `Победитель: ${data.winner_nickname}`;
                this.showAlert(winnerText);
                setTimeout(() => this.goToLobby(), 6000);
                break;
            case 'countdown_tick':
                this.showCountdown(data.seconds);
                break;
            case 'countdown_cancelled':
                this.hideCountdown();
                break;
            case 'player_disconnected':
                // Игрок временно отключился
                this.addLogEntry(`${data.nickname} отключился`);
                break;
            case 'player_reconnected':
                // Игрок переподключился
                this.addLogEntry(`${data.nickname} переподключился`);
                break;
            case 'shake_discard':
                // Тряска карты сброса
                this.animateShakeDiscard();
                this.playSound('alert');
                break;
            case 'reaction':
                // Быстрая реакция от игрока
                // Используем маппинг звуков для реакций
                const soundName = this.reactionSounds[data.emoji] || 'chat';
                this.playSound(soundName);
                this.showReactionBubble(data.player_id, data.emoji);
                break;
            case 'deck_size_changed':
                // Размер колоды изменён
                if (this.currentRoom) {
                    this.currentRoom.deck_size = data.deck_size;
                }
                this.deckSizeToggle.checked = data.deck_size === 52;
                this.addLogEntry(`Размер колоды карт: ${data.deck_size}`);
                break;
            case 'room_closed':
                // Комната закрыта создателем
                this.showAlert(data.message);
                setTimeout(() => this.goToLobby(), 3000);
                break;
            case 'error':
                // Обрабатываем ошибки по кодам
                if (data.error_code === 'room_not_found' || 
                    data.error_code === 'game_started' || 
                    data.error_code === 'player_not_found') {
                    // Ссылка недействительна или комната не существует - показываем экран ошибки
                    this.showError(data.message);
                    // Очищаем данные
                    this.isJoiningViaLink = false;
                    this.roomId = null;
                    this.clearLocalStorage();
                } else if (data.message.includes('not found') || data.message.includes('не найден')) {
                    this.showError(data.message);
                } else {
                    this.showAlert(data.message);
                }
                break;
        }
    }
    
    showScreen(screen) {
        this.lobbyScreen.classList.remove('active');
        this.roomScreen.classList.remove('active');
        this.errorScreen.classList.remove('active');
        this.gameScreen.classList.remove('active');
        
        if (screen === 'lobby') {
            this.lobbyScreen.classList.add('active');
        } else if (screen === 'room') {
            this.roomScreen.classList.add('active');
        } else if (screen === 'error') {
            this.errorScreen.classList.add('active');
        } else if (screen === 'game') {
            this.gameScreen.classList.add('active');
        }
    }
    
    showError(message) {
        const errorMessage = document.getElementById('error-message');
        if (errorMessage) {
            errorMessage.textContent = message;
        }
        this.showScreen('error');
    }
    
    createRoom() {
        const nickname = this.nicknameInput.value.trim();
        if (!nickname) {
            this.showAlert('Введите никнейм');
            return;
        }
        
        this.send({
            type: 'create_room',
            nickname: nickname,
            is_private: false  // По умолчанию не приватная
        });
    }
    
    togglePrivateRoom() {
        const isChecked = this.privateRoomToggle.checked;
        
        // Отправляем на сервер изменение приватности
        this.send({
            type: 'toggle_private',
            is_private: isChecked
        });
        
        // Показываем/скрываем блок со ссылкой
        if (isChecked) {
            this.inviteLinkBlock.style.display = 'block';
            // Генерируем ссылку если её ещё нет
            if (!this.inviteLink.textContent && this.roomId) {
                const inviteUrl = `${window.location.origin}/room/join/${this.roomId}`;
                this.inviteLink.textContent = inviteUrl;
            }
        } else {
            this.inviteLinkBlock.style.display = 'none';
        }
    }
    
    copyInviteLink() {
        const link = this.inviteLink.textContent;
        navigator.clipboard.writeText(link).then(() => {
            // Временно меняем иконку на галочку
            const originalHTML = this.copyLinkBtn.innerHTML;
            this.copyLinkBtn.textContent = '✓';
            setTimeout(() => {
                this.copyLinkBtn.innerHTML = originalHTML;
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy:', err);
            this.showAlert('Не удалось скопировать ссылку');
        });
    }
    
    async shareInviteLink() {
        const link = this.inviteLink.textContent;
        try {
            await navigator.share({
                title: 'Погнали в чешского!',
                text: 'Присоединяйся к комнате:',
                url: link
            });
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Failed to share:', err);
            }
        }
    }
    
    createBotGame(botCount) {
        const nickname = this.nicknameInput.value.trim();
        if (!nickname) {
            this.showAlert('Введите никнейм');
            return;
        }
        
        this.send({
            type: 'create_bot_game',
            nickname: nickname,
            bot_count: botCount
        });
    }
    
    updateRoomsList(rooms) {
        this.roomsList.innerHTML = '';
        
        if (rooms.length === 0) {
            this.roomsList.innerHTML = '<p style="color: #666;">Нет доступных комнат</p>';
            return;
        }
        
        rooms.forEach(room => {
            const roomCard = document.createElement('div');
            const isFull = room.player_count >= 4;
            
            roomCard.className = 'room-card' + (isFull ? ' room-full' : '');
            roomCard.innerHTML = `
                <h4>Комната</h4>
                <p>Игроков: ${room.player_count}/4</p>
                <p>Статус: ${isFull ? 'Полная' : 'Ожидание'}</p>
            `;
            
            if (!isFull) {
                roomCard.addEventListener('click', () => this.showJoinModal(room.id));
            }
            
            this.roomsList.appendChild(roomCard);
        });
    }
    
    showJoinModal(roomId) {
        this.pendingRoomId = roomId;
        this.joinModal.classList.add('active');
        this.joinNicknameInput.value = '';
        this.joinNicknameInput.focus();
    }
    
    confirmJoin() {
        const nickname = this.joinNicknameInput.value.trim();
        if (!nickname) {
            this.showAlert('Введите никнейм');
            return;
        }
        
        // Используем roomId если присоединяемся по ссылке, иначе pendingRoomId
        const roomId = this.isJoiningViaLink ? this.roomId : this.pendingRoomId;
        
        this.send({
            type: 'join_room',
            room_id: roomId,
            nickname: nickname
        });
        
        this.joinModal.classList.remove('active');
        
        // Сбрасываем флаг после присоединения
        this.isJoiningViaLink = false;
    }
    
    cancelJoin() {
        this.joinModal.classList.remove('active');
    }
    
    updatePlayersInRoom(players) {
        this.playersList.innerHTML = '';
        
        players.forEach(player => {
            const playerCard = document.createElement('div');
            playerCard.className = 'player-card';
            if (player.ready) {
                playerCard.classList.add('ready');
            }
            
            playerCard.innerHTML = `
                <h4>${player.nickname} ${player.id === this.playerId ? '(Вы)' : ''}</h4>
                <p class="score">Очки: ${player.score || 0}</p>
                <p class="status">${player.ready ? '✓ Готов' : 'Не готов'}</p>
            `;
            
            this.playersList.appendChild(playerCard);
        });
    }
    
    toggleReady() {
        this.send({ type: 'toggle_ready' });
    }
    
    leaveRoom() {
        // Отправляем сообщение о выходе из комнаты
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.send({ type: 'leave_room' });
        }
        
        // Скрываем блок с ссылкой если он был показан
        if (this.inviteLinkBlock) {
            this.inviteLinkBlock.style.display = 'none';
        }
        // Сбрасываем переключатель приватной комнаты
        if (this.privateRoomToggle) {
            this.privateRoomToggle.checked = false;
        }
        this.goToLobby();
    }
    
    changeDeckSize() {
        const deckSize = this.deckSizeToggle.checked ? 52 : 36;
        this.send({
            type: 'change_deck_size',
            deck_size: deckSize
        });
    }
    
    updateRoomSettings(room) {
        // Показываем настройки только создателю комнаты и только до начала первого раунда
        const isCreator = room.creator_id === this.playerId;
        const gameNotStarted = !room.game_started;
        
        // Проверяем что ни у кого нет очков (игра ещё не начиналась ни разу)
        // Это ключевая проверка - между раундами game_started=false, но очки уже есть
        const noScores = room.players.every(p => p.score === 0);
        
        // Проверяем есть ли боты в комнате
        const hasBot = room.players.some(p => p.is_bot);
        
        // Настройки комнаты (переключатель 36/52) показываем только до первого раунда
        const shouldShow = isCreator && gameNotStarted && noScores;
        
        this.roomSettings.style.display = shouldShow ? 'block' : 'none';
        
        // Блок приватной комнаты показываем ТОЛЬКО при создании комнаты (noScores) и без ботов
        // Между раундами он не должен показываться, даже если game_started=false
        if (this.privateRoomSettings) {
            this.privateRoomSettings.style.display = (shouldShow && !hasBot) ? 'block' : 'none';
        }
        
        // Устанавливаем текущий размер колоды
        if (room.deck_size) {
            this.deckSizeToggle.checked = room.deck_size === 52;
        }
    }
    
    showLeaveConfirm() {
        this.leaveConfirmModal.classList.add('active');
    }
    
    confirmLeaveGame() {
        this.leaveConfirmModal.classList.remove('active');
        this.goToLobby();
    }
    
    cancelLeaveGame() {
        this.leaveConfirmModal.classList.remove('active');
    }
    
    updateGameState(data) {
        // Update top card
        this.discardPile.innerHTML = '';
        if (data.top_card) {
            const cardElement = this.createCardElement(data.top_card, false);
            cardElement.style.cursor = 'pointer';
            cardElement.addEventListener('click', () => this.shakeDiscardPile());
            this.discardPile.appendChild(cardElement);
        }
        
        // Update chosen suit indicator
        // Показываем индикатор всегда когда есть выбранная масть (после дамы)
        if (data.chosen_suit) {
            this.chosenSuitIndicator.style.display = 'block';
            const suitEmoji = this.getSuitSymbol(data.chosen_suit);
            const suitClass = data.chosen_suit; // hearts, diamonds, clubs, spades
            this.chosenSuitIndicator.innerHTML = `<span class="suit-emoji-indicator ${suitClass}">${suitEmoji}</span>`;
        } else {
            this.chosenSuitIndicator.style.display = 'none';
        }
        
        // Update player info
        const currentPlayer = data.players.find(p => p.id === this.playerId);
        if (currentPlayer) {
            document.getElementById('player-name').textContent = currentPlayer.nickname;
            document.getElementById('player-score').textContent = `Очки: ${currentPlayer.score}`;
        }
        
        // Update opponents around the table
        this.updateOpponents(data.players, this.currentPlayerId);
        
        // Update hand
        this.updateHand(data.top_card, data.chosen_suit);
        
        // Управление кнопками
        const isMyTurn = this.currentPlayerId === this.playerId;
        
        if (isMyTurn) {
            if (this.waitingForEight) {
                // При восьмёрке - только кнопка взятия карты
                // Пропуск хода невозможен - нужно брать карты
                this.drawCardBtn.style.display = 'block';
                // Отключаем кнопку если взятие уже использовано
                this.drawCardBtn.disabled = this.eightDrawUsed;
                this.skipTurnBtn.style.display = 'none';
            } else if (this.cardDrawnThisTurn) {
                // Карта уже взята - скрываем кнопку взятия, показываем пропуск
                // Игрок может играть карты или пропустить ход
                this.drawCardBtn.style.display = 'none';
                this.skipTurnBtn.style.display = 'block';
                this.skipTurnBtn.disabled = false;
            } else {
                // Карта не взята - показываем только кнопку взятия
                this.drawCardBtn.style.display = 'block';
                this.drawCardBtn.disabled = false;
                this.skipTurnBtn.style.display = 'none';
            }
        } else {
            // Не наш ход - отключаем все кнопки
            this.drawCardBtn.style.display = 'block';
            this.drawCardBtn.disabled = true;
            this.skipTurnBtn.style.display = 'none';
        }
    }
    
    updateOpponents(players, currentPlayerId) {
        // Скрываем все позиции
        const opponentTop = document.getElementById('opponent-top');
        const opponentLeft = document.getElementById('opponent-left');
        const opponentRight = document.getElementById('opponent-right');
        
        opponentTop.style.display = 'none';
        opponentLeft.style.display = 'none';
        opponentRight.style.display = 'none';
        
        // Убираем подсветку со всех
        opponentTop.classList.remove('current-turn');
        opponentLeft.classList.remove('current-turn');
        opponentRight.classList.remove('current-turn');
        
        // Получаем противников (все кроме нас)
        // Сортируем их в порядке хода (по часовой стрелке от нас)
        const myIndex = players.findIndex(p => p.id === this.playerId);
        const opponents = [];
        
        for (let i = 1; i < players.length; i++) {
            const opponentIndex = (myIndex + i) % players.length;
            opponents.push(players[opponentIndex]);
        }
        
        if (opponents.length === 0) return;
        
        // Получаем контейнер для противников
        const opponentsContainer = document.getElementById('opponents-container');
        
        // Выбираем позиции в зависимости от количества противников
        let positions;
        if (opponents.length === 1) {
            // Один противник - только центр
            positions = [opponentTop];
            opponentsContainer.className = 'opponents-1';
        } else if (opponents.length === 2) {
            // Два противника - слева и справа
            positions = [opponentLeft, opponentRight];
            opponentsContainer.className = 'opponents-2';
        } else {
            // Три противника - слева, центр, справа
            positions = [opponentLeft, opponentTop, opponentRight];
            opponentsContainer.className = 'opponents-3';
        }
        
        opponents.forEach((opponent, index) => {
            if (index >= positions.length) return;
            
            const position = positions[index];
            position.style.display = 'flex';
            position.dataset.playerId = opponent.id; // Сохраняем ID игрока для анимаций
            
            const info = position.querySelector('.opponent-info');
            const cardsContainer = position.querySelector('.opponent-cards');
            
            // Обновляем информацию
            info.querySelector('.opponent-name').textContent = opponent.nickname;
            info.querySelector('.opponent-score').textContent = `Очки: ${opponent.score}`;
            
            // Подсвечиваем текущего игрока
            if (opponent.id === currentPlayerId) {
                position.classList.add('current-turn');
            } else {
                position.classList.remove('current-turn');
            }
            
            // Отображаем карты-рубашки
            cardsContainer.innerHTML = '';
            
            // Если игроков больше 2 (т.е. противников больше 1), показываем только одну рубашку с цифрой
            if (opponents.length > 1) {
                const cardBack = document.createElement('div');
                cardBack.className = 'opponent-card single-card';
                cardBack.innerHTML = `
                    <div class="card-back-icon">🎴</div>
                    <div class="card-count">${opponent.hand_count}</div>
                `;
                cardsContainer.appendChild(cardBack);
            } else {
                // Если только 1 противник, показываем все его карты
                for (let i = 0; i < opponent.hand_count; i++) {
                    const cardBack = document.createElement('div');
                    cardBack.className = 'opponent-card';
                    cardBack.textContent = '🎴';
                    cardsContainer.appendChild(cardBack);
                }
            }
        });
        
        // Подсвечиваем наши карты и инфо, если наш ход
        const playerHand = document.querySelector('.player-hand');
        const playerInfo = document.querySelector('.player-info');
        if (currentPlayerId === this.playerId) {
            playerHand.classList.add('current-turn');
            playerInfo.classList.add('current-turn');
        } else {
            playerHand.classList.remove('current-turn');
            playerInfo.classList.remove('current-turn');
        }
    }
    
    updateHand(topCard, chosenSuit) {
        // Сохраняем для использования при переключении режима Про
        this.topCard = topCard;
        this.chosenSuit = chosenSuit;
        
        this.handCards.innerHTML = '';
        
        this.hand.forEach(card => {
            const cardElement = this.createCardElement(card, true);
            
            // Check if card can be played
            const canPlay = this.currentPlayerId === this.playerId && 
                           this.canPlayCard(card, topCard, chosenSuit, this.waitingForEight, this.eightDrawnCards);
            
            if (!canPlay) {
                // В режиме Про карты остаются яркими (не добавляем disabled)
                // В обычном режиме затемняем неподходящие карты
                if (this.proModeEnabled) {
                    cardElement.classList.remove('disabled');
                    // В режиме Про добавляем обработчик клика даже для неподходящих карт
                    cardElement.addEventListener('click', () => this.playCard(card));
                } else {
                    cardElement.classList.add('disabled');
                }
            } else {
                cardElement.classList.remove('disabled');
                cardElement.addEventListener('click', () => this.playCard(card));
            }
            
            this.handCards.appendChild(cardElement);
        });
    }
    
    canPlayCard(card, topCard, chosenSuit, waitingForEight, eightDrawnCards = []) {
        // На восьмёрку можно класть:
        // - Любую двойку (из руки)
        // - Карты взятые из колоды, которые подходят (двойка, дама, восьмёрка или та же масть)
        if (waitingForEight) {
            // Двойка из руки всегда разрешена
            if (card.rank === '2') return true;
            
            // Карты взятые из колоды разрешены, только если они подходят
            if (eightDrawnCards.includes(card.id)) {
                // Проверяем что карта действительно подходит для восьмёрки
                return card.rank === '2' || 
                       card.rank === 'Q' || 
                       card.rank === '8' ||
                       card.suit === topCard.suit;
            }
            
            // Остальные карты заблокированы
            return false;
        }
        
        // Дама может быть положена на любую карту
        if (card.rank === 'Q') return true;
        
        // Если была выбрана масть дамой
        if (chosenSuit) {
            return card.suit === chosenSuit || card.rank === topCard.rank;
        }
        
        // Обычная проверка: масть или номинал
        return card.suit === topCard.suit || card.rank === topCard.rank;
    }
    
    createCardElement(card, clickable) {
        const cardDiv = document.createElement('div');
        cardDiv.className = `card ${card.suit}`;
        
        cardDiv.innerHTML = `
            <div class="card-rank">${card.rank}</div>
            <div class="card-suit">${this.getSuitSymbol(card.suit)}</div>
        `;
        
        return cardDiv;
    }
    
    getSuitSymbol(suit) {
        const symbols = {
            'hearts': '♥️',
            'diamonds': '♦️',
            'clubs': '♣️',
            'spades': '♠️'
        };
        return symbols[suit] || '';
    }
    
    getSuitSymbolForLog(suit) {
        const symbols = {
            'hearts': '<span class="suit-emoji-log hearts">♥️</span>',
            'diamonds': '<span class="suit-emoji-log diamonds">♦️</span>',
            'clubs': '<span class="suit-emoji-log clubs">♣️</span>',
            'spades': '<span class="suit-emoji-log spades">♠️</span>'
        };
        return symbols[suit] || '';
    }
    
    getSuitName(suit) {
        const names = {
            'hearts': 'черви',
            'diamonds': 'бубны',
            'clubs': 'трефы',
            'spades': 'пики'
        };
        return names[suit] || suit;
    }
    
    playCard(card) {
        if (this.currentPlayerId !== this.playerId) {
            return;
        }
        
        // If it's a Queen, check if it's the last card
        if (card.rank === 'Q') {
            // Если это последняя карта - автоматически выбираем пики
            if (this.hand.length === 1) {
                // Отправляем карту с автоматическим выбором пик (игрок выигрывает)
                this.send({
                    type: 'play_card',
                    card_id: card.id,
                    chosen_suit: 'spades'
                });
            } else {
                // Не последняя карта - показываем модалку выбора масти
                this.pendingCardToPlay = card;
                this.suitModal.classList.add('active');
            }
        } else {
            // Отправляем карту без воспроизведения звука
            // Звук будет воспроизведен когда придет событие card_played
            this.send({
                type: 'play_card',
                card_id: card.id
            });
        }
    }
    
    selectSuit(suit) {
        this.suitModal.classList.remove('active');
        
        if (this.pendingCardToPlay) {
            // Отправляем карту без воспроизведения звука
            // Звук будет воспроизведен когда придет событие card_played
            this.send({
                type: 'play_card',
                card_id: this.pendingCardToPlay.id,
                chosen_suit: suit
            });
            this.pendingCardToPlay = null;
        }
    }
    
    drawCard() {
        if (this.currentPlayerId !== this.playerId) {
            return;
        }
        
        this.send({ type: 'draw_card' });
    }
    
    skipTurn() {
        if (this.currentPlayerId !== this.playerId) {
            return;
        }
        
        this.send({
            type: 'skip_turn'
        });
    }
    
    shakeDiscardPile() {
        // Проверяем кулдаун (5 секунд)
        const now = Date.now();
        const cooldown = 5000; // 5 секунд в миллисекундах
        
        if (now - this.lastShakeTime < cooldown) {
            // Просто игнорируем клик если кулдаун активен
            return;
        }
        
        // Обновляем время последней тряски
        this.lastShakeTime = now;
        
        // Отправляем событие тряски на сервер
        this.send({
            type: 'shake_discard'
        });
    }
    
    showCountdown(seconds) {
        this.countdownNumber.textContent = seconds;
        this.countdownDisplay.style.display = 'block';
    }
    
    hideCountdown() {
        this.countdownDisplay.style.display = 'none';
    }
    
    toggleFullscreen() {
        if (this.fullscreenToggle.checked) {
            // Входим в полноэкранный режим
            document.documentElement.requestFullscreen().catch(err => {
                console.log('Error attempting to enable fullscreen:', err);
                this.fullscreenToggle.checked = false;
            });
        } else {
            // Выходим из полноэкранного режима
            if (document.fullscreenElement) {
                document.exitFullscreen();
            }
        }
    }
    
    openSettings() {
        // Синхронизируем состояние переключателей с текущими настройками
        this.soundToggle.checked = this.soundEnabled;
        this.animationsToggle.checked = this.animationsEnabled;
        this.proModeToggle.checked = this.proModeEnabled;
        this.nightModeToggle.checked = this.nightModeEnabled;
        this.whiteSuitsToggle.checked = this.whiteSuitsEnabled;
        this.fullscreenToggle.checked = !!document.fullscreenElement;
        
        // Показываем/скрываем настройку белых мастей в зависимости от ночного режима
        if (this.whiteSuitsSetting) {
            this.whiteSuitsSetting.style.display = this.nightModeEnabled ? 'flex' : 'none';
        }
        
        // Синхронизируем выбранный цвет рубашки
        document.querySelectorAll('.card-back-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        const selectedOption = document.querySelector(`.card-back-option[data-back="${this.cardBackColor}"]`);
        if (selectedOption) {
            selectedOption.classList.add('selected');
        }
        
        // Синхронизируем состояние лога (проверяем есть ли класс hidden)
        if (this.gameLog) {
            this.logToggle.checked = !this.gameLog.classList.contains('hidden');
        }
        
        this.settingsModal.classList.add('active');
    }
    
    closeSettings() {
        this.settingsModal.classList.remove('active');
    }
    
    toggleLog() {
        if (!this.gameLog) return;
        
        if (this.gameLog.classList.contains('hidden')) {
            this.gameLog.classList.remove('hidden');
        } else {
            this.gameLog.classList.add('hidden');
        }
    }
    
    addLogEntry(message, extraClass = '') {
        if (!this.gameLog) return;
        
        const entry = document.createElement('div');
        entry.className = extraClass ? `log-entry ${extraClass}` : 'log-entry';
        entry.innerHTML = message;
        
        // Добавляем в начало (новые сверху)
        this.gameLog.insertBefore(entry, this.gameLog.firstChild);
        
        // Обновляем прозрачность для всех записей
        const entries = this.gameLog.querySelectorAll('.log-entry');
        entries.forEach((e, index) => {
            if (index === 0) {
                e.style.opacity = '1';
            } else {
                // Каждая следующая запись на 15% прозрачнее
                e.style.opacity = Math.max(0.1, 1 - (index * 0.15)).toString();
            }
        });
        
        // Ограничиваем количество записей (максимум 20)
        if (entries.length > 20) {
            this.gameLog.removeChild(entries[entries.length - 1]);
        }
    }
    
    clearLog() {
        if (this.gameLog) {
            this.gameLog.innerHTML = '';
        }
    }
    
    showResults(data) {
        const resultsContent = document.getElementById('results-content');
        resultsContent.innerHTML = '';
        
        // Воспроизводим звук win или lose
        if (data.winner_id === this.playerId) {
            // Проверяем есть ли бонус за даму у победителя
            const winnerResult = data.results.find(r => r.player_id === data.winner_id);
            const hasQueenBonus = winnerResult && winnerResult.queen_bonus && winnerResult.queen_bonus < 0;
            
            // Если победа на даму (есть бонус) - особый звук
            if (hasQueenBonus) {
                this.playSound('winqueen');
                setTimeout(() => this.playSound('win'), 60);
            } else {
                this.playSound('win');
            }
        } else {
            this.playSound('lose');
        }
        
        data.results.forEach(result => {
            const resultItem = document.createElement('div');
            resultItem.className = 'result-item';
            
            if (result.player_id === data.winner_id) {
                resultItem.classList.add('winner');
                
                // Отображаем последнюю карту победителя
                const winningCardHtml = data.winning_card 
                    ? `<div class="result-cards">
                        <div class="result-card ${data.winning_card.suit}">
                            <span class="card-rank">${data.winning_card.rank}</span>
                            <span class="card-suit">${this.getSuitSymbol(data.winning_card.suit)}</span>
                        </div>
                       </div>`
                    : '';
                
                // Текст для бонуса за даму
                const queenBonusText = result.queen_bonus && result.queen_bonus < 0
                    ? `<p style="color: #4caf50; font-weight: bold;">Бонус за даму: ${result.queen_bonus} 👑</p>`
                    : '';
                
                resultItem.innerHTML = `
                    <h4>🏆 ${result.nickname} - ПОБЕДИТЕЛЬ!</h4>
                    <p>Очки за раунд: ${result.points}</p>
                    ${queenBonusText}
                    <p>Всего очков: ${result.total_score}</p>
                    ${winningCardHtml}
                `;
            } else {
                const cardsHtml = result.hand && result.hand.length > 0 
                    ? `<div class="result-cards">
                        ${result.hand.map(card => `
                            <div class="result-card ${card.suit}">
                                <span class="card-rank">${card.rank}</span>
                                <span class="card-suit">${this.getSuitSymbol(card.suit)}</span>
                            </div>
                        `).join('')}
                       </div>`
                    : '';
                
                // Текст для обнуления при 101
                const resetText = result.reset_to_zero
                    ? `<p style="color: #ff9800; font-weight: bold; font-size: 1.1em;">🎯 Ровно 101! Очки обнулены!</p>`
                    : '';
                
                resultItem.innerHTML = `
                    <h4>${result.nickname}</h4>
                    <p>Очки за раунд: +${result.points}</p>
                    ${resetText}
                    <p>Всего очков: ${result.total_score}</p>
                    ${cardsHtml}
                `;
            }
            
            resultsContent.appendChild(resultItem);
        });
        
        this.resultsModal.classList.add('active');
        
        // Добавляем обработчик Enter для закрытия модалки
        this.resultsEnterHandler = (e) => {
            // Проверяем что:
            // 1. Нажат Enter
            // 2. Модалка результатов активна
            // 3. Фокус не на input/textarea (чтобы не мешать другим формам)
            const activeElement = document.activeElement;
            const isInputFocused = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');
            
            if (e.key === 'Enter' && this.resultsModal.classList.contains('active') && !isInputFocused) {
                this.closeResultsModal();
            }
        };
        document.addEventListener('keydown', this.resultsEnterHandler);
    }
    
    closeResultsModal() {
        this.resultsModal.classList.remove('active');
        this.showScreen('room');
        
        // Обновляем настройки комнаты чтобы скрыть блок приватной комнаты после первого раунда
        if (this.currentRoom) {
            this.updateRoomSettings(this.currentRoom);
        }
        
        // Удаляем обработчик Enter
        if (this.resultsEnterHandler) {
            document.removeEventListener('keydown', this.resultsEnterHandler);
            this.resultsEnterHandler = null;
        }
    }
    
    openChat() {
        this.chatModal.classList.add('active');
        this.chatInput.value = '';
        this.chatInput.focus();
    }
    
    closeChat() {
        this.chatModal.classList.remove('active');
        this.chatInput.value = '';
    }
    
    sendChatMessage() {
        const message = this.chatInput.value.trim();
        if (!message) {
            return;
        }
        
        // Отправляем сообщение на сервер
        this.send({
            type: 'chat_message',
            message: message
        });
        
        this.closeChat();
    }
    
    showReactionPicker(e) {
        e.stopPropagation();
        
        if (!this.reactionPicker) return;
        
        // Проверяем кулдаун (5 секунд)
        const now = Date.now();
        const cooldown = 5000; // 5 секунд в миллисекундах
        
        if (now - this.lastReactionTime < cooldown) {
            // Просто игнорируем клик если кулдаун активен
            return;
        }
        
        // Получаем координаты блока руки (.player-hand)
        const playerHand = document.querySelector('.player-hand');
        if (!playerHand) return;
        
        const rect = playerHand.getBoundingClientRect();
        
        // Позиционируем пикер НАД блоком руки по центру
        const vh = window.innerHeight / 100;
        this.reactionPicker.style.left = `${rect.left + rect.width / 2}px`;
        this.reactionPicker.style.transform = 'translateX(-50%)';
        this.reactionPicker.style.top = `${rect.top - 70 - vh}px`; // Над рукой + 1vh выше
        
        this.reactionPicker.classList.add('active');
        
        // Предотвращаем конфликт свайпа с другими элементами
        const scrollContainer = this.reactionPicker.querySelector('.reaction-picker-scroll');
        if (scrollContainer) {
            scrollContainer.addEventListener('touchstart', (e) => {
                e.stopPropagation();
            }, { passive: true, once: false });
            
            scrollContainer.addEventListener('touchmove', (e) => {
                e.stopPropagation();
            }, { passive: true, once: false });
            
            // Drag-скролл мышкой (как на телефоне)
            let isDown = false;
            let startX;
            let scrollLeft;
            let hasMoved = false;
            
            scrollContainer.addEventListener('mousedown', (e) => {
                isDown = true;
                hasMoved = false;
                scrollContainer.style.scrollBehavior = 'auto';
                startX = e.pageX;
                scrollLeft = scrollContainer.scrollLeft;
            });
            
            scrollContainer.addEventListener('mouseleave', () => {
                isDown = false;
                scrollContainer.style.scrollBehavior = 'smooth';
            });
            
            scrollContainer.addEventListener('mouseup', () => {
                isDown = false;
                scrollContainer.style.scrollBehavior = 'smooth';
            });
            
            scrollContainer.addEventListener('mousemove', (e) => {
                if (!isDown) return;
                e.preventDefault();
                const x = e.pageX;
                const walk = x - startX;
                
                // Если сдвинули больше чем на 5px, считаем это скроллом
                if (Math.abs(walk) > 5) {
                    hasMoved = true;
                }
                
                scrollContainer.scrollLeft = scrollLeft - walk;
            });
            
            // Предотвращаем клик на кнопках если был скролл
            scrollContainer.addEventListener('click', (e) => {
                if (hasMoved) {
                    e.preventDefault();
                    e.stopPropagation();
                    hasMoved = false;
                }
            }, true);
            
            // Скролл колёсиком мыши по горизонтали
            scrollContainer.addEventListener('wheel', (e) => {
                e.preventDefault();
                scrollContainer.scrollLeft += e.deltaY * 2.42; // Ускоряем скролл в 2 раза
            }, { passive: false });
        }
    }
    
    hideReactionPicker() {
        if (this.reactionPicker) {
            this.reactionPicker.classList.remove('active');
        }
    }
    
    sendReaction(emoji) {
        // Обновляем время последней реакции
        this.lastReactionTime = Date.now();
        
        this.send({
            type: 'reaction',
            emoji: emoji
        });
    }
    
    showReactionBubble(playerId, emoji) {
        // Находим область игрока
        let targetElement;
        if (playerId === this.playerId) {
            // Реакция от нас самих - показываем над нашими картами
            targetElement = this.handCards;
        } else {
            // Реакция от противника - находим блок с ником и очками
            const opponentArea = this.getOpponentAreaById(playerId);
            if (opponentArea) {
                // Берём блок opponent-info (ник и очки) для центрирования
                targetElement = opponentArea.querySelector('.opponent-info');
            }
        }
        
        if (!targetElement) return;
        
        // Создаём пузырёк
        const bubble = document.createElement('div');
        bubble.className = 'reaction-bubble';
        bubble.textContent = emoji;
        
        // Позиционируем пузырёк и добавляем стрелочку
        const rect = targetElement.getBoundingClientRect();
        bubble.style.left = `${rect.left + rect.width / 2}px`; // Центр элемента
        bubble.style.transform = 'translateX(-50%)'; // Центрируем пузырёк
        
        if (playerId === this.playerId) {
            // Наш пузырёк - НАД картами, стрелка ВНИЗ на наши карты
            bubble.style.top = `${rect.top - 70}px`;
            bubble.classList.add('from-me');
        } else {
            // Пузырёк противника - ПОД блоком с ником, стрелка ВВЕРХ
            bubble.style.top = `${rect.bottom + 10}px`;
            bubble.classList.add('from-opponent');
        }
        
        document.body.appendChild(bubble);
        
        // Удаляем пузырёк после анимации
        setTimeout(() => {
            bubble.remove();
        }, 2000);
    }
    
    handleKeyPress(e) {
        // Проверяем что мы не в поле ввода (кроме чата)
        const isInInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
        const isChatInput = e.target === this.chatInput;
        
        // T (или Е на русской раскладке) - открыть чат
        if ((e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') && !isInInput) {
            e.preventDefault();
            this.openChat();
            return;
        }
        
        // Enter в чате - отправить сообщение (уже обработано в chatInput.addEventListener)
        
        // Пробел - Взять/Нету (только если чат закрыт и не в других полях ввода)
        if (e.key === ' ' && !isInInput && !this.chatModal.classList.contains('active')) {
            e.preventDefault();
            
            // Проверяем что мы на экране игры и это наш ход
            const gameScreen = document.getElementById('game-screen');
            if (!gameScreen || !gameScreen.classList.contains('active')) {
                return;
            }
            
            if (this.currentPlayerId !== this.playerId) {
                return;
            }
            
            // Если кнопка "Взять" видима и активна - нажимаем её
            if (this.drawCardBtn.style.display !== 'none' && !this.drawCardBtn.disabled) {
                this.drawCard();
            }
            // Если кнопка "Нету" видима и активна - нажимаем её
            else if (this.skipTurnBtn.style.display !== 'none' && !this.skipTurnBtn.disabled) {
                this.skipTurn();
            }
        }
    }
    
    async openRules() {
        // Загружаем правила если еще не загружены
        if (!this.rulesContent.innerHTML) {
            await this.loadRules();
        }
        this.rulesModal.classList.add('active');
    }
    
    closeRules() {
        this.rulesModal.classList.remove('active');
    }
    
    async loadRules() {
        try {
            const response = await fetch('/rules.md');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const markdown = await response.text();
            
            // Рендерим markdown в HTML
            let htmlContent;
            if (typeof marked !== 'undefined') {
                htmlContent = marked.parse(markdown);
            } else {
                console.error('marked.js not loaded');
                // Показываем как обычный текст если marked не загружен
                htmlContent = `<pre style="white-space: pre-wrap;">${markdown}</pre>`;
            }
            
            // Загружаем в оба контейнера
            if (this.lobbyRulesContent) {
                this.lobbyRulesContent.innerHTML = htmlContent;
            }
            if (this.rulesContent) {
                this.rulesContent.innerHTML = htmlContent;
            }
        } catch (error) {
            console.error('Failed to load rules:', error);
            const errorHtml = `<p>Не удалось загрузить правила игры.</p><p>Ошибка: ${error.message}</p>`;
            if (this.lobbyRulesContent) {
                this.lobbyRulesContent.innerHTML = errorHtml;
            }
            if (this.rulesContent) {
                this.rulesContent.innerHTML = errorHtml;
            }
        }
    }
    
    initPWA() {
        // Слушаем событие beforeinstallprompt
        window.addEventListener('beforeinstallprompt', (e) => {
            // Не предотвращаем - позволяем браузеру показать стандартный баннер
            console.log('PWA install prompt available');
        });
        
        // Слушаем успешную установку
        window.addEventListener('appinstalled', () => {
            console.log('PWA installed successfully');
        });
    }
    
    // Анимация полета карты от точки A до точки B
    animateFlyingCard(fromElement, toElement, count = 1, delay = 0) {
        // Проверяем включены ли анимации
        if (!this.animationsEnabled) return;
        
        setTimeout(() => {
            for (let i = 0; i < count; i++) {
                setTimeout(() => {
                    const flyingCard = document.createElement('div');
                    flyingCard.className = 'flying-card';
                    flyingCard.textContent = '🎴';
                    
                    // Получаем координаты начальной и конечной точек
                    const fromRect = fromElement.getBoundingClientRect();
                    const toRect = toElement.getBoundingClientRect();
                    
                    // Устанавливаем начальную позицию
                    flyingCard.style.left = `${fromRect.left + fromRect.width / 2 - 30}px`;
                    flyingCard.style.top = `${fromRect.top + fromRect.height / 2 - 42.5}px`;
                    
                    document.body.appendChild(flyingCard);
                    
                    // Запускаем анимацию после небольшой задержки для корректного рендера
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            // Перемещаем к конечной точке
                            flyingCard.style.left = `${toRect.left + toRect.width / 2 - 30}px`;
                            flyingCard.style.top = `${toRect.top + toRect.height / 2 - 42.5}px`;
                            flyingCard.classList.add('arrived');
                            
                            // Удаляем элемент после завершения анимации
                            setTimeout(() => {
                                flyingCard.remove();
                            }, 400);
                        });
                    });
                }, i * 100); // Задержка между картами
            }
        }, delay);
    }
    
    // Анимация игры карты от игрока к столу
    animatePlayCard(playerId) {
        const discardPile = this.discardPile;
        
        if (playerId === this.playerId) {
            // От нашей руки к столу
            const handCards = this.handCards;
            if (handCards && handCards.children.length > 0) {
                this.animateFlyingCard(handCards, discardPile);
            }
        } else {
            // От противника к столу
            const opponentArea = this.getOpponentAreaById(playerId);
            if (opponentArea) {
                const opponentCards = opponentArea.querySelector('.opponent-cards');
                if (opponentCards) {
                    this.animateFlyingCard(opponentCards, discardPile);
                }
            }
        }
    }
    
    // Анимация взятия карт из колоды
    animateDrawCards(playerId, count) {
        const deck = document.getElementById('deck');
        
        if (playerId === this.playerId) {
            // К нашей руке
            const handCards = this.handCards;
            if (handCards && deck) {
                this.animateFlyingCard(deck, handCards, count);
            }
        } else {
            // К противнику
            const opponentArea = this.getOpponentAreaById(playerId);
            if (opponentArea && deck) {
                const opponentCards = opponentArea.querySelector('.opponent-cards');
                if (opponentCards) {
                    this.animateFlyingCard(deck, opponentCards, count);
                }
            }
        }
    }
    
    // Получить область противника по ID
    getOpponentAreaById(playerId) {
        const opponents = ['opponent-left', 'opponent-top', 'opponent-right'];
        for (const opponentId of opponents) {
            const area = document.getElementById(opponentId);
            if (area && area.dataset.playerId === playerId) {
                return area;
            }
        }
        return null;
    }
    
    // Анимация перемешивания колоды (карты летят из сброса в колоду)
    animateDeckShuffle() {
        // Проверяем включены ли анимации
        if (!this.animationsEnabled) return;
        
        const discardPile = this.discardPile;
        const deck = document.getElementById('deck');
        
        if (!discardPile || !deck) return;
        
        // Создаём несколько летящих карт для эффекта перемешивания
        const cardCount = 8; // Количество визуальных карт для эффекта
        
        for (let i = 0; i < cardCount; i++) {
            setTimeout(() => {
                const flyingCard = document.createElement('div');
                flyingCard.className = 'flying-card';
                flyingCard.textContent = '🎴';
                
                // Получаем координаты сброса и колоды
                const fromRect = discardPile.getBoundingClientRect();
                const toRect = deck.getBoundingClientRect();
                
                // Устанавливаем начальную позицию (от сброса)
                flyingCard.style.left = `${fromRect.left + fromRect.width / 2 - 30}px`;
                flyingCard.style.top = `${fromRect.top + fromRect.height / 2 - 42.5}px`;
                
                document.body.appendChild(flyingCard);
                
                // Запускаем анимацию
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        // Перемещаем к колоде
                        flyingCard.style.left = `${toRect.left + toRect.width / 2 - 30}px`;
                        flyingCard.style.top = `${toRect.top + toRect.height / 2 - 42.5}px`;
                        flyingCard.classList.add('arrived');
                        
                        // Удаляем элемент после завершения анимации
                        setTimeout(() => {
                            flyingCard.remove();
                        }, 400);
                    });
                });
            }, i * 80); // Задержка между картами
        }
        
        // Добавляем эффект тряски колоды
        setTimeout(() => {
            deck.classList.add('deck-shuffling');
            setTimeout(() => {
                deck.classList.remove('deck-shuffling');
            }, 600);
        }, cardCount * 80);
    }
    
    // Анимация тряски карты сброса
    animateShakeDiscard() {
        if (!this.discardPile) return;
        
        // Добавляем класс для анимации тряски
        this.discardPile.classList.add('shaking');
        
        // Убираем класс после завершения анимации
        setTimeout(() => {
            this.discardPile.classList.remove('shaking');
        }, 500);
    }
    
    getPlayerColorIndex(playerId) {
        // Создаем простой хеш из ID игрока для определения цвета
        // Возвращаем число от 1 до 3 для разных цветов
        if (!this.playerColorMap) {
            this.playerColorMap = {};
            this.nextColorIndex = 1;
        }
        
        if (!this.playerColorMap[playerId]) {
            this.playerColorMap[playerId] = this.nextColorIndex;
            this.nextColorIndex = (this.nextColorIndex % 3) + 1; // Циклично 1, 2, 3
        }
        
        return this.playerColorMap[playerId];
    }
}

// Start the game when page loads
window.addEventListener('DOMContentLoaded', () => {
    new CardGame();
});
