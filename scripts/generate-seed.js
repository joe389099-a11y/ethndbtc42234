const bip39 = require('bip39');

// Generate a new 12-word seed phrase
const mnemonic = bip39.generateMnemonic(128); // 128 bits = 12 words
console.log('Generated Seed Phrase (12 words):');
console.log(mnemonic);
console.log('\n⚠️ SAVE THIS SECURELY - DO NOT SHARE');
console.log('Add to Railway as MASTER_SEED_PHRASE');

// Validate
console.log('\nValidation:', bip39.validateMnemonic(mnemonic) ? '✅ Valid' : '❌ Invalid');
