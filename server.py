import asyncio
import json
import random
import uuid
from typing import Dict, List, Set, Optional
from dataclasses import dataclass, asdict
from websockets.server import serve, WebSocketServerProtocol
from aiohttp import web
import os
from database_postgres import GameDatabase

@dataclass
class Card:
    suit: str  # hearts, diamonds, clubs, spades
    rank: str  # 2-10, J, Q, K, A
    id: str
    
    def to_dict(self):
        return asdict(self)

@dataclass
class Player:
    id: str
    nickname: str
    hand: List[Card]
    ready: bool
    score: int = 0
    is_bot: bool = False
    
    def to_dict(self):
        return {
            'id': self.id,
            'nickname': self.nickname,
            'hand_count': len(self.hand),
            'ready': self.ready,
            'score': self.score,
            'is_bot': self.is_bot
        }
    
    def to_dict_with_hand(self):
        return {
            'id': self.id,
            'nickname': self.nickname,
            'hand': [card.to_dict() for card in self.hand],
            'ready': self.ready,
            'score': self.score
        }

@dataclass
class Room:
    id: str
    players: Dict[str, Player]
    deck: List[Card]
    discard_pile: List[Card]
    current_player_index: int
    dealer_index: int
    game_started: bool
    chosen_suit: Optional[str] = None
    waiting_for_eight: bool = False
    card_drawn_this_turn: bool = False  # Флаг что карта уже взята в этом ходу
    eight_draw_used: bool = False  # Флаг что взятие на восьмёрку уже использовано
    countdown_active: bool = False  # Активен ли обратный отсчёт
    countdown_task: Optional[object] = None  # Задача таймера
    last_loser_id: Optional[str] = None  # ID проигравшего в прошлой игре (станет дилером)
    deck_size: int = 52  # Размер колоды: 52 или 36 карт
    creator_id: Optional[str] = None  # ID создателя комнаты
    is_private: bool = False  # Приватная комната (не отображается в списке)
    
    def to_dict(self):
        return {
            'id': self.id,
            'players': [p.to_dict() for p in self.players.values()],
            'player_count': len(self.players),
            'game_started': self.game_started,
            'deck_size': self.deck_size,
            'creator_id': self.creator_id,
            'is_private': self.is_private
        }

