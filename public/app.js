// public/app.js
// --- NO require or import statements for ethers/openai ---
// They are loaded globally via CDN script tags in index.html
// window.ethers should be available

// --- State ---
let provider = null;
let signer = null;
let whisperNFTContract = null;
let WHISPER_NFT_ABI = null; // Will be loaded dynamically
let CONTRACT_ADDRESS = null; // Will be loaded from meta tag or API
let lastMintAttemptTime = 0; // Timestamp of the last mint attempt
const MINT_ATTEMPT_COOLDOWN_MS = 3000; // 3 seconds between mint attempts (UI level)

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
        console.log("Bad words already loaded.");
        return true;
    }

    try {
        console.log("Attempting to load bad words from /badwords.txt");
        const response = await fetch('/badwords.txt');
        if (!response.ok) {
            throw new Error(`Failed to load bad words list: ${response.status} ${response.statusText}`);
        }
        const text = await response.text();
        const badWordsArray = text.split('\n').map(word => word.trim().toLowerCase()).filter(word => word.length > 0);
        BAD_WORDS_SET = new Set(badWordsArray);
        console.log(`Loaded ${BAD_WORDS_SET.size} bad words.`);
        return true;
    } catch (error) {
        console.error("Error loading bad words:", error);
        BAD_WORDS_SET = new Set();
        return false;
    }
}

