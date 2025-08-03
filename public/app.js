let provider = null;
let signer = null;
let whisperNFTContract = null;
let WHISPER_NFT_ABI = null;
let CONTRACT_ADDRESS = null;
let lastMintAttemptTime = 0;
const MINT_ATTEMPT_COOLDOWN_MS = 60000; // minute cooldown for mint attempts

// Predefined ephemeral thoughts for inspiration
const EPHEMERAL_THOUGHT_PROMPTS = [
  "The stranger's smile I caught on the subway felt like a secret meant just for me.",
  "Between the raindrops on the window, I swear I saw my childhood reflection.",
  "The coffee shop's playlist whispered memories I didn't know I had.",
  "A fleeting doubt about whether my dreams are mine or echoes of someone else's.",
  "The weight of an unread message from last year still sits in my inbox.",
  "Sometimes I wonder if my cat judges my life choices more than my friends do.",
  "The silence between stars speaks louder than any song.",
  "I left a part of my heart in a book I'll never read again.",
  "The barista knows my order, but I don't know hers. Isn't that modern intimacy?",
  "A glitch in the matrix? Or just my mind playing tricks at 3 AM?"
];

// --- DOM Elements ---
// Wallet Widget Elements
const walletWidget = document.getElementById('wallet-widget');
const walletButton = document.getElementById('wallet-button');
const walletIconDisconnected = document.getElementById('wallet-icon-disconnected');
const walletIconConnected = document.getElementById('wallet-icon-connected');
const walletTooltip = document.getElementById('wallet-tooltip');
const walletTooltipText = document.getElementById('wallet-tooltip-text');
const walletInfoConnected = document.getElementById('wallet-info-connected');
const walletInfoDisconnected = document.getElementById('wallet-info-disconnected');
const walletConnectedAddress = document.getElementById('wallet-connected-address');
const disconnectButton = document.getElementById('disconnect-button');

// Main Sections and Elements
const walletStatusDiv = document.getElementById('wallet-status');
const walletMessageP = document.getElementById('wallet-message');
const connectButtonMain = document.getElementById('connect-button-main');
const submitSection = document.getElementById('submit-section');
const rawWhisperTextarea = document.getElementById('raw-whisper');

const originalPreviewDiv = document.getElementById('original-preview');
const originalTextPreviewP = document.getElementById('original-text-preview');
const reScrambleButton = document.getElementById('re-scramble-button');
// Ephemeral Prompts
const promptsContainer = document.getElementById('ephemeral-prompts-container');
const promptsDiv = document.getElementById('ephemeral-prompts');

// Scramble Section
const scrambleButton = document.getElementById('scramble-button');
const scrambleSpinner = document.getElementById('scramble-spinner');
const scrambleSpinnerText = document.getElementById('scramble-spinner-text');
const scramblePreviewDiv = document.getElementById('scramble-preview');
const scrambledTextP = document.getElementById('scrambled-text');

// Mint Section
const durationSelectorDiv = document.getElementById('duration-selector');
const durationSelect = document.getElementById('duration');
const mintButton = document.getElementById('mint-button');
const mintSpinner = document.getElementById('mint-spinner');
const mintSpinnerText = document.getElementById('mint-spinner-text');
const submitErrorDiv = document.getElementById('submit-error');

// Feed Section
const feedSection = document.getElementById('feed-section');
const loadingSpinner = document.getElementById('loading-spinner');
const feedErrorDiv = document.getElementById('feed-error');
const whisperFeedDiv = document.getElementById('whisper-feed');
const noWhispersMessage = document.getElementById('no-whispers-message');

// --- Utility Functions ---

/**
 * Selects a specified number of unique random elements from an array.
 * @param {Array} array - The array to select from.
 * @param {number} count - The number of elements to select.
 * @returns {Array} - An array of randomly selected elements.
 */
function getRandomPrompts(array, count) {
    if (count >= array.length) {
        // If requesting more prompts than available, return a shuffled copy of the whole array
        const shuffled = [...array].sort(() => 0.5 - Math.random());
        return shuffled;
    }

    const selected = [];
    const available = [...array]; // Work with a copy to avoid modifying the original

    for (let i = 0; i < count; i++) {
        const randomIndex = Math.floor(Math.random() * available.length);
        selected.push(available[randomIndex]);
        // Remove the selected element to ensure uniqueness
        available.splice(randomIndex, 1);
    }

    return selected;
}

