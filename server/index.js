require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const OpenAI = require('openai');

// Database imports
const { testConnection, isDatabaseAvailable } = require('../database/connection');
const { User, AIOperation, Whisper, Report, Favorite, Statistics } = require('../database/models');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', async (req, res) => {
    try {
        const htmlFilePath = path.join(__dirname, '../public/index.html');
        let htmlContent = await fs.readFile(htmlFilePath, 'utf8');

        const contractAddress = process.env.VITE_CONTRACT_ADDRESS;
        //console.log("Server - Contract Address from .env:", contractAddress);

        if (!contractAddress) {
            console.error("Server Error: VITE_CONTRACT_ADDRESS not found in .env");
            return res.status(500).send("Server configuration error: Contract address missing.");
        }

        const placeholder = '0x561C97731839A1C65070B424283A7cb3d41027Da';
        if (htmlContent.includes(placeholder)) {
            htmlContent = htmlContent.replace(placeholder, contractAddress);
            //console.log("Server - Contract Address injected successfully:", contractAddress); // Debug log
        } else {
            console.error("Server Error: Placeholder 'YOUR_FALLBACK_ADDRESS' not found in index.html");
        }

        res.setHeader('Content-Type', 'text/html');
        res.send(htmlContent);
    } catch (err) {
        console.error('Server Error serving index.html:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/api/scramble', express.json(), async (req, res) => {
    const { rawWhisper, walletAddress, operationType = 'scramble' } = req.body;
    if (!rawWhisper) {
        return res.status(400).json({ error: 'Raw whisper text is required.' });
    }

    const startTime = Date.now();
    
    // Use environment variables from .env
    const GAIA_API_KEY = process.env.VITE_GAIA_API_KEY;
    const GAIA_BASE_URL = process.env.VITE_GAIA_BASE_URL;

    if (!GAIA_API_KEY || !GAIA_BASE_URL) {
        console.error("Gaia API configuration missing in environment variables.");
        return res.status(500).json({ error: 'AI service not configured correctly.' });
    }

    try {
        const openai = new OpenAI({
            apiKey: GAIA_API_KEY,
            baseURL: GAIA_BASE_URL,
        });

        const prompt = `You are an AI tasked with transforming raw human thoughts into ephemeral, public messages. Your goal is to anonymize the specific details while capturing the core feeling or essence poetically.

Instructions:
1.  Receive the "User Thought".
2.  Transform it into a short, cryptic, poetic, or thematic message. This is the "Scrambled Whisper".
3.  Prioritize styles like metaphors, haikus, riddles, or vivid imagery. Avoid literal summaries.
4.  Obscure personal details, names, specific places, or data that could identify the user or the exact situation.
5.  Preserve the underlying emotion or central idea (e.g., frustration, joy, nostalgia).
6.  Keep the "Scrambled Whisper" concise and suitable for a public feed of temporary messages.
7.  Respond ONLY with the "Scrambled Whisper". Do not include any other text, explanations, or formatting.
8.  Do not use any external tools, search the internet, or access external data. Base the transformation solely on the provided text and your internal knowledge.

User Thought: "${rawWhisper}"

Scrambled Whisper:`;

        const chatCompletion = await openai.chat.completions.create({
            model: "Llama-3-Groq-8B-Tool",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 200,
            temperature: 0.8,
        });
        if (
            chatCompletion &&
            chatCompletion.choices &&
            chatCompletion.choices.length > 0 &&
            chatCompletion.choices[0].message &&
            chatCompletion.choices[0].message.content
        ) {
            const scrambledText = chatCompletion.choices[0].message.content.trim();
            const processingTime = Date.now() - startTime;
            const tokensConsumed = chatCompletion.usage?.total_tokens || 0;
            
            //console.log("Received scrambled whisper from Gaia:", scrambledText);
            
            // Track AI operation if wallet address is provided
            if (walletAddress) {
                try {
                    const user = await User.findOrCreateByWallet(walletAddress);
                    await AIOperation.create(
                        user.id,
                        operationType,
                        rawWhisper,
                        scrambledText,
                        tokensConsumed,
                        "Llama-3-Groq-8B-Tool",
                        processingTime,
                        true
                    );
                } catch (trackingError) {
                    console.error('Error tracking AI operation:', trackingError);
                    // Don't fail the request if tracking fails
                }
            }
            
            return res.json({ scrambledText, operationId: walletAddress ? 'tracked' : null });
        } else {
            console.error("Gaia API returned an unexpected response format:", chatCompletion);
            return res.status(500).json({ error: 'Gaia API returned an unexpected response format.' });
        }
        // ----------------------------
    } catch (error) {
        // --- Improved Error Handling ---
        console.error("Error calling Gaia API to scramble whisper:");
        // Log more details if available
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error("Response data:", error.response.data);
            console.error("Response status:", error.response.status);
            console.error("Response headers:", error.response.headers);
            // Return a user-friendly message, but log the details
            return res.status(500).json({ error: `AI service error (${error.response.status}).` });
        } else if (error.request) {
            // The request was made but no response was received
            console.error("Request data:", error.request);
            return res.status(500).json({ error: 'No response received from AI service.' });
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error("Error message:", error.message);
            return res.status(500).json({ error: `Error setting up AI service request: ${error.message}` });
        }
        // --------------------------------
    }
});

