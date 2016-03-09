/*******************************************************************************
 * Copyright (c) 2014, 2016 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 * 
 * Contributors: IBM Corporation - initial API and implementation
 ******************************************************************************/

/*eslint-env node */
var fs = require("fs");
var path = require("path");
var jsYaml = require("js-yaml");
var markedIt = require("marked-it");
var common = require("./common");
var pdfGenerator = require("./pdfGenerator");

var DELIMITER_FRONTMATTER = /(?:^|\n)---\r?\n/g;
var DOCUMENT_TITLE_REGEX = /(?:^|\r\n|\r|\n)\s{0,3}#(?!#)([^\r\n]+)/;
var EXTENSION_DITAMAP = ".ditamap";
var EXTENSION_HTML = ".html";
var EXTENSION_HTML_REGEX = /\.html$/;
var EXTENSION_HTML_TOC = "TOC.html";
var EXTENSION_MARKDOWN = ".md";
var EXTENSION_PDF = ".pdf";
var EXTENSION_MARKDOWN_TOC = "TOC.md";
var EXTENSION_MARKDOWN_REGEX = /\.md$/gi;
var COPY_EXTENSIONS = [EXTENSION_HTML, EXTENSION_PDF, ".css", ".bmp", ".jpg", ".png", ".gif", ".svg", ".js", ".txt", ".xml", ".json"];

var TIMEOUT_PDF = 1000;
var pdfQueue = [];

