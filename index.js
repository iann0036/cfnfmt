const cfnfmt = require('./cfnfmt');
const { program } = require('commander');

program
    .arguments('<filename>')
    .option('-c, --config <filename>', 'configuration file')
    .option('--output-to-stdout', 'output result to stdout instead of file')
    .option('--debug', 'debug mode')
    .action(function(filename) {
        providedFilename = filename;
    })
    .parse(process.argv);

if (typeof providedFilename === 'undefined') {
    console.log('ERROR: no filename provided');
    process.exit(1);
}
program.filename = providedFilename;

cfnfmt(program);
