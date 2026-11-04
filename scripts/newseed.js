// npm run newseed
// Makes a brand-new 24-word recovery phrase for Kohler's deposit wallet and shows the first
// addresses it will use. Run it on your own computer, ideally with the internet switched off.
// Write the words on paper and keep them somewhere safe; they control every deposit.
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';

const testnet = process.argv.includes('--testnet');
const NET = testnet ? btc.TEST_NETWORK : btc.NETWORK, coin = testnet ? 1 : 0;
const phrase = generateMnemonic(wordlist, 256);
const root = HDKey.fromMasterSeed(mnemonicToSeedSync(phrase));
const addr = (path) => btc.p2wpkh(root.derive(path).publicKey, NET).address;

console.log(`\nNew ${testnet ? 'TESTNET' : 'MAINNET'} recovery phrase (24 words):\n\n  ${phrase}\n`);
console.log('Put it in your environment variables as:');
console.log(`  DEPOSIT_MNEMONIC=${phrase}\n`);
console.log('With it, Kohler will use:');
console.log(`  first player deposit address  ${addr(`m/84'/${coin}'/0'/0/0`)}`);
console.log(`  hot wallet (pays withdrawals) ${addr(`m/84'/${coin}'/1'/0/0`)}\n`);
console.log('Never share these words, never paste them into a chat, and never reuse a personal wallet\'s words.\n');
