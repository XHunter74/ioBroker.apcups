import ioBroker from '@iobroker/eslint-config';

export default [
    ...ioBroker,
    {
        ignores: [
            'admin/words.js',
            'node_modules/',
            '**/test/',
            'main.test.js',
            'lib/adapter-config.d.ts',
        ],
    },
    {
        rules: {
            // Disable Prettier enforcement — code uses 4-space indent and single quotes
            'prettier/prettier': 'off',
            // JSDoc not used in this codebase
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param-description': 'off',
        },
    },
];