class GameServer:
    def __init__(self):
        self.rooms: Dict[str, Room] = {}
        self.clients: Dict[WebSocketServerProtocol, str] = {}  # ws -> player_id
        self.player_rooms: Dict[str, str] = {}  # player_id -> room_id
        self.db = GameDatabase(
            host="localhost",
            port=5432,
            database="czechdb",
            user="czech",
            password="password"  # Замените на ваш пароль
        )
        self.cleanup_task = None
    
    async def cleanup_old_rooms(self):
        """Очистка комнат старше 24 часов"""
        deleted = await self.db.cleanup_old_rooms(hours=24)
        if deleted > 0:
            print(f"Cleaned up {deleted} old rooms from database")
        
        # Получаем статистику
        stats = await self.db.get_room_stats()
        print(f"Room stats: {stats['total_rooms']} total, {stats['active_games']} active games, "
              f"{stats['inactive_1h']} inactive >1h, {stats['inactive_24h']} inactive >24h")
    
    def cleanup_bot_only_rooms(self):
        """Удаляет комнаты где остались только боты"""
        rooms_to_delete = []
        for room_id, room in self.rooms.items():
            # Проверяем есть ли живые игроки
            human_players = [p for p in room.players.values() if not p.is_bot]
            if len(human_players) == 0 and len(room.players) > 0:
                rooms_to_delete.append(room_id)
        
        for room_id in rooms_to_delete:
            del self.rooms[room_id]
            print(f"Deleted bot-only room: {room_id}")
        
        return len(rooms_to_delete)
    
    async def start_cleanup_task(self):
        """Запуск периодической очистки каждые 6 часов"""
        while True:
            await asyncio.sleep(6 * 60 * 60)  # 6 часов
            await self.cleanup_old_rooms()
    
    async def load_rooms_from_db(self):
        """Загрузка всех комнат из базы данных"""
        room_ids = await self.db.get_all_rooms()
        for room_id in room_ids:
            await self.load_room(room_id)
    
    async def load_room(self, room_id: str) -> Optional[Room]:
        """Загрузка комнаты из БД"""
        # print(f"Loading room {room_id} from DB...")
        room_data = await self.db.load_room(room_id)
        if not room_data:
            # print(f"Room {room_id} not found in DB")
            return None
        
        # print(f"Room {room_id} data loaded: game_started={room_data.get('game_started')}")
        
        # Загружаем игроков
        players_data = await self.db.load_players(room_id)
        players = {}
        
        for player_data in players_data:
            cards = await self.db.load_player_cards(player_data['id'])
            player = Player(
                id=player_data['id'],
                nickname=player_data['nickname'],
                hand=[Card(**card) for card in cards],
                ready=player_data['ready'],
                score=player_data['score']
            )
            players[player_data['id']] = player
        
        # Загружаем колоду и сброс
        deck_data = await self.db.load_deck(room_id)
        discard_data = await self.db.load_discard_pile(room_id)
        
        room = Room(
            id=room_data['id'],
            players=players,
            deck=[Card(**card) for card in deck_data],
            discard_pile=[Card(**card) for card in discard_data],
            current_player_index=room_data['current_player_index'],
            dealer_index=room_data['dealer_index'],
            game_started=room_data['game_started'],
            chosen_suit=room_data['chosen_suit'],
            waiting_for_eight=room_data['waiting_for_eight'],
            card_drawn_this_turn=room_data['card_drawn_this_turn'],
            deck_size=room_data.get('deck_size', 52),
            creator_id=room_data.get('creator_id'),
            is_private=room_data.get('is_private', False)
        )
        
        # Инициализируем дополнительные атрибуты
        room.countdown_active = False
        room.countdown_task = None
        room.eight_drawn_cards = set()
        
        self.rooms[room_id] = room
        # print(f"Room {room_id} loaded successfully with {len(players)} players")
        
        # Восстанавливаем player_rooms
        for player_id in players.keys():
            self.player_rooms[player_id] = room_id
        
        return room
    
    async def save_room_to_db(self, room_id: str):
        """Сохранение комнаты в БД"""
        room = self.rooms.get(room_id)
        if not room:
            return
        
        try:
            # Сохраняем комнату
            await self.db.save_room({
                'id': room.id,
                'game_started': room.game_started,
                'current_player_index': room.current_player_index,
                'dealer_index': room.dealer_index,
                'chosen_suit': room.chosen_suit,
                'waiting_for_eight': room.waiting_for_eight,
                'eight_draw_used': room.eight_draw_used,
                'card_drawn_this_turn': room.card_drawn_this_turn,
                'deck_size': room.deck_size,
                'creator_id': room.creator_id,
                'is_private': room.is_private
            })
            
            # Сохраняем игроков
            player_ids = list(room.players.keys())
            for idx, (player_id, player) in enumerate(room.players.items()):
                await self.db.save_player({
                    'id': player.id,
                    'nickname': player.nickname,
                    'ready': player.ready,
                    'score': player.score
                }, room_id, idx)
                
                # Сохраняем карты игрока
                await self.db.save_player_cards(player_id, [card.to_dict() for card in player.hand])
            
            # Сохраняем колоду и сброс
            await self.db.save_deck(room_id, [card.to_dict() for card in room.deck])
            await self.db.save_discard_pile(room_id, [card.to_dict() for card in room.discard_pile])
        except Exception as e:
            pass  # print(f"Error saving room to DB: {e}")
        
    def create_deck(self, deck_size: int = 52) -> List[Card]:
        suits = ['hearts', 'diamonds', 'clubs', 'spades']
        
        # Для 36 карт исключаем 2, 3, 4, 5
        if deck_size == 36:
            ranks = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
        else:  # 52 карты
            ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
        
        deck = []
        for suit in suits:
            for rank in ranks:
                deck.append(Card(suit=suit, rank=rank, id=str(uuid.uuid4())))
        
        random.shuffle(deck)
        return deck
    
    def can_play_card(self, card: Card, top_card: Card, chosen_suit: Optional[str] = None) -> bool:
        # Дама может быть положена на любую карту
        if card.rank == 'Q':
            return True
        
        # Если была выбрана масть дамой, проверяем её
        if chosen_suit:
            return card.suit == chosen_suit or card.rank == top_card.rank
        
        # Обычная проверка: масть или номинал
        return card.suit == top_card.suit or card.rank == top_card.rank
    
    def calculate_card_points(self, card: Card) -> int:
        if card.rank in ['2', '3', '4', '5', '6', '7', '8', '9', '10']:
            return int(card.rank)
        elif card.rank == 'J':
            return 2
        elif card.rank == 'Q':
            return 40 if card.suit == 'spades' else 20
        elif card.rank == 'K':
            return 4
        elif card.rank == 'A':
            return 11
        return 0
    
    def calculate_hand_points(self, hand: List[Card]) -> int:
        return sum(self.calculate_card_points(card) for card in hand)
    
    def replenish_deck(self, room: Room) -> bool:
        """Пополняет колоду из сброса если карты закончились. Возвращает True если перемешивание произошло"""
        if len(room.deck) == 0 and len(room.discard_pile) > 1:
            # Оставляем верхнюю карту на поле
            top_card = room.discard_pile[-1]
            # Берём все остальные карты из сброса
            cards_to_shuffle = room.discard_pile[:-1]
            # Перемешиваем
            random.shuffle(cards_to_shuffle)
            # Делаем новой колодой
            room.deck = cards_to_shuffle
            # Оставляем только верхнюю карту в сбросе
            room.discard_pile = [top_card]
            return True
        return False
    
    async def broadcast_to_room(self, room_id: str, message: dict, exclude_player: Optional[str] = None):
        room = self.rooms.get(room_id)
        if not room:
            return
        
        for ws, player_id in self.clients.items():
            if player_id in room.players and player_id != exclude_player:
                try:
                    await ws.send(json.dumps(message))
                except:
                    pass
    
    async def send_to_player(self, player_id: str, message: dict):
        for ws, pid in self.clients.items():
            if pid == player_id:
                try:
                    await ws.send(json.dumps(message))
                except:
                    pass
                break
    
    async def handle_create_room(self, ws: WebSocketServerProtocol, data: dict):
        nickname = data.get('nickname')
        is_private = data.get('is_private', False)
        
        if not nickname:
            await ws.send(json.dumps({'type': 'error', 'message': 'Nickname required'}))
            return
        
        room_id = str(uuid.uuid4())
        player_id = str(uuid.uuid4())
        
        player = Player(
            id=player_id,
            nickname=nickname,
            hand=[],
            ready=False
        )
        
        room = Room(
            id=room_id,
            players={player_id: player},
            deck=[],
            discard_pile=[],
            current_player_index=0,
            dealer_index=0,
            game_started=False,
            creator_id=player_id,
            is_private=is_private
        )
        
        self.rooms[room_id] = room
        self.clients[ws] = player_id
        self.player_rooms[player_id] = room_id
        
        # Сохраняем в БД
        await self.save_room_to_db(room_id)
        
        await ws.send(json.dumps({
            'type': 'room_created',
            'room': room.to_dict(),
            'player_id': player_id,
            'room_id': room_id  # Отправляем room_id для URL
        }))
        
        await self.broadcast_rooms()
    
    async def handle_create_bot_game(self, ws: WebSocketServerProtocol, data: dict):
        nickname = data.get('nickname')
        bot_count = data.get('bot_count', 1)
        deck_size = data.get('deck_size', 52)
        
        if not nickname:
            await ws.send(json.dumps({'type': 'error', 'message': 'Nickname required'}))
            return
        
        if bot_count < 1 or bot_count > 3:
            await ws.send(json.dumps({'type': 'error', 'message': 'Bot count must be 1-3'}))
            return
        
        if deck_size not in [36, 52]:
            await ws.send(json.dumps({'type': 'error', 'message': 'Deck size must be 36 or 52'}))
            return
        
        room_id = str(uuid.uuid4())
        player_id = str(uuid.uuid4())
        
        # Создаём игрока
        player = Player(
            id=player_id,
            nickname=nickname,
            hand=[],
            ready=False,
            is_bot=False
        )
        
        players = {player_id: player}
        
        # Создаём ботов
        available_bot_names = [
            'Дружище',
            'Братан',
            'Чувак',
            'Кент',
            'Напарник',
            'Товарищ',
            'Приятель',
            'Бывалый',
            'Земеля',
            'Коллега',
            'Зевака',
            'Компаньон',
            'Соратник',
            'Местный',
            'Мужик'
        ]
        selected_bot_names = random.sample(available_bot_names, min(bot_count, len(available_bot_names)))
        
        for i in range(bot_count):
            bot_id = f'bot_{uuid.uuid4()}'
            bot = Player(
                id=bot_id,
                nickname=selected_bot_names[i],
                hand=[],
                ready=True,  # Боты всегда готовы
                is_bot=True
            )
            players[bot_id] = bot
        
        room = Room(
            id=room_id,
            players=players,
            deck=[],
            discard_pile=[],
            current_player_index=0,
            dealer_index=0,
            game_started=False,
            creator_id=player_id
        )
        
        self.rooms[room_id] = room
        self.clients[ws] = player_id
        self.player_rooms[player_id] = room_id
        
        # Сохраняем в БД
        await self.save_room_to_db(room_id)
        
        await ws.send(json.dumps({
            'type': 'room_created',
            'room': room.to_dict(),
            'player_id': player_id,
            'room_id': room_id
        }))
        
        await self.broadcast_rooms()
    
    async def handle_join_room(self, ws: WebSocketServerProtocol, data: dict):
        room_id = data.get('room_id')
        nickname = data.get('nickname')
        
        if not room_id or not nickname:
            await ws.send(json.dumps({'type': 'error', 'message': 'Room ID and nickname required'}))
            return
        
        room = self.rooms.get(room_id)
        if not room:
            await ws.send(json.dumps({
                'type': 'error', 
                'message': 'Комната не найдена или больше не существует',
                'error_code': 'room_not_found'
            }))
            return
        
        if room.game_started:
            await ws.send(json.dumps({
                'type': 'error', 
                'message': 'Игра уже началась. Присоединиться невозможно.',
                'error_code': 'game_started'
            }))
            return
        
        # Проверяем максимальное количество игроков
        if len(room.players) >= 4:
            await ws.send(json.dumps({'type': 'error', 'message': 'Room is full (max 4 players)'}))
            return
        
        # Нельзя присоединяться к комнатам, где у кого-либо уже есть очки
        if any(p.score > 0 for p in room.players.values()):
            await ws.send(json.dumps({'type': 'error', 'message': 'В эту комнату нельзя войти: у игроков уже есть очки'}))
            return
        
        player_id = str(uuid.uuid4())
        player = Player(
            id=player_id,
            nickname=nickname,
            hand=[],
            ready=False
        )
        
        room.players[player_id] = player
        self.clients[ws] = player_id
        self.player_rooms[player_id] = room_id
        
        # Сохраняем в БД
        await self.save_room_to_db(room_id)
        
        await ws.send(json.dumps({
            'type': 'room_joined',
            'room': room.to_dict(),
            'player_id': player_id,
            'room_id': room_id  # Отправляем room_id для URL
        }))
        
        await self.broadcast_to_room(room_id, {
            'type': 'player_joined',
            'player': player.to_dict()
        }, exclude_player=player_id)
        
        await self.broadcast_rooms()
    
    async def handle_toggle_ready(self, ws: WebSocketServerProtocol, data: dict):
        player_id = self.clients.get(ws)
        if not player_id:
            return
        
        room_id = self.player_rooms.get(player_id)
        if not room_id:
            return
        
        room = self.rooms.get(room_id)
        if not room or player_id not in room.players:
            return
        
        player = room.players[player_id]
        player.ready = not player.ready
        
        await self.broadcast_to_room(room_id, {
            'type': 'player_ready_changed',
            'player_id': player_id,
            'ready': player.ready
        })
        
        # Подсчитываем готовых игроков
        ready_count = sum(1 for p in room.players.values() if p.ready)
        total_count = len(room.players)
        
        # Если все готовы - начинаем сразу
        if total_count >= 2 and ready_count == total_count:
            # Отменяем таймер если был
            if room.countdown_task:
                room.countdown_task.cancel()
                room.countdown_task = None
            room.countdown_active = False
            await self.start_game(room_id)
        # Если >= 2 готовы но не все - запускаем таймер
        elif ready_count >= 2 and not room.countdown_active:
            room.countdown_active = True
            room.countdown_task = asyncio.create_task(self.start_countdown(room_id))
        # Если готовых стало меньше 2 - отменяем таймер
        elif ready_count < 2 and room.countdown_active:
            if room.countdown_task:
                room.countdown_task.cancel()
                room.countdown_task = None
            room.countdown_active = False
            await self.broadcast_to_room(room_id, {
                'type': 'countdown_cancelled'
            })
    
    async def start_countdown(self, room_id: str):
        """Обратный отсчёт 24 секунды перед началом игры"""
        room = self.rooms.get(room_id)
        if not room:
            return
        
        try:
            for seconds in range(24, 0, -1):
                await self.broadcast_to_room(room_id, {
                    'type': 'countdown_tick',
                    'seconds': seconds
                })
                await asyncio.sleep(1)
            
            # Таймер закончился - начинаем игру только с готовыми игроками
            room.countdown_active = False
            room.countdown_task = None
            
            # Удаляем неготовых игроков
            ready_players = {pid: p for pid, p in room.players.items() if p.ready}
            if len(ready_players) >= 2:
                room.players = ready_players
                await self.start_game(room_id)
            else:
                # Недостаточно готовых игроков
                await self.broadcast_to_room(room_id, {
                    'type': 'countdown_cancelled'
                })
        except asyncio.CancelledError:
            # Таймер был отменён
            pass
    
    async def make_bot_move(self, room_id: str, bot_id: str):
        """Бот делает ход"""
        await asyncio.sleep(1.5)  # Задержка для реалистичности
        
        room = self.rooms.get(room_id)
        if not room or not room.game_started:
            return
        
        # Проверяем что бот еще в комнате
        if bot_id not in room.players:
            return
        
        bot = room.players[bot_id]
        if not bot.is_bot:
            return  # Это не бот
        
        player_ids = list(room.players.keys())
        
        # Проверяем что индекс в пределах массива
        if room.current_player_index >= len(player_ids):
            return
        
        if player_ids[room.current_player_index] != bot_id:
            return  # Не ход бота
        top_card = room.discard_pile[-1] if room.discard_pile else None
        
        if not top_card:
            return
        
        # Находим подходящие карты
        playable_cards = []
        for card in bot.hand:
            # Для восьмёрки: можно играть двойку из руки ИЛИ любую карту из eight_drawn_cards
            if room.waiting_for_eight:
                if card.rank == '2':
                    playable_cards.append(card)
                elif hasattr(room, 'eight_drawn_cards') and card.id in room.eight_drawn_cards:
                    playable_cards.append(card)
            elif self.can_play_card(card, top_card, room.chosen_suit, room.waiting_for_eight):
                playable_cards.append(card)
        
        # Если есть подходящая карта - играем с приоритетом
        if playable_cards:
            # Приоритет: 7, 6, 8 (только для 52 карт), A (специальные карты)
            priority_ranks = ['7', '6', 'A']
            if room.deck_size == 52:
                priority_ranks.append('8')
            priority_cards = [c for c in playable_cards if c.rank in priority_ranks]
            
            if priority_cards:
                # Есть специальные карты - выбираем случайную из них
                card_to_play = random.choice(priority_cards)
            elif not room.waiting_for_eight:
                # Нет специальных карт и не восьмёрка - выбираем карту с максимальными очками
                # Сортируем по очкам (от больших к меньшим)
                playable_cards.sort(key=lambda c: self.calculate_card_points(c), reverse=True)
                # Берём карты с максимальными очками (может быть несколько одинаковых)
                max_points = self.calculate_card_points(playable_cards[0])
                max_point_cards = [c for c in playable_cards if self.calculate_card_points(c) == max_points]
                card_to_play = random.choice(max_point_cards)
            else:
                # Восьмёрка - выбираем случайную
                card_to_play = random.choice(playable_cards)
            
            # Если дама - выбираем масть умно
            chosen_suit = None
            if card_to_play.rank == 'Q':
                # Приоритет: масти с сильными картами (7, 6, 8 только для 52 карт, A)
                priority_ranks = ['7', '6', 'A']
                if room.deck_size == 52:
                    priority_ranks.append('8')
                priority_cards = [c for c in bot.hand if c.id != card_to_play.id and c.rank in priority_ranks]
                
                if priority_cards:
                    # Есть сильные карты - выбираем случайную масть из них
                    suits_with_priority = list(set(c.suit for c in priority_cards))
                    chosen_suit = random.choice(suits_with_priority)
                else:
                    # Нет сильных карт - выбираем любую масть из руки
                    suits_in_hand = list(set(c.suit for c in bot.hand if c.id != card_to_play.id))
                    chosen_suit = random.choice(suits_in_hand) if suits_in_hand else random.choice(['hearts', 'diamonds', 'clubs', 'spades'])
            
            # Играем карту (используем существующую логику)
            await self.handle_play_card(None, {
                'card_id': card_to_play.id,
                'chosen_suit': chosen_suit
            }, bot_id=bot_id, room_id=room_id)
        else:
            # Нет подходящих карт - берём карту из колоды
            if room.card_drawn_this_turn:
                # Карта уже взята ранее - просто пропускаем ход
                await self.handle_skip_turn(None, {}, bot_id=bot_id, room_id=room_id)
                return
            
            # Берём карту
            await self.handle_draw_card(None, {}, bot_id=bot_id, room_id=room_id)
            
            # Обновляем данные комнаты после draw
            room = self.rooms.get(room_id)
            if not room:
                return
            
            # Для обычного draw вызываем бота снова
            # Для восьмёрки вызов происходит в handle_draw_card
            if not room.waiting_for_eight:
                await asyncio.sleep(1)
                await self.make_bot_move(room_id, bot_id)
    
    def can_play_card(self, card: Card, top_card: Card, chosen_suit: str, waiting_for_eight: bool) -> bool:
        """Проверяет можно ли сыграть карту"""
        if waiting_for_eight:
            return card.rank == '2'
        
        if card.rank == 'Q':
            return True
        
        if chosen_suit:
            return card.suit == chosen_suit or card.rank == top_card.rank
        
        return card.suit == top_card.suit or card.rank == top_card.rank
    
    async def start_game(self, room_id: str):
        room = self.rooms.get(room_id)
        if not room:
            return
        
        room.game_started = True
        room.deck = self.create_deck(room.deck_size)
        
        # Раздаём по 5 карт каждому игроку
        for player in room.players.values():
            player.hand = [room.deck.pop() for _ in range(5)]
        
        # Снимаем одну карту на поле
        first_card = room.deck.pop()
        room.discard_pile = [first_card]
        
        # Выбираем дилера: проигравший в прошлой игре или случайно
        player_ids = list(room.players.keys())
        if room.last_loser_id and room.last_loser_id in room.players:
            # Дилер - проигравший в прошлой игре
            room.dealer_index = player_ids.index(room.last_loser_id)
        else:
            # Первая игра или проигравший вышел - выбираем случайно
            room.dealer_index = random.randint(0, len(player_ids) - 1)
        room.current_player_index = (room.dealer_index + 1) % len(player_ids)
        
        # Обрабатываем специальные карты при старте
        next_player = room.players[player_ids[room.current_player_index]]
        forced_draw_player_id = None
        forced_draw_count = 0
        deck_was_shuffled = False
        
        if first_card.rank == '6':
            # Следующий игрок берёт 1 карту
            forced_draw_player_id = player_ids[room.current_player_index]
            forced_draw_count = 1
            if self.replenish_deck(room):
                deck_was_shuffled = True
            if room.deck:
                next_player.hand.append(room.deck.pop())
            # Пропускаем его ход
            room.current_player_index = (room.current_player_index + 1) % len(player_ids)
            
        elif first_card.rank == '7':
            # Следующий игрок берёт 2 карты
            forced_draw_player_id = player_ids[room.current_player_index]
            forced_draw_count = 2
            for _ in range(2):
                if self.replenish_deck(room):
                    deck_was_shuffled = True
                if room.deck:
                    next_player.hand.append(room.deck.pop())
            # Пропускаем его ход
            room.current_player_index = (room.current_player_index + 1) % len(player_ids)
            
        elif first_card.rank == '8' and room.deck_size == 52:
            # Восьмёрка работает только в режиме 52 карт
            # Следующий игрок должен будет брать карты
            room.waiting_for_eight = True
            room.eight_draw_used = False
            
        elif first_card.rank == 'A':
            # Следующий игрок пропускает ход
            room.current_player_index = (room.current_player_index + 1) % len(player_ids)
            
        elif first_card.rank == 'Q':
            # Дилер выбирает масть (автоматически выбираем случайную)
            suits = ['hearts', 'diamonds', 'clubs', 'spades']
            room.chosen_suit = random.choice(suits)
        
        # Сохраняем в БД асинхронно
        asyncio.create_task(self.save_room_to_db(room_id))
        
        # Отправляем каждому игроку его карты
        for player_id, player in room.players.items():
            # Отправляем ID карт взятых из колоды на восьмёрку (только текущему игроку)
            eight_drawn_card_ids = []
            if player_id == player_ids[room.current_player_index] and hasattr(room, 'eight_drawn_cards'):
                eight_drawn_card_ids = list(room.eight_drawn_cards)
            
            message = {
                'type': 'game_started',
                'hand': [card.to_dict() for card in player.hand],
                'top_card': first_card.to_dict(),
                'current_player': player_ids[room.current_player_index],
                'dealer': player_ids[room.dealer_index],
                'players': [p.to_dict() for p in room.players.values()],
                'deck_count': len(room.deck),
                'chosen_suit': room.chosen_suit,
                'waiting_for_eight': room.waiting_for_eight,
                'eight_draw_used': room.eight_draw_used,
                'eight_drawn_cards': eight_drawn_card_ids,
                'deck_size': room.deck_size
            }
            
            # Добавляем информацию о принудительном взятии карт (6 или 7)
            if forced_draw_player_id and forced_draw_count > 0:
                message['forced_draw_player_id'] = forced_draw_player_id
                message['forced_draw_player_nickname'] = room.players[forced_draw_player_id].nickname
                message['forced_draw_count'] = forced_draw_count
            
            await self.send_to_player(player_id, message)
        
        # Если колода была перемешана при старте, отправляем уведомление всем
        if deck_was_shuffled:
            for pid in room.players.keys():
                await self.send_to_player(pid, {
                    'type': 'deck_shuffled',
                    'log_message': 'Колода перемешана'
                })
        
        await self.broadcast_rooms()
        
        # Если первый игрок - бот, запускаем его ход
        first_player_id = player_ids[room.current_player_index]
        if room.players[first_player_id].is_bot:
            asyncio.create_task(self.make_bot_move(room_id, first_player_id))
    
    async def handle_play_card(self, ws: WebSocketServerProtocol, data: dict, bot_id: str = None, room_id: str = None):
        # Для ботов используем переданные параметры
        if bot_id and room_id:
            player_id = bot_id
        else:
            player_id = self.clients.get(ws)
            if not player_id:
                return
            
            room_id = self.player_rooms.get(player_id)
            if not room_id:
                return
        
        room = self.rooms.get(room_id)
        if not room or not room.game_started:
            return
        
        player_ids = list(room.players.keys())
        if player_ids[room.current_player_index] != player_id:
            if ws:  # Только для реальных игроков
                await ws.send(json.dumps({'type': 'error', 'message': 'Not your turn'}))
            return
        
        card_id = data.get('card_id')
        chosen_suit = data.get('chosen_suit')  # Для дамы
        
        player = room.players[player_id]
        card = next((c for c in player.hand if c.id == card_id), None)
        
        if not card:
            if ws:  # Только для реальных игроков
                await ws.send(json.dumps({'type': 'error', 'message': 'Card not found'}))
            return
        
        if not room.discard_pile:
            if ws:
                await ws.send(json.dumps({'type': 'error', 'message': 'No cards on table'}))
            return
        
        top_card = room.discard_pile[-1]
        
        # Проверка на восьмёрку
        if room.waiting_for_eight:
            # Можно положить:
            # 1. Любую двойку из руки
            # 2. Карты взятые из колоды (двойка, дама или та же масть)
            is_drawn_card = hasattr(room, 'eight_drawn_cards') and card.id in room.eight_drawn_cards
            
            if card.rank != '2' and not is_drawn_card:
                await ws.send(json.dumps({'type': 'error', 'message': 'Must play a 2 or draw cards'}))
                return
            
            room.waiting_for_eight = False
            room.eight_draw_used = False
            if hasattr(room, 'eight_drawn_cards'):
                room.eight_drawn_cards.clear()
        else:
            # Обычная проверка
            if not self.can_play_card(card, top_card, room.chosen_suit, room.waiting_for_eight):
                if ws:  # Только для реальных игроков
                    await ws.send(json.dumps({'type': 'error', 'message': 'Cannot play this card'}))
                return
        
        # Убираем карту из руки и кладём на стол
        player.hand.remove(card)
        room.discard_pile.append(card)
        
        # Сбрасываем chosen_suit только если кладём НЕ даму
        # Для дамы масть будет установлена ниже
        if card.rank != 'Q':
            room.chosen_suit = None
        
        # Обработка специальных карт ПЕРЕД проверкой победы
        next_player_index = (room.current_player_index + 1) % len(player_ids)
        forced_draw_player_id = None
        forced_draw_count = 0
        deck_was_shuffled = False
        
        if card.rank == '6':
            # Следующий игрок берёт 1 карту и пропускает ход
            next_player = room.players[player_ids[next_player_index]]
            forced_draw_player_id = player_ids[next_player_index]
            if self.replenish_deck(room):
                deck_was_shuffled = True
            if room.deck:
                next_player.hand.append(room.deck.pop())
                forced_draw_count = 1
            next_player_index = (next_player_index + 1) % len(player_ids)
            
        elif card.rank == '7':
            # Следующий игрок берёт 2 карты и пропускает ход
            next_player = room.players[player_ids[next_player_index]]
            forced_draw_player_id = player_ids[next_player_index]
            cards_drawn = 0
            for _ in range(2):
                if self.replenish_deck(room):
                    deck_was_shuffled = True
                if room.deck:
                    next_player.hand.append(room.deck.pop())
                    cards_drawn += 1
            forced_draw_count = cards_drawn
            next_player_index = (next_player_index + 1) % len(player_ids)
        
        # Проверяем победу ПЕРЕД обработкой остальных специальных карт
        # Если игрок выиграл на 8, A или Q - игра заканчивается без дополнительных эффектов
        if len(player.hand) == 0:
            await self.handle_game_end(room_id, player_id)
            return
            
        elif card.rank == 'A':
            # Следующий игрок пропускает ход
            next_player_index = (next_player_index + 1) % len(player_ids)
            
        elif card.rank == '8' and room.deck_size == 52:
            # Восьмёрка работает только в режиме 52 карт
            # Следующий игрок должен брать карты или положить двойку
            room.waiting_for_eight = True
            room.eight_draw_used = False
            
        elif card.rank == 'Q':
            # Игрок выбирает масть
            if chosen_suit:
                room.chosen_suit = chosen_suit
        
        room.current_player_index = next_player_index
        room.card_drawn_this_turn = False  # Сбрасываем флаг для следующего игрока
        
        # Сохраняем в БД асинхронно (не ждём)
        asyncio.create_task(self.save_room_to_db(room_id))
        
        # Отправляем обновление всем игрокам параллельно
        tasks = []
        for pid, p in room.players.items():
            # Отправляем ID карт взятых из колоды на восьмёрку (только текущему игроку)
            eight_drawn_card_ids = []
            if pid == player_ids[room.current_player_index] and hasattr(room, 'eight_drawn_cards'):
                eight_drawn_card_ids = list(room.eight_drawn_cards)
            
            message = {
                'type': 'card_played',
                'player_id': player_id,
                'player_nickname': room.players[player_id].nickname,
                'card': card.to_dict(),
                'top_card': room.discard_pile[-1].to_dict(),
                'current_player': player_ids[room.current_player_index],
                'hand': [c.to_dict() for c in p.hand],
                'players': [pl.to_dict() for pl in room.players.values()],
                'deck_count': len(room.deck),
                'chosen_suit': room.chosen_suit,
                'waiting_for_eight': room.waiting_for_eight,
                'eight_draw_used': room.eight_draw_used,
                'card_drawn_this_turn': False,
                'eight_drawn_cards': eight_drawn_card_ids,
                'deck_size': room.deck_size
            }
            
            # Добавляем информацию о принудительном взятии карт (6 или 7)
            if forced_draw_player_id and forced_draw_count > 0:
                message['forced_draw_player_id'] = forced_draw_player_id
                message['forced_draw_player_nickname'] = room.players[forced_draw_player_id].nickname
                message['forced_draw_count'] = forced_draw_count
            
            tasks.append(self.send_to_player(pid, message))
        
        # Отправляем все сообщения одновременно
        await asyncio.gather(*tasks)
        
        # Если колода была перемешана при игре карты, отправляем уведомление всем
        if deck_was_shuffled:
            for pid in room.players.keys():
                await self.send_to_player(pid, {
                    'type': 'deck_shuffled',
                    'log_message': 'Колода перемешана'
                })
        
        # Если следующий игрок - бот, делаем его ход
        next_player_id = player_ids[room.current_player_index]
        if room.players[next_player_id].is_bot:
            asyncio.create_task(self.make_bot_move(room_id, next_player_id))
    
    async def handle_draw_card(self, ws: WebSocketServerProtocol, data: dict, bot_id: str = None, room_id: str = None):
        # Для ботов используем переданные параметры
        if bot_id and room_id:
            player_id = bot_id
        else:
            player_id = self.clients.get(ws)
            if not player_id:
                return
            
            room_id = self.player_rooms.get(player_id)
            if not room_id:
                return
        
        room = self.rooms.get(room_id)
        if not room or not room.game_started:
            return
        
        player_ids = list(room.players.keys())
        if player_ids[room.current_player_index] != player_id:
            if ws:  # Только для реальных игроков
                await ws.send(json.dumps({'type': 'error', 'message': 'Not your turn'}))
            return
        
        player = room.players[player_id]
        
        # Обработка восьмёрки
        if room.waiting_for_eight:
            # Проверяем использовал ли игрок уже взятие на восьмёрку
            if room.eight_draw_used:
                if ws:
                    await ws.send(json.dumps({
                        'type': 'error',
                        'message': 'Вы уже использовали взятие карт на восьмёрку'
                    }))
                return
            
            # Помечаем что взятие использовано
            room.eight_draw_used = True
            
            # Игрок тянет карты из колоды пока не попадётся подходящая
            drawn_cards = []
            drawn_card_ids = []  # ID карт взятых из колоды
            deck_was_shuffled = False
            max_iterations = 1000  # Защита от бесконечного цикла
            iterations = 0
            
            while iterations < max_iterations:
                iterations += 1
                
                # Пытаемся пополнить колоду из сброса если она пустая
                shuffled = self.replenish_deck(room)
                if shuffled:
                    deck_was_shuffled = True
                
                # Если колода пустая и перемешивание не помогло
                # (в игре осталась только 1 карта на столе и больше нет карт нигде)
                if not room.deck:
                    # Это критическая ситуация - карты закончились совсем
                    # Игрок не может взять карту, пропускаем ход
                    break
                
                # Проверяем что есть верхняя карта на столе
                if not room.discard_pile:
                    break
                
                card = room.deck.pop()
                player.hand.append(card)
                drawn_cards.append(card)
                drawn_card_ids.append(card.id)
                
                top_card = room.discard_pile[-1]
                # Из колоды подходят:
                # 1. Любая двойка (2)
                # 2. Любая дама (Q)
                # 3. Любая восьмёрка (8)
                # 4. Карта той же масти что и восьмёрка
                if (card.rank == '2' or 
                    card.rank == 'Q' or 
                    card.rank == '8' or
                    card.suit == top_card.suit):
                    # Нашли подходящую карту - выходим
                    break
                
                # Если не подошла - продолжаем цикл
                # При необходимости колода перемешается на следующей итерации
            
            # НЕ сбрасываем waiting_for_eight - он сбросится когда игрок сыграет карту
            # НЕ устанавливаем card_drawn_this_turn - это автоматическое взятие
            
            # Сохраняем ID карт взятых из колоды
            if not hasattr(room, 'eight_drawn_cards'):
                room.eight_drawn_cards = set()
            room.eight_drawn_cards.update(drawn_card_ids)
            
            # Если не нашли подходящую карту, пропускаем ход
            if not drawn_cards:
                room.waiting_for_eight = False
                room.eight_draw_used = False
                room.eight_drawn_cards.clear()
                room.current_player_index = (room.current_player_index + 1) % len(player_ids)
            else:
                last_card = drawn_cards[-1]
                # Проверяем последнюю взятую карту
                if room.discard_pile:
                    top_card = room.discard_pile[-1]
                    card_matches = (last_card.rank == '2' or 
                                   last_card.rank == 'Q' or 
                                   last_card.rank == '8' or
                                   last_card.suit == top_card.suit)
                else:
                    card_matches = False
                
                if not card_matches:
                    room.waiting_for_eight = False
                    room.eight_draw_used = False
                    room.eight_drawn_cards.clear()
                    room.current_player_index = (room.current_player_index + 1) % len(player_ids)
            
            # Если колода была перемешана во время взятия карт на восьмёрку
            if deck_was_shuffled:
                for pid in room.players.keys():
                    await self.send_to_player(pid, {
                        'type': 'deck_shuffled',
                        'log_message': 'Колода перемешана'
                    })
        else:
            # Обычное взятие карты (можно взять даже если есть чем ходить)
            if room.card_drawn_this_turn:
                await ws.send(json.dumps({'type': 'error', 'message': 'Вы уже взяли карту в этом ходу'}))
                return
            
            deck_shuffled = self.replenish_deck(room)
            
            if not room.deck:
                await ws.send(json.dumps({'type': 'error', 'message': 'Колода пуста'}))
                return
            
            card = room.deck.pop()
            player.hand.append(card)
            drawn_cards = [card]  # Инициализируем для использования в логировании
            room.card_drawn_this_turn = True
            
            # Если колода была перемешана, отправляем лог всем
            if deck_shuffled:
                for pid in room.players.keys():
                    await self.send_to_player(pid, {
                        'type': 'deck_shuffled',
                        'log_message': 'Колода перемешана'
                    })
        
        # Сохраняем в БД асинхронно (не ждём)
        asyncio.create_task(self.save_room_to_db(room_id))
        
        # Отправляем обновление (ход НЕ переходит автоматически)
        for pid, p in room.players.items():
            # Отправляем ID карт взятых из колоды на восьмёрку (только текущему игроку)
            eight_drawn_card_ids = []
            if pid == player_id and hasattr(room, 'eight_drawn_cards'):
                eight_drawn_card_ids = list(room.eight_drawn_cards)
            
            await self.send_to_player(pid, {
                'type': 'card_drawn',
                'player_id': player_id,
                'player_nickname': room.players[player_id].nickname,
                'cards_count': len(drawn_cards),
                'current_player': player_ids[room.current_player_index],
                'hand': [c.to_dict() for c in p.hand],
                'players': [pl.to_dict() for pl in room.players.values()],
                'deck_count': len(room.deck),
                'waiting_for_eight': room.waiting_for_eight,
                'eight_draw_used': room.eight_draw_used,
                'card_drawn_this_turn': room.card_drawn_this_turn,
                'chosen_suit': room.chosen_suit,
                'top_card': room.discard_pile[-1].to_dict() if room.discard_pile else None,
                'eight_drawn_cards': eight_drawn_card_ids
            })
        
        # Если это был бот и он взял карты на восьмёрку, вызываем его ход снова
        # Для обычного draw вызов происходит в make_bot_move
        if bot_id and room.waiting_for_eight:
            # Бот взял карты на восьмёрку и должен сыграть одну из них
            async def delayed_bot_move():
                await asyncio.sleep(1)
                await self.make_bot_move(room_id, bot_id)
            asyncio.create_task(delayed_bot_move())
    
    async def handle_game_end(self, room_id: str, winner_id: str):
        room = self.rooms.get(room_id)
        if not room:
            return
        
        # Проверяем последнюю карту победителя (дама даёт бонус)
        winning_card = room.discard_pile[-1] if room.discard_pile else None
        queen_bonus = 0
        if winning_card and winning_card.rank == 'Q':
            if winning_card.suit == 'spades':
                queen_bonus = -40  # Пиковая дама
            else:
                queen_bonus = -20  # Любая другая дама
        
        # Подсчитываем очки для всех игроков кроме победителя
        results = []
        for player_id, player in room.players.items():
            if player_id != winner_id:
                points = self.calculate_hand_points(player.hand)
                player.score += points
                results.append({
                    'player_id': player_id,
                    'nickname': player.nickname,
                    'points': points,
                    'total_score': player.score,
                    'hand': [c.to_dict() for c in player.hand]
                })
            else:
                # Победитель получает бонус за даму
                player.score += queen_bonus
                results.append({
                    'player_id': player_id,
                    'nickname': player.nickname,
                    'points': queen_bonus,
                    'total_score': player.score,
                    'hand': [],  # Победитель без карт
                    'queen_bonus': queen_bonus  # Для отображения на клиенте
                })
        
        # Находим проигравшего в этой раздаче (игрок с максимальными очками в раздаче)
        # Это тот, кто набрал больше всего очков в этой конкретной игре, не победитель
        round_loser_id = None
        max_round_points = -1
        for result in results:
            if result['player_id'] != winner_id and result['points'] > max_round_points:
                max_round_points = result['points']
                round_loser_id = result['player_id']
        
        # Обрабатываем специальные случаи с очками
        players_to_kick = []  # Игроки с >101 очком
        for player_id, player in room.players.items():
            if player.score == 101:
                # Ровно 101 - обнуляем очки
                player.score = 0
            elif player.score > 101:
                # Больше 101 - игрок вылетает
                players_to_kick.append(player_id)
        
        # Сохраняем ID проигравшего в раздаче для следующей игры (если он не вылетает)
        if round_loser_id and round_loser_id not in players_to_kick:
            room.last_loser_id = round_loser_id
        else:
            # Если проигравший вылетает, выбираем случайно в следующий раз
            room.last_loser_id = None
        
        # Последняя карта победителя (верхняя в discard_pile)
        winning_card = room.discard_pile[-1].to_dict() if room.discard_pile else None
        
        # Отправляем результаты
        for player_id in room.players.keys():
            await self.send_to_player(player_id, {
                'type': 'game_ended',
                'winner_id': winner_id,
                'winning_card': winning_card,
                'results': results
            })
        
        # Удаляем игроков с >101 очком
        if players_to_kick:
            # Проверяем: если осталось меньше 2 игроков - закрываем комнату
            remaining_players = len(room.players) - len(players_to_kick)
            
            if remaining_players < 2:
                # Закрываем комнату полностью
                # Определяем победителя (игрок с минимальными очками среди оставшихся)
                final_winner_id = None
                min_score = float('inf')
                for player_id, player in room.players.items():
                    if player_id not in players_to_kick and player.score < min_score:
                        min_score = player.score
                        final_winner_id = player_id
                
                # Отправляем финальное сообщение о победе
                for player_id in room.players.keys():
                    await self.send_to_player(player_id, {
                        'type': 'final_winner',
                        'winner_id': final_winner_id,
                        'winner_nickname': room.players[final_winner_id].nickname if final_winner_id else '',
                        'kicked_players': [room.players[pid].nickname for pid in players_to_kick]
                    })
                
                # Удаляем комнату из памяти и БД
                await self.db.delete_room(room_id)
                if room_id in self.rooms:
                    del self.rooms[room_id]
                
                # Очищаем player_rooms для всех игроков
                for player_id in list(room.players.keys()):
                    if player_id in self.player_rooms:
                        del self.player_rooms[player_id]
                
                await self.broadcast_rooms()
                return
            else:
                # Удаляем проигравших игроков из комнаты
                for player_id in players_to_kick:
                    player_nickname = room.players[player_id].nickname
                    del room.players[player_id]
                    if player_id in self.player_rooms:
                        del self.player_rooms[player_id]
                    
                    # Уведомляем всех о вылете игрока
                    await self.broadcast_to_room(room_id, {
                        'type': 'player_kicked',
                        'player_id': player_id,
                        'player_nickname': player_nickname,
                        'reason': 'Набрал больше 101 очка'
                    })
        
        # Сбрасываем комнату для новой игры
        room.game_started = False
        for player in room.players.values():
            player.hand = []
            # Боты всегда готовы, реальные игроки - нет
            player.ready = player.is_bot
        room.deck = []
        room.discard_pile = []
        room.chosen_suit = None
        room.waiting_for_eight = False
        room.eight_draw_used = False
        
        # Сохраняем обновлённые очки в БД асинхронно
        asyncio.create_task(self.save_room_to_db(room_id))
        
        # Отправляем обновление комнаты всем игрокам
        for player_id in room.players.keys():
            await self.send_to_player(player_id, {
                'type': 'room_updated',
                'room': room.to_dict()
            })
        
        await self.broadcast_rooms()
    
    async def handle_skip_turn(self, ws: WebSocketServerProtocol, data: dict, bot_id: str = None, room_id: str = None):
        # Для ботов используем переданные параметры
        if bot_id and room_id:
            player_id = bot_id
        else:
            player_id = self.clients.get(ws)
            if not player_id:
                return
            
            room_id = self.player_rooms.get(player_id)
            if not room_id:
                return
        
        room = self.rooms.get(room_id)
        if not room or not room.game_started:
            return
        
        player_ids = list(room.players.keys())
        if player_ids[room.current_player_index] != player_id:
            if ws:  # Только для реальных игроков
                await ws.send(json.dumps({'type': 'error', 'message': 'Not your turn'}))
            return
        
        # Нельзя пропустить ход при восьмёрке
        if room.waiting_for_eight:
            if ws:  # Только для реальных игроков
                await ws.send(json.dumps({'type': 'error', 'message': 'Нельзя пропустить ход на восьмёрке'}))
            return
        
        # Можно пропустить ход только если карта уже была взята
        if not room.card_drawn_this_turn:
            if ws:  # Только для реальных игроков
                await ws.send(json.dumps({'type': 'error', 'message': 'Сначала возьмите карту из колоды'}))
            return
        
        # Пропускаем ход
        room.current_player_index = (room.current_player_index + 1) % len(player_ids)
        room.card_drawn_this_turn = False
        
        # Сохраняем в БД асинхронно (не ждём)
        asyncio.create_task(self.save_room_to_db(room_id))
        
        # Отправляем обновление с логом
        for pid, p in room.players.items():
            # Отправляем ID карт взятых из колоды на восьмёрку (только текущему игроку)
            eight_drawn_card_ids = []
            if pid == player_ids[room.current_player_index] and hasattr(room, 'eight_drawn_cards'):
                eight_drawn_card_ids = list(room.eight_drawn_cards)
            
            await self.send_to_player(pid, {
                'type': 'turn_skipped',
                'player_id': player_id,
                'player_nickname': room.players[player_id].nickname,
                'current_player': player_ids[room.current_player_index],
                'hand': [c.to_dict() for c in p.hand],
                'players': [pl.to_dict() for pl in room.players.values()],
                'card_drawn_this_turn': False,
                'chosen_suit': room.chosen_suit,
                'waiting_for_eight': room.waiting_for_eight,
                'eight_draw_used': room.eight_draw_used,
                'eight_drawn_cards': eight_drawn_card_ids,
                'top_card': room.discard_pile[-1].to_dict() if room.discard_pile else None,
                'log_message': f"{room.players[player_id].nickname} пропустил ход"
            })
        
        # Если следующий игрок - бот, делаем его ход
        next_player_id = player_ids[room.current_player_index]
        if room.players[next_player_id].is_bot:
            asyncio.create_task(self.make_bot_move(room_id, next_player_id))
    
    async def handle_reconnect(self, ws: WebSocketServerProtocol, data: dict):
        """Переподключение игрока по player_id"""
        player_id = data.get('player_id')
        room_id = data.get('room_id')
        
        # print(f"Reconnect attempt: player_id={player_id}, room_id={room_id}")
        
        if not player_id or not room_id:
            await ws.send(json.dumps({'type': 'error', 'message': 'Player ID and Room ID required'}))
            return
        
        # Проверяем существование комнаты
        if room_id not in self.rooms:
            # print(f"Room {room_id} not in memory, loading from DB...")
            # Пытаемся загрузить из БД
            await self.load_room(room_id)
        
        room = self.rooms.get(room_id)
        if not room:
            # print(f"Room {room_id} not found in DB")
            await ws.send(json.dumps({
                'type': 'error', 
                'message': 'Комната не найдена или больше не существует',
                'error_code': 'room_not_found'
            }))
            return
        
        # print(f"Room {room_id} loaded, players: {list(room.players.keys())}")
        
        # Проверяем существование игрока
        if player_id not in room.players:
            # print(f"Player {player_id} not found in room {room_id}")
            await ws.send(json.dumps({
                'type': 'error', 
                'message': 'Игрок не найден в этой комнате',
                'error_code': 'player_not_found'
            }))
            return
        
        # Переподключаем игрока
        self.clients[ws] = player_id
        self.player_rooms[player_id] = room_id
        
        player = room.players[player_id]
        
        # Уведомляем других игроков о переподключении
        await self.broadcast_to_room(room_id, {
            'type': 'player_reconnected',
            'player_id': player_id,
            'nickname': player.nickname
        }, exclude_player=player_id)
        
        if room.game_started:
            # Отправляем состояние игры
            player_ids = list(room.players.keys())
            
            # Отправляем ID карт взятых из колоды на восьмёрку (только текущему игроку)
            eight_drawn_card_ids = []
            if player_id == player_ids[room.current_player_index] and hasattr(room, 'eight_drawn_cards'):
                eight_drawn_card_ids = list(room.eight_drawn_cards)
            
            message = {
                'type': 'game_started',
                'hand': [card.to_dict() for card in player.hand],
                'top_card': room.discard_pile[-1].to_dict() if room.discard_pile else None,
                'current_player': player_ids[room.current_player_index],
                'dealer': player_ids[room.dealer_index],
                'players': [p.to_dict() for p in room.players.values()],
                'deck_count': len(room.deck),
                'chosen_suit': room.chosen_suit,
                'waiting_for_eight': room.waiting_for_eight,
                'eight_draw_used': room.eight_draw_used,
                'eight_drawn_cards': eight_drawn_card_ids,
                'card_drawn_this_turn': room.card_drawn_this_turn,
                'deck_size': room.deck_size
            }
            
            await ws.send(json.dumps(message))
            
            # Если сейчас ход бота - запускаем его
            current_player_id = player_ids[room.current_player_index]
            if room.players[current_player_id].is_bot:
                asyncio.create_task(self.make_bot_move(room_id, current_player_id))
        else:
            # Отправляем состояние комнаты
            await ws.send(json.dumps({
                'type': 'room_joined',
                'room': room.to_dict(),
                'player_id': player_id,
                'room_id': room_id
            }))
    
    async def broadcast_rooms(self):
        # Очищаем комнаты где только боты
        self.cleanup_bot_only_rooms()
        
        available_rooms = []
        for room in self.rooms.values():
            # Проверяем что игра не началась и все очки 0
            if not room.game_started and all(p.score == 0 for p in room.players.values()):
                # Проверяем что есть хотя бы один живой игрок (не бот)
                has_human = any(not p.is_bot for p in room.players.values())
                # Не показываем приватные комнаты в общем списке
                if has_human and not room.is_private:
                    available_rooms.append(room.to_dict())
        
        message = json.dumps({
            'type': 'rooms_list',
            'rooms': available_rooms
        })
        
        for ws in self.clients.keys():
            try:
                await ws.send(message)
            except:
                pass
    
    async def handle_chat_message(self, ws: WebSocketServerProtocol, data: dict):
        """Обработка сообщения чата"""
        player_id = self.clients.get(ws)
        # print(f"Chat message from player_id: {player_id}")
        if not player_id:
            # print("No player_id found")
            return
        
        room_id = self.player_rooms.get(player_id)
        # print(f"Player in room: {room_id}")
        if not room_id:
            await ws.send(json.dumps({'type': 'error', 'message': 'You are not in a room'}))
            return
        
        room = self.rooms.get(room_id)
        if not room:
            # print(f"Room {room_id} not found")
            return
        
        player = room.players.get(player_id)
        if not player:
            # print(f"Player {player_id} not in room players")
            return
        
        message_text = data.get('message', '').strip()
        # print(f"Message text: {message_text}")
        if not message_text:
            return
        
        # Ограничиваем длину сообщения
        message_text = message_text[:200]
        
        # Отправляем сообщение всем игрокам в комнате
        chat_message = f"{player.nickname}: {message_text}"
        # print(f"Sending chat message to {len(room.players)} players: {chat_message}")
        
        for pid in room.players.keys():
            await self.send_to_player(pid, {
                'type': 'chat_message',
                'message': chat_message,
                'player_id': player_id,
                'player_nickname': player.nickname
            })
    
    async def handle_change_deck_size(self, ws: WebSocketServerProtocol, data: dict):
        """Изменение размера колоды (только создатель комнаты, до начала игры)"""
        player_id = self.clients.get(ws)
        if not player_id:
            return
        
        room_id = self.player_rooms.get(player_id)
        if not room_id:
            return
        
        room = self.rooms.get(room_id)
        if not room:
            return
        
        # Проверяем что игрок - создатель комнаты
        if room.creator_id != player_id:
            await ws.send(json.dumps({
                'type': 'error',
                'message': 'Only room creator can change deck size'
            }))
            return
        
        # Проверяем что игра не началась
        if room.game_started:
            await ws.send(json.dumps({
                'type': 'error',
                'message': 'Cannot change deck size after game started'
            }))
            return
        
        deck_size = data.get('deck_size')
        if deck_size not in [36, 52]:
            await ws.send(json.dumps({
                'type': 'error',
                'message': 'Deck size must be 36 or 52'
            }))
            return
        
        room.deck_size = deck_size
        
        # Сохраняем в БД
        await self.save_room_to_db(room_id)
        
        # Уведомляем всех в комнате
        await self.broadcast_to_room(room_id, {
            'type': 'deck_size_changed',
            'deck_size': deck_size
        })
    
    async def handle_toggle_private(self, ws: WebSocketServerProtocol, data: dict):
        """Переключение приватности комнаты (только создатель, до начала игры)"""
        player_id = self.clients.get(ws)
        if not player_id:
            return
        
        room_id = self.player_rooms.get(player_id)
        if not room_id:
            return
        
        room = self.rooms.get(room_id)
        if not room:
            return
        
        # Только создатель может менять приватность
        if room.creator_id != player_id:
            await ws.send(json.dumps({'type': 'error', 'message': 'Только создатель может изменить приватность комнаты'}))
            return
        
        # Только до начала игры
        if room.game_started or any(p.score > 0 for p in room.players.values()):
            await ws.send(json.dumps({'type': 'error', 'message': 'Нельзя изменить приватность после начала игры'}))
            return
        
        is_private = data.get('is_private', False)
        room.is_private = is_private
        
        # Сохраняем в БД
        await self.save_room_to_db(room_id)
        
        # Уведомляем всех в комнате
        await self.broadcast_to_room(room_id, {
            'type': 'room_privacy_changed',
            'is_private': is_private
        })
        
        # Обновляем список комнат (приватные не показываются)
        await self.broadcast_rooms()
    
    async def handle_message(self, ws: WebSocketServerProtocol, message: str):
        try:
            data = json.loads(message)
            msg_type = data.get('type')
            
            if msg_type == 'create_room':
                await self.handle_create_room(ws, data)
            elif msg_type == 'create_bot_game':
                await self.handle_create_bot_game(ws, data)
            elif msg_type == 'join_room':
                await self.handle_join_room(ws, data)
            elif msg_type == 'toggle_ready':
                await self.handle_toggle_ready(ws, data)
            elif msg_type == 'play_card':
                await self.handle_play_card(ws, data)
            elif msg_type == 'draw_card':
                await self.handle_draw_card(ws, data)
            elif msg_type == 'skip_turn':
                await self.handle_skip_turn(ws, data)
            elif msg_type == 'reconnect':
                await self.handle_reconnect(ws, data)
            elif msg_type == 'get_rooms':
                await self.broadcast_rooms()
            elif msg_type == 'chat_message':
                await self.handle_chat_message(ws, data)
            elif msg_type == 'change_deck_size':
                await self.handle_change_deck_size(ws, data)
            elif msg_type == 'toggle_private':
                await self.handle_toggle_private(ws, data)
                
        except json.JSONDecodeError:
            await ws.send(json.dumps({'type': 'error', 'message': 'Invalid JSON'}))
        except Exception as e:
            print(f"Error handling message: {e}")
            await ws.send(json.dumps({'type': 'error', 'message': str(e)}))
    
    async def handle_client(self, ws: WebSocketServerProtocol):
        # Добавляем временный ID для нового клиента чтобы он получал обновления
        temp_id = str(uuid.uuid4())
        self.clients[ws] = temp_id
        
        try:
            # Отправляем список комнат новому клиенту
            available_rooms = [
                room.to_dict() for room in self.rooms.values() 
                if not room.game_started and all(p.score == 0 for p in room.players.values())
            ]
            await ws.send(json.dumps({
                'type': 'rooms_list',
                'rooms': available_rooms
            }))
            
            async for message in ws:
                await self.handle_message(ws, message)
        except Exception as e:
            print(f"Client error: {e}")
        finally:
            # Удаляем клиента при отключении
            player_id = self.clients.get(ws)
            if player_id:
                # Если это реальный игрок (не временный ID)
                if player_id != temp_id:
                    room_id = self.player_rooms.get(player_id)
                    if room_id:
                        room = self.rooms.get(room_id)
                        if room and player_id in room.players:
                            # Проверяем: игра идёт (game_started) ИЛИ хотя бы у одного игрока есть очки (между раундами)
                            game_in_progress = room.game_started or any(p.score > 0 for p in room.players.values())
                            
                            # Если игра идёт - НЕ удаляем игрока из комнаты и player_rooms
                            if game_in_progress:
                                # Уведомляем других о временном отключении
                                await self.broadcast_to_room(room_id, {
                                    'type': 'player_disconnected',
                                    'player_id': player_id,
                                    'nickname': room.players[player_id].nickname
                                })
                                # Сохраняем комнату в БД
                                await self.save_room_to_db(room_id)
                                # НЕ удаляем из player_rooms - игрок сможет переподключиться
                            else:
                                # Игра не началась и ни у кого нет очков - удаляем игрока полностью
                                del room.players[player_id]
                                
                                # Если это создатель приватной комнаты - удаляем комнату полностью
                                if room.is_private and room.creator_id == player_id:
                                    # Уведомляем всех игроков что комната закрывается
                                    await self.broadcast_to_room(room_id, {
                                        'type': 'room_closed',
                                        'message': 'Создатель комнаты покинул игру. Комната закрыта.'
                                    })
                                    
                                    # Удаляем всех игроков из player_rooms
                                    for pid in list(room.players.keys()):
                                        if pid in self.player_rooms:
                                            del self.player_rooms[pid]
                                    
                                    # Удаляем комнату из памяти
                                    del self.rooms[room_id]
                                    
                                    # Удаляем комнату из БД
                                    await self.db.delete_room(room_id)
                                else:
                                    # Проверяем остались ли живые игроки (не боты)
                                    human_players = [p for p in room.players.values() if not p.is_bot]
                                    
                                    if len(human_players) == 0:
                                        # Если остались только боты или никого - удаляем комнату
                                        del self.rooms[room_id]
                                        # Удаляем из БД
                                        await self.db.delete_room(room_id)
                                    else:
                                        await self.broadcast_to_room(room_id, {
                                            'type': 'player_left',
                                            'player_id': player_id
                                        })
                                
                                await self.broadcast_rooms()
                                
                                # Удаляем из player_rooms только если игра не началась
                                if player_id in self.player_rooms:
                                    del self.player_rooms[player_id]
                
                # Всегда удаляем из clients (но НЕ из player_rooms если игра идёт)
                if ws in self.clients:
                    del self.clients[ws]

