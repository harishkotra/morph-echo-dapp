let provider = null;
let signer = null;
let whisperNFTContract = null;
let WHISPER_NFT_ABI = null;
let CONTRACT_ADDRESS = null;
let lastMintAttemptTime = 0;
let lastReScrambleAttemptTime = 0;

const RE_SCRAMBLE_COOLDOWN_MS = 5000;
const MINT_ATTEMPT_COOLDOWN_MS = 60000;
let isConnectingWallet = false;

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
const walletDropdownMenu = document.getElementById('wallet-dropdown-menu');

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

if (disconnectButton) {
    //console.log("Attaching listener to disconnect button."); 
    disconnectButton.addEventListener('click', async (event) => {
        //console.log("Disconnect button clicked."); 
        event.stopPropagation(); // Prevent dropdown from closing immediately
        await disconnectWallet();
        // Note: Hiding the dropdown menu is usually handled by Bootstrap automatically
        // after disconnectWallet updates the UI.
    });
} else {
    console.error("Disconnect button element not found when trying to attach listener!"); // Debug error
}

if (walletButton) {
    walletButton.addEventListener('click', async (event) => {
        //console.log("Wallet icon/button clicked.");
        event.stopPropagation();
        if (!signer || !whisperNFTContract) {
            //console.log("Wallet icon clicked, initiating connection...");
            await initWallet();
        } else {
            //console.log("Wallet already connected. Click opens menu (handled by BS dropdown).");
        }
    });
}

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
        //console.log("Attempting to load ABI from /WhisperNFT.json");
        const response = await fetch('/WhisperNFT.json');
        if (!response.ok) {
            throw new Error(`Failed to load ABI: ${response.status} ${response.statusText}`);
        }
        const abiData = await response.json();
        WHISPER_NFT_ABI = abiData.abi;
        //console.log("ABI loaded successfully.");
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
            //console.log("Client - Contract Address fetched from /api/config:", CONTRACT_ADDRESS);
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
async function scrambleWhisperViaProxy(rawWhisper, operationType = 'scramble') {
    const walletAddress = signer ? await signer.getAddress() : null;
    
    const response = await fetch('/api/scramble', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
            rawWhisper, 
            walletAddress,
            operationType 
        })
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
        ////console.log("Bad words already loaded.");
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
            //console.log(`Found bad word (whole word match): ${badWord}`);
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
    if (isConnectingWallet) {
        console.warn("Wallet connection already in progress.");
        if (walletStatusDiv && !walletStatusDiv.classList.contains('d-none')) {
             walletMessageP.textContent = "Wallet connection prompt is already open. Please check your wallet extension.";
        } else if (walletInfoDisconnected && !walletInfoDisconnected.classList.contains('d-none')) {
             const tooltipTextElement = document.getElementById('wallet-tooltip-text');
             if (tooltipTextElement) {
                 tooltipTextElement.textContent = "Wallet connection prompt is already open. Please check your wallet extension.";
             }
        }
        return false;
    }

    isConnectingWallet = true;
    connectButtonMain?.classList.remove('d-none');
    connectButtonMain?.classList.remove('hidden'); // Fallback

    try {
        // --- Check if ABI is loaded ---
        if (!WHISPER_NFT_ABI) {
            console.error("ABI not loaded.");
            walletMessageP.textContent = "Error: Application failed to load contract data (ABI). Please refresh the page.";
            return false;
        }

        if (typeof window.ethereum === "undefined") {
            walletMessageP.textContent = "MetaMask or an Ethereum wallet is required.";
            connectButtonMain.disabled = true;
            return false;
        }

        //console.log("Requesting accounts from wallet...");
        await window.ethereum.request({ method: "eth_requestAccounts" });

        provider = new window.ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        const signerAddress = await signer.getAddress();
        //console.log("Wallet connected:", signerAddress);

        if (!CONTRACT_ADDRESS || !isValidEthereumAddress(CONTRACT_ADDRESS)) {
            console.error("Contract address not configured correctly or is invalid:", CONTRACT_ADDRESS);
            walletMessageP.textContent = "Error: Contract address is missing or invalid. Please check the application configuration.";
            return false; 
        }

        //console.log("DEBUG: Contract Address Used:", CONTRACT_ADDRESS);
        //console.log("DEBUG: ABI Snippet (totalSupply):", WHISPER_NFT_ABI?.find(item => item.name === "totalSupply"));

        whisperNFTContract = new window.ethers.Contract(CONTRACT_ADDRESS, WHISPER_NFT_ABI, signer);
        //console.log("WhisperNFT contract instance created at:", CONTRACT_ADDRESS);
        await updateUIConnected();
        loadWhisperFeed();
        updateStatisticsDisplay(); // Update stats when wallet connects
        return true;

    } catch (error) {
        console.error("Error connecting wallet:", error);

        let userFriendlyMessage = "Error connecting wallet. Please try again."; // Default message

        if (error.code === 'USER_REJECTED_REQUEST') { // EIP-1193 code
            userFriendlyMessage = "Wallet connection was rejected by the user.";
        } else if (error.code === -32002) { // Specific RPC Error Code for concurrent requests
            userFriendlyMessage = "Wallet connection prompt is already open. Please check your wallet extension and complete the request there.";
            //console.log("MetaMask connection request is already pending. User needs to check their wallet.");
        } else if (error.code === 'CALL_EXCEPTION' || error.code === 'BAD_DATA') {
             userFriendlyMessage = "Connected to wallet, but failed to interact with the smart contract. Please check the network and contract address.";
        } else if (error.message) {
            if (error.message.includes("network") || error.message.includes("chain")) {
                userFriendlyMessage = "Connected to wallet, but it's on the wrong network. Please switch to the correct network (e.g., Morph Testnet).";
            } else if (error.message.includes("disconnected") || error.message.includes("lost connection")) {
                 userFriendlyMessage = "Lost connection to the wallet. Please check your wallet and try again.";
            }
        }
        walletMessageP.textContent = userFriendlyMessage;
        console.error("Specific error details:", error); 
        connectButtonMain?.classList.remove('d-none');
        connectButtonMain?.classList.remove('hidden');
        
        if (typeof window.ethereum !== "undefined") {
            connectButtonMain.disabled = false;
        }

        return false; // Indicate connection failure

    } finally {
        // --- Crucially, reset the connection flag in the finally block ---
        // This ensures the flag is always reset, even if the function returns early
        // or throws an error in the catch block.
        //console.log("Wallet connection attempt finished (success or error).");
        isConnectingWallet = false;
    }
}

