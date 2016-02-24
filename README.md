# marked-it-cli

A command-line interface for [marked-it](https://github.com/grant-g/marked-it "marked-it Git repo").

## Install

``` bash
npm install marked-it-cli
```

## Usage

```bash
node marked-it-cli --sourceDir=<sourceDirectory> --destDir=<destinationDirectory> [OPTIONS]
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
	Path to file with content to be prepended to generated .html

--footerFile=<footerSourceFile>
	Path to file with content to be appended to generated .html

--pdfSettingsFile=<pdfSettingsFile>
	Path to file with PDF generation settings

--conrefFile=<conrefFile>
	Path to file containing DITA-style variable definitions
```
