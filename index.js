const fs = require('fs');
const parseCST = require('yaml/parse-cst');

const file_contents = fs.readFileSync('./file.yml', 'utf8');
var template = file_contents
var cst = parseCST(template);
cst.setOrigRanges();

var doc = cst[cst.length-1];

var primary_map = null;
var primary_map_index = 0;
for (var i=0; i<doc.contents.length; i++) {
    if (doc.contents[i].type == "MAP") {
        primary_map = doc.contents[i];
        primary_map_index = i;
    }
}

// CONFIG
var DESIRED_ORDER = [
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
var DESIRED_INDENTATION = 2;
//

function resetParser() {
    template = String(cst);

    cst = parseCST(template);
    cst.setOrigRanges();
    
    doc = cst[cst.length-1];
    
    primary_map = null;
    primary_map_index = 0;
    for (var i=0; i<doc.contents.length; i++) {
        if (doc.contents[i].type == "MAP") {
            primary_map = doc.contents[i];
            primary_map_index = i;
        }
    }
}

function getL1Incides(primary_map) {
    var l1_indices = {};
    for (var i=0; i<primary_map.items.length; i++) {
        if (typeof primary_map.items[i].rawValue == "string" && primary_map.items[i].type == "PLAIN" && primary_map.items[i+1] && primary_map.items[i+1].type == "MAP_VALUE") {
            l1_indices[primary_map.items[i].rawValue.trim()] = i;
        }
    }
    return l1_indices;
}

function orderL1() {
    var l1_indices = getL1Incides(primary_map);
    var l1_keys = Object.keys(l1_indices);

    for (var i=0; i<DESIRED_ORDER.length; i++) { // remove not-found keys from DESIRED_ORDER
        if (!l1_keys.includes(DESIRED_ORDER[i])) {
            DESIRED_ORDER.splice(i, 1);
        }
    }

    var slice_start = 0;
    var previous_index = l1_indices[DESIRED_ORDER.shift()];

    while (DESIRED_ORDER.length) {
        var desired_order_item = DESIRED_ORDER.shift();

        console.log("Desired Order Item:");
        console.log(desired_order_item);

        current_index = l1_indices[desired_order_item];
        console.log("Current Index:");
        console.log(current_index);

        slice_start = 0;
        for (var index of Object.values(l1_indices)) {
            if (index < current_index && index >= slice_start) {
                slice_start = index + 2;
            }
        }
        
        if (slice_start != previous_index + 2) {
            var slice = primary_map.items.splice(slice_start, current_index - slice_start + 2);
            var insert_at = previous_index + 2;
            if (previous_index > slice_start) {
                insert_at = previous_index + 2 - slice.length;
            }
            console.log("At " + slice_start + ", we removed " + slice.length + " items and are re-inserting at " + insert_at);
            primary_map.items.splice(insert_at, 0, ...slice);

            // reload indices
            l1_indices = getL1Incides(primary_map);

            // set new location of current index
            current_index = l1_indices[desired_order_item];
        } else {
            // Skipping, already in order
        }

        previous_index = current_index;
    }

    console.log(primary_map.items);

    cst[cst.length-1].contents = [...cst[cst.length-1].contents, ...cst[cst.length-1].contents[primary_map_index].items]; // flatten collection
    delete cst[cst.length-1].contents[primary_map_index];

    resetParser();
}

function recurse(node, parent, parent_item_index) {
    if (node && node.items) {
        for (var i=0; i<node.items.length; i++) {
            if (node.items[i].context) {
                if (node.items[i].context.indent /* has an indent */ && node.items[i].type == "MAP_VALUE" && node.items[i-1].type == "PLAIN" && parent /* isn't top level */ && (node.items[i].context.indent - parent.items[parent_item_index].context.indent) != DESIRED_INDENTATION && parent.items[parent_item_index].type == "MAP_VALUE") {
                    var start_of_key = node.items[i-1].range.start;
                    var calculated_indentation = node.items[i].context.indent - parent.items[parent_item_index].context.indent;

                    console.log("Actual indent: " + node.items[i].context.indent);
                    console.log("Parent indent: " + parent.items[parent_item_index].context.indent);
                    console.log("Parent type: " + parent.items[parent_item_index].type);
                    console.log("Key: '" + node.items[i-1].rawValue + "'");
                    console.log("Calculated indent: " + calculated_indentation);

                    var offset_to_start_of_key = start_of_key - parent.items[parent_item_index].range.start;
                    var parent_raw_value = template.slice(parent.items[parent_item_index].range.start, parent.items[parent_item_index].range.end);
                    //parent_raw_value = parent.items[parent_item_index].rawValue;
                    
                    if (calculated_indentation > DESIRED_INDENTATION) {
                        parent.items[parent_item_index].value = parent_raw_value.replace(new RegExp('\\n {' + (calculated_indentation - DESIRED_INDENTATION) + '}', 'g'), `\n`);
                    } else {
                        parent.items[parent_item_index].value = parent_raw_value.replace(/\n/g, `\n` + ' '.repeat(DESIRED_INDENTATION - calculated_indentation));
                    }

                    console.log("Updated Value:");
                    console.log(parent.items[parent_item_index].value);

                    console.log("******");
                    return true;
                }
            }
            
            if (recurse(node.items[i].node, node, i)) {
                return true;
            }
        }
    }

    return false;
}

function setSpacing() {
    var spacing_iterations = 0; // safety
    while (recurse(primary_map, null, -1) && spacing_iterations < 1000) {
        resetParser(); // TODO: more elegant way of applying pending changes
        spacing_iterations += 1;
    }
    console.log("Spacing iterations: " + spacing_iterations);
}

orderL1();
setSpacing();

console.log("#---------------#");
var output = String(cst);
console.log(output);
fs.writeFileSync('./out.yml', output);