// Function to validate Ethereum address format
function isValidEthereumAddress(address) {
    if (!address) return false;
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Function to load ABI from public folder
async function loadABI() {
    try {
        console.log("Attempting to load ABI from /WhisperNFT.json");
        const response = await fetch('/WhisperNFT.json');
        if (!response.ok) {
            throw new Error(`Failed to load ABI: ${response.status} ${response.statusText}`);
        }
        const abiData = await response.json();
        WHISPER_NFT_ABI = abiData.abi;
        console.log("ABI loaded successfully.");
        return true;
    } catch (error) {
        console.error("Error loading ABI:", error);
        WHISPER_NFT_ABI = null;
        return false;
    }
}

// Function to fetch configuration (contract address) from server
async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        if (!response.ok) {
            throw new Error(`Failed to load config: ${response.statusText}`);
        }
        const config = await response.json();
        if (config.contractAddress) {
            CONTRACT_ADDRESS = config.contractAddress;
            console.log("Client - Contract Address fetched from /api/config:", CONTRACT_ADDRESS);
            return true;
        } else {
            throw new Error("Contract address missing in server response.");
        }
    } catch (error) {
        console.error("Error fetching config:", error);
        return false;
    }
}

// Function to scramble whisper using the SECURE proxy endpoint
async function scrambleWhisperViaProxy(rawWhisper) {
    const response = await fetch('/api/scramble', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rawWhisper })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to scramble whisper.');
    }

    const data = await response.json();
    return data.scrambledText;
}

// --- Abuse Prevention ---

let BAD_WORDS_SET = null;

async function loadBadWords() {
    if (BAD_WORDS_SET) {
        //console.log("Bad words already loaded.");
        return true;
    }

    try {
        //console.log("Attempting to load bad words from /bad-words.txt");
        const response = await fetch('/bad-words.txt');
        if (!response.ok) {
            throw new Error(`Failed to load bad words list: ${response.status} ${response.statusText}`);
        }
        const text = await response.text();
        const badWordsArray = text.split('\n').map(word => word.trim().toLowerCase()).filter(word => word.length > 0);
        BAD_WORDS_SET = new Set(badWordsArray);
        //console.log(`Loaded ${BAD_WORDS_SET.size} bad words.`);
        return true;
    } catch (error) {
        //console.error("Error loading bad words:", error);
        BAD_WORDS_SET = new Set();
        return false;
    }
}

function containsBadWords(text) {
    if (!BAD_WORDS_SET || BAD_WORDS_SET.size === 0) {
        console.warn("Bad words list not loaded or is empty.");
        return false;
    }
    for (const badWord of BAD_WORDS_SET) {

        const escapedBadWord = badWord.replace(/[\\[\](){}^$*+?.|]/g, '\\$&');

        const regex = new RegExp(`\\b${escapedBadWord}\\b`, 'i');

        if (regex.test(text)) {
            console.log(`Found bad word (whole word match): ${badWord}`);
            return true;
        }
    }
    return false;
}

/**
 * Formats time remaining until expiry into a human-readable string.
 * @param {number} expiryTimestampSeconds - The expiry time in seconds since epoch.
 * @returns {string} - Formatted time string.
 */
function formatTimeUntilExpiry(expiryTimestampSeconds) {
    const now = Date.now();
    const expiryTimeMs = expiryTimestampSeconds * 1000;
    const timeDiffMs = expiryTimeMs - now;

    if (timeDiffMs <= 0) {
        return "Expired";
    }

    const totalSeconds = Math.floor(timeDiffMs / 1000);
    const days = Math.floor(totalSeconds / (24 * 60 * 60));
    const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    // Show seconds only if less than an hour left
    if (totalSeconds < 60 * 60) {
        parts.push(`${seconds}s`);
    }

    // If no parts (e.g., less than a second), show "<1s"
    if (parts.length === 0) {
        return "<1s";
    }

    return parts.join(' ');
}

// --- Blockchain Interaction Functions ---

async function initWallet() {
    if (!WHISPER_NFT_ABI) {
        console.error("ABI not loaded.");
        walletMessageP.textContent = "Error: Application failed to load contract data.";
        return false;
    }
    if (typeof window.ethereum === "undefined") {
        walletMessageP.textContent = "MetaMask or an Ethereum wallet is required.";
        connectButtonMain?.classList.remove('hidden');
        connectButtonMain.disabled = true;
        return false;
    }

    try {
        await window.ethereum.request({ method: "eth_requestAccounts" });
        provider = new window.ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        console.log("Wallet connected:", await signer.getAddress());

        if (!CONTRACT_ADDRESS || !isValidEthereumAddress(CONTRACT_ADDRESS)) {
             console.error("Contract address not configured correctly or is invalid:", CONTRACT_ADDRESS);
             walletMessageP.textContent = "Error: Contract address is missing or invalid.";
             return false;
        }

        whisperNFTContract = new window.ethers.Contract(CONTRACT_ADDRESS, WHISPER_NFT_ABI, signer);
        console.log("DEBUG: Contract Instance:", whisperNFTContract);
console.log("DEBUG: Contract Address Used:", CONTRACT_ADDRESS);
console.log("DEBUG: ABI Snippet (totalSupply):", WHISPER_NFT_ABI?.find(item => item.name === "totalSupply"));

        await updateUIConnected();
        loadWhisperFeed();
        return true;
    } catch (error) {
        console.error("Error connecting wallet:", error);
        walletMessageP.textContent = "Error connecting wallet.";
        connectButtonMain?.classList.remove('hidden');
        return false;
    }
}

