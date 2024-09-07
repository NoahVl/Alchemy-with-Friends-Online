import json
import random
from flask import Flask, request
from flask_socketio import SocketIO, emit, join_room, leave_room
from threading import Lock

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Create locks
cards_stack_lock = Lock()
players_lock = Lock()

# Load cards
def load_cards():
    with open('cards.json') as f:
        cards = json.load(f)
    random.shuffle(cards['whiteCards'])
    return cards

cards = load_cards()
MAX_WHITE_CARDS = 3

# Game state
players = []
current_black_card = None
submitted_cards = []
winning_card = None
game_in_progress = False

def get_black_card():
    with cards_stack_lock:
        black_card = random.choice(cards['blackCards'])
        cards['blackCards'].remove(black_card)
    return {'text': black_card}

def start_new_round():
    global current_black_card, submitted_cards, winning_card
    
    with cards_stack_lock:
        current_black_card = get_black_card()
        submitted_cards = []
        winning_card = None
    
    print(f"New black card: {current_black_card}")  # Debug print

        for player in players:
            cards_needed = MAX_WHITE_CARDS - len(player['hand'])
            if cards_needed > 0:
                if len(cards['whiteCards']) < cards_needed:
                    cards.update(load_cards())
                player['hand'].extend(cards['whiteCards'][:cards_needed])
                cards['whiteCards'] = cards['whiteCards'][cards_needed:]

    with players_lock:
        czar_index = next((i for i, player in enumerate(players) if player['isCzar']), None)
        if czar_index is not None:
            players[czar_index]['isCzar'] = False
            players[(czar_index + 1) % len(players)]['isCzar'] = True

    socketio.emit('new_round', {'blackCard': current_black_card, 'players': [{'name': p['name'], 'isCzar': p['isCzar'], 'score': p['score']} for p in players]})
    for player in players:
        socketio.emit('update_hand', {'hand': player['hand']}, room=player['sid'])

@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")
    emit('connection_success', {'message': 'Successfully connected to server'})

@socketio.on('disconnect')
def handle_disconnect():
    global game_in_progress
    with players_lock:
        players[:] = [p for p in players if p['sid'] != request.sid]
        if len(players) == 0:
            game_in_progress = False
        elif len(players) == 1:
            players[0]['isCzar'] = True
    socketio.emit('player_list', {'players': [{'name': p['name'], 'isCzar': p['isCzar'], 'score': p['score']} for p in players]})

@socketio.on('join_game')
def handle_join(data):
    username = data['name']
    with players_lock:
        if any(p['name'] == username for p in players):
            emit('error', {'message': 'Username already taken'})
            return
        
        hand = cards['whiteCards'][:MAX_WHITE_CARDS]
        cards['whiteCards'] = cards['whiteCards'][MAX_WHITE_CARDS:]
        
        player = {
            'sid': request.sid,
            'name': username,
            'isCzar': len(players) == 0,
            'score': 0,
            'hand': hand
        }
        players.append(player)
        join_room(request.sid)
    
    emit('join_success', {'hand': hand, 'currentBlackCard': current_black_card})
    socketio.emit('player_list', {'players': [{'name': p['name'], 'isCzar': p['isCzar'], 'score': p['score']} for p in players]})
    
    global game_in_progress
    if len(players) >= 2 and not game_in_progress:
        game_in_progress = True
        start_new_round()
    elif game_in_progress:
        emit('new_round', {'blackCard': current_black_card, 'players': [{'name': p['name'], 'isCzar': p['isCzar'], 'score': p['score']} for p in players]})

@socketio.on('submit_card')
def handle_submit_card(data):
    card = data['card']
    player = next((p for p in players if p['sid'] == request.sid), None)
    if player and not player['isCzar'] and card in player['hand']:
        submitted_cards.append({'card': card, 'player': player['name']})
        player['hand'].remove(card)
        emit('card_submitted', {'message': 'Card submitted successfully'})
        
        if len(submitted_cards) == len(players) - 1:  # All non-Czar players have submitted
            czar = next(p for p in players if p['isCzar'])
            socketio.emit('all_cards_submitted', {'cards': [sc['card'] for sc in submitted_cards]}, room=czar['sid'])

@socketio.on('select_winner')
def handle_select_winner(data):
    global winning_card
    winning_card = data['card']
    winner = next((sc['player'] for sc in submitted_cards if sc['card'] == winning_card), None)
    if winner:
        for player in players:
            if player['name'] == winner:
                player['score'] += 1
                break
    
    socketio.emit('round_winner', {'card': winning_card, 'player': winner})
    start_new_round()

if __name__ == '__main__':
    socketio.run(app, debug=True)