app.get('/api/prompts', async (req, res) => {
    const GAIA_API_KEY = process.env.VITE_GAIA_API_KEY;
    const GAIA_BASE_URL = process.env.VITE_GAIA_BASE_URL;

    if (!GAIA_API_KEY || !GAIA_BASE_URL) {
        console.error("Gaia API configuration missing for prompts.");
        return res.status(500).json({ error: 'AI prompt service not configured.' });
    }

    try {
        // Use the OpenAI SDK instance created earlier or create a new one
        const openai = new OpenAI({
            apiKey: GAIA_API_KEY,
            baseURL: GAIA_BASE_URL,
        });

        // Define a prompt for the AI to generate user prompts
        const systemPrompt = "You are an AI assistant for a dApp called MorphEcho. Users share ephemeral, anonymous thoughts. Generate 3 short, diverse, creative, and engaging example thoughts a user might want to share. They should be relatable, slightly cryptic, or thematic. Respond ONLY with a JSON array of 3 strings, like: [\"Thought 1\", \"Thought 2\", \"Thought 3\"]. Do not include any other text, markdown, or explanation. DO NOT call any external tools.";

        const chatCompletion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo", // Adjust model as needed
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: "Generate example thoughts for MorphEcho users." }
            ],
            max_tokens: 200,
            temperature: 0.9, // Higher temp for creativity
        });

        if (chatCompletion.choices?.[0]?.message?.content) {
            let content = chatCompletion.choices[0].message.content.trim();
            //console.log("Raw AI Prompt Response:", content);

            // Attempt to parse the JSON response
            try {
                // Handle potential markdown code block wrapper
                if (content.startsWith("```json")) {
                    content = content.substring(7); // Remove ```json
                }
                if (content.endsWith("```")) {
                    content = content.substring(0, content.length - 3); // Remove ```
                }
                content = content.trim();

                const promptsArray = JSON.parse(content);
                if (Array.isArray(promptsArray) && promptsArray.length > 0) {
                    // Ensure they are strings
                    const cleanPrompts = promptsArray.map(p => String(p).trim()).filter(p => p.length > 0);
                    if (cleanPrompts.length > 0) {
                        return res.json({ prompts: cleanPrompts });
                    }
                }
                throw new Error("Parsed response was not a valid array of strings.");
            } catch (parseError) {
                console.error("Error parsing AI prompts response:", parseError);
                console.error("AI response content:", content);
                return res.status(500).json({ error: 'Failed to parse AI-generated prompts.' });
            }
        } else {
            throw new Error("Empty response from AI for prompts.");
        }
    } catch (error) {
        console.error("Error generating prompts from Gaia:", error.response?.data || error.message);
        res.status(500).json({ error: 'Error communicating with AI prompt service.' });
    }
});
// --- Optional: Proxy endpoint for Gaia API ---
// This can help avoid exposing the Gaia API key directly to the browser.
// Requires installing 'axios': npm install axios
/*
const axios = require('axios');
app.post('/api/scramble', express.json(), async (req, res) => {
    const { rawWhisper } = req.body;
    if (!rawWhisper) {
        return res.status(400).json({ error: 'Raw whisper text is required.' });
    }

    try {
        const prompt = `Rephrase the following user thought into a short, cryptic, poetic, or thematic message. The goal is to anonymize the specific details while capturing the core feeling or idea. Make it suitable for a public, ephemeral message feed.

User Thought: "${rawWhisper}"

Scrambled Whisper:`;

        const response = await axios.post(
            `${process.env.VITE_GAIA_BASE_URL}/chat/completions`,
            {
                model: "gpt-3.5-turbo", // Adjust model as needed
                messages: [{ role: "user", content: prompt }],
                max_tokens: 200,
                temperature: 0.8,
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.VITE_GAIA_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const scrambledText = response.data.choices[0]?.message?.content?.trim();
        if (scrambledText) {
            res.json({ scrambledText });
        } else {
            res.status(500).json({ error: 'Failed to get scrambled text from Gaia.' });
        }
    } catch (error) {
        console.error("Error proxying to Gaia:", error.response?.data || error.message);
        res.status(500).json({ error: 'Error communicating with AI service.' });
    }
});
*/
// --- End Optional Proxy ---