function generate(options, logger) {
	var sourceDir = options.sourceDir;
	var destDir = options.destDir;
	var overwrite = options.overwrite;
	var disableAttributes = options.disableAttributes;
	var disableFrontMatter = options.disableFrontMatter;
	var disableTOC = options.disableTOC;
	var disablePDF = options.disablePDF;
	var pdfOptionsFile = options.pdfOptionsFile;
	var headerFile = options.headerFile;
	var footerFile = options.footerFile;
	var conrefFile = options.conrefFile;

	if (!fs.existsSync(sourceDir)) {
		logger.critical("Source directory does not exist: " + sourceDir);
		return;
	}

	if (!fs.existsSync(destDir)) {
		try {
			fs.mkdirSync(destDir);
		} catch (e) {
			logger.critical("Failed to create destination directory: " + destDir + "\n" + e.toString());
			return;	
		}
	}

	var fd = null;
	var headerText;
	if (headerFile) {
		try {
			fd = fs.openSync(headerFile, "r");
		} catch (e) {
			logger.error("Failed to open header file: " + headerFile + "\n" + e.toString());
		}

		if (fd) {
			headerText = common.readFile(fd);
			fs.close(fd);
		}
	}

	var footerText;
	if (footerFile) {
		fd = null;
		try {
			fd = fs.openSync(footerFile, "r");
		} catch (e) {
			logger.error("Failed to open footer file: " + footerFile + "\n" + e.toString());
		}
		
		if (fd) {
			footerText = common.readFile(fd);
			fs.close(fd);
		}
	}

	var pdfOptions;
	if (!disablePDF) {
		if (pdfOptionsFile) {
			fd = null;
			try {
				fd = fs.openSync(pdfOptionsFile, "r");
			} catch (e) {
				logger.warning("Failed to open pdf options file: " + pdfOptionsFile + ", will use default pdf generation options." + (e.code === "ENOENT" ? "" : "\n" + e.toString()));
			}
	
			if (fd) {
				try {
					var content = common.readFile(fd);
					pdfOptions = JSON.parse(content);
				} catch (e) {
					logger.warning("Failed to parse pdf options file: " + pdfOptionsFile + ", will use default pdf generation options.\n" + e.toString());
				}
				fs.close(fd);
			}
		}
	
		pdfOptions = pdfOptions || {};
	}

	var conrefMap;
	if (conrefFile) {
		fd = null;
		try {
			fd = fs.openSync(conrefFile, "r");
		} catch (e) {
			logger.warning("Failed to open conref file: " + conrefFile + "\n" + e.toString());
		}

		if (fd) {
			try {
				conrefMap = jsYaml.safeLoad(common.readFile(fd));
			} catch (e) {
				logger.warning("Failed to parse conref file: " + conrefFile + "\n" + e.toString());
			}
			fs.close(fd);
		}
	}

	function traverse_tree(source, destination) {
		var filenames = fs.readdirSync(source);
		for (var i = 0; i < filenames.length; i++) {
			var current = filenames[i];
			var sourcePath = path.join(source, current);
			try {
				var stat = fs.statSync(sourcePath);
			} catch (e) {
				logger.warning("Failed to stat: " + sourcePath + "\n" + e.toString());
				continue;
			}
			
			if (stat.isDirectory()) {
				var destPath = path.join(destination, current);
				try {
					fs.statSync(destPath);
				} catch (e) {
					fs.mkdir(destPath, function () {});
				}
				traverse_tree(sourcePath, destPath);
			} else {
				var outputFilename = current.replace(EXTENSION_MARKDOWN_REGEX, EXTENSION_HTML);
				var destinationPath = path.join(destination, outputFilename);
				var extension = path.extname(current).toLowerCase();
				if (extension === EXTENSION_MARKDOWN) {
					try {
						var readFd = fs.openSync(sourcePath, "r");
					} catch (e) {
						logger.error("Failed to open file: " + sourcePath + "\n" + e.toString());
						continue;
					}
					
					var fileText = common.readFile(readFd);
					fs.close(readFd);
					if (!fileText) {
						logger.error("Failed to read file: " + sourcePath);
						continue;
					}

					var frontMatterMap;
					if (!disableFrontMatter) {
						var frontMatterResult = extractFrontMatter(fileText);
						if (frontMatterResult) {
							/* YAML front matter was present */
							fileText = frontMatterResult.text;
							frontMatterMap = frontMatterResult.map;
						}
					}

					/* create additional variables based on content (currently just document.title) */
					var match = DOCUMENT_TITLE_REGEX.exec(fileText);
					if (match) {
						frontMatterMap = frontMatterMap || {};
						frontMatterMap.document = frontMatterMap.document || {};
						if (!frontMatterMap.document.title) {
							/* don't override a variable with the same key defined in the front matter */
							frontMatterMap.document.title = match[1].trim();
						}
					}

					fileText = replaceVariables(fileText, conrefMap, frontMatterMap);
	
					var options = {processAttributes: !disableAttributes};
					if (disableTOC) {
						options.generateDitamap = false;
						options.generateToc = false;
					} else {
						options.filename = outputFilename;
					}
					var result = markedIt.generate(fileText, options);
					if (!result.html) {
						logger.error("Failed converting markdown to HTML: " + sourcePath);
						continue;
					}
	
					var htmlOutput = "";
					if (headerText) {
						htmlOutput += replaceVariables(headerText, conrefMap, frontMatterMap);
					} else {
						htmlOutput += "<html>\n<body>\n";
					}
					htmlOutput += result.html.text;
					if (footerText) {
						htmlOutput += replaceVariables(footerText, conrefMap, frontMatterMap);
					} else {
						htmlOutput += "</body>\n</html>\n";
					}
	
					try {
						var writeHTMLFd = fs.openSync(destinationPath, overwrite ? "w" : "wx");
					} catch (e) {
						logger.error("Failed to open file to write: " + destinationPath + "\n" + e.toString());
						continue;
					}
					var success = common.writeFile(writeHTMLFd, new Buffer(htmlOutput));
					fs.close(writeHTMLFd);
					if (!success) {
						logger.error("*** Failed to write file: " + destinationPath);
						continue;
					}
					
					logger.info("Wrote: " + destinationPath);
	
					if (pdfOptions) {
						generatePDF(fs.realpathSync(destinationPath));
					}
	
					if (!disableTOC) {
						if (!result.mdToc) {
							continue;
						}
	
						var tocFilename = path.join(destination, current.replace(EXTENSION_MARKDOWN_REGEX, EXTENSION_MARKDOWN_TOC));
						try {
							var writeTOCFd = fs.openSync(tocFilename, overwrite ? "w" : "wx");
						} catch (e) {
							logger.error("Failed to open file to write: " + tocFilename + "\n" + e.toString());
							continue;
						}
	
						success = common.writeFile(writeTOCFd, new Buffer(result.mdToc.text));
						fs.close(writeTOCFd);
						if (!success) {
							logger.error("Failed to write: " + tocFilename);
							continue;
						}
	
						logger.info("Wrote: " + tocFilename);
	
						if (result.ditamap) {
							var ditamapFilename = path.join(destination, current.replace(EXTENSION_MARKDOWN_REGEX, EXTENSION_DITAMAP));
							try {
								var writeDitamapFd = fs.openSync(ditamapFilename, overwrite ? "w" : "wx");
							} catch (e) {
								logger.error("Failed to open file to write: " + ditamapFilename + "\n" + e.toString());
								continue;
							}
		
							success = common.writeFile(writeDitamapFd, new Buffer(result.ditamap.text));
							fs.close(writeDitamapFd);
							if (!success) {
								logger.error("Failed to write: " + ditamapFilename);
							} else {						
								var errors = result.ditamap.errors;
								if (errors) {
									var errorString = "{\n";
									errors.forEach(function(current) {
										errorString += "\t" + current + "\n";
									});
									errorString += "}";
									logger.warning("Wrote: " + ditamapFilename + " with the following errors:\n" + errorString);
								} else {
									logger.info("Wrote: " + ditamapFilename);
								}
							}
						}

						var htmlTOC = markedIt.generate(result.mdToc.text, options).html.text;
						if (!htmlTOC) {
							logger.error("Failed converting markdown TOC to html file: " + tocFilename);
							continue;
						}
	
						var htmlTOCFilename = path.join(destination, current.replace(EXTENSION_MARKDOWN_REGEX, EXTENSION_HTML_TOC));
						try {
							var writeHtmlTOCFd = fs.openSync(htmlTOCFilename, overwrite ? "w" : "wx");
						} catch (e) {
							logger.error("Failed to open file to write: " + htmlTOCFilename + "\n" + e.toString());
							continue;
						}
						
						success = common.writeFile(writeHtmlTOCFd, new Buffer(htmlTOC));
						fs.close(writeHtmlTOCFd);
						if (!success) {
							logger.error("Failed to write file: " + htmlTOCFilename);
						} else {
							logger.info("Wrote: " + htmlTOCFilename);
						}
					}
				} else if (COPY_EXTENSIONS.indexOf(extension) !== -1) {
					var readStream = fs.createReadStream(sourcePath);
					(function(readStream, sourcePath) {
						readStream.on("error", function(error) {
							logger.warning("Failed to read: " + sourcePath + "\n" + error.toString());
						});
					})(readStream, sourcePath);
					
					var writeStream = fs.createWriteStream(destinationPath);
					(function(writeStream, sourcePath, destinationPath) {
						writeStream.on("error", function(error) {
							logger.warning("Failed to write: " + destinationPath + "\n" + error.toString());
						});
						writeStream.on("close", function() {
							logger.info("Copied: " + sourcePath);
						});
					})(writeStream, sourcePath, destinationPath);
					
					readStream.pipe(writeStream);
				} else {
					logger.debug("Skipped: " + sourcePath);
				}
			}
		}
	}

	traverse_tree(sourceDir, destDir);
	done(pdfOptions, overwrite, logger);
}