async def http_handler(request):
    """Serve static files with SPA fallback"""
    path = request.path
    if path == '/':
        path = '/index.html'
    
    file_path = os.path.join(os.path.dirname(__file__), 'client' + path)
    
    # Пытаемся отдать файл
    if os.path.exists(file_path) and os.path.isfile(file_path):
        with open(file_path, 'rb') as f:
            content = f.read()
        
        # Определяем MIME тип
        content_type = 'text/html'
        if path.endswith('.css'):
            content_type = 'text/css'
        elif path.endswith('.js'):
            content_type = 'application/javascript'
        elif path.endswith('.png'):
            content_type = 'image/png'
        elif path.endswith('.jpg') or path.endswith('.jpeg'):
            content_type = 'image/jpeg'
        elif path.endswith('.svg'):
            content_type = 'image/svg+xml'
        elif path.endswith('.md'):
            content_type = 'text/markdown'
        
        # Заголовки для отключения кэша (для разработки)
        headers = {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        }
        
        return web.Response(body=content, content_type=content_type, headers=headers, charset='utf-8')
    
    # SPA fallback - только для HTML маршрутов (не для статических файлов)
    # Если путь содержит расширение файла - это статический файл, возвращаем 404
    if '.' in path.split('/')[-1]:
        print(f"Static file not found: {path}")
        return web.Response(status=404, text='Not Found')
    
    # Для маршрутов без расширения (например /room/xxx) отдаём index.html
    print(f"SPA fallback for: {path}")
    index_path = os.path.join(os.path.dirname(__file__), 'client/index.html')
    if os.path.exists(index_path):
        with open(index_path, 'rb') as f:
            content = f.read()
        
        headers = {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        }
        
        return web.Response(body=content, content_type='text/html', headers=headers, charset='utf-8')
    
    return web.Response(status=404, text='Not Found')

