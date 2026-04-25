const { ethers } = require('ethers');
const logger = require('../utils/logger');

class EthereumSweeper {
    constructor(walletManager) {
        this.walletManager = walletManager;
        this.hdWallet = walletManager;
        
        // Get derived ETH wallet
        const ethWallet = this.hdWallet.getEthereumKeyPair(0);
        this.sourceWallet = ethWallet.wallet;
        this.sourceAddress = ethWallet.address;
        
        this.destinationAddress = process.env.DESTINATION_ADDRESS;
        this.rpcUrl = process.env.ETH_RPC_URL;
        this.threshold = parseFloat(process.env.ETH_THRESHOLD || '0.01');
        this.gasLimit = parseInt(process.env.GAS_LIMIT || '21000');
        this.gasPriceBuffer = parseFloat(process.env.GAS_PRICE_BUFFER || '1.2');
        this.interval = parseInt(process.env.CHECK_INTERVAL || '15000');
        
        this.provider = null;
        this.isRunning = false;
        this.timer = null;
        
        // For monitoring multiple addresses
        this.watchAddresses = [this.sourceAddress];
        if (process.env.MONITOR_MULTIPLE_ADDRESSES === 'true') {
            const addresses = this.hdWallet.getWatchAddresses(0, parseInt(process.env.ADDRESS_COUNT || '5'));
            this.watchAddresses = addresses.ethereum;
        }
    }
    
    async initialize() {
        try {
            this.provider = new ethers.providers.JsonRpcProvider(this.rpcUrl);
            // Connect wallet to provider
            this.sourceWallet = this.sourceWallet.connect(this.provider);
            
            const balance = await this.provider.getBalance(this.sourceWallet.address);
            logger.info(`🔐 ETH wallet derived from seed phrase`);
            logger.info(`📤 Source address: ${this.sourceAddress}`);
            logger.info(`💰 Wallet balance: ${ethers.utils.formatEther(balance)} ETH`);
            logger.info(`📥 Destination: ${this.destinationAddress}`);
            logger.info(`💰 Threshold: ${this.threshold} ETH`);
            
            if (this.watchAddresses.length > 1) {
                logger.info(`👀 Monitoring ${this.watchAddresses.length} ETH addresses`);
            }
            
            return true;
        } catch (error) {
            logger.error(`ETH initialization failed: ${error.message}`);
            throw error;
        }
    }
    
    async getBalance(address) {
        try {
            const balance = await this.provider.getBalance(address);
            return parseFloat(ethers.utils.formatEther(balance));
        } catch (error) {
            logger.error(`Failed to get ETH balance for ${address}: ${error.message}`);
            return 0;
        }
    }
    
    async getTotalBalance() {
        let total = 0;
        for (const address of this.watchAddresses) {
            total += await this.getBalance(address);
        }
        return total;
    }
    
    async getGasPrice() {
        const feeData = await this.provider.getFeeData();
        const basePrice = feeData.gasPrice;
        const adjustedPrice = Math.floor(basePrice * this.gasPriceBuffer);
        return adjustedPrice;
    }
    
    async sweep() {
        try {
            let totalBalance = 0;
            const balances = {};
            
            // Check all watched addresses
            for (const address of this.watchAddresses) {
                const balance = await this.getBalance(address);
                balances[address] = balance;
                totalBalance += balance;
            }
            
            if (totalBalance < this.threshold) {
                logger.debug(`ETH total balance below threshold: ${totalBalance} ETH`);
                return;
            }
            
            logger.info(`💰 ETH sweep triggered! Total balance: ${totalBalance} ETH across ${this.watchAddresses.length} addresses`);
            
            // For simplicity, sweep from main address first
            // In production, you'd want to sweep from all addresses
            if (balances[this.sourceAddress] > 0) {
                const gasPrice = await this.getGasPrice();
                const gasCost = gasPrice * this.gasLimit;
                const gasCostEth = parseFloat(ethers.utils.formatEther(gasCost.toString()));
                
                const amountToSend = balances[this.sourceAddress] - gasCostEth;
                
                if (amountToSend > 0) {
                    const tx = {
                        to: this.destinationAddress,
                        value: ethers.utils.parseEther(amountToSend.toString()),
                        gasLimit: this.gasLimit,
                        gasPrice: gasPrice,
                    };
                    
                    const signedTx = await this.sourceWallet.sendTransaction(tx);
                    logger.info(`✅ ETH transaction sent: ${signedTx.hash}`);
                    
                    const receipt = await signedTx.wait(1);
                    logger.info(`✅ ETH sweep confirmed in block: ${receipt.blockNumber}`);
                }
            }
            
        } catch (error) {
            logger.error(`ETH sweep failed: ${error.message}`);
        }
    }
    
    async start() {
        this.isRunning = true;
        logger.info(`🔍 Monitoring ETH addresses`);
        
        await this.sweep();
        this.timer = setInterval(() => this.sweep(), this.interval);
    }
    
    stop() {
        this.isRunning = false;
        if (this.timer) {
            clearInterval(this.timer);
        }
        logger.info('ETH sweeper stopped');
    }
}

module.exports = EthereumSweeper;
