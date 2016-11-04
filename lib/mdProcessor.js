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
var mkdirp = require("mkdirp");
var markedIt = require("marked-it");
var common = require("./cli-common");
var fileCopier = require("./fileCopier");
var pdfGenerator = require("./pdfGenerator");
var pd = require('pretty-data').pd;

var EXTENSION_HTML = ".html";
var EXTENSION_HTML_REGEX = /\.html$/;
var EXTENSION_MARKDOWN = ".md";
var EXTENSION_PDF = ".pdf";
var EXTENSION_MARKDOWN_REGEX = /\.md$/gi;
var FILENAME_TOC_ORDER = "toc";
var FILENAME_TOC_XML = "toc.xml";
var FILENAME_TOC_HTML = "toc.html";
var FILENAME_TOC_DITA = "toc.ditamap";
var COPY_EXTENSIONS = [EXTENSION_HTML, EXTENSION_PDF, ".css", ".bmp", ".jpg", ".png", ".gif", ".svg", ".js", ".txt", ".xml", ".json"];

var TIMEOUT_PDF = 1000;
var pdfQueue = [];

function generate(options, logger) {
	var sourceDir = options.sourceDir;
	var destDir = options.destDir;
	var overwrite = options.overwrite;
	var disableAttributes = options.disableAttributes;
	var disableFrontMatter = options.disableFrontMatter;
	var tocXML = options.tocXML;
	var tocDITA = options.tocDITA;
	var tocHTML = options.tocHTML;
	var tocDepth = options.tocDepth;
	var generatePdf = options.generatePdf;
	var pdfOptionsFile = options.pdfOptionsFile;
	var headerFile = options.headerFile;
	var footerFile = options.footerFile;
	var conrefFile = options.conrefFile;
	var generateToc = tocXML || tocDITA || tocHTML;

	if (!fs.existsSync(sourceDir)) {
		logger.critical("Source directory does not exist: " + sourceDir);
		return;
	}

	if (!fs.existsSync(destDir)) {
		try {
			mkdirp.sync(destDir, 0755);
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
			fs.closeSync(fd);
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
			fs.closeSync(fd);
		}
	}

	var pdfOptions;
	if (generatePdf) {
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
				fs.closeSync(fd);
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
				conrefMap = {site: {data: jsYaml.safeLoad(common.readFile(fd))}};
			} catch (e) {
				logger.warning("Failed to parse conref file: " + conrefFile + "\n" + e.toString());
			}
			fs.closeSync(fd);
		}
	}

	function traverse_tree(source, destination) {
		var tocOrder = null; /* determines whether toc file(s) should be created for this folder */
		var xmlTocs = [], htmlTocs = [], ditaTocs = [];

		if (generateToc) {
			/* first look for a toc file in this directory */
			var tocOrderPath = path.join(source, FILENAME_TOC_ORDER);
			try {
				var stat = fs.statSync(tocOrderPath);
				if (stat.isFile()) {
					var readFd = fs.openSync(tocOrderPath, "r");
					tocOrder = common.readFile(readFd).split("\n");
					fs.closeSync(readFd);
				}
			} catch (e) {
				/* this file is not present, which is fine, just continue */
				logger.info("No TOC ordering file found: " + tocOrderPath);
			}
		}

		var filenames = fs.readdirSync(source);
		for (var i = 0; i < filenames.length; i++) {
			var current = filenames[i];
			var sourcePath = path.join(source, current);
			try {
				stat = fs.statSync(sourcePath);
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
				
				if (tocOrder) {
					function addLink(tocsArray, tocFilename) {
						var childTocPath = path.join(destPath, tocFilename);
						try {
							stat = fs.statSync(childTocPath);
							if (stat.isFile()) {
								var outputPath = path.join(current, tocFilename);
								var linkElementText = '<toc><link href="' + outputPath + '"></link></toc>\n';
								var index = tocOrder.indexOf(current);
								if (index !== -1) {
									tocsArray[index] = linkElementText;
								} else {
									logger.warning("Excluded link to " + tocFilename + " because not present in the parent's toc file: " + childTocPath);
								}
							}
						} catch (e) {
							/* a toc was not written in the subfolder, so nothing to link to */
						}
					}

					addLink(xmlTocs, FILENAME_TOC_XML);
					/* addLink(htmlTocs, FILENAME_TOC_HTML); */ // TODO toc.html links?
					addLink(ditaTocs, FILENAME_TOC_DITA);				
				}
			} else {
				if (current === FILENAME_TOC_ORDER) {
					continue; 	/* already handled separately above */
				}

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
					fs.closeSync(readFd);
					if (!fileText) {
						logger.error("Failed to read file: " + sourcePath);
						continue;
					}
	
					var options = {
						processAttributes: !disableAttributes,
						processFrontMatter: !disableFrontMatter,
						conrefMap: conrefMap,
						tocXML: tocXML,
						tocDITA: tocDITA,
						tocHTML: tocHTML,
						tocDepth: tocDepth,
						filePath: outputFilename
					};
					var result = markedIt.generate(fileText, options);
					if (!result.html) {
						logger.error("Failed converting markdown to HTML: " + sourcePath);
						continue;
					}

					/* create additional variables based on document attributes */
					var frontMatterMap = result.properties.document.frontMatterMap || {};
					var title = result.properties.document.title;
					if (title) {
						frontMatterMap.document = frontMatterMap.document || {};

						/* don't override a variable with the same key defined in the front matter */
						frontMatterMap.document.title = frontMatterMap.document.title || title;
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
					htmlOutput = pd.xml(htmlOutput);
					var success = common.writeFile(writeHTMLFd, new Buffer(htmlOutput));
					fs.closeSync(writeHTMLFd);
					if (!success) {
						logger.error("*** Failed to write file: " + destinationPath);
						continue;
					}

					logger.info("Wrote: " + destinationPath);
	
					if (pdfOptions) {
						generatePDF(fs.realpathSync(destinationPath));
					}

					if (tocOrder) {
						index = tocOrder.indexOf(current);
						if (index !== -1) {
							if (result.xmlToc) {
								xmlTocs[index] = result.xmlToc.text;
							}
							if (result.htmlToc) {
								htmlTocs[index] = result.htmlToc.text;
							}
							if (result.ditaToc) {
								ditaTocs[index] = result.ditaToc.text;
							}
						} else {
							logger.warning("Excluded from toc files because not present in toc file: " + destinationPath);
						}
					}
					
					/* output errors detected while traversing the document headers */
					var errors = (result.xmlToc || result.htmlToc || result.ditaToc).errors;
					if (errors) {
						errors.forEach(function(current) {
							logger.warning(current);
						});
					}
				} else if (COPY_EXTENSIONS.indexOf(extension) !== -1) {
					fileCopier.copyFile(sourcePath, destinationPath, logger);
				} else {
					logger.debug("Skipped: " + sourcePath);
				}
			}
		}

		if (tocOrder) {
			var writeTocFile = function(filename, rootElement, tocs, xmlMode) {
				if (tocs.length) {
					tocs.forEach(function(current) {
						if (current) {
							var currentDom = common.htmlToDom(current, {xmlMode: xmlMode});
							var children = common.domUtils.getChildren(currentDom);
							if (children) {
								children.forEach(function(child) {
									common.domUtils.appendChild(rootElement, child);
								});
							}
						}
					});
					var tocString = common.domToHtml(rootElement, {xmlMode: xmlMode});

					var canWriteToc = true;
					try {
						stat = fs.statSync(filename);
						/* there's already a colliding file, so be careful */
						canWriteToc = overwrite && stat.isFile();
					} catch (e) {
						/* this is the most typical outcome, there is not a colliding file, so it's fine to proceed */
					}

					if (canWriteToc) {
						try {
							var writeTocFd = fs.openSync(filename, overwrite ? "w" : "wx");
							var tocOutput = pd.xml(tocString);
							success = common.writeFile(writeTocFd, new Buffer(tocOutput));
							fs.closeSync(writeTocFd);
							if (!success) {
								logger.error("Failed to write: " + filename);
							} else {
								logger.info("Wrote: " + filename);
							}
						} catch (e) {
							logger.error("Failed to open file to write: " + filename + "\n" + e.toString());
						}
					} else {
						logger.warning("Skipped writing toc file due to a file collision: " + filename);
					}
				} else {
					logger.warning("Skipped writing toc file because no files in the directory are included: " + filename);
				}
			}

			if (tocXML) {
				var tocFilename = path.join(destination, FILENAME_TOC_XML);
				writeTocFile(tocFilename, common.htmlToDom("<toc></toc>\n"), xmlTocs, true, logger);
			}
			if (tocHTML) {
				tocFilename = path.join(destination, FILENAME_TOC_HTML);
				writeTocFile(tocFilename, common.htmlToDom("<html></html>\n"), htmlTocs, false, logger);
			}
			if (tocDITA) {
				tocFilename = path.join(destination, FILENAME_TOC_DITA);
				writeTocFile(tocFilename, common.htmlToDom("<map></map>\n"), ditaTocs, true, logger);
			}
		}
	}

	traverse_tree(sourceDir, destDir);
	done(pdfOptions, overwrite, logger);
}

function replaceVariables(text, conrefMap, localMap) {
	if (!(conrefMap || localMap)) {
		return text;
	}

	var VAR_OPEN = "{{";
	var VAR_CLOSE = "}}";
	
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
		
		/* if a key is defined both locally and in the conrefs then the local definition wins */
		if (conrefMap) {
			value = key.split(".").reduce(
				function get(result, currentKey) {
					if (result) { /* result may be null if yaml content is invalid */
						return result[currentKey];
					}
				},
				conrefMap);
		}
		if (localMap) {
			var temp = key.split(".").reduce(
				function get(result, currentKey) {
					if (result) { /* result may be null if yaml content is invalid */
						return result[currentKey];
					}
				},
				localMap);
			if (temp) {
				value = temp;
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
	fileCopier.cleanup(function() {
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
	});
}

module.exports.generate = generate;