async function mintWhisperNFT(scrambledText, durationSeconds) {
    if (!whisperNFTContract || !signer) {
        throw new Error("Wallet not connected.");
    }

    // App-Side Input Validation
    if (!scrambledText || scrambledText.trim().length === 0) {
         throw new Error("The scrambled text cannot be empty. Please ensure AI scrambling was successful.");
    }
    if (scrambledText.length > 1000) {
         throw new Error("The scrambled text is too long. Please try a shorter thought.");
    }
    if (durationSeconds <= 0 || durationSeconds > 30 * 24 * 60 * 60) {
         throw new Error("Invalid duration selected. Please choose a duration between 1 second and 30 days.");
    }

    try {
        console.log("Minting Whisper NFT...");
        submitErrorDiv.classList.add('hidden');

        const tx = await whisperNFTContract.mintWhisper(scrambledText, durationSeconds);
        console.log("Transaction sent:", tx.hash);

        // Show minting spinner/status on button itself handled by event listener

        const receipt = await tx.wait();
        console.log("Transaction confirmed:", receipt);

        let tokenId = null;
        if (receipt.logs) {
            for (const log of receipt.logs) {
                try {
                    const parsedLog = whisperNFTContract.interface.parseLog(log);
                    if (parsedLog && parsedLog.name === "WhisperMinted") {
                        tokenId = parsedLog.args.tokenId.toString();
                        console.log("Minted Token ID:", tokenId);
                        break;
                    }
                } catch (e) {
                }
            }
        }

        return { success: true, txHash: tx.hash, tokenId };
    } catch (error) {
        console.error("Minting error:", error);
        let message = "An unexpected error occurred while minting the whisper. Please try again.";

        if (error.code === 'ACTION_REJECTED' || (error.message && error.message.includes("user rejected"))) {
            message = "Transaction rejected by user.";
        } else if (error.code === 'CALL_EXCEPTION' || (error.message && (error.message.includes("execution reverted") || error.message.includes("revert") || error.reason === "require(false)"))) {
            console.log("Detailed contract revert error (for debugging):", error);
            if (error.reason === "require(false)" || (error.message && error.message.includes('reason="require(false)"'))) {
                message = "The smart contract strongly rejected the minting request. This could be due to:" +
                          "<ul class='list-disc pl-5 mt-1 space-y-1'>" +
                          "<li><b>Cooldown:</b> You might have minted very recently. Please wait a short while (at least 1 minute).</li>" +
                          "<li><b>Reentrancy Guard:</b> A previous action might still be processing. Please wait and try again.</li>" +
                          "<li><b>Max Supply:</b> The limit for total whispers might have been reached.</li>" +
                          "<li><b>Invalid Input:</b> The text might be too long or the duration invalid.</li>" +
                          "</ul>" +
                          "Please check these possibilities and try again. If the problem persists, wait a few minutes.";
            } else {
                 message = "The smart contract rejected the minting request. It might be due to cooldown, max supply, or invalid input.";
            }
        } else {
            console.log("Detailed unexpected error:", error);
            message = "An unexpected error occurred: " + (error.message || "Unknown error");
        }
        throw new Error(message);
    }
}

