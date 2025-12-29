/**
 * Mock logger to replace @isoftdata/aggregator-plugin-logger
 * Provides basic logging functionality without external dependencies
 */
class MockLogger {
    constructor(url, id, name) {
        this.url = url;
        this.id = id;
        this.name = name;
        this.logs = [];
    }

    info(...args) {
        const message = args.join(' ');
        this.logs.push({ level: 'info', message, timestamp: new Date() });
        console.log(`[INFO] [${this.name}]`, ...args);
    }

    error(...args) {
        const message = args.join(' ');
        this.logs.push({ level: 'error', message, timestamp: new Date() });
        console.error(`[ERROR] [${this.name}]`, ...args);
    }

    warn(...args) {
        const message = args.join(' ');
        this.logs.push({ level: 'warn', message, timestamp: new Date() });
        console.warn(`[WARN] [${this.name}]`, ...args);
    }

    debug(...args) {
        const message = args.join(' ');
        this.logs.push({ level: 'debug', message, timestamp: new Date() });
        console.log(`[DEBUG] [${this.name}]`, ...args);
    }

    getLogs() {
        return this.logs;
    }

    clearLogs() {
        this.logs = [];
    }
}

module.exports = { MockLogger };
