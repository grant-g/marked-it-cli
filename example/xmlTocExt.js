var FILENAME_HEADER = "header-xml";
var FILENAME_FOOTER = null;

var fs = require("fs");
var path = require("path");
var url = require("url");
var headerText, footerText;

var NOTOC = "notoc";
var PREFIX_TOC = "toc-";

/* the following regex is sourced from marked: https://github.com/chjj/marked */
var REGEX_LINK = /^!?\[((?:\[[^\]]*\]|[^\[\]]|\](?=[^\[]*\]))*)\]\(\s*<?([\s\S]*?)>?(?:\s+['"]([\s\S]*?)['"])?\s*\)/;

var html = {};
var xml = {toc: {file: {}}};

html.onHeading = function(html, data) {
	var heading = data.htmlToDom(html);
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
	var heading = data.htmlToDom(data.heading);
	var attributes = heading.attribs;
	if (attributes[NOTOC]) {
		return ""; /* do not generate a TOC entry for this header */
	}

	var topicDom = data.htmlToDom(topic);
	var changed = false;
	Object.keys(attributes).forEach(function(key) {
		if (key.indexOf(PREFIX_TOC) === 0) {
			var name = key.substring(PREFIX_TOC.length);
			var property = data.htmlToDom("<property name='" + name + "' value='" + attributes[key] + "'>\n</property>\n");
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

xml.toc.file.onGenerate = function(xml, data) {
	var CLASS_TOC = "toc";
	var CLASS_NAVGROUP = "navgroup";
	var CLASS_TOPICGROUP = "topicgroup";
	var ATTRIBUTE_CLASS = "class";

	/* if injecting TOC from a .md file add an <anchor> child to all non-top-level topics */
	if (/\.md\s*$/.test(data.source)) {
		var root = data.htmlToDom(xml);
		var topics = data.domUtils.find(function(node) {return node.name && node.name.toLowerCase() === "topic";}, [root], true, Infinity);
		topics.forEach(function(topic) {
			if (topic.parent) {
				var urlObject = url.parse(topic.attribs.href);
				var pathname = urlObject.pathname.substring(urlObject.pathname.lastIndexOf("/") + 1);
				pathname = pathname.substring(0, pathname.lastIndexOf("."));
				var anchorId = pathname + "_" + urlObject.hash.substring(1);
				var anchor = data.htmlToDom('<anchor id="' + anchorId + '" />');
				var children = data.domUtils.getChildren(topic);
				if (!children.length) {
					data.domUtils.appendChild(topic, anchor);
				} else {
					var firstChild = children[0];
					data.domUtils.prepend(firstChild, anchor);
				}
			}
		});
		return data.domToHtml(root, {xmlMode: true});
	}

	var match = REGEX_LINK.exec(data.source);
	if (match) {
		/* link to external content */
		return '<topic href="' + match[2] + '" label="' + match[1] + '" />';
	}

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
				return '<toc label="' + data.source + '">\n' + propertiesString + '</toc>';
			}
			if (current === CLASS_NAVGROUP) {
				return '<topic label="' + data.source + '"><property name="navgroup" value="' + data.source + '" /></topic>';
			}
			if (current === CLASS_TOPICGROUP) {
				return '<topic label="' + data.source + '"><property name="topicgroup" value="' + data.source + '" /></topic>';
			}
		}
	}

	return null;
};

var init = function(data) {
	if (FILENAME_HEADER) {
		var headerPath = path.join(__dirname, FILENAME_HEADER);
		try {
			var fd = fs.openSync(headerPath, "r");
		} catch (e) {
			data.logger.error("Failed to open XML header file: " + headerPath + "\n" + e.toString());
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
			data.logger.error("Failed to open XML footer file: " + footerPath + "\n" + e.toString());
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
