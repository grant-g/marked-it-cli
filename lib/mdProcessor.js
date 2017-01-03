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
var execSync = require('child_process').execSync;
var fse = require("fs-extra");
var path = require("path");
var jsYaml = require("js-yaml");
var mkdirp = require("mkdirp");
var pd = require('pretty-data').pd;
var beautify_html = require('js-beautify').html;

var markedIt = require("marked-it");
var common = require("./cli-common");
var fileCopier = require("./fileCopier");
var pdfGenerator = require("./pdfGenerator");

var EXTENSION_HTML = ".html";
var EXTENSION_HTML_REGEX = /\.html$/;
var EXTENSION_MARKDOWN = ".md";
var EXTENSION_MARKDOWN_REGEX = /\.md$/gi;
var EXTENSION_PDF = ".pdf";
var EXTENSION_TOC_DITA = ".toc.ditamap";
var EXTENSION_TOC_HTML = ".toc.html";
var EXTENSION_TOC_XML = ".toc.xml";
var FILENAME_TEMP = ".markeditcli-temp";
var FILENAME_TOC_ORDER = "toc";
var FILENAME_TOC_XML = "toc.xml";
var FILENAME_TOC_HTML = "toc.html";
var FILENAME_TOC_DITA = "toc.ditamap";
var COPY_EXTENSIONS = [EXTENSION_HTML, EXTENSION_PDF, ".css", ".bmp", ".jpg", ".png", ".gif", ".svg", ".js", ".txt", ".xml", ".json"];

