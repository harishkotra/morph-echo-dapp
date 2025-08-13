const { getOne, getMany, insertOne, updateOne, executeQuery } = require('./connection');

// User model
class User {
    static async findOrCreateByWallet(walletAddress) {
        // First try to find existing user
        let user = await getOne(
            'SELECT * FROM users WHERE wallet_address = ?',
            [walletAddress]
        );

        if (!user) {
            // Create new user
            const userId = await insertOne(
                'INSERT INTO users (wallet_address) VALUES (?)',
                [walletAddress]
            );
            
            // Update total users count
            await executeQuery(
                'UPDATE app_statistics SET stat_value = stat_value + 1 WHERE stat_name = "total_users_connected"'
            );
            
            user = await getOne('SELECT * FROM users WHERE id = ?', [userId]);
        } else {
            // Update last active time
            await updateOne(
                'UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?',
                [user.id]
            );
        }

        return user;
    }

    static async updateTokensConsumed(userId, tokensConsumed) {
        await updateOne(
            'UPDATE users SET total_ai_tokens_consumed = total_ai_tokens_consumed + ? WHERE id = ?',
            [tokensConsumed, userId]
        );
        
        // Update global statistics
        await executeQuery(
            'UPDATE app_statistics SET stat_value = stat_value + ? WHERE stat_name = "total_ai_tokens_consumed"',
            [tokensConsumed]
        );
    }

    static async incrementWhisperCount(userId) {
        await updateOne(
            'UPDATE users SET total_whispers_minted = total_whispers_minted + 1 WHERE id = ?',
            [userId]
        );
        
        // Update global statistics
        await executeQuery(
            'UPDATE app_statistics SET stat_value = stat_value + 1 WHERE stat_name = "total_whispers_minted"'
        );
    }
}

// AI Operations model
class AIOperation {
    static async create(userId, operationType, originalText, scrambledText, tokensConsumed, modelUsed, processingTime, success = true, errorMessage = null) {
        // Convert undefined values to null for MySQL compatibility
        const params = [
            userId || null,
            operationType || null,
            originalText || null,
            scrambledText || null,
            tokensConsumed || 0,
            modelUsed || null,
            processingTime || null,
            success !== undefined ? success : true,
            errorMessage || null
        ];
        
        const operationId = await insertOne(
            `INSERT INTO ai_operations 
             (user_id, operation_type, original_text, scrambled_text, tokens_consumed, model_used, processing_time_ms, success, error_message) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params
        );

        // Update user's token consumption
        if (success && tokensConsumed > 0) {
            await User.updateTokensConsumed(userId, tokensConsumed);
        }

        return operationId;
    }

    static async getByUser(userId, limit = 10) {
        return await getMany(
            'SELECT * FROM ai_operations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
            [userId, limit]
        );
    }
}

// Whispers model
class Whisper {
    static async create(tokenId, userId, aiOperationId, scrambledText, durationSeconds, expiryTimestamp, txHash, blockNumber) {
        // Convert undefined values to null for MySQL compatibility
        const params = [
            tokenId || null,
            userId || null,
            aiOperationId || null,
            scrambledText || null,
            durationSeconds || null,
            expiryTimestamp || null,
            txHash || null,
            blockNumber || null
        ];
        
        const whisperId = await insertOne(
            `INSERT INTO whispers 
             (token_id, user_id, ai_operation_id, scrambled_text, duration_seconds, expiry_timestamp, tx_hash, block_number) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            params
        );

        // Update user's whisper count
        await User.incrementWhisperCount(userId);

        return whisperId;
    }

    static async findByTokenId(tokenId) {
        return await getOne(
            'SELECT * FROM whisper_details WHERE token_id = ?',
            [tokenId]
        );
    }

    static async getRecent(limit = 15) {
        return await getMany(
            'SELECT * FROM whisper_details ORDER BY created_at DESC LIMIT ?',
            [limit]
        );
    }

    static async updateExpiredStatus(tokenId, isExpired, isForgotten = false) {
        return await updateOne(
            'UPDATE whispers SET is_expired = ?, is_forgotten = ? WHERE token_id = ?',
            [isExpired, isForgotten, tokenId]
        );
    }
}