async def main(clear_rooms=False):
    game_server = GameServer()
    
    # Подключаемся к PostgreSQL
    print("Connecting to PostgreSQL...")
    await game_server.db.connect()
    print("PostgreSQL connected successfully!")
    
    # Если указан флаг --clearrooms, удаляем все комнаты
    if clear_rooms:
        print("Clearing all rooms from database...")
        room_ids = await game_server.db.get_all_rooms()
        for room_id in room_ids:
            await game_server.db.delete_room(room_id)
        print(f"Deleted {len(room_ids)} rooms from database")
    else:
        # Очищаем старые комнаты
        await game_server.cleanup_old_rooms()
        
        # Загружаем существующие комнаты из БД
        await game_server.load_rooms_from_db()
    
    # Запускаем задачу периодической очистки
    cleanup_task = asyncio.create_task(game_server.start_cleanup_task())
    
    # WebSocket сервер
    async with serve(game_server.handle_client, "0.0.0.0", 8765):
        print("WebSocket server started on ws://0.0.0.0:8765")
        
        # HTTP сервер для статики
        app = web.Application()
        app.router.add_get('/{path:.*}', http_handler)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, '0.0.0.0', 8080)
        await site.start()
        
        print("HTTP server started on http://0.0.0.0:8080")
        print("Open https://domain.com in your browser")
        print("Automatic cleanup task started (runs every 6 hours)")
        
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    import sys
    
    # Проверяем аргументы командной строки
    clear_rooms = '--clearrooms' in sys.argv
    
    if clear_rooms:
        print("Starting with --clearrooms flag: all rooms will be deleted")
    
    asyncio.run(main(clear_rooms=clear_rooms))
