const fs = require('fs');
const YAML = require('yaml');
const Parser = require('yaml/parse-cst').Parser;
const glob = require('glob');

class ConfigLoader {
    config = { // default config
        "template-filenames": [
            "*.yaml",
            "*.yml",
            "*.template"
        ],
        "rules": {
            "aws-template-format-version": true,
            "key-indent-level": 2,
            "section-order": [
                "AWSTemplateFormatVersion",
                "Description",
                "Metadata",
                "Parameters",
                "Mappings",
                "Conditions",
                "Transform",
                "Resources",
                "Outputs"
            ],
            "resource-key-order": [
                "DependsOn",
                "Condition",
                "CreationPolicy",
                "UpdatePolicy",
                "UpdateReplacePolicy",
                "DeletionPolicy",
                "Type",
                "Metadata",
                "Properties"
            ],
            "new-lines-at-end-of-file": 1
        }
    };

    constructor(config_filename) {
        var use_filename = null;

        if (config_filename) {
            use_filename = config_filename;
        } else if (fs.existsSync('./.cfnfmt')) {
            use_filename = './.cfnfmt';
        } else if (fs.existsSync('./.cfnfmt.yaml')) {
            use_filename = './.cfnfmt.yaml';
        } else if (fs.existsSync('./.cfnfmt.yml')) {
            use_filename = './.cfnfmt.yml';
        } else if (process.env.CFNFMT_CONFIG_FILE && fs.existsSync(process.env.CFNFMT_CONFIG_FILE)) {
            use_filename = process.env.CFNFMT_CONFIG_FILE;
        } else if (fs.existsSync('~/.config/cfnfmt/config')) {
            use_filename = '~/.config/cfnfmt/config';
        }

        if (use_filename) {
            var file_config = YAML.parse(fs.readFileSync(use_filename, 'utf8'));
            if (file_config["template-filenames"]) {
                this.config["template-filenames"] = file_config["template-filenames"];
            }
            if (file_config["rules"]) {
                Object.assign(this.config.rules, file_config["rules"]);
            }
        }
    }

    get templateFilenames() {
        return this.config["template-filenames"];
    }

    get awsTemplateFormatVersion() {
        return this.config.rules["aws-template-format-version"];
    }

    get keyIndentLevel() {
        return this.config.rules["key-indent-level"];
    }

    get sectionOrder() {
        return this.config.rules["section-order"];
    }

    get resourceKeyOrder() {
        return this.config.rules["resource-key-order"];
    }

    get newLinesAtEndOfFile() {
        return this.config.rules["new-lines-at-end-of-file"];
    }
}

class TemplateTransformer {
    constructor(filename, config, debug) {
        this.filename = filename;
        this.debug = debug;
        this.config = config;
        this.file_contents = fs.readFileSync(filename, 'utf8');

        var has_nonascii = this.file_contents.match(/[^\x00-\x7F]/g);
        this.file_contents = this.file_contents.replace(/[^\x00-\x7F]/g, "");

        this.template = this.file_contents;
        
        var parser = new Parser(
            t => {
                if (t.type == "document") {
                    this.doc = t;
                }
            }
        );
        parser.parse(this.template);
    }

    processConfig() {
        if (this.disallowProcessing || !this.doc) {
            return
        }

        this.doc.value.items = this._normalizeItems(this.doc.value.items);

        if (this.config.awsTemplateFormatVersion) {
            this.ensureAWSTemplateFormatVersionPresent();
        }
        if (this.config.sectionOrder) {
            this.setSectionOrder();
        }
        if (this.config.resourceKeyOrder) {
            this.setResourceKeyOrder();
        }
        if (Number.isInteger(this.config.keyIndentLevel)) {
            this.setIndentLevel();
        }

        /*
        const util = require('util');
        console.log(util.inspect(this.doc, false, null, true));
        */
    }

