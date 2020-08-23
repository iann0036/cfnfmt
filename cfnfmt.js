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
            //"list-indent-level": 0,
            "list-indent-level": false,
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
            /*"resource-key-order": [
                "DependsOn",
                "Condition",
                "CreationPolicy",
                "UpdatePolicy",
                "UpdateReplacePolicy",
                "DeletionPolicy",
                "Type",
                "Metadata",
                "Properties"
            ],*/
            "resource-key-order": false
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

    get listIndentLevel() {
        return this.config.rules["list-indent-level"];
    }

    get sectionOrder() {
        return this.config.rules["section-order"];
    }

    get resourceKeyOrder() {
        return this.config.rules["resource-key-order"];
    }
}

class TemplateTransformer {
    constructor(filename, config, debug) {
        this.filename = filename;
        this.debug = debug;
        this.config = config;
        this.file_contents = fs.readFileSync(filename, 'utf8');
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
        if (!Object.keys(this._getTopLevelIncides(this.primary_map)).includes("Resources")) {
            this.disallowProcessing = true;
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
        if (!isNaN(this.config.keyIndentLevel) || !isNaN(this.config.listIndentLevel)) {
            this.setIndentLevel();
        }
    }

    _debugLog() {
        if (this.debug) {
            console.log.apply(console, arguments);
        }
    }

    _resetParser() {
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
    }

    _getTopLevelIncides(node) {
        var l1_indices = {};
        for (var i=0; i<node.items.length; i++) {
            if (typeof node.items[i].rawValue == "string" && node.items[i].type == "PLAIN" && node.items[i+1] && node.items[i+1].type == "MAP_VALUE") {
                l1_indices[node.items[i].rawValue.trim()] = i;
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
    
        var slice_start = 0;
        var previous_index = l1_indices[section_order.shift()];
    
        while (section_order.length) {
            var desired_order_item = section_order.shift();
    
            this._debugLog("Desired Order Item:");
            this._debugLog(desired_order_item);
    
            var current_index = l1_indices[desired_order_item];
            this._debugLog("Current Index:");
            this._debugLog(current_index);
    
            slice_start = 0;
            for (var index of Object.values(l1_indices)) {
                if (index < current_index && index >= slice_start) {
                    slice_start = index + 2;
                }
            }
            
            if (slice_start != previous_index + 2) { // Skip if already in order
                var slice = this.primary_map.items.splice(slice_start, current_index - slice_start + 2);
                var insert_at = previous_index + 2;
                if (slice_start < previous_index) {
                    insert_at = previous_index + 2 - slice.length;
                }
                this._debugLog("At " + slice_start + ", we removed " + slice.length + " items and are re-inserting at " + insert_at);
                this.primary_map.items.splice(insert_at, 0, ...slice);
    
                // reload indices
                l1_indices = this._getTopLevelIncides(this.primary_map);
    
                // set new location of current index
                current_index = l1_indices[desired_order_item];
            }
    
            previous_index = current_index;
        }
    
        this._debugLog(this.primary_map.items);
    
        this.cst[this.cst.length-1].contents = [...this.cst[this.cst.length-1].contents, ...this.cst[this.cst.length-1].contents[this.primary_map_index].items]; // flatten collection
        delete this.cst[this.cst.length-1].contents[this.primary_map_index];
    
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

        var resources_node = this.primary_map.items[l1_indices['Resources'] + 1].node;
        var resource_indices = this._getTopLevelIncides(resources_node);

        for (var resource of Object.keys(resource_indices)) {
            var resource_prop_node = resources_node.items[resource_indices[resource] + 1].node;
            var resource_prop_indices = this._getTopLevelIncides(resource_prop_node);
            var resource_prop_keys = Object.keys(resource_prop_indices);
        
            this._debugLog("Resource Prop Indices:");
            this._debugLog(resource_prop_indices);

            var resource_key_order = this.config.resourceKeyOrder.slice(); // make a copy
        
            for (var i=0; i<resource_key_order.length; i++) { // remove not-found keys from this.config.sectionOrder
                if (!resource_prop_keys.includes(resource_key_order[i])) {
                    resource_key_order.splice(i, 1);
                    i -= 1;
                }
            }
        
            var slice_start = 0;
            var previous_index = resource_prop_indices[resource_key_order.shift()];
        
            while (resource_key_order.length) {
                var desired_order_item = resource_key_order.shift();

                /*this._debugLog("Previous Index:");
                this._debugLog(previous_index);
        
                this._debugLog("Desired Order Item:");
                this._debugLog(desired_order_item);*/
        
                var current_index = resource_prop_indices[desired_order_item];
                /*this._debugLog("Current Index:");
                this._debugLog(current_index);*/
        
                slice_start = 0;
                for (var index of Object.values(resource_prop_indices)) {
                    if (index < current_index && index >= slice_start) {
                        slice_start = index + 2;
                    }
                }
                
                if (slice_start != previous_index + 2) { // Skip if already in order
                    var slice = resource_prop_node.items.splice(slice_start, current_index - slice_start + 2);
                    var insert_at = previous_index + 2;
                    if (slice_start < previous_index) {
                        insert_at = previous_index + 2 - slice.length;
                    }
                    this._debugLog("At " + slice_start + ", we removed " + slice.length + " items and are re-inserting at " + insert_at);
                    resource_prop_node.items.splice(insert_at, 0, ...slice);
        
                    // reload indices
                    resource_prop_indices = this._getTopLevelIncides(resource_prop_node);
                    /*this._debugLog("New resource_prop_indices:");
                    this._debugLog(resource_prop_indices);

                    this._debugLog("New resource_prop_node.items:");
                    this._debugLog(resource_prop_node.items);*/
        
                    // set new location of current index
                    current_index = resource_prop_indices[desired_order_item];
                    //this._debugLog("Updated Current Index: " + current_index);
                }
        
                previous_index = current_index;
            }
    
            this._resetParser();
        }
    }

    _walkNode(node, parent, parent_item_index) {
        if (node && node.items) {
            for (var i=0; i<node.items.length; i++) {
                if (node.items[i].context) {
                    if (!isNaN(this.config.keyIndentLevel) && node.items[i].context.indent /* has an indent */ && node.items[i].type == "MAP_VALUE" && node.items[i-1].type == "PLAIN" && parent /* isn't top level */ && (node.items[i].context.indent - parent.items[parent_item_index].context.indent) != this.config.keyIndentLevel && parent.items[parent_item_index].type == "MAP_VALUE") {
                        var calculated_indentation = node.items[i].context.indent - parent.items[parent_item_index].context.indent;
    
                        /*this._debugLog("Actual indent: " + node.items[i].context.indent);
                        this._debugLog("Parent indent: " + parent.items[parent_item_index].context.indent);
                        this._debugLog("Parent type: " + parent.items[parent_item_index].type);
                        this._debugLog("Key: '" + node.items[i-1].rawValue + "'");
                        this._debugLog("Calculated indent: " + calculated_indentation);*/

                        var parent_raw_value = this.template.slice(parent.items[parent_item_index].range.start, parent.items[parent_item_index].range.end); // include \n
                        //parent_raw_value = parent.items[parent_item_index].rawValue;
                        
                        if (calculated_indentation > this.config.keyIndentLevel) {
                            parent.items[parent_item_index].value = parent_raw_value.replace(new RegExp('\\n {' + (calculated_indentation - this.config.keyIndentLevel) + '}', 'g'), `\n`);
                        } else {
                            parent.items[parent_item_index].value = parent_raw_value.replace(/\n/g, `\n` + ' '.repeat(this.config.keyIndentLevel - calculated_indentation));
                        }
    
                        /*this._debugLog("Updated Value:");
                        this._debugLog(parent.items[parent_item_index].value);
                        this._debugLog("******");*/
                        return true;
                    } else if (!isNaN(this.config.listIndentLevel) && node.items[i].type == "SEQ_ITEM" && parent /* isn't top level */) {
                        var calculated_indentation = parent.items[parent_item_index].context.indent + this.config.listIndentLevel;
                        if (!parent.items[parent_item_index].context.indent) { continue; }
                        var parent_raw_value = this.template.slice(parent.items[parent_item_index].range.start, parent.items[parent_item_index].range.end); // include \n
                        //parent_raw_value = parent.items[parent_item_index].rawValue;

                        var match_pattern = parent_raw_value.match(new RegExp('\\n( *)-'))[0];
                        var replaced_value = parent_raw_value.replace(new RegExp(match_pattern, 'g'), `\n` + ' '.repeat(calculated_indentation) + '-');
                        
                        if (replaced_value != parent_raw_value) {
                            parent.items[parent_item_index].value = replaced_value;
                            
                            return true;
                        }
                    }
                }
                
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
        var insert_at_index = Object.values(l1_indices)[0];
        var insert_at_offset = this.primary_map.items[insert_at_index].range.start;
    
        this.primary_map.value = this.template.slice(this.primary_map.range.start, insert_at_offset) +
            `AWSTemplateFormatVersion: "2010-09-09"\n` +
            this.template.slice(insert_at_offset, this.primary_map.range.end);
        
        this._resetParser();
    }

    outputToStdout() {
        if (this.disallowProcessing) {
            return
        }
        var output = String(this.cst);
        console.log(output);
    }

    outputToFile() {
        if (this.disallowProcessing) {
            return
        }
        var output = String(this.cst);
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
