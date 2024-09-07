import json
import random
from threading import Lock

from flask import Flask, jsonify, request
from flask_cors import CORS
import time

# Create a lock
cards_stack_lock = Lock()
submitted_cards_lock = Lock()
players_lock = Lock()
winning_card_lock = Lock()

app = Flask(__name__)
CORS(app)

winning_card = None


def load_cards():
    # Load the cards from the JSON file
    with open('cards.json') as f:
        cards = json.load(f)
    # Randomly shuffle the white cards
    random.shuffle(cards['whiteCards'])

    return cards


cards = load_cards()

MAX_WHITE_CARDS = 3


def get_black_card():
    with cards_stack_lock:
        black_card = random.choice(cards['blackCards'])  # Update this when a new round has started
        cards['blackCards'].remove(black_card)  # Remove that card from the list

    return black_card


current_black_card = get_black_card()

# List of active players
players = []
submittedCards = []
czar_has_been_initialized = False


@app.route('/connect', methods=['POST'])
def connect():
    data = request.get_json()
    username = data.get('name')

    with cards_stack_lock:
        # Add the new player to the list
        hand = cards['whiteCards'][:MAX_WHITE_CARDS]  # Give the player MAX_WHITE_CARDS random white cards
        cards['whiteCards'] = cards['whiteCards'][MAX_WHITE_CARDS:]  # Remove the cards from the list

    with players_lock:
        global czar_has_been_initialized
        # Add the new player to the list
        players.append({"isCzar": czar_has_been_initialized is False,
                        "name": username,
                        "score": 0,
                        "lastHeartbeat": time.time(),
                        'hand': hand,  # Give the player 5 random white cards
                        })
        czar_has_been_initialized = True
    return jsonify(message=f"Hello, {username}!")


@app.route('/start-round', methods=['GET'])
def start_round():
    with cards_stack_lock:
        global current_black_card
        print(current_black_card)
        return jsonify(blackCard=current_black_card)


@app.route('/submit-card', methods=['POST'])
def submit_card():
    data = request.get_json()
    card = data.get('card')

    with submitted_cards_lock:
        submittedCards.append(card)

    return jsonify(message="Card submitted successfully.")


@app.route('/check-submissions', methods=['GET'])
def check_submissions():
    # If all players have submitted their cards, return the submitted cards
    with submitted_cards_lock:
        # We need at least 2 players to start the game
        if len(players) > 1 and len(submittedCards) == len(players) - 1:  # -1 because the czar doesn't submit a card
            return jsonify(submittedCards=submittedCards,
                           czar={"name": next(player['name'] for player in players if player['isCzar'])})
        else:
            return jsonify(message="Waiting for players to submit.")


@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    data = request.get_json()
    username = data.get('name')
    # Update the player's last heartbeat time
    for player in players:
        if player['name'] == username:
            player['lastHeartbeat'] = time.time()
    return jsonify(message=f"Heartbeat received from {username}")


@app.route('/scoreboard', methods=['GET'])
def scoreboard():
    with players_lock:
        # Remove players who haven't sent a heartbeat in the last 10 seconds
        players[:] = [player for player in players if time.time() - player['lastHeartbeat'] < 10]

        # If our czar has left, we need to assign it to a new player
        if len([player for player in players if player['isCzar']]) == 0:
            if len(players) > 0:
                # Select a random player to be the czar
                random.choice(players)['isCzar'] = True

    # Return the list of players
    return jsonify(players=players)


@app.route('/czar-rating', methods=['GET'])
def czar_rating():
    # Find the Czar's choice
    czar_choice = None

    global winning_card

    with winning_card_lock:
        czar_choice = winning_card

    # Return the Czar's choice in the response
    return jsonify(czarChoice=czar_choice)


@app.route('/select-winner', methods=['POST'])
def select_winner():
    data = request.get_json()

    global winning_card

    with winning_card_lock:
        winning_card = data.get('card')

    # Find the player who submitted the winning card
    winner = next((player for player in players if winning_card in player['hand']), None)

    if winner:
        # Increment the winner's score
        winner['score'] += 1

    # Start new round
    start_new_round()

    return jsonify(message="Winner selected successfully.")


def start_new_round():
    global current_black_card
    global cards

    with cards_stack_lock:
        current_black_card = get_black_card()

        # Remove the submitted cards from the players' hands
        with submitted_cards_lock:
            for player in players:
                player['hand'] = [card for card in player['hand'] if
                                  card not in submittedCards]  # TODO: Needs to be rewritten if you want to include joker cards

        # Clear submitted cards
        submittedCards.clear()

        # Fill up the players' hands to MAX_WHITE_CARDS
        for player in players:
            # If we run out of white cards, reload the cards
            if len(cards['whiteCards']) < MAX_WHITE_CARDS - len(player['hand']):
                cards = load_cards()

            player['hand'].extend(cards['whiteCards'][:MAX_WHITE_CARDS - len(
                player['hand'])])  # Give the player MAX_WHITE_CARDS random white cards
            cards['whiteCards'] = cards['whiteCards'][
                                  MAX_WHITE_CARDS - len(player['hand']):]  # Remove the cards from the list

    # Find the next Czar
    with players_lock:
        czar_index = next((i for i, player in enumerate(players) if player['isCzar']), None)
        players[czar_index]['isCzar'] = False
        players[(czar_index + 1) % len(players)]['isCzar'] = True


if __name__ == '__main__':
    app.run(debug=True)
