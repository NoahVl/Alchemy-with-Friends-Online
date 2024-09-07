let checkSubmissionsInterval; // Declare the interval variable outside the function
let checkCzarRatingInterval;

document.getElementById('login-form').addEventListener('submit', (event) => {
    // Prevent the form from submitting normally
    event.preventDefault();

    // Get the IP address and player name from the form
    const ipAddress = document.getElementById('ip-address').value;
    const playerName = document.getElementById('player-name').value;

    // Connect to the server
    fetch(`http://${ipAddress}:5000/connect`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({name: playerName}),
    })
        .then(response => response.json())
        .then(data => {
            // Handle the response from the server
            console.log(data);

            // Hide the login screen and show the game screen
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('game-screen').classList.remove('hidden');

            updateScoreboard();
            startNewRound();
            // Call the function to update the scoreboard every 5 seconds
            setInterval(updateScoreboard, 5000);

            // Send a heartbeat every 5 seconds
            setInterval(sendHeartbeat, 5000)
        })
        .catch((error) => {
            console.error('Error:', error);
        });
});

document.getElementById('submit-card').addEventListener('click', () => {
    // Get the selected card
    const selectedCard = document.querySelector('#player-hand .card.selected');
    if (selectedCard) {
        // Get the IP address from the form
        const ipAddress = document.getElementById('ip-address').value;

        // Send a POST request to the /submit-card endpoint with the selected card
        fetch(`http://${ipAddress}:5000/submit-card`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ card: selectedCard.textContent }),
        })
            .then(response => response.json())
            .then(data => {
                // Handle the response from the server
                console.log(data);

                // Remove the 'selected' class from the card
                selectedCard.classList.remove('selected');

                // Move the card to the white answer cards
                document.getElementById('white-cards').appendChild(selectedCard);

                // Start checking if all players have submitted their cards every 5 seconds
                checkSubmissionsInterval = setInterval(checkSubmissions, 5000);
            })
            .catch((error) => {
                console.error('Error:', error);
            });
    } else {
        // If no card is selected, alert the player
        alert('Please select a card to submit.');
    }
});

// Function to update the scoreboard
function updateScoreboard() {
    // Get the IP address from the form
    const ipAddress = document.getElementById('ip-address').value;

    // Fetch the list of players from the server
    fetch(`http://${ipAddress}:5000/scoreboard`)
        .then(response => response.json())
        .then(data => {
            const {players} = data;

            // Clear the player info table
            const playerInfo = document.getElementById('player-info');
            while (playerInfo.rows.length > 1) {
                playerInfo.deleteRow(1);
            }

            // Add a row for each player
            players.forEach(player => {
                const row = playerInfo.insertRow();

                // Czar column
                const czarCell = row.insertCell();
                czarCell.textContent = player.isCzar ? String.fromCodePoint(0x1F451) : '';

                // Name column
                const nameCell = row.insertCell();
                nameCell.textContent = player.name;

                // Score column
                const scoreCell = row.insertCell();
                scoreCell.textContent = player.score;
            });
        })
        .catch((error) => {
            console.error('Error:', error);
        });
}

