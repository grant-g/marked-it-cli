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

var FILENAME_HEADER = "header-xml";
var FILENAME_FOOTER = null;

var fse = require("fse");
var path = require("path");
var url = require("url");

var headerText, footerText;
var logger;

var NOTOC = "notoc";
var PREFIX_TOC = "toc-";
var COMMENT_MARKDOWN_NAVIGATION = "<!-- Markdown Navigation -->";

/* the following regex is sourced from marked: https://github.com/chjj/marked */
var REGEX_LINK = /^!?\[((?:\[[^\]]*\]|[^\[\]]|\](?=[^\[]*\]))*)\]\(\s*<?([\s\S]*?)>?(?:\s+['"]([\s\S]*?)['"])?\s*\)/;

var html = {};
var xml = {toc: {file: {}}};
var toc = {file: {}};

html.onHeading = function(html, data) {
	var heading = data.htmlToDom(html)[0];
	var changed = false;
	Object.keys(heading.attribs).forEach(function(key) {
		if (key.indexOf(PREFIX_TOC) === 0) {
			delete heading.attribs[key];
			changed = true;
		}
	});
	if (!changed) {
		return; /* nothing to do */
	}
	return data.domToHtml(heading);
};

xml.toc.onTopic = function(topic, data) {
	var heading = data.htmlToDom(data.heading)[0];
	var attributes = heading.attribs;
	if (attributes[NOTOC]) {
		return ""; /* do not generate a TOC entry for this header */
	}

	var topicDom = data.htmlToDom(topic)[0];
	var changed = false;
	Object.keys(attributes).forEach(function(key) {
		if (key.indexOf(PREFIX_TOC) === 0) {
			var name = key.substring(PREFIX_TOC.length);
			var property = data.htmlToDom("<property name='" + name + "' value='" + attributes[key] + "'>\n</property>\n")[0];
			data.domUtils.appendChild(topicDom, property);
			changed = true;
		}
	});

	if (!changed) {
		return; /* no change */
	}

	return data.domToHtml(topicDom, {xmlMode: true});
};

xml.toc.onComplete = function(xml, data) {
	if (!headerText && !footerText) {
		return; /* no change */
	}

	var result = "";
	if (headerText) {
		result += headerText;
	}
	result += xml;
	if (footerText) {
		result += footerText;
	}

	return result;
};

var navgroup;

xml.toc.file.onGenerate = function(xml, data) {
	var CLASS_TOC = "toc";
	var CLASS_NAVGROUP = "navgroup";
	var CLASS_NAVGROUP_END = "navgroup-end";
	var CLASS_TOPICGROUP = "topicgroup";
	var ATTRIBUTE_CLASS = "class";
	var ATTRIBUTE_ID = "id";

	var clearNavgroupAtEnd = false;

	if (xml === COMMENT_MARKDOWN_NAVIGATION) {
		return ""; /* explicitly want this to not go through into the generated TOC */
	}

	/* check for .navgroup attribute */
	var classes = data.attributes[ATTRIBUTE_CLASS];
	if (classes) {
		classes = classes.split(" ");
		for (var i = 0; i < classes.length; i++) {
			var className = classes[i].toLowerCase();
			if (className === CLASS_NAVGROUP) {
				classes.splice(i--, 1);
				if (navgroup) {
					logger.warning("Encountered new .navgroup before previous .navgroup '" + navgroup.id + "' was ended");
				} else {
					var id = data.attributes[ATTRIBUTE_ID];
					if (!id) {
						logger.warning("Encountered .navgroup without an 'id' attribute, on toc item: " + data.source);
					} else {
						navgroup = {id: id, level: data.level};
						delete data.attributes[ATTRIBUTE_ID];
					}
				}
			} else if (className === CLASS_NAVGROUP_END) {
				classes.splice(i--, 1);
				if (!navgroup) {
					logger.warning("Encountered .navgroup-end while not in a previous .navgroup, on toc item: " + data.source);
				}
				clearNavgroupAtEnd = true;
			}
		}
		data.attributes[ATTRIBUTE_CLASS] = classes.join(" ");
	}

	if (navgroup && data.level < navgroup.level) {
		logger.warning("Missing .navgroup-end for .navgroup '" + navgroup.id + "' (must be present and at the same indentation level)");
		navgroup = null;
	}

	var element;

	/* if injecting TOC from a .md file then replace all immediate children with <anchor>s */
	if (/\.md\s*$/.test(data.source)) {
		element = data.htmlToDom("<root></root>", {xmlMode: true})[0];
		var docRoots = data.htmlToDom(xml, {xmlMode: true});
		docRoots.forEach(function(docRoot) {
			data.domUtils.appendChild(element, docRoot);
			if (docRoot.name === "topic") {
				var children = data.domUtils.getChildren(docRoot);
				children.forEach(function(child) {
					if (child.attribs) {
						var anchorElement = data.htmlToDom('<property name="type" value="anchor" />', {xmlMode: true})[0];
						var childChildren = data.domUtils.getChildren(child);
						if (childChildren.length) {
							data.domUtils.prepend(childChildren[0], anchorElement);
						} else {
							data.domUtils.appendChild(child, anchorElement);
						}
					}
				});

				var keys = Object.keys(data.attributes);
				if (keys) {
					keys.forEach(function(key) {
						var propertyElement = data.htmlToDom('<property name="' + key + '" value="' + data.attributes[key] + '" />\n', {xmlMode: true})[0];
						var elementChildren = data.domUtils.getChildren(docRoot);
						if (elementChildren.length) {
							data.domUtils.prepend(elementChildren[0], propertyElement);
						} else {
							data.domUtils.appendChild(docRoot, propertyElement);
						}
					});
				}

				if (navgroup && data.level === navgroup.level) {
					var navgroupElement = data.htmlToDom('<property name="navgroup" value="' + navgroup.id + '" />', {xmlMode: true})[0];
					var elementChildren = data.domUtils.getChildren(docRoot);
					if (elementChildren.length) {
						data.domUtils.prepend(elementChildren[0], navgroupElement);
					} else {
						data.domUtils.appendChild(docRoot, navgroupElement);
					}
				}
			}
		});
		navgroup = clearNavgroupAtEnd ? null : navgroup;
		return data.domToInnerHtml(element, {xmlMode: true});
	}

	var match = REGEX_LINK.exec(data.source);
	if (match) {
		/* link to external content */
		element = data.htmlToDom('<topic href="' + match[2] + '" label="' + match[1] + '" />', {xmlMode: true})[0];
	} else {
		/* check for custom elements this extension knows how to generate */
		var classes = data.attributes[ATTRIBUTE_CLASS];
		if (classes) {
			classes = classes.split(" ");
			for (var i = 0; i < classes.length; i++) {
				var current = classes[i].toLowerCase();
				if (current === CLASS_TOC) {
					var propertiesString = "";
					var keys = Object.keys(data.attributes);
					keys.forEach(function(key) {
						if (key.toLowerCase() !== ATTRIBUTE_CLASS) {
							propertiesString += '<property name="' + key + '" value="' + data.attributes[key] + '" />\n';
						}			
					});
					element = data.htmlToDom('<toc label="' + data.source + '">\n' + propertiesString + '</toc>', {xmlMode: true})[0];
					break;
				}
				if (current === CLASS_TOPICGROUP) {
					element = data.htmlToDom('<topic label="' + data.source + '"><property name="topicgroup" value="' + data.source + '" /></topic>', {xmlMode: true})[0];
					break;
				}
			}
		}
	}

	if (element && navgroup && data.level === navgroup.level) {
		var navgroupElement = data.htmlToDom('<property name="navgroup" value="' + navgroup.id + '" />', {xmlMode: true})[0];
		var elementChildren = data.domUtils.getChildren(element);
		if (elementChildren.length) {
			data.domUtils.prepend(elementChildren[0], navgroupElement);
		} else {
			data.domUtils.appendChild(element, navgroupElement);
		}
	}

	navgroup = clearNavgroupAtEnd ? null : navgroup;
	return element ? data.domToHtml(element, {xmlMode: true}) : null;
};

var init = function(data) {
	logger = data.logger;
	if (FILENAME_HEADER) {
		var headerPath = path.join(__dirname, FILENAME_HEADER);
		try {
			var fd = fse.openSync(headerPath, "r");
		} catch (e) {
			logger.error("Failed to open XML header file: " + headerPath + "\n" + e.toString());
		}
		if (fd) {
			headerText = data.readFile(fd);
			fse.closeSync(fd);
		}
	}

	if (FILENAME_FOOTER) {
		var footerPath = path.join(__dirname, FILENAME_FOOTER);
		try {
			var fd = fse.openSync(footerPath, "r");
		} catch (e) {
			logger.error("Failed to open XML footer file: " + footerPath + "\n" + e.toString());
		}
		if (fd) {
			footerText = data.readFile(fd);
			fse.closeSync(fd);
		}
	}
};

/* handles the current text-based toc format */
toc.file.parse = function(content, data) {
	if (!/toc(\.txt)?$/.test(data.filename)) {
		return;
	}

	var blockAttributeRegex = /^(\{:(?:\\\}|[^\}])*\})/;
	var refNameRegex = /\{[ ]{0,3}:([^:]+):([^}]*)/;
	var attributeListContentRegex = /\{[ ]{0,3}:([^}]*)/;
	var attributeDefinitionLists = {};
	var eligibleAttributes = [];
	var FOURSPACES = "    ";

	var tocFileLines = data.split("\n");

	var rootElement = {level: 0, children: []};
	var lastTocItem = rootElement;

	for (var i = 0; i < tocFileLines.length; i++) {
		var tocItem = tocFileLines[i].replace(/\t/g, FOURSPACES);
		var indentChars = /^[ >]*/.exec(tocItem);
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

		var gtCount = indentChars[0].split(">").length - 1;
		var level = (gtCount || Math.floor(indentChars[0].length / FOURSPACES.length)) + 1;
		if (level - lastTocItem.level > 1) {
			eligibleAttributes = [];
			logger.warning("Excluded from toc files due to invalid nesting level: " + data.filename + "#" + tocItem);
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

		var newItem = {level: level, children: []};
		newItem.topic = tocItem;
		newItem.attributes = computeAttributes(eligibleAttributes, attributeDefinitionLists);

		/* calculate the parent element */
		while (level - 1 < lastTocItem.level) {
			lastTocItem = lastTocItem.parent;
		}
		newItem.parent = lastTocItem;
		lastTocItem.children.push(newItem);

		lastTocItem = newItem;
		eligibleAttributes = [];
	}
	
	return rootElement.children;
};

toc.file.output = function(object, data) {
	/* XML output */
	var destination = data.destination;

	object.forEach(function(current) {
		var newTopics = null;
		var tocItem = current.topic;
// TODO get adapter
		// TODO this has moved out to an extension, remove it from here next time breaking changes are permitted
		var match = REGEX_LINK.exec(tocItem);
		if (match) {
			/* is a link to external content */
			newTopics = data.htmlToDom(adapter.createTopic(match[2], match[1]), {xmlMode: true})[0];
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
//
//						var topicsString = "";
//						var currentTopic = newTopics;
//						while (currentTopic) {
//							topicsString += common.domToHtml(currentTopic, {xmlMode: true}) + "\n";
//							currentTopic = currentTopic.next;
//						}
//
//						var newTopicsString = common.invokeExtensions(
//							extensions,
//							"xml.toc.file.onGenerate",
//							topicsString || tocItem,
//							{
//								source: tocItem,
//								level: level,
//								attributes: computeAttributes(eligibleAttributes, attributeDefinitionLists),
//								htmlToDom: common.htmlToDom,
//								domToHtml: common.domToHtml,
//								domToInnerHtml: common.domToInnerHtml,
//								domUtils: common.domUtils
//							});
//						if (topicsString !== newTopicsString) {
//							newTopics = common.htmlToDom(newTopicsString, {xmlMode: true})[0];
//						}
//
//						if (newTopics) {
//							/* determine the correct parent element */
//							while (level - 1 < lastTocItem.level) {
//								lastTocItem = common.domUtils.getParent(lastTocItem);
//							}
//
//							/* append the topic children */
//							currentTopic = newTopics;
//							while (currentTopic) {
//								currentTopic.level = level;
//								common.domUtils.appendChild(lastTocItem, currentTopic);
//								lastTocItem = currentTopic;
//								currentTopic = currentTopic.next;
//							}
//						} else {
//							if (newTopicsString !== "") {
//								var warningString = "Excluded from toc files: " + tocOrderPath + "#" + tocItem;
//								if (exception) {
//									warningString += ".  Possibly relevant, file exception when attempting to access it as a file: " + exception.toString();
//								}
//								logger.warning(warningString);
//							}
//						}
//
//						eligibleAttributes = [];
//					}
//					
//					return common.domToInnerHtml(rootElement, {xmlMode: true});
//};

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

module.exports.html = html;
module.exports.xml = xml;
module.exports.init = init;
module.exports.id = "xmlTOC";