// Reports model
class Report {
    static async createByTokenId(tokenId, reporterWalletAddress, reason, additionalDetails = null) {
        try {
            // Find or create reporter user
            const reporter = await User.findOrCreateByWallet(reporterWalletAddress);
            
            const reportId = await insertOne(
                `INSERT INTO reports 
                 (whisper_id, token_id, reporter_user_id, reporter_wallet_address, reason, additional_details) 
                 VALUES (NULL, ?, ?, ?, ?, ?)`,
                [tokenId, reporter.id, reporterWalletAddress, reason, additionalDetails]
            );

            // Update global statistics
            await executeQuery(
                'UPDATE app_statistics SET stat_value = stat_value + 1 WHERE stat_name = "total_reports_submitted"'
            );

            return reportId;
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new Error('You have already reported this whisper');
            }
            throw error;
        }
    }

    static async getByTokenId(tokenId) {
        return await getMany(
            'SELECT * FROM reports WHERE token_id = ? ORDER BY created_at DESC',
            [tokenId]
        );
    }

    static async hasUserReportedByTokenId(tokenId, walletAddress) {
        const report = await getOne(
            'SELECT id FROM reports WHERE token_id = ? AND reporter_wallet_address = ?',
            [tokenId, walletAddress]
        );
        return !!report;
    }

    static async updateStatus(reportId, status, adminNotes = null) {
        return await updateOne(
            'UPDATE reports SET status = ?, admin_notes = ? WHERE id = ?',
            [status, adminNotes, reportId]
        );
    }

    // Legacy methods for backward compatibility
    static async create(whisperId, reporterWalletAddress, reason, additionalDetails = null) {
        return this.createByTokenId(whisperId, reporterWalletAddress, reason, additionalDetails);
    }

    static async getByWhisper(whisperId) {
        return this.getByTokenId(whisperId);
    }

    static async hasUserReported(whisperId, walletAddress) {
        return this.hasUserReportedByTokenId(whisperId, walletAddress);
    }
}

// Favorites model
class Favorite {
    static async toggleByTokenId(tokenId, userWalletAddress) {
        try {
            // Find or create user
            const user = await User.findOrCreateByWallet(userWalletAddress);
            
            // Check if favorite already exists
            const existing = await getOne(
                'SELECT * FROM favorites WHERE token_id = ? AND user_wallet_address = ?',
                [tokenId, userWalletAddress]
            );

            if (existing) {
                // Toggle the favorite status
                const newStatus = !existing.is_favorited;
                await updateOne(
                    'UPDATE favorites SET is_favorited = ? WHERE id = ?',
                    [newStatus, existing.id]
                );
                
                // Update global statistics
                const statChange = newStatus ? 1 : -1;
                await executeQuery(
                    'UPDATE app_statistics SET stat_value = stat_value + ? WHERE stat_name = "total_favorites_given"',
                    [statChange]
                );
                
                return { favorited: newStatus, action: newStatus ? 'added' : 'removed' };
            } else {
                // Create new favorite
                await insertOne(
                    `INSERT INTO favorites 
                     (whisper_id, token_id, user_id, user_wallet_address, is_favorited) 
                     VALUES (NULL, ?, ?, ?, TRUE)`,
                    [tokenId, user.id, userWalletAddress]
                );
                
                // Update global statistics
                await executeQuery(
                    'UPDATE app_statistics SET stat_value = stat_value + 1 WHERE stat_name = "total_favorites_given"'
                );
                
                return { favorited: true, action: 'added' };
            }
        } catch (error) {
            console.error('Error toggling favorite:', error);
            throw error;
        }
    }

    static async getByUser(userWalletAddress, limit = 20) {
        return await getMany(
            `SELECT * FROM favorites 
             WHERE user_wallet_address = ? AND is_favorited = TRUE
             ORDER BY created_at DESC LIMIT ?`,
            [userWalletAddress, limit]
        );
    }

    static async isUserFavoriteByTokenId(tokenId, userWalletAddress) {
        const favorite = await getOne(
            'SELECT is_favorited FROM favorites WHERE token_id = ? AND user_wallet_address = ?',
            [tokenId, userWalletAddress]
        );
        return favorite ? favorite.is_favorited : false;
    }

    // Legacy methods for backward compatibility
    static async toggle(whisperId, userWalletAddress) {
        return this.toggleByTokenId(whisperId, userWalletAddress);
    }

    static async isUserFavorite(whisperId, userWalletAddress) {
        return this.isUserFavoriteByTokenId(whisperId, userWalletAddress);
    }
}

// Statistics model
class Statistics {
    static async getAll() {
        const stats = await getMany('SELECT * FROM app_statistics');
        const result = {};
        stats.forEach(stat => {
            result[stat.stat_name] = stat.stat_value;
        });
        return result;
    }

    static async getTotalTokensConsumed() {
        const result = await getOne(
            'SELECT stat_value FROM app_statistics WHERE stat_name = "total_ai_tokens_consumed"'
        );
        return result ? result.stat_value : 0;
    }
}

module.exports = {
    User,
    AIOperation,
    Whisper,
    Report,
    Favorite,
    Statistics
};