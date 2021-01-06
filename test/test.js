var assert = require('assert');
const cfnfmt = require('../cfnfmt');

describe('Base Config Tests', function() {
    it('basic test', function() {
        cfnfmt({
            path: ['./test/test1/'],
            outputToStdout: true
        });
    });
});