    postProcess(doc) {
        this.template = this._stringifyItem(doc);

        if (Number.isInteger(this.config.newLinesAtEndOfFile)) {
            this.setTrailingNewlines(this.config.newLinesAtEndOfFile);
        }

        return this.template;
    }

    _addSourceToStr(item, property) {
        if (!item[property]) {
            return "";
        }

        if (!Array.isArray(item[property])) {
            item[property] = [ item[property] ];
        }

        var ret = "";

        for (var el of item[property]) {
            ret += el.source;
        }
        
        return ret;
    }

    _stringifyItem(item) {
        var ret = "";

        ret += this._addSourceToStr(item, 'start');
        ret += this._addSourceToStr(item, 'key');
        ret += this._addSourceToStr(item, 'sep');
        if (item.value) {
            if (!Array.isArray(item.value)) {
                item.value = [ item.value ];
            }
            for (var value of item.value) {
                ret += this._stringifyItem(value);
            }
        }
        if (item.source) {
            if (item.props) {
                for (var prop of item.props) {
                    ret += prop.source;
                }
            }
            ret += item.source;
        }
        if (item.items) {
            for (var subitem of item.items) {
                ret += this._stringifyItem(subitem);
            }
        }
        ret += this._addSourceToStr(item, 'end');

        return ret;
    }

    _debugLog() {
        if (this.debug) {
            console.log.apply(console, arguments);
        }
    }

    _getTopLevelIncides(token) {
        var keys = {};
        
        for (var i=0; i<token.value.items.length; i++) {
            if (token.value.items[i].key && token.value.items[i].key.source) {
                keys[token.value.items[i].key.source] = i;
            }
        }

        return keys;
    }

    setSectionOrder() {
        if (this.disallowProcessing) {
            return
        }
        var l1_indices = this._getTopLevelIncides(this.doc);
        var l1_keys = Object.keys(l1_indices);

        var section_order = this.config.sectionOrder.slice(); // make a copy
    
        for (var i=0; i<section_order.length; i++) { // remove not-found keys from this.config.sectionOrder
            if (!l1_keys.includes(section_order[i])) {
                section_order.splice(i, 1);
                i -= 1;
            }
        }

        this.doc.value.items.sort((a, b) => {
            if (a.key && a.key.source && section_order.indexOf(a.key.source) > -1 && b.key && b.key.source && section_order.indexOf(b.key.source) > -1) {
                return section_order.indexOf(a.key.source) - section_order.indexOf(b.key.source);
            }

            return 0;
        });
    }

    _normalizeItems(items) {
        for (var i=0; i<items.length; i++) {
            if (items[i].value && items[i].value.items && items[i].value.items.length && items[i].sep) {
                var septypes = items[i].sep.map(x => x.type);
                if (septypes[septypes.length - 2] == "newline" && septypes[septypes.length - 1] == "space") {
                    var sepspace = items[i].sep.pop();
                    items[i].value.items[0].start.unshift(sepspace);
                }
            }
        }

        for (var i=0; i<items.length - 1; i++) {
            if (items[i].value && items[i].value.items) {
                var lastitemkeys = Object.keys(items[i].value.items[items[i].value.items.length - 1]);
                if (lastitemkeys.length == 1 && lastitemkeys[0] == "start") {
                    var lastitem = items[i].value.items.pop();
                    items[i + 1].start = lastitem.start.concat(items[i + 1].start); // move the start to next root
                }
            }
        }

        for (var i=0; i<items.length; i++) { // recurse
            if (items[i].value && items[i].value.items) {
                items[i].value.items = this._normalizeItems(items[i].value.items);
            }
        }

        return items;
    }

    _setIndentItems(items, level) {
        for (var i=0; i<items.length; i++) { // recurse
            if (items[i].start && items[i].start.length && items[i].start[0].type == "space") {
                items[i].start[0].source = " ".repeat(level * this.config.keyIndentLevel);
            }

            if (items[i].value && items[i].value.items) {
                items[i].value.items = this._setIndentItems(items[i].value.items, level + 1);
            }
        }

        return items;
    }

