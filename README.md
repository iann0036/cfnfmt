# cfnfmt

> :construction: WORK IN PROGRESS

cfnfmt is an AWS CloudFormation template style formatter. It identifies and corrects things like line spacing, key ordering and other items which could be considered personal preference.

It does not check or determine the validity of resource property syntax, for that you should use [cfn-lint](https://github.com/aws-cloudformation/cfn-python-lint).

## Installation

```
npm i -g cfnfmt
```

## Usage

Basic usage:

```
cfnfmt template.yml other-template.yaml
```

You can also format all templates in a whole directory:

```
cfnfmt .
```

## Configuration

cfnfmt uses a set of rules to allow you to customize your template styling preference. Each rule is independent from the others, and can be enabled, disabled or changed. All these settings can be gathered in a configuration file.

To use a custom configuration file, use the `-c` option:

```
cfnfmt -c config.yaml template.yaml
```

If `-c` is not provided, cfnfmt will look for a configuration file in the following locations (by order of preference):

* `.cfnfmt`, `.cfnfmt.yaml` or `.cfnfmt.yml` in the current working directory
* the file referenced by `$CFNFMT_CONFIG_FILE`, if set
* `~/.config/cfnfmt/config`

Finally, if no config file is found the default configuration is applied.

### Default Configuration

```
template-filenames:
- "*.yaml"
- "*.yml"
- "*.template"
rules:
  aws-template-format-version: true
  key-indent-level: 2
  section-order:
  - "AWSTemplateFormatVersion"
  - "Description"
  - "Metadata"
  - "Parameters"
  - "Mappings"
  - "Conditions"
  - "Transform"
  - "Resources"
  - "Outputs"
```

### Rules

The following settings can be set in the `rules` section of the configuration file:

#### aws-template-format-version

If set to `true`, the template is checked for the presence of the `AWSTemplateFormatVersion` key. If not found, the key will be added with the `2010-09-09` value.

#### key-indent-level

An integer representing the number of spaces to indent map/object keys at. Lists/sequences are not affected by this setting.

#### section-order

A list of sections in the order it should be rearranged to. Not all defined sections have to be defined in the template. Any sections not defined by this list will retain their existing order.
