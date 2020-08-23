#!/usr/bin/env node

const cfnfmt = require('./cfnfmt');
const { program } = require('commander');
const pjson = require('./package.json');

program
    .version(pjson.version)
    .description('CloudFormation template style formatter')
    .arguments('<path...>')
    .option('-c, --config <filename>', 'configuration file')
    .option('--output-to-stdout', 'output result to stdout instead of file')
    .option('--debug', 'debug mode')
    .action(function(path) {
        providedPath = path;
    })
    .parse(process.argv);

if (typeof providedPath === 'undefined') {
    console.log('ERROR: no path provided');
    process.exit(1);
}
program.path = providedPath;

cfnfmt(program);
