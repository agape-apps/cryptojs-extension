'use strict';

var _ = require('lodash');

var modules = {
  'enc-bin': [],
  'common-bit-ops': [],
  random: [],
  'mode-cfb-w': ['crypto-js/cipher-core'],
  common: ['common-bit-ops', 'crypto-js/cipher-core'],
  'mode-cfb-b': ['common-bit-ops', 'crypto-js/cipher-core'],
  cmac: ['common-bit-ops', 'common', 'crypto-js/aes'],
  siv: [
    'common-bit-ops',
    'common',
    'cmac',
    'crypto-js/aes',
    'crypto-js/mode-ctr',
  ],
  eax: [
    'common-bit-ops',
    'common',
    'cmac',
    'crypto-js/aes',
    'crypto-js/mode-ctr',
  ],
};

module.exports = {
  build: {
    files: [
      {
        expand: false,
        cwd: '<%= meta.cwd %>',
        src: ['<%= meta.source %>'],
        dest: '<%= meta.build %>',
      },
    ],
    options: {
      factories: ['amd', 'global'],
      pack: true,
      modules: _.extend({}, modules, { all: _.keys(modules) }),
    },
  },
  buildNode: {
    files: [
      {
        expand: false,
        cwd: '<%= meta.cwd %>',
        src: ['<%= meta.source %>'],
        dest: '<%= meta.buildNode %>',
      },
    ],
    options: {
      factories: ['commonjs'],
      modules: _.extend({}, modules, { index: _.keys(modules) }),
    },
  },
};
