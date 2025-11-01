import asyncpg
import json
from typing import Optional, Dict, List
from datetime import datetime

class GameDatabase:
    def __init__(self, host: str = "localhost", port: int = 5432, 
                 database: str = "czechdb", user: str = "czech", 
                 password: str = "password"):
        self.host = host
        self.port = port
        self.database = database
        self.user = user
        self.password = password
        self.pool = None
    
    async def connect(self):
        """Создание пула соединений"""
        self.pool = await asyncpg.create_pool(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.user,
            password=self.password,
            min_size=2,
            max_size=10
        )
        await self.init_db()
    
    async def close(self):
        """Закрытие пула соединений"""
        if self.pool:
            await self.pool.close()
    
    async def init_db(self):
        """Инициализация базы данных"""
        async with self.pool.acquire() as conn:
            # Таблица комнат
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS rooms (
                    id TEXT PRIMARY KEY,
                    game_started BOOLEAN DEFAULT FALSE,
                    current_player_index INTEGER DEFAULT 0,
                    dealer_index INTEGER DEFAULT 0,
                    chosen_suit TEXT,
                    waiting_for_eight BOOLEAN DEFAULT FALSE,
                    card_drawn_this_turn BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Таблица игроков
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS players (
                    id TEXT PRIMARY KEY,
                    room_id TEXT,
                    nickname TEXT NOT NULL,
                    ready BOOLEAN DEFAULT FALSE,
                    score INTEGER DEFAULT 0,
                    player_order INTEGER DEFAULT 0,
                    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
                )
            ''')
            
            # Таблица карт в руке
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS player_cards (
                    id SERIAL PRIMARY KEY,
                    player_id TEXT,
                    card_suit TEXT NOT NULL,
                    card_rank TEXT NOT NULL,
                    card_id TEXT NOT NULL,
                    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
                )
            ''')
            
            # Таблица колоды
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS deck_cards (
                    id SERIAL PRIMARY KEY,
                    room_id TEXT,
                    card_suit TEXT NOT NULL,
                    card_rank TEXT NOT NULL,
                    card_id TEXT NOT NULL,
                    card_order INTEGER,
                    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
                )
            ''')
            
            # Таблица сброса
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS discard_pile (
                    id SERIAL PRIMARY KEY,
                    room_id TEXT,
                    card_suit TEXT NOT NULL,
                    card_rank TEXT NOT NULL,
                    card_id TEXT NOT NULL,
                    card_order INTEGER,
                    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
                )
            ''')
    
    async def save_room(self, room_data: Dict):
        """Сохранение состояния комнаты"""
        async with self.pool.acquire() as conn:
            await conn.execute('''
                INSERT INTO rooms 
                (id, game_started, current_player_index, dealer_index, chosen_suit, 
                 waiting_for_eight, card_drawn_this_turn, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
                ON CONFLICT (id) DO UPDATE SET
                    game_started = $2,
                    current_player_index = $3,
                    dealer_index = $4,
                    chosen_suit = $5,
                    waiting_for_eight = $6,
                    card_drawn_this_turn = $7,
                    updated_at = CURRENT_TIMESTAMP
            ''',
                room_data['id'],
                room_data['game_started'],
                room_data['current_player_index'],
                room_data['dealer_index'],
                room_data.get('chosen_suit'),
                room_data.get('waiting_for_eight', False),
                room_data.get('card_drawn_this_turn', False)
            )
    
    async def save_player(self, player_data: Dict, room_id: str, order: int):
        """Сохранение игрока"""
        async with self.pool.acquire() as conn:
            await conn.execute('''
                INSERT INTO players 
                (id, room_id, nickname, ready, score, player_order)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (id) DO UPDATE SET
                    room_id = $2,
                    nickname = $3,
                    ready = $4,
                    score = $5,
                    player_order = $6
            ''',
                player_data['id'],
                room_id,
                player_data['nickname'],
                player_data['ready'],
                player_data['score'],
                order
            )
    
    async def save_player_cards(self, player_id: str, cards: List[Dict]):
        """Сохранение карт игрока"""
        async with self.pool.acquire() as conn:
            # Удаляем старые карты
            await conn.execute('DELETE FROM player_cards WHERE player_id = $1', player_id)
            
            # Добавляем новые
            if cards:
                await conn.executemany('''
                    INSERT INTO player_cards (player_id, card_suit, card_rank, card_id)
                    VALUES ($1, $2, $3, $4)
                ''', [(player_id, card['suit'], card['rank'], card['id']) for card in cards])
    
    async def save_deck(self, room_id: str, cards: List[Dict]):
        """Сохранение колоды"""
        async with self.pool.acquire() as conn:
            await conn.execute('DELETE FROM deck_cards WHERE room_id = $1', room_id)
            
            if cards:
                await conn.executemany('''
                    INSERT INTO deck_cards (room_id, card_suit, card_rank, card_id, card_order)
                    VALUES ($1, $2, $3, $4, $5)
                ''', [(room_id, card['suit'], card['rank'], card['id'], idx) for idx, card in enumerate(cards)])
    
    async def save_discard_pile(self, room_id: str, cards: List[Dict]):
        """Сохранение сброса"""
        async with self.pool.acquire() as conn:
            await conn.execute('DELETE FROM discard_pile WHERE room_id = $1', room_id)
            
            if cards:
                await conn.executemany('''
                    INSERT INTO discard_pile (room_id, card_suit, card_rank, card_id, card_order)
                    VALUES ($1, $2, $3, $4, $5)
                ''', [(room_id, card['suit'], card['rank'], card['id'], idx) for idx, card in enumerate(cards)])
    
    async def load_room(self, room_id: str) -> Optional[Dict]:
        """Загрузка комнаты"""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow('SELECT * FROM rooms WHERE id = $1', room_id)
            
            if not row:
                return None
            
            return {
                'id': row['id'],
                'game_started': row['game_started'],
                'current_player_index': row['current_player_index'],
                'dealer_index': row['dealer_index'],
                'chosen_suit': row['chosen_suit'],
                'waiting_for_eight': row['waiting_for_eight'],
                'card_drawn_this_turn': row['card_drawn_this_turn']
            }
    
    async def load_players(self, room_id: str) -> List[Dict]:
        """Загрузка игроков комнаты"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch('''
                SELECT id, nickname, ready, score, player_order 
                FROM players 
                WHERE room_id = $1 
                ORDER BY player_order
            ''', room_id)
            
            return [{
                'id': row['id'],
                'nickname': row['nickname'],
                'ready': row['ready'],
                'score': row['score'],
                'order': row['player_order']
            } for row in rows]
    
    async def load_player_cards(self, player_id: str) -> List[Dict]:
        """Загрузка карт игрока"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch('''
                SELECT card_suit, card_rank, card_id 
                FROM player_cards 
                WHERE player_id = $1
            ''', player_id)
            
            return [{
                'suit': row['card_suit'],
                'rank': row['card_rank'],
                'id': row['card_id']
            } for row in rows]
    
    async def load_deck(self, room_id: str) -> List[Dict]:
        """Загрузка колоды"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch('''
                SELECT card_suit, card_rank, card_id 
                FROM deck_cards 
                WHERE room_id = $1 
                ORDER BY card_order
            ''', room_id)
            
            return [{
                'suit': row['card_suit'],
                'rank': row['card_rank'],
                'id': row['card_id']
            } for row in rows]
    
    async def load_discard_pile(self, room_id: str) -> List[Dict]:
        """Загрузка сброса"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch('''
                SELECT card_suit, card_rank, card_id 
                FROM discard_pile 
                WHERE room_id = $1 
                ORDER BY card_order
            ''', room_id)
            
            return [{
                'suit': row['card_suit'],
                'rank': row['card_rank'],
                'id': row['card_id']
            } for row in rows]
    
    async def delete_room(self, room_id: str):
        """Удаление комнаты и всех связанных данных"""
        async with self.pool.acquire() as conn:
            # Получаем всех игроков комнаты
            player_ids = await conn.fetch('SELECT id FROM players WHERE room_id = $1', room_id)
            
            # Удаляем карты игроков
            for row in player_ids:
                await conn.execute('DELETE FROM player_cards WHERE player_id = $1', row['id'])
            
            # Удаляем игроков
            await conn.execute('DELETE FROM players WHERE room_id = $1', room_id)
            
            # Удаляем колоду и сброс
            await conn.execute('DELETE FROM deck_cards WHERE room_id = $1', room_id)
            await conn.execute('DELETE FROM discard_pile WHERE room_id = $1', room_id)
            
            # Удаляем комнату
            await conn.execute('DELETE FROM rooms WHERE id = $1', room_id)
    
    async def room_exists(self, room_id: str) -> bool:
        """Проверка существования комнаты"""
        async with self.pool.acquire() as conn:
            result = await conn.fetchval('SELECT 1 FROM rooms WHERE id = $1 LIMIT 1', room_id)
            return result is not None
    
    async def get_all_rooms(self) -> List[str]:
        """Получение всех комнат"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch('SELECT id FROM rooms')
            return [row['id'] for row in rows]
    
    async def cleanup_old_rooms(self, hours: int = 24) -> int:
        """Удаление комнат, неактивных более N часов"""
        async with self.pool.acquire() as conn:
            # Находим старые комнаты
            rows = await conn.fetch('''
                SELECT id FROM rooms 
                WHERE updated_at < NOW() - INTERVAL '%s hours'
            ''' % hours)
            
            old_rooms = [row['id'] for row in rows]
        
        # Удаляем каждую старую комнату
        for room_id in old_rooms:
            await self.delete_room(room_id)
        
        return len(old_rooms)
    
    async def get_room_stats(self) -> Dict:
        """Получение статистики по комнатам"""
        async with self.pool.acquire() as conn:
            total_rooms = await conn.fetchval('SELECT COUNT(*) FROM rooms')
            active_games = await conn.fetchval('SELECT COUNT(*) FROM rooms WHERE game_started = TRUE')
            inactive_1h = await conn.fetchval('''
                SELECT COUNT(*) FROM rooms 
                WHERE updated_at < NOW() - INTERVAL '1 hour'
            ''')
            inactive_24h = await conn.fetchval('''
                SELECT COUNT(*) FROM rooms 
                WHERE updated_at < NOW() - INTERVAL '24 hours'
            ''')
            
            return {
                'total_rooms': total_rooms,
                'active_games': active_games,
                'inactive_1h': inactive_1h,
                'inactive_24h': inactive_24h
            }