async function fetchRecentWhispers(limit = 10) {
    if (!whisperNFTContract) {
        throw new Error("Contract not initialized.");
    }

    try {
        const totalSupply = await whisperNFTContract.totalSupply();
        const latestId = Number(totalSupply);
        console.log("Current total supply:", latestId);

        const whispers = [];
        for (let i = 0; i < limit && (latestId - i) > 0; i++) {
            const tokenId = latestId - i;
            try {
                await whisperNFTContract.ownerOf(tokenId);

                const expiryTime = Number(await whisperNFTContract.getExpiryTime(tokenId));
                const isExpired = await whisperNFTContract.isWhisperExpired(tokenId);
                const isForgotten = await whisperNFTContract.isWhisperForgotten(tokenId);

                let text = "[Content Expired/Forgotten]";
                if (!isExpired && !isForgotten) {
                    try {
                        text = await whisperNFTContract.getWhisperText(tokenId);
                    } catch (textErr) {
                        console.log(`Could not fetch text for token ${tokenId}:`, textErr.message);
                    }
                }

                whispers.push({
                    tokenId: tokenId.toString(),
                    text,
                    expiryTime,
                    isExpired,
                    isForgotten,
                });
            } catch (tokenError) {
                 console.warn(`Token ${tokenId} might not exist or error fetching:`, tokenError.message);
            }
        }
        return whispers;
    } catch (error) {
        console.error("Error fetching recent whispers (contract call failed):", error);
        if (error.code === 'CALL_EXCEPTION') {
            throw new Error("Failed to communicate with the smart contract. It might be misconfigured or unavailable. Please check the contract address and network.");
        } else {
            throw new Error("Failed to fetch whispers from the network: " + (error.message || "Unknown error"));
        }
    }
}

// --- UI Update Functions ---
async function updateUIConnected() {
    try {
        const address = await signer.getAddress();
        walletIconDisconnected.classList.add('d-none');
        walletIconConnected.classList.remove('d-none');
        walletConnectedAddress.textContent = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
        walletInfoConnected.classList.remove('d-none');
        walletInfoDisconnected.classList.add('d-none');
        walletMessageP.textContent = ""; 

        scrambleSpinner?.classList.add('d-none');
        mintSpinner?.classList.add('d-none');

        walletStatusDiv.classList.add('d-none');
        submitSection.classList.remove('hidden'); 
        submitSection.classList.remove('d-none');

        // --- Load ephemeral prompts ---
        const NUMBER_OF_PROMPTS_TO_SHOW = 4;
        if (promptsContainer && promptsDiv) {
            promptsDiv.innerHTML = '';
            
            const randomPrompts = getRandomPrompts(EPHEMERAL_THOUGHT_PROMPTS, NUMBER_OF_PROMPTS_TO_SHOW);

            randomPrompts.forEach(promptText => {
                const button = document.createElement('button');
                button.type = 'button';
                
                button.className = 'prompt-button'; 
                button.textContent = promptText;
                button.title = "Click to use this prompt";
                button.addEventListener('click', () => {
                    rawWhisperTextarea.value = promptText;
                    rawWhisperTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                });
                promptsDiv.appendChild(button);
            });
            promptsContainer.classList.remove('d-none');
            promptsContainer.classList.remove('hidden');
        }
        // --- End prompts ---

    } catch (err) {
        console.error("Error getting signer address:", err);
        walletConnectedAddress.textContent = "Connected (Error)";
        walletInfoConnected.classList.remove('d-none');
        walletInfoDisconnected.classList.add('d-none');
    }
    connectButtonMain?.classList.add('d-none');
    connectButtonMain?.classList.add('hidden');
}

function updateUIDisconnected() {
    const alertDivInsideWalletMessage = walletMessageP.querySelector('.alert');
    if (alertDivInsideWalletMessage) {
        alertDivInsideWalletMessage.innerHTML = `
            <h5 class="alert-heading">Welcome to MorphEcho!</h5>
            <p>Connect your wallet to share ephemeral, AI-scrambled whispers with your community.</p>
            <hr>
            <p class="mb-0"><small>Your whispers are temporary NFTs that expire and disappear.</small></p>
        `;
    } else {
        // Fallback if structure changes
        walletMessageP.innerHTML = `
            <div class="alert alert-info mb-3">
                <h5 class="alert-heading">Welcome to MorphEcho!</h5>
                <p>Connect your wallet to share ephemeral, AI-scrambled whispers with your community.</p>
                <hr>
                <p class="mb-0"><small>Your whispers are temporary NFTs that expire and disappear.</small></p>
            </div>
        `;
    }

    connectButtonMain?.classList.remove('d-none');
    connectButtonMain.disabled = false;

    walletStatusDiv.classList.remove('d-none');
    submitSection.classList.add('d-none');

    clearSubmitForm();

    loadWhisperFeed(); 
    
    if (promptsContainer) {
        promptsContainer.classList.add('d-none');
    }

    walletIconDisconnected.classList.remove('d-none');
    walletIconConnected.classList.add('d-none');
    walletInfoConnected.classList.add('d-none');
    walletInfoDisconnected.classList.remove('d-none');
}

