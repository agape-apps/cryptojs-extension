const CryptoJS = require('crypto-js');
require('../build_node/siv.js');

console.log(
  '\n*** Deterministic Authenticated Encryption/Decryption Demo ***\n'
);

// Create a 512Bit key from passphrase (for both encryption and decryption)
//const salt = CryptoJS.lib.WordArray.random(128 / 8);
const salt = CryptoJS.enc.Hex.parse('abc742c009775a61ffc4c55b87481818');
const key = CryptoJS.PBKDF2('Secret User Passphrase', salt, {
  keySize: 512 / 32,
  iterations: 1000,
});
console.log('* KEY: ' + key);

const siv = CryptoJS.SIV.create(key);

// Plaintext in UTF8
const plaintext = 'Do not let your hearts be troubled. Trust in Jesus!';
const pt = CryptoJS.enc.Utf8.parse(plaintext);

// AES-SIV encryption (store the Cyphertext as Base64)
const cyphertext = siv.encrypt(pt);
const cyphertextBase64 = CryptoJS.enc.Base64.stringify(cyphertext);
console.log('* ENCRYPTED: ' + cyphertextBase64);

// AES-SIV decryption
const ct = CryptoJS.enc.Base64.parse(cyphertextBase64);
const decrypted = siv.decrypt(ct);
const decryptedPT = CryptoJS.enc.Utf8.stringify(decrypted);
console.log('* DECRYPTED: ' + decryptedPT);
