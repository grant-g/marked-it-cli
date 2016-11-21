# marked-it-cli

A command-line interface for [marked-it](https://github.com/grant-g/marked-it "marked-it Git repo") that adds support for conref attributes, uniform headers/footers, and .pdf generation.

## Install

``` bash
npm install -g marked-it-cli
```

You may need to ```sudo``` the above command since it installs globally.

## Usage

```bash
marked-it-cli <sourceDirectory> --output=<destinationDirectory> [OPTIONS]
```

### Required Arguments
```
<sourceDirectory>
	The path of the directory containing source Markdown files.  Subdirectories will be recursed.
	
--output
	The path of the directory to write generated files to.  Directory structures from the source directory will be replicated here.
```

### options
```
--overwrite
	Overwrite output files that already exist
--disable-attributes
	Disable processing of Kramdown-style attribute lists
--disable-front-matter
	Disable processing of Jekyll-style front matter blocks
--toc-xml
	Generate a toc.xml file for directories containing a valid toc file
--toc-html
	Generate a toc.html file for directories containing a valid toc file
--toc-dita
	Generate a toc.ditamap file for directories containing a valid toc file
--toc-depth=<maxHeaderLevel>
	Set the maximum header level that will appear in toc files (default=3)
--verbose
	Output verbose details
--debug
	Output even more verbose details
--gen-pdf
	Generate .pdf files
--pdf-options-file=<pdfOptionsFile>
	Path to the file with PDF generation options
--header-file=<headerSourceFile>
	Path to the file with content to be prepended to the generated .html
--footer-file=<footerSourceFile>
	Path to the file with content to be appended to the generated .html
--conref-file=<conrefFile>
	Path to the file containing DITA-style variable definitions
```

## PDF Generation

For PDF file generation to succeed, [wkhtmltopdf](http://wkhtmltopdf.org/ "wkhtmltopdf home") must be installed and the path to its binary must be in the OS' PATH environment variable.  Note that on Windows the wkhtmltopdf arch (32-/64-bit) must match that of the node.js being used.

If ```--pdfOptionsFile``` is not specified then all default options will be used.  Custom options are specified in strict JSON format as the camel-cased equivalents of the options described in the [wkhtmltopdf options](http://wkhtmltopdf.org/usage/wkhtmltopdf.txt).  For an example see included file ```example/examplePDFoptions```.

## Example

The "examples" directory demonstrates the CLI's features.  To generate it use command:
```
node ./bin/marked-it-cli ./example --output=./exampleOutput --extension-file=./example/headerFooterExt.js --gen-pdf --pdf-options-file=./example/pdfOptions --conref-file=./example/conref.yml --toc-xml
```
