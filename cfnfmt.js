const fs = require('fs');
const YAML = require('yaml');
const parseCST = require('yaml/parse-cst');
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
        this.cst = parseCST(this.template);
        this.cst.setOrigRanges();

        this.doc = this.cst[this.cst.length-1];

        this.primary_map = null;
        this.primary_map_index = 0;
        for (var i=0; i<this.doc.contents.length; i++) {
            if (this.doc.contents[i].type == "MAP") {
                this.primary_map = this.doc.contents[i];
                this.primary_map_index = i;
            }
        }

        this.disallowProcessing = false;
        this._debugLog(this._getTopLevelIncides(this.primary_map));
        if (!Object.keys(this._getTopLevelIncides(this.primary_map)).includes("Resources")) {
            this.disallowProcessing = true;
        } else if (has_nonascii) {
            console.log(`WARNING: The file '${filename}' had non-ascii characters which were removed before processing!`);
        }

        this._fixCollectionsBug();
    }

    _fixCollectionsBug() {
        // remove blank lines immediately before MAP_VALUEs
        for (var i=1; i<this.primary_map.items.length; i++) {
            if (this.primary_map.items[i].type == "MAP_VALUE" && this.primary_map.items[i - 1].type == "BLANK_LINE") {
                this.primary_map.items.splice(i-1, 1);
                i--;
            }
        }
    }

    processConfig() {
        if (this.disallowProcessing) {
            return
        }
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
    }

    postProcess(template_string) {
        this.template = template_string;

        if (Number.isInteger(this.config.newLinesAtEndOfFile)) {
            this.setTrailingNewlines(this.config.newLinesAtEndOfFile);
        }

        return this.template;
    }

    _debugLog() {
        if (this.debug) {
            console.log.apply(console, arguments);
        }
    }

    _resetParser() {
        var previous_template = this.template;

        this.template = String(this.cst);
    
        this.cst = parseCST(this.template);
        this.cst.setOrigRanges();
        
        this.doc = this.cst[this.cst.length-1];
        
        this.primary_map = null;
        this.primary_map_index = 0;
        for (var i=0; i<this.doc.contents.length; i++) {
            if (this.doc.contents[i].type == "MAP") {
                this.primary_map = this.doc.contents[i];
                this.primary_map_index = i;
            }
        }

        this._fixCollectionsBug();

        return (previous_template != this.template);
    }

    _getTopLevelIncides(node) {
        var l1_indices = {};
        var next_available_start = 0;

        for (var i=0; i<node.items.length; i++) {
            if (typeof node.items[i].rawValue == "string" && node.items[i].type == "PLAIN") {
                for (var j=i+1; j<node.items.length; j++) {
                    if (node.items[j] && node.items[j].type == "MAP_VALUE") {
                        l1_indices[node.items[i].rawValue.trim()] = {
                            "startIndex": next_available_start,
                            "keyIndex": i,
                            "endIndex": j
                        };
                        next_available_start = j+1;
                        break;
                    }
                    if (node.items[j] && !["COMMENT", "BLANK_LINE"].includes(node.items[j].type)) {
                        break;
                    }
                }
            }
        }
        return l1_indices;
    }

    setSectionOrder() {
        if (this.disallowProcessing) {
            return
        }
        var l1_indices = this._getTopLevelIncides(this.primary_map);
        var l1_keys = Object.keys(l1_indices);
        var section_order = this.config.sectionOrder.slice(); // make a copy
    
        for (var i=0; i<section_order.length; i++) { // remove not-found keys from this.config.sectionOrder
            if (!l1_keys.includes(section_order[i])) {
                section_order.splice(i, 1);
                i -= 1;
            }
        }

        var overrideStartStr = this.primary_map.context.src.slice(this.primary_map.range.start, this.primary_map.items[0].range.start);

        var previous_item = section_order.pop();
    
        while (section_order.length) {
            var desired_order_item = section_order.pop();

            this._sendCollectionItemRangeToStart(this.primary_map, l1_indices[desired_order_item].startIndex, l1_indices[desired_order_item].keyIndex, l1_indices[desired_order_item].endIndex);

            // reload indices
            l1_indices = this._getTopLevelIncides(this.primary_map);
    
            previous_item = desired_order_item;
        }

        this.primary_map.overrideStartStr = overrideStartStr;
    
        //this.cst[this.cst.length-1].contents = [...this.cst[this.cst.length-1].contents, ...this.cst[this.cst.length-1].contents[this.primary_map_index].items]; // flatten collection
        //delete this.cst[this.cst.length-1].contents[this.primary_map_index];
    
        this._resetParser();
    }

    setResourceKeyOrder() {
        if (this.disallowProcessing) {
            return
        }
        var l1_indices = this._getTopLevelIncides(this.primary_map);
        if (!Object.keys(l1_indices).includes("Resources")) {
            return;
        }

        var resources_node = this.primary_map.items[l1_indices['Resources'].endIndex].node;
        var resource_indices = this._getTopLevelIncides(resources_node);

        for (var resource of Object.keys(resource_indices)) {
            var resource_prop_node = resources_node.items[resource_indices[resource].endIndex].node;
            var resource_prop_indices = this._getTopLevelIncides(resource_prop_node);
            var resource_prop_keys = Object.keys(resource_prop_indices);

            var resource_key_order = this.config.resourceKeyOrder.slice(); // make a copy
        
            for (var i=0; i<resource_key_order.length; i++) { // remove not-found keys from this.config.sectionOrder
                if (!resource_prop_keys.includes(resource_key_order[i])) {
                    resource_key_order.splice(i, 1);
                    i -= 1;
                }
            }

            var overrideStartStr = resource_prop_node.context.src.slice(resource_prop_node.range.start, resource_prop_node.items[0].range.start);

            var previous_item = resource_key_order.pop();
        
            while (resource_key_order.length) {
                var desired_order_item = resource_key_order.pop();

                this._sendCollectionItemRangeToStart(resource_prop_node, resource_prop_indices[desired_order_item].startIndex, resource_prop_indices[desired_order_item].keyIndex, resource_prop_indices[desired_order_item].endIndex);
    
                // reload indices
                resource_prop_indices = this._getTopLevelIncides(resource_prop_node);
        
                previous_item = desired_order_item;
            }

            resource_prop_node.overrideStartStr = overrideStartStr
        }
    
        this._resetParser();
    }

    _sendCollectionItemRangeToStart(collection, startIndex, keyIndex, endIndex) {
        var indent = collection.items[keyIndex].context.indent;
        var slicedItems = collection.items.splice(startIndex, endIndex - startIndex + 1);

        collection.items[0].context.indent = Math.max(indent, collection.items[0].context.indent);
        collection.items = slicedItems.concat(collection.items);
    }

    _walkNode(node, parent, parent_item_index) {
        if (node && node.items) {
            for (var i=0; i<node.items.length; i++) {
                if (node.items[i].context) {
                    if (Number.isInteger(this.config.keyIndentLevel) && node.items[i].context.indent /* has an indent */ && node.items[i].type == "MAP_VALUE" && node.items[i-1].type == "PLAIN" && parent /* isn't top level */ && (node.items[i].context.indent - parent.items[parent_item_index].context.indent) != this.config.keyIndentLevel && parent.items[parent_item_index].type == "MAP_VALUE") {
                        var calculated_indentation = node.items[i].context.indent - parent.items[parent_item_index].context.indent;

                        var parent_raw_value = this.template.slice(parent.items[parent_item_index].range.start, parent.items[parent_item_index].range.end); // include \n
                        
                        if (calculated_indentation > this.config.keyIndentLevel) {
                            parent.items[parent_item_index].value = parent_raw_value.replace(new RegExp('\\n {' + (calculated_indentation - this.config.keyIndentLevel) + '}', 'g'), `\n`);
                            return true;
                        } else if (calculated_indentation < this.config.keyIndentLevel) {
                            parent.items[parent_item_index].value = parent_raw_value.replace(/\n( +\S)/g, `\n` + ' '.repeat(this.config.keyIndentLevel - calculated_indentation) + "$1");
                            return true;
                        }
                    }
                } // TODO: Set all values on same tree level before returning
                
                if (this._walkNode(node.items[i].node, node, i)) {
                    return true;
                }
            }
        }
    
        return false;
    }

    setIndentLevel() {
        if (this.disallowProcessing) {
            return
        }
        var spacing_iterations = 0; // safety
        while (this._walkNode(this.primary_map, null, -1) && spacing_iterations < 1000) {
            this._resetParser(); // TODO: more elegant way of applying pending changes
            spacing_iterations += 1;
        }
        if (spacing_iterations >= 1000) {
            console.log("ERROR: detected infinite indentation loop");
        }
        this._debugLog("Spacing iterations: " + spacing_iterations);
    }

    ensureAWSTemplateFormatVersionPresent() {
        if (this.disallowProcessing) {
            return
        }
        var l1_indices = this._getTopLevelIncides(this.primary_map);
        if (Object.keys(l1_indices).includes("AWSTemplateFormatVersion")) {
            return;
        }
        var insert_at_index = Object.values(l1_indices)[0].startIndex;
        var insert_at_offset = this.primary_map.items[insert_at_index].range.start;
    
        this.primary_map.value = this.template.slice(this.primary_map.range.start, insert_at_offset) +
            `AWSTemplateFormatVersion: "2010-09-09"\n` +
            this.template.slice(insert_at_offset, this.primary_map.range.end);
        
        this._resetParser();
    }

    setTrailingNewlines(count) {
        this.template = this.template.trimEnd();
        this.template += `\n`.repeat(count);
    }

    outputToStdout() {
        if (this.disallowProcessing) {
            return
        }
        var output = this.postProcess(String(this.cst));
        console.log(output);
    }

    outputToFile() {
        if (this.disallowProcessing) {
            return
        }
        var output = this.postProcess(String(this.cst));
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
                process_files = process_files.concat(glob.sync(templateFilenameFilter, { cwd: pathitem }));
            }
        } else {
            throw "Cannot handle filetype";
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
