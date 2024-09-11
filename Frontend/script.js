let socket;
let playerName;
let isCardCzar = false;
let hasSelectedWinner = false;
let hasSubmittedCards = false;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-form').addEventListener('submit', (event) => {
        event.preventDefault();
        playerName = document.getElementById('player-name').value;
        const serverIP = document.getElementById('server-ip').value;
        connectToServer(serverIP);
    });
});

function connectToServer(serverIP) {
    console.log(`Attempting to connect to server at ${serverIP}`);
    socket = io(serverIP, {
        transports: ['websocket'],
        upgrade: false,
        reconnection: true,
        reconnectionAttempts: 5
    });

    socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('join_game', {name: playerName});
    });

    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
    });

    socket.on('disconnect', (reason) => {
        console.log('Disconnected:', reason);
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
        hasSubmittedCards = false;  // Reset the submission flag at the start of each new round
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
                const submitButton = document.getElementById('submit-card');
                if (isCardCzar) {
                    submitButton.classList.add('hidden');
                } else {
                    submitButton.classList.remove('hidden');
                    submitButton.disabled = false;  // Enable the submit button
                    submitButton.textContent = 'Submit Card';  // Reset button text
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
        displaySubmittedCards(data.submissions);
    });

    socket.on('round_winner', (data) => {
        const winningCards = Array.from(document.querySelectorAll('#white-cards .card'))
            .filter(card => data.cards.includes(card.textContent));
        winningCards.forEach(card => {
            card.classList.add('winner');
            card.title = `Winning card played by ${data.player}`;
        });
        console.log(`The winning cards are: "${data.cards.join(', ')}" played by ${data.player}`);
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

    let selectedCards = [];
    
    document.getElementById('submit-card').addEventListener('click', () => {
        if (hasSubmittedCards) {
            alert('You have already submitted your card(s) for this round.');
            return;
        }

        const blackCard = document.getElementById('black-card');
        const requiredCards = parseInt(blackCard.dataset.pick);
        const selectedCard = document.querySelector('#player-hand .card.selected');
        
        if (selectedCard) {
            selectedCards.push(selectedCard.textContent);
            selectedCard.remove();
            
            if (selectedCards.length === requiredCards) {
                socket.emit('submit_card', {cards: selectedCards});
                selectedCards = [];
                document.getElementById('submit-card').textContent = 'Submit Card';
                hasSubmittedCards = true;
                document.getElementById('submit-card').disabled = true;
            } else {
                document.getElementById('submit-card').textContent = 'Submit 2nd Card';
            }
        } else {
            alert(`Please select a card to submit.`);
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
            card.innerHTML = text;
            card.addEventListener('click', () => {
                if (!isCardCzar) {
                    document.querySelectorAll('#player-hand .card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                }
            });
            playerHand.appendChild(card);
        });
        
        // Reset submit button text
        document.getElementById('submit-card').textContent = 'Submit Card';
    }

    function displaySubmittedCards(submissions) {
        const whiteCards = document.getElementById('white-cards');
        whiteCards.innerHTML = '';
        submissions.forEach(submission => {
            const submissionContainer = document.createElement('div');
            submissionContainer.className = 'submission-container';
            submission.cards.forEach(text => {
                const card = document.createElement('div');
                card.className = 'card face-down';
                card.textContent = text;
                submissionContainer.appendChild(card);
            });
            submissionContainer.addEventListener('click', () => {
                if (isCardCzar && !hasSelectedWinner) {
                    socket.emit('select_winner', {submission: submission.cards});
                    hasSelectedWinner = true;
                    whiteCards.classList.remove('czar-selecting');
                }
            });
            whiteCards.appendChild(submissionContainer);
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