function clearSubmitForm() {
    rawWhisperTextarea.value = '';
    originalPreviewDiv?.classList.add('d-none'); 
    originalTextPreviewP.textContent = '';
    scramblePreviewDiv?.classList.add('d-none'); 
    reScrambleButton?.classList.add('d-none'); 
    reScrambleButton.disabled = false;
    durationSelectorDiv?.classList.add('d-none'); 
    mintButton?.classList.add('d-none'); 
    submitErrorDiv?.classList.add('d-none');

    scrambleSpinner?.classList.add('d-none'); 
    scrambleSpinnerText.textContent = "Scramble with AI";
    mintSpinner?.classList.add('d-none'); 
    mintSpinnerText.textContent = "Mint Whisper NFT";
}

function showLoadingSpinner(isLoading) {
    if (isLoading) {
        loadingSpinner?.classList.remove('d-none');
        whisperFeedDiv?.classList.add('d-none');
        noWhispersMessage?.classList.add('d-none');
    } else {
        loadingSpinner?.classList.add('d-none');
        whisperFeedDiv?.classList.remove('d-none');
    }
}

function showError(targetDiv, message) {
    const plainText = message.replace(/<[^>]*>?/gm, '');
    targetDiv.textContent = plainText;
    targetDiv.classList.remove('d-none');
    targetDiv.classList.add('alert', 'alert-danger');
}

function hideError(targetDiv) {
    targetDiv.classList.add('d-none');
}

async function loadWhisperFeed() {
    if (!whisperNFTContract) {
        console.log("Feed load skipped: Wallet not connected, contract not initialized.");
        showLoadingSpinner(false);
        hideError(feedErrorDiv);
        
        const alertDivInsideNoWhispers = noWhispersMessage.querySelector('.alert'); // Find the alert inside
        if (alertDivInsideNoWhispers) {
                alertDivInsideNoWhispers.textContent = "Connect your wallet to discover ephemeral whispers shared nearby.";
        } else {
                // Fallback if structure changes unexpectedly
                noWhispersMessage.textContent = "Connect your wallet to discover ephemeral whispers shared nearby.";
        }
        
        noWhispersMessage.classList.remove('d-none');
        
        return;
    }

    

    showLoadingSpinner(true);
    hideError(feedErrorDiv);

    try {
        const whispers = await fetchRecentWhispers(15);
        renderWhisperFeed(whispers); // This function needs updating too (see below)
    } catch (err) {
        console.error("Error loading feed:", err);
        showError(feedErrorDiv, err.message || "Could not load whispers.");
        whisperFeedDiv.innerHTML = '';
        const alertDivInsideNoWhispers = noWhispersMessage.querySelector('.alert');
        if (alertDivInsideNoWhispers) {
            alertDivInsideNoWhispers.textContent = "Could not load whispers. Please try again later.";
        } else {
            noWhispersMessage.textContent = "Could not load whispers. Please try again later.";
        }
        noWhispersMessage.classList.remove('d-none');
    } finally {
        showLoadingSpinner(false);
    }
}