async function mintWhisperNFT(scrambledText, durationSeconds) {
    //console.log("mintWhisperNFT called with:", { scrambledText, durationSeconds });

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
        //console.log("Minting Whisper NFT...");

        const tx = await whisperNFTContract.mintWhisper(scrambledText, durationSeconds);
        //console.log("Transaction sent:", tx.hash);


        const receipt = await tx.wait();
        //console.log("Transaction confirmed:", receipt);

        let tokenId = null;
        if (receipt.logs) {
            for (const log of receipt.logs) {
                try {
                    const parsedLog = whisperNFTContract.interface.parseLog(log);
                    if (parsedLog && parsedLog.name === "WhisperMinted") {
                        tokenId = parsedLog.args.tokenId.toString();
                        //console.log("Minted Token ID:", tokenId);
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
            //console.log("Detailed contract revert error (for debugging):", error);
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
            //console.log("Detailed unexpected error:", error);
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
        //console.log("Current total supply:", latestId);

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
                        //console.log(`Could not fetch text for token ${tokenId}:`, textErr.message);
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
        //console.log("Wallet connected, updating UI for address:", address);

        walletIconDisconnected.classList.add('d-none');
        walletIconConnected.classList.remove('d-none');
        const displayAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
        //console.log("Obfuscated address to display:", displayAddress);
        if (walletConnectedAddress) {
            walletConnectedAddress.textContent = displayAddress;
            walletConnectedAddress.title = address;
        } else {
            console.error("walletConnectedAddress element not found!");
        }
        if (walletInfoConnected) {
            walletInfoConnected.classList.remove('d-none'); 
        } else {
            console.error("walletInfoConnected element not found!");
        }

        if (walletMessageP) {
            walletMessageP.textContent = "";
        }

        if (walletStatusDiv) {
            walletStatusDiv.classList.add('d-none');
        }

        if (submitSection) {
           submitSection.classList.remove('d-none');
        }

        const scrambleSpinner = document.getElementById('scramble-spinner');
        const mintSpinner = document.getElementById('mint-spinner');
        if (scrambleSpinner) scrambleSpinner.classList.add('d-none');
        if (mintSpinner) mintSpinner.classList.add('d-none');

        const promptsContainer = document.getElementById('ephemeral-prompts-container');
        const promptsDiv = document.getElementById('ephemeral-prompts');
        if (promptsContainer && promptsDiv) {
            promptsDiv.innerHTML = '';

            const NUMBER_OF_PROMPTS_TO_SHOW = 4;
            const randomPrompts = getRandomPrompts(EPHEMERAL_THOUGHT_PROMPTS, NUMBER_OF_PROMPTS_TO_SHOW);

            randomPrompts.forEach(promptText => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn btn-outline-secondary btn-sm me-2 mb-2';
                button.textContent = promptText;
                button.title = "Click to use this prompt";
                button.addEventListener('click', () => {
                    const rawWhisperTextarea = document.getElementById('raw-whisper');
                    if (rawWhisperTextarea) {
                        rawWhisperTextarea.value = promptText;
                        rawWhisperTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                });
                promptsDiv.appendChild(button);
            });

            promptsContainer.classList.remove('d-none');
        }
        // --- End prompts ---

    } catch (err) {
        console.error("Error getting signer address or updating UI:", err);
        if (walletConnectedAddress) {
            walletConnectedAddress.textContent = "Connected (Error)";
        }
        if (walletInfoConnected) {
            walletInfoConnected.classList.remove('d-none');
        }
    }
    
    if (connectButtonMain) {
        connectButtonMain.classList.add('d-none');
    }
}

function updateUIDisconnected() {
    //console.log("Updating UI to disconnected state.");
    if (walletIconDisconnected) walletIconDisconnected.classList.remove('d-none'); 
    if (walletIconConnected) walletIconConnected.classList.add('d-none');
    if (walletInfoConnected) walletInfoConnected.classList.add('d-none'); 
    if (walletMessageP && walletStatusDiv) {
        const alertDivInsideWalletMessage = walletMessageP.querySelector('.alert');
        if (alertDivInsideWalletMessage) {
            alertDivInsideWalletMessage.innerHTML = `
                <h5 class="alert-heading">Welcome to MorphEcho!</h5>
                <p>Connect your wallet to share ephemeral, AI-scrambled whispers with your community.</p>
                <hr>
                <p class="mb-0"><small>Your whispers are temporary NFTs that expire and disappear.</small></p>
            `;
        } else {
            walletMessageP.innerHTML = `
                <div class="alert alert-info mb-3">
                    <h5 class="alert-heading">Welcome to MorphEcho!</h5>
                    <p>Connect your wallet to share ephemeral, AI-scrambled whispers with your community.</p>
                    <hr>
                    <p class="mb-0"><small>Your whispers are temporary NFTs that expire and disappear.</small></p>
                </div>
            `;
        }
        walletStatusDiv.classList.remove('d-none');
    }

    if (connectButtonMain) {
        connectButtonMain.classList.remove('d-none');
        connectButtonMain.disabled = false;
    }


    if (submitSection) {
        submitSection.classList.add('d-none');
    }
    clearSubmitForm();
    walletTooltip?.classList.add('hidden');
    walletDropdownMenu?.classList.add('d-none'); 
    loadWhisperFeed();
    const promptsContainer = document.getElementById('ephemeral-prompts-container');
    if (promptsContainer) {
        promptsContainer.classList.add('d-none');
    }
    if (walletConnectedAddress) {
        walletConnectedAddress.textContent = "";
    }
    noWhispersMessage.textContent = "No whispers found. Connect your wallet and be the first to share one!";
    noWhispersMessage.classList.remove('d-none');
    
    connectButtonMain?.classList.remove('d-none');
    connectButtonMain?.classList.remove('hidden');
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
    //console.log("DEBUG showError called:", { targetDiv, message }); // Add this line
    if (!targetDiv) {
        console.error("DEBUG showError: targetDiv is null!"); // Add this check
        return; // Exit if targetDiv is null to prevent errors
    }
    const plainText = message.replace(/<[^>]*>?/gm, '');
    //console.log("DEBUG showError: Setting textContent to:", plainText); // Add this line
    targetDiv.textContent = plainText;
    //console.log("DEBUG showError: Removing d-none, adding alert classes"); // Add this line
    targetDiv.classList.remove('d-none');
    // targetDiv.classList.remove('hidden'); // If needed for Tailwind compat
    targetDiv.classList.add('alert', 'alert-danger');
    //console.log("DEBUG showError: Finished."); // Add this line
}

function hideError(targetDiv) {
    targetDiv.classList.add('d-none');
}

async function loadWhisperFeed() {
    if (!whisperNFTContract) {
        //console.log("Feed load skipped: Wallet not connected, contract not initialized.");
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
        flagButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            const button = event.target.closest('button');
            const tokenId = button.dataset.tokenId;
            
            if (!signer) {
                alert('Please connect your wallet to report whispers.');
                return;
            }
            
            // Show report modal/prompt
            const reason = prompt(`Report this whisper for:\n\n1. hate_speech - Hate Speech & Harassment\n2. explicit_content - Explicit Content\n3. spam - Spam & Nonsense\n4. doxxing - Doxxing & Personal Information\n5. misinformation - Misinformation\n6. other - Other\n\nEnter the number (1-6) or reason:`);
            
            if (!reason) return;
            
            const reasonMap = {
                '1': 'hate_speech',
                '2': 'explicit_content', 
                '3': 'spam',
                '4': 'doxxing',
                '5': 'misinformation',
                '6': 'other'
            };
            
            const selectedReason = reasonMap[reason] || reason;
            
            try {
                button.disabled = true;
                button.innerHTML = '<i class="spinner-border spinner-border-sm"></i> Reporting...';
                
                await reportWhisper(tokenId, selectedReason);
                
                button.innerHTML = '<i class="bi bi-flag-fill text-warning"></i> Reported';
                button.title = 'Already reported';
                button.className = 'btn btn-sm btn-warning py-1 px-2';
                alert('Report submitted successfully. Thank you for helping keep our community safe.');
                
            } catch (error) {
                console.error('Error reporting whisper:', error);
                alert(error.message || 'Failed to report whisper. Please try again.');
                button.innerHTML = '<i class="bi bi-flag"></i> Flag';
                button.disabled = false;
            }
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
        
        // Use backend data if available, fallback to localStorage for offline support
        let likeCount = whisper.favorite_count || 0;
        likeCountSpan.textContent = likeCount > 0 ? likeCount : '';

        likeButton.appendChild(likeIcon);
        likeButton.appendChild(likeCountSpan);

        // Check if user has favorited this whisper (async)
        if (signer) {
            checkFavoriteStatus(whisper.tokenId).then(isFavorited => {
                if (isFavorited) {
                    likeIcon.className = 'bi bi-heart-fill text-danger';
                }
            }).catch(error => {
                console.error('Error checking favorite status:', error);
            });
        }

        likeButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            
            if (!signer) {
                alert('Please connect your wallet to favorite whispers.');
                return;
            }
            
            const button = event.currentTarget;
            const icon = button.querySelector('i');
            const countSpan = button.querySelector('span');

            try {
                button.disabled = true;
                const originalIcon = icon.className;
                icon.className = 'spinner-border spinner-border-sm';
                
                const result = await toggleFavorite(whisper.tokenId);
                
                // Update UI based on result
                if (result.favorited) {
                    icon.className = 'bi bi-heart-fill text-danger';
                    likeCount++;
                } else {
                    icon.className = 'bi bi-heart';
                    likeCount--;
                }
                
                countSpan.textContent = likeCount > 0 ? likeCount : '';
                
            } catch (error) {
                console.error('Error toggling favorite:', error);
                alert(error.message || 'Failed to update favorite. Please try again.');
                // Restore original icon on error
                icon.className = icon.classList.contains('bi-heart-fill') ? 'bi bi-heart-fill text-danger' : 'bi bi-heart';
            } finally {
                button.disabled = false;
            }
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

function generateCrypticPattern(text) {
    // Example: Generate a simple SVG pattern based on text hash
    const hash = hashCode(text); // Replace with your hashing function
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <rect width="100%" height="100%" fill="#${hash}"/> <!-- Use hash as color -->
            <path d="M0 0 L50 100 L100 0 Z" stroke="#fff" stroke-width="2" fill-opacity="0.5"/>
        </svg>
    `;
    return btoa(svg); // Convert SVG to base64
}

// Simple hash function (replace with a better one if needed)
function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hash.toString(16).padStart(6, '0'); // Convert to hex and pad to 6 digits
}

// Function to report a whisper
async function reportWhisper(tokenId, reason, additionalDetails = '') {
    if (!signer) {
        throw new Error('Wallet not connected');
    }
    
    const walletAddress = await signer.getAddress();
    
    const response = await fetch('/api/report', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            tokenId,
            walletAddress,
            reason,
            additionalDetails
        })
    });
    
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'Failed to report whisper');
    }
    
    return data;
}

// Function to toggle favorite on a whisper
async function toggleFavorite(tokenId) {
    if (!signer) {
        throw new Error('Wallet not connected');
    }
    
    const walletAddress = await signer.getAddress();
    
    const response = await fetch('/api/favorite', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            tokenId,
            walletAddress
        })
    });
    
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'Failed to update favorite');
    }
    
    return data;
}

// Function to check if user has favorited a whisper
async function checkFavoriteStatus(tokenId) {
    if (!signer) {
        return false;
    }
    
    try {
        const walletAddress = await signer.getAddress();
        const response = await fetch(`/api/favorite-status/${tokenId}/${walletAddress}`);
        
        if (response.ok) {
            const data = await response.json();
            return data.isFavorited;
        }
    } catch (error) {
        console.error('Error checking favorite status:', error);
    }
    
    return false;
}

// Function to get application statistics
async function getAppStatistics() {
    try {
        const response = await fetch('/api/statistics');
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.error('Error fetching statistics:', error);
    }
    return null;
}

// Function to update statistics display
async function updateStatisticsDisplay() {
    try {
        const stats = await getAppStatistics();
        if (stats) {
            const totalTokensElement = document.getElementById('total-tokens-stat');
            const totalWhispersElement = document.getElementById('total-whispers-stat');
            const totalUsersElement = document.getElementById('total-users-stat');
            
            if (totalTokensElement) {
                totalTokensElement.innerHTML = `AI Tokens Used: <strong>${stats.total_ai_tokens_consumed?.toLocaleString() || 0}</strong>`;
            }
            if (totalWhispersElement) {
                totalWhispersElement.innerHTML = `Total Whispers: <strong>${stats.total_whispers_minted?.toLocaleString() || 0}</strong>`;
            }
            if (totalUsersElement) {
                totalUsersElement.innerHTML = `Community Members: <strong>${stats.total_users_connected?.toLocaleString() || 0}</strong>`;
            }
            
            //console.log('📊 Statistics updated:', stats);
        } else {
            console.warn('📊 No statistics data received');
        }
    } catch (error) {
        console.error('📊 Error updating statistics:', error);
        // Set fallback values if there's an error
        const totalTokensElement = document.getElementById('total-tokens-stat');
        const totalWhispersElement = document.getElementById('total-whispers-stat');
        const totalUsersElement = document.getElementById('total-users-stat');
        
        if (totalTokensElement) totalTokensElement.innerHTML = `AI Tokens Used: <strong>Unavailable</strong>`;
        if (totalWhispersElement) totalWhispersElement.innerHTML = `Total Whispers: <strong>Unavailable</strong>`;
        if (totalUsersElement) totalUsersElement.innerHTML = `Community Members: <strong>Unavailable</strong>`;
    }
}

// Function to start periodic statistics updates
function startStatisticsUpdates() {
    // Update immediately
    updateStatisticsDisplay();
    
    // Update every 30 seconds
    setInterval(updateStatisticsDisplay, 30000);
    
    //console.log('📊 Statistics auto-update started (every 30 seconds)');
}

// --- Event Listeners ---

// Wallet Button Click and Tooltip
walletButton?.addEventListener('click', async (event) => {
    event.preventDefault();
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
    if (!whisperNFTContract || !signer) {
        // If disconnected, trigger the wallet connection flow
        //console.log("Wallet icon clicked, initiating connection...");
        await initWallet();
    } else {
        //console.log("Wallet already connected, icon click might be for menu.");
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
    //console.log("Disconnecting wallet...");
    provider = null;
    signer = null;
    whisperNFTContract = null;
    updateUIDisconnected();

    hideError(feedErrorDiv);
    //console.log("Wallet disconnected in UI.");
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

        originalTextPreviewP.textContent = rawText;
        originalPreviewDiv.classList.remove('d-none'); 

        scrambleSpinner?.classList.remove('d-none'); 
        scrambleSpinnerText.textContent = "Scrambling...";
        scrambleButton.disabled = true;
        hideError(submitErrorDiv); 

        const scrambled = await scrambleWhisperViaProxy(rawText);
        scrambledTextP.textContent = scrambled;
        scramblePreviewDiv?.classList.remove('d-none'); 
        reScrambleButton?.classList.remove('d-none');

        durationSelectorDiv?.classList.remove('d-none'); 
        mintButton?.classList.remove('d-none');
        updateStatisticsDisplay(); // Update stats after successful scramble 
    } catch (err) {
        console.error("Scrambling error:", err);
        showError(submitErrorDiv, err.message || "Failed to scramble whisper."); 
        // Hide elements on error
        originalPreviewDiv?.classList.add('d-none'); 
        scramblePreviewDiv?.classList.add('d-none'); 
        reScrambleButton?.classList.add('d-none');
        durationSelectorDiv?.classList.add('d-none'); 
        mintButton?.classList.add('d-none'); 
    } finally {
        scrambleSpinner?.classList.add('d-none'); 
        scrambleSpinnerText.textContent = "Scramble with AI";
    }
});

reScrambleButton?.addEventListener('click', async () => {
    //console.log("Re-scramble button clicked!"); 

    if (!originalTextPreviewP) {
        console.error("originalTextPreviewP element not found!");
        showError(submitErrorDiv, "Application error: Original text preview not found.");
        return;
    }
    if (!scrambleSpinner || !scrambleSpinnerText || !scrambledTextP) {
        console.error("One or more UI elements for scrambling not found!");
        showError(submitErrorDiv, "Application error: UI elements missing.");
        return;
    }

    const rawText = originalTextPreviewP.textContent.trim(); 
    //console.log("Raw text for re-scrambling (after trim):", rawText);

    if (!rawText) {
        console.warn("Re-scramble button clicked but no original text found.");
        showError(submitErrorDiv, "Error: Original whisper text not found for re-scrambling.");
        return;
    }

    const now = Date.now();
    if (now - lastReScrambleAttemptTime < RE_SCRAMBLE_COOLDOWN_MS) {
        const remainingTime = Math.ceil((RE_SCRAMBLE_COOLDOWN_MS - (now - lastReScrambleAttemptTime)) / 1000);
        //console.log(`Re-scramble rate limit hit. Remaining time: ${remainingTime} seconds.`);
        showError(submitErrorDiv, `Please wait ${remainingTime} second(s) before trying again.`);
        return;
    }

    try {
        //console.log("Starting re-scramble process...");
        lastReScrambleAttemptTime = Date.now();

        scrambleSpinner?.classList.remove('d-none'); 
        scrambleSpinnerText.textContent = "Re-scrambling...";
        reScrambleButton.disabled = true; 
        hideError(submitErrorDiv);

        const scrambled = await scrambleWhisperViaProxy(rawText, 'rescramble');

        // Update the scrambled text display
        scrambledTextP.textContent = scrambled;

    } catch (err) {
        console.error("Re-scrambling error:", err);
        showError(submitErrorDiv, err.message || "Failed to re-scramble whisper.");
    } finally {
        //console.log("Re-scramble process finished (success or error). Hiding spinner...");
        scrambleSpinner?.classList.add('d-none'); 
        scrambleSpinnerText.textContent = "Scramble with AI";
        reScrambleButton.disabled = false;
    }
});

// Mint Button
mintButton.addEventListener('click', async () => {
    //console.log("LOG A: Mint button clicked!");

    const scrambledText = scrambledTextP.textContent;
    const duration = parseInt(durationSelect.value, 10);
    //console.log("LOG A1: Scrambled Text:", scrambledText);
    //console.log("LOG A2: Duration Selected:", duration);
    const now = Date.now();
    //console.log("LOG A3: Current Time:", now, "Last Mint Attempt Time:", lastMintAttemptTime);
    if (now - lastMintAttemptTime < MINT_ATTEMPT_COOLDOWN_MS) {
        //console.log("LOG A4: Mint attempt cooldown active. Remaining time:", MINT_ATTEMPT_COOLDOWN_MS - (now - lastMintAttemptTime));
        const remainingTime = Math.ceil((MINT_ATTEMPT_COOLDOWN_MS - (now - lastMintAttemptTime)) / 1000);
        showError(submitErrorDiv, `Please wait ${remainingTime} second(s) before trying again.`);
        //console.log("LOG A5: Mint attempt cooldown error shown.");
        return;
    }
    //console.log("LOG A6: Passed initial cooldown check. Proceeding with minting...");
    if (!scrambledText) {
        console.warn("LOG A7: No scrambled text available for minting.");
        showError(submitErrorDiv, "No scrambled text available.");
        //console.log("LOG A8: Minting aborted due to missing scrambled text.");
        return;
    }

    //console.log("LOG B: Passed initial checks. About to enter MAIN try block.");
    //console.log("LOG C: Values - scrambledText length:", scrambledText?.length, "duration:", duration);
    //console.log("Passed initial checks, about to enter try block. scrambledText length:", scrambledText.length, "duration:", duration);

    try {
        //console.log("LOG D: Inside MAIN try block. First line executed.");
        lastMintAttemptTime = Date.now();

        //console.log("Showing mint spinner...");
        mintSpinner?.classList.remove('d-none');
        mintSpinnerText.textContent = "Minting...";
        mintButton.disabled = true;
        //console.log("Spinner shown, button disabled.");

        //console.log("Calling mintWhisperNFT with:", { scrambledText, duration });

        //console.log("LOG E: Calling mintWhisperNFT...");
        const result = await mintWhisperNFT(scrambledText, duration);
        //console.log("LOG F: Minting successful, result received:", result);

        alert(`Whisper minted successfully!\nTx Hash: ${result.txHash}\nToken ID: ${result.tokenId || 'N/A'}`);

        // Track the whisper in database
        if (result.tokenId && signer) {
            try {
                const walletAddress = await signer.getAddress();
                const expiryTimestamp = Math.floor(Date.now() / 1000) + duration;
                
                await fetch('/api/track-whisper', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tokenId: result.tokenId,
                        walletAddress,
                        aiOperationId: null, // Could be linked to scramble operation in future
                        scrambledText,
                        durationSeconds: duration,
                        expiryTimestamp,
                        txHash: result.txHash,
                        blockNumber: null // Will be filled when available
                    })
                });
                //console.log('✅ Whisper tracked in database');
            } catch (trackingError) {
                console.warn('⚠️ Failed to track whisper in database:', trackingError);
                // Don't fail the whole process if tracking fails
            }
        }

        clearSubmitForm();
        loadWhisperFeed();
        updateStatisticsDisplay(); // Update stats after successful mint
    } catch (err) {

        //console.log("LOG G: Inside MAIN catch block. Error caught.");
        console.error("Minting error (caught in event listener):", err);
        showError(submitErrorDiv, err.message || "Failed to mint whisper NFT.");
    } finally {

        //console.log("LOG H: Inside MAIN finally block. Cleaning up.");
        mintSpinner?.classList.add('d-none');
        mintSpinnerText.textContent = "Mint Whisper NFT";
        mintButton.disabled = false;
        //console.log("Spinner hidden, button re-enabled.");
        //console.log("LOG I: MAIN finally block finished.");
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
    startStatisticsUpdates(); // Start periodic statistics updates
});
