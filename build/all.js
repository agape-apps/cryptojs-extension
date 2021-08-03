;(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    // AMD
    define(["crypto-js/core"], factory);
  }
  else {
    // Global (browser)
    factory(root.CryptoJS);
  }
}(this, function (C) {

  /*
   * The MIT License (MIT)
   *
   * Copyright (c) 2015 artjomb
   */
  // Shortcuts
  var Base = C.lib.Base;
  var WordArray = C.lib.WordArray;
  var AES = C.algo.AES;
  var ext = C.ext;
  var OneZeroPadding = C.pad.OneZeroPadding;
  var CMAC = C.algo.CMAC;

  /**
   * updateAAD must be used before update, because the additional data is
   * expected to be authenticated before the plaintext stream starts.
   */
  var S2V = C.algo.S2V = Base.extend({
      init: function(key){
          this._blockSize = 16;
          this._cmacAD = CMAC.create(key);
          this._cmacPT = CMAC.create(key);
          this.reset();
      },
      reset: function(){
          this._buffer = new WordArray.init();
          this._cmacAD.reset();
          this._cmacPT.reset();
          this._d = this._cmacAD.finalize(ext.const_Zero);
          this._empty = true;
          this._ptStarted = false;
      },
      updateAAD: function(msgUpdate){
          if (this._ptStarted) {
              // It's not possible to authenticate any more additional data when the plaintext stream starts
              return this;
          }

          if (!msgUpdate) {
              return this;
          }

          if (typeof msgUpdate === "string") {
              msgUpdate = C.enc.Utf8.parse(msgUpdate);
          }

          this._d = ext.xor(ext.dbl(this._d), this._cmacAD.finalize(msgUpdate));
          this._empty = false;

          // Chainable
          return this;
      },
      update: function(msgUpdate){
          if (!msgUpdate) {
              return this;
          }

          this._ptStarted = true;
          var buffer = this._buffer;
          var bsize = this._blockSize;
          var wsize = bsize / 4;
          var cmac = this._cmacPT;
          if (typeof msgUpdate === "string") {
              msgUpdate = C.enc.Utf8.parse(msgUpdate);
          }

          buffer.concat(msgUpdate);

          while(buffer.sigBytes >= 2 * bsize){
              this._empty = false;
              var s_i = ext.popWords(buffer, wsize);
              cmac.update(s_i);
          }

          // Chainable
          return this;
      },
      finalize: function(msgUpdate){
          this.update(msgUpdate);

          var bsize = this._blockSize;
          var s_n = this._buffer;

          if (this._empty && s_n.sigBytes === 0) {
              return this._cmacAD.finalize(ext.const_One);
          }

          var t;
          if (s_n.sigBytes >= bsize) {
              t = ext.xorendBytes(s_n, this._d);
          } else {
              OneZeroPadding.pad(s_n, bsize);
              t = ext.xor(ext.dbl(this._d), s_n);
          }

          return this._cmacPT.finalize(t);
      }
  });

  var SIV = C.SIV = Base.extend({
      init: function(key){
          var len = key.sigBytes / 2;
          this._s2vKey = ext.shiftBytes(key, len);
          this._ctrKey = key;
      },
      encrypt: function(adArray, plaintext){
          if (!plaintext && adArray) {
              plaintext = adArray;
              adArray = [];
          }

          var s2v = S2V.create(this._s2vKey);
          Array.prototype.forEach.call(adArray, function(ad){
              s2v.updateAAD(ad);
          });
          var tag = s2v.finalize(plaintext);
          var filteredTag = ext.bitand(tag, ext.const_nonMSB);

          var ciphertext = C.AES.encrypt(plaintext, this._ctrKey, {
              iv: filteredTag,
              mode: C.mode.CTR,
              padding: C.pad.NoPadding
          });

          return tag.concat(ciphertext.ciphertext);
      },
      decrypt: function(adArray, ciphertext){
          if (!ciphertext && adArray) {
              ciphertext = adArray;
              adArray = [];
          }

          var tag = ext.shiftBytes(ciphertext, 16);
          var filteredTag = ext.bitand(tag, ext.const_nonMSB);

          var plaintext = C.AES.decrypt({ciphertext:ciphertext}, this._ctrKey, {
              iv: filteredTag,
              mode: C.mode.CTR,
              padding: C.pad.NoPadding
          });

          var s2v = S2V.create(this._s2vKey);
          Array.prototype.forEach.call(adArray, function(ad){
              s2v.updateAAD(ad);
          });
          var recoveredTag = s2v.finalize(plaintext);

          if (ext.equals(tag, recoveredTag)) {
              return plaintext;
          } else {
              return false;
          }
      }
  });


  /*
   * The MIT License (MIT)
   *
   * Copyright (c) 2015 artjomb
   */
  var WordArray = C.lib.WordArray;
  var crypto = window.crypto;
  var TypedArray = Int32Array;
  if (TypedArray && crypto && crypto.getRandomValues) {
      WordArray.random = function(nBytes){
          var array = new TypedArray(Math.ceil(nBytes / 4));
          crypto.getRandomValues(array);
          return new WordArray.init(
                  [].map.call(array, function(word){
                      return word
                  }),
                  nBytes
          );
      };
  } else {
      console.log("No cryptographically secure randomness source available");
  }


  /*
   * The MIT License (MIT)
   *
   * Copyright (c) 2015 artjomb
   */

  /**
   * Cipher Feedback block mode with segment size parameter according to
   * http://csrc.nist.gov/publications/nistpubs/800-38a/sp800-38a.pdf.
   * The segment size must be a multiple of 32 bit (word size) and not bigger
   * than the block size of the underlying block cipher.
   *
   * Use CryptoJS.mode.CFBb if you want segments as small as 1 bit.
   */

  var CFBw = C.lib.BlockCipherMode.extend();

  CFBw.Encryptor = CFBw.extend({
      processBlock: function(words, offset){
          processBlock.call(this, words, offset, true);
      }
  });

  CFBw.Decryptor = CFBw.extend({
      processBlock: function(words, offset){
          processBlock.call(this, words, offset, false);
      }
  });

  function processBlock(words, offset, encryptor) {
      // Shortcuts
      var self = this;
      var cipher = self._cipher;
      var blockSize = cipher.blockSize; // in words
      var prev = self._prevBlock;
      var segmentSize = cipher.cfg.segmentSize / 32; // in words

      // somehow the wrong indexes are used
      for(var i = 0; i < blockSize/segmentSize; i++) {
          if (!prev) {
              prev = self._iv.slice(0); // clone

              // Remove IV for subsequent blocks
              self._iv = undefined;
          } else {
              prev = prev.slice(segmentSize).concat(self._ct);
          }

          if (!encryptor) {
              self._ct = words.slice(offset + i * segmentSize, offset + i * segmentSize + segmentSize);
          }

          var segKey = prev.slice(0); // clone
          cipher.encryptBlock(segKey, 0);

          // Encrypt segment
          for (var j = 0; j < segmentSize; j++) {
              words[offset + i * segmentSize + j] ^= segKey[j];
          }

          if (encryptor) {
              self._ct = words.slice(offset + i * segmentSize, offset + i * segmentSize + segmentSize);
          }
      }
      self._prevBlock = prev;
  }

  C.mode.CFBw = CFBw;


  /*
   * The MIT License (MIT)
   *
   * Copyright (c) 2015 artjomb
   */
  C.enc.Bin = {
      stringify: function (wordArray) {
          // Shortcuts
          var words = wordArray.words;
          var sigBytes = wordArray.sigBytes;

          // Convert
          var binChars = [];
          for (var i = 0; i < sigBytes; i++) {
              var bite = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;

              for(var j = 7; j >= 0; j--) {
                  binChars.push((bite >>> j & 0x01).toString(2));
              }
          }

          return binChars.join('');
      },
      parse: function (binStr) {
          var words = [ 0 ];
          var currentBit = 31;
          var bits = 0;
          for(var i = 0; i < binStr.length; i++) {
              var c = binStr[i];
              if (c !== "0" && c !== "1") {
                  // skip non-encoding characters such as spaces and such
                  continue;
              }
              words[words.length-1] += (parseInt(c) << currentBit);
              currentBit--;
              bits++;
              if (currentBit < 0) {
                  currentBit = 31;
                  words.push(0);
              }
          }
          return new C.lib.WordArray.init(words, Math.ceil(bits/8));
      }
  };


  /*
   * The MIT License (MIT)
   *
   * Copyright (c) 2015 artjomb
   */
  // put on ext property in CryptoJS
  var ext;
  if (!C.hasOwnProperty("ext")) {
      ext = C.ext = {};
  } else {
      ext = C.ext;
  }

  /**
   * Shifts the array by n bits to the left. Zero bits are added as the
   * least significant bits. This operation modifies the current array.
   *
   * @param {WordArray} wordArray WordArray to work on
   * @param {int} n Bits to shift by
   *
   * @returns the WordArray that was passed in
   */
  ext.bitshift = function(wordArray, n){
      var carry = 0,
          words = wordArray.words,
          wres,
          skipped = 0,
          carryMask;
      if (n > 0) {
          while(n > 31) {
              // delete first element:
              words.splice(0, 1);

              // add `0` word to the back
              words.push(0);

              n -= 32;
              skipped++;
          }
          if (n == 0) {
              // 1. nothing to shift if the shift amount is on a word boundary
              // 2. This has to be done, because the following algorithm computes
              // wrong values only for n==0
              return carry;
          }
          for(var i = words.length - skipped - 1; i >= 0; i--) {
              wres = words[i];
              words[i] <<= n;
              words[i] |= carry;
              carry = wres >>> (32 - n);
          }
      } else if (n < 0) {
          while(n < -31) {
              // insert `0` word to the front:
              words.splice(0, 0, 0);

              // remove last element:
              words.length--;

              n += 32;
              skipped++;
          }
          if (n == 0) {
              // nothing to shift if the shift amount is on a word boundary
              return carry;
          }
          n = -n;
          carryMask = (1 << n) - 1;
          for(var i = skipped; i < words.length; i++) {
              wres = words[i] & carryMask;
              words[i] >>>= n;
              words[i] |= carry;
              carry = wres << (32 - n);
          }
      }
      return carry;
  };

  /**
   * Negates all bits in the WordArray. This manipulates the given array.
   *
   * @param {WordArray} wordArray WordArray to work on
   *
   * @returns the WordArray that was passed in
   */
  ext.neg = function(wordArray){
      var words = wordArray.words;
      for(var i = 0; i < words.length; i++) {
          words[i] = ~words[i];
      }
      return wordArray;
  };

  /**
   * Applies XOR on both given word arrays and returns a third resulting
   * WordArray. The initial word arrays must have the same length
   * (significant bytes).
   *
   * @param {WordArray} wordArray1 WordArray
   * @param {WordArray} wordArray2 WordArray
   *
   * @returns first passed WordArray (modified)
   */
  ext.xor = function(wordArray1, wordArray2){
      for(var i = 0; i < wordArray1.words.length; i++) {
          wordArray1.words[i] ^= wordArray2.words[i];
      }
      return wordArray1;
  };

  /**
   * Logical AND between the two passed arrays. Both arrays must have the
   * same length.
   *
   * @param {WordArray} arr1 Array 1
   * @param {WordArray} arr2 Array 2
   *
   * @returns new WordArray
   */
  ext.bitand = function(arr1, arr2){
      var newArr = arr1.clone(),
          tw = newArr.words,
          ow = arr2.words;
      for(var i = 0; i < tw.length; i++) {
          tw[i] &= ow[i];
      }
      return newArr;
  };


  /*
   * The MIT License (MIT)
   *
   * Copyright (c) 2015 artjomb
   */

  /**
   * Cipher Feedback block mode with segment size parameter according to
   * http://csrc.nist.gov/publications/nistpubs/800-38a/sp800-38a.pdf.
   * The segment size can be anything from 1 bit up to the block size of the
   * underlying block cipher.
   *
   * Current limitation: only segment sizes that divide the block size evenly
   * are supported.
   */
  var CFBb = C.lib.BlockCipherMode.extend(),
      WordArray = C.lib.WordArray, // shortcut
      bitshift = C.ext.bitshift,
      neg = C.ext.neg;

  CFBb.Encryptor = CFBb.extend({
      processBlock: function(words, offset){
          processBlock.call(this, words, offset, true);
      }
  });

  CFBb.Decryptor = CFBb.extend({
      processBlock: function(words, offset){
          processBlock.call(this, words, offset, false);
      }
  });

  function processBlock(words, offset, encryptor) {
      // Shortcuts
      var self = this;
      var cipher = self._cipher;
      var blockSize = cipher.blockSize * 32; // in bits
      var prev = self._prevBlock;
      var segmentSize = cipher.cfg.segmentSize; // in bits
      var i, j;
      var currentPosition;

      // Create a bit mask that has a comtinuous slice of bits set that is as big as the segment
      var fullSegmentMask = [];
      for(i = 31; i < segmentSize; i += 32) {
          fullSegmentMask.push(0xffffffff);
      }
      // `s` most signiicant bits are set:
      fullSegmentMask.push(((1 << segmentSize) - 1) << (32 - segmentSize));
      for(i = fullSegmentMask.length; i < words.length; i++) {
          fullSegmentMask.push(0);
      }

      fullSegmentMask = new WordArray.init(fullSegmentMask);

      // some helper variables
      var slidingSegmentMask = fullSegmentMask.clone(),
          slidingSegmentMaskShifted = slidingSegmentMask.clone(),
          slidingNegativeSegmentMask,
          prevCT;

      // shift the mask according to the current offset
      bitshift(slidingSegmentMaskShifted, -offset * 32);

      for(i = 0; i < blockSize/segmentSize; i++) {
          if (!prev) {
              prev = self._iv.slice(0); // clone

              // Remove IV for subsequent blocks
              self._iv = undefined;
          } else {
              // Prepare the iteration by concatenating the unencrypted part of the previous block and the previous ciphertext

              prev = new WordArray.init(prev);
              bitshift(prev, segmentSize);
              prev = prev.words;
              previousCiphertextSegment = self._ct;

              // fill previous ciphertext up to the block size
              while(previousCiphertextSegment.length < blockSize / 32) {
                  previousCiphertextSegment.push(0);
              }
              previousCiphertextSegment = new WordArray.init(previousCiphertextSegment);

              // move to the back
              bitshift(previousCiphertextSegment, -blockSize + segmentSize);

              // put together
              for (var j = 0; j < prev.length; j++) {
                  prev[j] |= previousCiphertextSegment.words[j];
              }
          }

          currentPosition = offset * 32 + i * segmentSize;

          // move segment in question to the front of the array
          var plaintextSlice = new WordArray.init(words.slice(0));
          bitshift(plaintextSlice, currentPosition);

          if (!encryptor) {
              self._ct = plaintextSlice.words.slice(0, Math.ceil(segmentSize / 32));
          }

          var segKey = prev.slice(0); // clone
          cipher.encryptBlock(segKey, 0);

          // Encrypt segment
          for (j = 0; j < Math.ceil(segmentSize / 32); j++) {
              plaintextSlice.words[j] ^= segKey[j];
          }

          // Filter only the current segment
          for (j = 0; j < plaintextSlice.words.length; j++) {
              plaintextSlice.words[j] &= fullSegmentMask.words[j];
          }

          if (encryptor) {
              self._ct = plaintextSlice.words.slice(0, Math.ceil(segmentSize / 32));
          }

          // remove the segment from the plaintext array
          slidingNegativeSegmentMask = neg(slidingSegmentMaskShifted.clone());
          for (j = 0; j < words.length; j++) {
              words[j] &= slidingNegativeSegmentMask.words[j];
          }

          // move filtered ciphertext segment to back to the correct place
          bitshift(plaintextSlice, -currentPosition);

          // add filtered ciphertext segment to the plaintext/ciphertext array
          for (j = 0; j < words.length; j++) {
              words[j] |= plaintextSlice.words[j];
          }

          // shift the segment mask further along
          bitshift(slidingSegmentMask, -segmentSize);
          bitshift(slidingSegmentMaskShifted, -segmentSize);
      }
      self._prevBlock = prev;
  }

  C.mode.CFBb = CFBb;


  /*
   * The MIT License (MIT)
   *
   * Copyright (c) 2015 artjomb
   */
  // put on ext property in CryptoJS
  var ext;
  if (!C.hasOwnProperty("ext")) {
      ext = C.ext = {};
  } else {
      ext = C.ext;
  }

  // Shortcuts
  var Base = C.lib.Base;
  var WordArray = C.lib.WordArray;

  // Constants
  ext.const_Zero = new WordArray.init([0x00000000, 0x00000000, 0x00000000, 0x00000000]);
  ext.const_One = new WordArray.init([0x00000000, 0x00000000, 0x00000000, 0x00000001]);
  ext.const_Rb = new WordArray.init([0x00000000, 0x00000000, 0x00000000, 0x00000087]); // 00..0010000111
  ext.const_Rb_Shifted = new WordArray.init([0x80000000, 0x00000000, 0x00000000, 0x00000043]); // 100..001000011
  ext.const_nonMSB = new WordArray.init([0xFFFFFFFF, 0xFFFFFFFF, 0x7FFFFFFF, 0x7FFFFFFF]); // 1^64 || 0^1 || 1^31 || 0^1 || 1^31

  /**
   * Looks into the object to see if it is a WordArray.
   *
   * @param obj Some object
   *
   * @returns {boolean}

   */
  ext.isWordArray = function(obj) {
      return obj && typeof obj.clamp === "function" && typeof obj.concat === "function" && typeof obj.words === "array";
  }

  /**
   * This padding is a 1 bit followed by as many 0 bits as needed to fill
   * up the block. This implementation doesn't work on bits directly,
   * but on bytes. Therefore the granularity is much bigger.
   */
  C.pad.OneZeroPadding = {
      pad: function (data, blocksize) {
          // Shortcut
          var blockSizeBytes = blocksize * 4;

          // Count padding bytes
          var nPaddingBytes = blockSizeBytes - data.sigBytes % blockSizeBytes;

          // Create padding
          var paddingWords = [];
          for (var i = 0; i < nPaddingBytes; i += 4) {
              var paddingWord = 0x00000000;
              if (i === 0) {
                  paddingWord = 0x80000000;
              }
              paddingWords.push(paddingWord);
          }
          var padding = new WordArray.init(paddingWords, nPaddingBytes);

          // Add padding
          data.concat(padding);
      },
      unpad: function () {
          // TODO: implement
      }
  };

  /**
   * No padding is applied. This is necessary for streaming cipher modes
   * like CTR.
   */
  C.pad.NoPadding = {
      pad: function () {},
      unpad: function () {}
  };

  /**
   * Returns the n leftmost bytes of the WordArray.
   *
   * @param {WordArray} wordArray WordArray to work on
   * @param {int} n Bytes to retrieve
   *
   * @returns new WordArray
   */
  ext.leftmostBytes = function(wordArray, n){
      var lmArray = wordArray.clone();
      lmArray.sigBytes = n;
      lmArray.clamp();
      return lmArray;
  };

  /**
   * Returns the n rightmost bytes of the WordArray.
   *
   * @param {WordArray} wordArray WordArray to work on
   * @param {int} n Bytes to retrieve (must be positive)
   *
   * @returns new WordArray
   */
  ext.rightmostBytes = function(wordArray, n){
      wordArray.clamp();
      var wordSize = 32;
      var rmArray = wordArray.clone();
      var bitsToShift = (rmArray.sigBytes - n) * 8;
      if (bitsToShift >= wordSize) {
          var popCount = Math.floor(bitsToShift/wordSize);
          bitsToShift -= popCount * wordSize;
          rmArray.words.splice(0, popCount);
          rmArray.sigBytes -= popCount * wordSize / 8;
      }
      if (bitsToShift > 0) {
          ext.bitshift(rmArray, bitsToShift);
          rmArray.sigBytes -= bitsToShift / 8;
      }
      return rmArray;
  };

  /**
   * Returns the n rightmost words of the WordArray. It assumes
   * that the current WordArray has at least n words.
   *
   * @param {WordArray} wordArray WordArray to work on
   * @param {int} n Words to retrieve (must be positive)
   *
   * @returns popped words as new WordArray
   */
  ext.popWords = function(wordArray, n){
      var left = wordArray.words.splice(0, n);
      wordArray.sigBytes -= n * 4;
      return new WordArray.init(left);
  };

  /**
   * Shifts the array to the left and returns the shifted dropped elements
   * as WordArray. The initial WordArray must contain at least n bytes and
   * they have to be significant.
   *
   * @param {WordArray} wordArray WordArray to work on (is modified)
   * @param {int} n Bytes to shift (must be positive, default 16)
   *
   * @returns new WordArray
   */
  ext.shiftBytes = function(wordArray, n){
      n = n || 16;
      var r = n % 4;
      n -= r;

      var shiftedArray = new WordArray.init();
      for(var i = 0; i < n; i += 4) {
          shiftedArray.words.push(wordArray.words.shift());
          wordArray.sigBytes -= 4;
          shiftedArray.sigBytes += 4;
      }
      if (r > 0) {
          shiftedArray.words.push(wordArray.words[0]);
          shiftedArray.sigBytes += r;

          ext.bitshift(wordArray, r * 8);
          wordArray.sigBytes -= r;
      }
      return shiftedArray;
  };

  /**
   * XORs arr2 to the end of arr1 array. This doesn't modify the current
   * array aside from clamping.
   *
   * @param {WordArray} arr1 Bigger array
   * @param {WordArray} arr2 Smaller array to be XORed to the end
   *
   * @returns new WordArray
   */
  ext.xorendBytes = function(arr1, arr2){
      // TODO: more efficient
      return ext.leftmostBytes(arr1, arr1.sigBytes-arr2.sigBytes)
              .concat(ext.xor(ext.rightmostBytes(arr1, arr2.sigBytes), arr2));
  };

  /**
   * Doubling operation on a 128-bit value. This operation modifies the
   * passed array.
   *
   * @param {WordArray} wordArray WordArray to work on
   *
   * @returns passed WordArray
   */
  ext.dbl = function(wordArray){
      var carry = ext.msb(wordArray);
      ext.bitshift(wordArray, 1);
      ext.xor(wordArray, carry === 1 ? ext.const_Rb : ext.const_Zero);
      return wordArray;
  };

  /**
   * Inverse operation on a 128-bit value. This operation modifies the
   * passed array.
   *
   * @param {WordArray} wordArray WordArray to work on
   *
   * @returns passed WordArray
   */
  ext.inv = function(wordArray){
      var carry = wordArray.words[4] & 1;
      ext.bitshift(wordArray, -1);
      ext.xor(wordArray, carry === 1 ? ext.const_Rb_Shifted : ext.const_Zero);
      return wordArray;
  };

  /**
   * Check whether the word arrays are equal.
   *
   * @param {WordArray} arr1 Array 1
   * @param {WordArray} arr2 Array 2
   *
   * @returns boolean
   */
  ext.equals = function(arr1, arr2){
      if (!arr2 || !arr2.words || arr1.sigBytes !== arr2.sigBytes) {
          return false;
      }
      arr1.clamp();
      arr2.clamp();
      var equal = 0;
      for(var i = 0; i < arr1.words.length; i++) {
          equal |= arr1.words[i] ^ arr2.words[i];
      }
      return equal === 0;
  };

  /**
   * Retrieves the most significant bit of the WordArray as an Integer.
   *
   * @param {WordArray} arr
   *
   * @returns Integer
   */
  ext.msb = function(arr) {
      return arr.words[0] >>> 31;
  }


  /*
   * The MIT License (MIT)
   *
   * Copyright (c) 2015 artjomb
   */
  // Shortcuts
  var Base = C.lib.Base;
  var WordArray = C.lib.WordArray;
  var AES = C.algo.AES;
  var ext = C.ext;
  var OneZeroPadding = C.pad.OneZeroPadding;


  var CMAC = C.algo.CMAC = Base.extend({
      /**
       * Initializes a newly created CMAC
       *
       * @param {WordArray} key The secret key
       *
       * @example
       *
       *     var cmacer = CryptoJS.algo.CMAC.create(key);
       */
      init: function(key){
          // generate sub keys...
          this._aes = AES.createEncryptor(key, { iv: new WordArray.init(), padding: C.pad.NoPadding });

          // Step 1
          var L = this._aes.finalize(ext.const_Zero);

          // Step 2
          var K1 = L.clone();
          ext.dbl(K1);

          // Step 3
          if (!this._isTwo) {
              var K2 = K1.clone();
              ext.dbl(K2);
          } else {
              var K2 = L.clone();
              ext.inv(K2);
          }

          this._K1 = K1;
          this._K2 = K2;

          this._const_Bsize = 16;

          this.reset();
      },

      reset: function () {
          this._x = ext.const_Zero.clone();
          this._counter = 0;
          this._buffer = new WordArray.init();
      },

      update: function (messageUpdate) {
          if (!messageUpdate) {
              return this;
          }

          // Shortcuts
          var buffer = this._buffer;
          var bsize = this._const_Bsize;

          if (typeof messageUpdate === "string") {
              messageUpdate = C.enc.Utf8.parse(messageUpdate);
          }

          buffer.concat(messageUpdate);

          while(buffer.sigBytes > bsize){
              var M_i = ext.shiftBytes(buffer, bsize);
              ext.xor(this._x, M_i);
              this._x.clamp();
              this._aes.reset();
              this._x = this._aes.finalize(this._x);
              this._counter++;
          }

          // Chainable
          return this;
      },

      finalize: function (messageUpdate) {
          this.update(messageUpdate);

          // Shortcuts
          var buffer = this._buffer;
          var bsize = this._const_Bsize;

          var M_last = buffer.clone();
          if (buffer.sigBytes === bsize) {
              ext.xor(M_last, this._K1);
          } else {
              OneZeroPadding.pad(M_last, bsize/4);
              ext.xor(M_last, this._K2);
          }

          ext.xor(M_last, this._x);

          this.reset(); // Can be used immediately afterwards

          this._aes.reset();
          return this._aes.finalize(M_last);
      },

      _isTwo: false
  });

  /**
   * Directly invokes the CMAC and returns the calculated MAC.
   *
   * @param {WordArray} key The key to be used for CMAC
   * @param {WordArray|string} message The data to be MAC'ed (either WordArray or UTF-8 encoded string)
   *
   * @returns {WordArray} MAC
   */
  C.CMAC = function(key, message){
      return CMAC.create(key).finalize(message);
  };

  C.algo.OMAC1 = CMAC;
  C.algo.OMAC2 = CMAC.extend({
      _isTwo: true
  });


  /*
   * The MIT License (MIT)
   *
   * Copyright (c) 2015 artjomb
   */
  // Shortcuts
  var Base = C.lib.Base;
  var WordArray = C.lib.WordArray;
  var AES = C.algo.AES;
  var ext = C.ext;
  var CMAC = C.algo.CMAC;
  var zero = new WordArray.init([0x0, 0x0, 0x0, 0x0]);
  var one = new WordArray.init([0x0, 0x0, 0x0, 0x1]);
  var two = new WordArray.init([0x0, 0x0, 0x0, 0x2]);
  var blockLength = 16;

  var EAX = C.EAX = Base.extend({
      /**
       * Initializes the key of the cipher.
       *
       * @param {WordArray} key Key to be used for CMAC and CTR
       * @param {object} options Additonal options to tweak the encryption:
       *        splitKey - If true then the first half of the passed key will be
       *                   the CMAC key and the second half the CTR key
       *        tagLength - Length of the tag in bytes (for created tag and expected tag)
       */
      init: function(key, options){
          var macKey;
          if (options && options.splitKey) {
              var len = Math.floor(key.sigBytes / 2);
              macKey = ext.shiftBytes(key, len);
          } else {
              macKey = key.clone();
          }
          this._ctrKey = key;
          this._mac = CMAC.create(macKey);

          this._tagLen = (options && options.tagLength) || blockLength;
          this.reset();
      },
      reset: function(){
          this._mac.update(one);
          if (this._ctr) {
              this._ctr.reset();
          }
      },
      updateAAD: function(header){
          this._mac.update(header);
          return this;
      },
      initCrypt: function(isEncrypt, nonce){
          var self = this;
          self._tag = self._mac.finalize();
          self._isEnc = isEncrypt;

          self._mac.update(zero);
          nonce = self._mac.finalize(nonce);

          ext.xor(self._tag, nonce);

          self._ctr = AES.createEncryptor(self._ctrKey, {
              iv: nonce,
              mode: C.mode.CTR,
              padding: C.pad.NoPadding
          });
          self._buf = new WordArray.init();

          self._mac.update(two);

          return self;
      },
      update: function(msg) {
          if (typeof msg === "string") {
              msg = C.enc.Utf8.parse(msg);
          }
          var self = this;
          var buffer = self._buf;
          var isEncrypt = self._isEnc;
          buffer.concat(msg);

          var useBytes = isEncrypt ? buffer.sigBytes : Math.max(buffer.sigBytes - self._tagLen, 0);

          var data = useBytes > 0 ? ext.shiftBytes(buffer, useBytes) : new WordArray.init(); // guaranteed to be pure plaintext or ciphertext (without a tag during decryption)
          var xoredData = self._ctr.process(data);

          self._mac.update(isEncrypt ? xoredData : data);

          return xoredData;
      },
      finalize: function(msg){
          var self = this;
          var xoredData = msg ? self.update(msg) : new WordArray.init();
          var mac = self._mac;
          var ctFin = self._ctr.finalize();

          if (self._isEnc) {
              var ctTag = mac.finalize(ctFin);

              ext.xor(self._tag, ctTag);
              self.reset();
              return xoredData.concat(ctFin).concat(self._tag);
          } else {
              // buffer must contain only the tag at this point
              var ctTag = mac.finalize();

              ext.xor(self._tag, ctTag);
              self.reset();
              if (ext.equals(self._tag, self._buf)) {
                  return xoredData.concat(ctFin);
              } else {
                  return false; // tag doesn't match
              }
          }
      },
      encrypt: function(plaintext, nonce, adArray){
          var self = this;
          if (adArray) {
              Array.prototype.forEach.call(adArray, function(ad){
                  self.updateAAD(ad);
              });
          }
          self.initCrypt(true, nonce);

          return self.finalize(plaintext);
      },
      decrypt: function(ciphertext, nonce, adArray){
          var self = this;
          if (adArray) {
              Array.prototype.forEach.call(adArray, function(ad){
                  self.updateAAD(ad);
              });
          }
          self.initCrypt(false, nonce);

          return self.finalize(ciphertext);
      }
  });


}));