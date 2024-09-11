import json
import random
from flask import Flask, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
from threading import Lock

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Create locks
cards_stack_lock = Lock()
black_cards_lock = Lock()
players_lock = Lock()

# Path to your certificate and key files
ssl_context = ('./cert.pem', './key.pem')

# Load cards
def load_cards():
    with open('cards.json') as f:
        cards = json.load(f)
    random.shuffle(cards['whiteCards'])
    random.shuffle(cards['blackCards'])
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
    with black_cards_lock:
        if not cards['blackCards']:
            print("Reloading black cards")  # Debug print
            cards.update(load_cards())
        black_card = cards['blackCards'].pop()
    return {'text': black_card['text'], 'pick': black_card.get('pick', 1)}

def start_new_round():
    global current_black_card, submitted_cards, winning_card, game_in_progress
    
    print("Starting new round")  # Debug print
    
    current_black_card = get_black_card()
    submitted_cards = []
    winning_card = None
    
    print(f"New black card: {current_black_card}")  # Debug print

    with cards_stack_lock:
        for player in players:
            cards_needed = MAX_WHITE_CARDS - len(player['hand'])
            if cards_needed > 0:
                if len(cards['whiteCards']) < cards_needed:
                    print("Reloading white cards")  # Debug print
                    cards.update(load_cards())
                player['hand'].extend(cards['whiteCards'][:cards_needed])
                cards['whiteCards'] = cards['whiteCards'][cards_needed:]

    with players_lock:
        czar_index = next((i for i, player in enumerate(players) if player['isCzar']), None)
        if czar_index is not None:
            players[czar_index]['isCzar'] = False
            players[(czar_index + 1) % len(players)]['isCzar'] = True
        else:
            players[0]['isCzar'] = True

    print(f"Emitting new_round event with black card: {current_black_card}")  # Debug print
    socketio.emit('new_round', {'blackCard': current_black_card, 'players': [{'name': p['name'], 'isCzar': p['isCzar'], 'score': p['score']} for p in players]})
    for player in players:
        socketio.emit('update_hand', {'hand': player['hand']}, room=player['sid'])
    
    game_in_progress = True
    print("New round started successfully")  # Debug print

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
    global game_in_progress
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
    
    print(f"Player {username} joined. Total players: {len(players)}")  # Debug print
    
    if len(players) == 2:
        print("Starting new game with 2 players")  # Debug print
        start_new_round()
    elif game_in_progress:
        print(f"Game in progress, sending current state to {username}")  # Debug print
        emit('new_round', {'blackCard': current_black_card, 'players': [{'name': p['name'], 'isCzar': p['isCzar'], 'score': p['score']} for p in players]})

@socketio.on('submit_card')
def handle_submit_card(data):
    cards = data['cards']
    player = next((p for p in players if p['sid'] == request.sid), None)
    if player and not player['isCzar'] and all(card in player['hand'] for card in cards):
        existing_submission = next((s for s in submitted_cards if s['player'] == player['name']), None)
        if existing_submission:
            # Player has already submitted, don't allow another submission
            emit('error', {'message': 'You have already submitted cards for this round'})
            return
        else:
            submitted_cards.append({'cards': cards, 'player': player['name']})
        for card in cards:
            player['hand'].remove(card)
        emit('card_submitted', {'message': 'Card(s) submitted successfully'})
        socketio.emit('update_submitted_cards', {'count': len(submitted_cards)})
        
        all_submissions_complete = all(len(s['cards']) == current_black_card['pick'] for s in submitted_cards)
        if len(submitted_cards) == len(players) - 1 and all_submissions_complete:  # All non-Czar players have submitted all required cards
            # Shuffle the submitted cards before sending them
            shuffled_submissions = submitted_cards.copy()
            random.shuffle(shuffled_submissions)
            socketio.emit('all_cards_submitted', {'submissions': shuffled_submissions})

@socketio.on('select_winner')
def handle_select_winner(data):
    global winning_submission
    winning_submission = data['submission']
    winner = next((sc['player'] for sc in submitted_cards if sc['cards'] == winning_submission), None)
    if winner:
        for player in players:
            if player['name'] == winner:
                player['score'] += 1 # Even when multiple cards have to be selected, the user gets 1 point.
                break
    
    socketio.emit('round_winner', {'cards': winning_submission, 'player': winner})
    socketio.emit('start_new_round_countdown')
    socketio.sleep(10)
    start_new_round()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, ssl_context=ssl_context)