function renderWhisperFeed(whispers) {
    whisperFeedDiv.innerHTML = '';
    if (!whispers || whispers.length === 0) {
        noWhispersMessage?.classList.remove('d-none'); 
        return;
    }
    noWhispersMessage?.classList.add('d-none'); 

    whispers.forEach(whisper => {

        const colDiv = document.createElement('div');
        colDiv.className = 'col-12 mb-3'; 

        const cardDiv = document.createElement('div');
        cardDiv.className = 'card h-100 shadow-sm';

        const cardBody = document.createElement('div');
        cardBody.className = 'card-body d-flex flex-column';

        const tokenIdBadge = document.createElement('span');
        tokenIdBadge.className = 'badge bg-secondary-subtle text-secondary-emphasis'; // BS badge
        tokenIdBadge.textContent = `#${whisper.tokenId}`;
        tokenIdBadge.title = `Token ID: ${whisper.tokenId}`;

        const statusBadge = document.createElement('span');
        statusBadge.className = 'badge ms-auto'; 
        let statusText = "";
        let statusClass = "";
        if (whisper.isExpired || whisper.isForgotten) {
            statusText = "Expired/Forgotten";
            statusClass = "bg-secondary"; // Gray
        } else {
            const timeUntilExpiry = (whisper.expiryTime * 1000) - Date.now();
            if (timeUntilExpiry > 0 && timeUntilExpiry < 60 * 60 * 1000) { // < 1 hour
                // statusText = `Expires in ~${Math.floor(timeUntilExpiry / (1000 * 60))} min`;
                statusText = `Expires: ${formatTimeUntilExpiry(whisper.expiryTime)}`; // Use helper
                statusClass = "bg-warning text-dark"; // Yellow/Orange
            } else {
                // statusText = `Expires: ${new Date(whisper.expiryTime * 1000).toLocaleString()}`;
                statusText = `Expires: ${formatTimeUntilExpiry(whisper.expiryTime)}`; // Use helper
                statusClass = "bg-success"; // Green
            }
        }
        statusBadge.textContent = statusText;
        statusBadge.classList.add(statusClass);

        // --- Whisper Text (Main Content) ---
        const textP = document.createElement('p');
        textP.className = 'card-text flex-grow-1 mt-2 mb-3'; // Grow to fill space, margins
        if (whisper.isExpired || whisper.isForgotten) {
            textP.classList.add('text-muted', 'fst-italic'); // Muted and italic
            textP.textContent = "[Content Expired/Forgotten]";
        } else {
            textP.textContent = whisper.text;
        }

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'd-flex justify-content-between mt-auto pt-2'; // Push to bottom, padding top

        // --- Flag Button ---
        const flagButton = document.createElement('button');
        flagButton.type = 'button';
        flagButton.className = 'btn btn-sm btn-outline-secondary py-1 px-2'; // BS small button
        flagButton.innerHTML = '<i class="bi bi-flag"></i> Flag'; // BS Icon + text
        flagButton.title = 'Report this whisper';
        flagButton.dataset.tokenId = whisper.tokenId;
        flagButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const button = event.target.closest('button'); // Safer way to get button
            const tokenId = button.dataset.tokenId;
            console.log(`Flag button clicked for token ID: ${tokenId}`);
            alert(`Whisper #${tokenId} has been flagged. Thank you for helping keep the community respectful.`);
            // const flaggedTokens = JSON.parse(localStorage.getItem('flaggedWhispers') || '[]');
            // if (!flaggedTokens.includes(tokenId)) {
            //     flaggedTokens.push(tokenId);
            //     localStorage.setItem('flaggedWhispers', JSON.stringify(flaggedTokens));
            //     console.log(`Token ${tokenId} flagged. Updated list:`, flaggedTokens);
            //     // Could visually update the button or card here
            // }
        });

        // --- Like Button ---
        const likeButtonContainer = document.createElement('div');
        likeButtonContainer.className = 'd-flex align-items-center';

        const likeButton = document.createElement('button');
        likeButton.type = 'button';
        likeButton.className = 'btn btn-sm btn-outline-primary py-1 px-2 d-flex align-items-center'; 
        const likeIcon = document.createElement('i');
        likeIcon.className = 'bi bi-heart'; // Default icon

        const likeCountSpan = document.createElement('span');
        likeCountSpan.className = 'ms-1';
        const likesKey = `whisperLikes_${whisper.tokenId}`;
        let likeCount = parseInt(localStorage.getItem(likesKey) || '0', 10);
        likeCountSpan.textContent = likeCount > 0 ? likeCount : ''; // Show count or empty

        const userLikesKey = `userLiked_${whisper.tokenId}`;
        const userHasLiked = localStorage.getItem(userLikesKey) === 'true';
        if (userHasLiked) {
            likeIcon.className = 'bi bi-heart-fill text-danger'; // Filled icon, red color
        }

        likeButton.appendChild(likeIcon);
        likeButton.appendChild(likeCountSpan);

        likeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const button = event.currentTarget;
            const icon = button.querySelector('i');
            const countSpan = button.querySelector('span');

            // Toggle like state
            const currentlyLiked = icon.classList.contains('bi-heart-fill');
            if (currentlyLiked) {
                // Unlike
                likeIcon.className = 'bi bi-heart';
                likeCount--;
                localStorage.setItem(userLikesKey, 'false');
            } else {
                // Like
                likeIcon.className = 'bi bi-heart-fill text-danger';
                likeCount++;
                localStorage.setItem(userLikesKey, 'true');
            }

            // Update localStorage count
            localStorage.setItem(likesKey, likeCount);

            // Update UI count
            countSpan.textContent = likeCount > 0 ? likeCount : '';
        });

        likeButtonContainer.appendChild(likeButton);

        // Assemble the card
        // Top badges row
        const topRow = document.createElement('div');
        topRow.className = 'd-flex justify-content-between align-items-center';
        topRow.appendChild(tokenIdBadge);
        topRow.appendChild(statusBadge);

        buttonGroup.appendChild(flagButton);
        buttonGroup.appendChild(likeButtonContainer);

        cardBody.appendChild(topRow);
        cardBody.appendChild(textP);
        cardBody.appendChild(buttonGroup);

        cardDiv.appendChild(cardBody);
        colDiv.appendChild(cardDiv);
        whisperFeedDiv.appendChild(colDiv);
    });
}

// --- Event Listeners ---

