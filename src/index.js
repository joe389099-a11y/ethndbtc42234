require('dotenv').config();
const logger = require('./utils/logger');
const HDWalletManager = require('./wallet/manager');
const BitcoinSweeper = require('./bitcoin');
const EthereumSweeper = require('./ethereum');

class MultiChainSweeper {
    constructor() {
        this.sweepers = [];
        this.isRunning = false;
        this.walletManager = null;
    }
    
    async initialize() {
        // Get seed phrase from environment variable
        const seedPhrase = process.env.MASTER_SEED_PHRASE;
        
        if (!seedPhrase) {
            throw new Error('MASTER_SEED_PHRASE not set in environment variables');
        }
        
        // Initialize HD wallet manager with seed phrase
        const network = process.env.BTC_NETWORK || 'mainnet';
        this.walletManager = new HDWalletManager(seedPhrase, network);
        
        // Log derived addresses for verification
        const wallets = this.walletManager.getWallets(0);
        logger.info('=========================================');
        logger.info('🔑 WALLETS DERIVED FROM SEED PHRASE');
        logger.info('=========================================');
        logger.info(`BTC Address: ${wallets.bitcoin.address}`);
        logger.info(`BTC Path: ${this.walletManager.derivedPath.btc}`);
        logger.info(`ETH Address: ${wallets.ethereum.address}`);
        logger.info(`ETH Path: ${this.walletManager.derivedPath.eth}`);
        logger.info('=========================================');
        
        // Optional: Verify destination doesn't match source
        if (process.env.DESTINATION_ADDRESS === wallets.bitcoin.address ||
            process.env.DESTINATION_ADDRESS === wallets.ethereum.address) {
            logger.warn('⚠️ DESTINATION_ADDRESS matches source wallet! Funds would be sent to yourself.');
        }
        
        return true;
    }
    
    async start() {
        if (this.isRunning) {
            logger.warn('Sweeper already running');
            return;
        }
        
        await this.initialize();
        
        logger.info('🚀 Starting Multi-Chain Sweeper (Seed Phrase Mode)');
        logger.info(`Sweeping to: ${process.env.DESTINATION_ADDRESS}`);
        
        // Initialize Bitcoin sweeper
        if (process.env.ENABLE_BITCOIN === 'true') {
            const btcSweeper = new BitcoinSweeper(this.walletManager);
            btcSweeper.initialize();
            this.sweepers.push(btcSweeper);
            logger.info('✅ Bitcoin sweeper initialized');
        }
        
        // Initialize Ethereum sweeper
        if (process.env.ENABLE_ETHEREUM === 'true') {
            const ethSweeper = new EthereumSweeper(this.walletManager);
            await ethSweeper.initialize();
            this.sweepers.push(ethSweeper);
            logger.info('✅ Ethereum sweeper initialized');
        }
        
        if (this.sweepers.length === 0) {
            logger.error('No sweepers enabled. Set ENABLE_BITCOIN=true or ENABLE_ETHEREUM=true');
            return;
        }
        
        this.isRunning = true;
        
        // Start monitoring all sweepers
        await Promise.all(this.sweepers.map(s => s.start()));
        
        // Handle graceful shutdown
        process.on('SIGINT', () => this.stop());
        process.on('SIGTERM', () => this.stop());
    }
    
    async stop() {
        logger.info('🛑 Shutting down sweepers...');
        this.isRunning = false;
        await Promise.all(this.sweepers.map(s => s.stop()));
        process.exit(0);
    }
}

// Start the application
const sweeper = new MultiChainSweeper();
sweeper.start().catch(err => {
    logger.error(`Fatal error: ${err.message}`);
    process.exit(1);
});
