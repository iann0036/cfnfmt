const fs = require('fs');
const YAML = require('yaml');
const parseCST = require('yaml/parse-cst');

// CONFIG
var DESIRED_L1_ORDER = [
    "AWSTemplateFormatVersion",
    "Description",
    "Metadata",
    "Parameters",
    "Mappings",
    "Conditions",
    "Transform",
    "Resources",
    "Outputs",
];
var DESIRED_L2_RESOURCES_ORDER = [
    "DependsOn",
    "Type",
    "Metadata",
    "Properties",
];
var DESIRED_INDENTATION = 2;
//

class TemplateTransformer {
    constructor(args) {
        this.args = args;
        this.file_contents = fs.readFileSync(args.filename, 'utf8');
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
    }

    _debugLog() {
        if (this.args.debug) {
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

    _getL1Incides(primary_map) {
        var l1_indices = {};
        for (var i=0; i<primary_map.items.length; i++) {
            if (typeof primary_map.items[i].rawValue == "string" && primary_map.items[i].type == "PLAIN" && primary_map.items[i+1] && primary_map.items[i+1].type == "MAP_VALUE") {
                l1_indices[primary_map.items[i].rawValue.trim()] = i;
            }
        }
        return l1_indices;
    }

    orderL1() {
        var l1_indices = this._getL1Incides(this.primary_map);
        var l1_keys = Object.keys(l1_indices);
    
        for (var i=0; i<DESIRED_L1_ORDER.length; i++) { // remove not-found keys from DESIRED_L1_ORDER
            if (!l1_keys.includes(DESIRED_L1_ORDER[i])) {
                DESIRED_L1_ORDER.splice(i, 1);
            }
        }
    
        var slice_start = 0;
        var previous_index = l1_indices[DESIRED_L1_ORDER.shift()];
    
        while (DESIRED_L1_ORDER.length) {
            var desired_order_item = DESIRED_L1_ORDER.shift();
    
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
                if (previous_index > slice_start) {
                    insert_at = previous_index + 2 - slice.length;
                }
                this._debugLog("At " + slice_start + ", we removed " + slice.length + " items and are re-inserting at " + insert_at);
                this.primary_map.items.splice(insert_at, 0, ...slice);
    
                // reload indices
                l1_indices = this._getL1Incides(this.primary_map);
    
                // set new location of current index
                current_index = l1_indices[desired_order_item];
            }
    
            previous_index = current_index;
        }
    
        this._debugLog(this.primary_map.items);
    
        //cst[cst.length-1].contents = [...cst[cst.length-1].contents, ...cst[cst.length-1].contents[primary_map_index].items]; // flatten collection
        //delete cst[cst.length-1].contents[primary_map_index];
    
        this._resetParser();
    }

    _walkNode(node, parent, parent_item_index) {
        if (node && node.items) {
            for (var i=0; i<node.items.length; i++) {
                if (node.items[i].context) {
                    if (node.items[i].context.indent /* has an indent */ && node.items[i].type == "MAP_VALUE" && node.items[i-1].type == "PLAIN" && parent /* isn't top level */ && (node.items[i].context.indent - parent.items[parent_item_index].context.indent) != DESIRED_INDENTATION && parent.items[parent_item_index].type == "MAP_VALUE") {
                        var start_of_key = node.items[i-1].range.start;
                        var calculated_indentation = node.items[i].context.indent - parent.items[parent_item_index].context.indent;
    
                        this._debugLog("Actual indent: " + node.items[i].context.indent);
                        this._debugLog("Parent indent: " + parent.items[parent_item_index].context.indent);
                        this._debugLog("Parent type: " + parent.items[parent_item_index].type);
                        this._debugLog("Key: '" + node.items[i-1].rawValue + "'");
                        this._debugLog("Calculated indent: " + calculated_indentation);
    
                        var offset_to_start_of_key = start_of_key - parent.items[parent_item_index].range.start;
                        var parent_raw_value = this.template.slice(parent.items[parent_item_index].range.start, parent.items[parent_item_index].range.end);
                        //parent_raw_value = parent.items[parent_item_index].rawValue;
                        
                        if (calculated_indentation > DESIRED_INDENTATION) {
                            parent.items[parent_item_index].value = parent_raw_value.replace(new RegExp('\\n {' + (calculated_indentation - DESIRED_INDENTATION) + '}', 'g'), `\n`);
                        } else {
                            parent.items[parent_item_index].value = parent_raw_value.replace(/\n/g, `\n` + ' '.repeat(DESIRED_INDENTATION - calculated_indentation));
                        }
    
                        this._debugLog("Updated Value:");
                        this._debugLog(parent.items[parent_item_index].value);
    
                        this._debugLog("******");
                        return true;
                    }
                }
                
                if (this._walkNode(node.items[i].node, node, i)) {
                    return true;
                }
            }
        }
    
        return false;
    }

    setSpacing() {
        var spacing_iterations = 0; // safety
        while (this._walkNode(this.primary_map, null, -1) && spacing_iterations < 1000) {
            this._resetParser(); // TODO: more elegant way of applying pending changes
            spacing_iterations += 1;
        }
        this._debugLog("Spacing iterations: " + spacing_iterations);
    }

    ensureAWSTemplateFormatVersionPresent() {
        var l1_indices = this._getL1Incides(this.primary_map);
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
        var output = String(this.cst);
        console.log(output);
    }

    outputToFile() {
        var output = String(this.cst);
        fs.writeFileSync(this.args.filename, output);
    }
}

module.exports = (args) => {
    template_transformer = new TemplateTransformer(args);
    template_transformer.ensureAWSTemplateFormatVersionPresent();
    template_transformer.orderL1();
    template_transformer.setSpacing();
    if (args.outputToStdout) {
        template_transformer.outputToStdout();
    } else {
        template_transformer.outputToFile();
    }
};