// Wallet Button Click and Tooltip
walletButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    walletTooltip?.classList.toggle('hidden');
    if (!walletTooltip?.classList.contains('hidden')) {
        const closeTooltip = (e) => {
            if (!walletWidget?.contains(e.target)) {
                walletTooltip?.classList.add('hidden');
                document.removeEventListener('click', closeTooltip);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeTooltip);
        }, 10);
    }
});

document.addEventListener('click', (event) => {
    if (!walletWidget?.contains(event.target)) {
        walletTooltip?.classList.add('hidden');
    }
});

disconnectButton?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await disconnectWallet();
    walletTooltip?.classList.add('hidden');
});

async function disconnectWallet() {
    console.log("Disconnecting wallet...");
    provider = null;
    signer = null;
    whisperNFTContract = null;
    updateUIDisconnected();
    whisperFeedDiv.innerHTML = '';
    noWhispersMessage.textContent = "No whispers found. Connect your wallet and be the first to share one!";
    noWhispersMessage.classList.remove('hidden');
    hideError(feedErrorDiv);
    console.log("Wallet disconnected in UI.");
}

// Connect Button in Main Flow
connectButtonMain?.addEventListener('click', async () => {
    await initWallet();
});

// Input enables/disables scramble button
rawWhisperTextarea?.addEventListener('input', () => {
    scrambleButton.disabled = !rawWhisperTextarea.value.trim();
});

// Scramble Button
scrambleButton?.addEventListener('click', async () => {
    const rawText = rawWhisperTextarea.value.trim();
    if (!rawText) return;

    // Rate Limiting Check (UI Level)
    const now = Date.now();
    if (now - lastMintAttemptTime < MINT_ATTEMPT_COOLDOWN_MS) {
        const remainingTime = Math.ceil((MINT_ATTEMPT_COOLDOWN_MS - (now - lastMintAttemptTime)) / 1000);
        showError(submitErrorDiv, `Please wait ${remainingTime} second(s) before trying again.`);
        return;
    }

    // Input Filtering
    if (BAD_WORDS_SET && BAD_WORDS_SET.size > 0) {
        if (containsBadWords(rawText)) {
            showError(submitErrorDiv, "Your whisper contains words that are not allowed. Please revise and try again.");
            return;
        }
    } else {
         console.warn("Skipping input filter check as bad words list is not loaded.");
    }

    try {
        // Update last attempt time on initiating scramble (success path)
        lastMintAttemptTime = Date.now();

        // --- Show Original Input ---
        originalTextPreviewP.textContent = rawText;
        originalPreviewDiv.classList.remove('d-none'); 

        // Show spinner, disable button
        scrambleSpinner?.classList.remove('d-none'); 
        scrambleSpinnerText.textContent = "Scrambling...";
        scrambleButton.disabled = true; // Disable while processing
        hideError(submitErrorDiv); // Use existing function (handles 'd-none')

        const scrambled = await scrambleWhisperViaProxy(rawText);

        // --- Show Scrambled Output & Re-scramble Button ---
        scrambledTextP.textContent = scrambled;
        scramblePreviewDiv?.classList.remove('d-none'); 
        reScrambleButton?.classList.remove('d-none'); // Show Re-scramble button

        durationSelectorDiv?.classList.remove('d-none'); 
        mintButton?.classList.remove('d-none'); 
    } catch (err) {
        console.error("Scrambling error:", err);
        showError(submitErrorDiv, err.message || "Failed to scramble whisper."); // Use existing function
        // Hide elements on error
        originalPreviewDiv?.classList.add('d-none'); 
        scramblePreviewDiv?.classList.add('d-none'); 
        reScrambleButton?.classList.add('d-none'); // Hide Re-scramble button
        durationSelectorDiv?.classList.add('d-none'); 
        mintButton?.classList.add('d-none'); 
        // Do not update lastMintAttemptTime on error, allow retry sooner?
    } finally {
        // Crucial: Always hide spinner and reset button text using Bootstrap class
        scrambleSpinner?.classList.add('d-none'); 
        scrambleSpinnerText.textContent = "Scramble with AI";
        // scrambleButton.disabled is managed by input event listener
    }
});

