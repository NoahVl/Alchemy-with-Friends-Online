let socket;
let playerName;
let isCardCzar = false;
let hasSelectedWinner = false;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-form').addEventListener('submit', (event) => {
        event.preventDefault();
        playerName = document.getElementById('player-name').value;
        const serverIP = document.getElementById('server-ip').value;
        connectToServer(serverIP);
    });
});

function connectToServer(serverIP) {
    socket = io(`http://${serverIP}:5000`);

    socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('join_game', {name: playerName});
    });

    setupSocketListeners();
}

function setupSocketListeners() {

    socket.on('error', (data) => {
        alert(data.message);
    });

    socket.on('join_success', (data) => {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        updatePlayerHand(data.hand);
        if (data.currentBlackCard) {
            updateBlackCard(data.currentBlackCard);
        }
    });

    function updateBlackCard(blackCard) {
        const blackCardElement = document.getElementById('black-card');
        if (blackCard && blackCard.text) {
            blackCardElement.textContent = blackCard.text;
            blackCardElement.dataset.pick = blackCard.pick || 1;
        } else {
            blackCardElement.textContent = 'Waiting for black card...';
            blackCardElement.dataset.pick = 1;
        }
        console.log("Updating black card:", blackCard);  // Debug log

        // Clear white cards
        const whiteCards = document.getElementById('white-cards');
        whiteCards.innerHTML = '';

        // Update submit button text
        const submitButton = document.getElementById('submit-card');
        submitButton.textContent = blackCard.pick === 2 ? 'Submit 2 Cards' : 'Submit Card';
    }

    socket.on('player_list', (data) => {
        updateScoreboard(data.players);
    });

    socket.on('new_round', (data) => {
        console.log("New round started!", data);  // Debug log
        hasSelectedWinner = false;  // Reset the flag at the start of each new round
        if (data.blackCard) {
            updateBlackCard(data.blackCard);
        } else {
            console.log("No black card in new_round data");  // Debug log
        }
        if (data.players) {
            updateScoreboard(data.players);
            const currentPlayer = data.players.find(p => p.name === playerName);
            if (currentPlayer) {
                isCardCzar = currentPlayer.isCzar;
                if (isCardCzar) {
                    document.getElementById('submit-card').classList.add('hidden');
                } else {
                    document.getElementById('submit-card').classList.remove('hidden');
                }
            }
        }
    });

    socket.on('update_hand', (data) => {
        updatePlayerHand(data.hand);
    });

    socket.on('card_submitted', (data) => {
        console.log(data.message);
    });

    socket.on('update_submitted_cards', (data) => {
        updateSubmittedCardsCount(data.count);
    });

    socket.on('all_cards_submitted', (data) => {
        displaySubmittedCards(data.cards);
    });

    socket.on('round_winner', (data) => {
        const winningCard = Array.from(document.querySelectorAll('#white-cards .card'))
            .find(card => card.textContent === data.card);
        if (winningCard) {
            winningCard.classList.add('winner');
            winningCard.title = `Winning card played by ${data.player}`;
        }
        console.log(`The winning card is: "${data.card}" played by ${data.player}`);
    });

    function updateSubmittedCardsCount(count) {
        const whiteCards = document.getElementById('white-cards');
        whiteCards.innerHTML = '';
        for (let i = 0; i < count; i++) {
            const card = document.createElement('div');
            card.className = 'card face-down';
            whiteCards.appendChild(card);
        }
    }

    socket.on('start_new_round_countdown', () => {
        console.log("Starting countdown for new round");
        let countdown = 10;
        const countdownInterval = setInterval(() => {
            console.log(`New round starting in ${countdown} seconds`);
            countdown--;
            if (countdown < 0) {
                clearInterval(countdownInterval);
                // Remove winner class from all cards
                document.querySelectorAll('.card').forEach(card => {
                    card.classList.remove('winner');
                    card.title = '';
                });
            }
        }, 1000);
    });

    document.getElementById('submit-card').addEventListener('click', () => {
        const blackCard = document.getElementById('black-card');
        const requiredCards = parseInt(blackCard.dataset.pick);
        const selectedCards = document.querySelectorAll('#player-hand .card.selected');
        
        if (selectedCards.length === requiredCards) {
            const cards = Array.from(selectedCards).map(card => card.textContent);
            socket.emit('submit_card', {cards: cards});
            selectedCards.forEach(card => card.remove());
        } else {
            alert(`Please select ${requiredCards} card${requiredCards > 1 ? 's' : ''} to submit.`);
        }
    });

    function updateScoreboard(players) {
        const playerInfo = document.getElementById('player-info');
        while (playerInfo.rows.length > 1) {
            playerInfo.deleteRow(1);
        }
        players.forEach(player => {
            const row = playerInfo.insertRow();
            const czarCell = row.insertCell();
            czarCell.textContent = player.isCzar ? String.fromCodePoint(0x1F451) : '';
            const nameCell = row.insertCell();
            nameCell.textContent = player.name;
            const scoreCell = row.insertCell();
            scoreCell.textContent = player.score;
        });
    }

    function updatePlayerHand(hand) {
        const playerHand = document.getElementById('player-hand');
        playerHand.innerHTML = '';
        hand.forEach(text => {
            const card = document.createElement('div');
            card.className = 'card';
            card.textContent = text;
            card.addEventListener('click', () => {
                if (!isCardCzar) {
                    document.querySelectorAll('#player-hand .card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                }
            });
            playerHand.appendChild(card);
        });
    }

    function displaySubmittedCards(cards) {
        const whiteCards = document.getElementById('white-cards');
        whiteCards.innerHTML = '';
        cards.forEach(text => {
            const card = document.createElement('div');
            card.className = 'card face-down';
            card.textContent = text;
            card.addEventListener('click', () => {
                if (isCardCzar && !hasSelectedWinner) {
                    socket.emit('select_winner', {card: text});
                    hasSelectedWinner = true;
                    whiteCards.classList.remove('czar-selecting');
                }
            });
            whiteCards.appendChild(card);
        });
        
        // Flip cards after a short delay
        setTimeout(() => {
            document.querySelectorAll('#white-cards .card').forEach(card => {
                card.classList.remove('face-down');
            });
            // Add czar-selecting class to enable hover effect
            if (isCardCzar && !hasSelectedWinner) {
                whiteCards.classList.add('czar-selecting');
            }
        }, 1000);
    }
}
