let socket;
let playerName;
let isCardCzar = false;

function connectToServer(serverIP) {
    socket = io(`http://${serverIP}:5000`);

    socket.on('connect', () => {
        console.log('Connected to server');
    });

    setupSocketListeners();
}

function setupSocketListeners() {

document.getElementById('login-form').addEventListener('submit', (event) => {
    event.preventDefault();
    playerName = document.getElementById('player-name').value;
    const serverIP = document.getElementById('server-ip').value;
    connectToServer(serverIP);
    socket.emit('join_game', { name: playerName });
});

socket.on('error', (data) => {
    alert(data.message);
});

socket.on('join_success', (data) => {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    updatePlayerHand(data.hand);
});

socket.on('player_list', (data) => {
    updateScoreboard(data.players);
});

socket.on('new_round', (data) => {
    console.log("New round started!");
    document.getElementById('black-card').textContent = data.blackCard;
    updateScoreboard(data.players);
    isCardCzar = data.players.find(p => p.name === playerName).isCzar;
    if (isCardCzar) {
        document.getElementById('submit-card').classList.add('hidden');
    } else {
        document.getElementById('submit-card').classList.remove('hidden');
    }
});

socket.on('update_hand', (data) => {
    updatePlayerHand(data.hand);
});

socket.on('card_submitted', (data) => {
    console.log(data.message);
});

socket.on('all_cards_submitted', (data) => {
    if (isCardCzar) {
        displaySubmittedCards(data.cards);
    }
});

socket.on('round_winner', (data) => {
    alert(`The winning card is: "${data.card}" played by ${data.player}`);
});

document.getElementById('submit-card').addEventListener('click', () => {
    const selectedCard = document.querySelector('#player-hand .card.selected');
    if (selectedCard) {
        socket.emit('submit_card', { card: selectedCard.textContent });
        selectedCard.remove();
    } else {
        alert('Please select a card to submit.');
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
        card.className = 'card';
        card.textContent = text;
        card.addEventListener('click', () => {
            if (isCardCzar) {
                socket.emit('select_winner', { card: text });
            }
        });
        whiteCards.appendChild(card);
    });
}
