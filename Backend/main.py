import json
import random
import os
from urllib.parse import urlparse, urlunparse

from flask import Flask, request, redirect
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
from threading import Lock

import logging

# Configuration
INCLUDE_BLANK_CARDS = True  # Set this to False to disable blank cards, strangers might not behave well with them enabled
BLANK_CARD_PROBABILITY = 0.05  # 5% chance for a card to be blank
GAME_SITE_URL = "https://nogames.surge.sh"

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

@app.route('/')
def hello():
    # Redirecting logic for when connecting directly to the server

    # Parse the original URL
    parsed_url = urlparse(request.url)
    # Force the scheme to https
    https_url = parsed_url._replace(scheme="https")
    origin_url = urlunparse(https_url)

    # Redirect to the game site
    return redirect(f"{GAME_SITE_URL}?origin={origin_url}", code=302)

def log_socket_event(event, data=None):
    logger.info(f"Socket event: {event}")
    if data:
        logger.info(f"Data: {data}")

# Create locks
cards_stack_lock = Lock()
black_cards_lock = Lock()
players_lock = Lock()
submitted_cards_lock = Lock()

# Load cards
def load_cards():
    with open('cards.json') as f:
        cards = json.load(f)
    
    if INCLUDE_BLANK_CARDS:
        blank_cards = ['[BLANK]'] * int(len(cards['whiteCards']) * BLANK_CARD_PROBABILITY)
        cards['whiteCards'].extend(blank_cards)
    
    random.shuffle(cards['whiteCards'])
    random.shuffle(cards['blackCards'])
    return cards

cards = load_cards()
MAX_WHITE_CARDS = 7

# Game state
players = []
current_black_card = None
submitted_cards = []
winning_card = None
game_in_progress = False

SCORES_FILE = 'player_scores.json'

def save_scores():
    scores = {player['name']: player['score'] for player in players}
    with open(SCORES_FILE, 'w') as f:
        json.dump(scores, f)

def load_scores():
    if os.path.exists(SCORES_FILE):
        with open(SCORES_FILE, 'r') as f:
            return json.load(f)
    return {}

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
    log_socket_event('connect', {'sid': request.sid})
    emit('connection_success', {'message': 'Successfully connected to server'})

@socketio.on('disconnect')
def handle_disconnect():
    global game_in_progress
    log_socket_event('disconnect', {'sid': request.sid})
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
    log_socket_event('join_game', data)
    username = data['name']
    with players_lock:
        if any(p['name'] == username for p in players):
            log_socket_event('error', {'message': 'Username already taken'})
            emit('error', {'message': 'Username already taken'})
            return
        
        hand = cards['whiteCards'][:MAX_WHITE_CARDS]
        cards['whiteCards'] = cards['whiteCards'][MAX_WHITE_CARDS:]
        
        scores = load_scores()
        player = {
            'sid': request.sid,
            'name': username,
            'isCzar': len(players) == 0,
            'score': scores.get(username, 0),  # Load the score if it exists, otherwise 0
            'hand': hand
        }
        players.append(player)
        join_room(request.sid)
    
    log_socket_event('join_success', {'player': username, 'hand_size': len(hand)})
    emit('join_success', {'hand': hand, 'currentBlackCard': current_black_card})
    socketio.emit('player_list', {'players': [{'name': p['name'], 'isCzar': p['isCzar'], 'score': p['score']} for p in players]})
    
    log_socket_event('player_joined', {'username': username, 'total_players': len(players)})
    
    if len(players) == 2:
        log_socket_event('starting_new_game', {'players': len(players)})
        start_new_round()
    elif game_in_progress:
        log_socket_event('game_in_progress', {'username': username})
        emit('new_round', {'blackCard': current_black_card, 'players': [{'name': p['name'], 'isCzar': p['isCzar'], 'score': p['score']} for p in players]})

@socketio.on('submit_card')
def handle_submit_card(data):
    player_submitted_cards: list = data['cards']
    player = next((p for p in players if p['sid'] == request.sid), None)

    print(f"Player {player['name']} submitted cards: {player_submitted_cards}")  # Debug print

    with submitted_cards_lock:
        if player and not player['isCzar'] and all(card in player['hand'] or
                                                   "BLANK" in card and any("BLANK" in card for card in player['hand'])
                                                   for card in player_submitted_cards):
            existing_submission = next((s for s in submitted_cards if s['player'] == player['name']), None)
            if existing_submission:
                # Player has already submitted, don't allow another submission
                emit('error', {'message': 'You have already submitted cards for this round'})
                return
            else:
                submitted_cards.append({'cards': player_submitted_cards, 'player': player['name']})
            for card in player_submitted_cards:
                with players_lock:
                    if card in player['hand']:
                        player['hand'].remove(card)
                    elif "BLANK" in card:  # Not a robust method as the client can pretend they had a blank card, but hac
                        # Remove the first blank card from the player's hand
                        player['hand'].remove(next(c for c in player['hand'] if "BLANK" in c))
                    else:
                        # Someone has been cheating :(
                        print(f"Player {player['name']} tried to submit a card they don't have: {card}") # Debug print
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
    save_scores()  # Save scores after each round
    socketio.sleep(5)
    start_new_round()

if __name__ == '__main__':
    logger.info("Starting the server...")
    socketio.run(app, host='0.0.0.0', port=25565, debug=True, allow_unsafe_werkzeug=True)