// Function to send a heartbeat
function sendHeartbeat() {
    // Get the IP address and player name from the form
    const ipAddress = document.getElementById('ip-address').value;
    const playerName = document.getElementById('player-name').value;

    // Send a POST request to the /heartbeat endpoint
    fetch(`http://${ipAddress}:5000/heartbeat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: playerName }),
    })
        .then(response => response.json())
        .then(data => {
            // Handle the response from the server
            console.log(data);
        })
        .catch((error) => {
            console.error('Error:', error);
        });
}

// Function to start a new round
function startNewRound() {
    console.log("New round started!")
    // Get the IP address from the form
    const ipAddress = document.getElementById('ip-address').value;

    // Fetch the black card for the round
    fetch(`http://${ipAddress}:5000/start-round`)
        .then(response => response.json())
        .then(data => {
            console.log("New black card: ", data.blackCard)
            // Update the black card
            const blackCard = document.getElementById('black-card');
            blackCard.textContent = data.blackCard;
        })
        .catch((error) => {
            console.error('Error:', error);
        });

    // Fetch the player's hand
    fetch(`http://${ipAddress}:5000/scoreboard`)
        .then(response => response.json())
        .then(data => {
            const playerName = document.getElementById('player-name').value;
            const player = data.players.find(player => player.name === playerName);
            if (player) {
                // Update the player's hand
                updatePlayerHand(player.hand);

                // If the current player was the czar, enable their cards
                const playerHand = document.getElementById('player-hand');
                Array.from(playerHand.children).forEach(card => {
                    card.classList.remove('disabled');
                    card.classList.remove('selected');
                });

                // If the current player is the czar, disable their cards
                if (player.isCzar && player.name === playerName) {
                    Array.from(playerHand.children).forEach(card => {
                        card.classList.add('disabled');
                    });

                    // Start checking if all players have submitted their cards every 5 seconds
                    checkSubmissionsInterval = setInterval(checkSubmissions, 5000);
                }
            }
        })
        .catch((error) => {
            console.error('Error:', error);
        });
}

// Function to check the Czar's rating
function checkCzarRating() {
    // Get the IP address from the form
    const ipAddress = document.getElementById('ip-address').value;

    // Send a GET request to the /czar-rating endpoint
    fetch(`http://${ipAddress}:5000/czar-rating`)
        .then(response => response.json())
        .then(data => {
            // If the response contains the Czar's choice, highlight it
            if (data.czarChoice) {
                const whiteCards = document.getElementById('white-cards');
                const chosenCard = Array.from(whiteCards.children).find(card => card.textContent === data.czarChoice);

                // Only if we can find the submitted card
                if (chosenCard) {
                    chosenCard.style.backgroundColor = 'gold'; // Highlight the chosen card

                    // Clear the interval
                    clearInterval(checkCzarRatingInterval);

                    // Delay the start of the new round by 5 seconds
                    setTimeout(startNewRound, 5000);
                }
            }
        })
        .catch((error) => {
            console.error('Error:', error);
        });
}

// Function to check if all players have submitted their cards
function checkSubmissions() {
    console.log('Checking submissions...');

    // Get the IP address from the form
    const ipAddress = document.getElementById('ip-address').value;

    // Send a GET request to the /check-submissions endpoint
    fetch(`http://${ipAddress}:5000/check-submissions`)
        .then(response => response.json())
        .then(data => {
            // If the response contains the submitted cards, display them
            if (data.submittedCards) {
                const whiteCards = document.getElementById('white-cards');
                while (whiteCards.firstChild) {
                    whiteCards.removeChild(whiteCards.firstChild);
                }
                data.submittedCards.forEach(text => {
                    const card = document.createElement('div');
                    card.className = 'card';
                    card.textContent = text;
                    whiteCards.appendChild(card);
                });

                // Clear the interval
                clearInterval(checkSubmissionsInterval);
                checkCzarRatingInterval = setInterval(checkCzarRating, 5000);

                // If the current player is the czar, allow them to select a card
                const playerName = document.getElementById('player-name').value;
                if (data.czar && data.czar.name === playerName) {
                    Array.from(whiteCards.children).forEach(card => {
                        card.addEventListener('click', () => {
                            card.style.backgroundColor = 'gold'; // Highlight the chosen card

                            fetch(`http://${ipAddress}:5000/select-winner`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({ card: card.textContent, czar: playerName }),
                            })
                                .then(response => response.json())
                                .catch((error) => {
                                    console.error('Error:', error);
                                });
                        });
                    });
                }
            }

        })
        .catch((error) => {
            console.error('Error:', error);
        });
}

// Function to update the player's hand
function updatePlayerHand(hand) {
    const playerHand = document.getElementById('player-hand');
    while (playerHand.firstChild) {
        playerHand.removeChild(playerHand.firstChild);
    }
    hand.forEach(text => {
        const card = document.createElement('div');
        card.className = 'card';
        card.textContent = text;
        playerHand.appendChild(card);

        // Add the event listener to the card
        card.addEventListener('click', () => {
            // Check if the clicked card is already selected
            if (card.classList.contains('selected')) {
                // If it is, remove the 'selected' class from it
                card.classList.remove('selected');
            } else {
                // Check if there's already a selected card
                const selectedCard = document.querySelector('#player-hand .card.selected');
                if (selectedCard) {
                    // If there is, remove the 'selected' class from it
                    selectedCard.classList.remove('selected');
                }
                // Add the 'selected' class to the clicked card
                card.classList.add('selected');
            }
        });
    });
}