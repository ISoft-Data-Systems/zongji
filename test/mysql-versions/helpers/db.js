//import mysql from '@vlasky/mysql'

export const createSimpleTestTable = async (connection) => {
    // Create the table
    await connection.query(`
        CREATE TABLE test_table (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
};

// Creates a table and writes number of rows for basic binlog event testing
export const createSimpleTestRows = async (connection) => {
    // Insert test data
    const insertValues = [];
    for (let i = 1; i <= 250; i++) {
        insertValues.push(`('Test ${i}')`);
    }
    const insertQuery = `
        INSERT INTO test_table (name) VALUES
        ${insertValues.join(', ')}
    `;
    await connection.query(insertQuery);
};