    setIndentLevel() {
        if (this.disallowProcessing) {
            return
        }

        this.doc.value.items = this._setIndentItems(this.doc.value.items, 0);
    }

    setResourceKeyOrder() {
        if (this.disallowProcessing) {
            return
        }
        var l1_indices = this._getTopLevelIncides(this.doc);
        var l1_keys = Object.keys(l1_indices);

        if (!l1_keys.includes("Resources")) {
            return;
        }

        for (var j=0; j<this.doc.value.items[l1_indices["Resources"]].value.items.length; j++) {
            var resource_obj = this.doc.value.items[l1_indices["Resources"]].value.items[j];
            var resource_indices = this._getTopLevelIncides(resource_obj);
            var resource_keys = Object.keys(resource_indices);

            var resource_key_order = this.config.resourceKeyOrder.slice(); // make a copy
        
            for (var i=0; i<resource_key_order.length; i++) { // remove not-found keys from this.config.resourceKeyOrder
                if (!resource_keys.includes(resource_key_order[i])) {
                    resource_key_order.splice(i, 1);
                    i -= 1;
                }
            }

            this.doc.value.items[l1_indices["Resources"]].value.items[j].value.items.sort((a, b) => {
                if (a.key && a.key.source && resource_key_order.indexOf(a.key.source) > -1 && b.key && b.key.source && resource_key_order.indexOf(b.key.source) > -1) {
                    return resource_key_order.indexOf(a.key.source) - resource_key_order.indexOf(b.key.source);
                }

                return 0;
            });
        }
    }

    ensureAWSTemplateFormatVersionPresent() {
        if (this.disallowProcessing) {
            return
        }

        var l1_indices = this._getTopLevelIncides(this.doc);
        if (Object.keys(l1_indices).includes("AWSTemplateFormatVersion")) {
            return;
        }
        
        var insert_pos = 0;
        this.doc.value.items.splice(insert_pos, 0, {
            start: [],
            key: {
                type: 'scalar',
                offset: 0,
                indent: 0,
                source: 'AWSTemplateFormatVersion'
            },
            sep: [
                { type: 'map-value-ind', indent: 0, source: ':' },
                { type: 'space', indent: 0, source: ' ' }
            ],
            value: {
                type: 'single-quoted-scalar',
                offset: 'AWSTemplateFormatVersion'.length + 2,
                indent: 0,
                source: "'2010-09-09'",
                end: [
                    { type: 'newline', indent: 0, source: '\n' }
                ]
            }
        });
    }

    setTrailingNewlines(count) {
        this.template = this.template.trimEnd();
        this.template += `\n`.repeat(count);
    }

    outputToStdout() {
        if (this.disallowProcessing) {
            return
        }
        var output = this.postProcess(this.doc);
        console.log(output);
    }

    outputToFile() {
        if (this.disallowProcessing) {
            return
        }
        var output = this.postProcess(this.doc);
        fs.writeFileSync(this.filename, output);
    }
}

module.exports = (args) => {
    var config = new ConfigLoader(args.config);

    var process_files = [];

    for (var pathitem of args.path) {
        var stat = fs.lstatSync(pathitem);
        if (stat.isFile()) {
            process_files.push(pathitem);
        } else if (stat.isDirectory()) {
            for (var templateFilenameFilter of config.templateFilenames) {
                process_files = process_files.concat(glob.sync(templateFilenameFilter, { cwd: pathitem, absolute: true }));
            }
        } else {
            throw new Error("Cannot handle filetype");
        }
    }

    for (var filepath of process_files) {
        var template_transformer = new TemplateTransformer(filepath, config, args.debug);

        template_transformer.processConfig();

        if (args.outputToStdout) {
            template_transformer.outputToStdout();
        } else {
            template_transformer.outputToFile();
        }
    }
};