// API endpoint to report a whisper
app.post('/api/report', express.json(), async (req, res) => {
    try {
        // Check if database is available (without creating new connections)
        if (!isDatabaseAvailable()) {
            return res.status(503).json({ error: 'Database service temporarily unavailable. Please try again later.' });
        }
        
        const { tokenId, walletAddress, reason, additionalDetails } = req.body;
        
        if (!tokenId || !walletAddress || !reason) {
            return res.status(400).json({ error: 'Token ID, wallet address, and reason are required.' });
        }

        // Check if user has already reported this whisper using tokenId directly
        const hasReported = await Report.hasUserReportedByTokenId(tokenId, walletAddress);
        if (hasReported) {
            return res.status(409).json({ error: 'You have already reported this whisper.' });
        }

        // Create the report using tokenId directly
        const reportId = await Report.createByTokenId(tokenId, walletAddress, reason, additionalDetails);
        
        res.json({ 
            success: true, 
            reportId,
            message: 'Report submitted successfully. Thank you for helping keep our community safe.' 
        });
    } catch (error) {
        console.error('Error submitting report:', error);
        res.status(500).json({ error: error.message || 'Failed to submit report.' });
    }
});

// API endpoint to toggle favorite/heart on a whisper
app.post('/api/favorite', express.json(), async (req, res) => {
    try {
        // Check if database is available (without creating new connections)
        if (!isDatabaseAvailable()) {
            return res.status(503).json({ error: 'Database service temporarily unavailable. Please try again later.' });
        }
        
        const { tokenId, walletAddress } = req.body;
        
        if (!tokenId || !walletAddress) {
            return res.status(400).json({ error: 'Token ID and wallet address are required.' });
        }

        // Toggle the favorite using tokenId directly
        const result = await Favorite.toggleByTokenId(tokenId, walletAddress);
        
        res.json({ 
            success: true, 
            favorited: result.favorited,
            action: result.action,
            message: `Whisper ${result.action} ${result.favorited ? 'to' : 'from'} favorites.`
        });
    } catch (error) {
        console.error('Error toggling favorite:', error);
        res.status(500).json({ error: error.message || 'Failed to update favorite.' });
    }
});

// API endpoint to get user's favorite whispers
app.get('/api/favorites/:walletAddress', async (req, res) => {
    try {
        if (!isDatabaseAvailable()) {
            return res.status(503).json({ error: 'Database service temporarily unavailable.' });
        }
        
        const { walletAddress } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        
        if (!walletAddress) {
            return res.status(400).json({ error: 'Wallet address is required.' });
        }

        const favorites = await Favorite.getByUser(walletAddress, limit);
        res.json({ favorites });
    } catch (error) {
        console.error('Error fetching favorites:', error);
        res.status(500).json({ error: 'Failed to fetch favorites.' });
    }
});

// API endpoint to check if user has favorited a whisper
app.get('/api/favorite-status/:tokenId/:walletAddress', async (req, res) => {
    try {
        if (!isDatabaseAvailable()) {
            return res.json({ isFavorited: false }); // Default to false when DB unavailable
        }
        
        const { tokenId, walletAddress } = req.params;
        
        // Check favorite status using tokenId directly
        const isFavorited = await Favorite.isUserFavoriteByTokenId(tokenId, walletAddress);
        res.json({ isFavorited });
    } catch (error) {
        console.error('Error checking favorite status:', error);
        res.status(500).json({ error: 'Failed to check favorite status.' });
    }
});

