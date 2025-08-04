require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', async (req, res) => {
    try {
        const htmlFilePath = path.join(__dirname, '../public/index.html');
        let htmlContent = await fs.readFile(htmlFilePath, 'utf8');

        const contractAddress = process.env.VITE_CONTRACT_ADDRESS;
        console.log("Server - Contract Address from .env:", contractAddress);

        if (!contractAddress) {
            console.error("Server Error: VITE_CONTRACT_ADDRESS not found in .env");
            return res.status(500).send("Server configuration error: Contract address missing.");
        }

        const placeholder = '0x561C97731839A1C65070B424283A7cb3d41027Da';
        if (htmlContent.includes(placeholder)) {
            htmlContent = htmlContent.replace(placeholder, contractAddress);
            console.log("Server - Contract Address injected successfully:", contractAddress); // Debug log
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
    const { rawWhisper } = req.body;
    if (!rawWhisper) {
        return res.status(400).json({ error: 'Raw whisper text is required.' });
    }

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
            console.log("Received scrambled whisper from Gaia:", scrambledText);
            return res.json({ scrambledText });
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
            console.log("Raw AI Prompt Response:", content);

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

app.listen(PORT, () => {
    console.log(`MorphEcho dApp server listening at http://localhost:${PORT}`);
});