// --- Add Re-scramble Button Event Listener ---
reScrambleButton?.addEventListener('click', async () => {
    // Re-use the logic from scrambleButton, but get raw text from the preview/original input
    const rawText = originalTextPreviewP.textContent.trim(); // Get original text
    if (!rawText) {
        // This shouldn't happen if the button is only visible after a successful initial scramble
        console.warn("Re-scramble button clicked but no original text found.");
        return;
    }

    // Basic rate limiting check (could be separate from initial scramble if desired)
    const now = Date.now();
    if (now - lastMintAttemptTime < MINT_ATTEMPT_COOLDOWN_MS) {
        const remainingTime = Math.ceil((MINT_ATTEMPT_COOLDOWN_MS - (now - lastMintAttemptTime)) / 1000);
        showError(submitErrorDiv, `Please wait ${remainingTime} second(s) before trying again.`);
        return;
    }

    try {
        // Update last attempt time
        lastMintAttemptTime = Date.now();

        // Show spinner on main scramble button (or could have a separate one for re-scramble)
        scrambleSpinner?.classList.remove('d-none'); 
        scrambleSpinnerText.textContent = "Re-scrambling...";
        reScrambleButton.disabled = true; // Disable re-scramble while processing
        hideError(submitErrorDiv); // Use existing function

        const scrambled = await scrambleWhisperViaProxy(rawText);

        // Update the scrambled text display
        scrambledTextP.textContent = scrambled;
        // Ensure preview and mint button are visible (they should be already)
        // No need to change their visibility here as they are already shown after initial scramble

    } catch (err) {
        console.error("Re-scrambling error:", err);
        showError(submitErrorDiv, err.message || "Failed to re-scramble whisper.");
        // Potentially hide elements or show specific error for re-scramble?
        // For now, rely on general error handling
    } finally {
        // Hide spinner, reset text, re-enable button
        scrambleSpinner?.classList.add('d-none'); 
        scrambleSpinnerText.textContent = "Scramble with AI"; // Reset to original text or specific one?
        reScrambleButton.disabled = false; // Re-enable re-scramble button
    }
});

// Mint Button
mintButton?.addEventListener('click', async () => {
    const scrambledText = scrambledTextP.textContent;
    const duration = parseInt(durationSelect.value, 10);

    // Rate Limiting Check (UI Level - redundant but user-friendly)
    const now = Date.now();
    if (now - lastMintAttemptTime < MINT_ATTEMPT_COOLDOWN_MS) {
        const remainingTime = Math.ceil((MINT_ATTEMPT_COOLDOWN_MS - (now - lastMintAttemptTime)) / 1000);
        showError(submitErrorDiv, `Please wait ${remainingTime} second(s) before trying again.`);
        return;
    }

    if (!scrambledText) {
        showError(submitErrorDiv, "No scrambled text available.");
        return;
    }

    try {
        // Update last attempt time on initiating mint (success path)
        lastMintAttemptTime = Date.now();

        // --- Show mint spinner using Bootstrap class ---
        mintSpinner?.classList.remove('d-none');
        mintSpinner?.classList.remove('hidden'); // Fallback
        mintSpinnerText.textContent = "Minting...";
        mintButton.disabled = true; // Disable while processing

        const result = await mintWhisperNFT(scrambledText, duration);
        console.log("Minting successful:", result);
        alert(`Whisper minted successfully!\nTx Hash: ${result.txHash}\nToken ID: ${result.tokenId || 'N/A'}`);

        clearSubmitForm(); // This now correctly resets spinners using 'd-none'
        loadWhisperFeed();
    } catch (err) {
        console.error("Minting error:", err);
        showError(submitErrorDiv, err.message || "Failed to mint whisper NFT."); // Use existing function
        // Do not update lastMintAttemptTime on error, allow retry sooner?
    } finally {
        // --- Crucial: Always hide spinner and reset button text/state using Bootstrap class ---
        mintSpinner?.classList.add('d-none');
        mintSpinner?.classList.add('hidden'); // Fallback
        mintSpinnerText.textContent = "Mint Whisper NFT";
        mintButton.disabled = false; // Re-enable button after action (success or error)
    }
});

// --- Initial Setup ---
window.addEventListener('load', async () => {
    const badWordsLoaded = await loadBadWords();
    if (!badWordsLoaded) {
         console.warn("Failed to load bad words list. Proceeding without input filtering.");
    }

    const configLoaded = await loadConfig();
    if (!configLoaded) {
        walletMessageP.textContent = "Error: Failed to load application configuration. Please refresh.";
        connectButtonMain?.classList.add('hidden');
        return;
    }

    const abiLoaded = await loadABI();
    if (!abiLoaded) {
        walletMessageP.textContent = "Error: Failed to load application data (ABI). Please refresh.";
        connectButtonMain?.classList.add('hidden');
        return;
    }

    if (window.ethereum && window.ethereum.selectedAddress) {
         try {
             await initWallet();
         } catch (err) {
             console.error("Error initializing wallet on load:", err);
             updateUIDisconnected();
         }
    } else {
        updateUIDisconnected();
    }
    loadWhisperFeed();
});
