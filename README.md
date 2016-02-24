# marked-it-cli

A command-line interface for [marked-it](https://github.com/grant-g/marked-it "marked-it Git repo") that adds support for DITA-style conref attributes, uniform headers/footers, and .pdf generation.

## Install

``` bash
npm install -g marked-it-cli
```

You may need to ```sudo``` the above command since it installs globally.

## Usage

```bash
marked-it-cli --sourceDir=<sourceDirectory> --destDir=<destinationDirectory> [OPTIONS]
```

### options [default values]
```
-overwrite [false]
	Overwrite output files that already exist

-disableAttributes [false]
	Disable processing of Kramdown-style attribute lists

-disablePDF [false]
	Do not generate .pdf files

-disableTOC [false]
	Do not generate Table of Contents files

--headerFile=<headerSourceFile>
	Path to the file with content to be prepended to the generated .html

--footerFile=<footerSourceFile>
	Path to the file with content to be appended to the generated .html

--pdfOptionsFile=<pdfOptionsFile>
	Path to the file with PDF generation options

--conrefFile=<conrefFile>
	Path to the file containing DITA-style variable definitions
```

## PDF Generation

For PDF file generation to succeed, [wkhtmltopdf](http://wkhtmltopdf.org/ "wkhtmltopdf home") must be installed and the path to its binary must be in the OS' PATH environment variable.  Note that on Windows the wkhtmltopdf arch (32-/64-bit) should match that of the node.js being used.

If ```--pdfOptionsFile``` is not specified then all default options will be used.  Custom options are specified in strict JSON format as the camel-cased equivalents of the options described in the [wkhtmltopdf options](http://wkhtmltopdf.org/usage/wkhtmltopdf.txt).  For an example see included file ```example/examplePDFoptions```.
