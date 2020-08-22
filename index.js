const fs = require('fs')
//const YAML = require('yaml')
const parseCST = require('yaml/parse-cst')

/*YAML.defaultOptions = {
    schema: 'yaml-1.1',
    version: '1.1',
    keepCstNodes: true,
    customTags: [
        'Ref',
        'Sub',
        'GetAtt',
        'Condition',
        'Base64',
        'Cidr',
        'FindInMap',
        'GetAtt',
        'GetAZs',
        'ImportValue',
        'Join',
        'Select',
        'Split',
        'Sub',
        'Transform',
        'And',
        'Equals',
        'If',
        'Not',
        'Or',
        'Contains',
        'EachMemberEquals',
        'EachMemberIn',
        'RefAll',
        'ValueOf',
        'ValueOfAll'
    ]
};*/

const file = fs.readFileSync('./file.yml', 'utf8');
const cst = parseCST(file);
cst.setOrigRanges();

const doc = cst[cst.length-1];

var primary_map = null;
var primary_map_index = 0;
for (var i=0; i<doc.contents.length; i++) {
    if (doc.contents[i].type == "MAP") {
        primary_map = doc.contents[i];
        primary_map_index = i;
    }
}

var l1_indices = {};
for (var i=0; i<primary_map.items.length; i++) {
    if (typeof primary_map.items[i].rawValue == "string" && primary_map.items[i].type == "PLAIN" && primary_map.items[i+1] && primary_map.items[i+1].type == "MAP_VALUE") {
        l1_indices[primary_map.items[i].rawValue] = i;
    }
}

desired_order = [
    "Description",
    "Parameters",
    "Conditions",
    "Resources",
    "Outputs"
];

var previous_index = l1_indices[desired_order.shift()];
var slice_start = 0;
while (desired_order.length) {
    var desired_order_item = desired_order.shift();
    current_index = l1_indices[desired_order_item];

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
        //console.log("At " + slice_start + ", we removed " + slice.length + " items and are re-inserting at " + insert_at);
        primary_map.items.splice(insert_at, 0, ...slice);

        // reload indices
        l1_indices = {};
        for (var i=0; i<primary_map.items.length; i++) {
            if (typeof primary_map.items[i].rawValue == "string" && primary_map.items[i].type == "PLAIN" && primary_map.items[i+1] && primary_map.items[i+1].type == "MAP_VALUE") {
                l1_indices[primary_map.items[i].rawValue] = i;
            }
        }
        current_index = l1_indices[desired_order_item];
    } else {
        // Skipping, already in order
    }

    previous_index = current_index;
}

cst[cst.length-1].contents = [...cst[cst.length-1].contents, ...cst[cst.length-1].contents[primary_map_index].items]; // flatten collection
delete cst[cst.length-1].contents[primary_map_index];

console.log(String(cst));
