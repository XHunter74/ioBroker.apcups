import ioBrokerConfig from '@iobroker/eslint-config';

export default [
    ...ioBrokerConfig,
    {
        rules: {
            // JSDoc not used in this codebase
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param-description': 'off',
            // Template expressions with unknown/error types are common in adapter logging
            '@typescript-eslint/restrict-template-expressions': 'off',
        },
    },
    {
        ignores: [
            'admin/words.js',
            'node_modules/',
            'build/',
            'test/',
            'src/lib/adapter-config.d.ts',
        ],
    },
];
