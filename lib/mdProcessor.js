/**
 * marked-it-cli
 *
 * Copyright (c) 2014, 2017 IBM Corporation
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
 * LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/*eslint-env node */
var execSync = require("child_process").execSync;
var fse = require("fs-extra");
var path = require("path");
var jsYaml = require("js-yaml");
var pd = require("pretty-data").pd;
var beautify_html = require("js-beautify").html;
//var highlightJs = require("highlight.js");

var markedIt = require("marked-it-core");
var common = require("./cli-common");
var fileCopier = require("./fileCopier");
var pdfGenerator = require("./pdfGenerator");

var EXTENSION_HTML = ".html";
var EXTENSION_HTML_REGEX = /\.html$/;
var EXTENSION_MARKDOWN = ".md";
var EXTENSION_MARKDOWN_REGEX = /\.md$/gi;
var EXTENSION_PDF = ".pdf";
var FILENAME_TEMP = ".markeditcli-temp";
var FILENAME_TOC_ORDER = "toc";
var FILENAME_TOC_XML = "toc.xml";
var FOURSPACES = "    ";
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
	var tocDepth = options.tocDepth;
	var generatePdf = options.generatePdf;
	var pdfOptionsFile = options.pdfOptionsFile;
	var headerFile = options.headerFile;
	var footerFile = options.footerFile;
	var conrefFile = options.conrefFile;
	var extensionFiles = options.extensionFiles;

	var OPTIONS_MARKED = {
		tables: true,
		gfm: true,
		headerPrefix: "",
		xhtml: true,
		langPrefix: "lang-"
//		highlight: function(code, lang) {
//			if (!lang) {
//				return null;
//			}
//			try {
//				return highlightJs.highlight(lang, code).value;
//			} catch(e) {
//				logger.warning("Failed to syntax style a code block with language '" + lang + "'\n" + e.toString());
//				return null;
//			}
//		}
	};

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
	var addExtension = function(extensions, extensionObject) {
		var keys = Object.keys(extensionObject);
		keys.forEach(function(key) {
			if (typeof extensionObject[key] === "function" && key !== "init") {
				extensions[key] = extensions[key] || [];
				extensions[key].push(extensionObject[key]);
			} else if (typeof extensionObject[key] === "object") {
				extensions[key] = extensions[key] || {};
				addExtension(extensions[key], extensionObject[key]);
			}
		});
	};

	/* register standard extension that adds class "hljs" to all <code> blocks */
	addExtension(extensions, {html: {onCode: function(html, data) {
		var root = data.htmlToDom(html)[0];
		var code = data.domUtils.find(function(node) {return node.name && node.name.toLowerCase() === "code";}, [root], true, 1)[0];
		code.attribs["class"] = (code.attribs["class"] ? code.attribs["class"] + " " : "") + "hljs";
		return data.domToHtml(root);
	}}});

	/* read and register extensions from specified extension files */
	if (extensionFiles && extensionFiles.length) {
		extensionFiles.forEach(function(current) {
			try {
				var extensionPath = fse.realpathSync(current);
				var extensionObject = require(extensionPath);
				if (extensionObject.init && typeof extensionObject.init  === "function") {
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
		var tempDirPath = path.join(destination, FILENAME_TEMP);
		try {
			var stat = fse.statSync(tempDirPath);
			if (!stat.isDirectory()) {
				try {
					fse.removeSync(tempDirPath); /* file */
					fse.mkdirSync(tempDirPath); /* folder */
				} catch (e) {
					logger.warning("Failed to create: " + tempDirPath + "\n" + e.toString());
					// TODO what more to do now?  Abort for this dir?  Only if gen'ing toc files?
				}
			}
		} catch (e) {
			/* typical case, file/folder with this name doesn't exist, so create folder */
			try {
				fse.mkdirSync(tempDirPath);
			} catch (e) {
				logger.warning("Failed to create: " + tempDirPath + "\n" + e.toString());
				// TODO what more to do now?  Abort for this dir?  Only if gen'ing toc files?
			}
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
					fse.mkdirSync(destPath, function () {});
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
						tocDepth: tocDepth,
						filePath: outputFilename,
						extensions: extensions,
						markedOptions: OPTIONS_MARKED
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
							source: fileText,
							sourcePath: sourcePath
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
							success = common.writeFile(writeTempTOCFd, new Buffer(content));
							fse.closeSync(writeTempTOCFd);
							if (!success) {
								logger.error("*** Failed to write file: " + tempTOCpath);
							}
						} catch (e) {
							logger.error("Failed to open temp file to write: " + tempTOCpath + "\n" + e.toString());
						}
					}
					if (result.xmlToc && result.xmlToc.text) {
						writeTempTOCfile("." + FILENAME_TOC_XML, result.xmlToc.text)
					}

					/* output errors detected during html and TOC generation */
					if (result.html.errors) {
						result.html.errors.forEach(function(current) {
							logger.warning(current + " (" + sourcePath + ")");
						});
					}

					var tocErrors = result.xmlToc.errors;
					if (tocErrors) {
						tocErrors.forEach(function(current) {
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

	logger.important("Generating HTML files...");
	generateHTML(sourceDir, destDir);
	
	if (tocXML) {
		var tocXMLadapter = new markedIt.tocXMLadapter();

		var generateTOCs = function(source, destination) {
			
			/* recursively generate TOCs for child folders first */
			var filenames = fse.readdirSync(source);
			for (var i = 0; i < filenames.length; i++) {
				var filename = filenames[i];

				if (filename === FILENAME_TEMP) {
					/* never process the temp folder */
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
						stat = fse.statSync(destPath);
						if (stat.isDirectory()) {
							generateTOCs(sourcePath, destPath);		
						}
					} catch(e) {
						logger.warning("Excluded from toc generation because no corresponding destination folder found: " + sourcePath);
					}
				}
			}

			var tocFileLines = null; /* determines whether toc file(s) should be created for this folder */
			var tocOrderPath = path.join(source, FILENAME_TOC_ORDER);
			try {
				var stat = fse.statSync(tocOrderPath);
				if (stat.isFile()) {
					var readFd = fse.openSync(tocOrderPath, "r");
					tocFileLines = common.readFile(readFd).split("\n");
					fse.closeSync(readFd);
				}
			} catch(e) {
				/* this file is not present, which is fine, just continue */
				logger.info("No TOC ordering file found: " + tocOrderPath);
			}

			if (tocFileLines) {
				var generateTOC = function(adapter, tocFilename, xmlMode) {
					var blockAttributeRegex = /^(\{:(?:\\\}|[^\}])*\})/;
					var refNameRegex = /\{[ ]{0,3}:([^:]+):([^}]*)/;
					var attributeListContentRegex = /\{[ ]{0,3}:([^}]*)/;
					var attributeDefinitionLists = {};
					var eligibleAttributes = [];

					var rootElement = common.htmlToDom("<root></root>", {xmlMode: xmlMode})[0];
					var lastTocItem = rootElement;
					lastTocItem.level = 0;

					for (var i = 0; i < tocFileLines.length; i++) {
						var tocItem = tocFileLines[i].replace(/\t/g, FOURSPACES);
						var leadingSpaces = /^ */.exec(tocItem);
						tocItem = tocItem.trim();
						if (!tocItem.length) {
							eligibleAttributes = [];
							continue; /* blank line */
						}

						function processAttributeIfPresentInLine(line) {
							var attributeMatch = blockAttributeRegex.exec(line);
							if (!attributeMatch) {
								return false;
							}
							var refNameMatch = refNameRegex.exec(attributeMatch[0]);
							if (refNameMatch) {
								attributeDefinitionLists[refNameMatch[1]] = refNameMatch[2];
							} else {
								var blockAttributeMatch = attributeListContentRegex.exec(attributeMatch[0]);
								eligibleAttributes.push(blockAttributeMatch[1].trim());
							}
							return true;
						}

						if (processAttributeIfPresentInLine(tocItem)) {
							continue;
						}

						var level = (leadingSpaces[0].length / FOURSPACES.length) + 1;
						if (level - lastTocItem.level > 1) {
							eligibleAttributes = [];
							logger.warning("Excluded from toc files due to invalid nesting level: " + tocOrderPath + "#" + tocItem);
							continue;
						}
						
						/* gather attributes in subsequent lines*/
						for (var j = i + 1; j < tocFileLines.length; j++) {
							var nextItem = tocFileLines[j].trim();
							if (!processAttributeIfPresentInLine(nextItem)) {
								break;
							}
							i = j;		/* consuming this next line now */
						}

						var newTopics = null;

						// TODO this has moved out to an extension, remove it from here next time breaking changes are permitted
						var match = REGEX_LINK.exec(tocItem);
						if (match) {
							/* is a link to external content */
							newTopics = common.htmlToDom(adapter.createTopic(match[2], match[1]), {xmlMode: xmlMode})[0];
						}

						/* try to locate a corresponding folder or file */
						var entryFile = path.join(destination, tocItem);
						var exception = null;
						if (fse.existsSync(entryFile) && fse.statSync(entryFile).isDirectory()) {
							/* create toc links to corresponding TOC files */
							// TODO don't think this is valid for all TOC types, should be in the adapters
							newTopics = common.htmlToDom('<link toc="' + path.join(tocItem, tocFilename).replace(/[\\]/g, "/") + '"></link>\n', {xmlMode: xmlMode})[0];
						} else {
							var dirname = path.dirname(tocItem);
							var entryDestPath = path.join(destination, dirname);
							var entryTOCinfoPath = path.join(entryDestPath, FILENAME_TEMP);
							var basename = path.basename(tocItem);
							var tocInfoFile = path.join(entryTOCinfoPath, basename.replace(EXTENSION_MARKDOWN_REGEX, "." + tocFilename));
							try {
								var readFd = fse.openSync(tocInfoFile, "r");
								var result = common.readFile(readFd);
								fse.closeSync(readFd);

								/* adjust contained relative links */
								var root = common.htmlToDom(result, {xmlMode: xmlMode})[0];
								var elementsWithHref = common.domUtils.find(function(node) {return node.attribs && node.attribs.href;}, [root], true, Infinity);
								elementsWithHref.forEach(function(current) {
									current.attribs.href = path.join(dirname, current.attribs.href).replace(/[\\]/g, "/");
								});
								var children = common.domUtils.getChildren(root);
								if (children.length) {
									newTopics = children[0];
								}
							} catch (e) {
								/* this could be valid if the toc entry is not intended to correspond to a folder or file, so don't say anything yet */
								exception = e;
							}
						}

						var topicsString = "";
						var currentTopic = newTopics;
						while (currentTopic) {
							topicsString += common.domToHtml(currentTopic, {xmlMode: true}) + "\n";
							currentTopic = currentTopic.next;
						}

						var newTopicsString = common.invokeExtensions(
							extensions,
							"xml.toc.file.onGenerate",
							topicsString || tocItem,
							{
								source: tocItem,
								level: level,
								attributes: computeAttributes(eligibleAttributes, attributeDefinitionLists),
								htmlToDom: common.htmlToDom,
								domToHtml: common.domToHtml,
								domToInnerHtml: common.domToInnerHtml,
								domUtils: common.domUtils
							});
						if (topicsString !== newTopicsString) {
							newTopics = common.htmlToDom(newTopicsString, {xmlMode: true})[0];
						}

						if (newTopics) {
							/* determine the correct parent element */
							while (level - 1 < lastTocItem.level) {
								lastTocItem = common.domUtils.getParent(lastTocItem);
							}

							/* append the topic children */
							currentTopic = newTopics;
							while (currentTopic) {
								currentTopic.level = level;
								common.domUtils.appendChild(lastTocItem, currentTopic);
								lastTocItem = currentTopic;
								currentTopic = currentTopic.next;
							}
						} else {
							if (newTopicsString !== "") {
								var warningString = "Excluded from toc files: " + tocOrderPath + "#" + tocItem;
								if (exception) {
									warningString += ".  Possibly relevant, file exception when attempting to access it as a file: " + exception.toString();
								}
								logger.warning(warningString);
							}
						}

						eligibleAttributes = [];
					}
					
					return common.domToInnerHtml(rootElement, {xmlMode: true});
				};

				var writeTocFile = function(tocFilename, tocString, logger, extensionId) {
					tocString = common.invokeExtensions(
						extensions,
						extensionId,
						tocString,
						{
							variablesMap: conrefMap,
							replaceVariables: replaceVariables,
							htmlToDom: common.htmlToDom,
							domToHtml: common.domToHtml,
							domToInnerHtml: common.domToInnerHtml,
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
							var success = common.writeFile(writeTocFd, new Buffer(tocOutput));
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
				};

				if (tocXML) {
					var tocFilename = path.join(destination, FILENAME_TOC_XML);
					var tocContent = generateTOC(tocXMLadapter, FILENAME_TOC_XML, true);
					writeTocFile(tocFilename, tocContent, logger, "xml.toc.onComplete");
				}
			}
		};

		logger.important("Generating TOC files...");
		generateTOCs(sourceDir, destDir);
	}

	done(pdfOptions, overwrite, destDir, logger);
}

function cleanupTempDirs(dir, logger) {
	if (!fse.existsSync(dir)) {
		logger.warning("Expected folder does not exist: " + dir);
		return;
	}
	try {
		var stat = fse.statSync(dir);
		if (!stat.isDirectory()) {
			logger.warning("Expected folder is a file: " + dir);
			return;
		}
	} catch (e) {
		logger.warning("Failed to stat: " + dir);
		return;
	}

	var filenames = fse.readdirSync(dir);
	for (var i = 0; i < filenames.length; i++) {
		var filename = filenames[i];
		var filePath = path.join(dir, filename);
		try {
			stat = fse.statSync(filePath);
		} catch (e) {
			logger.warning("Failed to stat: " + filePath + "\n" + e.toString());
			continue;
		}

		if (stat.isDirectory()) {
			if (filename === FILENAME_TEMP) {
				fse.removeSync(filePath);
				logger.info("Cleaned up: " + filePath);
			} else {
				cleanupTempDirs(filePath, logger);
			}
		}
	}
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

function done(pdfOptions, overwrite, destDir, logger) {
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

		logger.important("Cleaning up temporary files...");
		cleanupTempDirs(destDir, logger);
	
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

// TODO this function is copied from htmlGenerator, should share it if possible
function computeAttributes(inlineAttributes, attributeDefinitionLists) {
	var keys;
	var result = {};
	var idRegex = /^#([\S]+)/;
	var classRegex = /^\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/;
	var attributeRegex = /^([^\/>"'=]+)=(['"])([^\2]+)\2/;
	var segmentRegex = /([^ \t'"]|((['"])(.(?!\3))*.\3))+/g;

	var inheritedAttributes = {}; /* from ADLs */
	var localAttributes = {}; /* from IALs */

	inlineAttributes.forEach(function(current) {
		var segmentMatch = segmentRegex.exec(current);
		while (segmentMatch) {
			segmentMatch = segmentMatch[0].trim();
			if (segmentMatch.length) {
				var match = idRegex.exec(segmentMatch);
				if (match) {
					localAttributes.id = match[1];
				} else {
					match = classRegex.exec(segmentMatch);
					if (match) {
						var classes = localAttributes["class"] || "";
						classes += (classes ? " " : "") + match[1];
						localAttributes["class"] = classes;
					} else {
						match = attributeRegex.exec(segmentMatch);
						if (match) {
							localAttributes[match[1]] = match[3];
						} else {
							if (attributeDefinitionLists[segmentMatch]) {
								var attributes = computeAttributes([attributeDefinitionLists[segmentMatch]], attributeDefinitionLists);
								keys = Object.keys(attributes);
								keys.forEach(function(key) {
									if (key === "class" && inheritedAttributes[key]) {
										/* merge conflicting class values rather than overwriting */
										inheritedAttributes[key] += " " + attributes[key];
									} else {
										inheritedAttributes[key] = attributes[key];
									}
								});
							} else {
								/* an attribute without a value */
								localAttributes[segmentMatch] = null;
							}
						}
					}
				}
			}
			segmentMatch = segmentRegex.exec(current);
		}
	});

	/* add inherited attributes first so that locally-defined attributes will overwrite inherited ones when a name conflict occurs */

	keys = Object.keys(inheritedAttributes);
	keys.forEach(function(key) {
		result[key] = inheritedAttributes[key];
	});

	keys = Object.keys(localAttributes);
	keys.forEach(function(key) {
		if (key === "class") {
			/* merge conflicting class values rather than overwriting */
			result[key] = (result[key] || "") + (result[key] ? " " : "")  + localAttributes[key];
		} else {
			result[key] = localAttributes[key];
		}
	});

	return result;
}

module.exports.generate = generate;