function extractFrontMatter(text) {
    DELIMITER_FRONTMATTER.lastIndex = 0;
    var startMatch = DELIMITER_FRONTMATTER.exec(text);
    if (!(startMatch && startMatch.index === 0)) {
        return null; /* no valid start delimiter */
    }
    var endMatch = DELIMITER_FRONTMATTER.exec(text);
    if (!endMatch) {
        return null; /* no end delimiter */
    }
    var frontMatter = text.substring(startMatch[0].length, endMatch.index);
    var map = jsYaml.safeLoad(frontMatter);
    return {
        map: map,
        text: text.substring(endMatch.index + endMatch[0].length)
    }
}

function replaceVariables(text, siteDataMap, localMap) {
	if (!(siteDataMap || localMap)) {
		return text;
	}

	var VAR_OPEN = "{{";
	var VAR_CLOSE = "}}";
	var SITEDATA = "site.data.";
	
	var result = "";
	var pos = 0;

	var index = text.indexOf(VAR_OPEN);	
	while (index !== -1) {
		result += text.substring(pos, index);
		pos = index;

		var endIndex = text.indexOf(VAR_CLOSE, index + VAR_OPEN.length);
		if (endIndex === -1) {
			result += text.substring(pos);
			pos = text.length;
			break;
		}

		var key = text.substring(index + VAR_OPEN.length, endIndex).trim();
		var value = "";
		if (key.indexOf(SITEDATA) === 0) {
			if (siteDataMap) {
				key = key.substring(SITEDATA.length);
				value = key.split(".").reduce(
					function get(result, currentKey) {
						if (result) { /* result may be null if yaml content is invalid */
							return result[currentKey];
						}
					},
					siteDataMap);
			}
		} else {
			if (localMap) {
				value = key.split(".").reduce(
					function get(result, currentKey) {
						if (result) { /* result may be null if yaml content is invalid */
							return result[currentKey];
						}
					},
					localMap);
			}
		}

		if (value) {
			/*
			 * If a value was found then substitute it in-place in text rather than putting it right
			 * into result, in order to support variables that resolve to other variables.
			 */
			text = value + text.substring(endIndex + VAR_CLOSE.length);
			pos = 0;
			index = 0;
		} else {
			/*
			 * A value was not found, just treat it as plaintext that will be appended to result later.
			 */
			index = endIndex + VAR_CLOSE.length;
		}
		index = text.indexOf(VAR_OPEN, index);
	}
	result += text.substring(pos);
	return result;
}

/*
 * On Windows, wkHtmlToPdf can interfere with other concurrent file operations, including file operations running
 * in other instances of itself.  To mitigate this, queue all .pdf generation requests initially, and process them
 * at a defined interval after all other generation has completed.
 */

function generatePDF(htmlPath) {
	pdfQueue.push(htmlPath);
}

function done(pdfOptions, overwrite, logger) {
	var fn = function() {
		if (!pdfQueue.length) {
			return;
		}

		var htmlPath = pdfQueue.splice(0, 1)[0];
		var pdfPath = htmlPath.replace(EXTENSION_HTML_REGEX, EXTENSION_PDF);
		pdfGenerator.generate(htmlPath, pdfPath, overwrite, pdfOptions, logger);
		setTimeout(fn, TIMEOUT_PDF);
	};

	if (pdfQueue.length) {
		logger.important("Initiating .pdf file generation (goes a bit slower)...");
		var child_process = require('child_process');
		child_process.execFile("wkhtmltopdf", ["-V"], function(err) {
			if (err) {
				logger.error("Could not locate wkhtmltopdf, so PDFs are not being generated.\nThe path to its binary is likely not included in your native PATH environment variable.\n" + err.toString());	
			} else {
				setTimeout(fn, TIMEOUT_PDF);
			}
		});
	}
}

module.exports.generate = generate;