// API endpoint to get application statistics
app.get('/api/statistics', async (req, res) => {
    try {
        // Check if database is available (without creating new connections)
        if (!isDatabaseAvailable()) {
            // Return default stats when database is unavailable
            return res.json({
                total_ai_tokens_consumed: 0,
                total_whispers_minted: 0,
                total_users_connected: 0,
                total_reports_submitted: 0,
                total_favorites_given: 0
            });
        }
        
        const stats = await Statistics.getAll();
        res.json(stats);
    } catch (error) {
        console.error('Error fetching statistics:', error);
        // If there's a database error, mark as unavailable and return defaults
        if (error.code === 'ECONNRESET' || error.code === 'PROTOCOL_CONNECTION_LOST') {
            console.warn('Database connection lost, marking as unavailable');
            return res.json({
                total_ai_tokens_consumed: 0,
                total_whispers_minted: 0,
                total_users_connected: 0,
                total_reports_submitted: 0,
                total_favorites_given: 0
            });
        }
        res.status(500).json({ error: 'Failed to fetch statistics.' });
    }
});

// API endpoint to track AI operations and update user data
app.post('/api/track-ai-operation', express.json(), async (req, res) => {
    try {
        if (!isDatabaseAvailable()) {
            // Silently succeed when database is unavailable (tracking is optional)
            return res.json({ success: true, message: 'AI operation completed (tracking unavailable).' });
        }
        
        const { 
            walletAddress, 
            operationType, 
            originalText, 
            scrambledText, 
            tokensConsumed, 
            modelUsed, 
            processingTime,
            success = true,
            errorMessage = null
        } = req.body;
        
        if (!walletAddress || !operationType || !originalText) {
            return res.status(400).json({ error: 'Wallet address, operation type, and original text are required.' });
        }

        // Find or create user
        const user = await User.findOrCreateByWallet(walletAddress);
        
        // Create AI operation record
        const operationId = await AIOperation.create(
            user.id, 
            operationType, 
            originalText, 
            scrambledText, 
            tokensConsumed || 0, 
            modelUsed, 
            processingTime,
            success,
            errorMessage
        );
        
        res.json({ 
            success: true, 
            operationId,
            message: 'AI operation tracked successfully.' 
        });
    } catch (error) {
        console.error('Error tracking AI operation:', error);
        res.status(500).json({ error: 'Failed to track AI operation.' });
    }
});

// API endpoint to track whisper minting
app.post('/api/track-whisper', express.json(), async (req, res) => {
    try {
        if (!isDatabaseAvailable()) {
            // Silently succeed when database is unavailable (tracking is optional)
            return res.json({ success: true, message: 'Whisper minted successfully (tracking unavailable).' });
        }
        
        const { 
            tokenId, 
            walletAddress, 
            aiOperationId,
            scrambledText, 
            durationSeconds, 
            expiryTimestamp, 
            txHash, 
            blockNumber 
        } = req.body;
        
        if (!tokenId || !walletAddress || !scrambledText) {
            return res.status(400).json({ error: 'Token ID, wallet address, and scrambled text are required.' });
        }

        // Find or create user
        const user = await User.findOrCreateByWallet(walletAddress);
        
        // Create whisper record
        const whisperId = await Whisper.create(
            tokenId, 
            user.id, 
            aiOperationId || null,
            scrambledText, 
            durationSeconds, 
            expiryTimestamp, 
            txHash || null, 
            blockNumber || null
        );
        
        res.json({ 
            success: true, 
            whisperId,
            message: 'Whisper tracked successfully.' 
        });
    } catch (error) {
        console.error('Error tracking whisper:', error);
        res.status(500).json({ error: 'Failed to track whisper.' });
    }
});

app.get('/api/config', (req, res) => {
    const config = {
        contractAddress: process.env.VITE_CONTRACT_ADDRESS || null
    };
    // Basic validation
    if (!config.contractAddress) {
        return res.status(500).json({ error: "Contract address not configured on server." });
    }
    res.json(config);
});

// Initialize database connection and start server
async function startServer() {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
        console.warn('⚠️  Database connection failed. Some features may not work properly.');
        console.warn('   📝 Reports, favorites, and statistics will be disabled');
        console.warn('   🔧 Check your database credentials in .env file');
    }

    app.listen(PORT, () => {
        //console.log(`🚀 MorphEcho dApp server listening at http://localhost:${PORT}`);
        if (dbConnected) {
            //console.log('✅ Database features enabled (reports, favorites, statistics)');
        } else {
            //console.log('⚠️  Running in basic mode (no database features)');
        }
    });
}

startServer();