/* the following regex is sourced from marked: https://github.com/chjj/marked */
var REGEX_LINK = /^!?\[((?:\[[^\]]*\]|[^\[\]]|\](?=[^\[]*\]))*)\]\(\s*<?([\s\S]*?)>?(?:\s+['"]([\s\S]*?)['"])?\s*\)/;

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
	var extensionFiles = options.extensionFiles;
	var generateToc = tocXML || tocDITA || tocHTML;

	if (!fse.existsSync(sourceDir)) {
		logger.critical("Source directory does not exist: " + sourceDir);
		return;
	}

	if (!fse.existsSync(destDir)) {
		try {
			fse.mkdirsSync(destDir);
		} catch (e) {
			logger.critical("Failed to create destination directory: " + destDir + "\n" + e.toString());
			return;	
		}
	}

	var fd = null;
	var headerText;
	if (headerFile) {
		try {
			fd = fse.openSync(headerFile, "r");
		} catch (e) {
			logger.error("Failed to open header file: " + headerFile + "\n" + e.toString());
		}

		if (fd) {
			headerText = common.readFile(fd);
			fse.closeSync(fd);
		}
	}

	var footerText;
	if (footerFile) {
		fd = null;
		try {
			fd = fse.openSync(footerFile, "r");
		} catch (e) {
			logger.error("Failed to open footer file: " + footerFile + "\n" + e.toString());
		}
		
		if (fd) {
			footerText = common.readFile(fd);
			fse.closeSync(fd);
		}
	}

	var pdfOptions;
	if (generatePdf) {
		if (pdfOptionsFile) {
			fd = null;
			try {
				fd = fse.openSync(pdfOptionsFile, "r");
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
				fse.closeSync(fd);
			}
		}
	
		pdfOptions = pdfOptions || {};
	}

	var conrefMap;
	if (conrefFile) {
		fd = null;
		try {
			fd = fse.openSync(conrefFile, "r");
		} catch (e) {
			logger.warning("Failed to open conref file: " + conrefFile + "\n" + e.toString());
		}

		if (fd) {
			try {
				conrefMap = {site: {data: jsYaml.safeLoad(common.readFile(fd))}};
			} catch (e) {
				logger.warning("Failed to parse conref file: " + conrefFile + "\n" + e.toString());
			}
			fse.closeSync(fd);
		}
	}

	var extensions = {};
	if (extensionFiles && extensionFiles.length) {
		var addExtension = function(extensions, extensionObject) {
			var keys = Object.keys(extensionObject);
			keys.forEach(function(key) {
				if (typeof(extensionObject[key]) === "function" && key !== "init") {
					extensions[key] = extensions[key] || [];
					extensions[key].push(extensionObject[key]);
				} else if (typeof(extensionObject[key]) === "object") {
					extensions[key] = extensions[key] || {};
					addExtension(extensions[key], extensionObject[key]);
				}
			});
		}

		extensionFiles.forEach(function(current) {
			try {
				var extensionPath = fse.realpathSync(current);
				var extensionObject = require(extensionPath);
				if (extensionObject.init && typeof(extensionObject.init) === "function") {
					var initData = {
						readFile: common.readFile,
						logger: logger.createChild(extensionObject.id)
					};
					extensionObject.init(initData);
				}
				addExtension(extensions, extensionObject);
			} catch(e) {
				logger.warning("Failed to read extension " + current + "\n" + e.toString());
			}
		});
	}

	var generateHTML = function(source, destination) {
		
		/* remove the temp dir from the previous run (if present) and create a new one for this run */
		var tempDirPath = path.join(destination, FILENAME_TEMP);
		try {
			fse.removeSync(fse.realpathSync(tempDirPath));
		} catch (e) {
			if (e.code !== "ENOENT") {
				/* the path exists, fall back to attempting to delete every file within it */
				var filenames = fse.readdirSync(tempDirPath);
				for (var i = 0; i < filenames.length; i++) {
					var sourcePath = path.join(tempDirPath, filenames[i]);
					try {
						fse.unlinkSync(sourcePath);
					} catch (e2) {
						/*
						 * Failed to delete at least one of the individual files, so this folder will
						 * potentially contain stale TOC data if allowed to proceed.
						 */
						logger.warning("Failed to clear: " + tempDirPath + "\n" + e.toString());
						// TODO what more to do?  Abort for this dir?  Only if gen'ing toc files?
					}
				}
			}
		}
		try {
			fse.mkdirSync(tempDirPath);
		} catch (e) {
			logger.warning("Failed to create: " + tempDirPath + "\n" + e.toString());
			// TODO more to do
		}

		var filenames = fse.readdirSync(source);
		for (var i = 0; i < filenames.length; i++) {
			var filename = filenames[i];

			if (filename === FILENAME_TEMP) {
				/*
				 * Presumably source and destination are pointing at the same place,
				 * which is valid.  Never process a folder/file with this name.
				 */
				continue;
			}

			var sourcePath = path.join(source, filename);
			try {
				stat = fse.statSync(sourcePath);
			} catch (e) {
				logger.warning("Failed to stat: " + sourcePath + "\n" + e.toString());
				continue;
			}

			if (stat.isDirectory()) {
				var destPath = path.join(destination, filename);
				try {
					fse.statSync(destPath);
				} catch (e) {
					fse.mkdir(destPath, function () {});
				}
				generateHTML(sourcePath, destPath);
			} else {
				if (filename === FILENAME_TOC_ORDER) {
					continue; 	/* already handled separately above */
				}

				var outputFilename = filename.replace(EXTENSION_MARKDOWN_REGEX, EXTENSION_HTML);
				var destinationPath = path.join(destination, outputFilename);
				var extension = path.extname(filename).toLowerCase();
				if (extension === EXTENSION_MARKDOWN) {
					try {
						var readFd = fse.openSync(sourcePath, "r");
					} catch (e) {
						logger.error("Failed to open file: " + sourcePath + "\n" + e.toString());
						continue;
					}
					
					var fileText = common.readFile(readFd);
					fse.closeSync(readFd);
					if (!fileText) {
						logger.error("Failed to read file: " + sourcePath);
						continue;
					}
	
					var options = {
						processAttributes: !disableAttributes,
						processFrontMatter: !disableFrontMatter,
						variablesMap: conrefMap,
						tocXML: true,
						tocDITA: true,
						tocHTML: true,
						tocDepth: tocDepth,
						filePath: outputFilename,
						extensions: extensions
					};
					var result = markedIt.generate(fileText, options);
					if (!result.html) {
						logger.error("Failed converting markdown to HTML: " + sourcePath);
						continue;
					}

					result.html.text = common.invokeExtensions(
						extensions,
						"html.onComplete",
						result.html.text,
						{
							title: result.properties.document.title || "",
							frontMatterMap: result.properties.document.frontMatterMap || {},
							variablesMap: conrefMap,
							replaceVariables: replaceVariables,
							source: fileText
						});

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
					}
					htmlOutput += result.html.text;
					if (footerText) {
						htmlOutput += replaceVariables(footerText, conrefMap, frontMatterMap);
					}

					/* temporary hacks */
					if (!/<body[>\s]/.test(htmlOutput)) {
						htmlOutput = "<body>" + htmlOutput;
					}
					if (!/<html[>\s]/.test(htmlOutput)) {
						htmlOutput = "<html>" + htmlOutput;
					}
					if (!/<\/body>/.test(htmlOutput)) {
						htmlOutput += "</body>";
					}
					if (!/<\/html>/.test(htmlOutput)) {
						htmlOutput += "</html>";
					}

					try {
						var writeHTMLFd = fse.openSync(destinationPath, overwrite ? "w" : "wx");
					} catch (e) {
						logger.error("Failed to open file to write: " + destinationPath + "\n" + e.toString());
						continue;
					}
					htmlOutput = beautify_html(htmlOutput, {"indent_size": 2, "extra_liners": ["body"]});
					var success = common.writeFile(writeHTMLFd, new Buffer(htmlOutput));
					fse.closeSync(writeHTMLFd);
					if (!success) {
						logger.error("*** Failed to write file: " + destinationPath);
						continue;
					}

					logger.info("Wrote: " + destinationPath);
	
					if (pdfOptions) {
						generatePDF(fse.realpathSync(destinationPath));
					}
					
					/* write the file TOCs to temp files for later reference */
					var writeTempTOCfile = function(extension, content) {
						var tempTOCfilename = filename.replace(EXTENSION_MARKDOWN_REGEX, extension);
						var tempTOCpath = path.join(tempDirPath, tempTOCfilename);
						try {
							var writeTempTOCFd = fse.openSync(tempTOCpath, "w");
							var success = common.writeFile(writeTempTOCFd, new Buffer(content));
							fse.closeSync(writeTempTOCFd);
							if (!success) {
								logger.error("*** Failed to write file: " + tempTOCpath);
							}
						} catch (e) {
							logger.error("Failed to open temp file to write: " + tempTOCpath + "\n" + e.toString());
						}
					}
					if (result.xmlToc && result.xmlToc.text) {
						writeTempTOCfile(EXTENSION_TOC_XML, result.xmlToc.text)
					}
					if (result.ditaToc && result.ditaToc.text) {
						writeTempTOCfile(EXTENSION_TOC_DITA, result.ditaToc.text)
					}
					if (result.htmlToc && result.htmlToc.text) {
						writeTempTOCfile(EXTENSION_TOC_HTML, result.htmlToc.text)
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
	}

	logger.info("Generating HTML files...");
	generateHTML(sourceDir, destDir);
	
	if (tocXML || tocDITA || tocXML) {
		var tocXMLadapter = new markedIt.tocXMLadapter();
		var tocDITAadapter = new markedIt.tocDITAadapter();
		var tocHTMLadapter = new markedIt.tocHTMLadapter();

		var generateTOCs = function(source, destination) {
			
			/* recursively generate TOCs for child folders first */
			var filenames = fse.readdirSync(source);
			for (var i = 0; i < filenames.length; i++) {
				var filename = filenames[i];
				var sourcePath = path.join(source, filename);
				try {
					stat = fse.statSync(sourcePath);
				} catch (e) {
					logger.warning("Failed to stat: " + sourcePath + "\n" + e.toString());
					continue;
				}
				
				if (stat.isDirectory()) {
					var destPath = path.join(destination, filename);
					try {
						stat = fse.statSync(destPath);
						if (stat.isDirectory()) {
							generateTOCs(sourcePath, destPath);		
						}
					} catch(e) {
						logger.warning("Excluded from toc generation because no corresponding destination folder found: " + sourcePath);
					}
				}
			}

			var tocOrder = null; /* determines whether toc file(s) should be created for this folder */
			var tocOrderPath = path.join(source, FILENAME_TOC_ORDER);
			try {
				var stat = fse.statSync(tocOrderPath);
				if (stat.isFile()) {
					var readFd = fse.openSync(tocOrderPath, "r");
					tocOrder = common.readFile(readFd).split("\n");
					fse.closeSync(readFd);
				}
			} catch(e) {
				/* this file is not present, which is fine, just continue */
				logger.info("No TOC ordering file found: " + tocOrderPath);
			}

			if (tocOrder) {
				var xmlTocs = [], ditaTocs = [], htmlTocs = [];
				for (var i = 0; i < tocOrder.length; i++) {
					tocOrder[i] = tocOrder[i].trim();
					if (tocOrder[i].length) {
						var match = REGEX_LINK.exec(tocOrder[i]);
						if (match) {
							/* is a link to external content */
							xmlTocs[i] = tocXMLadapter.createTopic(match[2], match[1]);
							ditaTocs[i] = tocDITAadapter.createTopic(match[2], match[1]);
							htmlTocs[i] = tocHTMLadapter.createTopic(match[2], match[1]);
						} else {
							/* presumably refers to a local folder or file */
							var entryFile = path.join(destination, tocOrder[i]);
							if (fse.existsSync(entryFile) && fse.statSync(entryFile).isDirectory()) {
								/* create toc links to corresponding TOC files */
								// TODO don't think these are valid for HTML TOC, not sure about DITA TOC, what should they be?
								xmlTocs[i] = '<link toc="' + path.join(tocOrder[i], FILENAME_TOC_XML) + '"></link>\n';
								ditaTocs[i] = '<link toc="' + path.join(tocOrder[i], FILENAME_TOC_DITA) + '"></link>\n';
								htmlTocs[i] = '<link toc="' + path.join(tocOrder[i], FILENAME_TOC_HTML) + '"></link>\n';
							} else {
								var readTocInfo = function(extension) {
									var dirname = path.dirname(tocOrder[i]);
									var entryDestPath = path.join(destination, dirname);
									var entryTOCinfoPath = path.join(entryDestPath, FILENAME_TEMP);
									var basename = path.basename(tocOrder[i]);
									var tocInfoFile = path.join(entryTOCinfoPath, basename.replace(EXTENSION_MARKDOWN_REGEX, extension));
									try {
										var readFd = fse.openSync(tocInfoFile, "r");
										var result = common.readFile(readFd);
										fse.closeSync(readFd);

										/* adjust contained relative links */
										var root = common.htmlToDom(result, {xmlMode: true});
										var elementsWithHref = common.domUtils.find(function(node) {return node.attribs && node.attribs.href;}, [root], true, Infinity);
										elementsWithHref.forEach(function(current) {
											current.attribs.href = path.join(dirname, current.attribs.href);
										});

										/* return the children of the root */
										return common.domToHtml(common.domUtils.getChildren(root), {xmlMode: true});
									} catch (e) {
										logger.warning("Excluded from toc files because TOC info not present in destination: " + tocOrderPath + "#" + tocOrder[i]);
										return null;
									}
								}
								if (tocXML) {
									xmlTocs[i] = readTocInfo(EXTENSION_TOC_XML);
								}
								if (tocDITA) {
									ditaTocs[i] = readTocInfo(EXTENSION_TOC_DITA);
								}
								if (tocHTML) {
									htmlTocs[i] = readTocInfo(EXTENSION_TOC_HTML);
								}
							}
						}
					}
				}

				var writeTocFile = function(tocFilename, rootElement, tocs, xmlMode, logger, extensionId) {
					if (tocs.length) {
						tocs.forEach(function(current) {
							if (current) {
								common.domUtils.appendChild(rootElement, common.htmlToDom(current, {xmlMode: xmlMode}));
							}
						});
						var tocString = common.domToHtml(rootElement, {xmlMode: xmlMode});
						tocString = common.invokeExtensions(
							extensions,
							extensionId,
							tocString,
							{
								variablesMap: conrefMap,
								replaceVariables: replaceVariables,
								htmlToDom: common.htmlToDom,
								domToHtml: common.domToHtml,
								domUtils: common.domUtils
							});
	
						var canWriteToc = true;
						try {
							stat = fse.statSync(tocFilename);
							/* there's already a colliding file, so be careful */
							canWriteToc = overwrite && stat.isFile();
						} catch (e) {
							/* this is the most typical outcome, there is not a colliding file, so it's fine to proceed */
						}
	
						if (canWriteToc) {
							try {
								var writeTocFd = fse.openSync(tocFilename, overwrite ? "w" : "wx");
								var tocOutput = pd.xml(tocString);
								success = common.writeFile(writeTocFd, new Buffer(tocOutput));
								fse.closeSync(writeTocFd);
								if (!success) {
									logger.error("Failed to write: " + tocFilename);
								} else {
									logger.info("Wrote: " + tocFilename);
								}
							} catch (e) {
								logger.error("Failed to open file to write: " + tocFilename + "\n" + e.toString());
							}
						} else {
							logger.warning("Skipped writing toc file due to a file collision: " + tocFilename);
						}
					} else {
						logger.warning("Skipped writing toc file because no files in the directory are included: " + tocFilename);
					}
				}
				if (tocXML) {
					var tocFilename = path.join(destination, FILENAME_TOC_XML);
					writeTocFile(tocFilename, common.htmlToDom("<toc></toc>\n"), xmlTocs, true, logger, "xml.toc.onComplete");
				}
				if (tocDITA) {
					tocFilename = path.join(destination, FILENAME_TOC_DITA);
					writeTocFile(tocFilename, common.htmlToDom("<map></map>\n"), ditaTocs, true, logger, "dita.toc.onComplete");
				}
				if (tocHTML) {
					tocFilename = path.join(destination, FILENAME_TOC_HTML);
					writeTocFile(tocFilename, common.htmlToDom("<html></html>\n"), htmlTocs, false, logger, "html.toc.onComplete");
				}
			}
		}

		logger.info("Generating TOC files...");
		generateTOCs(sourceDir, destDir);
	}

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