function containsBadWords(text) {
    if (!BAD_WORDS_SET || BAD_WORDS_SET.size === 0) {
        console.warn("Bad words list not loaded or is empty.");
        return false;
    }
    const lowerText = text.toLowerCase();
    for (const badWord of BAD_WORDS_SET) {
        if (lowerText.includes(badWord)) {
            console.log(`Found bad word: ${badWord}`);
            return true;
        }
    }
    return false;
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
        console.log("WhisperNFT contract instance created at:", CONTRACT_ADDRESS);

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
    // Finally block for mintWhisperNFT is inside the event listener
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
        walletIconDisconnected.classList.add('hidden');
        walletIconConnected.classList.remove('hidden');
        walletConnectedAddress.textContent = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
        walletInfoConnected.classList.remove('hidden');
        walletInfoDisconnected.classList.add('hidden');
        walletMessageP.textContent = "";
        submitSection.classList.remove('hidden');

        // --- Load ephemeral prompts ---
        if (promptsContainer && promptsDiv) {
            promptsDiv.innerHTML = '';
            EPHEMERAL_THOUGHT_PROMPTS.forEach(promptText => {
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
            promptsContainer.classList.remove('hidden');
        }
        // --- End prompts ---

    } catch (err) {
        console.error("Error getting signer address:", err);
        walletConnectedAddress.textContent = "Connected (Error)";
        walletInfoConnected.classList.remove('hidden');
        walletInfoDisconnected.classList.add('hidden');
    }
    connectButtonMain?.classList.add('hidden');
}

function updateUIDisconnected() {
    walletIconDisconnected.classList.remove('hidden');
    walletIconConnected.classList.add('hidden');
    walletInfoConnected.classList.add('hidden');
    walletInfoDisconnected.classList.remove('hidden');
    walletMessageP.textContent = "Please connect your wallet.";
    connectButtonMain?.classList.remove('hidden');
    submitSection.classList.add('hidden');
    clearSubmitForm();
    noWhispersMessage.textContent = "No whispers found. Connect your wallet and be the first to share one!";
    loadWhisperFeed();

    if (promptsContainer) {
        promptsContainer.classList.add('hidden');
    }
}

function clearSubmitForm() {
    rawWhisperTextarea.value = '';
    scramblePreviewDiv.classList.add('hidden');
    durationSelectorDiv.classList.add('hidden');
    mintButton.classList.add('hidden');
    submitErrorDiv.classList.add('hidden');
    // Crucial: Explicitly reset spinners and button states
    scrambleSpinner?.classList.add('hidden');
    scrambleSpinnerText.textContent = "Scramble with AI";
    mintSpinner?.classList.add('hidden');
    mintSpinnerText.textContent = "Mint Whisper NFT";
    // Let the input event listener handle disabling/enabling scrambleButton
    // mintButton state is managed by its event listener
}

function showLoadingSpinner(isLoading) {
    if (isLoading) {
        loadingSpinner?.classList.remove('hidden');
        whisperFeedDiv?.classList.add('hidden');
        noWhispersMessage?.classList.add('hidden');
    } else {
        loadingSpinner?.classList.add('hidden');
        whisperFeedDiv?.classList.remove('hidden');
    }
}

function showError(targetDiv, message) {
    const plainText = message.replace(/<[^>]*>?/gm, '');
    targetDiv.textContent = plainText;
    targetDiv.classList.remove('hidden');
}

function hideError(targetDiv) {
    targetDiv.classList.add('hidden');
}

async function loadWhisperFeed() {
    if (!whisperNFTContract) {
        console.log("Feed load skipped: Wallet not connected, contract not initialized.");
        showLoadingSpinner(false);
        hideError(feedErrorDiv);
        whisperFeedDiv.innerHTML = '';
        noWhispersMessage.textContent = "Please connect your wallet to see whispers.";
        noWhispersMessage.classList.remove('hidden');
        return;
    }

    showLoadingSpinner(true);
    hideError(feedErrorDiv);

    try {
        const whispers = await fetchRecentWhispers(15);
        renderWhisperFeed(whispers);
    } catch (err) {
        console.error("Error loading feed:", err);
        showError(feedErrorDiv, err.message || "Could not load whispers.");
        whisperFeedDiv.innerHTML = '';
        noWhispersMessage.classList.remove('hidden');
    } finally {
        showLoadingSpinner(false);
    }
}

function renderWhisperFeed(whispers) {
    whisperFeedDiv.innerHTML = '';
    if (!whispers || whispers.length === 0) {
        noWhispersMessage.classList.remove('hidden');
        return;
    }
    noWhispersMessage.classList.add('hidden');

    whispers.forEach(whisper => {
        const whisperCard = document.createElement('div');
        whisperCard.className = 'whisper-card p-3 rounded border bg-white';

        if (whisper.isExpired || whisper.isForgotten) {
            whisperCard.classList.add('expired', 'line-through', 'text-gray-500', 'bg-gray-50');
        } else {
            const timeUntilExpiry = (whisper.expiryTime * 1000) - Date.now();
            if (timeUntilExpiry > 0 && timeUntilExpiry < 60 * 60 * 1000) {
                whisperCard.classList.add('soon-expiring', 'bg-yellow-100', 'border-yellow-400');
            }
        }

        const tokenIdSpan = document.createElement('span');
        tokenIdSpan.className = 'text-xs font-medium text-gray-500';
        tokenIdSpan.textContent = `#${whisper.tokenId}`;

        const expiryDate = new Date(whisper.expiryTime * 1000);
        let statusMessage = "";
        if (whisper.isExpired || whisper.isForgotten) {
            statusMessage = "Expired/Forgotten";
        } else {
            const timeUntilExpiry = expiryDate - Date.now();
            if (timeUntilExpiry > 0 && timeUntilExpiry < 60 * 60 * 1000) {
                const minutes = Math.floor(timeUntilExpiry / (1000 * 60));
                statusMessage = `Expires in ~${minutes} min`;
            } else {
                statusMessage = `Expires: ${expiryDate.toLocaleString()}`;
            }
        }
        const statusSpan = document.createElement('span');
        statusSpan.className = 'text-xs font-medium';
        if (whisper.isExpired || whisper.isForgotten) {
            statusSpan.classList.add('text-gray-500');
        } else if (whisperCard.classList.contains('soon-expiring')) {
             statusSpan.classList.add('text-orange-500');
        } else {
             statusSpan.classList.add('text-green-600');
        }
        statusSpan.textContent = statusMessage;
        statusSpan.style.float = 'right';

        const textP = document.createElement('p');
        textP.className = 'text-gray-800 mt-1';
        if (whisper.isExpired || whisper.isForgotten) {
            textP.classList.add('italic');
        }
        textP.textContent = whisper.text;

        // Add Flag Button
        const flagButtonContainer = document.createElement('div');
        flagButtonContainer.className = 'mt-2 text-right';
        const flagButton = document.createElement('button');
        flagButton.type = 'button';
        flagButton.className = 'text-xs text-gray-400 hover:text-red-500 focus:outline-none';
        flagButton.textContent = 'Flag';
        flagButton.title = 'Report this whisper';
        flagButton.dataset.tokenId = whisper.tokenId;
        flagButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const tokenId = event.target.dataset.tokenId;
            console.log(`Flag button clicked for token ID: ${tokenId}`);
            alert(`Reporting feature is a placeholder for token ID: ${tokenId}.`);
        });
        flagButtonContainer.appendChild(flagButton);

        whisperCard.appendChild(tokenIdSpan);
        whisperCard.appendChild(statusSpan);
        whisperCard.appendChild(document.createElement('br'));
        whisperCard.appendChild(flagButtonContainer);
        whisperCard.appendChild(textP);

        whisperFeedDiv.appendChild(whisperCard);
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

        // Show spinner, disable button
        scrambleSpinner?.classList.remove('hidden');
        scrambleSpinnerText.textContent = "Scrambling...";
        scrambleButton.disabled = true; // Disable while processing
        hideError(submitErrorDiv);

        const scrambled = await scrambleWhisperViaProxy(rawText);

        scrambledTextP.textContent = scrambled;
        scramblePreviewDiv?.classList.remove('hidden');
        durationSelectorDiv?.classList.remove('hidden');
        mintButton?.classList.remove('hidden');
    } catch (err) {
        console.error("Scrambling error:", err);
        showError(submitErrorDiv, err.message || "Failed to scramble whisper.");
        scramblePreviewDiv?.classList.add('hidden');
        durationSelectorDiv?.classList.add('hidden');
        mintButton?.classList.add('hidden');
        // Do not update lastMintAttemptTime on error, allow retry sooner?
    } finally {
        // Crucial: Always hide spinner and reset button text in finally
        // Button enabled state is handled by input listener
        scrambleSpinner?.classList.add('hidden');
        scrambleSpinnerText.textContent = "Scramble with AI";
        // scrambleButton.disabled is managed by input event listener based on textarea content
        // If you want to force enable/disable here based on outcome, do it explicitly:
        // e.g., scrambleButton.disabled = !rawWhisperTextarea.value.trim(); // Re-evaluate
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

        // Show mint spinner on button
        mintSpinner?.classList.remove('hidden');
        mintSpinnerText.textContent = "Minting...";
        mintButton.disabled = true; // Disable while processing

        const result = await mintWhisperNFT(scrambledText, duration);
        console.log("Minting successful:", result);
        alert(`Whisper minted successfully!\nTx Hash: ${result.txHash}\nToken ID: ${result.tokenId || 'N/A'}`);

        clearSubmitForm(); // This now correctly resets spinners
        loadWhisperFeed();
    } catch (err) {
        console.error("Minting error:", err);
        showError(submitErrorDiv, err.message || "Failed to mint whisper NFT.");
        // Do not update lastMintAttemptTime on error, allow retry sooner?
    } finally {
        // Crucial: Always hide spinner and reset button text/state in finally
        mintSpinner?.classList.add('hidden');
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
