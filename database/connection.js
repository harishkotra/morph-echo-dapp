const mysql = require('mysql2/promise');

// Connection status tracking
let isConnected = false;
let lastConnectionTest = 0;
const CONNECTION_TEST_INTERVAL = 300000; // 5 minutes

// Create connection pool for better performance
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
    waitForConnections: true,
    queueLimit: 0
});

// Test connection function (only called once at startup or when needed)
async function testConnection(force = false) {
    const now = Date.now();
    
    // Return cached status if recent test was successful and not forced
    if (!force && isConnected && (now - lastConnectionTest) < CONNECTION_TEST_INTERVAL) {
        return true;
    }
    
    try {
        console.log('🔌 Testing MySQL connection...');
        const connection = await pool.getConnection();
        connection.release();
        
        isConnected = true;
        lastConnectionTest = now;
        console.log('✅ MySQL database connected successfully');
        return true;
    } catch (error) {
        isConnected = false;
        console.error('❌ MySQL connection failed:', error.message);
        
        if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('   💡 Check your database username and password');
        } else if (error.code === 'ENOTFOUND') {
            console.error('   💡 Check your database host address');
        } else if (error.code === 'ECONNREFUSED') {
            console.error('   💡 Check if the database server is running and the port is correct');
        }
        
        return false;
    }
}

// Check if database is available (without creating new connections)
function isDatabaseAvailable() {
    return isConnected;
}

// Helper function to execute queries
async function executeQuery(query, params = []) {
    try {
        const [results] = await pool.execute(query, params);
        return results;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

// Helper function to get a single row
async function getOne(query, params = []) {
    const results = await executeQuery(query, params);
    return results.length > 0 ? results[0] : null;
}

// Helper function to get multiple rows
async function getMany(query, params = []) {
    return await executeQuery(query, params);
}

// Helper function to insert and return the inserted ID
async function insertOne(query, params = []) {
    const result = await executeQuery(query, params);
    return result.insertId;
}

// Helper function to update and return affected rows
async function updateOne(query, params = []) {
    const result = await executeQuery(query, params);
    return result.affectedRows;
}

// Close pool (for graceful shutdown)
async function closePool() {
    await pool.end();
    console.log('MySQL connection pool closed');
}

module.exports = {
    pool,
    testConnection,
    isDatabaseAvailable,
    executeQuery,
    getOne,
    getMany,
    insertOne,
    updateOne,
    closePool
};