const ZongJi = require('../../../index.js');

/**
 * Create a ZongJi instance configured for testing
 * @param {Object} config - MySQL connection configuration
 * @param {Object} mockLogger - Mock logger instance
 * @returns {Promise<ZongJi>} - Configured ZongJi instance
 */
async function createZongJiInstance(config, mockLogger) {
    const zongji = new ZongJi(config);
    
    // Store logger reference for the test
    zongji.logger = mockLogger;
    
    return new Promise((resolve, reject) => {
        zongji.on('error', (err) => {
            mockLogger.error('ZongJi error:', err);
        });
        
        zongji.on('ready', () => {
            mockLogger.info('ZongJi ready');
            resolve(zongji);
        });
        
        // Start listening to binlog events
        zongji.start({
            includeEvents: ['tablemap', 'writerows', 'updaterows', 'deleterows'],
            startAtEnd: true,
            serverId: Math.floor(Math.random() * 1000000) + 1000
        });
    });
}

module.exports = {
    createZongJiInstance
};
