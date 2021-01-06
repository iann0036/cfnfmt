var assert = require('assert');
const cfnfmt = require('../cfnfmt');

describe('Config Tests', function() {
    it('base test', function() {
        cfnfmt({
            path: ['./test/test1/'],
            outputToStdout: true
        });
    });
    
    it('key indent of 4', function() {
        cfnfmt({
            path: ['./test/test2/'],
            config: './test/test2/.cfnfmt',
            outputToStdout: true
        });
    });
});
