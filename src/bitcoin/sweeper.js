const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');
const logger = require('../utils/logger');

class BitcoinSweeper {
    constructor(walletManager) {
        this.walletManager = walletManager;
        this.hdWallet = walletManager;
        
        // Get the derived BTC wallet
        const btcWallet = this.hdWallet.getBitcoinKeyPair(0);
        this.sourceKeyPair = btcWallet.keyPair;
        this.sourceAddress = btcWallet.address;
        
        // Destination from env
        this.destinationAddress = process.env.DESTINATION_ADDRESS;
        this.rpcUrl = process.env.BTC_RPC_URL || 'https://blockstream.info/api';
        this.thresholdSat = (parseFloat(process.env.BTC_THRESHOLD || '0.0001') * 1e8);
        this.interval = parseInt(process.env.CHECK_INTERVAL || '30000');
        this.network = this.hdWallet.network;
        this.isRunning = false;
        this.timer = null;
        
        // For monitoring multiple addresses (optional)
        this.watchAddresses = [this.sourceAddress];
        if (process.env.MONITOR_MULTIPLE_ADDRESSES === 'true') {
            const addresses = this.hdWallet.getWatchAddresses(0, parseInt(process.env.ADDRESS_COUNT || '5'));
            this.watchAddresses = addresses.bitcoin;
        }
    }
    
    initialize() {
        logger.info(`🔐 BTC wallet derived from seed phrase`);
        logger.info(`📤 Source address: ${this.sourceAddress}`);
        logger.info(`📥 Destination: ${this.destinationAddress}`);
        logger.info(`💰 Threshold: ${this.thresholdSat / 1e8} BTC`);
        
        if (this.watchAddresses.length > 1) {
            logger.info(`👀 Monitoring ${this.watchAddresses.length} BTC addresses`);
        }
        
        return true;
    }
    
    async getAddressUtxos(address) {
        try {
            const response = await axios.get(
                `${this.rpcUrl}/address/${address}/utxo`
            );
            return response.data;
        } catch (error) {
            logger.error(`Failed to fetch UTXOs for ${address}: ${error.message}`);
            return [];
        }
    }
    
    async getAllUtxos() {
        let allUtxos = [];
        for (const address of this.watchAddresses) {
            const utxos = await this.getAddressUtxos(address);
            allUtxos = allUtxos.concat(utxos.map(utxo => ({ ...utxo, sourceAddress: address })));
        }
        return allUtxos;
    }
    
    async getTotalBalance() {
        const utxos = await this.getAllUtxos();
        const totalSat = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
        return totalSat / 1e8;
    }
    
    async createSweepTransaction(utxos) {
        const psbt = new bitcoin.Psbt({ network: this.network });
        let totalValue = 0;
        
        // Group UTXOs by address/script type for proper signing
        for (const utxo of utxos) {
            psbt.addInput({
                hash: utxo.txid,
                index: utxo.vout,
                witnessUtxo: {
                    script: Buffer.from(utxo.scriptpubkey, 'hex'),
                    value: utxo.value,
                },
            });
            totalValue += utxo.value;
        }
        
        // Estimate fee (simplified)
        const estimatedFee = Math.max(2000, Math.ceil(utxos.length * 180 * 1.5));
        const sendAmount = totalValue - estimatedFee;
        
        if (sendAmount <= 0) {
            throw new Error(`Insufficient funds after fee: ${sendAmount} sats`);
        }
        
        psbt.addOutput({
            address: this.destinationAddress,
            value: sendAmount,
        });
        
        // Sign with the source key (assuming all UTXOs belong to same key)
        // For multiple derived addresses, you'd need to track which key signs which UTXO
        for (let i = 0; i < utxos.length; i++) {
            psbt.signInput(i, this.sourceKeyPair);
            psbt.validateSignaturesOfInput(i);
            psbt.finalizeInput(i);
        }
        
        const tx = psbt.extractTransaction();
        return tx.toHex();
    }
    
    async broadcastTransaction(txHex) {
        try {
            const response = await axios.post(
                `${this.rpcUrl}/tx`,
                txHex,
                { headers: { 'Content-Type': 'text/plain' } }
            );
            logger.info(`✅ BTC transaction broadcast: ${response.data}`);
            return response.data;
        } catch (error) {
            logger.error(`Failed to broadcast BTC tx: ${error.message}`);
            throw error;
        }
    }
    
    async sweep() {
        try {
            const utxos = await this.getAllUtxos();
            
            if (utxos.length === 0) {
                return;
            }
            
            const totalValue = utxos.reduce((sum, u) => sum + u.value, 0);
            
            if (totalValue < this.thresholdSat) {
                logger.debug(`BTC balance below threshold: ${totalValue/1e8} BTC`);
                return;
            }
            
            logger.info(`💰 BTC sweep triggered! Balance: ${totalValue/1e8} BTC from ${utxos.length} UTXOs across ${this.watchAddresses.length} addresses`);
            
            const txHex = await this.createSweepTransaction(utxos);
            const txid = await this.broadcastTransaction(txHex);
            
            logger.info(`✅ BTC sweep complete! TXID: ${txid}`);
            
        } catch (error) {
            logger.error(`BTC sweep failed: ${error.message}`);
        }
    }
    
    async start() {
        this.isRunning = true;
        logger.info(`🔍 Monitoring BTC addresses`);
        
        await this.sweep();
        this.timer = setInterval(() => this.sweep(), this.interval);
    }
    
    stop() {
        this.isRunning = false;
        if (this.timer) {
            clearInterval(this.timer);
        }
        logger.info('BTC sweeper stopped');
    }
}

module.exports = BitcoinSweeper;
