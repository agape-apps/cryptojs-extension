const CryptoJS = require('crypto-js');
require('../build_node/siv.js');

const ad1 = '00';
const ad2 = '11';
const adBytes1 = CryptoJS.enc.Hex.parse(ad1);
const adBytes2 = CryptoJS.enc.Hex.parse(ad2);

console.log('\n*** Nonce-Based Authenticated Encryption/Decryption Demo ***\n');

// Create a 512Bit key from passphrase (for both encryption and decryption)
//const salt = CryptoJS.lib.WordArray.random(128 / 8);
const salt = CryptoJS.enc.Hex.parse('abc742c009775a61ffc4c55b87481818');
const key = CryptoJS.PBKDF2('Secret User Passphrase', salt, {
  keySize: 512 / 32,
  iterations: 1000,
});
console.log('* KEY: ' + key);
const siv = CryptoJS.SIV.create(key);

// Create a unique nonce. Store prepended to the cyphertext.
const nonce = CryptoJS.lib.WordArray.random(128 / 8);
const nonceBase64 = CryptoJS.enc.Base64.stringify(nonce);
console.log('* NONCE: ' + nonceBase64);
console.log('* -----: 123456789012345678901234');

// Plaintext in UTF8
const plaintext = 'Do not let your hearts be troubled. Trust in Jesus!';
const pt = CryptoJS.enc.Utf8.parse(plaintext);

// AES-SIV encryption (store the Cyphertext as Base64)
const cyphertext = siv.encrypt([adBytes1, adBytes2, nonce], pt);
const cyphertextBase64 = CryptoJS.enc.Base64.stringify(cyphertext);
console.log('* ENCRYPTED: ' + cyphertextBase64);

// AES-SIV decryption
const ct = CryptoJS.enc.Base64.parse(cyphertextBase64);
const decrypted = siv.decrypt([adBytes1, adBytes2, nonce], ct);
const decryptedPT = CryptoJS.enc.Utf8.stringify(decrypted);
console.log('* DECRYPTED: ' + decryptedPT);
