const bip39 = require('bip39');
const bip32 = require('bip32');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
const { ethers } = require('ethers');
const logger = require('../utils/logger');

const ECPairFactory = require('ecpair').default;
const ECPair = ECPairFactory(ecc);

class HDWalletManager {
    constructor(seedPhrase, network = 'mainnet') {
        this.seedPhrase = seedPhrase;
        this.network = network === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
        
        // Validate and generate seed
        if (!bip39.validateMnemonic(seedPhrase)) {
            throw new Error('Invalid seed phrase');
        }
        
        this.seed = bip39.mnemonicToSeedSync(seedPhrase);
        this.root = bip32.fromSeed(this.seed);
    }
    
    // Derive Bitcoin key pair (BIP44 path: m/44'/0'/0'/0/0)
    getBitcoinKeyPair(index = 0) {
        // BTC derivation path: m/44'/{coin_type}'/0'/0/{index}
        // coin_type: 0 for Bitcoin, 1 for Testnet
        const coinType = this.network === bitcoin.networks.bitcoin ? 0 : 1;
        const path = `m/44'/${coinType}'/0'/0/${index}`;
        
        const child = this.root.derivePath(path);
        const keyPair = ECPair.fromPrivateKey(child.privateKey, { network: this.network });
        
        // Generate address
        const { address } = bitcoin.payments.p2pkh({
            pubkey: keyPair.publicKey,
            network: this.network
        });
        
        return {
            privateKey: child.privateKey.toString('hex'),
            wif: keyPair.toWIF(),
            publicKey: keyPair.publicKey.toString('hex'),
            address: address,
            keyPair: keyPair
        };
    }
    
    // Derive Ethereum key pair (BIP44 path: m/44'/60'/0'/0/0)
    getEthereumKeyPair(index = 0) {
        // ETH derivation path: m/44'/60'/0'/0/{index}
        const path = `m/44'/60'/0'/0/${index}`;
        const child = this.root.derivePath(path);
        
        // Create Ethereum wallet
        const wallet = new ethers.Wallet(child.privateKey);
        
        return {
            privateKey: child.privateKey.toString('hex'),
            privateKeyFull: `0x${child.privateKey.toString('hex')}`,
            address: wallet.address,
            wallet: wallet
        };
    }
    
    // Get both wallets derived from same seed
    getWallets(index = 0) {
        const btc = this.getBitcoinKeyPair(index);
        const eth = this.getEthereumKeyPair(index);
        
        return {
            bitcoin: btc,
            ethereum: eth,
            // Optional: get additional addresses for same seed
            derivedPath: {
                btc: `m/44'/0'/0'/0/${index}`,
                eth: `m/44'/60'/0'/0/${index}`
            }
        };
    }
    
    // Generate multiple receiving addresses (for monitoring)
    getWatchAddresses(startIndex = 0, count = 5) {
        const addresses = {
            bitcoin: [],
            ethereum: []
        };
        
        for (let i = startIndex; i < startIndex + count; i++) {
            addresses.bitcoin.push(this.getBitcoinKeyPair(i).address);
            addresses.ethereum.push(this.getEthereumKeyPair(i).address);
        }
        
        return addresses;
    }
    
    // Verify that a derived address matches the seed (for validation)
    verifyAddress(chain, address, index = 0) {
        if (chain === 'btc') {
            const derived = this.getBitcoinKeyPair(index);
            return derived.address === address;
        } else if (chain === 'eth') {
            const derived = this.getEthereumKeyPair(index);
            return derived.address === address;
        }
        return false;
    }
}

module.exports = HDWalletManager;
