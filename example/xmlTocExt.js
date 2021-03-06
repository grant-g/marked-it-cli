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

var fs = require("fs");
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
		if (!classes.length) {
			delete data.attributes[ATTRIBUTE_CLASS];
		} else {
			data.attributes[ATTRIBUTE_CLASS] = classes.join(" ");
		}
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
			var fd = fs.openSync(headerPath, "r");
		} catch (e) {
			logger.error("Failed to open XML header file: " + headerPath + "\n" + e.toString());
		}
		if (fd) {
			headerText = data.readFile(fd);
			fs.closeSync(fd);
		}
	}

	if (FILENAME_FOOTER) {
		var footerPath = path.join(__dirname, FILENAME_FOOTER);
		try {
			var fd = fs.openSync(footerPath, "r");
		} catch (e) {
			logger.error("Failed to open XML footer file: " + footerPath + "\n" + e.toString());
		}
		if (fd) {
			footerText = data.readFile(fd);
			fs.closeSync(fd);
		}
	}
}

module.exports.html = html;
module.exports.xml = xml;
module.exports.init = init;
module.exports.id = "xmlTOC";
